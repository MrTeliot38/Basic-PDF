// Script de préchargement isolé (sandbox = true) : expose uniquement les appels autorisés vers Electron
import { contextBridge, ipcRenderer } from 'electron';
import type {
  BasicPdfDesktopBridge,
  DesktopOpenedFile,
  DesktopPrintRequest,
} from '../src/types/desktop';

const bridge: BasicPdfDesktopBridge = {
  isDesktop: true,
  platform: process.platform,

  getPendingOpenFiles: () => ipcRenderer.invoke('desktop:get-pending-files'),

  onOpenFiles: (callback: (files: DesktopOpenedFile[]) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, files: DesktopOpenedFile[]) => {
      callback(files);
    };
    ipcRenderer.on('desktop:open-files', listener);
    return () => {
      ipcRenderer.removeListener('desktop:open-files', listener);
    };
  },

  openPdfDialog: () => ipcRenderer.invoke('desktop:open-pdf-dialog'),
  openPdfAtPath: (filePath: string) => ipcRenderer.invoke('desktop:open-pdf-at-path', filePath),
  savePdfDirect: (filePath: string, bytes: Uint8Array) =>
    ipcRenderer.invoke('desktop:save-pdf-direct', filePath, bytes),
  savePdfAsDialog: (defaultName: string, bytes: Uint8Array, existingPath?: string) =>
    ipcRenderer.invoke('desktop:save-pdf-as-dialog', defaultName, bytes, existingPath),

  preparePdfForShare: (suggestedName: string, bytes: Uint8Array) =>
    ipcRenderer.invoke('desktop:prepare-share', suggestedName, bytes),
  revealInExplorer: (filePath: string) =>
    ipcRenderer.invoke('desktop:reveal-in-explorer', filePath),
  openMailClient: (subject: string, body: string) =>
    ipcRenderer.invoke('desktop:open-mail-client', subject, body),

  listSystemFonts: () => ipcRenderer.invoke('desktop:list-system-fonts'),
  readSystemFontBytes: (familyCss: string, bold: boolean, italic: boolean) =>
    ipcRenderer.invoke('desktop:read-system-font-bytes', familyCss, bold, italic),

  printSheetsNative: (request: DesktopPrintRequest) =>
    ipcRenderer.invoke('desktop:print-sheets-native', request),

  getDefaultPdfStatus: () => ipcRenderer.invoke('desktop:get-default-pdf-status'),
  openWindowsDefaultAppsSettings: () => ipcRenderer.invoke('desktop:open-default-apps-settings'),
  getAppInfo: () => ipcRenderer.invoke('desktop:get-app-info'),
  checkForUpdates: (repoSlug: string) => ipcRenderer.invoke('desktop:check-updates', repoSlug),
  downloadAndVerifyUpdate: (installerUrl: string, fileName: string, expectedSha256: string) =>
    ipcRenderer.invoke('desktop:download-verify-update', installerUrl, fileName, expectedSha256),
  launchVerifiedUpdateInstaller: (installerPath: string) =>
    ipcRenderer.invoke('desktop:launch-verified-installer', installerPath),
};

contextBridge.exposeInMainWorld('basicPdfDesktop', bridge);
