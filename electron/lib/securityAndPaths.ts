// Utilitaires de sécurité et validation des chemins pour Basic PDF sous Windows (Electron)
import fs from 'node:fs';
import path from 'node:path';

/** URLs système Windows strictement autorisées à être ouvertes depuis l'interface */
const ALLOWED_EXTERNAL_EXACT = new Set(['ms-settings:defaultapps']);

/**
 * Vérifie qu'une URL externe demandée par l'interface est strictement inoffensive :
 * - soit l'ouverture des paramètres Windows "Applications par défaut"
 * - soit un lien mailto: sans caractères de contrôle
 */
export function isSafeExternalIntentUrl(rawUrl: string): boolean {
  if (!rawUrl || typeof rawUrl !== 'string') {
    return false;
  }
  if (ALLOWED_EXTERNAL_EXACT.has(rawUrl)) {
    return true;
  }
  if (rawUrl.startsWith('mailto:') && !/[\r\n\0]/.test(rawUrl) && rawUrl.length <= 2000) {
    return true;
  }
  return false;
}

/**
 * Vérifie que les premiers octets d'un fichier correspondent bien à une signature PDF (%PDF-).
 */
export function hasValidPdfSignature(bytes: Uint8Array): boolean {
  if (bytes.byteLength < 5) {
    return false;
  }
  // Tolère jusqu'à 1024 octets de préambule avant %PDF- (conforme à la norme PDF)
  const limit = Math.min(bytes.byteLength - 5, 1024);
  for (let i = 0; i <= limit; i += 1) {
    if (
      bytes[i] === 0x25 && // %
      bytes[i + 1] === 0x50 && // P
      bytes[i + 2] === 0x44 && // D
      bytes[i + 3] === 0x46 && // F
      bytes[i + 4] === 0x2d // -
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Extrait uniquement les chemins de fichiers .pdf valides passés en ligne de commande
 * (double-clic depuis l'Explorateur Windows ou passage à une instance déjà ouverte).
 */
export function extractPdfPathsFromArgv(
  argv: string[],
  workingDir = process.cwd(),
): string[] {
  const results: string[] = [];
  const seen = new Set<string>();

  for (const rawArg of argv) {
    if (!rawArg || rawArg.startsWith('-')) {
      continue;
    }
    const trimmed = rawArg.replace(/^"|"$/g, '').trim();
    if (!trimmed.toLowerCase().endsWith('.pdf')) {
      continue;
    }
    const resolved = path.isAbsolute(trimmed)
      ? path.normalize(trimmed)
      : path.resolve(workingDir, trimmed);
    const key = resolved.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    try {
      const stat = fs.statSync(resolved);
      if (stat.isFile()) {
        seen.add(key);
        results.push(resolved);
      }
    } catch {
      // Ignore les arguments inexistants ou inaccessibles
    }
  }

  return results;
}

/**
 * Vérifie si un chemin résolu se trouve bien à l'intérieur d'un des dossiers autorisés
 * (utilisé pour éviter toute traversée de répertoire hors des dossiers prévus).
 */
export function isPathInsideAnyDirectory(targetPath: string, allowedDirs: string[]): boolean {
  const normalizedTarget = path.resolve(targetPath).toLowerCase();
  for (const dir of allowedDirs) {
    if (!dir) {
      continue;
    }
    const normalizedDir = path.resolve(dir).toLowerCase();
    const withSep = normalizedDir.endsWith(path.sep)
      ? normalizedDir
      : `${normalizedDir}${path.sep}`;
    if (normalizedTarget === normalizedDir || normalizedTarget.startsWith(withSep)) {
      return true;
    }
  }
  return false;
}

/**
 * Registre mémoire des chemins PDF explicitement autorisés par l'utilisateur
 * (via dialogue système Windows ou ouverture par double-clic).
 * Empêche le moteur d'interface d'écrire ou lire un chemin arbitraire du disque.
 */
export class ApprovedPathStore {
  private readonly approved = new Set<string>();

  public approve(filePath: string): string {
    const resolved = path.resolve(filePath);
    this.approved.add(resolved.toLowerCase());
    return resolved;
  }

  public isApproved(filePath: string): boolean {
    if (!filePath || typeof filePath !== 'string') {
      return false;
    }
    return this.approved.has(path.resolve(filePath).toLowerCase());
  }

  public clear(): void {
    this.approved.clear();
  }
}

/**
 * Écrit un fichier PDF de manière atomique (fichier temporaire puis remplacement)
 * pour éviter toute corruption en cas d'interruption pendant l'écriture.
 */
export function writeFileAtomically(targetPath: string, bytes: Uint8Array): void {
  const resolved = path.resolve(targetPath);
  const dir = path.dirname(resolved);
  const base = path.basename(resolved);
  const tempPath = path.join(dir, `.${base}.${process.pid}.${Date.now()}.tmp`);

  fs.writeFileSync(tempPath, bytes);
  try {
    fs.renameSync(tempPath, resolved);
  } catch (err) {
    // Nettoyage du fichier temporaire si le renommage échoue
    try {
      fs.unlinkSync(tempPath);
    } catch {
      // Ignoré
    }
    throw err;
  }
}

/**
 * Vérifie qu'une requête réseau émanant du moteur d'affichage reste strictement locale.
 * Aucune connexion distante ne doit jamais partir automatiquement de l'interface.
 */
export function isAllowedRendererUrl(
  rawUrl: string,
  devServerOrigin: string | null = null,
): boolean {
  if (!rawUrl || typeof rawUrl !== 'string') {
    return false;
  }
  if (
    rawUrl.startsWith('file://') ||
    rawUrl.startsWith('blob:') ||
    rawUrl.startsWith('data:') ||
    rawUrl.startsWith('devtools://') ||
    rawUrl.startsWith('chrome-extension://')
  ) {
    return true;
  }
  if (devServerOrigin && rawUrl.startsWith(devServerOrigin)) {
    return true;
  }
  return false;
}
