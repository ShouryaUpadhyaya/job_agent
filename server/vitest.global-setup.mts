import { execSync } from 'child_process';
import path from 'path';
import { resolveTestDatabaseUrl } from './vitest.test-db.mts';

/** Creates (if needed) and syncs the schema of the isolated test database. */
export default function setup() {
  const url = resolveTestDatabaseUrl();
  execSync('npx prisma db push --skip-generate --accept-data-loss', {
    cwd: path.resolve(import.meta.dirname),
    env: { ...process.env, DATABASE_URL: url },
    stdio: 'pipe',
  });
}
