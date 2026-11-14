// Classification et appariement de polices système pour la lecture de documents scannés et natifs

export type FontVisualCategory = 'sans-serif' | 'serif' | 'monospace';

const KNOWN_SERIF_KEYWORDS = [
  'times',
  'georgia',
  'cambria',
  'palatino',
  'garamond',
  'constantia',
  'book antiqua',
  'baskerville',
  'century',
  'bodoni',
  'didot',
  'serif',
  'sitka',
];

const KNOWN_MONO_KEYWORDS = [
  'consolas',
  'courier',
  'lucida console',
  'cascadia',
  'fira code',
  'jetbrains mono',
  'source code',
  'monaco',
  'mono',
  'fixedsys',
];

/** Classifie une famille de police selon son nom pour aider à l'appariement */
export function classifyFontCategory(family: string): FontVisualCategory {
  const lower = family.toLowerCase();
  const withoutSans = lower.replace(/sans[\s-]?serif/g, 'sansserif');
  if (KNOWN_MONO_KEYWORDS.some((kw) => lower.includes(kw))) {
    return 'monospace';
  }
  if (KNOWN_SERIF_KEYWORDS.some((kw) => withoutSans.includes(kw))) {
    return 'serif';
  }
  return 'sans-serif';
}

/**
 * Retrouve la police installée la plus proche parmi celles présentes sur l'ordinateur,
 * d'après le nom détecté dans le PDF ou la catégorie visuelle du texte scanné.
 */
export function findClosestInstalledFontName(
  installedFamilies: Array<{ family: string; category?: FontVisualCategory }>,
  hint: {
    pdfFontName?: string;
    category: FontVisualCategory;
  },
): string | null {
  if (installedFamilies.length === 0) {
    return null;
  }

  const cleanHint = (hint.pdfFontName ?? '')
    .replace(/^[A-Z]{6}\+/, '')
    .replace(/[-_,](Bold|Italic|Oblique|Regular|MT|PSMT|Std).*$/i, '')
    .trim()
    .toLowerCase();

  if (cleanHint.length >= 3) {
    const direct = installedFamilies.find((f) => f.family.toLowerCase() === cleanHint);
    if (direct) {
      return direct.family;
    }
    const partial = installedFamilies.find(
      (f) =>
        f.family.toLowerCase().includes(cleanHint) ||
        cleanHint.includes(f.family.toLowerCase()),
    );
    if (partial) {
      return partial.family;
    }
  }

  const preferredByCategory: Record<FontVisualCategory, string[]> = {
    'sans-serif': ['Calibri', 'Arial', 'Segoe UI', 'Verdana', 'Tahoma', 'Trebuchet MS'],
    serif: ['Times New Roman', 'Georgia', 'Cambria', 'Palatino Linotype', 'Garamond'],
    monospace: ['Consolas', 'Courier New', 'Cascadia Mono', 'Lucida Console'],
  };

  for (const preferred of preferredByCategory[hint.category]) {
    const found = installedFamilies.find(
      (f) => f.family.toLowerCase() === preferred.toLowerCase(),
    );
    if (found) {
      return found.family;
    }
  }

  const sameCategory = installedFamilies.find(
    (f) => (f.category ?? classifyFontCategory(f.family)) === hint.category,
  );
  return sameCategory ? sameCategory.family : installedFamilies[0].family;
}
