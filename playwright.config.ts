import { defineConfig, devices } from '@playwright/test';

const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const browserChannel = process.env.CI ? undefined : 'chrome';

// Configuration des tests dans un vrai navigateur (Playwright + Chrome installé)
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  retries: 0,
  timeout: 30_000,
  use: {
    baseURL: 'http://127.0.0.1:4173',
    channel: browserChannel,
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'ordinateur-chrome',
      testIgnore: /.*\.mobile\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], channel: browserChannel },
    },
    {
      name: 'telephone-mobile',
      use: {
        ...devices['Pixel 7'],
        channel: browserChannel,
        hasTouch: true,
        isMobile: true,
      },
    },
  ],
  webServer: {
    command: `${npmCmd} run preview -- --host 127.0.0.1 --port 4173`,
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});
