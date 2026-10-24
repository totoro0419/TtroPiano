import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests', testMatch: 'browser.spec.ts', timeout: 120000, workers: 1,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: { baseURL: 'http://127.0.0.1:4173', viewport: { width: 1024, height: 768 }, hasTouch: true, acceptDownloads: true, trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  webServer: { command: 'npm run preview -- --port 4173', url: 'http://127.0.0.1:4173', reuseExistingServer: !process.env.CI },
});
