// Énumération sécurisée des polices installées sur Windows et résolution des fichiers TTF/OTF
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import {
  classifyFontCategory,
  findClosestInstalledFontName,
  type FontVisualCategory,
} from '../../src/utils/fontMatching';
import { isPathInsideAnyDirectory } from './securityAndPaths';

export { classifyFontCategory, findClosestInstalledFontName, type FontVisualCategory };

const execFileAsync = promisify(execFile);

export interface FontStyleVariants {
  regular?: string;
  bold?: string;
  italic?: string;
  boldItalic?: string;
}

export interface SystemFontEntry {
  family: string;
  category: FontVisualCategory;
  embeddable: boolean;
  variants: FontStyleVariants;
}

/**
 * Décompose un libellé du Registre Windows (ex. "Calibri Bold Italic (TrueType)")
 * en famille normalisée + indicateurs gras/italique.
 */
export function parseRegistryFontLabel(rawName: string): {
  family: string;
  bold: boolean;
  italic: boolean;
} {
  let clean = rawName
    .replace(/\s*\((TrueType|OpenType|All res|Type 1|WOFF)\)\s*$/i, '')
    .trim();

  // Ignore les variantes très spécialisées (Semilight, Condensed, etc.) tout en gérant Gras/Italique
  let bold = false;
  let italic = false;

  const stripSuffix = (pattern: RegExp) => {
    if (pattern.test(clean)) {
      clean = clean.replace(pattern, '').trim();
      return true;
    }
    return false;
  };

  if (stripSuffix(/\s+(Bold Italic|Gras Italique|Bold Oblique)$/i)) {
    bold = true;
    italic = true;
  } else {
    if (stripSuffix(/\s+(Italic|Italique|Oblique)$/i)) {
      italic = true;
    }
    if (stripSuffix(/\s+(Bold|Gras|DemiBold|SemiBold)$/i)) {
      bold = true;
    }
  }

  return {
    family: clean || rawName.trim(),
    bold,
    italic,
  };
}

/**
 * Analyse la sortie texte de `reg query` pour extraire les entrées de polices
 * et résoudre leurs chemins vers les répertoires de polices autorisés.
 */
export function parseWindowsFontsRegistryOutput(
  regStdout: string,
  defaultFontsDir: string,
  allowedDirs: string[],
): Map<string, SystemFontEntry> {
  const catalog = new Map<string, SystemFontEntry>();
  const lines = regStdout.split(/\r?\n/);

  for (const line of lines) {
    const match = line.match(/^\s{2,}(.+?)\s+REG_SZ\s+(.+?)\s*$/i);
    if (!match) {
      continue;
    }

    const rawLabel = match[1].trim();
    const rawTarget = match[2].trim();
    if (!rawTarget || !/\.(ttf|otf|ttc)$/i.test(rawTarget)) {
      continue;
    }

    const candidatePath = path.isAbsolute(rawTarget)
      ? path.resolve(rawTarget)
      : path.resolve(defaultFontsDir, rawTarget);

    if (!isPathInsideAnyDirectory(candidatePath, allowedDirs)) {
      continue;
    }

    // @pdf-lib/fontkit intègre nativement .ttf et .otf (les .ttc multi-polices sont laissés en secours)
    const isEmbeddableExt = /\.(ttf|otf)$/i.test(candidatePath);

    // Gère les libellés multi-noms du Registre ("Cambria & Cambria Math")
    const splitNames = rawLabel.includes('&')
      ? rawLabel.split('&').map((part) => part.trim())
      : [rawLabel];

    for (const partName of splitNames) {
      const parsed = parseRegistryFontLabel(partName);
      if (!parsed.family) {
        continue;
      }

      const key = parsed.family.toLowerCase();
      let entry = catalog.get(key);
      if (!entry) {
        entry = {
          family: parsed.family,
          category: classifyFontCategory(parsed.family),
          embeddable: isEmbeddableExt,
          variants: {},
        };
        catalog.set(key, entry);
      }

      if (isEmbeddableExt) {
        entry.embeddable = true;
      }

      const variantKey: keyof FontStyleVariants =
        parsed.bold && parsed.italic
          ? 'boldItalic'
          : parsed.bold
            ? 'bold'
            : parsed.italic
              ? 'italic'
              : 'regular';

      // Ne remplace pas un .ttf/.otf déjà connu par un .ttc
      if (!entry.variants[variantKey] || isEmbeddableExt) {
        entry.variants[variantKey] = candidatePath;
      }
    }
  }

  return catalog;
}

/** Retourne les dossiers Windows autorisés contenant les polices système et utilisateur */
export function getAllowedWindowsFontDirs(): string[] {
  const dirs: string[] = [];
  const winDir = process.env.WINDIR || 'C:\\Windows';
  dirs.push(path.join(winDir, 'Fonts'));
  if (process.env.LOCALAPPDATA) {
    dirs.push(path.join(process.env.LOCALAPPDATA, 'Microsoft', 'Windows', 'Fonts'));
  }
  return dirs;
}

/** Interroge le Registre Windows (système + utilisateur) sans lancer de shell externe */
export async function enumerateInstalledWindowsFonts(): Promise<SystemFontEntry[]> {
  const allowedDirs = getAllowedWindowsFontDirs();
  const defaultFontsDir = allowedDirs[0];
  const merged = new Map<string, SystemFontEntry>();

  const registryKeys = [
    'HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Fonts',
    'HKCU\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Fonts',
  ];

  for (const regKey of registryKeys) {
    try {
      const { stdout } = await execFileAsync('reg.exe', ['query', regKey], {
        windowsHide: true,
        timeout: 5000,
        maxBuffer: 2 * 1024 * 1024,
      });
      const parsed = parseWindowsFontsRegistryOutput(stdout, defaultFontsDir, allowedDirs);
      for (const [k, entry] of parsed.entries()) {
        const existing = merged.get(k);
        if (!existing) {
          merged.set(k, entry);
        } else {
          existing.embeddable = existing.embeddable || entry.embeddable;
          existing.variants = { ...existing.variants, ...entry.variants };
        }
      }
    } catch {
      // Ignore une ruche absente (ex. HKCU Fonts vide)
    }
  }

  // Fallback si reg.exe est indisponible : scanne directement le dossier C:\Windows\Fonts
  if (merged.size === 0 && fs.existsSync(defaultFontsDir)) {
    try {
      const files = fs.readdirSync(defaultFontsDir);
      for (const file of files) {
        if (!/\.(ttf|otf)$/i.test(file)) {
          continue;
        }
        const base = file.replace(/\.(ttf|otf)$/i, '');
        const fullPath = path.join(defaultFontsDir, file);
        const key = base.toLowerCase();
        if (!merged.has(key)) {
          merged.set(key, {
            family: base,
            category: classifyFontCategory(base),
            embeddable: true,
            variants: { regular: fullPath },
          });
        }
      }
    } catch {
      // Ignoré
    }
  }

  return Array.from(merged.values()).sort((a, b) =>
    a.family.localeCompare(b.family, 'fr', { sensitivity: 'base' }),
  );
}

/**
 * Sélectionne le chemin de fichier TTF/OTF correspondant le mieux à une famille et au style demandé.
 * Vérifie que le fichier existe et reste confiné aux dossiers Windows Fonts autorisés.
 */
export function resolveFontFilePath(
  fonts: SystemFontEntry[],
  requestedFamilyCss: string,
  bold: boolean,
  italic: boolean,
  allowedDirs: string[] = getAllowedWindowsFontDirs(),
): string | null {
  if (!requestedFamilyCss || fonts.length === 0) {
    return null;
  }

  // Extrait chaque nom candidat d'une pile CSS (ex: '"Calibri", "Arial", sans-serif')
  const candidates = requestedFamilyCss
    .split(',')
    .map((part) => part.replace(/["']/g, '').trim())
    .filter((name) => name && !['sans-serif', 'serif', 'monospace'].includes(name.toLowerCase()));

  let matchedEntry: SystemFontEntry | undefined;
  for (const name of candidates) {
    const lower = name.toLowerCase();
    matchedEntry = fonts.find((f) => f.family.toLowerCase() === lower);
    if (matchedEntry) {
      break;
    }
    matchedEntry = fonts.find((f) => f.family.toLowerCase().includes(lower));
    if (matchedEntry) {
      break;
    }
  }

  if (!matchedEntry) {
    return null;
  }

  const order: Array<keyof FontStyleVariants> =
    bold && italic
      ? ['boldItalic', 'bold', 'italic', 'regular']
      : bold
        ? ['bold', 'regular', 'boldItalic']
        : italic
          ? ['italic', 'regular', 'boldItalic']
          : ['regular', 'bold', 'italic', 'boldItalic'];

  for (const variantKey of order) {
    const p = matchedEntry.variants[variantKey];
    if (!p || !/\.(ttf|otf)$/i.test(p)) {
      continue;
    }
    if (!isPathInsideAnyDirectory(p, allowedDirs)) {
      continue;
    }
    try {
      if (fs.statSync(p).isFile()) {
        return p;
      }
    } catch {
      // Variante introuvable sur disque, essaye la suivante
    }
  }

  return null;
}
