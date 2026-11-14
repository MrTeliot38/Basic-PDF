// Tests E2E réels de la version Windows (Electron) : lancement sur PDF double-cliqué, instance unique, polices Windows, enregistrement disque, impression native et paramètres
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { _electron as electron, expect, test } from '@playwright/test';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

const SCREENSHOTS_DIR =
  'C:\\Users\\roly_\\.gemini\\antigravity\\brain\\73218bb9-b8fe-40ea-aeca-18e39db6903b\\screenshots';

async function createSampleFileOnDisk(filePath: string, headingText: string): Promise<void> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([595, 842]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  page.drawRectangle({
    x: 40,
    y: 730,
    width: 515,
    height: 60,
    color: rgb(0.93, 0.96, 1),
  });
  page.drawText(headingText, {
    x: 56,
    y: 755,
    size: 16,
    font,
    color: rgb(0.08, 0.14, 0.28),
  });
  const bytes = await doc.save();
  fs.writeFileSync(filePath, bytes);
}

test.describe('Phase B : Application Windows Electron réelle', () => {
  test('double-clic .pdf, instance unique, polices Windows, sauvegarde disque, impression native et paramètres', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'basicpdf-win-e2e-'));
    const userDataDir = path.join(tmpDir, 'userdata');
    const firstPdfPath = path.join(tmpDir, 'Premier-Document-Explorer.pdf');
    const secondPdfPath = path.join(tmpDir, 'Second-Document-DoubleClic.pdf');

    await createSampleFileOnDisk(firstPdfPath, 'Document Windows ouvert par double-clic');
    await createSampleFileOnDisk(secondPdfPath, 'Deuxieme document ouvert dans meme fenetre');

    const rootDir = process.cwd();
    const electronApp = await electron.launch({
      args: [path.join(rootDir, 'dist-electron', 'main.cjs'), firstPdfPath],
      env: {
        ...process.env,
        BASIC_PDF_USER_DATA_DIR: userDataDir,
        BASIC_PDF_TEST_PRINT_MODE: 'pdf-buffer',
      },
    });

    try {
      const page = await electronApp.firstWindow();
      await page.setViewportSize({ width: 1320, height: 840 });

      // 1. Le PDF passé au lancement (simulant le double-clic dans l'Explorateur) s'ouvre automatiquement
      await expect(page.getByRole('tab')).toHaveCount(1, { timeout: 15_000 });
      await expect(page.getByRole('tab').first()).toContainText('Premier-Document-Explorer.pdf');
      await expect(page.locator('[data-page-number="1"] canvas')).toBeVisible({ timeout: 15_000 });

      // Vérifie l'isolation de sécurité du contexte dans le renderer
      const securityCheck = await page.evaluate(() => ({
        hasBridge: Boolean(window.basicPdfDesktop?.isDesktop),
        hasNodeRequire: typeof (window as unknown as { require?: unknown }).require !== 'undefined',
        hasProcess: typeof (window as unknown as { process?: unknown }).process !== 'undefined',
      }));
      expect(securityCheck.hasBridge).toBe(true);
      expect(securityCheck.hasNodeRequire).toBe(false);
      expect(securityCheck.hasProcess).toBe(false);

      // 2. Simule un double-clic sur un 2e PDF dans l'Explorateur (seconde instance qui rejoint la fenêtre)
      const realElectronExe = path.join(rootDir, 'node_modules', 'electron', 'dist', 'electron.exe');
      const launcher = spawn(
        realElectronExe,
        [path.join(rootDir, 'dist-electron', 'main.cjs'), secondPdfPath],
        {
          env: {
            ...process.env,
            BASIC_PDF_USER_DATA_DIR: userDataDir,
          },
          stdio: 'ignore',
          windowsHide: true,
        },
      );
      await expect(page.getByRole('tab')).toHaveCount(2, { timeout: 15_000 });
      await expect(page.getByRole('tab', { selected: true })).toContainText(
        'Second-Document-DoubleClic.pdf',
      );
      try {
        launcher.kill();
      } catch {
        // Le second processus a déjà quitté tout seul via requestSingleInstanceLock
      }

      // Revient au premier onglet pour tester l'édition avec police Windows installée + sauvegarde directe disque
      await page.getByRole('tab').first().click();
      await page.getByRole('button', { name: 'Modifier le texte' }).click();
      const firstBlock = page.locator('[data-testid^="text-block-"]').first();
      await expect(firstBlock).toBeVisible({ timeout: 10_000 });
      await firstBlock.click();

      // Vérifie que la liste contient les vraies polices Windows installées (ex: Arial / Calibri / Georgia)
      const fontSelect = page.locator('#inspector-font-select');
      await expect(fontSelect).toBeVisible();
      const installedGroupCount = await fontSelect.locator('optgroup').nth(1).locator('option').count();
      expect(installedGroupCount).toBeGreaterThan(10);

      // Modifie le texte avec des accents français + choisit Georgia installée si présente (ou Arial)
      const georgiaOption = await fontSelect
        .locator('optgroup')
        .nth(1)
        .locator('option', { hasText: /^Georgia$/i })
        .getAttribute('value');
      if (georgiaOption) {
        await fontSelect.selectOption(georgiaOption);
      }

      await page.locator('#inspector-text-input').fill('Corrigé en police Windows — Été à Lyon (œuf)');
      await page.getByRole('button', { name: 'Appliquer' }).click();
      await expect(firstBlock).toContainText('Corrigé en police Windows');

      fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
      await page.screenshot({
        path: path.join(SCREENSHOTS_DIR, 'b-windows-edition-polices.png'),
      });

      // 3. Enregistrement direct sur le fichier d'origine du disque Windows (sans téléchargement web)
      const origSize = fs.statSync(firstPdfPath).size;
      await page.getByRole('button', { name: 'Enregistrer', exact: true }).click();
      await expect(page.locator('.toast-banner')).toContainText('Modifications enregistrées', {
        timeout: 10_000,
      });
      const updatedBytes = fs.readFileSync(firstPdfPath);
      expect(updatedBytes.length).not.toBe(origSize);
      expect(updatedBytes.subarray(0, 5).toString('ascii')).toBe('%PDF-');

      // 4. Impression native Windows (testée jusqu'à la génération PDF native Chromium/Electron)
      await page.getByRole('button', { name: 'Aperçu et impression' }).click();
      const printModal = page.getByRole('dialog', { name: 'Aperçu avant impression' });
      await expect(printModal).toBeVisible();
      await expect(printModal.locator('.print-cell-img').first()).toBeVisible({ timeout: 10_000 });
      await printModal.getByRole('button', { name: 'Imprimer', exact: true }).click();
      await expect(page.locator('.toast-banner')).toContainText('Impression lancée', {
        timeout: 10_000,
      });
      await printModal.getByRole('button', { name: "Fermer l'impression" }).click();

      // 5. Fenêtre de partage simplifié sous Windows (e-mail / WhatsApp / Explorateur)
      await page.getByRole('button', { name: 'Partager le PDF' }).click();
      const shareModal = page.getByRole('dialog', { name: 'Partager ce PDF sous Windows' });
      await expect(shareModal).toBeVisible();
      await page.screenshot({
        path: path.join(SCREENSHOTS_DIR, 'b-windows-partage.png'),
      });
      await shareModal.getByRole('button', { name: 'Fermer le partage' }).click();

      // 6. Fenêtre Paramètres Windows : lecteur PDF par défaut, polices et mises à jour SHA-256 opt-in
      await page.getByRole('button', { name: 'Paramètres Windows et mises à jour' }).click();
      const settingsModal = page.getByRole('dialog', {
        name: 'Paramètres Windows et mises à jour',
      });
      await expect(settingsModal).toBeVisible();
      await expect(settingsModal).toContainText('Basic PDF 0.1.0');
      await expect(settingsModal).toContainText('polices Windows détectées localement');
      await expect(settingsModal).toContainText('Aucune connexion Internet');
      await expect(settingsModal.getByRole('button', { name: 'Vérifier maintenant' })).toBeVisible();
      await page.screenshot({
        path: path.join(SCREENSHOTS_DIR, 'b-windows-parametres-maj.png'),
      });
      await settingsModal.getByRole('button', { name: 'Fermer les paramètres' }).click();
    } finally {
      await electronApp.close();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test('binaire empaqueté Basic PDF.exe : OCR hors ligne sur scan et association à la police Windows la plus proche', async () => {
    const rootDir = process.cwd();
    const packagedExe = path.join(rootDir, 'release', 'win-unpacked', 'Basic PDF.exe');
    expect(fs.existsSync(packagedExe)).toBe(true);

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'basicpdf-pkg-e2e-'));
    const userDataDir = path.join(tmpDir, 'userdata');
    const launchPdfPath = path.join(tmpDir, 'Accueil-Test.pdf');
    await createSampleFileOnDisk(launchPdfPath, 'Document empaquete pret');

    const electronApp = await electron.launch({
      executablePath: packagedExe,
      args: [launchPdfPath],
      env: {
        ...process.env,
        BASIC_PDF_USER_DATA_DIR: userDataDir,
      },
    });

    try {
      const page = await electronApp.firstWindow();
      await page.setViewportSize({ width: 1320, height: 840 });
      await expect(page.getByRole('tab')).toHaveCount(1, { timeout: 15_000 });
      await expect(page.locator('[data-page-number="1"] canvas')).toBeVisible({ timeout: 15_000 });

      // Fabrique un PDF 100 % scanné (image PNG sans texte vectoriel) directement via Canvas
      const scanPngDataUrl = await page.evaluate(() => {
        const c = document.createElement('canvas');
        c.width = 900;
        c.height = 420;
        const ctx = c.getContext('2d')!;
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, c.width, c.height);
        ctx.fillStyle = '#0f172a';
        ctx.font = 'bold 42px Georgia, serif';
        ctx.fillText('Facture Client', 80, 140);
        ctx.font = '32px Arial, sans-serif';
        ctx.fillText('Total hors taxes', 80, 230);
        return c.toDataURL('image/png');
      });

      const base64 = scanPngDataUrl.split(',')[1];
      const pngBytes = Buffer.from(base64, 'base64');
      const scanPdf = await PDFDocument.create();
      const scanPage = scanPdf.addPage([595, 420]);
      const embedded = await scanPdf.embedPng(pngBytes);
      scanPage.drawImage(embedded, { x: 0, y: 0, width: 595, height: 280 });
      const scanPdfBytes = await scanPdf.save();

      // Ouvre ce PDF scanné dans l'application empaquetée via l'input caché
      await page.locator('.app-shell > input[type="file"]').setInputFiles({
        name: 'scan-windows.pdf',
        mimeType: 'application/pdf',
        buffer: Buffer.from(scanPdfBytes),
      });

      await expect(page.getByRole('tab')).toHaveCount(2, { timeout: 15_000 });
      await expect(page.locator('[data-page-number="1"] canvas').last()).toBeVisible({
        timeout: 15_000,
      });

      // Lance l'OCR 100 % hors ligne à l'intérieur de app.asar (protocol app://basic-pdf/)
      await page.getByRole('button', { name: 'Lire le texte (OCR)' }).click();
      await expect(page.locator('.toast-banner')).toContainText('Lecture terminée', {
        timeout: 25_000,
      });

      const ocrBlocks = page.locator('[data-testid^="text-block-"]');
      expect(await ocrBlocks.count()).toBeGreaterThanOrEqual(1);
      await ocrBlocks.first().click();

      // Vérifie que le panneau de droite affiche automatiquement la police Windows installée la plus proche
      const inspector = page.getByRole('complementary', { name: 'Panneau de correction de texte' });
      await expect(inspector).toContainText('Texte lu (OCR)');
      await expect(inspector).toContainText('(installée)');
    } finally {
      await electronApp.close();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
