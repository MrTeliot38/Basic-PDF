import { expect, test } from '@playwright/test';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

async function buildColoredAndGradientPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([595, 842]);
  const font = await doc.embedFont(StandardFonts.HelveticaBold);

  // 1. Fond bleu uni + texte blanc
  page.drawRectangle({ x: 50, y: 700, width: 260, height: 42, color: rgb(0.11, 0.31, 0.85) });
  page.drawText('Texte sur bleu', {
    x: 64,
    y: 714,
    size: 16,
    font,
    color: rgb(1, 1, 1),
  });

  // 2. Encadré étroit jaune pâle avec bordure foncée
  page.drawRectangle({
    x: 50,
    y: 620,
    width: 240,
    height: 28,
    color: rgb(0.996, 0.94, 0.54),
    borderColor: rgb(0.57, 0.25, 0.05),
    borderWidth: 2,
  });
  page.drawText('Encadre etroit', {
    x: 64,
    y: 628,
    size: 14,
    font,
    color: rgb(0.07, 0.09, 0.15),
  });

  // 3. Dégradé horizontal bleu foncé -> bleu clair (30 bandes) + texte blanc
  const gradX = 50;
  const gradY = 530;
  const gradW = 280;
  const gradH = 44;
  const strips = 28;
  for (let i = 0; i < strips; i += 1) {
    const t = i / (strips - 1);
    page.drawRectangle({
      x: gradX + (i * gradW) / strips,
      y: gradY,
      width: gradW / strips + 0.5,
      height: gradH,
      color: rgb(0.12 + t * 0.46, 0.23 + t * 0.54, 0.54 + t * 0.44),
    });
  }
  page.drawText('Sur degrade', {
    x: 68,
    y: 545,
    size: 16,
    font,
    color: rgb(1, 1, 1),
  });

  return await doc.save();
}

async function buildTwoColumnImagePdf(page: import('@playwright/test').Page): Promise<Uint8Array> {
  // Dessine une grande image PNG unique avec 2 colonnes bien alignées sur les mêmes lignes
  const pngBase64 = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 920;
    canvas.height = 560;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.fillStyle = '#111827';
    ctx.font = 'bold 34px Arial, sans-serif';
    ctx.fillText('COLONNE GAUCHE', 48, 120);
    ctx.fillText('COLONNE DROITE', 520, 120);

    ctx.font = '26px Arial, sans-serif';
    ctx.fillText('Premier texte gauche', 48, 195);
    ctx.fillText('Second texte droite', 520, 195);
    return canvas.toDataURL('image/png').split(',')[1];
  });

  const doc = await PDFDocument.create();
  const pdfPage = doc.addPage([600, 365]);
  const pngImage = await doc.embedPng(Buffer.from(pngBase64, 'base64'));
  pdfPage.drawImage(pngImage, { x: 0, y: 0, width: 600, height: 365 });
  return await doc.save();
}

test.describe('Basic PDF — Étape A2 (Édition de texte, fond préservé, recherche et OCR)', () => {
  test('conserve le fond (couleur, encadré étroit, dégradé) après correction et suppression', async ({
    page,
  }) => {
    const pdfBytes = await buildColoredAndGradientPdf();
    await page.goto('/');

    await page.locator('input[type="file"]').setInputFiles({
      name: 'fonds-couleurs.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from(pdfBytes),
    });

    await expect(page.getByTestId('pdf-viewer')).toBeVisible();
    await page.getByRole('button', { name: 'Modifier le texte' }).click();

    // Attend l'extraction des 3 blocs de texte sur la page
    const blueBlock = page.locator('[data-testid^="text-block-"]').nth(0);
    await expect(page.locator('[data-testid^="text-block-"]')).toHaveCount(3);

    // 1. Modifie "Texte sur bleu" via le panneau de droite après sélection
    await blueBlock.click();
    const inspectorText = page.locator('#inspector-text-input');
    await expect(inspectorText).toHaveValue('Texte sur bleu');
    await inspectorText.fill('Nouveau bleu');
    await page.getByRole('button', { name: 'Appliquer' }).click();

    // Vérifie que le patch de fond du bloc bleu est bien bleu et JAMAIS blanc
    const blueBlockId = (await blueBlock.getAttribute('data-testid'))!.replace('text-block-', '');
    const bluePatch = page.getByTestId(`bg-patch-${blueBlockId}`);
    await expect(bluePatch).toBeVisible();

    const blueRgb = await bluePatch.evaluate(async (img: HTMLImageElement) => {
      if (!img.complete) await new Promise((r) => (img.onload = r));
      const c = document.createElement('canvas');
      c.width = img.naturalWidth;
      c.height = img.naturalHeight;
      const ctx = c.getContext('2d')!;
      ctx.drawImage(img, 0, 0);
      const px = ctx.getImageData(Math.floor(c.width / 2), Math.floor(c.height / 2), 1, 1).data;
      return [px[0], px[1], px[2]];
    });
    expect(blueRgb[2]).toBeGreaterThan(150);
    expect(blueRgb[0]).toBeLessThan(90);

    // 2. Modifie "Encadre etroit" et vérifie que son fond reste jaune pâle
    const boxBlock = page.locator('[data-testid^="text-block-"]').nth(1);
    await boxBlock.click();
    await expect(inspectorText).toHaveValue('Encadre etroit');
    await inspectorText.fill('Boite OK');
    await page.getByRole('button', { name: 'Appliquer' }).click();

    const boxBlockId = (await boxBlock.getAttribute('data-testid'))!.replace('text-block-', '');
    const boxPatch = page.getByTestId(`bg-patch-${boxBlockId}`);
    const boxRgb = await boxPatch.evaluate(async (img: HTMLImageElement) => {
      if (!img.complete) await new Promise((r) => (img.onload = r));
      const c = document.createElement('canvas');
      c.width = img.naturalWidth;
      c.height = img.naturalHeight;
      const ctx = c.getContext('2d')!;
      ctx.drawImage(img, 0, 0);
      const px = ctx.getImageData(Math.floor(c.width / 2), Math.floor(c.height / 2), 1, 1).data;
      return [px[0], px[1], px[2]];
    });
    expect(boxRgb[0]).toBeGreaterThan(215);
    expect(boxRgb[1]).toBeGreaterThan(205);
    expect(boxRgb[2]).toBeLessThan(170);

    // 3. Modifie "Sur degrade" et vérifie que le dégradé gauche->droite reste nuancé (pas un aplat blanc)
    const gradBlock = page.locator('[data-testid^="text-block-"]').nth(2);
    await gradBlock.click();
    await expect(inspectorText).toHaveValue('Sur degrade');
    await inspectorText.fill('Degrade OK');
    await page.getByRole('button', { name: 'Appliquer' }).click();

    const gradBlockId = (await gradBlock.getAttribute('data-testid'))!.replace('text-block-', '');
    const gradPatch = page.getByTestId(`bg-patch-${gradBlockId}`);
    const gradSamples = await gradPatch.evaluate(async (img: HTMLImageElement) => {
      if (!img.complete) await new Promise((r) => (img.onload = r));
      const c = document.createElement('canvas');
      c.width = img.naturalWidth;
      c.height = img.naturalHeight;
      const ctx = c.getContext('2d')!;
      ctx.drawImage(img, 0, 0);
      const leftPx = ctx.getImageData(Math.floor(c.width * 0.15), Math.floor(c.height / 2), 1, 1).data;
      const rightPx = ctx.getImageData(Math.floor(c.width * 0.85), Math.floor(c.height / 2), 1, 1).data;
      return {
        left: [leftPx[0], leftPx[1], leftPx[2]],
        right: [rightPx[0], rightPx[1], rightPx[2]],
      };
    });
    expect(gradSamples.right[0] - gradSamples.left[0]).toBeGreaterThan(20);
    expect(gradSamples.left[2]).toBeGreaterThan(110);
  });

  test('Suppr efface vraiment, vider le texte efface aussi, seul Rétablir ramène l’original, Ctrl+Z/Y fiables', async ({
    page,
  }) => {
    await page.goto('/');
    await page.getByRole('button', { name: /Essayer un document d’exemple/i }).click();
    await expect(page.getByTestId('pdf-viewer')).toBeVisible();

    await page.getByRole('button', { name: 'Modifier le texte' }).click();
    const blocks = page.locator('[data-testid^="text-block-"]');
    await expect(blocks.first()).toBeVisible();
    const initialCount = await blocks.count();

    // Sélectionne le 1er bloc, le corrige, puis appuie sur Suppr
    const firstBlock = blocks.first();
    const firstId = (await firstBlock.getAttribute('data-testid'))!;
    await firstBlock.click();
    await page.locator('#inspector-text-input').fill('Titre modifie');
    await page.getByRole('button', { name: 'Appliquer' }).click();
    await expect(page.getByTestId(firstId)).toContainText('Titre modifie');

    // Appuie sur Suppr (Delete) alors que le bloc est sélectionné (et pas un champ texte)
    await page.keyboard.press('Delete');

    // Le bloc doit avoir disparu de la page (sans revenir à l'original !)
    await expect(page.getByTestId(firstId)).toHaveCount(0);
    await expect(blocks).toHaveCount(initialCount - 1);

    // Le patch de fond continue de masquer l'ancien texte
    const rawId = firstId.replace('text-block-', '');
    await expect(page.getByTestId(`bg-patch-${rawId}`)).toBeVisible();

    // Seul le bouton "Rétablir le texte d’origine" dans le panneau de droite le fait revenir
    await page.getByRole('button', { name: 'Rétablir le texte d’origine' }).click();
    await expect(page.getByTestId(firstId)).toBeVisible();
    await expect(blocks).toHaveCount(initialCount);

    // Vider entièrement un texte corrigé via l'édition sur la page l'efface aussi
    await page.getByTestId(firstId).dblclick();
    const inlineEditor = page.locator('.inline-text-editor');
    await expect(inlineEditor).toBeVisible();
    await inlineEditor.fill('');
    await inlineEditor.press('Enter');
    await expect(page.getByTestId(firstId)).toHaveCount(0);

    // Ctrl+Z annule la suppression ; Ctrl+Y la rétablit
    await page.keyboard.press('Control+z');
    await expect(page.getByTestId(firstId)).toBeVisible();
    await page.keyboard.press('Control+y');
    await expect(page.getByTestId(firstId)).toHaveCount(0);
  });

  test('déplacer, style, rechercher et remplacer, et enregistrer le PDF modifié', async ({
    page,
  }) => {
    await page.goto('/');
    await page.getByRole('button', { name: /Essayer un document d’exemple/i }).click();
    await expect(page.getByTestId('pdf-viewer')).toBeVisible();

    await page.getByRole('button', { name: 'Modifier le texte' }).click();
    const firstBlock = page.locator('[data-testid^="text-block-"]').first();
    await expect(firstBlock).toBeVisible();

    // Simple clic sans déplacement ne marque pas le document modifié (Annuler reste désactivé)
    await firstBlock.click();
    await expect(page.getByRole('button', { name: 'Annuler' })).toBeDisabled();

    // Déplacement à la souris
    const boxBefore = (await firstBlock.boundingBox())!;
    await page.mouse.move(boxBefore.x + boxBefore.width / 2, boxBefore.y + boxBefore.height / 2);
    await page.mouse.down();
    await page.mouse.move(boxBefore.x + boxBefore.width / 2 + 45, boxBefore.y + boxBefore.height / 2 + 25, {
      steps: 5,
    });
    await page.mouse.up();

    const boxAfter = (await firstBlock.boundingBox())!;
    expect(boxAfter.x).toBeGreaterThan(boxBefore.x + 20);
    await expect(page.getByRole('button', { name: 'Annuler' })).toBeEnabled();

    // Changement de style (Gras + Couleur) dans le panneau de droite
    await page.getByRole('button', { name: 'Gras' }).click();
    await page.getByRole('button', { name: 'Couleur #dc2626' }).click();
    await expect(firstBlock.locator('.rendered-edited-text')).toHaveCSS('font-weight', '700');

    // Rechercher et remplacer
    await page.getByRole('button', { name: 'Rechercher', exact: true }).click();
    await page.getByLabel('Texte à rechercher').fill('demonstration');
    await expect(page.locator('.search-counter')).not.toHaveText('0 résultat');
    await page.getByRole('button', { name: 'Rechercher et remplacer' }).click();
    await page.getByLabel('Texte de remplacement').fill('validation');
    await page.getByRole('button', { name: 'Tout remplacer' }).click();

    await expect(page.locator('.rendered-edited-text').filter({ hasText: 'validation' }).first()).toBeVisible();

    // Enregistrer produit un vrai fichier PDF téléchargeable non vide
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Enregistrer' }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toContain('.pdf');
    const savedStream = await download.createReadStream();
    const chunks: Buffer[] = [];
    for await (const chunk of savedStream) {
      chunks.push(Buffer.from(chunk));
    }
    const savedBuffer = Buffer.concat(chunks);
    expect(savedBuffer.subarray(0, 5).toString('latin1')).toBe('%PDF-');
  });

  test('OCR hors ligne sur PDF image unique à deux colonnes sans fusionner les colonnes', async ({
    page,
  }) => {
    test.setTimeout(60_000);
    const externalRequests: string[] = [];

    await page.goto('/');
    page.on('request', (req) => {
      const url = req.url();
      if (
        !url.startsWith('http://127.0.0.1:') &&
        !url.startsWith('data:') &&
        !url.startsWith('blob:')
      ) {
        externalRequests.push(url);
      }
    });

    const scanPdfBytes = await buildTwoColumnImagePdf(page);
    await page.locator('input[type="file"]').setInputFiles({
      name: 'tract-deux-colonnes.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from(scanPdfBytes),
    });

    // Vérifie que l'application détecte la page image sans texte et propose l'OCR
    const scanBanner = page.getByRole('region', { name: 'Document scanné détecté' });
    await expect(scanBanner).toBeVisible();
    await scanBanner.getByRole('button', { name: 'Lire le texte (OCR)' }).click();

    // Attend la fin de la reconnaissance hors ligne
    const ocrBlocks = page.locator('[data-block-source="ocr"]');
    await expect(ocrBlocks.first()).toBeVisible({ timeout: 45_000 });

    const blockTexts = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('[data-block-source="ocr"]')).map((el) =>
        (el.textContent ?? '').trim(),
      );
    });
    // Aucun bloc ne doit avoir fusionné la colonne gauche et la colonne droite sur la même ligne
    const allJoined = blockTexts.join(' | ').toUpperCase();
    expect(allJoined).toContain('GAUCHE');
    expect(allJoined).toContain('DROITE');
    for (const txt of blockTexts) {
      const upper = txt.toUpperCase();
      expect(upper.includes('GAUCHE') && upper.includes('DROITE')).toBe(false);
    }

    // Zéro requête réseau externe pendant tout l'OCR
    expect(externalRequests).toEqual([]);
  });
});
