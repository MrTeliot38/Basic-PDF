// Script de compilation du processus principal et du preload Electron vers dist-electron/
import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';

const rootDir = process.cwd();
const outDir = path.join(rootDir, 'dist-electron');
const buildResDir = path.join(rootDir, 'build');

fs.mkdirSync(outDir, { recursive: true });
fs.mkdirSync(buildResDir, { recursive: true });

// Copie l'icône 512x512 vers build/icon.png pour l'installateur et l'exécutable Windows
const srcIcon = path.join(rootDir, 'public', 'icons', 'icon-512.png');
const dstIcon = path.join(buildResDir, 'icon.png');
if (fs.existsSync(srcIcon)) {
  fs.copyFileSync(srcIcon, dstIcon);
}

await Promise.all([
  build({
    entryPoints: [path.join(rootDir, 'electron', 'main.ts')],
    outfile: path.join(outDir, 'main.cjs'),
    bundle: true,
    platform: 'node',
    target: 'node22',
    format: 'cjs',
    external: ['electron'],
    sourcemap: false,
  }),
  build({
    entryPoints: [path.join(rootDir, 'electron', 'preload.ts')],
    outfile: path.join(outDir, 'preload.cjs'),
    bundle: true,
    platform: 'node',
    target: 'node22',
    format: 'cjs',
    external: ['electron'],
    sourcemap: false,
  }),
]);

console.log('Compilation Electron terminée dans dist-electron/');
