import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// Configuration Vite pour Basic PDF (application web installable 100 % hors ligne)
export default defineConfig({
  base: './',
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png'],
      manifest: {
        name: 'Basic PDF',
        short_name: 'Basic PDF',
        description:
          'Lecteur et éditeur de PDF gratuit, sans publicité, en français et 100 % hors ligne.',
        theme_color: '#2563eb',
        background_color: '#f8fafc',
        display: 'standalone',
        lang: 'fr',
        start_url: './',
        scope: './',
        icons: [
          {
            src: 'icons/icon-192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any maskable',
          },
          {
            src: 'icons/icon-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any maskable',
          },
          {
            src: 'icons/icon.svg',
            sizes: 'any',
            type: 'image/svg+xml',
          },
        ],
      },
      workbox: {
        // Mise en cache complète de tous les fichiers locaux (y compris PDF.js et l'OCR hors ligne)
        globPatterns: ['**/*.{js,css,html,svg,png,woff2,mjs,wasm,gz}'],
        maximumFileSizeToCacheInBytes: 15 * 1024 * 1024,
      },
    }),
  ],
  build: {
    target: 'es2022',
  },
});
