// Générateur local d'un PDF d'exemple valide (sans bibliothèque externe ni accès réseau)

function toLatin1Bytes(text: string): Uint8Array {
  const bytes = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i += 1) {
    bytes[i] = text.charCodeAt(i) & 0xff;
  }
  return bytes;
}

function escapePdfString(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

/** Construit un PDF valide multi-pages en mémoire avec des caractères simples */
export function buildSamplePdfBytes(
  title = 'Bienvenue dans Basic PDF',
  pageCount = 3,
): Uint8Array {
  const objects: string[] = [];

  // 1: Catalog, 2: Pages, 3: Font Helvetica
  const pageObjStart = 4;
  const kidsRefs: string[] = [];

  for (let i = 0; i < pageCount; i += 1) {
    const pageObjId = pageObjStart + i * 2;
    kidsRefs.push(`${pageObjId} 0 R`);
  }

  objects.push(`1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n`);
  objects.push(
    `2 0 obj\n<< /Type /Pages /Kids [${kidsRefs.join(' ')}] /Count ${pageCount} >>\nendobj\n`,
  );
  objects.push(
    `3 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>\nendobj\n`,
  );

  for (let i = 0; i < pageCount; i += 1) {
    const pageObjId = pageObjStart + i * 2;
    const contentObjId = pageObjId + 1;
    const pageNum = i + 1;

    const stream = [
      'BT',
      '/F1 22 Tf',
      '56 760 Td',
      `(${escapePdfString(title)}) Tj`,
      '0 -36 Td',
      '/F1 13 Tf',
      `(Page ${pageNum} sur ${pageCount} - Document de demonstration hors ligne) Tj`,
      '0 -28 Td',
      '(Vous pouvez zoomer, faire defiler ou ouvrir plusieurs onglets.) Tj',
      'ET',
      '0.15 0.39 0.92 RG',
      '2 w',
      '56 660 483 2 re S',
    ].join('\n');

    objects.push(
      `${pageObjId} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentObjId} 0 R >>\nendobj\n`,
    );
    objects.push(
      `${contentObjId} 0 obj\n<< /Length ${stream.length} >>\nstream\n${stream}\nendstream\nendobj\n`,
    );
  }

  let pdf = '%PDF-1.4\n%\xE2\xE3\xCF\xD3\n';
  const offsets: number[] = [0];

  for (const obj of objects) {
    offsets.push(pdf.length);
    pdf += obj;
  }

  const xrefOffset = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += '0000000000 65535 f \n';
  for (let i = 1; i <= objects.length; i += 1) {
    pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;

  return toLatin1Bytes(pdf);
}
