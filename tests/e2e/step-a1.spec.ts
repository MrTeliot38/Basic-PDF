import { expect, test } from '@playwright/test';
import { buildSamplePdfBytes } from '../../src/utils/samplePdf';

test.describe('Basic PDF — Étape A1 (Socle, accueil, onglets et lecture)', () => {
  test('écran d’accueil, ouverture hors ligne, rendu réel du PDF, zoom, miniatures et thème', async ({
    page,
  }) => {
    const externalRequests: string[] = [];
    const pageErrors: string[] = [];

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
    page.on('pageerror', (err) => pageErrors.push(err.message));

    await page.goto('/');

    // 1. Vérification visuelle de l'écran d'accueil en français
    await expect(page.getByRole('heading', { name: 'Bienvenue dans Basic PDF' })).toBeVisible();
    await expect(page.getByText('100 % hors ligne et privé')).toBeVisible();

    // 2. Ouvre le document d'exemple (4 pages)
    await page.getByRole('button', { name: /Essayer un document d’exemple/i }).click();

    const viewer = page.getByTestId('pdf-viewer');
    await expect(viewer).toBeVisible();

    // Vérifie qu'au moins une page PDF a réellement dessiné des pixels non blancs sur son canvas
    const firstFrame = viewer.locator('.pdf-page-frame').first();
    await expect(firstFrame).toBeVisible();

    await expect
      .poll(async () => {
        return await firstFrame.evaluate((el) => {
          const canvas = el.querySelector('canvas');
          if (!canvas || canvas.width === 0 || canvas.height === 0) {
            return 0;
          }
          const ctx = canvas.getContext('2d');
          if (!ctx) {
            return 0;
          }
          const pixels = ctx.getImageData(0, 0, canvas.width, Math.min(canvas.height, 250)).data;
          let coloredPixels = 0;
          for (let i = 0; i < pixels.length; i += 4) {
            if (pixels[i] < 245 || pixels[i + 1] < 245 || pixels[i + 2] < 245) {
              coloredPixels += 1;
            }
          }
          return coloredPixels;
        });
      })
      .toBeGreaterThan(100);

    // 3. Test du zoom par bouton + Ctrl+Molette
    const zoomReadout = page.locator('.zoom-readout');
    const initialZoomText = await zoomReadout.innerText();
    await page.getByRole('button', { name: 'Augmenter le zoom' }).click();
    const afterBtnZoom = await zoomReadout.innerText();
    expect(afterBtnZoom).not.toBe(initialZoomText);

    await viewer.evaluate((el) => {
      el.dispatchEvent(
        new WheelEvent('wheel', { deltaY: -120, ctrlKey: true, bubbles: true, cancelable: true }),
      );
    });
    const afterWheelZoom = await zoomReadout.innerText();
    expect(afterWheelZoom).not.toBe(afterBtnZoom);

    // 4. Test navigation par saisie de numéro de page puis par miniature
    const pageInput = page.getByLabel('Numéro de page');
    await expect(pageInput).toHaveValue('1');
    await pageInput.fill('3');
    await pageInput.press('Enter');
    await expect(pageInput).toHaveValue('3');

    // Ouvre les miniatures (déjà ouvert sur bureau, bouton sur mobile) et clique sur page 4
    const thumbnailsBtn = page.getByRole('button', { name: 'Miniatures', exact: true });
    const isPressed = await thumbnailsBtn.getAttribute('aria-pressed');
    if (isPressed !== 'true') {
      await thumbnailsBtn.click();
    }
    await page.getByRole('button', { name: 'Aller à la page 4' }).click();
    await expect(pageInput).toHaveValue('4');

    // 5. Test du thème clair / sombre appliqué au DOM
    await page.getByRole('button', { name: /Passer au thème sombre/i }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

    // Aucune fuite réseau ni erreur JavaScript
    expect(externalRequests).toEqual([]);
    expect(pageErrors).toEqual([]);
  });

  test('onglets indépendants, glisser-déposer, nom très long sans débordement et fichier récent', async ({
    page,
  }) => {
    await page.goto('/');

    // Ouvre un premier PDF par glisser-déposer sur la zone d'accueil
    const firstBytes = Array.from(buildSamplePdfBytes('Premier document', 3));
    await page.locator('.drop-zone').evaluate((zone, rawBytes) => {
      const dt = new DataTransfer();
      const file = new File([new Uint8Array(rawBytes)], 'Premier-Document.pdf', {
        type: 'application/pdf',
      });
      dt.items.add(file);
      zone.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
    }, firstBytes);

    await expect(page.getByTestId('pdf-viewer')).toBeVisible();
    // Vérifie que le glisser-déposer n'ouvre qu'un seul onglet (pas de double ouverture)
    await expect(page.getByRole('tab')).toHaveCount(1);

    // Zoome fortement sur l'onglet 1
    await page.getByRole('button', { name: 'Augmenter le zoom' }).click();
    await page.getByRole('button', { name: 'Augmenter le zoom' }).click();
    const tab1Zoom = await page.locator('.zoom-readout').innerText();

    // Ouvre un deuxième PDF avec un nom extrêmement long sans aucun espace
    const longFileName =
      'compte_rendu_reunion_annuelle_tres_long_sans_aucun_espace_qui_ne_doit_jamais_faire_deborder_ecran_mobile_ou_bureau_version_definitive_2026_11_14_edition_finale.pdf';
    const secondBytes = Buffer.from(buildSamplePdfBytes('Deuxieme document', 2));

    const fileInput = page.locator('input[type="file"]');
    await fileInput.setInputFiles({
      name: longFileName,
      mimeType: 'application/pdf',
      buffer: secondBytes,
    });

    // Vérifie qu'il y a maintenant 2 onglets et que le 2e a son propre zoom
    const tabs = page.getByRole('tab');
    await expect(tabs).toHaveCount(2);
    await expect(page.getByRole('tab', { selected: true })).toContainText('compte_rendu');
    await expect(page.locator('.zoom-readout')).not.toHaveText(tab1Zoom);

    // Revient sur l'onglet 1 via Alt+Flèche gauche (et vérifie que son zoom est conservé)
    await page.keyboard.press('Alt+ArrowLeft');
    await expect(page.locator('.zoom-readout')).toHaveText(tab1Zoom);

    // Passe à l'Accueil et vérifie que le nom très long dans "Fichiers récents" ne déborde pas
    await page.getByRole('button', { name: 'Accueil' }).click();
    await expect(page.locator('.recent-card')).toHaveCount(2);

    const overflowCheck = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      innerWidth: window.innerWidth,
    }));
    expect(overflowCheck.scrollWidth).toBeLessThanOrEqual(overflowCheck.innerWidth);

    // Vérifie aussi les raccourcis clavier Ctrl+Tab et Ctrl+W
    await page.locator('.tab-item').first().click();
    const activeBefore = await page.locator('.tab-item.is-active .tab-title').innerText();
    await page.evaluate(() => {
      window.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Tab', ctrlKey: true, bubbles: true }),
      );
    });
    const activeAfter = await page.locator('.tab-item.is-active .tab-title').innerText();
    expect(activeAfter).not.toBe(activeBefore);

    await page.evaluate(() => {
      window.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'w', ctrlKey: true, bubbles: true }),
      );
    });
    await expect(page.getByRole('tab')).toHaveCount(1);
  });

  test('affiche un message en français compréhensible pour un fichier non PDF', async ({
    page,
  }) => {
    await page.goto('/');

    const fileInput = page.locator('input[type="file"]');
    await fileInput.setInputFiles({
      name: 'faux-document.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from('Ceci nest pas un fichier PDF', 'utf8'),
    });

    const alert = page.getByRole('alert');
    await expect(alert).toBeVisible();
    await expect(alert).toContainText('PDF valide');
  });

  test('fonctionnement PWA vérifié même lorsque le réseau est coupé', async ({
    page,
    context,
  }) => {
    await page.goto('/');
    // Attend que le Service Worker prenne le contrôle pour la mise en cache hors ligne
    await page.evaluate(async () => {
      if ('serviceWorker' in navigator) {
        await navigator.serviceWorker.ready;
      }
    });

    await context.setOffline(true);
    await page.reload();

    await expect(page.getByRole('heading', { name: 'Bienvenue dans Basic PDF' })).toBeVisible();
    await page.getByRole('button', { name: /Essayer un document d’exemple/i }).click();
    await expect(page.getByTestId('pdf-viewer')).toBeVisible();
    await context.setOffline(false);
  });
});
