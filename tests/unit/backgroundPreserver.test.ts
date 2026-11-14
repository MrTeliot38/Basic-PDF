import { describe, expect, it } from 'vitest';
import { reconstructBackgroundBuffer } from '../../src/utils/backgroundPreserver';

function createRgbaBuffer(
  width: number,
  height: number,
  fillFn: (x: number, y: number) => [number, number, number],
): Uint8ClampedArray {
  const buf = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const [r, g, b] = fillFn(x, y);
      const idx = (y * width + x) * 4;
      buf[idx] = r;
      buf[idx + 1] = g;
      buf[idx + 2] = b;
      buf[idx + 3] = 255;
    }
  }
  return buf;
}

describe('Préservation du fond lors de la correction ou suppression de texte', () => {
  it('conserve un fond de couleur unie (jamais remplacé par du blanc)', () => {
    const w = 80;
    const h = 30;
    // Fond bleu #2563eb (37, 99, 235) avec des traits de texte blancs au centre
    const src = createRgbaBuffer(w, h, (x, y) => {
      const isTextStroke = y >= 10 && y <= 18 && x >= 15 && x <= 60 && x % 6 < 2;
      return isTextStroke ? [255, 255, 255] : [37, 99, 235];
    });

    const out = reconstructBackgroundBuffer(src, w, h, 1);

    // Tous les anciens pixels blancs au centre doivent être redevenus bleus (~37, 99, 235)
    for (let x = 15; x <= 60; x += 1) {
      const idx = (14 * w + x) * 4;
      expect(out[idx]).toBeLessThan(60);
      expect(out[idx + 1]).toBeGreaterThan(80);
      expect(out[idx + 2]).toBeGreaterThan(210);
    }
  });

  it('préserve un encadré étroit sans effacer sa bordure ni le remplir de blanc', () => {
    const w = 90;
    const h = 24;
    // Bordure marron #92400e (146, 64, 14) sur le bord 1 px, intérieur jaune pâle #fef08a (254, 240, 138)
    const src = createRgbaBuffer(w, h, (x, y) => {
      if (x === 0 || x === w - 1 || y === 0 || y === h - 1) {
        return [146, 64, 14];
      }
      const isDarkLetter = y >= 7 && y <= 16 && x >= 20 && x <= 68 && x % 7 < 2;
      return isDarkLetter ? [17, 24, 39] : [254, 240, 138];
    });

    const out = reconstructBackgroundBuffer(src, w, h, 1);

    // Vérifie que la bordure reste marron
    expect(out[0]).toBe(146);
    expect(out[1]).toBe(64);
    expect(out[2]).toBe(14);

    // Vérifie que l'ancien texte sombre a été remplacé par le jaune pâle intérieur
    for (let x = 20; x <= 68; x += 1) {
      const idx = (11 * w + x) * 4;
      expect(out[idx]).toBeGreaterThan(235);
      expect(out[idx + 1]).toBeGreaterThan(220);
      expect(out[idx + 2]).toBeLessThan(165);
    }
  });

  it('reconstruit fidèlement un dégradé horizontal sans créer de rectangle plat', () => {
    const w = 120;
    const h = 32;
    const gradientAt = (x: number): [number, number, number] => {
      const t = x / (w - 1);
      return [Math.round(30 + t * 140), Math.round(64 + t * 140), Math.round(175 + t * 70)];
    };

    const src = createRgbaBuffer(w, h, (x, y) => {
      const isText = y >= 10 && y <= 20 && ((x >= 20 && x <= 23) || (x >= 90 && x <= 93));
      return isText ? [255, 255, 255] : gradientAt(x);
    });

    const out = reconstructBackgroundBuffer(src, w, h, 1);

    // Côté gauche (x = 21) vs côté droit (x = 91) doivent suivre les couleurs du dégradé
    const leftIdx = (15 * w + 21) * 4;
    const rightIdx = (15 * w + 91) * 4;
    const [expLeftR] = gradientAt(21);
    const [expRightR] = gradientAt(91);

    expect(Math.abs(out[leftIdx] - expLeftR)).toBeLessThan(20);
    expect(Math.abs(out[rightIdx] - expRightR)).toBeLessThan(20);
    expect(out[rightIdx] - out[leftIdx]).toBeGreaterThan(60);
  });
});
