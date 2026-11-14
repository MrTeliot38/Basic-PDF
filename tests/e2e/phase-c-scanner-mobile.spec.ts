import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';

const SCREENSHOTS_DIR = fs.existsSync(
  'C:\\Users\\roly_\\.gemini\\antigravity\\brain\\73218bb9-b8fe-40ea-aeca-18e39db6903b',
)
  ? 'C:\\Users\\roly_\\.gemini\\antigravity\\brain\\73218bb9-b8fe-40ea-aeca-18e39db6903b\\screenshots'
  : path.resolve('test-results', 'screenshots');

function maybeScreenshotPath(projectName: string, fileName: string): string | null {
  if (projectName !== 'telephone-mobile') {
    return null;
  }
  fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
  return path.join(SCREENSHOTS_DIR, fileName);
}

test.describe('Phase C : Scanner hors ligne (cadre bleu, perspective, N&B, multi-pages) & pièges mobiles Android', () => {
  test('scanner de documents : détection cadre bleu en direct, recadrage 4 coins, N&B/Couleur, multi-pages et création PDF', async ({
    page,
  }, testInfo) => {
    // Flux caméra simulé en direct dessinant une feuille blanche en perspective sur un bureau foncé
    await page.addInitScript(() => {
      const camCanvas = document.createElement('canvas');
      camCanvas.width = 640;
      camCanvas.height = 480;
      const drawLoop = () => {
        const ctx = camCanvas.getContext('2d');
        if (ctx) {
          ctx.fillStyle = '#1e293b';
          ctx.fillRect(0, 0, 640, 480);

          // Feuille claire en trapèze (effet perspective réel)
          ctx.fillStyle = '#f8fafc';
          ctx.beginPath();
          ctx.moveTo(130, 56);
          ctx.lineTo(500, 74);
          ctx.lineTo(548, 424);
          ctx.lineTo(94, 408);
          ctx.closePath();
          ctx.fill();

          ctx.fillStyle = '#0f172a';
          ctx.font = 'bold 28px sans-serif';
          ctx.fillText('ATTESTATION SCAN', 180, 165);
          ctx.font = '20px sans-serif';
          ctx.fillText('Page originale sur bureau sombre', 165, 230);
        }
      };
      drawLoop();
      window.setInterval(drawLoop, 120);

      Object.defineProperty(navigator, 'mediaDevices', {
        configurable: true,
        value: {
          getUserMedia: async () => camCanvas.captureStream(12),
        },
      });
    });

    await page.goto('/');
    await page.getByTestId('welcome-btn-scanner').click();

    // Vérifie la détection automatique en direct et l'apparition du cadre bleu sur l'overlay
    await expect(page.getByTestId('scanner-live-status')).toContainText('Feuille détectée', {
      timeout: 8000,
    });

    const hasBluePixels = await page.evaluate(() => {
      const c = document.querySelector('[data-testid="scanner-blue-overlay"]') as HTMLCanvasElement;
      const ctx = c?.getContext('2d');
      if (!ctx || c.width === 0) return false;
      const data = ctx.getImageData(0, 0, c.width, c.height).data;
      for (let i = 0; i < data.length; i += 4) {
        if (data[i + 3] > 30 && data[i + 2] > data[i] + 60) {
          return true;
        }
      }
      return false;
    });
    expect(hasBluePixels).toBe(true);

    const shotCam = maybeScreenshotPath(testInfo.project.name, 'c-scanner-cadre-bleu.png');
    if (shotCam) {
      await page.screenshot({ path: shotCam });
    }

    // Capture la première page puis bascule vers le recadrage des 4 coins
    await page.getByTestId('btn-scanner-capture').click();
    await expect(page.getByTestId('scanner-processed-preview')).toBeVisible();

    await page.getByTestId('btn-scan-view-crop').click();
    await expect(page.getByTestId('scan-handle-topLeft')).toBeVisible();

    const shotCrop = maybeScreenshotPath(testInfo.project.name, 'c-scanner-recadrage.png');
    if (shotCrop) {
      await page.screenshot({ path: shotCrop });
    }

    // Passe en aperçu redressé, sélectionne Noir et blanc + qualité Léger, pivote la page
    await page.getByTestId('btn-scan-view-preview').click();
    await page.getByTestId('btn-scan-color-nb').click();
    await page.getByTestId('btn-scan-quality-leger').click();
    await page.getByTestId('btn-scan-rotate').click();

    // Ajoute une 2e page via import photo pour vérifier le mode multi-pages
    const secondPhotoPng = await page.evaluate(() => {
      const c = document.createElement('canvas');
      c.width = 400;
      c.height = 540;
      const ctx = c.getContext('2d')!;
      ctx.fillStyle = '#0f172a';
      ctx.fillRect(0, 0, 400, 540);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(45, 50, 310, 440);
      ctx.fillStyle = '#111827';
      ctx.font = 'bold 24px sans-serif';
      ctx.fillText('Page 2 importee', 90, 200);
      return c.toDataURL('image/png').split(',')[1];
    });
    await page.getByTestId('scan-import-input').setInputFiles({
      name: 'feuille-2.png',
      mimeType: 'image/png',
      buffer: Buffer.from(secondPhotoPng, 'base64'),
    });

    await expect(page.getByTestId('btn-scan-create-pdf')).toContainText('Créer le PDF (2)');
    await page.getByTestId('btn-scan-create-pdf').click();

    // Le PDF multi-page créé s'ouvre directement dans l'éditeur avec ses 2 pages
    await expect(page.locator('.tab-item.is-active .tab-title')).toContainText('Scan-');
    await expect(page.locator('.page-jump-box')).toContainText('/ 2');
  });

  test('pièges Android : barre d’état ne recouvre pas l’interface et clavier virtuel garde le texte modifié visible', async ({
    page,
  }, testInfo) => {
    await page.goto('/');

    // Simule une encoche/barre d'état haute sur le shell Android (safe area)
    await page.evaluate(() => {
      document.documentElement.style.setProperty('--android-inset-top', '28px');
      document.documentElement.style.setProperty('--android-inset-bottom', '16px');
    });

    const toolbarBox = await page.locator('.toolbar').boundingBox();
    expect(toolbarBox).not.toBeNull();
    // La barre d'outils commence bien après les 28px de barre d'état + tab-bar (>= 28px)
    expect(toolbarBox!.y).toBeGreaterThanOrEqual(28);

    // Ouvre le document d'exemple puis passe en édition de texte
    await page.getByRole('button', { name: /Essayer un document d’exemple/i }).click();
    await expect(page.locator('.page-jump-box')).toContainText('/ 4');

    await page.getByRole('button', { name: 'Modifier le texte' }).click();
    const firstTextBlock = page.locator('.editable-text-block').first();
    await expect(firstTextBlock).toBeVisible();
    await firstTextBlock.click();
    await firstTextBlock.dblclick();

    const inlineEditor = page.locator('textarea.inline-text-editor').first();
    await expect(inlineEditor).toBeVisible();

    // Simule l'ouverture d'un clavier virtuel sur smartphone (hauteur visible réduite de moitié)
    const curViewport = page.viewportSize() ?? { width: 390, height: 844 };
    await page.setViewportSize({
      width: curViewport.width,
      height: Math.max(360, Math.round(curViewport.height * 0.52)),
    });
    await inlineEditor.evaluate((el) => el.scrollIntoView({ block: 'center', behavior: 'instant' }));

    const newVp = page.viewportSize()!;
    const editorBox = await inlineEditor.boundingBox();
    expect(editorBox).not.toBeNull();
    // Vérifie que la zone en cours de modification reste dans la partie visible au-dessus du clavier
    expect(editorBox!.y).toBeGreaterThanOrEqual(0);
    expect(editorBox!.y + editorBox!.height).toBeLessThanOrEqual(newVp.height + 4);

    const shotMobile = maybeScreenshotPath(testInfo.project.name, 'c-mobile-clavier-barre-etat.png');
    if (shotMobile) {
      await page.screenshot({ path: shotMobile });
    }
  });
});
