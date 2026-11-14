// Génère l'empreinte SHA-256 de chaque livrable (.exe et .apk) dans release/ pour vérification d'intégrité
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const releaseDir = path.join(process.cwd(), 'release');
if (!fs.existsSync(releaseDir)) {
  console.log('Dossier release/ introuvable, aucune empreinte générée.');
  process.exit(0);
}

const files = fs
  .readdirSync(releaseDir)
  .filter((name) => {
    const lower = name.toLowerCase();
    return lower.endsWith('.exe') || lower.endsWith('.apk');
  })
  .sort();

const allLines = [];
const winLines = [];
const androidLines = [];

for (const file of files) {
  const fullPath = path.join(releaseDir, file);
  const bytes = fs.readFileSync(fullPath);
  const hash = crypto.createHash('sha256').update(bytes).digest('hex');
  const line = `${hash}  ${file}`;
  allLines.push(line);
  if (file.toLowerCase().endsWith('.exe')) {
    winLines.push(line);
  } else {
    androidLines.push(line);
  }
  fs.writeFileSync(`${fullPath}.sha256`, `${line}\n`, 'utf8');
  console.log(`SHA-256 : ${line}`);
}

if (allLines.length > 0) {
  fs.writeFileSync(path.join(releaseDir, 'SHA256SUMS.txt'), `${allLines.join('\n')}\n`, 'utf8');
}
if (winLines.length > 0) {
  fs.writeFileSync(
    path.join(releaseDir, 'SHA256SUMS-windows.txt'),
    `${winLines.join('\n')}\n`,
    'utf8',
  );
}
if (androidLines.length > 0) {
  fs.writeFileSync(
    path.join(releaseDir, 'SHA256SUMS-android.txt'),
    `${androidLines.join('\n')}\n`,
    'utf8',
  );
}
