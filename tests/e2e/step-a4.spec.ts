import { expect, test } from '@playwright/test';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

async function buildFormAndRedactionPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.HelveticaBold);

  // Page 1 : formulaire interactif AcroForm + espace libre pour signer et annoter
  const page1 = doc.addPage([595, 842]);
  const form = doc.getForm();

  page1.drawText('Formulaire de demande', { x: 50, y: 785, size: 16, font, color: rgb(0.1, 0.1, 0.1) });
  page1.drawText('Nom complet :', { x: 50, y: 745, size: 12, font });
  const nameField = form.createTextField('nom_complet');
  nameField.addToPage(page1, { x: 160, y: 735, width: 220, height: 24 });

  page1.drawText("J'accepte :", { x: 50, y: 700, size: 12, font });
  const checkField = form.createCheckBox('accord_conditions');
  checkField.addToPage(page1, { x: 160, y: 696, width: 18, height: 18 });

  page1.drawText('Ville :', { x: 50, y: 660, size: 12, font });
  const cityField = form.createDropdown('ville');
  cityField.addOptions(['Paris', 'Lyon', 'Marseille']);
  cityField.addToPage(page1, { x: 160, y: 650, width: 160, height: 24 });

  // Page 2 : phrase publique + donnée secrète à caviarder réellement
  const page2 = doc.addPage([595, 842]);
  page2.drawText('Code confidentiel : SECRET_9942_XYZ', {
    x: 50,
    y: 740,
    size: 16,
    font,
    color: rgb(0.05, 0.05, 0.05),
  });
  page2.drawText('Document public conserve', {
    x: 50,
    y: 660,
    size: 15,
    font,
    color: rgb(0.1, 0.1, 0.1),
  });

  return await doc.save();
}

test('Étape A4 : formulaires, signature mémorisée, annotations et caviardage destructif réel', async ({
  page,
}) => {
  await page.goto('/');

  const pdfBytes = await buildFormAndRedactionPdf();
  await page.locator('.app-shell > input[type="file"]').setInputFiles({
    name: 'dossier-formulaire.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from(pdfBytes),
  });

  await expect(page.locator('[data-page-number="1"] canvas')).toBeVisible({ timeout: 15_000 });

  // 1. Remplissage du formulaire AcroForm
  const nameInput = page.locator('[data-form-field="nom_complet"]');
  await expect(nameInput).toBeVisible({ timeout: 10_000 });
  await nameInput.fill('Marie Curie');

  const acceptCheckbox = page.locator('[data-form-field="accord_conditions"]');
  await acceptCheckbox.check();
  await expect(acceptCheckbox).toBeChecked();

  const citySelect = page.locator('[data-form-field="ville"]');
  await citySelect.selectOption('Lyon');
  await expect(citySelect).toHaveValue('Lyon');

  // 2. Ouverture de la barre d'annotations, remplissage libre et signature
  const annotBtn = page.getByRole('button', { name: 'Annoter, remplir et signer' });
  await annotBtn.scrollIntoViewIfNeeded();
  await annotBtn.click();
  await expect(page.getByRole('region', { name: "Outils d'annotation et de signature" })).toBeVisible();

  // Ajuste à la page entière pour que toutes les zones de la page 1 soient visibles à l'écran
  const fitPageBtn = page.getByRole('button', { name: 'Afficher la page entière' });
  await fitPageBtn.scrollIntoViewIfNeeded();
  await fitPageBtn.click();

  // Surlignage + tampon sur la page 1
  const page1El = page.locator('[data-page-number="1"]');
  await page1El.scrollIntoViewIfNeeded();
  const annotBar = page.getByRole('region', { name: "Outils d'annotation et de signature" });
  await annotBar.getByRole('button', { name: 'Surligner' }).click();

  const p1Box = await page1El.boundingBox();
  expect(p1Box).not.toBeNull();
  await page.mouse.move(p1Box!.x + p1Box!.width * 0.15, p1Box!.y + p1Box!.height * 0.35);
  await page.mouse.down();
  await page.mouse.move(p1Box!.x + p1Box!.width * 0.55, p1Box!.y + p1Box!.height * 0.39, {
    steps: 5,
  });
  await page.mouse.up();
  await expect(page1El.locator('.annotation-item')).toHaveCount(1);

  await annotBar.getByRole('button', { name: 'Tampon', exact: true }).click();
  await page.mouse.click(p1Box!.x + p1Box!.width * 0.35, p1Box!.y + p1Box!.height * 0.48);
  await expect(page1El.locator('.annot-stamp-badge')).toHaveCount(1);

  // Dessin de signature + mémorisation locale + placement
  await annotBar.getByRole('button', { name: 'Signer', exact: true }).click();
  const sigModal = page.getByRole('dialog', { name: 'Ajouter une signature' });
  await expect(sigModal).toBeVisible();

  const sigCanvas = sigModal.locator('.signature-canvas');
  const sigBox = await sigCanvas.boundingBox();
  expect(sigBox).not.toBeNull();
  await page.mouse.move(sigBox!.x + 40, sigBox!.y + 70);
  await page.mouse.down();
  await page.mouse.move(sigBox!.x + 170, sigBox!.y + 45, { steps: 6 });
  await page.mouse.move(sigBox!.x + 240, sigBox!.y + 95, { steps: 6 });
  await page.mouse.up();

  await sigModal.getByRole('button', { name: 'Placer sur le document' }).click();
  await expect(sigModal).toBeHidden();

  // Clique sur la page 1 pour poser la signature
  const p1BoxSign = await page1El.boundingBox();
  await page.mouse.click(p1BoxSign!.x + p1BoxSign!.width * 0.45, p1BoxSign!.y + p1BoxSign!.height * 0.62);
  await expect(page1El.locator('.annot-signature-img')).toHaveCount(1);

  // Vérifie que la signature a bien été mémorisée dans localStorage ET proposée à la réouverture
  const savedCount = await page.evaluate(() => {
    const raw = localStorage.getItem('basic-pdf-saved-signatures-v1');
    return raw ? JSON.parse(raw).length : 0;
  });
  expect(savedCount).toBeGreaterThanOrEqual(1);
  await annotBar.getByRole('button', { name: 'Signer', exact: true }).click();
  await expect(sigModal.locator('.saved-sig-pick')).toHaveCount(1);
  await sigModal.getByRole('button', { name: 'Fermer la fenêtre de signature' }).click();

  // 3. Caviardage irréversible sur la page 2 (ligne "Code confidentiel : SECRET_9942_XYZ")
  const page2El = page.locator('[data-page-number="2"]');
  await page2El.evaluate((el) => el.scrollIntoView({ block: 'start' }));
  await expect(page2El.locator('canvas')).toBeVisible({ timeout: 10_000 });
  await expect(page2El.locator('.pdf-page-loading')).toBeHidden({ timeout: 10_000 });

  await annotBar.getByRole('button', { name: 'Caviarder', exact: true }).click();
  const p2Box = await page2El.boundingBox();
  expect(p2Box).not.toBeNull();

  // Couvre largement la bande haute (y PDF ~740/842 -> y CSS ~6% à ~16% du haut de page)
  await page.mouse.move(p2Box!.x + 12, p2Box!.y + p2Box!.height * 0.06);
  await page.mouse.down();
  await page.mouse.move(p2Box!.x + p2Box!.width * 0.9, p2Box!.y + p2Box!.height * 0.16, { steps: 6 });
  await page.mouse.up();
  await expect(page2El.locator('.annot-redact-box')).toHaveCount(1);

  // Enregistrement du PDF caviardé et rempli
  const saveBtn = page.getByRole('button', { name: 'Enregistrer' });
  await saveBtn.scrollIntoViewIfNeeded();
  const [download] = await Promise.all([page.waitForEvent('download'), saveBtn.click()]);
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.from(chunk));
  }
  const savedBuffer = Buffer.concat(chunks);

  // Vérifie la persistance des champs AcroForm sur la page 1
  const reloadedFormDoc = await PDFDocument.load(savedBuffer);
  const reloadedForm = reloadedFormDoc.getForm();
  expect(reloadedForm.getTextField('nom_complet').getText()).toBe('Marie Curie');
  expect(reloadedForm.getCheckBox('accord_conditions').isChecked()).toBe(true);
  expect(reloadedForm.getDropdown('ville').getSelected()).toEqual(['Lyon']);

  // Vérifie l'absence totale de la donnée secrète dans les octets bruts ET dans le lecteur une fois réouvert
  expect(savedBuffer.toString('latin1')).not.toContain('SECRET_9942_XYZ');

  await page.locator('.app-shell > input[type="file"]').setInputFiles({
    name: 'verif-caviarde.pdf',
    mimeType: 'application/pdf',
    buffer: savedBuffer,
  });
  await expect(page.locator('[data-page-number="2"] canvas')).toBeVisible({ timeout: 15_000 });

  // Recherche Ctrl+F dans le PDF réouvert -> 0 résultat pour le texte caviardé !
  const searchBtn = page.getByRole('button', { name: 'Rechercher' });
  await searchBtn.scrollIntoViewIfNeeded();
  await searchBtn.click();
  await page.getByLabel('Texte à rechercher').fill('SECRET_9942_XYZ');
  await expect(page.locator('.search-counter')).toContainText('0 résultat');

  // Aucun débordement horizontal sur desktop ni sur mobile
  const noOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth <= window.innerWidth + 1,
  );
  expect(noOverflow).toBe(true);
});
