// Point d'entrée de Basic PDF et enregistrement du Service Worker hors-ligne en mode web (PWA)
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import App from './App';
import { isAndroidNativeApp } from './utils/androidBridge';
import './styles/tokens.css';
import './styles/global.css';

// Active le cache hors-ligne de la PWA uniquement dans un navigateur web (jamais sous Electron ou Android Capacitor)
const isWebOrigin =
  typeof window !== 'undefined' &&
  !window.basicPdfDesktop &&
  !isAndroidNativeApp() &&
  (window.location.protocol === 'https:' || window.location.protocol === 'http:');

if (isWebOrigin) {
  registerSW({ immediate: true });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
