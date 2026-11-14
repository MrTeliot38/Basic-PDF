// Chargeur PDF local utilisant PDF.js (aucun envoi réseau, messages d'erreur en français simple)
import * as pdfjsLib from 'pdfjs-dist';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { formatPdfError, hasPdfHeader } from './pdfValidation';

// Configuration du worker PDF.js empaqueté localement dans l'application
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

export { formatPdfError, hasPdfHeader };

/** Charge un PDF en mémoire en préservant intacte la copie d'origine passée en paramètre */
export async function loadPdfDocument(bytes: Uint8Array): Promise<PDFDocumentProxy> {
  if (!hasPdfHeader(bytes)) {
    throw new Error('InvalidPDFException: En-tête %PDF- manquant');
  }

  // On passe une copie (.slice()) car PDF.js transfère le tampon au worker
  const loadingTask = pdfjsLib.getDocument({
    data: bytes.slice(),
    useSystemFonts: true,
  });

  return await loadingTask.promise;
}

/** Lit un objet File déposé ou choisi par l'utilisateur sous forme d'octets */
export async function readPdfFile(file: File): Promise<Uint8Array> {
  if (file.size === 0) {
    throw new Error('InvalidPDFException: Le fichier est vide (0 octet).');
  }

  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);

  if (!hasPdfHeader(bytes)) {
    throw new Error('InvalidPDFException: Le fichier choisi n’est pas un PDF valide.');
  }

  return bytes;
}
