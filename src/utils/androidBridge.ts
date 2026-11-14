// Passerelle vers le plugin natif Android (Capacitor) avec conversion base64 sûre et repli web
import { Capacitor, registerPlugin } from '@capacitor/core';
import type {
  AndroidAppInfo,
  AndroidCameraPhotoResult,
  AndroidDownloadInstallResult,
  AndroidIncomingPdf,
  AndroidSaveResult,
  AndroidUpdateCheckResult,
  BasicPdfAndroidNativePlugin,
} from '../types/android';
import { sanitizeAndroidPdfFileName } from './androidVersion';

const BasicPdfAndroidPlugin = registerPlugin<BasicPdfAndroidNativePlugin>('BasicPdfAndroid');

/** Retourne vrai uniquement quand l'application s'exécute dans l'application Android native Capacitor */
export function isAndroidNativeApp(): boolean {
  try {
    return (
      typeof window !== 'undefined' &&
      Capacitor.isNativePlatform() &&
      Capacitor.getPlatform() === 'android'
    );
  } catch {
    return false;
  }
}

/** Convertit un tableau d'octets PDF en base64 sans déborder la pile d'appels sur gros fichiers */
export function uint8ArrayToBase64(bytes: Uint8Array): string {
  const chunkSize = 0x8000;
  const parts: string[] = [];
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const slice = bytes.subarray(i, Math.min(i + chunkSize, bytes.length));
    parts.push(String.fromCharCode(...slice));
  }
  return btoa(parts.join(''));
}

/** Décode une chaîne base64 en Uint8Array pour charger le PDF */
export function base64ToUint8Array(base64: string): Uint8Array {
  const binary = atob(base64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    out[i] = binary.charCodeAt(i);
  }
  return out;
}

export interface DecodedIncomingPdf {
  uri: string;
  fileName: string;
  writable: boolean;
  bytes: Uint8Array;
}

function decodeIncomingList(files: AndroidIncomingPdf[]): DecodedIncomingPdf[] {
  const decoded: DecodedIncomingPdf[] = [];
  for (const item of files) {
    if (!item.base64Data) continue;
    const bytes = base64ToUint8Array(item.base64Data);
    if (bytes.byteLength === 0) continue;
    decoded.push({
      uri: item.uri,
      fileName: sanitizeAndroidPdfFileName(item.fileName || 'document.pdf'),
      writable: Boolean(item.writable),
      bytes,
    });
  }
  return decoded;
}

export async function getAndroidPendingPdfs(): Promise<DecodedIncomingPdf[]> {
  if (!isAndroidNativeApp()) return [];
  const res = await BasicPdfAndroidPlugin.getPendingIncomingPdfs();
  return decodeIncomingList(res.files ?? []);
}

export function subscribeAndroidIncomingPdfs(
  callback: (files: DecodedIncomingPdf[]) => void,
): () => void {
  if (!isAndroidNativeApp()) {
    return () => {};
  }
  let removed = false;
  let removeHandle: (() => Promise<void>) | null = null;

  void BasicPdfAndroidPlugin.addListener('incomingPdfs', (payload) => {
    const decoded = decodeIncomingList(payload.files ?? []);
    if (decoded.length > 0) {
      callback(decoded);
    }
  }).then((handle) => {
    if (removed) {
      void handle.remove();
    } else {
      removeHandle = handle.remove;
    }
  });

  return () => {
    removed = true;
    if (removeHandle) {
      void removeHandle();
    }
  };
}

export async function savePdfAndroidDirect(
  uri: string,
  fileName: string,
  bytes: Uint8Array,
): Promise<AndroidSaveResult> {
  if (!isAndroidNativeApp()) {
    return { ok: false, needsSaveAs: true };
  }
  if (bytes.byteLength === 0) {
    return { ok: false, error: 'Impossible d’enregistrer un PDF vide (0 Ko).' };
  }
  return BasicPdfAndroidPlugin.savePdfDirect({
    uri,
    fileName: sanitizeAndroidPdfFileName(fileName),
    base64Data: uint8ArrayToBase64(bytes),
  });
}

export async function savePdfAndroidAs(
  fileName: string,
  bytes: Uint8Array,
): Promise<AndroidSaveResult> {
  if (!isAndroidNativeApp()) {
    return { ok: false, canceled: true };
  }
  if (bytes.byteLength === 0) {
    return { ok: false, error: 'Impossible d’enregistrer un PDF vide (0 Ko).' };
  }
  return BasicPdfAndroidPlugin.savePdfAs({
    fileName: sanitizeAndroidPdfFileName(fileName),
    base64Data: uint8ArrayToBase64(bytes),
  });
}

export async function sharePdfAndroidNative(
  fileName: string,
  bytes: Uint8Array,
): Promise<{ ok: boolean; error?: string }> {
  if (!isAndroidNativeApp()) {
    return { ok: false, error: 'Partage natif disponible uniquement sur Android.' };
  }
  if (bytes.byteLength === 0) {
    return { ok: false, error: 'Le PDF à partager est vide (0 Ko).' };
  }
  return BasicPdfAndroidPlugin.sharePdf({
    fileName: sanitizeAndroidPdfFileName(fileName),
    base64Data: uint8ArrayToBase64(bytes),
  });
}

export async function requestAndroidCameraPermission(): Promise<boolean> {
  if (!isAndroidNativeApp()) return true;
  const res = await BasicPdfAndroidPlugin.requestCameraPermission();
  return Boolean(res.granted);
}

export async function captureAndroidDocumentPhoto(): Promise<AndroidCameraPhotoResult> {
  if (!isAndroidNativeApp()) {
    return { canceled: true };
  }
  return BasicPdfAndroidPlugin.captureDocumentPhoto();
}

export async function getAndroidAppInfo(): Promise<AndroidAppInfo | null> {
  if (!isAndroidNativeApp()) return null;
  return BasicPdfAndroidPlugin.getAppInfo();
}

export async function openAndroidDefaultAppsSettings(): Promise<boolean> {
  if (!isAndroidNativeApp()) return false;
  const res = await BasicPdfAndroidPlugin.openDefaultAppsSettings();
  return Boolean(res.opened);
}

export async function checkAndroidUpdates(repoSlug: string): Promise<AndroidUpdateCheckResult> {
  return BasicPdfAndroidPlugin.checkForUpdates({ repoSlug });
}

export async function downloadAndInstallAndroidUpdate(
  apkUrl: string,
  apkFileName: string,
  expectedSha256: string,
): Promise<AndroidDownloadInstallResult> {
  return BasicPdfAndroidPlugin.downloadAndInstallUpdate({
    apkUrl,
    apkFileName,
    expectedSha256,
  });
}

/** Applique les marges système (barre d'état / navigation / clavier) sur les variables CSS globales */
export function initAndroidSystemInsetsListener(): () => void {
  if (!isAndroidNativeApp() || typeof document === 'undefined') {
    return () => {};
  }

  const applyInsets = (insets: { topPx: number; bottomPx: number; imePx: number }) => {
    const root = document.documentElement;
    root.style.setProperty('--android-inset-top', `${Math.max(0, Math.round(insets.topPx))}px`);
    root.style.setProperty(
      '--android-inset-bottom',
      `${Math.max(0, Math.round(insets.bottomPx))}px`,
    );
    root.style.setProperty('--android-ime-bottom', `${Math.max(0, Math.round(insets.imePx))}px`);
  };

  void BasicPdfAndroidPlugin.getSystemInsets()
    .then(applyInsets)
    .catch(() => {});

  let removed = false;
  let removeHandle: (() => Promise<void>) | null = null;
  void BasicPdfAndroidPlugin.addListener('insetsChanged', applyInsets).then((handle) => {
    if (removed) {
      void handle.remove();
    } else {
      removeHandle = handle.remove;
    }
  });

  return () => {
    removed = true;
    if (removeHandle) {
      void removeHandle();
    }
  };
}
