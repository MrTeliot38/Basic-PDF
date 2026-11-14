import { expect, test, type Page } from '@playwright/test';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

async function makePngBuffer(
  page: Page,
  width: number,
  height: number,
  color: string,
  accent?: string,
): Promise<Buffer> {
  const base64 = await page.evaluate(
    ({ w, h, fill, stripe }) => {
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      const ctx = c.getContext('2d')!;
      ctx.fillStyle = fill;
      ctx.fillRect(0, 0, w, h);
      if (stripe) {
        ctx.fillStyle = stripe;
        ctx.fillRect(10, 10, w - 20, Math.max(12, Math.floor(h / 3)));
      }
      return c.toDataURL('image/png').split(',')[1];
    },
    { w: width, h: height, fill: color, stripe: accent },
  );
  return Buffer.from(base64, 'base64');
}

async function buildImageAndBackgroundPdf(page: Page): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.HelveticaBold);

  // Page 1 : grande image de fond claire portant du texte natif (NE DOIT PAS être sélectionnable)
  // + un logo autonome sans texte superposé (DOIT être sélectionnable)
  const page1 = doc.addPage([595, 842]);
  const bgPng = await doc.embedPng(await makePngBuffer(page, 400, 560, '#fef3c7'));
  page1.drawImage(bgPng, { x: 20, y: 20, width: 555, height: 802 });

  page1.drawText('Texte natif par-dessus le fond', {
    x: 56,
    y: 720,
    size: 16,
    font,
    color: rgb(0.08, 0.1, 0.16),
  });

  // Logo autonome en haut à droite (hors de la zone de texte)
  const logoPng = await doc.embedPng(await makePngBuffer(page, 160, 100, '#1d4ed8', '#facc15'));
  page1.drawImage(logoPng, { x: 370, y: 690, width: 140, height: 90 });

  // Page 2 : page simple pour vérifier « Copier sur toutes les pages »
  const page2 = doc.addPage([595, 842]);
  page2.drawText('Deuxieme page', { x: 60, y: 740, size: 16, font, color: rgb(0.1, 0.1, 0.1) });

  return await doc.save();
}

test('Étape A3 : images sélectionnables, image de fond protégée, clic neutre, déplacement, rotation, remplacement, copie et suppression', async ({
  page,
}) => {
  await page.goto('/');

  const pdfBytes = await buildImageAndBackgroundPdf(page);
  await page.locator('.app-shell > input[type="file"]').setInputFiles({
    name: 'document-images.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from(pdfBytes),
  });

  await expect(page.locator('[data-page-number="1"] canvas')).toBeVisible({ timeout: 15_000 });

  // Active le mode Images
  const imgModeBtn = page.getByRole('button', { name: 'Modifier les images' });
  await imgModeBtn.scrollIntoViewIfNeeded();
  await imgModeBtn.click();

  // Règle critique : l'image de fond portant le texte natif NE doit pas être sélectionnable,
  // seul le logo autonome (1 élément) doit apparaître.
  const imgBlocks = page.locator('[data-page-number="1"] .editable-image-block');
  await expect(imgBlocks).toHaveCount(1, { timeout: 10_000 });

  const logoBlock = imgBlocks.first();
  await logoBlock.scrollIntoViewIfNeeded();

  // Survol -> encadrement au survol
  await logoBlock.hover();
  await expect(logoBlock).toHaveClass(/is-hovered/);

  // Clic simple -> sélection mais aucune modification (bouton Annuler toujours désactivé)
  await logoBlock.click();
  await expect(logoBlock).toHaveClass(/is-selected/);
  const inspector = page.getByLabel('Panneau des images');
  await expect(inspector).toContainText('Image sélectionnée');
  const undoBtn = page.getByRole('button', { name: 'Annuler' });
  await expect(undoBtn).toBeDisabled();

  // Déplacement à la souris / pointeur
  const beforeBox = await logoBlock.boundingBox();
  expect(beforeBox).not.toBeNull();
  const startX = beforeBox!.x + beforeBox!.width * 0.4;
  const startY = beforeBox!.y + beforeBox!.height * 0.4;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX - 50, startY + 28, { steps: 6 });
  await page.mouse.up();

  await expect(undoBtn).toBeEnabled();
  const movedBox = await logoBlock.boundingBox();
  expect(movedBox).not.toBeNull();
  expect(Math.abs(movedBox!.x - beforeBox!.x)).toBeGreaterThan(20);

  // Redimensionnement par le coin
  const cornerHandle = logoBlock.locator('.resize-corner-handle');
  const handleBox = await cornerHandle.boundingBox();
  expect(handleBox).not.toBeNull();
  await page.mouse.move(handleBox!.x + handleBox!.width / 2, handleBox!.y + handleBox!.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    handleBox!.x + handleBox!.width / 2 + 28,
    handleBox!.y + handleBox!.height / 2 + 20,
    { steps: 5 },
  );
  await page.mouse.up();
  const resizedBox = await logoBlock.boundingBox();
  expect(resizedBox!.width).toBeGreaterThan(movedBox!.width + 12);

  // Annuler puis Rétablir
  await undoBtn.scrollIntoViewIfNeeded();
  await undoBtn.click();
  const afterUndoResize = await logoBlock.boundingBox();
  expect(Math.abs(afterUndoResize!.width - movedBox!.width)).toBeLessThan(4);

  const redoBtn = page.getByRole('button', { name: 'Rétablir' });
  await redoBtn.scrollIntoViewIfNeeded();
  await redoBtn.click();
  const afterRedoResize = await logoBlock.boundingBox();
  expect(afterRedoResize!.width).toBeGreaterThan(movedBox!.width + 12);

  // Pivoter d'un quart de tour
  const rotateBtn = inspector.getByRole('button', { name: 'Pivoter d’un quart de tour' });
  await rotateBtn.scrollIntoViewIfNeeded();
  await rotateBtn.click();
  await expect(logoBlock).toHaveAttribute('data-image-rotation', '90');

  // Copier sur toutes les pages -> la page 2 reçoit une copie visible
  const copyAllBtn = inspector.getByRole('button', { name: 'Copier sur toutes les pages' });
  await copyAllBtn.scrollIntoViewIfNeeded();
  await copyAllBtn.click();
  await expect(page.locator('[data-page-number="2"] .editable-image-block')).toHaveCount(1);

  // Remplacer par une autre image
  const replacementPng = await makePngBuffer(page, 120, 80, '#dc2626', '#ffffff');
  const prevSrc = await logoBlock.locator('.rendered-edited-image').getAttribute('src');
  await inspector.locator('input[aria-label="Choisir l\'image de remplacement"]').setInputFiles({
    name: 'nouveau-logo.png',
    mimeType: 'image/png',
    buffer: replacementPng,
  });
  await expect(logoBlock.locator('.rendered-edited-image')).not.toHaveAttribute('src', prevSrc ?? '');

  // Remettre à sa place d'origine
  const restoreBtn = inspector.getByRole('button', { name: 'Remettre à sa place d’origine' });
  await restoreBtn.scrollIntoViewIfNeeded();
  await restoreBtn.click();
  await expect(logoBlock).toHaveAttribute('data-image-rotation', '0');

  // Suppression puis Ctrl+Z (via bouton ou touche Suppr)
  await inspector.getByRole('button', { name: 'Supprimer cette image (Suppr)' }).click();
  await expect(imgBlocks).toHaveCount(0);
  await expect(inspector).toContainText('Images supprimées sur cette page');
  await undoBtn.scrollIntoViewIfNeeded();
  await undoBtn.click();
  await expect(imgBlocks).toHaveCount(1);

  // Vérification de la mise en page (aucun débordement horizontal)
  const noOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth <= window.innerWidth + 1,
  );
  expect(noOverflow).toBe(true);

  // Enregistrement réel du PDF
  const saveBtn = page.getByRole('button', { name: 'Enregistrer' });
  await saveBtn.scrollIntoViewIfNeeded();
  const [download] = await Promise.all([page.waitForEvent('download'), saveBtn.click()]);
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.from(chunk));
  }
  const savedDoc = await PDFDocument.load(Buffer.concat(chunks));
  expect(savedDoc.getPageCount()).toBe(2);
});
