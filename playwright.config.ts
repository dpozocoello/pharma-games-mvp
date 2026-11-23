import { defineConfig, devices } from '@playwright/test';

/**
 * E2E móvil (CLAUDE.md §5): Pixel 5 (Chromium) e iPhone 12 (WebKit) sobre el **build** de la PWA y
 * del panel. Requiere `pnpm build`, PostgreSQL migrado con semillas y Redis. Si ya hay servidores
 * corriendo en esos puertos (p. ej. `pnpm dev`), los reutiliza.
 */
const devEnv = {
  // Bandeja OTP de desarrollo: solo fuera de producción y con el proveedor de consola.
  NODE_ENV: 'development',
  MESSAGING_PROVIDER: 'console',
  LOG_LEVEL: 'warn',
  COOKIE_SECURE: 'false',
};

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: 'list',
  use: {
    baseURL: process.env.PWA_BASE_URL ?? 'http://localhost:5173',
    trace: 'on-first-retry',
  },
  webServer: [
    {
      command: 'node apps/api/dist/main.js',
      url: 'http://localhost:3000/health',
      env: { ...devEnv, API_PORT: '3000' },
      reuseExistingServer: true,
      timeout: 60_000,
    },
    {
      command: 'pnpm --filter @pharma/pwa exec vite preview --port 5173 --strictPort',
      url: 'http://localhost:5173',
      reuseExistingServer: true,
    },
    {
      command: 'pnpm --filter @pharma/admin exec vite preview --port 5174 --strictPort',
      url: 'http://localhost:5174',
      reuseExistingServer: true,
    },
  ],
  projects: [
    {
      name: 'Pixel 5',
      use: { ...devices['Pixel 5'] },
    },
    {
      name: 'iPhone 12',
      use: { ...devices['iPhone 12'] },
    },
  ],
});
