import { useEffect, useMemo, useState } from "react";
import {
  Activity, Archive, ArrowDownToLine, ArrowLeft, ArrowRight, BarChart3, Check, ChevronDown,
  ChevronRight, CircleHelp, Clock3, FileText, Inbox, Layers3, Mail, MailPlus, Moon, MoreHorizontal,
  Paperclip, Pause, Play, Plus, Search, Send, Settings2, ShieldCheck, Sun, Trash2, Upload, Users, X
} from "lucide-react";
import type {
  AttachmentChoice, Campaign, CampaignProgress, ImportPreview, ImportTextOptions, MailFolder, MailLog, MailMessage,
  MailTemplate, Recipient, SmtpAccount, SmtpAccountInput, SmtpImportOptions
} from "../shared/contracts";
import { parseRecipients, parseSmtpImport } from "../shared/importer";

type PageId = "overview" | "inbox" | "smtp" | "recipients" | "templates" | "campaigns" | "activity" | "settings";
type Notice = { kind: "success" | "error" | "info"; text: string };
const navItems: Array<{ id: PageId; label: string; icon: typeof Inbox; group: string }> = [
  { id: "overview", label: "Overview", icon: BarChart3, group: "Workspace" },
  { id: "inbox", label: "Mailbox", icon: Inbox, group: "Workspace" },
  { id: "smtp", label: "SMTP accounts", icon: Send, group: "Manage" },
  { id: "recipients", label: "Recipients", icon: Users, group: "Manage" },
  { id: "templates", label: "Templates", icon: FileText, group: "Manage" },
  { id: "campaigns", label: "Campaigns", icon: Layers3, group: "Send" },
  { id: "activity", label: "Activity log", icon: Activity, group: "Send" },
  { id: "settings", label: "Settings", icon: Settings2, group: "Other" }
];

function App() {
  const [page, setPage] = useState<PageId>("overview");
  const [theme, setTheme] = useState<"light" | "dark">("dark");
  const [smtpAccounts, setSmtpAccounts] = useState<SmtpAccount[]>([]);
  const [recipients, setRecipients] = useState<Recipient[]>([]);
  const [templates, setTemplates] = useState<MailTemplate[]>([]);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [logs, setLogs] = useState<MailLog[]>([]);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = async () => {
    const [smtp, contacts, savedTemplates, savedCampaigns, recentLogs] = await Promise.all([
      window.mailforge.smtp.list(),
      window.mailforge.recipients.list(),
      window.mailforge.templates.list(),
      window.mailforge.campaigns.list(),
      window.mailforge.logs.list()
    ]);
    setSmtpAccounts(smtp);
    setRecipients(contacts);
    setTemplates(savedTemplates);
    setCampaigns(savedCampaigns);
    setLogs(recentLogs);
  };

  useEffect(() => {
    void Promise.all([refresh(), window.mailforge.settings.theme()])
      .then(([, currentTheme]) => setTheme(currentTheme))
      .catch((error: unknown) => setNotice({ kind: "error", text: errorMessage(error) }))
      .finally(() => setLoading(false));
    const off = window.mailforge.campaigns.onProgress((progress: CampaignProgress) => {
      setCampaigns((current) => current.map((campaign) => campaign.id === progress.campaignId
        ? { ...campaign, sent: progress.sent, failed: progress.failed, status: progress.status }
        : campaign));
    });
    return off;
  }, []);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 4200);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const toggleTheme = async () => {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    document.documentElement.dataset.theme = next;
    try {
      await window.mailforge.settings.setTheme(next);
    } catch (error) {
      setNotice({ kind: "error", text: errorMessage(error) });
    }
  };

  const pageTitle = navItems.find((item) => item.id === page)?.label ?? "Overview";
  const content = useMemo(() => {
    const props = { notify: setNotice, refresh };
    switch (page) {
      case "overview": return <Overview smtp={smtpAccounts} recipients={recipients} templates={templates} campaigns={campaigns} logs={logs} go={setPage} />;
      case "smtp": return <SmtpPage accounts={smtpAccounts} {...props} />;
      case "recipients": return <RecipientsPage recipients={recipients} {...props} />;
      case "templates": return <TemplatesPage templates={templates} {...props} />;
      case "campaigns": return <CampaignsPage campaigns={campaigns} recipients={recipients} templates={templates} {...props} />;
      case "inbox": return <MailboxPage smtp={smtpAccounts} notify={setNotice} />;
      case "activity": return <ActivityPage logs={logs} refresh={refresh} notify={setNotice} />;
      case "settings": return <SettingsPage smtpCount={smtpAccounts.length} recipientCount={recipients.length} theme={theme} toggleTheme={toggleTheme} />;
    }
  }, [page, smtpAccounts, recipients, templates, campaigns, logs, theme]);

  return (
    <div className="app-shell" data-theme={theme}>
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark"><Mail size={20} strokeWidth={2.2} /></div>
          <span>mailforge<span className="brand-pro"> PRO</span></span>
        </div>
        <button className="workspace-switcher">
          <div className="workspace-avatar">M</div>
          <span><strong>My workspace</strong><small>Personal account</small></span>
          <ChevronDown size={15} className="muted" />
        </button>
        <nav className="sidebar-nav">
          {["Workspace", "Manage", "Send", "Other"].map((group) => (
            <div className="nav-group" key={group}>
              <div className="nav-caption">{group}</div>
              {navItems.filter((item) => item.group === group).map(({ id, label, icon: Icon }) => (
                <button key={id} onClick={() => setPage(id)} className={`nav-item ${page === id ? "active" : ""}`}>
                  <Icon size={17} strokeWidth={1.8} /><span>{label}</span>
                  {id === "campaigns" && campaigns.some((campaign) => campaign.status === "running") && <i className="live-dot" />}
                </button>
              ))}
            </div>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="plan-card">
            <div className="plan-icon"><ShieldCheck size={16} /></div>
            <div><strong>Local & secure</strong><small>Your data stays on this device</small></div>
          </div>
          <button className="profile-button">
            <div className="profile-avatar">MF</div>
            <span><strong>MailForge user</strong><small>Local profile</small></span>
            <MoreHorizontal size={17} />
          </button>
        </div>
      </aside>

      <main className="main-panel">
        <header className="topbar">
          <div className="breadcrumbs"><span>MailForge</span><ChevronRight size={14} /><strong>{pageTitle}</strong></div>
          <div className="topbar-actions">
            <div className="secure-label"><span className="secure-dot" /> All data stored locally</div>
            <button className="icon-button" title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"} onClick={toggleTheme}>
              {theme === "dark" ? <Sun size={17} /> : <Moon size={17} />}
            </button>
            <button className="help-button"><CircleHelp size={16} /> Help</button>
          </div>
        </header>
        <section className="page-content">
          {loading ? <div className="loading-state"><div className="spinner" />Loading your workspace…</div> : content}
        </section>
      </main>
      {notice && <div className={`toast toast-${notice.kind}`}><span className="toast-indicator" />{notice.text}<button onClick={() => setNotice(null)}><X size={15} /></button></div>}
    </div>
  );
}

function Overview({ smtp, recipients, templates, campaigns, logs, go }: {
  smtp: SmtpAccount[]; recipients: Recipient[]; templates: MailTemplate[]; campaigns: Campaign[]; logs: MailLog[]; go: (page: PageId) => void;
}) {
  const sent = campaigns.reduce((total, campaign) => total + campaign.sent, 0);
  const running = campaigns.filter((campaign) => campaign.status === "running").length;
  const currentDate = new Intl.DateTimeFormat("en", { weekday: "long", month: "long", day: "numeric" }).format(new Date());
  return (
    <div className="page-stack">
      <div className="welcome-row">
        <div><div className="eyebrow">{currentDate}</div><h1>Good afternoon <span className="wave">✦</span></h1><p>Here’s what’s happening across your email workspace.</p></div>
        <button className="button button-primary" onClick={() => go("campaigns")}><Plus size={16} /> New campaign</button>
      </div>
      <div className="stats-grid">
        <StatCard label="SMTP accounts" value={smtp.length} icon={<Send size={17} />} detail={`${smtp.filter((item) => item.enabled).length} active`} color="blue" />
        <StatCard label="Recipients" value={recipients.length.toLocaleString()} icon={<Users size={17} />} detail={`${recipients.filter((item) => item.optedIn).length} opted in`} color="purple" />
        <StatCard label="Messages sent" value={sent.toLocaleString()} icon={<Mail size={17} />} detail="Campaign total" color="green" />
        <StatCard label="Active campaigns" value={running} icon={<Activity size={17} />} detail={`${campaigns.length} total campaigns`} color="orange" />
      </div>
      <div className="overview-grid">
        <section className="panel activity-panel">
          <div className="panel-heading"><div><h2>Recent activity</h2><p>Your latest sending and account events</p></div><button className="text-button" onClick={() => go("activity")}>View log <ArrowRight size={14} /></button></div>
          {logs.length === 0 ? <EmptyState icon={<Activity size={20} />} title="No activity yet" text="Sending events and account tests will appear here." /> : (
            <div className="activity-list">{logs.slice(0, 6).map((item) => <LogRow key={item.id} item={item} />)}</div>
          )}
        </section>
        <section className="panel quick-panel">
          <div className="panel-heading"><div><h2>Quick setup</h2><p>Get your email workspace ready</p></div><span className="tiny-badge">GET STARTED</span></div>
          <div className="setup-list">
            <SetupRow done={smtp.length > 0} title="Connect an SMTP account" detail="Send messages from your address" action="Connect" onClick={() => go("smtp")} />
            <SetupRow done={recipients.length > 0} title="Import opted-in recipients" detail="Bring your contact list in" action="Import" onClick={() => go("recipients")} />
            <SetupRow done={templates.length > 0} title="Create an email template" detail="Personalize your next message" action="Create" onClick={() => go("templates")} />
          </div>
        </section>
      </div>
      <section className="panel campaign-strip">
        <div className="panel-heading"><div><h2>Campaigns</h2><p>Track delivery at a glance</p></div><button className="text-button" onClick={() => go("campaigns")}>All campaigns <ArrowRight size={14} /></button></div>
        {campaigns.length === 0 ? <div className="inline-empty"><Clock3 size={17} /> Campaigns you create will show up here.</div> :
          <div className="mini-campaign-list">{campaigns.slice(0, 3).map((campaign) => <CampaignRow key={campaign.id} campaign={campaign} />)}</div>}
      </section>
    </div>
  );
}

function StatCard({ label, value, icon, detail, color }: { label: string; value: string | number; icon: React.ReactNode; detail: string; color: string }) {
  return <div className="stat-card"><div className={`stat-icon ${color}`}>{icon}</div><div className="stat-label">{label}</div><div className="stat-value">{value}</div><div className="stat-detail">{detail}</div><div className={`stat-spark ${color}`}><span /><span /><span /><span /><span /><span /><span /></div></div>;
}

function SetupRow({ done, title, detail, action, onClick }: { done: boolean; title: string; detail: string; action: string; onClick: () => void }) {
  return <div className="setup-row"><span className={`setup-check ${done ? "done" : ""}`}>{done && <Check size={12} />}</span><div className="setup-copy"><strong>{title}</strong><small>{detail}</small></div><button className={done ? "text-button" : "button button-small"} onClick={onClick}>{done ? "Manage" : action}</button></div>;
}

function StatBadge({ status }: { status: Campaign["status"] }) {
  const labels: Record<Campaign["status"], string> = { draft: "Draft", scheduled: "Scheduled", running: "Running", paused: "Paused", stopped: "Stopped", completed: "Completed" };
  return <span className={`status-badge status-${status}`}><i />{labels[status]}</span>;
}

function CampaignRow({ campaign }: { campaign: Campaign }) {
  return <div className="campaign-row"><div className="campaign-badge"><Mail size={15} /></div><div className="campaign-name"><strong>{campaign.name}</strong><small>Created {formatDate(campaign.createdAt)}</small></div><StatBadge status={campaign.status} /><div className="campaign-result"><strong>{campaign.sent}</strong><small>sent</small></div><div className="campaign-result failed"><strong>{campaign.failed}</strong><small>failed</small></div></div>;
}

const defaultSmtpImportOptions: SmtpImportOptions = {
  parserMode: "auto",
  customFormat: "{host}|{port}|{username}|{password}|{encryption}|{name}|{daily_limit}",
  recordMode: "line",
  recordLineCount: 4,
  encoding: "utf-8",
  skipRows: 0,
  commentPrefix: "",
  defaultEncryption: "starttls",
  defaultDailyLimit: 100
};

type SmtpImportDraft = {
  fileName: string;
  text: string;
  base64: boolean;
  options: SmtpImportOptions;
  accounts: SmtpAccountInput[];
  errors: string[];
};

function SmtpPage({ accounts, notify, refresh }: { accounts: SmtpAccount[]; notify: (notice: Notice) => void; refresh: () => Promise<void> }) {
  const [showAdd, setShowAdd] = useState(false);
  const [testing, setTesting] = useState<number | null>(null);
  const [importDraft, setImportDraft] = useState<SmtpImportDraft | null>(null);
  const [importing, setImporting] = useState(false);
  const [importOptions, setImportOptions] = useState<SmtpImportOptions>(() => {
    try { return { ...defaultSmtpImportOptions, ...JSON.parse(localStorage.getItem("mailforge-smtp-import-options") ?? "{}") as Partial<SmtpImportOptions> }; }
    catch { return defaultSmtpImportOptions; }
  });
  const importFile = async () => {
    try {
      const file = await window.mailforge.smtp.chooseFile();
      if (!file) return;
      const result = parseSmtpImport(file.text, file.name, file.base64, importOptions);
      setImportDraft({ fileName: file.name, text: file.text, base64: file.base64, options: importOptions, ...result });
    } catch (error) { notify({ kind: "error", text: errorMessage(error) }); }
  };
  const updateImportOptions = (changes: Partial<SmtpImportOptions>) => {
    if (!importDraft) return;
    const next = { ...importDraft.options, ...changes };
    setImportOptions(next);
    localStorage.setItem("mailforge-smtp-import-options", JSON.stringify(next));
    try {
      const result = parseSmtpImport(importDraft.text, importDraft.fileName, importDraft.base64, next);
      setImportDraft({ ...importDraft, options: next, ...result });
    } catch (error) { notify({ kind: "error", text: errorMessage(error) }); }
  };
  const confirmImport = async () => {
    if (!importDraft?.accounts.length) return;
    setImporting(true);
    try {
      const result = await window.mailforge.smtp.import(importDraft.fileName, importDraft.text, importDraft.base64, importDraft.options);
      await refresh();
      notify({ kind: result.errors.length ? "info" : "success", text: `${result.imported} SMTP account(s) imported${result.errors.length ? `; ${result.errors.length} row(s) need attention` : "."}` });
      if (result.errors.length) notify({ kind: "info", text: result.errors.slice(0, 2).join("; ") });
      setImportDraft(null);
    } catch (error) { notify({ kind: "error", text: errorMessage(error) }); }
    finally { setImporting(false); }
  };
  const test = async (id: number) => {
    setTesting(id);
    try {
      const result = await window.mailforge.smtp.test(id);
      notify({ kind: result.success ? "success" : "error", text: result.message });
      await refresh();
    } catch (error) { notify({ kind: "error", text: errorMessage(error) }); }
    finally { setTesting(null); }
  };
  const toggle = async (account: SmtpAccount) => {
    try { await window.mailforge.smtp.setEnabled(account.id, !account.enabled); await refresh(); }
    catch (error) { notify({ kind: "error", text: errorMessage(error) }); }
  };
  const remove = async (account: SmtpAccount) => {
    if (!window.confirm(`Remove ${account.name}?`)) return;
    try { await window.mailforge.smtp.remove(account.id); await refresh(); notify({ kind: "success", text: "SMTP account removed." }); }
    catch (error) { notify({ kind: "error", text: errorMessage(error) }); }
  };
  return <div className="page-stack">
    <PageHeader eyebrow="DELIVERY" title="SMTP accounts" description="Manage the sending accounts connected to your workspace.">
      <button className="button button-secondary" onClick={() => void importFile()}><Upload size={15} /> Import accounts</button>
      <button className="button button-primary" onClick={() => setShowAdd(true)}><Plus size={16} /> Add account</button>
    </PageHeader>
    <div className="notice-banner"><ShieldCheck size={17} /><span>Passwords are encrypted with your operating system’s secure storage. Account rotation respects each server’s configured daily limit.</span></div>
    <div className="list-toolbar"><div className="list-count"><strong>{accounts.length}</strong> accounts <span className="dot-separator">·</span> {accounts.filter((account) => account.enabled).length} enabled</div><div className="search-field"><Search size={15} /><input placeholder="Search accounts" /></div></div>
    {accounts.length === 0 ? <EmptyPanel title="No SMTP accounts" text="Connect an account to test delivery or send your first email." action={<button className="button button-primary" onClick={() => setShowAdd(true)}><Plus size={15} /> Add SMTP account</button>} /> :
      <div className="table-card"><table><thead><tr><th>ACCOUNT</th><th>SERVER</th><th>DAILY USAGE</th><th>DELIVERY</th><th>STATUS</th><th /></tr></thead><tbody>
        {accounts.map((account) => {
          const denominator = Math.max(account.successCount + account.failCount, 1);
          const successRate = Math.round(account.successCount * 100 / denominator);
          return <tr key={account.id}><td><div className="table-identity"><div className="account-avatar">{account.name.slice(0, 1).toUpperCase()}</div><div><strong>{account.name}</strong><small>{account.username}</small></div></div></td><td><strong className="server-text">{account.host}:{account.port}</strong><small className="sub-cell">{account.encryption.toUpperCase()}</small></td><td><div className="usage-cell"><span>{account.sentToday} / {account.dailyLimit}</span><div className="progress-track"><span style={{ width: `${Math.min(100, account.sentToday / account.dailyLimit * 100)}%` }} /></div></div></td><td><div className="rate-cell"><strong>{successRate}%</strong><small>{account.successCount} success · {account.failCount} fail</small></div></td><td><button className={`toggle ${account.enabled ? "on" : ""}`} onClick={() => void toggle(account)} aria-label={account.enabled ? "Disable account" : "Enable account"}><span /></button></td><td><div className="row-actions"><button className="button button-small button-secondary" disabled={testing === account.id} onClick={() => void test(account.id)}>{testing === account.id ? "Testing…" : "Test connection"}</button><button className="icon-button subtle" onClick={() => void remove(account)} title="Remove account"><Trash2 size={15} /></button></div></td></tr>;
        })}
      </tbody></table></div>}
    {showAdd && <SmtpModal close={() => setShowAdd(false)} refresh={refresh} notify={notify} />}
    {importDraft && <SmtpImportWizard draft={importDraft} setOptions={updateImportOptions} close={() => setImportDraft(null)} importAccounts={() => void confirmImport()} importing={importing} />}
  </div>;
}

function SmtpImportWizard({ draft, setOptions, close, importAccounts, importing }: {
  draft: SmtpImportDraft;
  setOptions: (changes: Partial<SmtpImportOptions>) => void;
  close: () => void;
  importAccounts: () => void;
  importing: boolean;
}) {
  const options = draft.options;
  return <Modal title="Import SMTP accounts" subtitle={`Define how MailForge should read ${draft.fileName}`} close={close} wide>
    <div className="import-wizard-head"><div><strong>SMTP custom-format parser</strong><span>Map exact positions in your TXT file to account settings.</span></div><span className="secure-label"><span className="secure-dot" /> Passwords are masked in preview</span></div>
    <div className="import-section">
      <div className="import-section-title"><strong>1. Parsing format</strong><span>Automatic formats remain available, or define your own template</span></div>
      <div className="wizard-options format-options">
        <Field label="Parser"><select value={options.parserMode} onChange={(event) => setOptions({ parserMode: event.target.value as SmtpImportOptions["parserMode"] })}><option value="auto">Automatic detection</option><option value="template">Custom format template</option></select></Field>
        {options.parserMode === "template" && <>
          <Field label="One account is"><select value={options.recordMode} onChange={(event) => setOptions({ recordMode: event.target.value as SmtpImportOptions["recordMode"] })}><option value="line">One text line</option><option value="blank-line">A block separated by blank lines</option><option value="fixed-lines">A fixed number of lines</option></select></Field>
          {options.recordMode === "fixed-lines" && <Field label="Lines per account"><input type="number" min="1" value={options.recordLineCount} onChange={(event) => setOptions({ recordLineCount: Math.max(1, Number(event.target.value)) })} /></Field>}
          <Field label="Custom SMTP format"><textarea className="format-template-input" rows={5} value={options.customFormat} onChange={(event) => setOptions({ customFormat: event.target.value })} placeholder={'Host: {host}\nPort: {port}\nUser: {username}\nPass: {password}'} /></Field>
          <div className="format-help"><strong>Required placeholders</strong><span><code>{`{host}`}</code> <code>{`{port}`}</code> <code>{`{username}`}</code> <code>{`{password}`}</code></span><strong>Optional placeholders</strong><span><code>{`{encryption}`}</code> <code>{`{name}`}</code> <code>{`{daily_limit}`}</code> <code>{`{notes}`}</code> <code>{`{ignore}`}</code></span></div>
        </>}
        <Field label="Text encoding"><select value={options.encoding} onChange={(event) => setOptions({ encoding: event.target.value as SmtpImportOptions["encoding"] })}><option value="utf-8">UTF-8</option><option value="windows-1252">Windows-1252</option><option value="iso-8859-1">ISO-8859-1</option></select></Field>
        <Field label="Skip first rows"><input type="number" min="0" value={options.skipRows} onChange={(event) => setOptions({ skipRows: Math.max(0, Number(event.target.value)) })} /></Field>
        <Field label="Comment prefix"><input value={options.commentPrefix} onChange={(event) => setOptions({ commentPrefix: event.target.value })} placeholder="# or //" /></Field>
        <Field label="Default encryption"><select value={options.defaultEncryption} onChange={(event) => setOptions({ defaultEncryption: event.target.value as SmtpImportOptions["defaultEncryption"] })}><option value="starttls">STARTTLS</option><option value="ssl">SSL</option><option value="tls">TLS</option><option value="none">None</option></select></Field>
        <Field label="Default daily limit"><input type="number" min="1" max="5000" value={options.defaultDailyLimit} onChange={(event) => setOptions({ defaultDailyLimit: Math.max(1, Number(event.target.value)) })} /></Field>
      </div>
    </div>
    <div className="import-stats smtp-import-stats">
      <ImportStat label="Ready to import" value={draft.accounts.length} color="green" />
      <ImportStat label="Invalid records" value={draft.errors.length} color={draft.errors.length ? "orange" : "muted"} />
    </div>
    <div className="preview-title"><div><strong>Account preview</strong><small>Passwords are never displayed</small></div><span>{draft.accounts.length} valid account(s)</span></div>
    <div className="preview-table-wrap"><table className="preview-table"><thead><tr><th>NAME</th><th>HOST</th><th>PORT</th><th>USERNAME</th><th>PASSWORD</th><th>ENCRYPTION</th><th>DAILY LIMIT</th></tr></thead><tbody>
      {draft.accounts.slice(0, 50).map((account, index) => <tr key={`${account.host}-${account.username}-${index}`}><td>{account.name || account.username}</td><td>{account.host}</td><td>{account.port}</td><td>{account.username}</td><td><span className="masked-secret">••••••••</span></td><td>{account.encryption.toUpperCase()}</td><td>{account.dailyLimit ?? options.defaultDailyLimit}</td></tr>)}
    </tbody></table></div>
    {draft.errors.length > 0 && <div className="import-errors"><strong>Records needing attention</strong>{draft.errors.slice(0, 6).map((error, index) => <span key={`${error}-${index}`}>{error}</span>)}{draft.errors.length > 6 && <small>And {draft.errors.length - 6} more…</small>}</div>}
    <div className="modal-footer"><span className="remember-label"><ShieldCheck size={14} /> Credentials are encrypted when imported</span><button className="button button-secondary" onClick={close}>Cancel</button><button className="button button-primary" onClick={importAccounts} disabled={!draft.accounts.length || importing}>{importing ? "Importing…" : `Import ${draft.accounts.length} account(s)`}</button></div>
  </Modal>;
}

function SmtpModal({ close, refresh, notify }: { close: () => void; refresh: () => Promise<void>; notify: (notice: Notice) => void }) {
  const [form, setForm] = useState({ name: "", host: "", port: "587", username: "", password: "", encryption: "starttls" as const, dailyLimit: "100", notes: "" });
  const [saving, setSaving] = useState(false);
  const update = (key: keyof typeof form, value: string) => setForm((current) => ({ ...current, [key]: value }));
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);
    try {
      await window.mailforge.smtp.add({ ...form, port: Number(form.port), dailyLimit: Number(form.dailyLimit) });
      await refresh();
      notify({ kind: "success", text: "SMTP account added securely." });
      close();
    } catch (error) { notify({ kind: "error", text: errorMessage(error) }); }
    finally { setSaving(false); }
  };
  return <Modal title="Add SMTP account" subtitle="Connect a server to send and receive your email." close={close}>
    <form className="form-grid" onSubmit={(event) => void submit(event)}>
      <Field label="Account name"><input value={form.name} onChange={(event) => update("name", event.target.value)} placeholder="Work email" /></Field>
      <div className="two-fields"><Field label="SMTP host"><input value={form.host} onChange={(event) => update("host", event.target.value)} placeholder="smtp.example.com" required /></Field><Field label="Port"><input type="number" value={form.port} onChange={(event) => update("port", event.target.value)} required /></Field></div>
      <Field label="Username"><input value={form.username} onChange={(event) => update("username", event.target.value)} autoComplete="username" required /></Field>
      <Field label="Password"><input type="password" value={form.password} onChange={(event) => update("password", event.target.value)} autoComplete="new-password" required /></Field>
      <div className="two-fields"><Field label="Encryption"><select value={form.encryption} onChange={(event) => update("encryption", event.target.value)}><option value="starttls">STARTTLS</option><option value="ssl">SSL</option><option value="tls">TLS</option><option value="none">None</option></select></Field><Field label="Daily limit"><input type="number" min="1" max="5000" value={form.dailyLimit} onChange={(event) => update("dailyLimit", event.target.value)} /></Field></div>
      <Field label="Notes"><input value={form.notes} onChange={(event) => update("notes", event.target.value)} placeholder="Optional reminder" /></Field>
      <div className="form-footer"><span>Credentials are encrypted at rest.</span><button type="button" className="button button-secondary" onClick={close}>Cancel</button><button type="submit" className="button button-primary" disabled={saving}>{saving ? "Saving…" : "Add account"}</button></div>
    </form>
  </Modal>;
}

const defaultImportOptions: ImportTextOptions = {
  parserMode: "standard", customFormat: "{email}|{first_name}|{last_name}|{company}",
  recordMode: "line", recordLineCount: 2, delimiter: "auto", emailMode: "auto", trim: true, removeDuplicates: true, lowercase: true,
  strictValidation: true, encoding: "utf-8", headerMode: "auto", skipRows: 0, maxRows: 0,
  commentPrefix: "", consentTrueValues: "true, yes, y, 1, subscribed, opted in",
  rowFilterOperator: "contains"
};

function RecipientsPage({ recipients, notify, refresh }: { recipients: Recipient[]; notify: (notice: Notice) => void; refresh: () => Promise<void> }) {
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [fileName, setFileName] = useState("");
  const [fileContent, setFileContent] = useState("");
  const [fileIsBase64, setFileIsBase64] = useState(false);
  const [options, setOptions] = useState<ImportTextOptions>(() => {
    try { return { ...defaultImportOptions, ...JSON.parse(localStorage.getItem("mailforge-import-options") ?? "{}") as Partial<ImportTextOptions> }; }
    catch { return defaultImportOptions; }
  });
  const [query, setQuery] = useState("");
  const [saving, setSaving] = useState(false);
  const visibleRecipients = recipients.filter((recipient) => `${recipient.email} ${recipient.name ?? ""}`.toLowerCase().includes(query.toLowerCase()));
  const openImport = async () => {
    try {
      const file = await window.mailforge.recipients.chooseFile();
      if (!file) return;
      setFileName(file.name);
      setFileContent(file.text);
      setFileIsBase64(file.base64);
      setPreview(parseRecipients(file.text, file.name, options, file.base64));
    } catch (error) { notify({ kind: "error", text: errorMessage(error) }); }
  };
  const updateOptions = (changes: Partial<ImportTextOptions>) => {
    const next = { ...options, ...changes };
    setOptions(next);
    localStorage.setItem("mailforge-import-options", JSON.stringify(next));
    if (fileName) {
      try { setPreview(parseRecipients(fileContent, fileName, next, fileIsBase64)); }
      catch (error) { notify({ kind: "error", text: errorMessage(error) }); }
    }
  };
  const importRows = async () => {
    if (!preview) return;
    setSaving(true);
    try {
      const count = await window.mailforge.recipients.import(preview.recipients);
      await refresh();
      notify({ kind: "success", text: `${count} recipient(s) imported. Only contacts marked opted-in can be selected for campaigns.` });
      setPreview(null);
      setFileName("");
      setFileContent("");
      setFileIsBase64(false);
    } catch (error) { notify({ kind: "error", text: errorMessage(error) }); }
    finally { setSaving(false); }
  };
  const exportRows = async (rows: Recipient[]) => {
    try {
      if (await window.mailforge.recipients.exportCsv(rows)) notify({ kind: "success", text: "Cleaned recipient list exported as CSV." });
    } catch (error) { notify({ kind: "error", text: errorMessage(error) }); }
  };
  const setConsent = async (recipient: Recipient, optedIn: boolean) => {
    if (optedIn && !window.confirm(`Confirm ${recipient.email} explicitly opted in to receive email campaigns.`)) return;
    try {
      await window.mailforge.recipients.setConsent(recipient.email, optedIn);
      await refresh();
    } catch (error) { notify({ kind: "error", text: errorMessage(error) }); }
  };
  return <div className="page-stack">
    <PageHeader eyebrow="CONTACTS" title="Recipients" description="Organize contacts and keep consent status transparent.">
      <button className="button button-secondary" onClick={() => void exportRows(recipients)} disabled={!recipients.length}><ArrowDownToLine size={15} /> Export CSV</button>
      <button className="button button-primary" onClick={() => void openImport()}><Upload size={15} /> Import list</button>
    </PageHeader>
    <div className="notice-banner amber"><ShieldCheck size={17} /><span>Campaigns can only include contacts explicitly marked as opted-in. New imports without a consent column are kept unconsented.</span></div>
    <div className="list-toolbar"><div className="list-count"><strong>{recipients.length.toLocaleString()}</strong> contacts <span className="dot-separator">·</span> <span className="consent-count">{recipients.filter((item) => item.optedIn).length} opted in</span></div><div className="search-field"><Search size={15} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search recipients" /></div></div>
    {recipients.length === 0 ? <EmptyPanel title="Your recipient list is empty" text="Import a CSV, JSON, or text file. The import wizard cleans and previews your data before saving." action={<button className="button button-primary" onClick={() => void openImport()}><Upload size={15} /> Import recipients</button>} /> :
      <div className="table-card"><table><thead><tr><th>CONTACT</th><th>FIRST NAME</th><th>LAST NAME</th><th>CONSENT</th><th>ADDED</th></tr></thead><tbody>
        {visibleRecipients.slice(0, 200).map((recipient, index) => <tr key={recipient.email}><td><div className="table-identity"><div className={`contact-avatar avatar-${index % 5}`}>{(recipient.name ?? recipient.email).slice(0, 1).toUpperCase()}</div><div><strong>{recipient.name || recipient.email.split("@")[0]}</strong><small>{recipient.email}</small></div></div></td><td>{recipient.firstName || "—"}</td><td>{recipient.lastName || "—"}</td><td><label className="consent-control"><input type="checkbox" checked={recipient.optedIn} onChange={(event) => void setConsent(recipient, event.target.checked)} /><span>{recipient.optedIn ? "Opted in" : "Not consented"}</span></label></td><td className="sub-cell">Saved locally</td></tr>)}
      </tbody></table>{visibleRecipients.length > 200 && <div className="table-footnote">Showing first 200 matches. Export to review the full list.</div>}</div>}
    {preview && <ImportWizard fileName={fileName} preview={preview} options={options} setOptions={updateOptions} close={() => { setPreview(null); setFileName(""); setFileContent(""); setFileIsBase64(false); }} importRows={() => void importRows()} exportRows={() => void exportRows(preview.recipients)} saving={saving} />}
  </div>;
}

function ImportWizard({ fileName, preview, options, setOptions, close, importRows, exportRows, saving }: {
  fileName: string; preview: ImportPreview; options: ImportTextOptions; setOptions: (options: Partial<ImportTextOptions>) => void;
  close: () => void; importRows: () => void; exportRows: () => void; saving: boolean;
}) {
  const mappedColumns = new Set([
    options.emailColumn, options.nameColumn, options.firstNameColumn, options.lastNameColumn, options.consentColumn
  ].filter((value): value is string => Boolean(value)));
  const outputFields = [...new Set(preview.recipients.flatMap((recipient) => Object.keys(recipient.fields)))].slice(0, 4);
  const columnIncluded = (header: string) => options.includedColumns?.includes(header) ?? true;
  const toggleColumn = (header: string, included: boolean) => {
    const current = options.includedColumns ?? preview.headers.filter((item) => !mappedColumns.has(item));
    setOptions({ includedColumns: included ? [...new Set([...current, header])] : current.filter((item) => item !== header) });
  };
  const resetSetup = () => setOptions({
    ...defaultImportOptions,
    customDelimiter: undefined, columnNames: undefined, emailColumn: undefined, nameColumn: undefined,
    firstNameColumn: undefined, lastNameColumn: undefined, consentColumn: undefined, includedColumns: undefined,
    columnAliases: undefined, rowFilterColumn: undefined, rowFilterValue: undefined
  });
  return <Modal title="Import recipients" subtitle={`Review and clean ${fileName}`} close={close} wide>
    <div className="import-wizard-head"><div><strong>TXT → CSV data studio</strong><span>Choose exactly how source text becomes clean contact data.</span></div><button className="text-button" onClick={resetSetup}>Reset setup</button></div>
    <div className="import-section">
      <div className="import-section-title"><strong>1. Read the source</strong><span>Describe the structure of your text file</span></div>
      <div className="wizard-options format-options">
        <Field label="Parser"><select value={options.parserMode ?? "standard"} onChange={(event) => setOptions({ parserMode: event.target.value as ImportTextOptions["parserMode"] })}><option value="standard">Columns / automatic</option><option value="template">Custom format template</option></select></Field>
        {options.parserMode !== "template" && <>
          <Field label="Delimiter"><select value={options.delimiter} onChange={(event) => setOptions({ delimiter: event.target.value as ImportTextOptions["delimiter"] })}><option value="auto">Auto-detect</option><option value=",">Comma</option><option value=";">Semicolon</option><option value="&#9;">Tab</option><option value="|">Pipe</option><option value=" ">Space</option><option value="custom">Custom</option></select></Field>
          {options.delimiter === "custom" && <Field label="Custom delimiter"><input maxLength={3} value={options.customDelimiter ?? ""} onChange={(event) => setOptions({ customDelimiter: event.target.value })} placeholder="e.g. ::" /></Field>}
          <Field label="Header row"><select value={options.headerMode ?? "auto"} onChange={(event) => setOptions({ headerMode: event.target.value as ImportTextOptions["headerMode"] })}><option value="auto">Auto-detect</option><option value="first-row">First row is headers</option><option value="none">No header row</option></select></Field>
          <Field label="Email extraction"><select value={options.emailMode} onChange={(event) => setOptions({ emailMode: event.target.value as ImportTextOptions["emailMode"] })}><option value="auto">Auto-detect</option><option value="line">One email per line</option><option value="name-angle">Name &lt;email&gt;</option><option value="email-name">Email, Name</option><option value="name-email">Name, Email</option><option value="free-text">Extract from free text</option></select></Field>
        </>}
        {options.parserMode === "template" && <>
          <Field label="One record is"><select value={options.recordMode ?? "line"} onChange={(event) => setOptions({ recordMode: event.target.value as ImportTextOptions["recordMode"] })}><option value="line">One text line</option><option value="blank-line">A block separated by blank lines</option><option value="fixed-lines">A fixed number of lines</option></select></Field>
          {options.recordMode === "fixed-lines" && <Field label="Lines per record"><input type="number" min="1" value={options.recordLineCount ?? 2} onChange={(event) => setOptions({ recordLineCount: Math.max(1, Number(event.target.value)) })} /></Field>}
          <Field label="Custom format"><textarea className="format-template-input" rows={4} value={options.customFormat ?? ""} onChange={(event) => setOptions({ customFormat: event.target.value })} placeholder={'EMAIL={email}\nNAME={name}\nCOMPANY={company}'} /></Field>
          <div className="format-help"><strong>Placeholders define what to take</strong><span>Built in: <code>{`{email}`}</code> <code>{`{name}`}</code> <code>{`{first_name}`}</code> <code>{`{last_name}`}</code> <code>{`{opted_in}`}</code></span><span>Any other placeholder becomes a CSV column. Use <code>{`{ignore}`}</code> to skip a value.</span></div>
        </>}
        <Field label="Text encoding"><select value={options.encoding} onChange={(event) => setOptions({ encoding: event.target.value as ImportTextOptions["encoding"] })}><option value="utf-8">UTF-8</option><option value="windows-1252">Windows-1252</option><option value="iso-8859-1">ISO-8859-1</option></select></Field>
        <Field label="Skip first rows"><input type="number" min="0" value={options.skipRows ?? 0} onChange={(event) => setOptions({ skipRows: Math.max(0, Number(event.target.value)) })} /></Field>
        <Field label="Comment prefix"><input value={options.commentPrefix ?? ""} onChange={(event) => setOptions({ commentPrefix: event.target.value })} placeholder="# or //" /></Field>
        <Field label="Maximum output rows"><input type="number" min="0" value={options.maxRows ?? 0} onChange={(event) => setOptions({ maxRows: Math.max(0, Number(event.target.value)) })} placeholder="0 = unlimited" /></Field>
        {options.parserMode !== "template" && options.headerMode === "none" && <Field label="Custom column names"><input value={(options.columnNames ?? []).join(", ")} onChange={(event) => setOptions({ columnNames: event.target.value.split(",").map((value) => value.trim()).filter(Boolean) })} placeholder="email, name, company" /></Field>}
      </div>
    </div>
    {preview.headers.length > 0 && <div className="import-section">
      <div className="import-section-title"><strong>2. Map contact fields</strong><span>Pick which source column supplies each MailForge field</span></div>
      <div className="wizard-options mapping-options">
        <Field label="Email column"><select value={options.emailColumn ?? ""} onChange={(event) => setOptions({ emailColumn: event.target.value || undefined })}><option value="">Auto-detect / extract</option>{preview.headers.map((header) => <option key={header} value={header}>{header}</option>)}</select></Field>
        <Field label="Full name"><select value={options.nameColumn ?? ""} onChange={(event) => setOptions({ nameColumn: event.target.value || undefined })}><option value="">None / auto</option>{preview.headers.map((header) => <option key={header} value={header}>{header}</option>)}</select></Field>
        <Field label="First name"><select value={options.firstNameColumn ?? ""} onChange={(event) => setOptions({ firstNameColumn: event.target.value || undefined })}><option value="">None / auto</option>{preview.headers.map((header) => <option key={header} value={header}>{header}</option>)}</select></Field>
        <Field label="Last name"><select value={options.lastNameColumn ?? ""} onChange={(event) => setOptions({ lastNameColumn: event.target.value || undefined })}><option value="">None / auto</option>{preview.headers.map((header) => <option key={header} value={header}>{header}</option>)}</select></Field>
        <Field label="Consent / opt-in"><select value={options.consentColumn ?? ""} onChange={(event) => setOptions({ consentColumn: event.target.value || undefined })}><option value="">Auto-detect / none</option>{preview.headers.map((header) => <option key={header} value={header}>{header}</option>)}</select></Field>
        <Field label="Values that mean opted-in"><input value={options.consentTrueValues ?? ""} onChange={(event) => setOptions({ consentTrueValues: event.target.value })} placeholder="yes, true, 1, subscribed" /></Field>
      </div>
    </div>}
    <div className="import-section">
      <div className="import-section-title"><strong>3. Filter and clean</strong><span>Only matching rows are converted</span></div>
      <div className="wizard-options filter-options">
        <Field label="Filter column"><select value={options.rowFilterColumn ?? ""} onChange={(event) => setOptions({ rowFilterColumn: event.target.value || undefined })}><option value="">No row filter</option>{preview.headers.map((header) => <option key={header} value={header}>{header}</option>)}</select></Field>
        <Field label="Filter rule"><select value={options.rowFilterOperator ?? "contains"} onChange={(event) => setOptions({ rowFilterOperator: event.target.value as ImportTextOptions["rowFilterOperator"] })}><option value="contains">Contains</option><option value="equals">Equals</option><option value="starts-with">Starts with</option><option value="not-empty">Is not empty</option></select></Field>
        <Field label="Filter value"><input disabled={!options.rowFilterColumn || options.rowFilterOperator === "not-empty"} value={options.rowFilterValue ?? ""} onChange={(event) => setOptions({ rowFilterValue: event.target.value })} placeholder="Value to match" /></Field>
        <div className="cleaning-options">{[
          ["trim", "Trim whitespace"], ["removeDuplicates", "Remove duplicates"], ["lowercase", "Lowercase emails"], ["strictValidation", "Strict email validation"]
        ].map(([key, label]) => <label key={key}><input type="checkbox" checked={options[key as keyof ImportTextOptions] as boolean} onChange={(event) => setOptions({ [key]: event.target.checked })} />{label}</label>)}</div>
      </div>
    </div>
    {preview.headers.length > 1 && <div className="import-section">
      <div className="import-section-title"><strong>4. Choose CSV columns</strong><span>Keep extra source fields and rename their CSV headers</span><div className="section-actions"><button className="text-button" onClick={() => setOptions({ includedColumns: preview.headers.filter((header) => !mappedColumns.has(header)) })}>Select all</button><button className="text-button" onClick={() => setOptions({ includedColumns: [] })}>Clear extras</button></div></div>
      <div className="column-picker">{preview.headers.map((header) => {
        const mapped = mappedColumns.has(header);
        return <div className={`column-option ${mapped ? "mapped" : ""}`} key={header}><label><input type="checkbox" disabled={mapped} checked={mapped || columnIncluded(header)} onChange={(event) => toggleColumn(header, event.target.checked)} /><span><strong>{header}</strong><small>{mapped ? "Used by contact mapping" : "Include as custom field"}</small></span></label><input disabled={mapped || !columnIncluded(header)} value={options.columnAliases?.[header] ?? ""} onChange={(event) => setOptions({ columnAliases: { ...options.columnAliases, [header]: event.target.value } })} placeholder="CSV header / token name" /></div>;
      })}</div>
    </div>}
    <div className="import-stats">
      <ImportStat label="Rows scanned" value={preview.stats.totalRows} />
      <ImportStat label="Valid emails" value={preview.stats.validEmails} color="green" />
      <ImportStat label="Duplicates removed" value={preview.stats.duplicatesRemoved} color="purple" />
      <ImportStat label="Invalid rows" value={preview.stats.invalidRows} color="orange" />
      <ImportStat label="Rows filtered out" value={preview.stats.filteredRows} color="muted" />
    </div>
    <div className="preview-title"><div><strong>Clean CSV output preview</strong><small>Exactly what will be saved or imported</small></div><span>{preview.recipients.length} clean contact(s)</span></div>
    <div className="preview-table-wrap"><table className="preview-table"><thead><tr>{["Email", "Name", "First name", "Last name", ...outputFields, "Opt-in"].map((header) => <th key={header}>{header}</th>)}</tr></thead><tbody>
      {preview.recipients.slice(0, 30).map((recipient) => <tr key={`${recipient.email}-${recipient.name}`}><td>{recipient.email}</td><td>{recipient.name || "—"}</td><td>{recipient.firstName || "—"}</td><td>{recipient.lastName || "—"}</td>{outputFields.map((header) => <td key={header}>{recipient.fields[header] || "—"}</td>)}<td><span className={recipient.optedIn ? "consent-pill yes" : "consent-pill no"}>{recipient.optedIn ? "Yes" : "No"}</span></td></tr>)}
    </tbody></table></div>
    <div className="modal-footer"><span className="remember-label"><ShieldCheck size={14} /> Setup is remembered locally</span><button className="button button-secondary" onClick={exportRows} disabled={!preview.recipients.length}><ArrowDownToLine size={14} /> Convert &amp; save CSV</button><button className="button button-secondary" onClick={close}>Cancel</button><button className="button button-primary" onClick={importRows} disabled={!preview.recipients.length || saving}>{saving ? "Importing…" : `Import ${preview.recipients.length} contacts`}</button></div>
  </Modal>;
}

function ImportStat({ label, value, color = "blue" }: { label: string; value: number; color?: string }) {
  return <div className={`import-stat ${color}`}><strong>{value.toLocaleString()}</strong><small>{label}</small></div>;
}

function TemplatesPage({ templates, notify, refresh }: { templates: MailTemplate[]; notify: (notice: Notice) => void; refresh: () => Promise<void> }) {
  const [editing, setEditing] = useState<MailTemplate | null>(null);
  const [showEditor, setShowEditor] = useState(false);
  const [preview, setPreview] = useState(false);
  const blankTemplate: MailTemplate = { id: 0, name: "", subject: "", html: "", text: "", updatedAt: "" };
  const openNew = () => { setEditing(blankTemplate); setShowEditor(true); setPreview(false); };
  const edit = (template: MailTemplate) => { setEditing(template); setShowEditor(true); setPreview(false); };
  const save = async () => {
    if (!editing) return;
    try {
      await window.mailforge.templates.save(editing);
      await refresh();
      notify({ kind: "success", text: "Template saved." });
      setShowEditor(false);
    } catch (error) { notify({ kind: "error", text: errorMessage(error) }); }
  };
  const remove = async (id: number) => {
    if (!window.confirm("Delete this template?")) return;
    try { await window.mailforge.templates.remove(id); await refresh(); notify({ kind: "success", text: "Template deleted." }); }
    catch (error) { notify({ kind: "error", text: errorMessage(error) }); }
  };
  return <div className="page-stack">
    <PageHeader eyebrow="CONTENT" title="Templates" description="Build reusable emails and personalize with contact fields.">
      <button className="button button-primary" onClick={openNew}><Plus size={16} /> New template</button>
    </PageHeader>
    <div className="token-banner"><span className="token-mark">{`{{ }}`}</span><div><strong>Personalize every message</strong><p>Use tokens like <code>{`{{first_name}}`}</code>, <code>{`{{email}}`}</code>, or any imported column name.</p></div><span className="token-spark">✦</span></div>
    {templates.length === 0 ? <EmptyPanel title="No templates yet" text="Create a reusable message with subject, HTML, and plain-text content." action={<button className="button button-primary" onClick={openNew}><Plus size={15} /> Create template</button>} /> :
      <div className="template-grid">{templates.map((template, index) => <article className="template-card" key={template.id}>
        <div className={`template-art art-${index % 3}`}><div className="art-top"><span /><span /><span /></div><div className="art-lines"><i /><i /><i /><i /></div><div className="art-mail"><Mail size={19} /></div></div>
        <div className="template-card-copy"><div className="template-heading"><h3>{template.name}</h3><button className="icon-button subtle" onClick={() => void remove(template.id)}><Trash2 size={15} /></button></div><p>{template.subject}</p><div className="template-card-foot"><small>Updated {formatDate(template.updatedAt)}</small><button className="text-button" onClick={() => edit(template)}>Edit template <ArrowRight size={14} /></button></div></div>
      </article>)}</div>}
    {showEditor && editing && <Modal title={editing.id ? "Edit template" : "Create template"} subtitle="Use HTML and plain text for the best delivery compatibility." close={() => setShowEditor(false)} wide>
      <div className="template-editor">
        <div className="form-grid">
          <Field label="Template name"><input value={editing.name} onChange={(event) => setEditing({ ...editing, name: event.target.value })} placeholder="Welcome email" /></Field>
          <Field label="Subject line"><input value={editing.subject} onChange={(event) => setEditing({ ...editing, subject: event.target.value })} placeholder="A note for {{first_name}}" /></Field>
          <div className="editor-tabs"><button className={!preview ? "active" : ""} onClick={() => setPreview(false)}>HTML source</button><button className={preview ? "active" : ""} onClick={() => setPreview(true)}>Live preview</button></div>
          {preview ? <iframe className="email-preview" title="Template preview" sandbox="" srcDoc={renderPreview(editing.html || editing.text)} /> : <Field label="HTML content"><textarea className="code-textarea" value={editing.html} onChange={(event) => setEditing({ ...editing, html: event.target.value })} placeholder="<h1>Hello {{first_name}}</h1><p>Thanks for being here.</p>" /></Field>}
          <Field label="Plain-text fallback"><textarea className="plain-textarea" value={editing.text} onChange={(event) => setEditing({ ...editing, text: event.target.value })} placeholder="Hello {{first_name}},&#10;&#10;Thanks for being here." /></Field>
        </div>
        <div className="modal-footer"><span className="remember-label">HTML preview scripts are disabled.</span><button className="button button-secondary" onClick={() => setShowEditor(false)}>Cancel</button><button className="button button-primary" onClick={() => void save()} disabled={!editing.name.trim() || !editing.subject.trim()}>Save template</button></div>
      </div>
    </Modal>}
  </div>;
}

function CampaignsPage({ campaigns, recipients, templates, notify, refresh }: {
  campaigns: Campaign[]; recipients: Recipient[]; templates: MailTemplate[]; notify: (notice: Notice) => void; refresh: () => Promise<void>;
}) {
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState("");
  const [templateId, setTemplateId] = useState("");
  const [rate, setRate] = useState("10");
  const [scheduledAt, setScheduledAt] = useState("");
  const [creating, setCreating] = useState(false);
  const optedIn = recipients.filter((recipient) => recipient.optedIn);
  const create = async () => {
    if (!name.trim() || !templateId) return;
    setCreating(true);
    try {
      const campaign = await window.mailforge.campaigns.create({
        name, templateId: Number(templateId), recipientEmails: optedIn.map((recipient) => recipient.email),
        ratePerMinute: Number(rate), scheduledAt: scheduledAt ? new Date(scheduledAt).toISOString() : undefined,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone
      });
      await refresh();
      setShowCreate(false);
      setName("");
      setScheduledAt("");
      notify({ kind: "success", text: campaign.status === "scheduled" ? "Campaign scheduled." : "Campaign draft created. Start it when you’re ready." });
    } catch (error) { notify({ kind: "error", text: errorMessage(error) }); }
    finally { setCreating(false); }
  };
  const control = async (campaign: Campaign, action: "pause" | "resume" | "stop") => {
    try {
      await window.mailforge.campaigns.control(campaign.id, action);
      await refresh();
      notify({ kind: "success", text: `Campaign ${action === "resume" ? "started" : `${action}d`}.` });
    } catch (error) { notify({ kind: "error", text: errorMessage(error) }); }
  };
  const progress = (campaign: Campaign) => campaign.sent + campaign.failed;
  return <div className="page-stack">
    <PageHeader eyebrow="OUTREACH" title="Campaigns" description="Create and monitor consent-based email sends.">
      <button className="button button-primary" onClick={() => setShowCreate(true)}><Plus size={16} /> Create campaign</button>
    </PageHeader>
    <div className="notice-banner amber"><ShieldCheck size={17} /><span>Only explicitly opted-in recipients are eligible. Sending is capped at 30 messages per minute and each SMTP account’s daily limit is always enforced.</span></div>
    {campaigns.length === 0 ? <EmptyPanel title="No campaigns created" text="Choose a template and your opted-in recipients to create a campaign." action={<button className="button button-primary" onClick={() => setShowCreate(true)}><Plus size={15} /> Create campaign</button>} /> :
      <div className="campaign-list">{campaigns.map((campaign) => {
        const total = optedIn.length;
        const pct = Math.min(100, total ? Math.round(progress(campaign) * 100 / total) : 0);
        return <article className="campaign-card" key={campaign.id}>
          <div className="campaign-card-top"><div className="campaign-title"><div className="campaign-badge large"><Mail size={17} /></div><div><h3>{campaign.name}</h3><small>Created {formatDate(campaign.createdAt)}</small></div></div><StatBadge status={campaign.status} /></div>
          <div className="campaign-metrics"><span><strong>{campaign.sent}</strong> sent</span><span><strong>{campaign.failed}</strong> failed</span>{campaign.status === "running" && <span><strong>{Math.max(0, total - progress(campaign))}</strong> remaining</span>}</div>
          <div className="campaign-progress"><div className="progress-track"><span style={{ width: `${pct}%` }} /></div><small>{pct}%</small></div>
          <div className="campaign-actions">{campaign.status === "draft" || campaign.status === "paused" ? <button className="button button-small button-primary" onClick={() => void control(campaign, "resume")}><Play size={14} /> {campaign.status === "draft" ? "Start" : "Resume"}</button> : null}
            {campaign.status === "running" && <button className="button button-small button-secondary" onClick={() => void control(campaign, "pause")}><Pause size={14} /> Pause</button>}
            {["running", "paused", "scheduled", "draft"].includes(campaign.status) && <button className="button button-small button-ghost-danger" onClick={() => void control(campaign, "stop")}><X size={14} /> Stop</button>}
          </div>
        </article>;
      })}</div>}
    {showCreate && <Modal title="Create campaign" subtitle="A campaign is sent only to contacts marked as opted in." close={() => setShowCreate(false)}>
      <div className="form-grid">
        <Field label="Campaign name"><input value={name} onChange={(event) => setName(event.target.value)} placeholder="November product update" /></Field>
        <Field label="Email template"><select value={templateId} onChange={(event) => setTemplateId(event.target.value)}><option value="">Select a template</option>{templates.map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}</select></Field>
        <div className="audience-summary"><Users size={17} /><div><strong>{optedIn.length.toLocaleString()} opted-in recipients</strong><small>{recipients.length - optedIn.length} contacts excluded (no recorded opt-in)</small></div></div>
        <Field label="Sending rate (messages per minute)"><select value={rate} onChange={(event) => setRate(event.target.value)}>{[1, 2, 5, 10, 15, 20, 30].map((value) => <option key={value} value={value}>{value} / min</option>)}</select></Field>
        <Field label="Schedule start (optional)"><input type="datetime-local" value={scheduledAt} onChange={(event) => setScheduledAt(event.target.value)} /></Field>
        <div className="modal-footer"><span className="remember-label">Rate limit cannot exceed 30/min</span><button className="button button-secondary" onClick={() => setShowCreate(false)}>Cancel</button><button className="button button-primary" onClick={() => void create()} disabled={!name.trim() || !templateId || !optedIn.length || creating}>{creating ? "Creating…" : "Create campaign"}</button></div>
      </div>
    </Modal>}
  </div>;
}

function MailboxPage({ smtp, notify }: { smtp: SmtpAccount[]; notify: (notice: Notice) => void }) {
  const [accounts, setAccounts] = useState<Array<{ id: number; name: string; email: string; host: string }>>([]);
  const [accountId, setAccountId] = useState<number | null>(null);
  const [folders, setFolders] = useState<MailFolder[]>([]);
  const [folder, setFolder] = useState("INBOX");
  const [messages, setMessages] = useState<MailMessage[]>([]);
  const [messageQuery, setMessageQuery] = useState("");
  const [selected, setSelected] = useState<MailMessage | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [showCompose, setShowCompose] = useState(false);
  const [composeMode, setComposeMode] = useState<"reply" | "forward" | null>(null);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [discoveringImap, setDiscoveringImap] = useState(false);
  const reload = async (id = accountId, path = folder) => {
    if (id === null) return;
    setLoadingMessages(true);
    try {
      const list = await window.mailforge.imap.messages(id, path);
      setMessages(list);
      if (selected) setSelected(list.find((item) => item.uid === selected.uid) ?? null);
    } catch (error) { notify({ kind: "error", text: errorMessage(error) }); }
    finally { setLoadingMessages(false); }
  };
  const reloadAccounts = async () => {
    try {
      const list = await window.mailforge.imap.listAccounts();
      setAccounts(list);
      if (!accountId && list[0]) {
        setAccountId(list[0].id);
        const nextFolders = await window.mailforge.imap.folders(list[0].id);
        setFolders(nextFolders);
      }
    } catch (error) { notify({ kind: "error", text: errorMessage(error) }); }
  };
  const discoverFromSmtp = async () => {
    if (!smtp.length) {
      notify({ kind: "info", text: "Import or add SMTP accounts first." });
      return;
    }
    setDiscoveringImap(true);
    try {
      const result = await window.mailforge.imap.discoverFromSmtp();
      await reloadAccounts();
      notify({
        kind: result.failures.length ? "info" : "success",
        text: `${result.connected} inbox connection(s) discovered, ${result.skipped} already connected${result.failures.length ? `, ${result.failures.length} failed.` : "."}`
      });
      if (result.failures.length) {
        notify({ kind: "info", text: result.failures.slice(0, 2).map((failure) => `${failure.email}: ${failure.message}`).join("; ") });
      }
    } catch (error) { notify({ kind: "error", text: errorMessage(error) }); }
    finally { setDiscoveringImap(false); }
  };
  useEffect(() => { void reloadAccounts(); }, []);
  useEffect(() => { if (accountId !== null) void reload(accountId, folder); }, [accountId, folder]);
  const chooseAccount = async (id: number) => {
    setAccountId(id);
    setSelected(null);
    try { setFolders(await window.mailforge.imap.folders(id)); }
    catch (error) { notify({ kind: "error", text: errorMessage(error) }); }
  };
  const deleteMessage = async () => {
    if (!selected || accountId === null) return;
    try {
      await window.mailforge.imap.deleteMessage(accountId, folder, selected.uid);
      setSelected(null);
      await reload(accountId, folder);
      notify({ kind: "success", text: "Message deleted." });
    } catch (error) { notify({ kind: "error", text: errorMessage(error) }); }
  };
  const folderLabels = folders.length ? folders : [{ path: "INBOX", name: "Inbox" }, { path: "Sent", name: "Sent" }, { path: "Drafts", name: "Drafts" }, { path: "Trash", name: "Trash" }];
  const filteredMessages = messages.filter((message) => `${message.from} ${message.subject} ${message.text}`.toLowerCase().includes(messageQuery.toLowerCase()));
  return <div className="page-stack mailbox-page">
    <PageHeader eyebrow="EMAIL CLIENT" title="Mailbox" description="Read and manage mail across your IMAP accounts.">
      <button className="button button-secondary" onClick={() => void discoverFromSmtp()} disabled={!smtp.length || discoveringImap}><Inbox size={15} /> {discoveringImap ? "Checking SMTP accounts…" : "Discover SMTP inboxes"}</button>
      <button className="button button-secondary" onClick={() => void reload()} disabled={accountId === null}><Archive size={15} /> Refresh</button>
      <button className="button button-primary" onClick={() => { setComposeMode(null); setShowCompose(true); }} disabled={!smtp.some((item) => item.enabled)}><MailPlus size={15} /> Compose</button>
    </PageHeader>
    <div className="mail-client">
      <aside className="mail-sidebar">
        <button className="mail-add-account" onClick={() => setShowAdd(true)}><Plus size={14} /> Add IMAP account</button>
        {accounts.length > 0 && <div className="mail-account-select"><label>ACCOUNT</label><select value={accountId ?? ""} onChange={(event) => void chooseAccount(Number(event.target.value))}>{accounts.map((item) => <option key={item.id} value={item.id}>{item.name || item.email}</option>)}</select></div>}
        <div className="folder-list">{folderLabels.map((item, index) => <button key={item.path} onClick={() => { setFolder(item.path); setSelected(null); }} className={`folder-button ${folder === item.path ? "selected" : ""}`}><FolderIcon name={item.specialUse ?? item.name} /><span>{folderName(item)}</span>{index === 0 && messages.length > 0 && <small>{messages.length}</small>}</button>)}</div>
      </aside>
      <div className="message-list-panel">
        <div className="mail-list-heading"><div><strong>{folderName({ name: folder, path: folder })}</strong><small>{messages.length} messages</small></div><button className="icon-button subtle" onClick={() => void reload()} title="Refresh mail"><Archive size={15} /></button></div>
        <div className="mail-search"><Search size={14} /><input value={messageQuery} onChange={(event) => setMessageQuery(event.target.value)} placeholder="Search this folder" /></div>
        <div className="message-list">
          {loadingMessages ? <div className="inline-empty"><div className="spinner small" /> Loading messages…</div> : messages.length === 0 ? <div className="mail-empty"><Mail size={23} /><strong>{accounts.length ? "No messages here" : "Connect an IMAP account"}</strong><span>{accounts.length ? "Try another folder or refresh your mailbox." : "Add your account to start browsing your inbox."}</span>{!accounts.length && <button className="text-button" onClick={() => setShowAdd(true)}>Add account <ArrowRight size={14} /></button>}</div> :
            filteredMessages.map((message) => <button key={message.uid} className={`message-card ${selected?.uid === message.uid ? "selected" : ""} ${message.seen ? "" : "unread"}`} onClick={() => setSelected(message)}><div className="message-avatar">{(message.from || "?").slice(0, 1).toUpperCase()}</div><div className="message-copy"><div className="message-sender"><strong>{message.from.split("<")[0].replaceAll('"', "").trim() || message.from}</strong><small>{formatTime(message.date)}</small></div><span>{message.subject}</span><p>{message.text.slice(0, 75) || "Open to view message"}</p></div>{!message.seen && <i className="unread-dot" />}</button>)}
        </div>
      </div>
      <div className="message-view">
        {!selected ? <div className="message-placeholder"><div className="placeholder-envelope"><Mail size={24} /></div><h3>Select a message</h3><p>Choose an email from the list to read it here.</p><div className="placeholder-shortcuts"><span>⌘</span> Search messages <span>⌘</span> Compose</div></div> : <>
          <div className="message-toolbar"><button className="icon-button subtle" onClick={() => setSelected(null)} title="Back"><ArrowLeft size={16} /></button><div className="toolbar-spacer" /><button className="icon-button subtle" onClick={() => void deleteMessage()} title="Delete message"><Trash2 size={16} /></button><button className="icon-button subtle" onClick={() => { setComposeMode("reply"); setShowCompose(true); }} title="Reply"><ArrowLeft size={16} /></button><button className="icon-button subtle" title="More"><MoreHorizontal size={16} /></button></div>
          <article className="opened-message"><div className="message-label">{folder.toUpperCase()}</div><h2>{selected.subject}</h2><div className="opened-from"><div className="message-avatar">{selected.from.slice(0, 1).toUpperCase()}</div><div><strong>{selected.from}</strong><small>To you · {formatDate(selected.date)}</small></div></div>
            {selected.html ? <iframe className="message-html" title="Email content" sandbox="" srcDoc={sandboxDocument(selected.html)} /> : <pre className="message-text">{selected.text}</pre>}
            {selected.attachments.length > 0 && <div className="attachment-list"><strong>Attachments</strong>{selected.attachments.map((attachment, index) => <button key={`${attachment.filename}-${index}`} onClick={async () => {
              if (accountId === null) return;
              try {
                if (await window.mailforge.imap.downloadAttachment(accountId, folder, selected.uid, index)) notify({ kind: "success", text: `${attachment.filename} saved.` });
              } catch (error) { notify({ kind: "error", text: errorMessage(error) }); }
            }}><Paperclip size={13} /><span>{attachment.filename}</span><small>{formatBytes(attachment.size)}</small><ArrowDownToLine size={13} /></button>)}</div>}
            <div className="opened-actions"><button className="button button-secondary" onClick={() => { setComposeMode("reply"); setShowCompose(true); }}><ArrowLeft size={14} /> Reply</button><button className="button button-secondary" onClick={() => { setComposeMode("forward"); setShowCompose(true); }}><ArrowRight size={14} /> Forward</button></div>
          </article>
        </>}
      </div>
    </div>
    {showAdd && <ImapModal close={() => setShowAdd(false)} refresh={reloadAccounts} notify={notify} />}
    {showCompose && <ComposeModal
      smtp={smtp}
      close={() => { setShowCompose(false); setComposeMode(null); }}
      notify={notify}
      initialRecipient={composeMode === "reply" ? selected?.from.match(/<([^>]+)>/)?.[1] ?? selected?.from ?? "" : ""}
      initialSubject={composeMode === "reply" && selected ? `Re: ${selected.subject}` : composeMode === "forward" && selected ? `Fwd: ${selected.subject}` : ""}
      initialBody={composeMode && selected ? `${composeMode === "forward" ? "\n\n---------- Forwarded message ----------\n" : "\n\nOn " + formatDate(selected.date) + ", " + selected.from + " wrote:\n"}${selected.text}` : ""}
    />}
  </div>;
}

function FolderIcon({ name }: { name: string }) {
  const normalized = name.toLowerCase();
  if (normalized.includes("sent")) return <Send size={15} />;
  if (normalized.includes("draft")) return <FileText size={15} />;
  if (normalized.includes("trash") || normalized.includes("deleted")) return <Trash2 size={15} />;
  return <Inbox size={15} />;
}

function ImapModal({ close, refresh, notify }: { close: () => void; refresh: () => Promise<void>; notify: (notice: Notice) => void }) {
  const [form, setForm] = useState({ name: "", email: "", host: "", port: "993", username: "", password: "", encryption: "ssl" as const });
  const [saving, setSaving] = useState(false);
  const change = (key: keyof typeof form, value: string) => setForm((current) => ({ ...current, [key]: value }));
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);
    try {
      await window.mailforge.imap.add({ ...form, port: Number(form.port) });
      await refresh();
      notify({ kind: "success", text: "IMAP account added." });
      close();
    } catch (error) { notify({ kind: "error", text: errorMessage(error) }); }
    finally { setSaving(false); }
  };
  return <Modal title="Add IMAP account" subtitle="Connect a mailbox to browse and manage messages." close={close}>
    <form className="form-grid" onSubmit={(event) => void submit(event)}>
      <Field label="Account name"><input value={form.name} onChange={(event) => change("name", event.target.value)} placeholder="Personal inbox" required /></Field>
      <Field label="Email address"><input type="email" value={form.email} onChange={(event) => change("email", event.target.value)} required /></Field>
      <div className="two-fields"><Field label="IMAP host"><input value={form.host} onChange={(event) => change("host", event.target.value)} placeholder="imap.example.com" required /></Field><Field label="Port"><input type="number" value={form.port} onChange={(event) => change("port", event.target.value)} required /></Field></div>
      <Field label="Username"><input value={form.username} onChange={(event) => change("username", event.target.value)} required /></Field>
      <Field label="Password"><input type="password" value={form.password} onChange={(event) => change("password", event.target.value)} required /></Field>
      <Field label="Encryption"><select value={form.encryption} onChange={(event) => change("encryption", event.target.value)}><option value="ssl">SSL</option><option value="tls">TLS</option><option value="starttls">STARTTLS</option><option value="none">None</option></select></Field>
      <div className="form-footer"><span>Credentials encrypted on this device.</span><button type="button" className="button button-secondary" onClick={close}>Cancel</button><button className="button button-primary" disabled={saving}>{saving ? "Connecting…" : "Add account"}</button></div>
    </form>
  </Modal>;
}

function ComposeModal({ smtp, close, notify, initialRecipient = "", initialSubject = "", initialBody = "" }: {
  smtp: SmtpAccount[]; close: () => void; notify: (notice: Notice) => void;
  initialRecipient?: string; initialSubject?: string; initialBody?: string;
}) {
  const [accountId, setAccountId] = useState(String(smtp.find((item) => item.enabled)?.id ?? ""));
  const [to, setTo] = useState(initialRecipient);
  const [subject, setSubject] = useState(initialSubject);
  const [text, setText] = useState(initialBody);
  const [attachments, setAttachments] = useState<AttachmentChoice[]>([]);
  const [sending, setSending] = useState(false);
  const addAttachments = async () => {
    try {
      const selectedFiles = await window.mailforge.compose.chooseAttachments();
      const existing = new Set(attachments.map((item) => item.id));
      setAttachments((current) => [...current, ...selectedFiles.filter((item) => !existing.has(item.id))]);
    } catch (error) { notify({ kind: "error", text: errorMessage(error) }); }
  };
  const releaseAttachment = async (id: string) => {
    try {
      await window.mailforge.compose.releaseAttachment(id);
      setAttachments((current) => current.filter((item) => item.id !== id));
    } catch (error) { notify({ kind: "error", text: errorMessage(error) }); }
  };
  const closeComposer = () => {
    for (const attachment of attachments) void window.mailforge.compose.releaseAttachment(attachment.id);
    close();
  };
  const submit = async () => {
    setSending(true);
    try {
      await window.mailforge.compose.send({ accountId: Number(accountId), to, subject, text, attachmentIds: attachments.map((attachment) => attachment.id) });
      notify({ kind: "success", text: "Message sent." });
      close();
    } catch (error) { notify({ kind: "error", text: errorMessage(error) }); }
    finally { setSending(false); }
  };
  return <Modal title="New message" subtitle="Compose and send through one of your SMTP accounts." close={closeComposer}>
    <div className="compose-fields">
      <Field label="From account"><select value={accountId} onChange={(event) => setAccountId(event.target.value)}>{smtp.filter((item) => item.enabled).map((item) => <option key={item.id} value={item.id}>{item.name} — {item.username}</option>)}</select></Field>
      <Field label="To"><input type="email" value={to} onChange={(event) => setTo(event.target.value)} placeholder="name@example.com" /></Field>
      <Field label="Subject"><input value={subject} onChange={(event) => setSubject(event.target.value)} /></Field>
      <Field label="Message"><textarea className="compose-text" value={text} onChange={(event) => setText(event.target.value)} placeholder="Write your message…" /></Field>
      <div className="compose-attachments"><button className="button button-secondary button-small" onClick={() => void addAttachments()}><Paperclip size={13} /> Attach files</button>{attachments.map((attachment) => <span className="attachment-chip" key={attachment.id}>{attachment.name}<small>{formatBytes(attachment.size)}</small><button onClick={() => void releaseAttachment(attachment.id)} aria-label={`Remove ${attachment.name}`}><X size={12} /></button></span>)}</div>
      <div className="form-footer"><span>Sent mail is recorded in Activity.</span><button className="button button-secondary" onClick={closeComposer}>Cancel</button><button className="button button-primary" disabled={!to || !subject || sending} onClick={() => void submit()}><Send size={14} />{sending ? "Sending…" : "Send message"}</button></div>
    </div>
  </Modal>;
}

function ActivityPage({ logs, refresh, notify }: { logs: MailLog[]; refresh: () => Promise<void>; notify: (notice: Notice) => void }) {
  const [filter, setFilter] = useState("all");
  const filtered = logs.filter((item) => filter === "all" || item.status === filter);
  const exportLogs = async () => {
    try { if (await window.mailforge.logs.export()) notify({ kind: "success", text: "Activity log exported." }); }
    catch (error) { notify({ kind: "error", text: errorMessage(error) }); }
  };
  useEffect(() => { void refresh(); }, []);
  return <div className="page-stack">
    <PageHeader eyebrow="MONITORING" title="Activity log" description="Review recent SMTP tests and email delivery events.">
      <button className="button button-secondary" onClick={() => void exportLogs()}><ArrowDownToLine size={15} /> Export log</button>
      <button className="button button-secondary" onClick={() => void refresh()}><Archive size={15} /> Refresh</button>
    </PageHeader>
    <div className="list-toolbar"><div className="filter-tabs">{["all", "success", "failed", "info"].map((status) => <button key={status} className={filter === status ? "active" : ""} onClick={() => setFilter(status)}>{status === "all" ? "All events" : status[0]!.toUpperCase() + status.slice(1)}</button>)}</div><div className="list-count">{filtered.length} events</div></div>
    <div className="panel log-panel">{filtered.length ? filtered.map((item) => <LogRow key={item.id} item={item} expanded />) : <EmptyState icon={<Activity size={20} />} title="No activity to show" text="Events will appear here when you test an SMTP connection or send an email." />}</div>
  </div>;
}

function SettingsPage({ smtpCount, recipientCount, theme, toggleTheme }: { smtpCount: number; recipientCount: number; theme: "light" | "dark"; toggleTheme: () => void }) {
  return <div className="page-stack">
    <PageHeader eyebrow="PREFERENCES" title="Settings" description="Configure how MailForge looks and stores your information." />
    <section className="panel settings-panel"><div className="settings-section-head"><div className="settings-icon"><Sun size={18} /></div><div><h2>Appearance</h2><p>Choose the look that works best for you.</p></div></div><div className="setting-row"><div><strong>Color theme</strong><small>Set a light or dark interface.</small></div><button className="theme-switch" onClick={toggleTheme}>{theme === "dark" ? <><Moon size={15} /> Dark <ChevronDown size={14} /></> : <><Sun size={15} /> Light <ChevronDown size={14} /></>}</button></div></section>
    <section className="panel settings-panel"><div className="settings-section-head"><div className="settings-icon purple"><ShieldCheck size={18} /></div><div><h2>Privacy & storage</h2><p>Your data is private to this computer.</p></div></div><div className="setting-row"><div><strong>Local database</strong><small>Accounts, contacts, templates, campaigns and logs are stored locally.</small></div><span className="settings-status">Active</span></div><div className="setting-row"><div><strong>Encrypted credentials</strong><small>SMTP and IMAP passwords use the OS secure storage API.</small></div><span className="settings-status">Enabled</span></div></section>
    <section className="panel settings-panel"><div className="settings-section-head"><div className="settings-icon green"><BarChart3 size={18} /></div><div><h2>Workspace summary</h2><p>Data currently stored in this local profile.</p></div></div><div className="summary-pills"><span><Send size={14} />{smtpCount} SMTP accounts</span><span><Users size={14} />{recipientCount} recipients</span><span><ShieldCheck size={14} />Consent checks enforced</span></div></section>
    <div className="settings-footer">MailForge Pro <span>·</span> Version 0.1.0 <span>·</span> Build for macOS & Windows</div>
  </div>;
}

function LogRow({ item, expanded = false }: { item: MailLog; expanded?: boolean }) {
  const icon = item.status === "success" ? <Check size={13} /> : item.status === "failed" ? <X size={13} /> : <Activity size={13} />;
  return <div className={`log-row ${expanded ? "expanded" : ""}`}><div className={`log-icon ${item.status}`}>{icon}</div><div className="log-copy"><strong>{item.message}</strong><small>{item.recipient ? `To ${item.recipient} · ` : ""}{item.campaignId ? `Campaign #${item.campaignId} · ` : ""}{formatDate(item.createdAt)} {formatTime(item.createdAt)}</small></div><span className={`log-status ${item.status}`}>{item.status}</span></div>;
}

function PageHeader({ eyebrow, title, description, children }: { eyebrow: string; title: string; description: string; children?: React.ReactNode }) {
  return <div className="page-header"><div><div className="eyebrow">{eyebrow}</div><h1>{title}</h1><p>{description}</p></div><div className="page-header-actions">{children}</div></div>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="field"><span>{label}</span>{children}</label>;
}

function Modal({ title, subtitle, close, children, wide = false }: { title: string; subtitle: string; close: () => void; children: React.ReactNode; wide?: boolean }) {
  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }}><section className={`modal ${wide ? "modal-wide" : ""}`} role="dialog" aria-modal="true" aria-label={title}>
    <div className="modal-heading"><div><h2>{title}</h2><p>{subtitle}</p></div><button className="icon-button subtle" onClick={close}><X size={17} /></button></div>{children}
  </section></div>;
}

function EmptyPanel({ title, text, action }: { title: string; text: string; action: React.ReactNode }) {
  return <div className="empty-panel"><div className="empty-graphic"><Mail size={23} /></div><h2>{title}</h2><p>{text}</p>{action}</div>;
}

function EmptyState({ icon, title, text }: { icon: React.ReactNode; title: string; text: string }) {
  return <div className="empty-state"><div>{icon}</div><strong>{title}</strong><p>{text}</p></div>;
}

function folderName(folder: MailFolder): string {
  return folder.specialUse?.replace(/^\\/, "") ?? folder.name.replace(/^\//, "");
}

function renderPreview(markup: string): string {
  return markup.replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (_match, key: string) => ({
    first_name: "Alex", name: "Alex Morgan", email: "alex@example.com"
  })[key] ?? "Sample");
}

function sandboxDocument(html: string): string {
  return `<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:"><body>${html}</body>`;
}

function formatDate(value: string): string {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function formatTime(value: string): string {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1_048_576) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1_048_576).toFixed(1)} MB`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Something went wrong. Please try again.";
}

export default App;
