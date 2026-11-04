import { dialog, ipcMain, safeStorage } from "electron";
import nodemailer from "nodemailer";
import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import Papa from "papaparse";
import { readFile, stat, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type {
  Campaign,
  CampaignInput,
  CampaignProgress,
  ComposeInput,
  Encryption,
  ImapAccountInput,
  MailLog,
  MailMessage,
  Recipient,
  SmtpAccount,
  SmtpAccountInput,
  SmtpImportOptions
} from "../shared/contracts";
import { normalizeSmtpHost, parseSmtpImport } from "../shared/importer";
import { getDatabase } from "./database";
import type Database from "better-sqlite3";
import type { BrowserWindow } from "electron";
import SMTPTransport = require("nodemailer/lib/smtp-transport");

type SmtpRow = {
  id: number; name: string; host: string; port: number; username: string; encrypted_password: string;
  encryption: Encryption; daily_limit: number; enabled: number; sent_count: number; fail_count: number;
};
type ImapRow = {
  id: number; name: string; email: string; host: string; port: number; username: string;
  encrypted_password: string; encryption: Encryption;
};
type CampaignRow = {
  id: number; name: string; template_id: number; status: Campaign["status"]; sent_count: number;
  failed_count: number; created_at: string; scheduled_at: string | null; rate_per_minute: number;
};
type RecipientRow = {
  email: string; name: string | null; first_name: string | null; last_name: string | null;
  opted_in: number; fields_json: string;
};
type TemplateRow = { id: number; name: string; subject: string; html: string; text: string; updated_at: string };

const smtpInputSchema = z.object({
  name: z.string().optional(), host: z.preprocess((value) => normalizeSmtpHost(String(value ?? "")), z.string().min(1)), port: z.number().int().min(1).max(65535),
  username: z.string().min(1), password: z.string().min(1), encryption: z.enum(["none", "ssl", "tls", "starttls"]),
  dailyLimit: z.number().int().min(1).max(5000).optional(), notes: z.string().optional()
});
const recipientSchema = z.object({
  email: z.string().email(), name: z.string().optional(), firstName: z.string().optional(),
  lastName: z.string().optional(), optedIn: z.boolean(), fields: z.record(z.string(), z.string())
});
const templateSchema = z.object({
  id: z.number().int().nonnegative(), name: z.string().min(1), subject: z.string().min(1),
  html: z.string(), text: z.string()
});
const campaignSchema = z.object({
  name: z.string().min(1), templateId: z.number().int().positive(),
  recipientEmails: z.array(z.string().email()).min(1),
  ratePerMinute: z.number().int().min(1).max(30), scheduledAt: z.string().optional(), timezone: z.string().optional()
});
const imapSchema = z.object({
  name: z.string().min(1), email: z.string().email(), host: z.string().min(1),
  port: z.number().int().min(1).max(65535), username: z.string().min(1), password: z.string().min(1),
  encryption: z.enum(["none", "ssl", "tls", "starttls"])
});

const activeCampaigns = new Map<number, { timer?: NodeJS.Timeout }>();
const pendingAttachments = new Map<string, { path: string; name: string }>();

function encrypt(value: string): string {
  if (!safeStorage.isEncryptionAvailable()) throw new Error("Secure password storage is unavailable on this device.");
  return safeStorage.encryptString(value).toString("base64");
}

function decrypt(value: string): string {
  if (!safeStorage.isEncryptionAvailable()) throw new Error("Secure password storage is unavailable on this device.");
  return safeStorage.decryptString(Buffer.from(value, "base64"));
}

function smtpConfig(account: SmtpRow, password = decrypt(account.encrypted_password)): SMTPTransport.Options {
  const secure = account.encryption === "ssl" || account.encryption === "tls";
  return {
    host: account.host,
    port: account.port,
    secure,
    auth: { user: account.username, pass: password },
    requireTLS: account.encryption === "starttls",
    tls: { checkServerIdentity: () => undefined },
    connectionTimeout: 15000,
    greetingTimeout: 15000,
    socketTimeout: 30000
  };
}

function asSmtpAccount(row: SmtpRow, sentToday: number): SmtpAccount {
  return {
    id: row.id, name: row.name, host: row.host, port: row.port, username: row.username,
    encryption: row.encryption, dailyLimit: row.daily_limit, enabled: row.enabled === 1,
    sentToday, successCount: row.sent_count, failCount: row.fail_count
  };
}

function getSmtpRows(db: Database.Database): SmtpRow[] {
  return db.prepare("SELECT * FROM smtp_accounts ORDER BY id DESC").all() as SmtpRow[];
}

function addSmtp(db: Database.Database, input: SmtpAccountInput): number {
  const data = smtpInputSchema.parse(input);
  const result = db.prepare(`
    INSERT INTO smtp_accounts (name, host, port, username, encrypted_password, encryption, daily_limit, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(data.name || data.username, data.host, data.port, data.username, encrypt(data.password),
    data.encryption, data.dailyLimit ?? 100, data.notes ?? "");
  return Number(result.lastInsertRowid);
}

function getSmtpRowsWithUsage(db: Database.Database): SmtpAccount[] {
  const date = new Date().toISOString().slice(0, 10);
  const rows = getSmtpRows(db);
  return rows.map((row) => {
    const usage = db.prepare("SELECT sent_count FROM smtp_usage WHERE account_id = ? AND usage_date = ?").get(row.id, date) as { sent_count: number } | undefined;
    return asSmtpAccount(row, usage?.sent_count ?? 0);
  });
}

function log(db: Database.Database, status: "success" | "failed" | "info", message: string, campaignId: number | null = null, recipient: string | null = null, accountId: number | null = null): void {
  db.prepare("INSERT INTO mail_logs (campaign_id, recipient, account_id, status, message) VALUES (?, ?, ?, ?, ?)")
    .run(campaignId, recipient, accountId, status, message);
}

function asCampaign(row: CampaignRow): Campaign {
  return {
    id: row.id, name: row.name, templateId: row.template_id, status: row.status,
    sent: row.sent_count, failed: row.failed_count, createdAt: row.created_at
  };
}

function emitProgress(getWindow: () => BrowserWindow | null, progress: CampaignProgress): void {
  getWindow()?.webContents.send("campaign:progress", progress);
}

function scheduleCampaign(db: Database.Database, id: number, scheduledAt: number, getWindow: () => BrowserWindow | null): void {
  const remaining = scheduledAt - Date.now();
  if (remaining <= 0) {
    startCampaign(db, id, getWindow);
    return;
  }
  activeCampaigns.set(id, {
    timer: setTimeout(() => {
      activeCampaigns.delete(id);
      scheduleCampaign(db, id, scheduledAt, getWindow);
    }, Math.min(remaining, 2_147_000_000))
  });
}

function renderTokens(input: string, recipient: RecipientRow, html: boolean): string {
  const fields: Record<string, string> = {
    name: recipient.name ?? "",
    first_name: recipient.first_name ?? "",
    last_name: recipient.last_name ?? "",
    email: recipient.email,
    ...JSON.parse(recipient.fields_json) as Record<string, string>
  };
  const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[character] ?? character);
  return input.replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (_match, key: string) => {
    const value = fields[key] ?? "";
    return html ? escapeHtml(value) : value;
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function startCampaign(db: Database.Database, id: number, getWindow: () => BrowserWindow | null): void {
  if (activeCampaigns.has(id)) return;
  const state: { timer?: NodeJS.Timeout } = {};
  activeCampaigns.set(id, state);
  void (async () => {
    const campaign = db.prepare("SELECT * FROM campaigns WHERE id = ?").get(id) as CampaignRow | undefined;
    if (!campaign) {
      activeCampaigns.delete(id);
      throw new Error("Campaign no longer exists.");
    }
    db.prepare("UPDATE campaigns SET status = 'running' WHERE id = ?").run(id);
    const template = db.prepare("SELECT * FROM templates WHERE id = ?").get(campaign.template_id) as TemplateRow | undefined;
    if (!template) throw new Error("Campaign template no longer exists.");
    const total = (db.prepare("SELECT COUNT(*) AS count FROM campaign_recipients WHERE campaign_id = ?").get(id) as { count: number }).count;
    const minInterval = 60000 / Math.min(campaign.rate_per_minute, 30);
    let lastSentAt = 0;
    let accountCursor = 0;

    while (true) {
      const current = db.prepare("SELECT status, sent_count, failed_count FROM campaigns WHERE id = ?").get(id) as Pick<CampaignRow, "status" | "sent_count" | "failed_count"> | undefined;
      if (!current || current.status === "stopped") break;
      if (current.status === "paused") {
        await sleep(500);
        continue;
      }
      const target = db.prepare(`
        SELECT cr.email, r.name, r.first_name, r.last_name, r.fields_json
        FROM campaign_recipients cr
        JOIN recipients r ON r.email = cr.email
        WHERE cr.campaign_id = ? AND cr.status = 'pending' AND r.opted_in = 1
        ORDER BY cr.rowid LIMIT 1
      `).get(id) as RecipientRow | undefined;
      if (!target) {
        db.prepare("UPDATE campaigns SET status = 'completed' WHERE id = ?").run(id);
        break;
      }

      const now = new Date();
      const date = now.toISOString().slice(0, 10);
      const accounts = getSmtpRows(db).filter((account) => account.enabled === 1);
      const eligible = accounts.filter((account) => {
        const usage = db.prepare("SELECT sent_count FROM smtp_usage WHERE account_id = ? AND usage_date = ?").get(account.id, date) as { sent_count: number } | undefined;
        return (usage?.sent_count ?? 0) < account.daily_limit;
      });
      if (eligible.length === 0) {
        db.prepare("UPDATE campaign_recipients SET status = 'failed' WHERE campaign_id = ? AND email = ?").run(id, target.email);
        db.prepare("UPDATE campaigns SET failed_count = failed_count + 1 WHERE id = ?").run(id);
        log(db, "failed", "No enabled SMTP account is available within its daily limit.", id, target.email);
        const updated = db.prepare("SELECT sent_count, failed_count, status FROM campaigns WHERE id = ?").get(id) as Pick<CampaignRow, "sent_count" | "failed_count" | "status">;
        emitProgress(getWindow, { campaignId: id, sent: updated.sent_count, failed: updated.failed_count, total, status: updated.status });
        continue;
      }
      const account = eligible[accountCursor++ % eligible.length]!;
      const waitMs = Math.max(0, minInterval - (Date.now() - lastSentAt));
      if (waitMs > 0) await sleep(waitMs);
      const subject = renderTokens(template.subject, target, false);
      const html = renderTokens(template.html, target, true);
      const text = renderTokens(template.text || template.html.replace(/<[^>]*>/g, " "), target, false);
      const transporter = nodemailer.createTransport(smtpConfig(account));
      try {
        await transporter.sendMail({
          from: `"${account.name.replace(/"/g, "")}" <${account.username}>`,
          to: target.email,
          subject,
          html: html || undefined,
          text: text || undefined
        });
        lastSentAt = Date.now();
        db.prepare("UPDATE campaign_recipients SET status = 'sent' WHERE campaign_id = ? AND email = ?").run(id, target.email);
        db.prepare("UPDATE campaigns SET sent_count = sent_count + 1 WHERE id = ?").run(id);
        db.prepare("UPDATE smtp_accounts SET sent_count = sent_count + 1 WHERE id = ?").run(account.id);
        db.prepare(`
          INSERT INTO smtp_usage (account_id, usage_date, sent_count) VALUES (?, ?, 1)
          ON CONFLICT(account_id, usage_date) DO UPDATE SET sent_count = sent_count + 1
        `).run(account.id, date);
        log(db, "success", "Message accepted by SMTP server.", id, target.email, account.id);
      } catch (error) {
        const message = error instanceof Error ? error.message : "SMTP delivery failed.";
        db.prepare("UPDATE campaign_recipients SET status = 'failed' WHERE campaign_id = ? AND email = ?").run(id, target.email);
        db.prepare("UPDATE campaigns SET failed_count = failed_count + 1 WHERE id = ?").run(id);
        db.prepare("UPDATE smtp_accounts SET fail_count = fail_count + 1 WHERE id = ?").run(account.id);
        log(db, "failed", message.slice(0, 500), id, target.email, account.id);
      } finally {
        transporter.close();
      }
      const updated = db.prepare("SELECT sent_count, failed_count, status FROM campaigns WHERE id = ?").get(id) as Pick<CampaignRow, "sent_count" | "failed_count" | "status">;
      emitProgress(getWindow, { campaignId: id, sent: updated.sent_count, failed: updated.failed_count, total, status: updated.status });
    }
    activeCampaigns.delete(id);
    const final = db.prepare("SELECT sent_count, failed_count, status FROM campaigns WHERE id = ?").get(id) as Pick<CampaignRow, "sent_count" | "failed_count" | "status"> | undefined;
    if (final) emitProgress(getWindow, { campaignId: id, sent: final.sent_count, failed: final.failed_count, total, status: final.status });
  })().catch((error: unknown) => {
    activeCampaigns.delete(id);
    const message = error instanceof Error ? error.message : "Campaign stopped due to an internal error.";
    db.prepare("UPDATE campaigns SET status = 'stopped' WHERE id = ?").run(id);
    log(db, "failed", message.slice(0, 500), id);
    emitProgress(getWindow, { campaignId: id, sent: 0, failed: 0, total: 0, status: "stopped" });
  });
}

function toRecipient(row: RecipientRow): Recipient {
  return {
    email: row.email,
    name: row.name ?? undefined,
    firstName: row.first_name ?? undefined,
    lastName: row.last_name ?? undefined,
    optedIn: row.opted_in === 1,
    fields: JSON.parse(row.fields_json) as Record<string, string>
  };
}

function createImapClient(account: ImapRow): ImapFlow {
  return new ImapFlow({
    host: account.host,
    port: account.port,
    secure: account.encryption === "ssl" || account.encryption === "tls",
    auth: { user: account.username, pass: decrypt(account.encrypted_password) },
    tls: { checkServerIdentity: () => undefined },
    connectionTimeout: 10000,
    greetingTimeout: 8000,
    socketTimeout: 20000,
    logger: false
  });
}

async function discoverImapAccount(db: Database.Database, account: SmtpRow): Promise<{ status: "connected" | "skipped" | "failed"; email: string; message?: string }> {
  const existing = db.prepare("SELECT id FROM imap_accounts WHERE lower(username) = lower(?) LIMIT 1").get(account.username) as { id: number } | undefined;
  if (existing) return { status: "skipped", email: account.username };

  const usernameDomain = account.username.includes("@") ? account.username.split("@").pop() : undefined;
  const hostCandidates = [
    account.host,
    account.host.replace(/^smtp\./i, "imap."),
    usernameDomain ? `imap.${usernameDomain}` : "",
    usernameDomain ? `mail.${usernameDomain}` : ""
  ].map(normalizeSmtpHost).filter(Boolean);
  type Candidate = { host: string; port: number; secure: boolean; encryption: "ssl" | "starttls" };
  const candidateMap = new Map<string, Candidate>();
  for (const host of hostCandidates) {
    candidateMap.set(`${host}:993`, { host, port: 993, secure: true, encryption: "ssl" });
    candidateMap.set(`${host}:143`, { host, port: 143, secure: false, encryption: "starttls" });
  }
  const candidates = [...candidateMap.values()];
  const password = decrypt(account.encrypted_password);
  let lastError = "No compatible IMAP endpoint was found.";

  for (const candidate of candidates) {
    const client = new ImapFlow({
      host: candidate.host,
      port: candidate.port,
      secure: candidate.secure,
      doSTARTTLS: candidate.secure ? undefined : true,
      auth: { user: account.username, pass: password },
      tls: { checkServerIdentity: () => undefined },
      connectionTimeout: 8000,
      greetingTimeout: 6000,
      socketTimeout: 12000,
      logger: false
    });
    try {
      await client.connect();
      await client.status("INBOX", { messages: true });
      db.prepare(`
        INSERT INTO imap_accounts (name, email, host, port, username, encrypted_password, encryption)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(account.name, account.username, candidate.host, candidate.port, account.username,
        encrypt(password), candidate.encryption);
      if (client.usable) await client.logout();
      return { status: "connected", email: account.username, message: `${candidate.host}:${candidate.port}` };
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    } finally {
      if (client.usable) {
        try { await client.logout(); } catch { client.close(); }
      } else client.close();
    }
  }
  return { status: "failed", email: account.username, message: lastError.slice(0, 220) };
}

export function registerIpcHandlers(getWindow: () => BrowserWindow | null): void {
  const db = getDatabase();

  ipcMain.handle("smtp:list", () => getSmtpRowsWithUsage(db));
  ipcMain.handle("smtp:choose-file", async () => {
    const result = await dialog.showOpenDialog({
      properties: ["openFile"],
      filters: [{ name: "SMTP account data", extensions: ["csv", "json", "txt"] }]
    });
    const path = result.filePaths[0];
    if (result.canceled || !path) return null;
    return { name: path.split(/[\\/]/).pop() ?? "smtp.txt", text: (await readFile(path)).toString("base64"), base64: true };
  });
  ipcMain.handle("smtp:add", (_event, input: SmtpAccountInput) => {
    const id = addSmtp(db, input);
    return getSmtpRowsWithUsage(db).find((account) => account.id === id);
  });
  ipcMain.handle("smtp:import", (_event, fileName: string, text: string, base64?: boolean, options?: SmtpImportOptions) => {
    const { accounts, errors } = parseSmtpImport(text, fileName, Boolean(base64), options);
    const insert = db.transaction((items: SmtpAccountInput[]) => items.map((item) => addSmtp(db, item)));
    return { imported: insert(accounts).length, errors };
  });
  ipcMain.handle("smtp:test", async (_event, id: number) => {
    const account = db.prepare("SELECT * FROM smtp_accounts WHERE id = ?").get(id) as SmtpRow | undefined;
    if (!account) throw new Error("SMTP account not found.");
    const transporter = nodemailer.createTransport(smtpConfig(account));
    try {
      await transporter.verify();
      log(db, "success", `Connection test passed for ${account.name}.`, null, null, id);
      return { success: true, message: "Connection successful." };
    } catch (error) {
      const message = error instanceof Error ? error.message : "SMTP connection test failed.";
      log(db, "failed", `Connection test failed for ${account.name}: ${message.slice(0, 400)}`, null, null, id);
      return { success: false, message };
    } finally {
      transporter.close();
    }
  });
  ipcMain.handle("smtp:set-enabled", (_event, id: number, enabled: boolean) => {
    db.prepare("UPDATE smtp_accounts SET enabled = ? WHERE id = ?").run(enabled ? 1 : 0, id);
  });
  ipcMain.handle("smtp:remove", (_event, id: number) => {
    db.prepare("DELETE FROM smtp_accounts WHERE id = ?").run(id);
  });

  ipcMain.handle("recipients:choose-file", async () => {
    const result = await dialog.showOpenDialog({
      properties: ["openFile"],
      filters: [{ name: "Recipient data", extensions: ["csv", "json", "txt"] }]
    });
    const path = result.filePaths[0];
    if (result.canceled || !path) return null;
    return { name: path.split(/[\\/]/).pop() ?? "import.txt", text: (await readFile(path)).toString("base64"), base64: true };
  });
  ipcMain.handle("recipients:import", (_event, input: Recipient[]) => {
    const recipients = z.array(recipientSchema).parse(input);
    const insert = db.prepare(`
      INSERT INTO recipients (email, name, first_name, last_name, opted_in, fields_json)
      VALUES (@email, @name, @firstName, @lastName, @optedIn, @fields)
      ON CONFLICT(email) DO UPDATE SET
        name = excluded.name, first_name = excluded.first_name, last_name = excluded.last_name,
        opted_in = MAX(recipients.opted_in, excluded.opted_in), fields_json = excluded.fields_json
    `);
    const transaction = db.transaction((rows: Recipient[]) => {
      for (const recipient of rows) insert.run({
        email: recipient.email.toLowerCase(), name: recipient.name ?? null,
        firstName: recipient.firstName ?? null, lastName: recipient.lastName ?? null,
        optedIn: recipient.optedIn ? 1 : 0, fields: JSON.stringify(recipient.fields)
      });
    });
    transaction(recipients);
    return recipients.length;
  });
  ipcMain.handle("recipients:list", () =>
    (db.prepare("SELECT * FROM recipients ORDER BY email").all() as RecipientRow[]).map(toRecipient));
  ipcMain.handle("recipients:set-consent", (_event, email: string, optedIn: boolean) => {
    db.prepare("UPDATE recipients SET opted_in = ? WHERE email = ?").run(optedIn ? 1 : 0, email);
  });
  ipcMain.handle("recipients:export", async (_event, recipients: Recipient[]) => {
    const result = await dialog.showSaveDialog({ defaultPath: "mailforge-recipients.csv", filters: [{ name: "CSV", extensions: ["csv"] }] });
    if (result.canceled || !result.filePath) return false;
    await writeFile(result.filePath, Papa.unparse(recipients.map((recipient) => ({
      ...recipient.fields,
      email: recipient.email, name: recipient.name ?? "", first_name: recipient.firstName ?? "",
      last_name: recipient.lastName ?? "", opted_in: recipient.optedIn ? "yes" : "no"
    }))), "utf8");
    return true;
  });

  ipcMain.handle("templates:list", () => db.prepare("SELECT * FROM templates ORDER BY updated_at DESC").all().map((row) => {
    const template = row as TemplateRow;
    return { id: template.id, name: template.name, subject: template.subject, html: template.html, text: template.text, updatedAt: template.updated_at };
  }));
  ipcMain.handle("templates:save", (_event, input) => {
    const template = templateSchema.parse(input);
    if (template.id) {
      db.prepare("UPDATE templates SET name = ?, subject = ?, html = ?, text = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
        .run(template.name, template.subject, template.html, template.text, template.id);
      return { ...template, updatedAt: new Date().toISOString() };
    }
    const result = db.prepare("INSERT INTO templates (name, subject, html, text) VALUES (?, ?, ?, ?)")
      .run(template.name, template.subject, template.html, template.text);
    return { ...template, id: Number(result.lastInsertRowid), updatedAt: new Date().toISOString() };
  });
  ipcMain.handle("templates:remove", (_event, id: number) => {
    db.prepare("DELETE FROM templates WHERE id = ?").run(id);
  });

  ipcMain.handle("campaigns:list", () => (db.prepare("SELECT * FROM campaigns ORDER BY created_at DESC").all() as CampaignRow[]).map(asCampaign));
  ipcMain.handle("campaigns:create", (_event, input: CampaignInput) => {
    const campaignInput = campaignSchema.parse(input);
    const emails = [...new Set(campaignInput.recipientEmails.map((email) => email.toLowerCase()))];
    const validCount = (db.prepare(`SELECT COUNT(*) AS count FROM recipients WHERE opted_in = 1 AND email IN (${emails.map(() => "?").join(",")})`)
      .get(...emails) as { count: number }).count;
    if (validCount !== emails.length) throw new Error("Every campaign recipient must be present in your contacts and explicitly marked as opted in.");
    if (!db.prepare("SELECT id FROM templates WHERE id = ?").get(campaignInput.templateId)) throw new Error("Campaign template not found.");
    if (!getSmtpRows(db).some((account) => account.enabled === 1)) throw new Error("Add and enable an SMTP account before creating a campaign.");
    const date = campaignInput.scheduledAt ? new Date(campaignInput.scheduledAt) : null;
    if (date && Number.isNaN(date.getTime())) throw new Error("The campaign schedule is invalid.");
    const status: Campaign["status"] = date && date.getTime() > Date.now() ? "scheduled" : "draft";
    const result = db.prepare(`
      INSERT INTO campaigns (name, template_id, status, scheduled_at, timezone, rate_per_minute) VALUES (?, ?, ?, ?, ?, ?)
    `).run(campaignInput.name, campaignInput.templateId, status, date?.toISOString() ?? null,
      campaignInput.timezone ?? null, campaignInput.ratePerMinute);
    const id = Number(result.lastInsertRowid);
    const insertRecipient = db.prepare("INSERT INTO campaign_recipients (campaign_id, email) VALUES (?, ?)");
    db.transaction(() => emails.forEach((email) => insertRecipient.run(id, email)))();
    log(db, "info", `Campaign created with ${emails.length} opted-in recipients at ${campaignInput.ratePerMinute} messages per minute.`, id);
    if (status === "scheduled" && date) {
      scheduleCampaign(db, id, date.getTime(), getWindow);
    }
    return asCampaign(db.prepare("SELECT * FROM campaigns WHERE id = ?").get(id) as CampaignRow);
  });
  ipcMain.handle("campaigns:control", (_event, id: number, action: "pause" | "resume" | "stop") => {
    const campaign = db.prepare("SELECT status FROM campaigns WHERE id = ?").get(id) as { status: Campaign["status"] } | undefined;
    if (!campaign) throw new Error("Campaign not found.");
    if (action === "pause") db.prepare("UPDATE campaigns SET status = 'paused' WHERE id = ?").run(id);
    if (action === "stop") {
      const active = activeCampaigns.get(id);
      if (active?.timer) clearTimeout(active.timer);
      activeCampaigns.delete(id);
      db.prepare("UPDATE campaigns SET status = 'stopped' WHERE id = ?").run(id);
    }
    if (action === "resume") {
      if (campaign.status === "scheduled") return;
      db.prepare("UPDATE campaigns SET status = 'running' WHERE id = ?").run(id);
      startCampaign(db, id, getWindow);
    }
  });

  ipcMain.handle("compose:send", async (_event, input: ComposeInput) => {
    const data = z.object({
      accountId: z.number().int().positive(), to: z.string().email(), subject: z.string().min(1),
      text: z.string(), html: z.string().optional(), attachmentIds: z.array(z.string()).default([])
    }).parse(input);
    const account = db.prepare("SELECT * FROM smtp_accounts WHERE id = ? AND enabled = 1").get(data.accountId) as SmtpRow | undefined;
    if (!account) throw new Error("Select an enabled SMTP account.");
    const transporter = nodemailer.createTransport(smtpConfig(account));
    try {
      await transporter.sendMail({
        from: `"${account.name.replace(/"/g, "")}" <${account.username}>`,
        to: data.to, subject: data.subject, text: data.text, html: data.html || undefined,
        attachments: data.attachmentIds.map((id) => {
          const item = pendingAttachments.get(id);
          if (!item) throw new Error("An attachment is no longer available. Please select it again.");
          return { filename: item.name, path: item.path };
        })
      });
      data.attachmentIds.forEach((id) => pendingAttachments.delete(id));
      log(db, "success", "Message sent from the email composer.", null, data.to, account.id);
    } finally {
      transporter.close();
    }
  });
  ipcMain.handle("compose:choose-attachments", async () => {
    const result = await dialog.showOpenDialog({ properties: ["openFile", "multiSelections"] });
    if (result.canceled) return [];
    const metadata = await Promise.all(result.filePaths.map(async (path) => {
      const fileStats = await stat(path);
      return { path, size: fileStats.size, name: path.split(/[\\/]/).pop() ?? "attachment" };
    }));
    if (metadata.some((item) => item.size > 25 * 1024 * 1024)) throw new Error("Attachments must be 25 MB or smaller.");
    const selectedBytes = metadata.reduce((total, item) => total + item.size, 0);
    const activeSizes = await Promise.all([...pendingAttachments.values()].map(async (item) => (await stat(item.path)).size));
    const pendingBytes = activeSizes.reduce((total, size) => total + size, selectedBytes);
    if (pendingBytes > 25 * 1024 * 1024) throw new Error("The combined attachment size cannot exceed 25 MB.");
    const attachments = [];
    for (const item of metadata) {
      const id = randomUUID();
      pendingAttachments.set(id, { path: item.path, name: item.name });
      attachments.push({ id, name: item.name, size: item.size });
    }
    return attachments;
  });
  ipcMain.handle("compose:release-attachment", (_event, id: string) => {
    pendingAttachments.delete(id);
  });

  ipcMain.handle("imap:add", (_event, input: ImapAccountInput) => {
    const account = imapSchema.parse(input);
    db.prepare(`
      INSERT INTO imap_accounts (name, email, host, port, username, encrypted_password, encryption)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(account.name, account.email, account.host, account.port, account.username, encrypt(account.password), account.encryption);
  });
  ipcMain.handle("imap:list", () => db.prepare("SELECT id, name, email, host FROM imap_accounts ORDER BY id DESC").all());
  ipcMain.handle("imap:discover-from-smtp", async () => {
    const smtpAccounts = getSmtpRows(db);
    const results: Array<Awaited<ReturnType<typeof discoverImapAccount>>> = [];
    let cursor = 0;
    const workers = Array.from({ length: Math.min(4, smtpAccounts.length) }, async () => {
      while (cursor < smtpAccounts.length) {
        const account = smtpAccounts[cursor++];
        if (account) results.push(await discoverImapAccount(db, account));
      }
    });
    await Promise.all(workers);
    return {
      connected: results.filter((result) => result.status === "connected").length,
      skipped: results.filter((result) => result.status === "skipped").length,
      failures: results.filter((result) => result.status === "failed").map((result) => ({ email: result.email, message: result.message ?? "Connection failed" }))
    };
  });
  ipcMain.handle("imap:remove", (_event, id: number) => db.prepare("DELETE FROM imap_accounts WHERE id = ?").run(id));
  ipcMain.handle("imap:folders", async (_event, accountId: number) => {
    const account = db.prepare("SELECT * FROM imap_accounts WHERE id = ?").get(accountId) as ImapRow | undefined;
    if (!account) throw new Error("IMAP account not found.");
    const client = createImapClient(account);
    try {
      await client.connect();
      const folders = await client.list();
      return folders.map((folder) => ({ path: folder.path, name: folder.name, specialUse: folder.specialUse ?? undefined }));
    } finally {
      if (client.usable) await client.logout();
    }
  });
  ipcMain.handle("imap:messages", async (_event, accountId: number, folder: string) => {
    const account = db.prepare("SELECT * FROM imap_accounts WHERE id = ?").get(accountId) as ImapRow | undefined;
    if (!account) throw new Error("IMAP account not found.");
    const client = createImapClient(account);
    const messages: MailMessage[] = [];
    try {
      await client.connect();
      const mailbox = await client.mailboxOpen(folder);
      const firstUid = Math.max(1, (mailbox.uidNext ?? 1) - 100);
      for await (const message of client.fetch(`${firstUid}:*`, { uid: true, source: true, flags: true }, { uid: true })) {
        if (!message.source) continue;
        const parsed = await simpleParser(message.source);
        messages.push({
          uid: message.uid,
          subject: parsed.subject ?? "(no subject)",
          from: parsed.from?.text ?? "",
          date: parsed.date?.toISOString() ?? "",
          text: parsed.text ?? "",
          html: typeof parsed.html === "string" ? parsed.html : "",
          seen: message.flags?.has("\\Seen") ?? false,
          messageId: parsed.messageId ?? "",
          attachments: parsed.attachments.map((attachment) => ({
            filename: attachment.filename ?? "attachment",
            size: attachment.size,
            contentType: attachment.contentType
          }))
        });
      }
      return messages.sort((a, b) => b.uid - a.uid);
    } finally {
      if (client.usable) await client.logout();
    }
  });
  ipcMain.handle("imap:delete", async (_event, accountId: number, folder: string, uid: number) => {
    const account = db.prepare("SELECT * FROM imap_accounts WHERE id = ?").get(accountId) as ImapRow | undefined;
    if (!account) throw new Error("IMAP account not found.");
    const client = createImapClient(account);
    try {
      await client.connect();
      await client.mailboxOpen(folder);
      await client.messageDelete(String(uid), { uid: true });
    } finally {
      if (client.usable) await client.logout();
    }
  });
  ipcMain.handle("imap:download-attachment", async (_event, accountId: number, folder: string, uid: number, attachmentIndex: number) => {
    const account = db.prepare("SELECT * FROM imap_accounts WHERE id = ?").get(accountId) as ImapRow | undefined;
    if (!account) throw new Error("IMAP account not found.");
    const client = createImapClient(account);
    try {
      await client.connect();
      await client.mailboxOpen(folder);
      const message = await client.fetchOne(String(uid), { uid: true, source: true }, { uid: true });
      if (message === false || !message.source) throw new Error("Message source is no longer available.");
      const parsed = await simpleParser(message.source);
      const attachment = parsed.attachments[attachmentIndex];
      if (!attachment) throw new Error("Attachment not found.");
      const result = await dialog.showSaveDialog({ defaultPath: attachment.filename ?? "attachment" });
      if (result.canceled || !result.filePath) return false;
      await writeFile(result.filePath, attachment.content);
      return true;
    } finally {
      if (client.usable) await client.logout();
    }
  });

  ipcMain.handle("logs:list", () => db.prepare("SELECT * FROM mail_logs ORDER BY created_at DESC LIMIT 1000").all().map((row) => {
    const item = row as { id: number; campaign_id: number | null; recipient: string | null; account_id: number | null; status: MailLog["status"]; message: string; created_at: string };
    return { id: item.id, campaignId: item.campaign_id, recipient: item.recipient, accountId: item.account_id, status: item.status, message: item.message, createdAt: item.created_at };
  }));
  ipcMain.handle("logs:export", async () => {
    const result = await dialog.showSaveDialog({ defaultPath: "mailforge-log.csv", filters: [{ name: "CSV", extensions: ["csv"] }] });
    if (result.canceled || !result.filePath) return false;
    const rows = db.prepare("SELECT * FROM mail_logs ORDER BY created_at DESC").all();
    await writeFile(result.filePath, Papa.unparse(rows), "utf8");
    return true;
  });

  ipcMain.handle("settings:theme", () => {
    const setting = db.prepare("SELECT value FROM settings WHERE key = 'theme'").get() as { value: "light" | "dark" } | undefined;
    return setting?.value ?? "dark";
  });
  ipcMain.handle("settings:set-theme", (_event, theme: "light" | "dark") => {
    db.prepare("INSERT INTO settings (key, value) VALUES ('theme', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(theme);
  });

  for (const campaign of db.prepare("SELECT id, status, scheduled_at FROM campaigns WHERE status IN ('running', 'scheduled')").all() as Array<{ id: number; status: string; scheduled_at: string | null }>) {
    if (campaign.status === "running") {
      db.prepare("UPDATE campaigns SET status = 'paused' WHERE id = ?").run(campaign.id);
    } else if (campaign.scheduled_at) {
      const remaining = Date.parse(campaign.scheduled_at) - Date.now();
      if (remaining <= 0) startCampaign(db, campaign.id, getWindow);
      else scheduleCampaign(db, campaign.id, Date.parse(campaign.scheduled_at), getWindow);
    }
  }
}
