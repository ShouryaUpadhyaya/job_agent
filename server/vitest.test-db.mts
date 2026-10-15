import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

/**
 * Server tests delete rows from every table, so they must never run against the
 * dev database. Derive a sibling `<db>_test` database from the root .env's
 * DATABASE_URL (or use TEST_DATABASE_URL when set).
 */
export function resolveTestDatabaseUrl(): string {
  const envPath = path.resolve(import.meta.dirname, '../.env');
  const fileEnv = fs.existsSync(envPath) ? dotenv.parse(fs.readFileSync(envPath)) : {};

  const explicit = process.env.TEST_DATABASE_URL || fileEnv.TEST_DATABASE_URL;
  const base =
    explicit ||
    process.env.DATABASE_URL ||
    fileEnv.DATABASE_URL ||
    'postgresql://postgres:postgres@localhost:5433/job_agent?schema=public';

  const url = new URL(base);
  if (!explicit) {
    const dbName = url.pathname.replace(/^\//, '') || 'job_agent';
    if (!dbName.includes('test')) url.pathname = `/${dbName}_test`;
  }

  const dbName = url.pathname.replace(/^\//, '');
  if (!dbName.includes('test')) {
    throw new Error(`Refusing to run tests against non-test database "${dbName}".`);
  }
  return url.toString();
}
