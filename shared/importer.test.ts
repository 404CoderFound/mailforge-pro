import { describe, expect, it } from "vitest";
import { normalizeSmtpHost, parseRecipients, parseSmtpImport } from "./importer";
import type { ImportTextOptions } from "./contracts";

const options: ImportTextOptions = {
  delimiter: "auto",
  emailMode: "auto",
  trim: true,
  removeDuplicates: true,
  lowercase: true,
  strictValidation: true,
  encoding: "utf-8"
};

describe("recipient import", () => {
  it("extracts contacts from angle-bracket text and counts duplicates", () => {
    const preview = parseRecipients(
      "Ada Lovelace <ADA@example.com>\nAda again <ada@example.com>\nNo address here",
      "contacts.txt",
      options
    );
    expect(preview.recipients.map((recipient) => recipient.email)).toEqual(["ada@example.com"]);
    expect(preview.recipients[0]?.name).toBe("Ada Lovelace");
    expect(preview.stats).toEqual({ totalRows: 3, validEmails: 1, duplicatesRemoved: 1, invalidRows: 1, filteredRows: 0 });
  });

  it("extracts multiple emails from free text and maps consented CSV columns", () => {
    const textPreview = parseRecipients("For help contact alice@example.com or bob@example.net", "notes.txt", options);
    expect(textPreview.recipients.map((recipient) => recipient.email)).toEqual(["alice@example.com", "bob@example.net"]);

    const csvPreview = parseRecipients(
      "email,first_name,last_name,subscribed,department\njane@example.com,Jane,Doe,yes,Design",
      "contacts.csv",
      options
    );
    expect(csvPreview.recipients[0]).toMatchObject({
      email: "jane@example.com",
      firstName: "Jane",
      lastName: "Doe",
      optedIn: true,
      fields: { department: "Design" }
    });
  });

  it("supports delimiter-based name and email rows without assuming consent", () => {
    const preview = parseRecipients(
      "Grace Hopper|grace@example.com\nAlan Turing|alan@example.com",
      "people.txt",
      { ...options, delimiter: "|", emailMode: "name-email" }
    );
    expect(preview.recipients.map((recipient) => [recipient.name, recipient.email, recipient.optedIn])).toEqual([
      ["Grace Hopper", "grace@example.com", false],
      ["Alan Turing", "alan@example.com", false]
    ]);
  });

  it("recognizes headers in TXT and decodes Windows-1252 bytes", () => {
    const headerPreview = parseRecipients(
      "email,first_name,opted_in\njules@example.com,Jules,yes",
      "contacts.txt",
      options
    );
    expect(headerPreview.recipients[0]).toMatchObject({ firstName: "Jules", optedIn: true });

    const legacyLine = "Andr\xe9 <andre@example.com>";
    const binary = btoa(String.fromCharCode(...Array.from(legacyLine, (character) => character.charCodeAt(0))));
    const legacyPreview = parseRecipients(
      binary,
      "legacy.txt",
      { ...options, encoding: "windows-1252" },
      true
    );
    expect(legacyPreview.recipients[0]?.name).toBe("André");
  });

  it("supports custom columns, skipped comments, filtering, consent values, field selection, and aliases", () => {
    const preview = parseRecipients([
      "export generated 2026-11-04",
      "# email|first|last|department|company|permission",
      "jane@example.com|Jane|Doe|Sales|Acme|approved",
      "alan@example.com|Alan|Turing|Research|Bletchley|no",
      "casey@example.com|Casey|Taylor|Support|Example|approved"
    ].join("\n"), "advanced.txt", {
      ...options,
      delimiter: "|",
      headerMode: "none",
      skipRows: 1,
      commentPrefix: "#",
      columnNames: ["email", "first", "last", "department", "company", "permission"],
      emailColumn: "email",
      firstNameColumn: "first",
      lastNameColumn: "last",
      consentColumn: "permission",
      consentTrueValues: "approved",
      rowFilterColumn: "department",
      rowFilterOperator: "equals",
      rowFilterValue: "Sales",
      includedColumns: ["company"],
      columnAliases: { company: "organization" }
    });

    expect(preview.headers).toEqual(["email", "first", "last", "department", "company", "permission"]);
    expect(preview.recipients).toEqual([{
      email: "jane@example.com",
      firstName: "Jane",
      lastName: "Doe",
      optedIn: true,
      fields: { organization: "Acme" }
    }]);
    expect(preview.stats).toEqual({ totalRows: 3, validEmails: 1, duplicatesRemoved: 0, invalidRows: 0, filteredRows: 2 });
  });

  it("extracts fields with reusable single-line and multi-line custom format templates", () => {
    const linePreview = parseRecipients([
      "EMAIL=jane@example.com; NAME=Jane Doe; COMPANY=Acme",
      "EMAIL=alan@example.com; NAME=Alan Turing; COMPANY=Bletchley"
    ].join("\n"), "custom.txt", {
      ...options,
      parserMode: "template",
      recordMode: "line",
      customFormat: "EMAIL={email}; NAME={name}; COMPANY={company}"
    });
    expect(linePreview.recipients[0]).toMatchObject({
      email: "jane@example.com", name: "Jane Doe", fields: { company: "Acme" }
    });

    const blockPreview = parseRecipients([
      "Email: jane@example.com",
      "First: Jane",
      "Last: Doe",
      "Permission: approved",
      "",
      "Email: alan@example.com",
      "First: Alan",
      "Last: Turing",
      "Permission: no"
    ].join("\n"), "blocks.txt", {
      ...options,
      parserMode: "template",
      recordMode: "blank-line",
      customFormat: "Email: {email}\nFirst: {first_name}\nLast: {last_name}\nPermission: {opted_in}",
      consentTrueValues: "approved"
    });
    expect(blockPreview.recipients.map((recipient) => [recipient.email, recipient.firstName, recipient.lastName, recipient.optedIn])).toEqual([
      ["jane@example.com", "Jane", "Doe", true],
      ["alan@example.com", "Alan", "Turing", false]
    ]);
  });
});

describe("SMTP import", () => {
  it("keeps only the hostname when control-panel URLs, ports, or paths are supplied", () => {
    expect(normalizeSmtpHost("altar18.supremepanel18.com:2096/cpsess4795254881/3rdparty/roundcube"))
      .toBe("altar18.supremepanel18.com");
    expect(normalizeSmtpHost("https://user@example.com@SMTP.EXAMPLE.COM:8443/mail?folder=inbox#top"))
      .toBe("smtp.example.com");
  });

  it("parses structured, delimited, whitespace, and block text formats", () => {
    const result = parseSmtpImport([
      "smtp.one.test:465:alice:secret",
      "smtp.two.test|587|bob|secret|starttls",
      "smtp.three.test 587 carol secret tls",
      "smtp.four.test",
      "587",
      "dana",
      "secret"
    ].join("\n"), "servers.txt");
    expect(result.accounts).toHaveLength(4);
    expect(result.accounts[0]).toMatchObject({ host: "smtp.one.test", port: 465, username: "alice" });
    expect(result.accounts[1]?.encryption).toBe("starttls");
    expect(result.accounts[2]?.encryption).toBe("tls");
    expect(result.accounts[3]?.host).toBe("smtp.four.test");
  });

  it("validates structured JSON and reports invalid rows", () => {
    const result = parseSmtpImport(JSON.stringify([
      { host: "smtp.example.test", port: 587, username: "user", password: "pass", encryption: "starttls" },
      { host: "", port: 99999, username: "", password: "" }
    ]), "servers.json");
    expect(result.accounts).toHaveLength(1);
    expect(result.errors).toHaveLength(1);
  });

  it("imports SMTP accounts using custom single-line and multi-line format templates", () => {
    const lineResult = parseSmtpImport([
      "smtp.one.test:2096/control-panel;587;alice;secret;starttls;Primary;250",
      "smtp.two.test;465;bob;hunter2;ssl;Backup;100"
    ].join("\n"), "smtp.txt", false, {
      parserMode: "template",
      customFormat: "{host};{port};{username};{password};{encryption};{name};{daily_limit}",
      recordMode: "line",
      recordLineCount: 1,
      encoding: "utf-8",
      skipRows: 0,
      commentPrefix: "",
      defaultEncryption: "starttls",
      defaultDailyLimit: 100
    });
    expect(lineResult.errors).toEqual([]);
    expect(lineResult.accounts[0]).toMatchObject({
      host: "smtp.one.test", port: 587, username: "alice", password: "secret",
      encryption: "starttls", name: "Primary", dailyLimit: 250
    });

    const blockResult = parseSmtpImport([
      "Host: smtp.block.test",
      "Port: 587",
      "Login: carol",
      "Password: block-secret",
      "",
      "Host: smtp.second.test",
      "Port: 465",
      "Login: dana",
      "Password: second-secret"
    ].join("\n"), "blocks.txt", false, {
      parserMode: "template",
      customFormat: "Host: {host}\nPort: {port}\nLogin: {username}\nPassword: {password}",
      recordMode: "blank-line",
      recordLineCount: 4,
      encoding: "utf-8",
      skipRows: 0,
      commentPrefix: "",
      defaultEncryption: "starttls",
      defaultDailyLimit: 75
    });
    expect(blockResult.errors).toEqual([]);
    expect(blockResult.accounts).toHaveLength(2);
    expect(blockResult.accounts[1]).toMatchObject({
      host: "smtp.second.test", username: "dana", encryption: "starttls", dailyLimit: 75
    });
  });
});
