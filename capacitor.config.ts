// Configuration Capacitor pour la version Android de Basic PDF (100 % hors ligne)
import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'fr.basicpdf.app',
  appName: 'Basic PDF',
  webDir: 'dist',
  android: {
    allowMixedContent: false,
    captureInput: true,
    webContentsDebuggingEnabled: false,
  },
  server: {
    // Origine sécurisée locale uniquement, indispensable pour le worker PDF.js et l'OCR hors ligne
    androidScheme: 'https',
    hostname: 'basicpdf.local',
  },
};

export default config;
