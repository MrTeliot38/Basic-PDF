// Calcul automatique du versionCode Android et comparaison de versions pour les mises à jour

/**
 * Calcule le code de version entier exigé par Android à partir du numéro sémantique :
 * formule : majeur × 10000 + mineur × 100 + correctif
 * Exemple : "0.1.0" -> 100, "1.2.3" -> 10203
 */
export function computeAndroidVersionCode(semver: string): number {
  const cleaned = semver.trim().replace(/^v/i, '').split(/[-+]/)[0];
  const parts = cleaned.split('.');
  if (parts.length < 2 || parts.length > 3) {
    throw new Error(`Numéro de version invalide pour Android : "${semver}"`);
  }

  const nums = [0, 0, 0];
  for (let i = 0; i < 3; i += 1) {
    const raw = parts[i] ?? '0';
    if (!/^\d+$/.test(raw)) {
      throw new Error(`Segment de version non numérique dans "${semver}"`);
    }
    const parsed = Number.parseInt(raw, 10);
    if (i > 0 && parsed > 99) {
      throw new Error(`Le segment mineur/correctif doit être <= 99 (reçu ${parsed})`);
    }
    nums[i] = parsed;
  }

  const [major, minor, patch] = nums;
  const code = major * 10000 + minor * 100 + patch;
  if (code <= 0) {
    throw new Error(`Le versionCode Android doit être strictement positif (reçu ${code})`);
  }
  return code;
}

/** Compare deux versions sémantiques ("0.2.0" > "0.1.0" -> 1) */
export function compareSemverStrings(a: string, b: string): number {
  const parse = (v: string) =>
    v
      .trim()
      .replace(/^v/i, '')
      .split(/[-+]/)[0]
      .split('.')
      .map((n) => Number.parseInt(n, 10) || 0);

  const pa = parse(a);
  const pb = parse(b);
  const len = Math.max(pa.length, pb.length, 3);
  for (let i = 0; i < len; i += 1) {
    const va = pa[i] ?? 0;
    const vb = pb[i] ?? 0;
    if (va > vb) return 1;
    if (va < vb) return -1;
  }
  return 0;
}

/** Extrait l'empreinte SHA-256 attendue pour un fichier donné dans un fichier SHA256SUMS.txt */
export function parseSha256SumsForFile(content: string, targetFileName: string): string | null {
  const lowerTarget = targetFileName.toLowerCase();
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;

    const named = line.match(/^([a-fA-F0-9]{64})\s+\*?(.+)$/);
    if (named) {
      const filePart = named[2].trim().split(/[\\/]/).pop()?.toLowerCase() ?? '';
      if (filePart === lowerTarget) {
        return named[1].toLowerCase();
      }
      continue;
    }

    if (/^[a-fA-F0-9]{64}$/.test(line)) {
      return line.toLowerCase();
    }
  }
  return null;
}

/** Raccourcit un nom de fichier trop long pour l'enregistrement Android en gardant l'extension .pdf */
export function sanitizeAndroidPdfFileName(rawName: string): string {
  const cleaned = rawName
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_')
    .trim();
  const withExt = cleaned.toLowerCase().endsWith('.pdf') ? cleaned : `${cleaned || 'document'}.pdf`;
  if (withExt.length <= 80) {
    return withExt;
  }
  const base = withExt.slice(0, -4).slice(0, 76);
  return `${base}.pdf`;
}
