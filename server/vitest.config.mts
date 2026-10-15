import { defineConfig } from 'vitest/config';
import { resolveTestDatabaseUrl } from './vitest.test-db.mts';

export default defineConfig({
  test: {
    // Tests share one database and truncate tables, so files must not run in parallel.
    fileParallelism: false,
    globals: true,
    environment: 'node',
    globalSetup: ['./vitest.global-setup.mts'],
    env: {
      DATABASE_URL: resolveTestDatabaseUrl(),
      NODE_ENV: 'test',
      DISABLE_SCHEDULER: 'true',
      // Never call the real Gemini API from tests.
      GEMINI_KEY: '',
    },
  },
});
