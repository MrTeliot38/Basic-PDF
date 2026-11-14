import { describe, expect, it } from 'vitest';
import { clampZoom, formatFileSize, formatRelativeDate } from '../../src/utils/formatters';
import { formatPdfError, hasPdfHeader } from '../../src/utils/pdfValidation';
import { buildSamplePdfBytes } from '../../src/utils/samplePdf';

describe('Utilitaires de formatage et PDF de base', () => {
  it('borne correctement le facteur de zoom entre 25 % et 400 %', () => {
    expect(clampZoom(0.05)).toBe(0.25);
    expect(clampZoom(8)).toBe(4);
    expect(clampZoom(1.234)).toBe(1.23);
    expect(clampZoom(Number.NaN)).toBe(1);
  });

  it('formate les tailles de fichiers en français', () => {
    expect(formatFileSize(512)).toBe('512 o');
    expect(formatFileSize(2048)).toBe('2,0 Ko');
    expect(formatFileSize(3 * 1024 * 1024)).toBe('3,0 Mo');
  });

  it('formate les dates récentes en français', () => {
    expect(formatRelativeDate(Date.now() - 10_000)).toBe("À l'instant");
    expect(formatRelativeDate(Date.now() - 5 * 60_000)).toBe('Il y a 5 min');
  });

  it('génère un PDF d’exemple valide détecté par hasPdfHeader', () => {
    const bytes = buildSamplePdfBytes('Test Basic PDF', 3);
    expect(hasPdfHeader(bytes)).toBe(true);
    const ascii = new TextDecoder('latin1').decode(bytes);
    expect(ascii).toContain('/Count 3');
    expect(ascii.trimEnd().endsWith('%%EOF')).toBe(true);
  });

  it('rejette un fichier qui ne commence pas par %PDF-', () => {
    const invalid = new TextEncoder().encode('Bonjour ceci est un texte simple');
    expect(hasPdfHeader(invalid)).toBe(false);
  });

  it('traduit les erreurs techniques en messages français clairs', () => {
    expect(formatPdfError(new Error('PasswordException: need password'))).toContain(
      'mot de passe',
    );
    expect(formatPdfError(new Error('InvalidPDFException'))).toContain('PDF valide');
  });
});
