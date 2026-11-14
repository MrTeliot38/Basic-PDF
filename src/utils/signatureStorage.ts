// Stockage 100 % local des signatures mémorisées et nettoyage de fond pour les signatures importées
import type { SavedSignature } from '../types/pdf';
import { createId } from './formatters';

const STORAGE_KEY = 'basic-pdf-saved-signatures-v1';

export function loadSavedSignatures(): SavedSignature[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter(
      (item): item is SavedSignature =>
        Boolean(item) &&
        typeof item === 'object' &&
        typeof (item as SavedSignature).id === 'string' &&
        typeof (item as SavedSignature).dataUrl === 'string',
    );
  } catch {
    return [];
  }
}

export function saveNewSignature(label: string, dataUrl: string): SavedSignature[] {
  const existing = loadSavedSignatures();
  const next: SavedSignature = {
    id: createId('sig'),
    label: label.trim() || `Signature ${existing.length + 1}`,
    dataUrl,
    createdAt: Date.now(),
  };
  const updated = [next, ...existing].slice(0, 12);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  } catch {
    // Espace plein : on garde au moins la signature la plus récente en mémoire
  }
  return updated;
}

export function deleteSavedSignature(id: string): SavedSignature[] {
  const updated = loadSavedSignatures().filter((s) => s.id !== id);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  } catch {
    // Ignore les erreurs de stockage
  }
  return updated;
}

/**
 * Rend transparent le papier clair autour d'une photo/scan de signature importée.
 */
export function makeSignatureBackgroundTransparent(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Impossible de lire l'image de signature."));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("Le fichier choisi n'est pas une image valide."));
      img.onload = () => {
        const maxW = 520;
        const scale = img.naturalWidth > maxW ? maxW / img.naturalWidth : 1;
        const w = Math.max(40, Math.round(img.naturalWidth * scale));
        const h = Math.max(20, Math.round(img.naturalHeight * scale));
        const c = document.createElement('canvas');
        c.width = w;
        c.height = h;
        const ctx = c.getContext('2d');
        if (!ctx) {
          reject(new Error('Impossible de traiter cette signature.'));
          return;
        }
        ctx.drawImage(img, 0, 0, w, h);
        const imgData = ctx.getImageData(0, 0, w, h);
        const d = imgData.data;
        for (let i = 0; i < d.length; i += 4) {
          const lum = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
          if (lum > 215) {
            d[i + 3] = 0;
          } else if (lum > 180) {
            d[i + 3] = Math.round(((215 - lum) / 35) * d[i + 3]);
          }
        }
        ctx.putImageData(imgData, 0, 0);
        resolve(c.toDataURL('image/png'));
      };
      img.src = String(reader.result ?? '');
    };
    reader.readAsDataURL(file);
  });
}
