import { defineConfig } from '@playwright/test';

// Configuration des tests E2E de la vraie fenêtre Windows Electron (_electron.launch)
export default defineConfig({
  testDir: './tests/electron',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 45_000,
});
