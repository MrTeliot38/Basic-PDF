import { expect, test } from '@playwright/test';
import { PDFDict, PDFDocument, PDFName, StandardFonts, rgb } from 'pdf-lib';

/**
 * Construit un document PDF de test synthétique à 2 pages :
 * - Page 1 : scan image haute définition contenant un en-tête sans-serif gras
 *            et un paragraphe de 4 lignes en police Serif Italique (Georgia).
 * - Page 2 : feuille quasi vierge pour ajouter une Date et un Texte libre.
 */
async function buildMultiStyleScanAndFormPdf(
  page: import('@playwright/test').Page,
): Promise<Uint8Array> {
  const pngBase64 = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 1240;
    canvas.height = 1754;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.fillStyle = '#111827';
    // En-tête droit et gras sans empattement
    ctx.font = 'bold 40px Arial, Helvetica, sans-serif';
    ctx.fillText('ATTESTATION TECHNIQUE', 110, 180);

    // Corps de texte multi-lignes en serif italique (Georgia)
    ctx.font = 'italic 30px Georgia, "Times New Roman", serif';
    ctx.fillText('Premier paragraphe redige avec empattements inclines.', 110, 320);
    ctx.fillText('Deuxieme ligne du meme document pour verifier le style.', 110, 376);
    ctx.fillText('Troisieme ligne de verification visuelle sans defaut.', 110, 432);
    ctx.fillText('Quatrieme ligne confirmant la reconnaissance de police.', 110, 488);

    return canvas.toDataURL('image/png').split(',')[1];
  });

  const doc = await PDFDocument.create();
  const page1 = doc.addPage([595, 842]);
  const pngImage = await doc.embedPng(Buffer.from(pngBase64, 'base64'));
  page1.drawImage(pngImage, { x: 0, y: 0, width: 595, height: 842 });

  const page2 = doc.addPage([595, 842]);
  const helv = await doc.embedFont(StandardFonts.Helvetica);
  page2.drawText('Zone de signature :', {
    x: 54,
    y: 740,
    size: 12,
    font: helv,
    color: rgb(0.2, 0.2, 0.2),
  });

  return await doc.save();
}

test.describe('Reconnaissance visuelle des polices et cohérence Date / Texte libre', () => {
  test('distingue serif/italique vs sans-serif/gras sur scan OCR et propage la police aux annotations', async ({
    page,
  }) => {
    test.setTimeout(90_000);
    const pdfBytes = await buildMultiStyleScanAndFormPdf(page);
    await page.goto('/');

    await page.locator('.app-shell > input[type="file"]').setInputFiles({
      name: 'scan-polices-multiples.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from(pdfBytes),
    });

    const scanBanner = page.getByRole('region', { name: 'Document scanné détecté' });
    await expect(scanBanner).toBeVisible({ timeout: 15_000 });
    await scanBanner.getByRole('button', { name: 'Lire le texte (OCR)' }).click();

    const ocrBlocks = page.locator('[data-block-source="ocr"]');
    await expect(ocrBlocks.first()).toBeVisible({ timeout: 60_000 });

    // L'OCR active automatiquement le mode édition de texte ; si besoin on s'assure qu'il est actif
    const editTextBtn = page.getByRole('button', { name: 'Modifier le texte' });
    if ((await editTextBtn.getAttribute('aria-pressed')) === 'false') {
      await editTextBtn.click();
    }

    // Vérifie le bloc titre (doit être reconnu en gras sans basculer sur une mauvaise graisse)
    const headerBlock = ocrBlocks.filter({ hasText: /ATTESTATION/i }).first();
    await headerBlock.click();
    await expect(page.getByRole('button', { name: 'Gras' })).toHaveAttribute('aria-pressed', 'true');

    // Vérifie un bloc du corps en italique avec empattements (ne doit plus tomber sur Arial droit)
    const italicSerifBlock = ocrBlocks.filter({ hasText: /Deuxieme|Premier|Troisieme/i }).first();
    await italicSerifBlock.click();
    await expect(page.getByRole('button', { name: 'Italique' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    const detectedFontVal = await page.locator('#inspector-font-select').inputValue();
    expect(detectedFontVal.toLowerCase()).toContain('serif');
    expect(detectedFontVal.toLowerCase()).not.toContain('sans-serif');

    // Quitte le mode édition de texte puis ouvre les outils d'annotation sur la page 2
    await page.getByRole('button', { name: 'Désélectionner' }).click();
    await editTextBtn.click();
    const page2El = page.locator('[data-page-number="2"]');
    await page2El.scrollIntoViewIfNeeded();
    await page.getByRole('button', { name: 'Annoter, remplir et signer' }).click();

    const annotBar = page.getByRole('region', { name: "Outils d'annotation et de signature" });
    await annotBar.getByRole('button', { name: 'Date' }).click();

    // La barre d'options propose déjà la police dominante détectée (serif italique, pas Arial)
    const annotFontSelect = page.locator('#annot-font-select');
    await expect(annotFontSelect).toBeVisible();
    const defaultAnnotFont = await annotFontSelect.inputValue();
    expect(defaultAnnotFont.toLowerCase()).toContain('serif');
    expect(defaultAnnotFont.toLowerCase()).not.toContain('sans-serif');
    await expect(page.getByRole('button', { name: "Italique de l'annotation" })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(page.getByRole('button', { name: "Gras de l'annotation" })).toHaveAttribute(
      'aria-pressed',
      'false',
    );

    // Pose la Date sur la page 2 (conserve la police serif italique du document) et vérifie le rendu
    const p2Box = (await page2El.boundingBox())!;
    await page2El.click({ position: { x: p2Box.width * 0.45, y: p2Box.height * 0.3 } });
    const dateLabel = page2El.locator('.annot-free-text-label').first();
    await expect(dateLabel).toBeVisible();
    await expect(dateLabel).toHaveCSS('font-style', 'italic');

    // Passe à l'outil Texte libre, puis choisit explicitement Courier Bold 16pt
    await annotBar.getByRole('button', { name: 'Texte libre' }).click();
    const courierVal = await annotFontSelect.evaluate((sel: HTMLSelectElement) => {
      const opt = Array.from(sel.options).find((o) => /courier/i.test(o.text) || /courier/i.test(o.value));
      return opt?.value ?? '';
    });
    expect(courierVal.toLowerCase()).toContain('courier');
    await annotFontSelect.selectOption(courierVal);
    await page.locator('#annot-fontsize-input').fill('16');
    const boldAnnotBtn = page.getByRole('button', { name: "Gras de l'annotation" });
    if ((await boldAnnotBtn.getAttribute('aria-pressed')) !== 'true') {
      await boldAnnotBtn.click();
    }
    await page2El.click({ position: { x: p2Box.width * 0.35, y: p2Box.height * 0.5 } });
    const inlineInput = page2El.locator('.annot-inline-input');
    await expect(inlineInput).toBeVisible();
    await inlineInput.fill('Signature certifiee');
    await inlineInput.press('Enter');

    const freeTextLabel = page2El
      .locator('.annot-free-text-label')
      .filter({ hasText: 'Signature certifiee' });
    await expect(freeTextLabel).toBeVisible();
    await expect(freeTextLabel).toHaveCSS('font-weight', '700');
    await expect(freeTextLabel).toHaveCSS('font-family', /Courier/i);

    // Exporte le PDF et vérifie qu'il reste valide et intègre bien nos deux annotations
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Enregistrer' }).click();
    const download = await downloadPromise;
    const stream = await download.createReadStream();
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(Buffer.from(chunk));
    }
    const savedBuf = Buffer.concat(chunks);
    expect(savedBuf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    // Décompresse les objets du PDF sauvegardé et vérifie que les polices Times et Courier y sont intégrées
    const reloaded = await PDFDocument.load(savedBuf);
    const baseFonts: string[] = [];
    for (const [, obj] of reloaded.context.enumerateIndirectObjects()) {
      if (obj instanceof PDFDict) {
        const bf = obj.get(PDFName.of('BaseFont'));
        if (bf) {
          baseFonts.push(bf.toString());
        }
      }
    }
    const joinedFonts = baseFonts.join(' ');
    expect(joinedFonts).toMatch(/Courier/i);
    expect(joinedFonts).toMatch(/Times/i);
  });
});
