import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { readConfig } from '../config.js';
import { database, transaction, type Db } from '../infrastructure/database.js';

export async function migrate(db: Db) {
  const folder = fileURLToPath(new URL('../../migrations/', import.meta.url));
  await transaction(db, async tx => {
    await tx.query('SELECT pg_advisory_xact_lock(816901)');
    await tx.query('CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
    for (const file of (await readdir(folder)).filter(f => f.endsWith('.sql')).sort()) {
      if ((await tx.query('SELECT name FROM schema_migrations WHERE name=$1', [file])).rowCount) continue;
      await tx.query(await readFile(folder + file, 'utf8'));
      await tx.query('INSERT INTO schema_migrations(name) VALUES($1)', [file]);
    }
  });
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const db = database(readConfig());
  try { await migrate(db); console.log('Database migrations applied.'); } finally { await db.end(); }
}
