// Contrats TypeScript entre l'interface web Basic PDF et le plugin natif Android (Capacitor)

export interface AndroidIncomingPdf {
  uri: string;
  fileName: string;
  writable: boolean;
  base64Data: string;
}

export interface AndroidSaveResult {
  ok: boolean;
  canceled?: boolean;
  needsSaveAs?: boolean;
  uri?: string;
  fileName?: string;
  bytesWritten?: number;
  error?: string;
}

export interface AndroidAppInfo {
  versionName: string;
  versionCode: number;
  sdkInt: number;
  defaultUpdateRepo: string;
}

export interface AndroidUpdateCheckResult {
  currentVersion: string;
  currentVersionCode: number;
  latestVersion: string;
  latestVersionCode: number | null;
  updateAvailable: boolean;
  apkUrl: string | null;
  apkFileName: string | null;
  expectedSha256: string | null;
  releaseNotes: string;
  releasePageUrl: string;
}

export interface AndroidDownloadInstallResult {
  ok: boolean;
  installerLaunched?: boolean;
  needsUnknownSourcePermission?: boolean;
  actualSha256?: string;
  apkPath?: string;
  error?: string;
}

export interface AndroidCameraPhotoResult {
  canceled?: boolean;
  imageDataUrl?: string;
  error?: string;
}

export interface BasicPdfAndroidNativePlugin {
  getAppInfo(): Promise<AndroidAppInfo>;
  getPendingIncomingPdfs(): Promise<{ files: AndroidIncomingPdf[] }>;
  savePdfDirect(options: { uri: string; base64Data: string; fileName: string }): Promise<AndroidSaveResult>;
  savePdfAs(options: { fileName: string; base64Data: string }): Promise<AndroidSaveResult>;
  sharePdf(options: { fileName: string; base64Data: string }): Promise<{ ok: boolean; error?: string }>;
  requestCameraPermission(): Promise<{ granted: boolean }>;
  captureDocumentPhoto(): Promise<AndroidCameraPhotoResult>;
  openDefaultAppsSettings(): Promise<{ opened: boolean }>;
  checkForUpdates(options: { repoSlug: string }): Promise<AndroidUpdateCheckResult>;
  downloadAndInstallUpdate(options: {
    apkUrl: string;
    apkFileName: string;
    expectedSha256: string;
  }): Promise<AndroidDownloadInstallResult>;
  getSystemInsets(): Promise<{ topPx: number; bottomPx: number; imePx: number }>;
  addListener(
    eventName: 'incomingPdfs',
    listenerFunc: (data: { files: AndroidIncomingPdf[] }) => void,
  ): Promise<{ remove: () => Promise<void> }>;
  addListener(
    eventName: 'insetsChanged',
    listenerFunc: (data: { topPx: number; bottomPx: number; imePx: number }) => void,
  ): Promise<{ remove: () => Promise<void> }>;
}
