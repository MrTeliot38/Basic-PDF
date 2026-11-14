// Vérification facultative des mises à jour GitHub (à la demande uniquement) et contrôle d'intégrité SHA-256
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export interface AvailableUpdateInfo {
  currentVersion: string;
  latestVersion: string;
  updateAvailable: boolean;
  installerUrl: string | null;
  installerFileName: string | null;
  expectedSha256: string | null;
  releaseNotes: string;
  releasePageUrl: string;
}

/** Domaines HTTPS officiels GitHub autorisés lors d'une vérification manuelle */
const ALLOWED_UPDATE_HOSTS = new Set([
  'api.github.com',
  'github.com',
  'objects.githubusercontent.com',
  'release-assets.githubusercontent.com',
]);

/** Compare deux versions sémantiques ("0.2.1" > "0.2.0" -> 1) */
export function compareSemver(a: string, b: string): number {
  const parse = (v: string) =>
    v
      .replace(/^v/i, '')
      .split(/[-+]/)[0]
      .split('.')
      .map((n) => Number.parseInt(n, 10) || 0);

  const pa = parse(a);
  const pb = parse(b);
  const maxLen = Math.max(pa.length, pb.length, 3);

  for (let i = 0; i < maxLen; i += 1) {
    const va = pa[i] ?? 0;
    const vb = pb[i] ?? 0;
    if (va > vb) return 1;
    if (va < vb) return -1;
  }
  return 0;
}

/** Valide strictement qu'un nom de dépôt respecte la forme "proprietaire/depot" */
export function sanitizeGithubRepoSlug(rawSlug: string): string | null {
  const trimmed = rawSlug.trim().replace(/^https?:\/\/github\.com\//i, '').replace(/\.git$/i, '').replace(/\/+$/, '');
  if (!/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(trimmed)) {
    return null;
  }
  return trimmed;
}

/** Vérifie qu'une URL de téléchargement pointe exclusivement vers GitHub en HTTPS */
export function isAllowedUpdateDownloadUrl(rawUrl: string): boolean {
  try {
    const parsed = new URL(rawUrl);
    return parsed.protocol === 'https:' && ALLOWED_UPDATE_HOSTS.has(parsed.hostname.toLowerCase());
  } catch {
    return false;
  }
}

/** Calcule l'empreinte SHA-256 hexadécimale en minuscules */
export function computeSha256Hex(bytes: Uint8Array | Buffer): string {
  return crypto.createHash('sha256').update(bytes).digest('hex').toLowerCase();
}

/** Vérifie de manière stricte que les octets téléchargés correspondent à l'empreinte SHA-256 attendue */
export function verifyBufferSha256(bytes: Uint8Array | Buffer, expectedHex: string): boolean {
  const normalizedExpected = expectedHex.trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(normalizedExpected)) {
    return false;
  }
  const actual = computeSha256Hex(bytes);
  return crypto.timingSafeEqual(Buffer.from(actual, 'hex'), Buffer.from(normalizedExpected, 'hex'));
}

/** Extrait l'empreinte SHA-256 d'un fichier texte SHA256SUMS.txt ou d'un fichier .sha256 */
export function parseSha256SumsText(content: string, targetFileName: string): string | null {
  const lines = content.split(/\r?\n/);
  const targetLower = targetFileName.toLowerCase();

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Format standard : "<64 hex>  NomDuFichier.exe" ou "<64 hex> *NomDuFichier.exe"
    const matchWithName = trimmed.match(/^([a-fA-F0-9]{64})\s+\*?(.+)$/);
    if (matchWithName) {
      const candidateName = path.basename(matchWithName[2].trim()).toLowerCase();
      if (candidateName === targetLower) {
        return matchWithName[1].toLowerCase();
      }
      continue;
    }

    // Format fichier .sha256 dédié contenant uniquement le hash
    const singleHash = trimmed.match(/^([a-fA-F0-9]{64})$/);
    if (singleHash && lines.filter((l) => l.trim().length > 0).length === 1) {
      return singleHash[1].toLowerCase();
    }
  }

  return null;
}

interface GithubAssetLike {
  name?: unknown;
  browser_download_url?: unknown;
}

interface GithubReleaseLike {
  tag_name?: unknown;
  body?: unknown;
  html_url?: unknown;
  assets?: unknown;
}

/**
 * Interprète la réponse JSON de l'API GitHub Releases et recherche l'installateur .exe Windows
 * ainsi que le fichier de somme de contrôle SHA-256 associé.
 */
export function parseGithubReleasePayload(
  payload: unknown,
  currentVersion: string,
): AvailableUpdateInfo {
  const rel = (payload ?? {}) as GithubReleaseLike;
  const tagName = typeof rel.tag_name === 'string' ? rel.tag_name : currentVersion;
  const latestVersion = tagName.replace(/^v/i, '').trim() || currentVersion;
  const releaseNotes = typeof rel.body === 'string' ? rel.body.slice(0, 1200) : '';
  const releasePageUrl = typeof rel.html_url === 'string' ? rel.html_url : '';

  const assets: GithubAssetLike[] = Array.isArray(rel.assets) ? rel.assets : [];
  const exeAsset = assets.find(
    (a) =>
      typeof a.name === 'string' &&
      a.name.toLowerCase().endsWith('.exe') &&
      !a.name.toLowerCase().includes('.blockmap'),
  );

  const installerFileName = typeof exeAsset?.name === 'string' ? exeAsset.name : null;
  const installerUrl =
    typeof exeAsset?.browser_download_url === 'string' &&
    isAllowedUpdateDownloadUrl(exeAsset.browser_download_url)
      ? exeAsset.browser_download_url
      : null;

  return {
    currentVersion,
    latestVersion,
    updateAvailable: compareSemver(latestVersion, currentVersion) > 0,
    installerUrl,
    installerFileName,
    expectedSha256: null,
    releaseNotes,
    releasePageUrl,
  };
}

/**
 * Interroge GitHub Releases uniquement sur demande explicite de l'utilisateur
 * et récupère le SHA-256 officiel associé à l'installateur Windows.
 */
export async function checkGithubUpdate(
  repoSlug: string,
  currentVersion: string,
  fetchFn: typeof fetch = fetch,
): Promise<AvailableUpdateInfo> {
  const cleanRepo = sanitizeGithubRepoSlug(repoSlug);
  if (!cleanRepo) {
    throw new Error('Identifiant de dépôt GitHub invalide (exemple attendu : nom/basic-pdf).');
  }

  const apiUrl = `https://api.github.com/repos/${cleanRepo}/releases/latest`;
  const response = await fetchFn(apiUrl, {
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'Basic-PDF-Windows-Updater',
    },
  });

  if (response.status === 404) {
    throw new Error(
      `Aucune version publiée trouvée sur GitHub pour « ${cleanRepo} ».`,
    );
  }
  if (!response.ok) {
    throw new Error(`Impossible de joindre GitHub (code ${response.status}).`);
  }

  const releaseJson = (await response.json()) as GithubReleaseLike & {
    assets?: GithubAssetLike[];
  };
  const info = parseGithubReleasePayload(releaseJson, currentVersion);

  // Recherche du fichier SHA-256 officiel parmi les assets de la release
  if (info.installerFileName && Array.isArray(releaseJson.assets)) {
    const shaAsset = releaseJson.assets.find(
      (a) =>
        typeof a.name === 'string' &&
        (a.name.toLowerCase() === `${info.installerFileName!.toLowerCase()}.sha256` ||
          a.name.toLowerCase() === 'sha256sums.txt' ||
          a.name.toLowerCase().endsWith('.sha256')),
    );

    if (
      typeof shaAsset?.browser_download_url === 'string' &&
      isAllowedUpdateDownloadUrl(shaAsset.browser_download_url)
    ) {
      const shaResp = await fetchFn(shaAsset.browser_download_url, {
        headers: { 'User-Agent': 'Basic-PDF-Windows-Updater' },
      });
      if (shaResp.ok) {
        const shaText = await shaResp.text();
        info.expectedSha256 = parseSha256SumsText(shaText, info.installerFileName);
      }
    }
  }

  return info;
}

/**
 * Télécharge l'installateur dans un dossier temporaire et refuse catégoriquement tout fichier
 * dont l'empreinte SHA-256 ne correspond pas exactement.
 */
export async function downloadAndVerifyInstaller(
  installerUrl: string,
  fileName: string,
  expectedSha256: string,
  destDir: string,
  fetchFn: typeof fetch = fetch,
): Promise<{ installerPath: string; actualSha256: string }> {
  if (!isAllowedUpdateDownloadUrl(installerUrl)) {
    throw new Error('Source de téléchargement non autorisée.');
  }
  const normalizedExpected = expectedSha256.trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(normalizedExpected)) {
    throw new Error(
      "Aucune empreinte SHA-256 valide n'est fournie : installation bloquée par sécurité.",
    );
  }

  const response = await fetchFn(installerUrl, {
    headers: { 'User-Agent': 'Basic-PDF-Windows-Updater' },
  });
  if (!response.ok) {
    throw new Error(`Le téléchargement a échoué (code ${response.status}).`);
  }

  const arrayBuffer = await response.arrayBuffer();
  const bytes = Buffer.from(arrayBuffer);
  const actualSha256 = computeSha256Hex(bytes);

  if (!verifyBufferSha256(bytes, normalizedExpected)) {
    throw new Error(
      `Alerte d'intégrité : l'empreinte SHA-256 du fichier téléchargé (${actualSha256.slice(
        0,
        12,
      )}…) ne correspond pas à celle attendue (${normalizedExpected.slice(0, 12)}…).`,
    );
  }

  const safeName = path.basename(fileName).replace(/[^a-zA-Z0-9._-]/g, '_');
  const finalName = safeName.toLowerCase().endsWith('.exe') ? safeName : `${safeName}.exe`;
  const installerPath = path.join(destDir, finalName);
  fs.writeFileSync(installerPath, bytes);

  return { installerPath, actualSha256 };
}
