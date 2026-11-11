import { fileURLToPath, pathToFileURL } from 'node:url';
import { mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { PrismaLibSql } from '@prisma/adapter-libsql';
import { createClient } from '@libsql/client';
import { PrismaClient } from './generated/prisma/client.js';

export const dataDirectory = path.resolve(
  process.env.EGENT_DATA_DIR ?? fileURLToPath(new URL('../../../.local-data', import.meta.url)),
);
mkdirSync(dataDirectory, { recursive: true });
const url = pathToFileURL(path.join(dataDirectory, 'egent.sqlite')).href;
const adapter = new PrismaLibSql({ url });
/** Local per-device SQLite database; never reads the legacy PostgreSQL DATABASE_URL. */
export const prisma = new PrismaClient({ adapter });
export type { Prisma, AgentTask } from './generated/prisma/client.js';
/** Apply the bundled initial schema once, preserving existing per-device data. */
export async function initializeDatabase() {
  const client = createClient({ url });
  try {
    await client.execute('PRAGMA journal_mode=WAL');
    await client.execute('CREATE TABLE IF NOT EXISTS _EgentSchema(version INTEGER PRIMARY KEY)');
    const existing = await client.execute('SELECT version FROM _EgentSchema');
    const initial =
      process.env.EGENT_SQLITE_SCHEMA ??
      fileURLToPath(new URL('../prisma/sqlite/001-initial.sql', import.meta.url));
    const migrations = [
      initial,
      path.join(path.dirname(initial), '002-membership.sql'),
      path.join(path.dirname(initial), '003-explicit-agent.sql'),
      path.join(path.dirname(initial), '004-agent-model-settings.sql'),
      path.join(path.dirname(initial), '005-hidden-conversations.sql'),
      path.join(path.dirname(initial), '006-mention-alerts.sql'),
      path.join(path.dirname(initial), '007-notifications.sql'),
    ];
    for (const [index, file] of migrations.entries()) {
      const version = index + 1;
      if (existing.rows.some((row) => Number(row.version) === version)) continue;
      await client.executeMultiple(
        'BEGIN IMMEDIATE;\n' +
          readFileSync(file, 'utf8') +
          '\nINSERT INTO _EgentSchema VALUES(' +
          version +
          ');\nCOMMIT;',
      );
    }
  } finally {
    client.close();
  }
}
let writes = Promise.resolve();
/** Serialize SQLite writes in the single backend process instead of PostgreSQL advisory locks. */
export function serialWrite<T>(operation: () => Promise<T>): Promise<T> {
  const result = writes.then(operation);
  writes = result.then(
    () => {},
    () => {},
  );
  return result;
}
