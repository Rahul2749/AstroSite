import pg from 'pg';
import type { Config } from '../config.js';
export type Db = pg.Pool;
export type Tx = pg.PoolClient;
export function database(config: Config) {
  return new pg.Pool({ connectionString: config.DATABASE_URL, max: config.DB_POOL_SIZE,
    connectionTimeoutMillis: 5000, idleTimeoutMillis: 30000, statement_timeout: 10000 });
}
export async function transaction<T>(db: Db, run: (tx: Tx) => Promise<T>): Promise<T> {
  const tx = await db.connect();
  try { await tx.query('BEGIN'); const result = await run(tx); await tx.query('COMMIT'); return result; }
  catch (error) { await tx.query('ROLLBACK'); throw error; }
  finally { tx.release(); }
}
// All scheduling changes use the same short database lock. No external IO inside it.
export async function scheduleLock(tx: Tx) {
  await tx.query('SELECT pg_advisory_xact_lock(816902)');
  await tx.query("UPDATE appointments SET status='expired', updated_at=now() WHERE status='pending' AND hold_until <= now()");
}
