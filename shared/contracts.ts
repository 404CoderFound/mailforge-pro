export type Encryption = "none" | "ssl" | "tls" | "starttls";

export interface SmtpAccount {
  id: number;
  name: string;
  host: string;
  port: number;
  username: string;
  encryption: Encryption;
  dailyLimit: number;
  enabled: boolean;
  sentToday: number;
  successCount: number;
  failCount: number;
}

export interface SmtpAccountInput {
  name?: string;
  host: string;
  port: number;
  username: string;
  password: string;
  encryption: Encryption;
  dailyLimit?: number;
  notes?: string;
  proxy?: string;
}

export interface SmtpImportOptions {
  parserMode: "auto" | "template";
  customFormat: string;
  recordMode: "line" | "blank-line" | "fixed-lines";
  recordLineCount: number;
  encoding: "utf-8" | "windows-1252" | "iso-8859-1";
  skipRows: number;
  commentPrefix: string;
  defaultEncryption: Encryption;
  defaultDailyLimit: number;
}

export interface Recipient {
  email: string;
  name?: string;
  firstName?: string;
  lastName?: string;
  optedIn: boolean;
  fields: Record<string, string>;
}

export interface ImportStats {
  totalRows: number;
  validEmails: number;
  duplicatesRemoved: number;
  invalidRows: number;
  filteredRows: number;
}

export interface RecipientImportResult {
  recipients: Recipient[];
  stats: ImportStats;
}

export interface MailTemplate {
  id: number;
  name: string;
  subject: string;
  html: string;
  text: string;
  updatedAt: string;
}

export interface Campaign {
  id: number;
  name: string;
  templateId: number;
  status: "draft" | "scheduled" | "running" | "paused" | "stopped" | "completed";
  sent: number;
  failed: number;
  createdAt: string;
}

export interface MailLog {
  id: number;
  campaignId: number | null;
  recipient: string | null;
  accountId: number | null;
  status: "success" | "failed" | "info";
  message: string;
  createdAt: string;
}

export interface ImapAccountInput {
  name: string;
  email: string;
  host: string;
  port: number;
  username: string;
  password: string;
  encryption: Encryption;
}

export interface MailFolder {
  path: string;
  name: string;
  specialUse?: string;
}

export interface MailMessage {
  uid: number;
  subject: string;
  from: string;
  date: string;
  text: string;
  html: string;
  seen: boolean;
  messageId: string;
  attachments: Array<{ filename: string; size: number; contentType: string }>;
}

export interface AttachmentChoice {
  id: string;
  name: string;
  size: number;
}

export interface ImportTextOptions {
  parserMode?: "standard" | "template";
  customFormat?: string;
  recordMode?: "line" | "blank-line" | "fixed-lines";
  recordLineCount?: number;
  delimiter: "auto" | "," | ";" | "\t" | "|" | " " | "custom";
  customDelimiter?: string;
  emailMode: "auto" | "line" | "name-angle" | "email-name" | "name-email" | "free-text";
  headerMode?: "auto" | "first-row" | "none";
  skipRows?: number;
  commentPrefix?: string;
  columnNames?: string[];
  maxRows?: number;
  trim: boolean;
  removeDuplicates: boolean;
  lowercase: boolean;
  strictValidation: boolean;
  encoding: "utf-8" | "windows-1252" | "iso-8859-1";
  customDelimiterEnabled?: boolean;
  emailColumn?: string;
  nameColumn?: string;
  firstNameColumn?: string;
  lastNameColumn?: string;
  consentColumn?: string;
  consentTrueValues?: string;
  includedColumns?: string[];
  columnAliases?: Record<string, string>;
  rowFilterColumn?: string;
  rowFilterOperator?: "contains" | "equals" | "starts-with" | "not-empty";
  rowFilterValue?: string;
}

export interface ChosenFile {
  name: string;
  text: string;
  base64: boolean;
}

export interface ImportPreview {
  headers: string[];
  rows: Array<Record<string, string>>;
  recipients: Recipient[];
  stats: ImportStats;
}

export interface CampaignInput {
  name: string;
  templateId: number;
  recipientEmails: string[];
  ratePerMinute: number;
  scheduledAt?: string;
  timezone?: string;
}

export interface ComposeInput {
  accountId: number;
  to: string;
  subject: string;
  text: string;
  html?: string;
  attachmentIds: string[];
}

export interface CampaignProgress {
  campaignId: number;
  sent: number;
  failed: number;
  total: number;
  status: Campaign["status"];
}

export interface DesktopApi {
  smtp: {
    list: () => Promise<SmtpAccount[]>;
    chooseFile: () => Promise<ChosenFile | null>;
    import: (fileName: string, text: string, base64?: boolean, options?: SmtpImportOptions) => Promise<{ imported: number; errors: string[] }>;
    add: (input: SmtpAccountInput) => Promise<SmtpAccount>;
    test: (id: number) => Promise<{ success: boolean; message: string }>;
    setEnabled: (id: number, enabled: boolean) => Promise<void>;
    remove: (id: number) => Promise<void>;
  };
  recipients: {
    import: (recipients: Recipient[]) => Promise<number>;
    list: () => Promise<Recipient[]>;
    setConsent: (email: string, optedIn: boolean) => Promise<void>;
    exportCsv: (recipients: Recipient[]) => Promise<boolean>;
    chooseFile: () => Promise<ChosenFile | null>;
  };
  templates: {
    list: () => Promise<MailTemplate[]>;
    save: (template: Pick<MailTemplate, "id" | "name" | "subject" | "html" | "text">) => Promise<MailTemplate>;
    remove: (id: number) => Promise<void>;
  };
  campaigns: {
    list: () => Promise<Campaign[]>;
    create: (input: CampaignInput) => Promise<Campaign>;
    control: (id: number, action: "pause" | "resume" | "stop") => Promise<void>;
    onProgress: (callback: (progress: CampaignProgress) => void) => () => void;
  };
  compose: {
    chooseAttachments: () => Promise<AttachmentChoice[]>;
    releaseAttachment: (id: string) => Promise<void>;
    send: (input: ComposeInput) => Promise<void>;
  };
  imap: {
    add: (input: ImapAccountInput) => Promise<void>;
    listAccounts: () => Promise<Array<Pick<ImapAccountInput, "name" | "email" | "host"> & { id: number }>>;
    discoverFromSmtp: () => Promise<{ connected: number; skipped: number; failures: Array<{ email: string; message: string }> }>;
    folders: (accountId: number) => Promise<MailFolder[]>;
    messages: (accountId: number, folder: string) => Promise<MailMessage[]>;
    deleteMessage: (accountId: number, folder: string, uid: number) => Promise<void>;
    downloadAttachment: (accountId: number, folder: string, uid: number, attachmentIndex: number) => Promise<boolean>;
    delete: (accountId: number) => Promise<void>;
  };
  logs: {
    list: () => Promise<MailLog[]>;
    export: () => Promise<boolean>;
  };
  settings: {
    theme: () => Promise<"light" | "dark">;
    setTheme: (theme: "light" | "dark") => Promise<void>;
  };
}

declare global {
  interface Window {
    mailforge: DesktopApi;
  }
}
