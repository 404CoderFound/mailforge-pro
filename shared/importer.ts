import Papa from "papaparse";
import { z } from "zod";
import type {
  ImportPreview,
  ImportStats,
  ImportTextOptions,
  Recipient,
  SmtpAccountInput,
  SmtpImportOptions
} from "./contracts";

const emailSchema = z.string().email();
const emailPattern = /[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+/g;

export function normalizeSmtpHost(value: string): string {
  const input = value.trim();
  if (!input) return "";
  try {
    const url = new URL(input.includes("://") ? input : `smtp://${input}`);
    if (url.hostname) return url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  } catch {
    // Fall through to tolerant extraction for malformed control-panel URLs.
  }
  const withoutScheme = input.replace(/^[a-z][a-z0-9+.-]*:\/\//i, "");
  const withoutCredentials = withoutScheme.slice(withoutScheme.lastIndexOf("@") + 1);
  return (withoutCredentials.split(/[/?#]/, 1)[0] ?? "")
    .replace(/^\[|\]$/g, "")
    .replace(/:\d+$/, "")
    .trim()
    .toLowerCase();
}

const smtpSchema = z.object({
  name: z.string().optional(),
  host: z.preprocess((value) => normalizeSmtpHost(String(value ?? "")), z.string().min(1)),
  port: z.coerce.number().int().min(1).max(65535),
  username: z.string().min(1),
  password: z.string().min(1),
  encryption: z.enum(["none", "ssl", "tls", "starttls"]).default("starttls"),
  dailyLimit: z.coerce.number().int().min(1).max(5000).optional(),
  notes: z.string().optional(),
  proxy: z.string().optional()
});

function decodeText(input: string, encoding: ImportTextOptions["encoding"], base64: boolean): string {
  const text = base64
    ? new TextDecoder(encoding).decode(Uint8Array.from(atob(input), (character) => character.charCodeAt(0)))
    : input;
  return text.replace(/^\uFEFF/, "");
}

function detectDelimiter(text: string): string {
  const candidates = [",", ";", "\t", "|"];
  const lines = text.split(/\r?\n/).filter(Boolean).slice(0, 10);
  return candidates
    .map((delimiter) => ({
      delimiter,
      score: lines.reduce((sum, line) => sum + line.split(delimiter).length - 1, 0)
    }))
    .sort((a, b) => b.score - a.score)[0]?.delimiter ?? ",";
}

function extractEmail(line: string, mode: ImportTextOptions["emailMode"]): string | undefined {
  if (mode === "name-angle") {
    return line.match(/<\s*([^<>]+@[^<>]+)\s*>/)?.[1]?.trim();
  }
  if (mode === "email-name") {
    const first = line.split(/[;,|\t]/)[0]?.trim() ?? "";
    return first.includes("@") ? first : undefined;
  }
  if (mode === "name-email") {
    const fields = line.split(/[;,|\t]/).map((field) => field.trim());
    return fields.find((field) => field.includes("@"));
  }
  return line.match(emailPattern)?.[0];
}

function isValidEmail(email: string, strict: boolean): boolean {
  if (!strict) return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  return emailSchema.safeParse(email).success;
}

function findHeader(headers: string[], pattern: RegExp): string | undefined {
  return headers.find((header) => pattern.test(header.trim().replace(/[_-]+/g, " ")));
}

function isConsentHeader(header: string): boolean {
  return /^(?:is )?(?:opt(?:ed)? ?in|subscribed|consent)$/i.test(header.trim().replace(/[_-]+/g, " "));
}

function makeStats(totalRows: number, recipients: Recipient[], duplicatesRemoved: number, invalidRows: number, filteredRows = 0): ImportStats {
  return {
    totalRows,
    validEmails: recipients.length,
    duplicatesRemoved,
    invalidRows,
    filteredRows
  };
}

function makeHeaders(values: string[], customNames: string[] = []): string[] {
  const counts = new Map<string, number>();
  return values.map((value, index) => {
    const base = customNames[index]?.trim() || value.trim() || `column_${index + 1}`;
    const count = (counts.get(base) ?? 0) + 1;
    counts.set(base, count);
    return count === 1 ? base : `${base}_${count}`;
  });
}

function hasHeaderRow(values: string[]): boolean {
  return values.some((value) =>
    /^(email|e-?mail|email address|name|full name|first name|last name|company|phone|department)$/i.test(value.trim().replace(/[_-]+/g, " "))
    || isConsentHeader(value));
}

function rowMatchesFilter(row: Record<string, unknown>, options: ImportTextOptions): boolean {
  if (!options.rowFilterColumn || !(options.rowFilterColumn in row)) return true;
  const actual = String(row[options.rowFilterColumn] ?? "").trim().toLocaleLowerCase();
  const expected = (options.rowFilterValue ?? "").trim().toLocaleLowerCase();
  switch (options.rowFilterOperator ?? "contains") {
    case "equals": return actual === expected;
    case "starts-with": return actual.startsWith(expected);
    case "not-empty": return actual.length > 0;
    default: return actual.includes(expected);
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function parseTemplateRecords(
  lines: string[],
  options: Pick<ImportTextOptions, "customFormat" | "recordMode" | "recordLineCount">,
  requiredPlaceholder = "email"
): { headers: string[]; rows: Array<Record<string, unknown>> } {
  const format = options.customFormat?.trim();
  if (!format) throw new Error(`Enter a custom format containing at least a {${requiredPlaceholder}} placeholder.`);
  const placeholderPattern = /\{\{?\s*([a-zA-Z_][a-zA-Z0-9_. -]*)\s*\}\}?/g;
  const placeholders = [...format.matchAll(placeholderPattern)];
  if (!placeholders.length) throw new Error("The custom format needs placeholders such as {email}, {name}, or {company}.");
  if (!placeholders.some((match) => match[1]?.trim().replace(/[ .-]+/g, "_").toLowerCase() === requiredPlaceholder)) {
    throw new Error(`The custom format must contain a {${requiredPlaceholder}} placeholder.`);
  }

  let pattern = "";
  let cursor = 0;
  for (const placeholder of placeholders) {
    const index = placeholder.index ?? 0;
    pattern += escapeRegExp(format.slice(cursor, index)).replace(/\s+/g, "\\s+");
    pattern += "([\\s\\S]*?)";
    cursor = index + placeholder[0].length;
  }
  pattern += escapeRegExp(format.slice(cursor)).replace(/\s+/g, "\\s+");
  const matcher = new RegExp(`^\\s*${pattern}\\s*$`, "i");

  const recordMode = options.recordMode ?? "line";
  let records: string[] = [];
  if (recordMode === "blank-line") {
    const blocks: string[][] = [];
    let block: string[] = [];
    for (const line of lines) {
      if (line.trim()) block.push(line);
      else if (block.length) { blocks.push(block); block = []; }
    }
    if (block.length) blocks.push(block);
    records = blocks.map((linesInBlock) => linesInBlock.join("\n"));
  } else if (recordMode === "fixed-lines") {
    const nonEmptyLines = lines.filter((line) => line.trim());
    const count = Math.max(1, Math.floor(options.recordLineCount ?? 1));
    for (let index = 0; index < nonEmptyLines.length; index += count) {
      records.push(nonEmptyLines.slice(index, index + count).join("\n"));
    }
  } else {
    records = lines.filter((line) => line.trim());
  }

  const headers = [...new Set(placeholders.map((match) => match[1]!.trim()).filter((name) => !/^(?:_|ignore)$/i.test(name)))];
  const rows = records.map((record) => {
    const match = matcher.exec(record);
    if (!match) return {};
    const row: Record<string, unknown> = {};
    placeholders.forEach((placeholder, index) => {
      const name = placeholder[1]!.trim();
      if (!/^(?:_|ignore)$/i.test(name) && !(name in row)) row[name] = match[index + 1]?.trim() ?? "";
    });
    return row;
  });
  return { headers, rows };
}

export function parseRecipients(
  input: string,
  fileName: string,
  options: ImportTextOptions,
  base64 = false
): ImportPreview {
  const text = decodeText(input, options.encoding, base64);
  const extension = fileName.toLowerCase().split(".").pop();
  let rows: Array<Record<string, unknown>> = [];
  let headers: string[] = [];

  if (extension === "json") {
    const parsed: unknown = JSON.parse(text);
    const array = Array.isArray(parsed) ? parsed : [parsed];
    rows = array.filter((row): row is Record<string, unknown> => typeof row === "object" && row !== null);
    headers = [...new Set(rows.flatMap((row) => Object.keys(row)))];
  } else {
    const skipRows = Math.max(0, Math.floor(options.skipRows ?? 0));
    const commentPrefix = options.commentPrefix?.trim() ?? "";
    const templateLines = text.split(/\r?\n/).slice(skipRows).filter((line) =>
      !commentPrefix || !line.trimStart().startsWith(commentPrefix));
    const sourceLines = templateLines.filter((line) => line.trim().length > 0);
    const preparedText = sourceLines.join("\n");
    if (options.parserMode === "template") {
      const parsed = parseTemplateRecords(templateLines, options);
      rows = parsed.rows;
      headers = parsed.headers;
    } else {
    const delimiter = options.delimiter === "auto"
      ? detectDelimiter(preparedText)
      : options.delimiter === "custom"
        ? options.customDelimiter || ","
        : options.delimiter;
    const lines = [...sourceLines];
    const simpleHeader = /^(e-?mail|email address)\s*$/i.test(lines[0]?.trim() ?? "");
    if (simpleHeader && options.headerMode !== "none" && (options.emailMode === "line" || delimiter === " ")) lines.shift();
    const looksStructured = options.emailMode === "email-name" || options.emailMode === "name-email";
    const useStructuredParser = extension === "csv" || looksStructured
      || (options.emailMode === "auto" && delimiter !== " " && lines.some((line) => line.includes(delimiter)));
    if (useStructuredParser) {
      const parsed = Papa.parse<string[]>(preparedText, {
        delimiter,
        skipEmptyLines: true,
        quoteChar: '"',
        escapeChar: '"'
      });
      if (parsed.errors.some((error) => error.code !== "UndetectableDelimiter")) {
        throw new Error(parsed.errors[0]?.message ?? "Could not read the delimited text");
      }
      const firstRow = parsed.data[0] ?? [];
      const headerRow = options.headerMode === "first-row"
        || (options.headerMode !== "none" && (extension === "csv" || hasHeaderRow(firstRow)));
      if (headerRow) {
        headers = makeHeaders(firstRow);
        rows = parsed.data.slice(1).map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""])));
      } else {
        const width = Math.max(0, ...parsed.data.map((values) => values.length));
        headers = makeHeaders(Array.from({ length: width }, (_, index) => `column_${index + 1}`), options.columnNames);
        rows = parsed.data.map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""])));
      }
    } else {
      rows = lines.map((line) => ({ line }));
      headers = ["line"];
    }
    }
  }

  const totalRows = rows.length;
  rows = rows.filter((row) => rowMatchesFilter(row, options));
  let filteredRows = totalRows - rows.length;
  const maxRows = Math.max(0, Math.floor(options.maxRows ?? 0));
  if (maxRows > 0 && rows.length > maxRows) {
    filteredRows += rows.length - maxRows;
    rows = rows.slice(0, maxRows);
  }

  const emailHeader = options.emailColumn && headers.includes(options.emailColumn)
    ? options.emailColumn
    : findHeader(headers, /^(e?mail|email address)$/i);
  const fullNameHeader = options.nameColumn && headers.includes(options.nameColumn)
    ? options.nameColumn
    : findHeader(headers, /^(name|full name)$/i);
  const firstNameHeader = options.firstNameColumn && headers.includes(options.firstNameColumn)
    ? options.firstNameColumn
    : findHeader(headers, /^first name$/i);
  const lastNameHeader = options.lastNameColumn && headers.includes(options.lastNameColumn)
    ? options.lastNameColumn
    : findHeader(headers, /^last name$/i);
  const consentHeader = options.consentColumn && headers.includes(options.consentColumn)
    ? options.consentColumn
    : headers.find(isConsentHeader);
  const consentValues = new Set((options.consentTrueValues || "true,yes,y,1,subscribed,opted in")
    .split(/[,;|\n]/).map((value) => value.trim().toLocaleLowerCase()).filter(Boolean));
  const includedColumns = options.includedColumns ? new Set(options.includedColumns) : null;
  const seen = new Set<string>();
  const recipients: Recipient[] = [];
  let duplicatesRemoved = 0;
  let invalidRows = 0;

  for (const row of rows) {
    const values = Object.values(row).map((value) => String(value ?? ""));
    const line = values.join(" ");
    const mode = options.emailMode === "auto" ? "free-text" : options.emailMode;
    const firstColumn = String(row.column_1 ?? "");
    const secondColumn = String(row.column_2 ?? "");
    const columnEmail = mode === "email-name"
      ? firstColumn
      : mode === "name-email"
        ? secondColumn
        : [firstColumn, secondColumn].find((value) => value.includes("@"));
    const preferredValue = emailHeader
      ? String(row[emailHeader] ?? "")
      : extension === "txt" && columnEmail
        ? columnEmail
        : line;
    const found = mode === "free-text" && !emailHeader
      ? line.match(emailPattern) ?? []
      : [extractEmail(preferredValue, mode) ?? extractEmail(line, "free-text")].filter((value): value is string => Boolean(value));
    const validEmails: string[] = [];
    for (let email of found) {
      if (options.trim) email = email.trim();
      if (options.lowercase) email = email.toLowerCase();
      if (isValidEmail(email, options.strictValidation)) validEmails.push(email);
    }
    if (!validEmails.length) {
      invalidRows++;
      continue;
    }

    const rawName = fullNameHeader
      ? String(row[fullNameHeader] ?? "")
      : mode === "email-name"
        ? secondColumn
        : mode === "name-email"
          ? firstColumn
          : extension === "txt" && columnEmail
            ? columnEmail === firstColumn ? secondColumn : firstColumn
            : line.match(/^\s*(.*?)\s*<[^<>]+@[^<>]+>/)?.[1] ?? "";
    const firstName = firstNameHeader ? String(row[firstNameHeader] ?? "") : rawName.split(/\s+/)[0] ?? "";
    const lastName = lastNameHeader ? String(row[lastNameHeader] ?? "") : rawName.split(/\s+/).slice(1).join(" ");
    const consent = consentHeader ? row[consentHeader] : undefined;
    const fields = Object.fromEntries(
      Object.entries(row)
        .filter(([keyName]) => ![
          emailHeader, fullNameHeader, firstNameHeader, lastNameHeader,
          consentHeader, options.emailColumn, options.nameColumn, options.firstNameColumn, options.lastNameColumn,
          options.consentColumn
        ].includes(keyName))
        .filter(([keyName]) => !includedColumns || includedColumns.has(keyName))
        .map(([keyName, value]) => [options.columnAliases?.[keyName]?.trim() || keyName, String(value ?? "")])
    );
    for (const email of validEmails) {
      const key = email.toLowerCase();
      if (options.removeDuplicates && seen.has(key)) {
        duplicatesRemoved++;
        continue;
      }
      seen.add(key);
      recipients.push({
        email,
        name: rawName || undefined,
        firstName: firstName || undefined,
        lastName: lastName || undefined,
        optedIn: consentValues.has(String(consent ?? "").trim().toLocaleLowerCase()),
        fields
      });
    }
  }

  return {
    headers,
    rows: rows.slice(0, 50).map((row) => Object.fromEntries(Object.entries(row).map(([key, value]) => [key, String(value ?? "")]))),
    recipients,
    stats: makeStats(totalRows, recipients, duplicatesRemoved, invalidRows, filteredRows)
  };
}

export function parseSmtpImport(
  text: string,
  fileName: string,
  base64 = false,
  options?: SmtpImportOptions
): { accounts: SmtpAccountInput[]; errors: string[] } {
  const settings: SmtpImportOptions = options ?? {
    parserMode: "auto", customFormat: "{host}:{port}:{username}:{password}:{encryption}",
    recordMode: "line", recordLineCount: 4, encoding: "utf-8", skipRows: 0, commentPrefix: "",
    defaultEncryption: "starttls", defaultDailyLimit: 100
  };
  text = decodeText(text, settings.encoding, base64);
  const extension = fileName.toLowerCase().split(".").pop();
  const errors: string[] = [];
  let values: unknown[] = [];
  if (extension === "json") {
    const parsed: unknown = JSON.parse(text);
    values = Array.isArray(parsed) ? parsed : [parsed];
  } else if (extension === "csv") {
    const parsed = Papa.parse<Record<string, unknown>>(text, { header: true, skipEmptyLines: true });
    if (parsed.errors.length) throw new Error(parsed.errors[0]?.message ?? "Could not read CSV");
    values = parsed.data;
  } else {
    const commentPrefix = settings.commentPrefix.trim();
    const templateLines = text.split(/\r?\n/).slice(Math.max(0, Math.floor(settings.skipRows))).filter((line) =>
      !commentPrefix || !line.trimStart().startsWith(commentPrefix));
    if (settings.parserMode === "template") {
      values = parseTemplateRecords(templateLines, settings, "host").rows;
    } else {
      const lines = templateLines.filter((line) => line.trim().length > 0);
      if (lines[0] && /^(host|smtp[_ ]host)[\s:|,;]/i.test(lines[0].trim())) lines.shift();
      const records: string[][] = [];
      for (let index = 0; index < lines.length;) {
        const line = lines[index]!.trim();
        const parts = line.includes("|") ? line.split("|") : line.includes(":") ? line.split(":") : line.split(/\s+/);
        if (parts.length >= 4) {
          records.push(parts.map((part) => part.trim()));
          index++;
        } else if (index + 3 < lines.length) {
          records.push(lines.slice(index, index + 4).map((part) => part.trim()));
          index += 4;
        } else {
          errors.push(`Line ${index + 1}: unable to detect SMTP format`);
          index++;
        }
      }
      values = records.map((parts) => {
        const usesPipe = text.includes("|");
        const hasEncryption = parts.length >= 5;
        const [host, port, username, password, encryption] = usesPipe || hasEncryption
          ? parts
          : parts.length === 4
            ? parts
            : [parts[0], parts[1], parts[2], parts.slice(3).join(" "), undefined];
        return { host, port, username, password, encryption: encryption || settings.defaultEncryption };
      });
    }
  }

  const accounts: SmtpAccountInput[] = [];
  for (const [index, value] of values.entries()) {
    const source = typeof value === "object" && value !== null ? value as Record<string, unknown> : {};
    const normalized = Object.fromEntries(Object.entries(source).map(([key, item]) => {
      const normalizedKey = key.trim().toLowerCase().replace(/[ .-]+/g, "_");
      const aliases: Record<string, string> = {
        smtp_host: "host", server: "host", smtp_server: "host", user: "username", login: "username",
        pass: "password", secret: "password", security: "encryption", secure: "encryption",
        account_name: "name", daily_limit: "dailyLimit", dailylimit: "dailyLimit", limit: "dailyLimit"
      };
      return [aliases[normalizedKey] ?? normalizedKey, item];
    }));
    normalized.encryption = String(normalized.encryption || settings.defaultEncryption).trim().toLowerCase();
    if (normalized.dailyLimit === undefined) normalized.dailyLimit = settings.defaultDailyLimit;
    const parsed = smtpSchema.safeParse(normalized);
    if (parsed.success && parsed.data.proxy?.trim()) {
      errors.push(`Row ${index + 1}: Proxy settings are not supported yet; remove the proxy value and retry.`);
    } else if (parsed.success) {
      delete parsed.data.proxy;
      accounts.push(parsed.data);
    }
    else errors.push(`Row ${index + 1}: ${parsed.error.issues[0]?.message ?? "Invalid SMTP account"}`);
  }
  return { accounts, errors };
}

export function recipientsToCsv(recipients: Recipient[]): string {
  return Papa.unparse(recipients.map((recipient) => ({
    ...recipient.fields,
    email: recipient.email,
    name: recipient.name ?? "",
    first_name: recipient.firstName ?? "",
    last_name: recipient.lastName ?? "",
    opted_in: recipient.optedIn
  })));
}
