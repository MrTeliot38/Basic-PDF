// Couche interactive des champs de formulaire PDF natifs (AcroForm)
import type { PdfFormField } from '../types/pdf';

interface FormFieldsLayerProps {
  zoom: number;
  fields: PdfFormField[];
  values: Record<string, string | boolean>;
  disabled: boolean;
  onChangeValue: (fieldName: string, value: string | boolean) => void;
}

export function FormFieldsLayer({
  zoom,
  fields,
  values,
  disabled,
  onChangeValue,
}: FormFieldsLayerProps) {
  if (fields.length === 0) {
    return null;
  }

  return (
    <div
      className="form-fields-layer"
      style={{ pointerEvents: disabled ? 'none' : 'auto' }}
    >
      {fields.map((field) => {
        const val = values[field.fieldName] ?? field.defaultValue;
        const style: React.CSSProperties = {
          left: field.x * zoom,
          top: field.y * zoom,
          width: Math.max(14, field.width * zoom),
          height: Math.max(14, field.height * zoom),
          fontSize: Math.max(9, Math.min(18, field.height * zoom * 0.62)),
        };

        if (field.fieldType === 'checkbox') {
          return (
            <input
              key={field.id}
              type="checkbox"
              className="pdf-form-widget pdf-form-checkbox"
              aria-label={`Case ${field.fieldName}`}
              data-form-field={field.fieldName}
              style={style}
              checked={Boolean(val)}
              onChange={(e) => onChangeValue(field.fieldName, e.target.checked)}
            />
          );
        }

        if (field.fieldType === 'radio') {
          return (
            <input
              key={field.id}
              type="radio"
              name={`pdf-radio-${field.fieldName}`}
              className="pdf-form-widget pdf-form-checkbox"
              aria-label={`Option ${field.fieldName} ${field.radioValue ?? ''}`}
              data-form-field={field.fieldName}
              style={style}
              checked={String(val) === String(field.radioValue ?? '')}
              onChange={() => onChangeValue(field.fieldName, field.radioValue ?? 'Oui')}
            />
          );
        }

        if (field.fieldType === 'select') {
          return (
            <select
              key={field.id}
              className="pdf-form-widget pdf-form-select"
              aria-label={`Liste ${field.fieldName}`}
              data-form-field={field.fieldName}
              style={style}
              value={String(val)}
              onChange={(e) => onChangeValue(field.fieldName, e.target.value)}
            >
              <option value="">Choisir…</option>
              {(field.options ?? []).map((opt) => (
                <option key={opt} value={opt}>
                  {opt}
                </option>
              ))}
            </select>
          );
        }

        if (field.multiline) {
          return (
            <textarea
              key={field.id}
              className="pdf-form-widget pdf-form-input"
              aria-label={`Champ ${field.fieldName}`}
              data-form-field={field.fieldName}
              style={style}
              value={String(val)}
              onChange={(e) => onChangeValue(field.fieldName, e.target.value)}
            />
          );
        }

        return (
          <input
            key={field.id}
            type="text"
            className="pdf-form-widget pdf-form-input"
            aria-label={`Champ ${field.fieldName}`}
            data-form-field={field.fieldName}
            style={style}
            value={String(val)}
            onChange={(e) => onChangeValue(field.fieldName, e.target.value)}
          />
        );
      })}
    </div>
  );
}
