import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'tests',
  timeout: 60_000,
  workers: 2,
  reporter: 'list',
  use: {
    browserName: 'chromium',
    viewport: { width: 1280, height: 720 },
    // software WebGL, so the tests run on machines without a graphics card (like CI)
    launchOptions: { args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--ignore-gpu-blocklist'] },
  },
});
