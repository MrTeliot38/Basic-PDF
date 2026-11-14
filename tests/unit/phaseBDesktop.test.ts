// Tests unitaires Phase B (Windows Electron) : sécurité des chemins, polices Windows + Fontkit, impression HTML et contrôle SHA-256
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PDFDocument } from 'pdf-lib';
import { describe, expect, it, vi } from 'vitest';

vi.mock('pdfjs-dist', () => ({
  GlobalWorkerOptions: { workerSrc: '' },
  OPS: {},
  Util: { transform: () => [1, 0, 0, 1, 0, 0] },
}));

import { buildNativePrintHtml } from '../../electron/lib/printHtmlBuilder';
import {
  ApprovedPathStore,
  extractPdfPathsFromArgv,
  hasValidPdfSignature,
  isAllowedRendererUrl,
  isPathInsideAnyDirectory,
  isSafeExternalIntentUrl,
  writeFileAtomically,
} from '../../electron/lib/securityAndPaths';
import {
  compareSemver,
  computeSha256Hex,
  downloadAndVerifyInstaller,
  parseGithubReleasePayload,
  parseSha256SumsText,
  verifyBufferSha256,
} from '../../electron/lib/updateChecker';
import {
  enumerateInstalledWindowsFonts,
  findClosestInstalledFontName,
  parseRegistryFontLabel,
  parseWindowsFontsRegistryOutput,
  resolveFontFilePath,
} from '../../electron/lib/windowsFonts';
import { serializeDocumentEditsToPdf } from '../../src/utils/pdfSerializer';
import { buildSamplePdfBytes } from '../../src/utils/samplePdf';

describe('Sécurité des chemins et intentions externes (Windows)', () => {
  it('autorise uniquement ms-settings:defaultapps et mailto sans injection', () => {
    expect(isSafeExternalIntentUrl('ms-settings:defaultapps')).toBe(true);
    expect(isSafeExternalIntentUrl('mailto:?subject=Test')).toBe(true);
    expect(isSafeExternalIntentUrl('https://evil.example/payload')).toBe(false);
    expect(isSafeExternalIntentUrl('mailto:?subject=a\r\nbcc=x')).toBe(false);
    expect(isSafeExternalIntentUrl('file:///C:/Windows/System32/cmd.exe')).toBe(false);
  });

  it('vérifie le confinement strict dans les répertoires autorisés et extrait les PDF de la ligne de commande', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'basicpdf-sec-'));
    try {
      const validPdf = path.join(tmpDir, 'facture.pdf');
      const notPdf = path.join(tmpDir, 'note.txt');
      fs.writeFileSync(validPdf, '%PDF-1.4\n%%EOF');
      fs.writeFileSync(notPdf, 'hello');

      const extracted = extractPdfPathsFromArgv([
        '--inspect=9229',
        'app.exe',
        notPdf,
        validPdf,
        validPdf,
        path.join(tmpDir, 'absent.pdf'),
      ]);
      expect(extracted).toEqual([path.resolve(validPdf)]);

      expect(isPathInsideAnyDirectory(validPdf, [tmpDir])).toBe(true);
      expect(isPathInsideAnyDirectory(path.join(tmpDir, '..', 'outside.pdf'), [tmpDir])).toBe(
        false,
      );

      const store = new ApprovedPathStore();
      expect(store.isApproved(validPdf)).toBe(false);
      store.approve(validPdf);
      expect(store.isApproved(validPdf)).toBe(true);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('écrit de manière atomique sans laisser de fichier temporaire', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'basicpdf-atomic-'));
    try {
      const target = path.join(tmpDir, 'sortie.pdf');
      const payload = buildSamplePdfBytes('Test écriture atomique', 1);
      writeFileAtomically(target, payload);

      const diskBytes = new Uint8Array(fs.readFileSync(target));
      expect(hasValidPdfSignature(diskBytes)).toBe(true);
      expect(diskBytes.byteLength).toBe(payload.byteLength);
      expect(fs.readdirSync(tmpDir)).toEqual(['sortie.pdf']);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('bloque toute requête réseau sortante depuis le moteur d’affichage', () => {
    expect(isAllowedRendererUrl('app://basic-pdf/index.html', null)).toBe(false); // vérifié séparément par prefixe app://
    expect(isAllowedRendererUrl('blob:app://basic-pdf/123', null)).toBe(true);
    expect(isAllowedRendererUrl('data:image/png;base64,AAA', null)).toBe(true);
    expect(isAllowedRendererUrl('https://tracking.example.com/collect', null)).toBe(false);
    expect(isAllowedRendererUrl('http://analytics.invalid/ping', null)).toBe(false);
  });
});

describe('Polices système Windows, appariement pour scans et intégration TTF via Fontkit', () => {
  it('analyse correctement les noms de polices du Registre Windows et associe la police proche', () => {
    expect(parseRegistryFontLabel('Calibri Bold Italic (TrueType)')).toEqual({
      family: 'Calibri',
      bold: true,
      italic: true,
    });

    const sampleStdout = `
HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Fonts
    Arial (TrueType)    REG_SZ    arial.ttf
    Arial Bold (TrueType)    REG_SZ    arialbd.ttf
    Georgia Italic (TrueType)    REG_SZ    georgiai.ttf
    Outside Escape (TrueType)    REG_SZ    ../../secret.ttf
`;
    const winFonts = path.join(os.tmpdir(), 'WinFontsTest');
    const parsed = parseWindowsFontsRegistryOutput(sampleStdout, winFonts, [winFonts]);
    expect(parsed.has('arial')).toBe(true);
    expect(parsed.get('arial')?.variants.bold).toBe(path.join(winFonts, 'arialbd.ttf'));
    expect(parsed.has('outside escape')).toBe(false);

    const closestSerif = findClosestInstalledFontName(
      [
        { family: 'Calibri', category: 'sans-serif' },
        { family: 'Georgia', category: 'serif' },
        { family: 'Consolas', category: 'monospace' },
      ],
      { category: 'serif' },
    );
    expect(closestSerif).toBe('Georgia');
  });

  it('énumère les polices Windows réelles et intègre une vraie police TTF avec accents Unicode dans le PDF', async () => {
    let ttfPath: string | null = null;
    if (process.platform === 'win32') {
      const installed = await enumerateInstalledWindowsFonts();
      expect(installed.length).toBeGreaterThan(5);
      ttfPath = resolveFontFilePath(installed, '"Arial", sans-serif', false, false);
    } else {
      // Sur Linux/CI Android, vérifie tout de même l'intégration TTF + Unicode avec une police TTF libre fournie
      const fallbackTtf = path.join(
        process.cwd(),
        'node_modules',
        'pdfjs-dist',
        'standard_fonts',
        'LiberationSans-Regular.ttf',
      );
      ttfPath = fs.existsSync(fallbackTtf) ? fallbackTtf : null;
    }
    expect(ttfPath).toBeTruthy();

    const ttfBytes = new Uint8Array(fs.readFileSync(ttfPath!));
    const basePdf = buildSamplePdfBytes('Base document', 1);

    const outBytes = await serializeDocumentEditsToPdf({
      baseBytes: basePdf,
      textBlocksByPage: {
        1: [
          {
            id: 'b1',
            pageNumber: 1,
            source: 'ocr',
            originalText: 'Ancien',
            currentText: 'Été à Lyon : 100 € & cœur',
            status: 'edited',
            origX: 40,
            origY: 80,
            origWidth: 260,
            origHeight: 20,
            x: 40,
            y: 80,
            width: 260,
            height: 20,
            style: {
              fontFamily: '"Arial", sans-serif',
              fontSize: 12,
              color: '#111827',
              bold: false,
              italic: false,
            },
            originalStyle: {
              fontFamily: '"Arial", sans-serif',
              fontSize: 12,
              color: '#111827',
              bold: false,
              italic: false,
            },
          },
        ],
      },
      resolveCustomFontBytes: async () => ttfBytes,
    });

    const loaded = await PDFDocument.load(outBytes);
    expect(loaded.getPageCount()).toBe(1);
    const pdfObjectsSummary = loaded.context
      .enumerateIndirectObjects()
      .map(([, obj]) => obj.toString())
      .join('\n');
    // Preuve qu'une police TrueType personnalisée (/FontDescriptor) a bien été intégrée avec le texte Unicode
    expect(pdfObjectsSummary).toContain('/FontDescriptor');
    expect(outBytes.byteLength).toBeGreaterThan(50_000);
  });
});

describe('Mises à jour facultatives GitHub et intégrité SHA-256', () => {
  it('compare les versions, lit SHA256SUMS.txt et refuse toute empreinte altérée', async () => {
    expect(compareSemver('0.2.0', '0.1.0')).toBe(1);
    expect(compareSemver('v1.0.0', '1.0.0')).toBe(0);
    expect(compareSemver('0.1.0', '0.2.0')).toBe(-1);

    const samplePayload = Buffer.from('Faux installateur EXE pour test', 'utf8');
    const goodHash = computeSha256Hex(samplePayload);
    const sums = `${goodHash}  Basic-PDF-Setup-0.2.0.exe\n${'a'.repeat(64)}  autre.zip\n`;

    expect(parseSha256SumsText(sums, 'Basic-PDF-Setup-0.2.0.exe')).toBe(goodHash);
    expect(verifyBufferSha256(samplePayload, goodHash)).toBe(true);
    expect(verifyBufferSha256(Buffer.from('corrompu'), goodHash)).toBe(false);

    const parsedRel = parseGithubReleasePayload(
      {
        tag_name: 'v0.2.0',
        body: 'Corrections diverses',
        html_url: 'https://github.com/basic-pdf/basic-pdf/releases/tag/v0.2.0',
        assets: [
          {
            name: 'Basic-PDF-Setup-0.2.0.exe',
            browser_download_url:
              'https://github.com/basic-pdf/basic-pdf/releases/download/v0.2.0/Basic-PDF-Setup-0.2.0.exe',
          },
        ],
      },
      '0.1.0',
    );
    expect(parsedRel.updateAvailable).toBe(true);
    expect(parsedRel.installerFileName).toBe('Basic-PDF-Setup-0.2.0.exe');

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'basicpdf-upd-'));
    try {
      const mockFetch = (async () =>
        new Response(samplePayload, { status: 200 })) as unknown as typeof fetch;

      const okRes = await downloadAndVerifyInstaller(
        parsedRel.installerUrl!,
        parsedRel.installerFileName!,
        goodHash,
        tmpDir,
        mockFetch,
      );
      expect(fs.existsSync(okRes.installerPath)).toBe(true);
      expect(okRes.actualSha256).toBe(goodHash);

      await expect(
        downloadAndVerifyInstaller(
          parsedRel.installerUrl!,
          parsedRel.installerFileName!,
          '0'.repeat(64),
          tmpDir,
          mockFetch,
        ),
      ).rejects.toThrow(/SHA-256/);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

describe('HTML d’impression native Windows', () => {
  it('échappe correctement les titres/en-têtes et conserve @page', () => {
    const html = buildNativePrintHtml({
      title: 'Rapport <script>alert(1)</script>.pdf',
      paperSize: 'A4',
      widthMm: 297,
      heightMm: 210,
      landscape: true,
      sheets: [
        {
          gridCols: 2,
          gridRows: 1,
          marginMm: 6,
          headerText: 'En-tête <b>gras</b>',
          footerText: 'Page 1 / 1',
          cells: [{ imageDataUrl: 'data:image/png;base64,iVBORw0KGgo=' }, {}],
        },
      ],
    });
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('size: 297mm 210mm;');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
  });
});
