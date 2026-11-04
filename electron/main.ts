import { app, BrowserWindow } from "electron";
import { join } from "node:path";
import { closeDatabase } from "./database";
import { registerIpcHandlers } from "./ipc";

let mainWindow: BrowserWindow | null = null;

function showStartupError(title: string, detail: string): void {
  const escapedTitle = title.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[character] ?? character);
  const escapedDetail = detail.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[character] ?? character);
  const html = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>MailForge Pro startup error</title><style>
    *{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0b1020;color:#e6e9f2;font:14px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
    main{width:min(560px,calc(100% - 40px));padding:30px;border:1px solid #29334b;border-radius:14px;background:#11182a;box-shadow:0 20px 70px #0006}
    .mark{width:38px;height:38px;display:grid;place-items:center;border-radius:11px;background:#7469ec;color:white;font-weight:800}
    h1{margin:19px 0 8px;font-size:21px}p{color:#9ba6bc;line-height:1.55}.detail{overflow-wrap:anywhere;padding:12px;border:1px solid #29334b;border-radius:7px;background:#0b1020;color:#f0a3ab;font:12px ui-monospace,monospace}
    button{margin-top:17px;padding:9px 13px;border:0;border-radius:7px;background:#786df0;color:white;font-weight:600;cursor:pointer}
  </style><main><div class="mark">M</div><h1>${escapedTitle}</h1><p>MailForge Pro could not display its workspace. The error below can help diagnose the problem.</p><div class="detail">${escapedDetail}</div><button onclick="location.reload()">Try again</button></main>`;
  if (mainWindow && !mainWindow.isDestroyed()) {
    void mainWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
  }
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1050,
    minHeight: 700,
    backgroundColor: "#0b1020",
    title: "MailForge Pro",
    webPreferences: {
      preload: join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  if (!app.isPackaged) {
    void mainWindow.loadURL("http://127.0.0.1:5173").catch((error: unknown) => {
      showStartupError("Could not connect to the development server", error instanceof Error ? error.message : String(error));
    });
    if (process.env.MAILFORGE_DEBUG === "1") mainWindow.webContents.openDevTools({ mode: "detach" });
  } else {
    const rendererPath = join(app.getAppPath(), "dist", "index.html");
    void mainWindow.loadFile(rendererPath).catch((error: unknown) => {
      showStartupError("Could not load the application files", error instanceof Error ? error.message : String(error));
    });
  }
  mainWindow.webContents.on("did-fail-load", (_event, errorCode, errorDescription, validatedURL) => {
    if (errorCode === -3) return;
    showStartupError("The application page failed to load", `${errorDescription} (${errorCode})\n${validatedURL}`);
  });
  mainWindow.webContents.on("render-process-gone", (_event, details) => {
    showStartupError("The application renderer stopped unexpectedly", `${details.reason} (exit code ${details.exitCode})`);
  });
  mainWindow.webContents.on("console-message", (_event, level, message) => {
    if (level >= 2) console.error(`[renderer] ${message}`);
  });
  if (process.env.MAILFORGE_DEBUG === "1") {
    mainWindow.webContents.openDevTools({ mode: "detach" });
  }
  mainWindow.on("closed", () => { mainWindow = null; });
}

app.whenReady().then(() => {
  createWindow();
  try {
    registerIpcHandlers(() => mainWindow);
  } catch (error) {
    showStartupError("MailForge could not start its local database", error instanceof Error ? error.message : String(error));
    return;
  }
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
}).catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error("MailForge startup failed:", error);
  app.whenReady().then(() => showStartupError("MailForge could not start", message));
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", closeDatabase);
