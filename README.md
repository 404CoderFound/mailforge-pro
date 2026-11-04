# MailForge Pro

MailForge Pro is a local-first desktop email workspace built with Electron, React, TypeScript, Vite, Tailwind CSS, SQLite, Nodemailer, and ImapFlow. The renderer never receives email passwords or direct filesystem/database access; those operations run in Electron's main process through a narrow, typed preload API.

## Requirements

- Node.js 22.12 or newer
- npm
- Xcode command line tools on macOS (native SQLite module build)
- Visual Studio Build Tools on Windows (native SQLite module build)

## Development

```bash
npm install
npm run dev
```

The development command starts Vite and the Electron application. To build just the renderer and check both TypeScript projects:

```bash
npm run typecheck
npm test
npm run build
npm run build:electron
```

## Packaging

Build on the target operating system so native SQLite dependencies are rebuilt for that platform:

```bash
npm run package:mac
npm run package:win
```

macOS DMG files and Windows NSIS/portable packages are written to `release/`. Windows builds should be run on Windows; macOS builds should be run on macOS.

## Included workflows

- **SMTP:** add and securely store accounts, import CSV/JSON/TXT, test connections, enable/disable, observe daily usage, and remove accounts.
- **Recipients:** import CSV/JSON/TXT; extract and validate addresses; choose delimiters, parsing mode, encoding, and column mappings; trim, lowercase, deduplicate, preview, export cleaned CSV, and retain import settings on this device.
- **Consent:** imports without a recognizable opt-in/consent/subscribed field are unconsented by default. Campaign creation requires every selected contact to be explicitly opted in. Consent can be changed on the recipient page.
- **Templates:** edit HTML and plain text, preview safely in a sandboxed frame, and substitute `{{name}}`, `{{first_name}}`, `{{last_name}}`, `{{email}}`, and imported custom fields.
- **Campaigns:** schedule, start, pause, resume, and stop sends; see progress and delivery logs. Delivery is throttled to no more than 30 messages per minute and never exceeds an SMTP account's configured daily limit.
- **Mailbox:** add IMAP accounts, browse folders, read text/HTML messages, delete messages, download incoming attachments, and compose/reply/forward with configured SMTP accounts and local file attachments.
- **Local data:** SQLite data is stored in Electron's user-data directory. Passwords are encrypted with Electron `safeStorage`; the app refuses to save credentials if OS secure storage is unavailable.

## Safety and privacy notes

Campaigns are intended for contacts who explicitly consented to receive the messages. No campaign can be created with unconsented or missing recipients. Account rotation selects only enabled accounts that have remaining daily quota; it does not bypass server limits. Mailbox HTML is shown in a sandboxed frame, with scripts and same-origin access disabled. Open tracking is not enabled.

This initial release does not yet include campaign attachments, OAuth, advanced threading/search, bounce classification, or open/click analytics. IMAP/SMTP server settings and any provider-specific app passwords must be supplied by the user; no credentials are included in the application.
