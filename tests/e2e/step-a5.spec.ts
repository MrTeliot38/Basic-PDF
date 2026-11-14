import { expect, test, type Page } from '@playwright/test';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

async function makeNoisyPngBuffer(page: Page, width: number, height: number): Promise<Buffer> {
  const base64 = await page.evaluate(
    ({ w, h }) => {
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      const ctx = c.getContext('2d')!;
      const imgData = ctx.createImageData(w, h);
      let seed = 42;
      for (let i = 0; i < imgData.data.length; i += 4) {
        seed = (seed * 1664525 + 1013904223) >>> 0;
        imgData.data[i] = seed & 0xff;
        imgData.data[i + 1] = (seed >> 8) & 0xff;
        imgData.data[i + 2] = (seed >> 16) & 0xff;
        imgData.data[i + 3] = 255;
      }
      ctx.putImageData(imgData, 0, 0);
      return c.toDataURL('image/png').split(',')[1];
    },
    { w: width, h: height },
  );
  return Buffer.from(base64, 'base64');
}

async function buildHeavyMultiPagePdf(page: Page, count = 4): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.HelveticaBold);
  const photoPng = await doc.embedPng(await makeNoisyPngBuffer(page, 380, 380));

  for (let i = 1; i <= count; i += 1) {
    const p = doc.addPage([595, 842]);
    p.drawImage(photoPng, { x: 80, y: 260, width: 420, height: 420 });
    p.drawText(`Page numero ${i}`, {
      x: 60,
      y: 760,
      size: 20,
      font,
      color: rgb(0.1, 0.15, 0.35),
    });
  }
  return await doc.save();
}

async function readDownloadBuffer(download: import('@playwright/test').Download): Promise<Buffer> {
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

test('Étape A5 : organisation des pages, fusion, division, export images, compression, impression livret et partage', async ({
  page,
}) => {
  await page.goto('/');

  const heavyBytes = await buildHeavyMultiPagePdf(page, 4);
  const extraDoc = await PDFDocument.create();
  extraDoc.addPage([595, 842]);
  const extraBytes = await extraDoc.save();

  await page.locator('.app-shell > input[type="file"]').setInputFiles({
    name: 'brochure-4pages.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from(heavyBytes),
  });
  await expect(page.locator('[data-page-number="1"] canvas')).toBeVisible({ timeout: 15_000 });

  // 1. Ouvre le gestionnaire de pages (Organiser & Fusionner)
  const pagesBtn = page.getByRole('button', { name: 'Organiser les pages et exporter' });
  await pagesBtn.scrollIntoViewIfNeeded();
  await pagesBtn.click();

  const pageModal = page.getByRole('dialog', { name: 'Gestion des pages et export' });
  await expect(pageModal).toBeVisible();
  await expect(pageModal).toContainText('(4 pages)');

  // Ajoute une page vierge -> passe à 5 pages
  await pageModal.getByRole('button', { name: 'Ajouter une page vierge' }).click();
  await expect(pageModal).toContainText('(5 pages)', { timeout: 10_000 });

  // Pivote page 1 à droite, duplique page 1, puis supprime la copie -> revient à 5 pages
  await pageModal.getByRole('button', { name: 'Pivoter la page 1 à droite' }).click();
  await expect(pageModal).toContainText('(5 pages)');

  await pageModal.getByRole('button', { name: 'Dupliquer la page 1' }).click();
  await expect(pageModal).toContainText('(6 pages)', { timeout: 10_000 });

  await pageModal.getByRole('button', { name: 'Supprimer la page 2' }).click();
  await expect(pageModal).toContainText('(5 pages)', { timeout: 10_000 });

  // Fusionne un autre PDF -> passe à 6 pages
  await pageModal
    .locator('input[aria-label="Choisir un autre PDF à fusionner"]')
    .setInputFiles({
      name: 'annexe.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from(extraBytes),
    });
  await expect(pageModal).toContainText('(6 pages)', { timeout: 10_000 });

  // Extraire & Diviser -> export ZIP + extraction vers un nouvel onglet
  await pageModal.getByRole('tab', { name: 'Extraire & Diviser' }).click();
  const [splitDownload] = await Promise.all([
    page.waitForEvent('download'),
    pageModal.getByRole('button', { name: 'Diviser et télécharger' }).click(),
  ]);
  const splitZipBuf = await readDownloadBuffer(splitDownload);
  expect(splitZipBuf[0]).toBe(0x50);
  expect(splitZipBuf[1]).toBe(0x4b);

  // Onglet Export JPG / PNG -> export ZIP PNG valide
  await pageModal.getByRole('tab', { name: 'Exporter JPG / PNG' }).click();
  const [imgZipDownload] = await Promise.all([
    page.waitForEvent('download'),
    pageModal.getByRole('button', { name: 'Exporter en PNG' }).click(),
  ]);
  const imgZipBuf = await readDownloadBuffer(imgZipDownload);
  expect(imgZipBuf.toString('latin1')).toContain('.png');

  // Extraction de pages 1-2 dans un nouvel onglet
  await pageModal.getByRole('tab', { name: 'Extraire & Diviser' }).click();
  await pageModal.locator('#extract-pages-input').fill('1-2');
  await pageModal.getByRole('button', { name: 'Ouvrir dans un onglet' }).click();
  await expect(pageModal).toBeHidden();
  await expect(page.locator('.toolbar-document-controls')).toContainText('/ 2');

  // Revient sur le premier onglet pour tester la compression et l'impression livret
  await page.locator('.tab-list .tab-item').first().click();

  // Annuler (Ctrl+Z / bouton Annuler) annule bien la fusion précédente (6 -> 5 pages)
  const undoBtn = page.getByRole('button', { name: 'Annuler' });
  await undoBtn.scrollIntoViewIfNeeded();
  await undoBtn.click();
  await expect(page.locator('.toolbar-document-controls')).toContainText('/ 5');

  // Revenir à 4 pages exactes pour un test propre d'imposition livret (1..4)
  await undoBtn.click(); // 5 (dup+del)
  await undoBtn.click(); // 6
  await undoBtn.click(); // 5 (dup)
  await undoBtn.click(); // 5 (rot)
  await undoBtn.click(); // 4 (initial)
  await expect(page.locator('.toolbar-document-controls')).toContainText('/ 4');

  // 2. Compression avec réduction réelle de taille
  const compressBtn = page.getByRole('button', { name: 'Compresser le PDF' });
  await compressBtn.scrollIntoViewIfNeeded();
  await compressBtn.click();
  const compressModal = page.getByRole('dialog', { name: 'Compresser le PDF' });
  await expect(compressModal).toBeVisible();
  await compressModal.getByLabel(/Maximale/).check();
  await compressModal.getByRole('button', { name: 'Compresser maintenant' }).click();

  const resultBox = compressModal.locator('.compression-result-box');
  await expect(resultBox).toBeVisible({ timeout: 20_000 });
  await compressModal.getByRole('button', { name: 'Appliquer à l’onglet' }).click();
  await expect(compressModal).toBeHidden();

  // 3. Aperçu avant impression complet : livret [4, 1], [2, 3], en-tête et pied de page
  const printBtn = page.getByRole('button', { name: 'Aperçu et impression' });
  await printBtn.scrollIntoViewIfNeeded();
  await printBtn.click();
  const printModal = page.getByRole('dialog', { name: 'Aperçu avant impression' });
  await expect(printModal).toBeVisible();

  await printModal.getByLabel('Impression en livret (pliage cahier automatique)').check();
  await expect(printModal).toContainText('2 feuilles');
  const sheets = printModal.locator('.print-sheet-card');
  await expect(sheets).toHaveCount(2);
  await expect(sheets.nth(0)).toContainText('Page 4');
  await expect(sheets.nth(0)).toContainText('Page 1');
  await expect(sheets.nth(1)).toContainText('Page 2');
  await expect(sheets.nth(1)).toContainText('Page 3');

  await printModal.locator('#print-footer').fill('{titre} — {page}/{total}');
  await expect(sheets.nth(0).locator('.print-sheet-footer')).toContainText('brochure-4pages — 1/2');
  await printModal.getByRole('button', { name: "Fermer l'impression" }).click();

  // 4. Bouton Partager : s'exécute sans erreur (partage natif ou repli téléchargement guidé)
  const shareBtn = page.getByRole('button', { name: 'Partager le PDF' });
  await shareBtn.scrollIntoViewIfNeeded();
  await shareBtn.click();
  await expect(page.locator('.toast-banner')).toBeVisible({ timeout: 10_000 });

  // Vérifie absence de débordement horizontal sur tout écran
  const noOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth <= window.innerWidth + 1,
  );
  expect(noOverflow).toBe(true);
});
