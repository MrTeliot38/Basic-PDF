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
  const closest = findClosestInstalledFontName(fonts, {
    pdfFontName: hint.detectedFontLabel,
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
