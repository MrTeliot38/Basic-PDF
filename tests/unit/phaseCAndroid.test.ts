import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  compareSemverStrings,
  computeAndroidVersionCode,
  parseSha256SumsForFile,
  sanitizeAndroidPdfFileName,
} from '../../src/utils/androidVersion';
import {
  applyDocumentFilter,
  computePerspectiveTransform,
  detectDocumentQuad,
  getQualitySettings,
} from '../../src/utils/documentScanner';

describe('Phase C : Version Android, SHA-256 et configuration native', () => {
  it('calcule versionCode selon majeur*10000 + mineur*100 + correctif', () => {
    expect(computeAndroidVersionCode('0.1.0')).toBe(100);
    expect(computeAndroidVersionCode('1.0.0')).toBe(10000);
    expect(computeAndroidVersionCode('1.2.3')).toBe(10203);
    expect(computeAndroidVersionCode('v2.15.9')).toBe(21509);
    expect(() => computeAndroidVersionCode('0.0.0')).toThrow();
    expect(() => computeAndroidVersionCode('1.120.0')).toThrow();
  });

  it('compare les versions et extrait l’empreinte SHA-256 d’un APK dans SHA256SUMS.txt', () => {
    expect(compareSemverStrings('0.2.0', '0.1.0')).toBe(1);
    expect(compareSemverStrings('0.1.0', '0.1.0')).toBe(0);
    const sums = [
      'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa  Basic-PDF-Setup-0.2.0.exe',
      'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb *Basic-PDF-0.2.0-android.apk',
    ].join('\n');
    expect(parseSha256SumsForFile(sums, 'Basic-PDF-0.2.0-android.apk')).toBe(
      'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    );
  });

  it('tronque les noms de fichiers PDF trop longs pour Android en gardant .pdf', () => {
    const longName = `${'Rapport_Annuel_Tres_Long_'.repeat(6)}.pdf`;
    const clean = sanitizeAndroidPdfFileName(longName);
    expect(clean.length).toBeLessThanOrEqual(80);
    expect(clean.toLowerCase().endsWith('.pdf')).toBe(true);
  });

  it('vérifie la configuration Android (minSdk >= 24, lecteur par défaut, réception PDF, sécurité .jks hors Git)', () => {
    const root = process.cwd();
    const varsGradle = fs.readFileSync(path.join(root, 'android', 'variables.gradle'), 'utf8');
    expect(varsGradle).toContain('minSdkVersion = 24');

    const manifest = fs.readFileSync(
      path.join(root, 'android', 'app', 'src', 'main', 'AndroidManifest.xml'),
      'utf8',
    );
    expect(manifest).toContain('android.intent.action.VIEW');
    expect(manifest).toContain('android.intent.action.SEND');
    expect(manifest).toContain('android.intent.action.SEND_MULTIPLE');
    expect(manifest).toContain('application/pdf');
    expect(manifest).toContain('android:windowSoftInputMode="adjustResize"');
    expect(manifest).toContain('androidx.core.content.FileProvider');

    const appGradle = fs.readFileSync(
      path.join(root, 'android', 'app', 'build.gradle'),
      'utf8',
    );
    expect(appGradle).toContain('verMajor * 10000 + verMinor * 100 + verPatch');

    const gitignore = fs.readFileSync(path.join(root, '.gitignore'), 'utf8');
    expect(gitignore).toContain('*.jks');
    expect(gitignore).toContain('keystore.properties');

    const pluginJava = fs.readFileSync(
      path.join(root, 'android', 'app', 'src', 'main', 'java', 'fr', 'basicpdf', 'app', 'BasicPdfAndroidPlugin.java'),
      'utf8',
    );
    expect(pluginJava).toContain('writePdfSafelyViaTempFile');
    expect(pluginJava).toContain('MrTeliot38/Basic-PDF');
  });
});

describe('Phase C : Moteur hors ligne du scanner (détection feuille, homographie, filtres)', () => {
  it('détecte les 4 coins d’une feuille claire sur fond sombre et rejette un fond vide uniforme', () => {
    const w = 160;
    const h = 120;
    const data = new Uint8ClampedArray(w * h * 4);

    // Fond sombre (bureau) + feuille blanche légèrement en perspective au centre
    for (let y = 0; y < h; y += 1) {
      for (let x = 0; x < w; x += 1) {
        const idx = (y * w + x) * 4;
        const inset = (y / h) * 8;
        const isSheet = y >= 14 && y <= 106 && x >= 28 - inset * 0.4 && x <= 132 + inset * 0.4;
        const v = isSheet ? 242 : 28;
        data[idx] = v;
        data[idx + 1] = v;
        data[idx + 2] = v;
        data[idx + 3] = 255;
      }
    }

    const res = detectDocumentQuad({ width: w, height: h, data } as unknown as ImageData);
    expect(res.detected).toBe(true);
    expect(res.confidence).toBeGreaterThan(0.4);
    expect(res.quad.topLeft.x).toBeGreaterThan(0.1);
    expect(res.quad.topRight.x).toBeLessThan(0.95);
    expect(res.quad.bottomLeft.y).toBeGreaterThan(0.75);

    // Trame uniforme sombre : aucune feuille détectée
    const emptyData = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < emptyData.length; i += 4) {
      emptyData[i] = 35;
      emptyData[i + 1] = 35;
      emptyData[i + 2] = 35;
      emptyData[i + 3] = 255;
    }
    const emptyRes = detectDocumentQuad({
      width: w,
      height: h,
      data: emptyData,
    } as unknown as ImageData);
    expect(emptyRes.detected).toBe(false);
  });

  it('calcule exactement la matrice de redressement de perspective entre 4 paires de coins', () => {
    const dst: [
      { x: number; y: number },
      { x: number; y: number },
      { x: number; y: number },
      { x: number; y: number },
    ] = [
      { x: 0, y: 0 },
      { x: 400, y: 0 },
      { x: 400, y: 600 },
      { x: 0, y: 600 },
    ];
    const src: typeof dst = [
      { x: 90, y: 50 },
      { x: 350, y: 75 },
      { x: 420, y: 540 },
      { x: 35, y: 515 },
    ];

    const h = computePerspectiveTransform(dst, src);
    for (let i = 0; i < 4; i += 1) {
      const { x: u, y: v } = dst[i];
      const denom = h[6] * u + h[7] * v + 1;
      const sx = (h[0] * u + h[1] * v + h[2]) / denom;
      const sy = (h[3] * u + h[4] * v + h[5]) / denom;
      expect(sx).toBeCloseTo(src[i].x, 4);
      expect(sy).toBeCloseTo(src[i].y, 4);
    }
  });

  it('applique le filtre Noir et blanc adaptatif malgré une ombre inégale et respecte les niveaux de qualité', () => {
    const w = 64;
    const h = 48;
    const data = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y += 1) {
      for (let x = 0; x < w; x += 1) {
        // Gradient d'éclairage (plus sombre à droite) + ligne de texte sombre au milieu
        const paper = Math.round(235 - (x / w) * 65);
        const isText = y >= 22 && y <= 26 && x >= 15 && x <= 48;
        const val = isText ? paper - 95 : paper;
        const idx = (y * w + x) * 4;
        data[idx] = val;
        data[idx + 1] = val;
        data[idx + 2] = val;
        data[idx + 3] = 255;
      }
    }

    const filtered = applyDocumentFilter({ width: w, height: h, data } as unknown as ImageData, 'nb');
    // Le pixel de texte reste noir (22) même du côté ombragé
    const textIdx = (24 * w + 40) * 4;
    expect(filtered.data[textIdx]).toBeLessThan(40);
    // Le papier environnant devient blanc pur (255)
    const paperIdx = (10 * w + 45) * 4;
    expect(filtered.data[paperIdx]).toBe(255);

    expect(getQualitySettings('leger').jpegQuality).toBeLessThan(
      getQualitySettings('haute').jpegQuality,
    );
  });
});
