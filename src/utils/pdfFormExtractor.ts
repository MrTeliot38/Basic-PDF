// Extraction des champs de formulaire PDF natifs (AcroForm) pour saisie interactive
import type { PDFPageProxy } from 'pdfjs-dist';
import type { PdfFormField } from '../types/pdf';
import { createId } from './formatters';

interface RawPdfAnnotation {
  id?: string;
  subtype?: string;
  fieldName?: string;
  fieldType?: string;
  fieldValue?: unknown;
  defaultFieldValue?: unknown;
  rect?: number[];
  checkBox?: boolean;
  radioButton?: boolean;
  buttonValue?: string;
  exportValue?: string;
  multiLine?: boolean;
  readOnly?: boolean;
  options?: Array<{ displayValue?: string; exportValue?: string }>;
}

/**
 * Lit les champs de formulaire interactifs d'une page PDF (texte, cases à cocher, radios, listes).
 */
export async function extractPageFormFields(
  page: PDFPageProxy,
  pageNumber: number,
): Promise<{ fields: PdfFormField[]; values: Record<string, string | boolean> }> {
  const viewport = page.getViewport({ scale: 1 });
  const rawAnnots = (await page.getAnnotations({ intent: 'display' })) as RawPdfAnnotation[];

  const fields: PdfFormField[] = [];
  const values: Record<string, string | boolean> = {};

  for (const annot of rawAnnots) {
    if (annot.subtype !== 'Widget' || !annot.fieldName || annot.readOnly || !annot.rect || annot.rect.length < 4) {
      continue;
    }

    const viewRect = viewport.convertToViewportRectangle(annot.rect);
    const x = Math.min(viewRect[0], viewRect[2]);
    const y = Math.min(viewRect[1], viewRect[3]);
    const width = Math.max(12, Math.abs(viewRect[2] - viewRect[0]));
    const height = Math.max(12, Math.abs(viewRect[3] - viewRect[1]));

    const ft = annot.fieldType;
    if (ft === 'Btn') {
      if (annot.radioButton) {
        const radioVal = annot.buttonValue ?? annot.exportValue ?? annot.fieldValue ?? 'Oui';
        const isChecked = String(annot.fieldValue ?? '') === String(radioVal);
        fields.push({
          id: createId('fld'),
          fieldName: annot.fieldName,
          pageNumber,
          fieldType: 'radio',
          x,
          y,
          width,
          height,
          defaultValue: isChecked ? String(radioVal) : '',
          radioValue: String(radioVal),
        });
        if (values[annot.fieldName] === undefined) {
          values[annot.fieldName] = annot.fieldValue ? String(annot.fieldValue) : '';
        }
      } else {
        const valStr = String(annot.fieldValue ?? '').toLowerCase();
        const checked =
          annot.fieldValue === true ||
          (valStr !== '' && valStr !== 'off' && valStr !== 'no' && valStr !== 'false');
        fields.push({
          id: createId('fld'),
          fieldName: annot.fieldName,
          pageNumber,
          fieldType: 'checkbox',
          x,
          y,
          width,
          height,
          defaultValue: checked,
        });
        values[annot.fieldName] = checked;
      }
      continue;
    }

    if (ft === 'Ch') {
      const options = (annot.options ?? [])
        .map((opt) => opt.exportValue ?? opt.displayValue ?? '')
        .filter((s) => s.length > 0);
      const val = Array.isArray(annot.fieldValue)
        ? String(annot.fieldValue[0] ?? '')
        : String(annot.fieldValue ?? '');
      fields.push({
        id: createId('fld'),
        fieldName: annot.fieldName,
        pageNumber,
        fieldType: 'select',
        x,
        y,
        width,
        height,
        defaultValue: val,
        options,
      });
      values[annot.fieldName] = val;
      continue;
    }

    if (ft === 'Tx') {
      const val = String(annot.fieldValue ?? annot.defaultFieldValue ?? '');
      fields.push({
        id: createId('fld'),
        fieldName: annot.fieldName,
        pageNumber,
        fieldType: 'text',
        x,
        y,
        width,
        height,
        defaultValue: val,
        multiline: Boolean(annot.multiLine),
      });
      values[annot.fieldName] = val;
    }
  }

  return { fields, values };
}
