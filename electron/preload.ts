import { contextBridge, ipcRenderer } from "electron";
import type { DesktopApi } from "../shared/contracts";

const api: DesktopApi = {
  smtp: {
    list: () => ipcRenderer.invoke("smtp:list"),
    chooseFile: () => ipcRenderer.invoke("smtp:choose-file"),
    import: (fileName, text, base64, options) => ipcRenderer.invoke("smtp:import", fileName, text, base64, options),
    add: (input) => ipcRenderer.invoke("smtp:add", input),
    test: (id) => ipcRenderer.invoke("smtp:test", id),
    setEnabled: (id, enabled) => ipcRenderer.invoke("smtp:set-enabled", id, enabled),
    remove: (id) => ipcRenderer.invoke("smtp:remove", id)
  },
  recipients: {
    import: (recipients) => ipcRenderer.invoke("recipients:import", recipients),
    list: () => ipcRenderer.invoke("recipients:list"),
    setConsent: (email, optedIn) => ipcRenderer.invoke("recipients:set-consent", email, optedIn),
    exportCsv: (recipients) => ipcRenderer.invoke("recipients:export", recipients),
    chooseFile: () => ipcRenderer.invoke("recipients:choose-file")
  },
  templates: {
    list: () => ipcRenderer.invoke("templates:list"),
    save: (template) => ipcRenderer.invoke("templates:save", template),
    remove: (id) => ipcRenderer.invoke("templates:remove", id)
  },
  campaigns: {
    list: () => ipcRenderer.invoke("campaigns:list"),
    create: (input) => ipcRenderer.invoke("campaigns:create", input),
    control: (id, action) => ipcRenderer.invoke("campaigns:control", id, action),
    onProgress: (callback) => {
      const listener = (_event: Electron.IpcRendererEvent, progress: unknown) => callback(progress as Parameters<typeof callback>[0]);
      ipcRenderer.on("campaign:progress", listener);
      return () => ipcRenderer.removeListener("campaign:progress", listener);
    }
  },
  compose: {
    chooseAttachments: () => ipcRenderer.invoke("compose:choose-attachments"),
    releaseAttachment: (id) => ipcRenderer.invoke("compose:release-attachment", id),
    send: (input) => ipcRenderer.invoke("compose:send", input)
  },
  imap: {
    add: (input) => ipcRenderer.invoke("imap:add", input),
    listAccounts: () => ipcRenderer.invoke("imap:list"),
    discoverFromSmtp: () => ipcRenderer.invoke("imap:discover-from-smtp"),
    folders: (accountId) => ipcRenderer.invoke("imap:folders", accountId),
    messages: (accountId, folder) => ipcRenderer.invoke("imap:messages", accountId, folder),
    deleteMessage: (accountId, folder, uid) => ipcRenderer.invoke("imap:delete", accountId, folder, uid),
    downloadAttachment: (accountId, folder, uid, attachmentIndex) => ipcRenderer.invoke("imap:download-attachment", accountId, folder, uid, attachmentIndex),
    delete: (accountId) => ipcRenderer.invoke("imap:remove", accountId)
  },
  logs: {
    list: () => ipcRenderer.invoke("logs:list"),
    export: () => ipcRenderer.invoke("logs:export")
  },
  settings: {
    theme: () => ipcRenderer.invoke("settings:theme"),
    setTheme: (theme) => ipcRenderer.invoke("settings:set-theme", theme)
  }
};

contextBridge.exposeInMainWorld("mailforge", api);
