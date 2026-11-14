import { describe, expect, it } from 'vitest';
import {
  buildInkMaskFromRgba,
  detectColumnRegions,
  splitLineWordsByGaps,
  type WordToken,
} from '../../src/utils/ocrEngine';

function makeMask(width: number, height: number, drawRects: Array<[number, number, number, number]>): Uint8Array {
  const mask = new Uint8Array(width * height);
  for (const [rx, ry, rw, rh] of drawRects) {
    for (let y = ry; y < Math.min(height, ry + rh); y += 1) {
      for (let x = rx; x < Math.min(width, rx + rw); x += 1) {
        mask[y * width + x] = 1;
      }
    }
  }
  return mask;
}

describe('Analyse de mise en page multi-colonnes pour l’OCR', () => {
  it('sépare proprement deux colonnes côte à côte en deux régions distinctes', () => {
    const w = 400;
    const h = 300;
    // Colonne gauche [30..165] et colonne droite [235..370] séparées par une gouttière de 70 px
    const mask = makeMask(w, h, [
      [30, 40, 135, 18],
      [30, 75, 130, 18],
      [235, 40, 135, 18],
      [235, 75, 120, 18],
    ]);

    const regions = detectColumnRegions(mask, w, h);
    expect(regions.length).toBe(2);
    expect(regions[0].x).toBe(0);
    expect(regions[0].x + regions[0].width).toBeLessThanOrEqual(235);
    expect(regions[1].x).toBeGreaterThanOrEqual(165);
  });

  it('sépare un titre pleine largeur puis les deux colonnes en dessous', () => {
    const w = 400;
    const h = 300;
    const mask = makeMask(w, h, [
      // Titre centré qui traverse toute la largeur
      [40, 20, 320, 20],
      // Deux colonnes rapprochées juste en dessous
      [30, 60, 130, 16],
      [30, 90, 130, 16],
      [240, 60, 130, 16],
      [240, 90, 130, 16],
    ]);

    const regions = detectColumnRegions(mask, w, h);
    expect(regions.length).toBe(3);
    // Région 0 = titre pleine largeur
    expect(regions[0].width).toBe(w);
    // Régions 1 et 2 = colonne gauche et colonne droite
    expect(regions[1].x + regions[1].width).toBeLessThan(w);
    expect(regions[2].x).toBeGreaterThan(100);
  });

  it('sépare deux colonnes même en présence d’un filet vertical central', () => {
    const w = 400;
    const h = 250;
    const mask = makeMask(w, h, [
      [30, 40, 130, 20],
      [199, 30, 2, 180], // filet séparateur vertical de 2 px
      [240, 40, 130, 20],
    ]);

    const regions = detectColumnRegions(mask, w, h);
    expect(regions.length).toBe(2);
  });

  it('coupe une ligne OCR si deux groupes de mots sont séparés par un grand espace de colonne', () => {
    const words: WordToken[] = [
      { text: 'Colonne', x0: 20, y0: 40, x1: 80, y1: 56 },
      { text: 'gauche', x0: 88, y0: 40, x1: 140, y1: 56 },
      { text: 'Colonne', x0: 320, y0: 40, x1: 380, y1: 56 },
      { text: 'droite', x0: 388, y0: 40, x1: 440, y1: 56 },
    ];

    const groups = splitLineWordsByGaps(words, 16, 600);
    expect(groups.length).toBe(2);
    expect(groups[0].map((w) => w.text).join(' ')).toBe('Colonne gauche');
    expect(groups[1].map((w) => w.text).join(' ')).toBe('Colonne droite');
  });

  it('construit un masque d’encre sur fond clair ou coloré', () => {
    const w = 20;
    const h = 4;
    const rgba = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y += 1) {
      for (let x = 0; x < w; x += 1) {
        const idx = (y * w + x) * 4;
        const isInk = x >= 4 && x <= 6;
        rgba[idx] = isInk ? 10 : 230;
        rgba[idx + 1] = isInk ? 10 : 240;
        rgba[idx + 2] = isInk ? 10 : 250;
        rgba[idx + 3] = 255;
      }
    }
    const mask = buildInkMaskFromRgba(rgba, w, h);
    expect(mask[5]).toBe(1);
    expect(mask[0]).toBe(0);
  });
});
