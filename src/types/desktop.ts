// Contrat typé entre le processus principal Electron (Windows) et l'interface web Basic PDF

export interface DesktopOpenedFile {
  filePath: string;
  fileName: string;
  bytes: Uint8Array;
}

export interface DesktopSystemFontInfo {
  family: string;
  category: 'sans-serif' | 'serif' | 'monospace';
  embeddable: boolean;
}

export interface DesktopPrintSheetPayload {
  gridCols: number;
  gridRows: number;
  marginMm: number;
  headerText?: string;
  footerText?: string;
  cells: Array<{
    imageDataUrl?: string;
  }>;
}

export interface DesktopPrintRequest {
  title: string;
  paperSize: 'A4' | 'A5' | 'Letter' | 'A3';
  widthMm: number;
  heightMm: number;
  landscape: boolean;
  sheets: DesktopPrintSheetPayload[];
}

export interface DesktopUpdateCheckResult {
  currentVersion: string;
  latestVersion: string;
  updateAvailable: boolean;
  installerUrl: string | null;
  installerFileName: string | null;
  expectedSha256: string | null;
  releaseNotes: string;
  releasePageUrl: string;
}

export interface DesktopDefaultPdfStatus {
  progId: string;
  isBasicPdfDefault: boolean;
}

export interface DesktopAppInfo {
  version: string;
  platform: string;
  defaultUpdateRepo: string;
  isPackaged: boolean;
}

export interface BasicPdfDesktopBridge {
  readonly isDesktop: true;
  readonly platform: string;

  // Fichiers & double-clic Explorateur
  getPendingOpenFiles: () => Promise<DesktopOpenedFile[]>;
  onOpenFiles: (callback: (files: DesktopOpenedFile[]) => void) => () => void;
  openPdfDialog: () => Promise<DesktopOpenedFile[]>;
  openPdfAtPath: (filePath: string) => Promise<DesktopOpenedFile | null>;
  savePdfDirect: (
    filePath: string,
    bytes: Uint8Array,
  ) => Promise<{ ok: boolean; filePath: string; error?: string }>;
  savePdfAsDialog: (
    defaultName: string,
    bytes: Uint8Array,
    existingPath?: string,
  ) => Promise<{
    canceled: boolean;
    filePath?: string;
    fileName?: string;
    error?: string;
  }>;

  // Partage simplifié sous Windows
  preparePdfForShare: (
    suggestedName: string,
    bytes: Uint8Array,
  ) => Promise<{ ok: boolean; filePath?: string; error?: string }>;
  revealInExplorer: (filePath: string) => Promise<boolean>;
  openMailClient: (subject: string, body: string) => Promise<boolean>;

  // Polices Windows installées
  listSystemFonts: () => Promise<DesktopSystemFontInfo[]>;
  readSystemFontBytes: (
    familyCss: string,
    bold: boolean,
    italic: boolean,
  ) => Promise<Uint8Array | null>;

  // Impression native Windows
  printSheetsNative: (
    request: DesktopPrintRequest,
  ) => Promise<{ ok: boolean; canceled?: boolean; error?: string }>;

  // Lecteur par défaut & Mises à jour opt-in SHA-256
  getDefaultPdfStatus: () => Promise<DesktopDefaultPdfStatus>;
  openWindowsDefaultAppsSettings: () => Promise<boolean>;
  getAppInfo: () => Promise<DesktopAppInfo>;
  checkForUpdates: (repoSlug: string) => Promise<DesktopUpdateCheckResult>;
  downloadAndVerifyUpdate: (
    installerUrl: string,
    fileName: string,
    expectedSha256: string,
  ) => Promise<{ installerPath: string; actualSha256: string }>;
  launchVerifiedUpdateInstaller: (
    installerPath: string,
  ) => Promise<{ ok: boolean; error?: string }>;
}

declare global {
  interface Window {
    basicPdfDesktop?: BasicPdfDesktopBridge;
  }
}
