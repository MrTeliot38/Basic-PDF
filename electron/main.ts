// Processus principal Electron de Basic PDF (Windows) : sécurité stricte, aucune connexion réseau automatique, polices système, double-clic .pdf, impression native et mises à jour vérifiées
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  net,
  protocol,
  session,
  shell,
} from 'electron';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import type {
  DesktopAppInfo,
  DesktopDefaultPdfStatus,
  DesktopOpenedFile,
  DesktopPrintRequest,
  DesktopSystemFontInfo,
} from '../src/types/desktop';
import { buildNativePrintHtml } from './lib/printHtmlBuilder';
import {
  ApprovedPathStore,
  extractPdfPathsFromArgv,
  hasValidPdfSignature,
  isAllowedRendererUrl,
  isPathInsideAnyDirectory,
  isSafeExternalIntentUrl,
  writeFileAtomically,
} from './lib/securityAndPaths';
import {
  checkGithubUpdate,
  downloadAndVerifyInstaller,
  sanitizeGithubRepoSlug,
} from './lib/updateChecker';
import {
  enumerateInstalledWindowsFonts,
  resolveFontFilePath,
  type SystemFontEntry,
} from './lib/windowsFonts';

const execFileAsync = promisify(execFile);

const APP_USER_MODEL_ID = 'fr.basicpdf.desktop';
const DEFAULT_UPDATE_REPO = 'MrTeliot38/Basic-PDF';
const CUSTOM_PROTOCOL_SCHEME = 'app';
const CUSTOM_PROTOCOL_ORIGIN = 'app://basic-pdf';

// Permet d'isoler un profil utilisateur dédié pendant les tests automatisés
if (process.env.BASIC_PDF_USER_DATA_DIR) {
  app.setPath('userData', path.resolve(process.env.BASIC_PDF_USER_DATA_DIR));
}

app.setAppUserModelId(APP_USER_MODEL_ID);

// Déclare le protocole local sécurisé avant app.whenReady() pour PDF.js, l'OCR WASM et les modules ES
protocol.registerSchemesAsPrivileged([
  {
    scheme: CUSTOM_PROTOCOL_SCHEME,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true,
    },
  },
]);

const approvedPaths = new ApprovedPathStore();
const verifiedUpdateInstallers = new Set<string>();
const pendingOpenFiles: DesktopOpenedFile[] = [];
let mainWindow: BrowserWindow | null = null;
let cachedSystemFonts: SystemFontEntry[] | null = null;

function getRecentApprovedFilePath(): string {
  return path.join(app.getPath('userData'), 'approved-recent-paths.json');
}

function loadPersistedApprovedPaths(): void {
  try {
    const p = getRecentApprovedFilePath();
    if (!fs.existsSync(p)) return;
    const raw = JSON.parse(fs.readFileSync(p, 'utf8')) as unknown;
    if (Array.isArray(raw)) {
      for (const item of raw) {
        if (typeof item === 'string' && item.toLowerCase().endsWith('.pdf')) {
          approvedPaths.approve(item);
        }
      }
    }
  } catch {
    // Ignore un index corrompu
  }
}

function persistApprovedPath(filePath: string): void {
  const normalized = approvedPaths.approve(filePath);
  try {
    const p = getRecentApprovedFilePath();
    let list: string[] = [];
    if (fs.existsSync(p)) {
      const existing = JSON.parse(fs.readFileSync(p, 'utf8')) as unknown;
      if (Array.isArray(existing)) {
        list = existing.filter((x): x is string => typeof x === 'string');
      }
    }
    const filtered = [normalized, ...list.filter((x) => x.toLowerCase() !== normalized.toLowerCase())].slice(
      0,
      30,
    );
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, JSON.stringify(filtered, null, 2), 'utf8');
  } catch {
    // Tolère une écriture impossible sans bloquer l'utilisateur
  }
}

function readPdfFromApprovedDiskPath(filePath: string): DesktopOpenedFile | null {
  try {
    const stat = fs.statSync(filePath);
    if (!stat.isFile()) return null;
    const raw = fs.readFileSync(filePath);
    const bytes = new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength);
    if (!hasValidPdfSignature(bytes)) {
      return null;
    }
    persistApprovedPath(filePath);
    return {
      filePath: path.resolve(filePath),
      fileName: path.basename(filePath),
      bytes,
    };
  } catch {
    return null;
  }
}

function enqueueArgvPdfFiles(argv: string[], workingDir?: string): DesktopOpenedFile[] {
  const candidates = extractPdfPathsFromArgv(argv, workingDir);
  const loaded: DesktopOpenedFile[] = [];
  for (const candidate of candidates) {
    const opened = readPdfFromApprovedDiskPath(candidate);
    if (opened) {
      loaded.push(opened);
    }
  }
  return loaded;
}

function getAppRootDirectory(): string {
  // dist-electron/main.cjs est toujours placé dans <racine>/dist-electron (en dev comme dans app.asar)
  return path.resolve(__dirname, '..');
}

function getDistDirectory(): string {
  return path.join(getAppRootDirectory(), 'dist');
}

function getRealAppVersion(): string {
  if (app.isPackaged) {
    return app.getVersion();
  }
  try {
    const pkgPath = path.join(getAppRootDirectory(), 'package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8')) as { version?: unknown };
    if (typeof pkg.version === 'string' && pkg.version) {
      return pkg.version;
    }
  } catch {
    // Repli sur la version fournie par Electron
  }
  return app.getVersion();
}

function getIconPath(): string | undefined {
  const icoPath = path.join(getAppRootDirectory(), 'build', 'icon.ico');
  if (fs.existsSync(icoPath)) return icoPath;
  const rootPngPath = path.join(getAppRootDirectory(), 'build', 'icon.png');
  if (fs.existsSync(rootPngPath)) return rootPngPath;
  const pngPath = path.join(getDistDirectory(), 'icons', 'icon-512.png');
  if (fs.existsSync(pngPath)) return pngPath;
  return undefined;
}

async function createMainWindow(): Promise<void> {
  const preloadPath = path.join(__dirname, 'preload.cjs');
  const devServerUrl = process.env.VITE_DEV_SERVER_URL || null;

  mainWindow = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 760,
    minHeight: 540,
    title: 'Basic PDF',
    icon: getIconPath(),
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
    },
  });

  // Bloque toute navigation ou ouverture de fenêtre externe depuis le document HTML
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (event, targetUrl) => {
    const allowedPrefix = devServerUrl
      ? new URL(devServerUrl).origin
      : CUSTOM_PROTOCOL_ORIGIN;
    if (!targetUrl.startsWith(allowedPrefix)) {
      event.preventDefault();
    }
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  if (devServerUrl) {
    await mainWindow.loadURL(devServerUrl);
  } else {
    await mainWindow.loadURL(`${CUSTOM_PROTOCOL_ORIGIN}/index.html`);
  }
}

async function getSystemFontsCatalog(): Promise<SystemFontEntry[]> {
  if (!cachedSystemFonts) {
    cachedSystemFonts = await enumerateInstalledWindowsFonts();
  }
  return cachedSystemFonts;
}

function registerIpcHandlers(): void {
  ipcMain.handle('desktop:get-pending-files', () => {
    const items = pendingOpenFiles.splice(0, pendingOpenFiles.length);
    return items;
  });

  ipcMain.handle('desktop:open-pdf-dialog', async () => {
    const dialogOpts: Electron.OpenDialogOptions = {
      title: 'Ouvrir un document PDF',
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: 'Documents PDF', extensions: ['pdf'] },
        { name: 'Tous les fichiers', extensions: ['*'] },
      ],
    };
    const result = mainWindow
      ? await dialog.showOpenDialog(mainWindow, dialogOpts)
      : await dialog.showOpenDialog(dialogOpts);
    if (result.canceled || result.filePaths.length === 0) {
      return [];
    }
    const opened: DesktopOpenedFile[] = [];
    for (const p of result.filePaths) {
      const item = readPdfFromApprovedDiskPath(p);
      if (item) {
        opened.push(item);
      }
    }
    return opened;
  });

  ipcMain.handle('desktop:open-pdf-at-path', (_event, filePath: string) => {
    if (typeof filePath !== 'string' || !approvedPaths.isApproved(filePath)) {
      return null;
    }
    return readPdfFromApprovedDiskPath(filePath);
  });

  ipcMain.handle('desktop:save-pdf-direct', (_event, filePath: string, rawBytes: Uint8Array) => {
    if (typeof filePath !== 'string' || !approvedPaths.isApproved(filePath)) {
      return {
        ok: false,
        filePath: String(filePath ?? ''),
        error: "Ce fichier doit d'abord être choisi avec « Enregistrer sous ».",
      };
    }
    const bytes = new Uint8Array(rawBytes);
    if (!hasValidPdfSignature(bytes)) {
      return {
        ok: false,
        filePath,
        error: 'Le document généré est invalide.',
      };
    }
    try {
      writeFileAtomically(filePath, bytes);
      persistApprovedPath(filePath);
      return { ok: true, filePath: path.resolve(filePath) };
    } catch {
      return {
        ok: false,
        filePath,
        error: "Impossible d'écrire dans ce fichier. Vérifiez qu'il n'est pas verrouillé par un autre logiciel.",
      };
    }
  });

  ipcMain.handle(
    'desktop:save-pdf-as-dialog',
    async (_event, defaultName: string, rawBytes: Uint8Array, existingPath?: string) => {
      const bytes = new Uint8Array(rawBytes);
      if (!hasValidPdfSignature(bytes)) {
        return { canceled: false, error: 'Le document généré est invalide.' };
      }

      const safeDefault = path.basename(defaultName || 'document.pdf');
      const suggestedPath =
        existingPath && approvedPaths.isApproved(existingPath)
          ? path.join(path.dirname(existingPath), safeDefault)
          : path.join(app.getPath('documents'), safeDefault);

      const saveOpts: Electron.SaveDialogOptions = {
        title: 'Enregistrer le PDF sous',
        defaultPath: suggestedPath,
        filters: [{ name: 'Document PDF', extensions: ['pdf'] }],
      };
      const result = mainWindow
        ? await dialog.showSaveDialog(mainWindow, saveOpts)
        : await dialog.showSaveDialog(saveOpts);

      if (result.canceled || !result.filePath) {
        return { canceled: true };
      }

      const finalPath = result.filePath.toLowerCase().endsWith('.pdf')
        ? result.filePath
        : `${result.filePath}.pdf`;

      try {
        writeFileAtomically(finalPath, bytes);
        persistApprovedPath(finalPath);
        return {
          canceled: false,
          filePath: path.resolve(finalPath),
          fileName: path.basename(finalPath),
        };
      } catch {
        return {
          canceled: false,
          error: "Impossible d'enregistrer le PDF à cet emplacement.",
        };
      }
    },
  );

  ipcMain.handle('desktop:prepare-share', (_event, suggestedName: string, rawBytes: Uint8Array) => {
    const bytes = new Uint8Array(rawBytes);
    if (!hasValidPdfSignature(bytes)) {
      return { ok: false, error: 'Document PDF invalide.' };
    }
    try {
      const shareDir = path.join(app.getPath('temp'), 'BasicPDF-Partage');
      fs.mkdirSync(shareDir, { recursive: true });
      const base = path
        .basename(suggestedName || 'document.pdf')
        .replace(/[<>:"/\\|?*]+/g, '_');
      const finalName = base.toLowerCase().endsWith('.pdf') ? base : `${base}.pdf`;
      const targetPath = path.join(shareDir, finalName);
      writeFileAtomically(targetPath, bytes);
      approvedPaths.approve(targetPath);
      return { ok: true, filePath: targetPath };
    } catch {
      return { ok: false, error: 'Impossible de préparer la copie à partager.' };
    }
  });

  ipcMain.handle('desktop:reveal-in-explorer', (_event, filePath: string) => {
    if (typeof filePath !== 'string' || !approvedPaths.isApproved(filePath)) {
      return false;
    }
    if (!fs.existsSync(filePath)) {
      return false;
    }
    shell.showItemInFolder(path.resolve(filePath));
    return true;
  });

  ipcMain.handle('desktop:open-mail-client', async (_event, subject: string, body: string) => {
    const mailUrl = `mailto:?subject=${encodeURIComponent(String(subject || 'Document PDF'))}&body=${encodeURIComponent(String(body || ''))}`;
    if (!isSafeExternalIntentUrl(mailUrl)) {
      return false;
    }
    await shell.openExternal(mailUrl);
    return true;
  });

  ipcMain.handle('desktop:list-system-fonts', async (): Promise<DesktopSystemFontInfo[]> => {
    const list = await getSystemFontsCatalog();
    return list.map((f) => ({
      family: f.family,
      category: f.category,
      embeddable: f.embeddable,
    }));
  });

  ipcMain.handle(
    'desktop:read-system-font-bytes',
    async (_event, familyCss: string, bold: boolean, italic: boolean): Promise<Uint8Array | null> => {
      if (typeof familyCss !== 'string' || familyCss.length > 300) {
        return null;
      }
      const catalog = await getSystemFontsCatalog();
      const fontPath = resolveFontFilePath(catalog, familyCss, Boolean(bold), Boolean(italic));
      if (!fontPath) {
        return null;
      }
      try {
        const buf = fs.readFileSync(fontPath);
        return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
      } catch {
        return null;
      }
    },
  );

  ipcMain.handle(
    'desktop:print-sheets-native',
    async (_event, request: DesktopPrintRequest) => {
      let printWindow: BrowserWindow | null = null;
      try {
        const html = buildNativePrintHtml(request);
        printWindow = new BrowserWindow({
          show: false,
          width: 900,
          height: 1100,
          webPreferences: {
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
            webSecurity: true,
          },
        });
        printWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

        await printWindow.loadURL(
          `data:text/html;charset=utf-8,${encodeURIComponent(html)}`,
        );

        // Mode test automatisé : génère le PDF d'impression en mémoire pour valider la mise en page sans imprimante physique
        if (process.env.BASIC_PDF_TEST_PRINT_MODE === 'pdf-buffer') {
          const pdfBuf = await printWindow.webContents.printToPDF({
            printBackground: true,
            landscape: Boolean(request.landscape),
            margins: { top: 0, bottom: 0, left: 0, right: 0 },
            preferCSSPageSize: true,
          });
          if (!hasValidPdfSignature(new Uint8Array(pdfBuf))) {
            return { ok: false, error: "L'aperçu natif d'impression est invalide." };
          }
          return { ok: true };
        }

        const printed = await new Promise<{ ok: boolean; canceled?: boolean; error?: string }>(
          (resolve) => {
            printWindow!.webContents.print(
              {
                silent: false,
                printBackground: true,
                landscape: Boolean(request.landscape),
              },
              (success, failureReason) => {
                if (success) {
                  resolve({ ok: true });
                } else if (failureReason === 'Print job canceled') {
                  resolve({ ok: false, canceled: true });
                } else {
                  resolve({
                    ok: false,
                    error: failureReason || "L'impression Windows n'a pas pu aboutir.",
                  });
                }
              },
            );
          },
        );
        return printed;
      } catch {
        return { ok: false, error: "Impossible d'ouvrir l'impression native Windows." };
      } finally {
        if (printWindow && !printWindow.isDestroyed()) {
          printWindow.close();
        }
      }
    },
  );

  ipcMain.handle('desktop:get-default-pdf-status', async (): Promise<DesktopDefaultPdfStatus> => {
    try {
      const { stdout } = await execFileAsync(
        'reg.exe',
        [
          'query',
          'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\FileExts\\.pdf\\UserChoice',
          '/v',
          'ProgId',
        ],
        { windowsHide: true, timeout: 3000 },
      );
      const match = stdout.match(/ProgId\s+REG_SZ\s+(.+)/i);
      const progId = match ? match[1].trim() : '';
      const isBasicPdfDefault = progId.toLowerCase().includes('basicpdf') || progId.toLowerCase().includes('basic pdf');
      return { progId, isBasicPdfDefault };
    } catch {
      return { progId: '', isBasicPdfDefault: false };
    }
  });

  ipcMain.handle('desktop:open-default-apps-settings', async () => {
    const target = 'ms-settings:defaultapps';
    if (!isSafeExternalIntentUrl(target)) {
      return false;
    }
    await shell.openExternal(target);
    return true;
  });

  ipcMain.handle('desktop:get-app-info', (): DesktopAppInfo => {
    return {
      version: getRealAppVersion(),
      platform: process.platform,
      defaultUpdateRepo: DEFAULT_UPDATE_REPO,
      isPackaged: app.isPackaged,
    };
  });

  // Vérification facultative déclenchée uniquement sur clic utilisateur explicite
  ipcMain.handle('desktop:check-updates', async (_event, repoSlug: string) => {
    const slug = sanitizeGithubRepoSlug(String(repoSlug || DEFAULT_UPDATE_REPO));
    if (!slug) {
      throw new Error('Dépôt GitHub invalide (exemple : utilisateur/basic-pdf).');
    }
    return checkGithubUpdate(slug, getRealAppVersion());
  });

  ipcMain.handle(
    'desktop:download-verify-update',
    async (_event, installerUrl: string, fileName: string, expectedSha256: string) => {
      const updatesDir = path.join(app.getPath('userData'), 'verified-updates');
      fs.mkdirSync(updatesDir, { recursive: true });
      const result = await downloadAndVerifyInstaller(
        installerUrl,
        fileName,
        expectedSha256,
        updatesDir,
      );
      verifiedUpdateInstallers.add(path.resolve(result.installerPath).toLowerCase());
      return result;
    },
  );

  ipcMain.handle('desktop:launch-verified-installer', async (_event, installerPath: string) => {
    const resolved = path.resolve(String(installerPath || ''));
    const updatesDir = path.join(app.getPath('userData'), 'verified-updates');
    if (
      !verifiedUpdateInstallers.has(resolved.toLowerCase()) ||
      !isPathInsideAnyDirectory(resolved, [updatesDir]) ||
      !fs.existsSync(resolved)
    ) {
      return {
        ok: false,
        error: "L'installateur n'a pas été vérifié par SHA-256 : lancement refusé.",
      };
    }

    const errStr = await shell.openPath(resolved);
    if (errStr) {
      return { ok: false, error: `Impossible de lancer l'installateur : ${errStr}` };
    }
    setTimeout(() => app.quit(), 400);
    return { ok: true };
  });
}

// Verrou d'instance unique : un double-clic dans l'Explorateur ouvre un onglet dans la fenêtre existante
const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', (_event, commandLine, workingDirectory) => {
    const incomingFiles = enqueueArgvPdfFiles(commandLine, workingDirectory);
    if (mainWindow) {
      if (mainWindow.isMinimized()) {
        mainWindow.restore();
      }
      mainWindow.focus();
      if (incomingFiles.length > 0) {
        if (mainWindow.webContents.isLoading()) {
          pendingOpenFiles.push(...incomingFiles);
        } else {
          mainWindow.webContents.send('desktop:open-files', incomingFiles);
        }
      }
    } else if (incomingFiles.length > 0) {
      pendingOpenFiles.push(...incomingFiles);
    }
  });

  app.whenReady().then(async () => {
    loadPersistedApprovedPaths();

    // Sert uniquement les fichiers statiques empaquetés dans dist/ via app://basic-pdf/
    const distDir = getDistDirectory();
    protocol.handle(CUSTOM_PROTOCOL_SCHEME, (request) => {
      const parsed = new URL(request.url);
      let relPath = decodeURIComponent(parsed.pathname).replace(/^\/+/, '');
      if (!relPath) {
        relPath = 'index.html';
      }
      const targetPath = path.resolve(distDir, relPath);
      if (!isPathInsideAnyDirectory(targetPath, [distDir])) {
        return new Response('Accès refusé', { status: 403 });
      }
      return net.fetch(pathToFileURL(targetPath).toString());
    });

    // Pare-feu strict sur l'interface : aucune requête réseau sortante possible depuis la vue HTML
    const devOrigin = process.env.VITE_DEV_SERVER_URL
      ? new URL(process.env.VITE_DEV_SERVER_URL).origin
      : null;

    session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
      if (
        details.url.startsWith(CUSTOM_PROTOCOL_ORIGIN) ||
        isAllowedRendererUrl(details.url, devOrigin)
      ) {
        callback({ cancel: false });
        return;
      }
      callback({ cancel: true });
    });

    // En-tête CSP strict dans Electron en mode production (autorise WASM OCR local sans réseau)
    if (!devOrigin) {
      session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
        if (!details.url.startsWith(CUSTOM_PROTOCOL_ORIGIN)) {
          callback({ responseHeaders: details.responseHeaders });
          return;
        }
        callback({
          responseHeaders: {
            ...details.responseHeaders,
            'Content-Security-Policy': [
              "default-src 'self' blob: data:; script-src 'self' 'wasm-unsafe-eval' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; worker-src 'self' blob:; connect-src 'self' blob: data:;",
            ],
          },
        });
      });
    }

    // Charge les éventuels fichiers .pdf passés au lancement (double-clic depuis l'Explorateur)
    pendingOpenFiles.push(...enqueueArgvPdfFiles(process.argv.slice(1)));

    registerIpcHandlers();
    await createMainWindow();
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });
}
