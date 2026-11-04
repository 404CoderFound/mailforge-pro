import Database from "better-sqlite3";
import { app } from "electron";
import { join } from "node:path";

let database: Database.Database;

export function getDatabase(): Database.Database {
  if (!database) {
    database = new Database(join(app.getPath("userData"), "mailforge.sqlite"));
    database.pragma("journal_mode = WAL");
    database.pragma("foreign_keys = ON");
    database.exec(`
      CREATE TABLE IF NOT EXISTS smtp_accounts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        host TEXT NOT NULL,
        port INTEGER NOT NULL,
        username TEXT NOT NULL,
        encrypted_password TEXT NOT NULL,
        encryption TEXT NOT NULL,
        daily_limit INTEGER NOT NULL DEFAULT 100,
        enabled INTEGER NOT NULL DEFAULT 1,
        sent_count INTEGER NOT NULL DEFAULT 0,
        fail_count INTEGER NOT NULL DEFAULT 0,
        notes TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS imap_accounts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        email TEXT NOT NULL,
        host TEXT NOT NULL,
        port INTEGER NOT NULL,
        username TEXT NOT NULL,
        encrypted_password TEXT NOT NULL,
        encryption TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS templates (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        subject TEXT NOT NULL,
        html TEXT NOT NULL DEFAULT '',
        text TEXT NOT NULL DEFAULT '',
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS recipients (
        email TEXT PRIMARY KEY COLLATE NOCASE,
        name TEXT,
        first_name TEXT,
        last_name TEXT,
        opted_in INTEGER NOT NULL DEFAULT 0,
        fields_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS campaigns (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        template_id INTEGER NOT NULL REFERENCES templates(id),
        status TEXT NOT NULL DEFAULT 'draft',
        scheduled_at TEXT,
        timezone TEXT,
        sent_count INTEGER NOT NULL DEFAULT 0,
        failed_count INTEGER NOT NULL DEFAULT 0,
        rate_per_minute INTEGER NOT NULL DEFAULT 10,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS campaign_recipients (
        campaign_id INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
        email TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        PRIMARY KEY (campaign_id, email)
      );
      CREATE TABLE IF NOT EXISTS mail_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        campaign_id INTEGER,
        recipient TEXT,
        account_id INTEGER,
        status TEXT NOT NULL,
        message TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS smtp_usage (
        account_id INTEGER NOT NULL REFERENCES smtp_accounts(id) ON DELETE CASCADE,
        usage_date TEXT NOT NULL,
        sent_count INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (account_id, usage_date)
      );
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);
    database.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES ('theme', 'dark')").run();
  }
  return database;
}

export function closeDatabase(): void {
  database?.close();
}
