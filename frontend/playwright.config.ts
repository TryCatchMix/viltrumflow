import { defineConfig } from '@playwright/test';

/**
 * Pruebas de extremo a extremo contra la build de producción (la única con modo sin conexión).
 * `npm run e2e` compila y lanza las pruebas; Playwright arranca el backend (SQLite temporal) y un
 * servidor que hace lo mismo que nginx en producción: sirve la SPA y redirige /api al backend.
 */
const PYTHON = process.env.E2E_PYTHON || '../backend/.venv/bin/python';

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  use: {
    baseURL: 'http://localhost:4300',
    locale: 'es-ES',
    timezoneId: 'Europe/Madrid',
    trace: process.env.CI ? 'retain-on-failure' : 'off',
    screenshot: 'only-on-failure',
  },
  webServer: [
    {
      // Base SQLite en fichero, recreada en cada ejecución (la de memoria comparte una sola conexión
      // entre peticiones simultáneas y da errores intermitentes)
      command: `rm -f e2e-test.db && ${PYTHON} -m uvicorn app.main:app --port 8010`,
      cwd: '../backend',
      url: 'http://localhost:8010/health',
      reuseExistingServer: false,
      env: {
        DATABASE_URL: 'sqlite:///./e2e-test.db',
        SECRET_KEY: 'e2e-secret-key-e2e-secret-key-0123456789',
        ENVIRONMENT: 'test',
        SCHEDULER_ENABLED: 'false',
        LOGIN_MAX_ATTEMPTS: '1000',
      },
    },
    {
      command: 'node e2e/serve.mjs',
      url: 'http://localhost:4300/health',
      reuseExistingServer: false,
      env: { API_PORT: '8010', PORT: '4300' },
    },
  ],
});
