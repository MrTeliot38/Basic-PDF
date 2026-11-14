// Passerelle sécurisée vers les fonctions Windows (Electron) avec repli transparent en mode web (PWA)
import type { BasicPdfDesktopBridge, DesktopSystemFontInfo } from '../types/desktop';
import { classifyFontCategory, findClosestInstalledFontName } from './fontMatching';

let cachedFontsPromise: Promise<DesktopSystemFontInfo[]> | null = null;

/** Retourne le pont Electron si l'application tourne dans la version Windows bureau */
export function getDesktopBridge(): BasicPdfDesktopBridge | null {
  if (typeof window === 'undefined') {
    return null;
  }
  return window.basicPdfDesktop ?? null;
}

export function isDesktopApp(): boolean {
  return Boolean(getDesktopBridge());
}

/** Charge et mémorise la liste des polices réellement installées sur le PC Windows */
export async function loadInstalledSystemFonts(): Promise<DesktopSystemFontInfo[]> {
  const desktop = getDesktopBridge();
  if (!desktop) {
    return [];
  }
  if (!cachedFontsPromise) {
    cachedFontsPromise = desktop.listSystemFonts().catch(() => []);
  }
  return cachedFontsPromise;
}

/** Charge la liste complète des polices système ou navigateur disponibles (sans popup) */
export async function loadAvailableCandidateFonts(): Promise<{
  fonts: Array<{ family: string; category?: 'sans-serif' | 'serif' | 'monospace' }>;
  usingSystemFonts: boolean;
}> {
  if (isDesktopApp()) {
    const sys = await loadInstalledSystemFonts();
    if (sys.length > 0) {
      return { fonts: sys, usingSystemFonts: true };
    }
  }

  if (typeof window !== 'undefined') {
    const queryLocalFonts = (
      window as unknown as { queryLocalFonts?: () => Promise<Array<{ family: string }>> }
    ).queryLocalFonts;
    if (typeof queryLocalFonts === 'function' && navigator.permissions?.query) {
      try {
        const status = await navigator.permissions.query({
          name: 'local-fonts' as PermissionName,
        });
        if (status.state === 'granted') {
          const local = await queryLocalFonts();
          const unique = Array.from(new Set(local.map((f) => f.family))).map((family) => ({
            family,
            category: classifyFontCategory(family),
          }));
          if (unique.length > 0) {
            return { fonts: unique, usingSystemFonts: true };
          }
        }
      } catch {
        // Permission non accordée ou navigateur incompatible
      }
    }
  }

  return { fonts: [], usingSystemFonts: false };
}

/**
 * Associe une famille CSS ou un indice PDF à la police Windows installée la plus proche,
 * afin de la proposer automatiquement à l'écran et à l'enregistrement du PDF.
 */
export async function resolveBestDesktopFontMatch(hint: {
  fontFamily: string;
  detectedFontLabel?: string;
}): Promise<{ fontFamily: string; detectedFontLabel: string } | null> {
  const fonts = await loadInstalledSystemFonts();
  if (fonts.length === 0) {
    return null;
  }

  const category = classifyFontCategory(`${hint.fontFamily} ${hint.detectedFontLabel ?? ''}`);
  // Extrait le premier nom explicite de la pile CSS ou du libellé nettoyé
  const cleanedLabel = (hint.detectedFontLabel ?? '')
    .replace(/\((installée|détectée)\)/gi, '')
    .trim();
  const primaryCssName = hint.fontFamily
    .split(',')[0]
    ?.replace(/["']/g, '')
    .replace(/^(sans-serif|serif|monospace)$/i, '')
    .trim();
  const pdfFontNameHint = cleanedLabel && !cleanedLabel.includes('(')
    ? cleanedLabel
    : primaryCssName;

  const closest = findClosestInstalledFontName(fonts, {
    pdfFontName: pdfFontNameHint,
    category,
  });

  if (!closest) {
    return null;
  }

  const fallbackCss =
    category === 'serif'
      ? 'serif'
      : category === 'monospace'
        ? 'monospace'
        : 'sans-serif';

  return {
    fontFamily: `"${closest}", ${fallbackCss}`,
    detectedFontLabel: `${closest} (installée)`,
  };
}
