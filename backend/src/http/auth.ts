import type { RequestHandler } from 'express';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Config } from '../config.js';
import type { Db } from '../infrastructure/database.js';
import { hash, token, verifyPassword, hashPassword } from '../infrastructure/crypto.js';
import { AppError } from '../domain/booking.js';

const loginSchema = z.object({ email: z.string().email().max(254).transform(v => v.toLowerCase()), password: z.string().min(1).max(256) }).strict();
export const cookieName = 'veda_admin';
function cookieValue(header = '') { return header.split(';').map(v => v.trim()).find(v => v.startsWith(cookieName + '='))?.slice(cookieName.length + 1) ?? ''; }

export function auth(db: Db, config: Config) {
  // Constant work for unknown users, without storing a default administrator password.
  const dummyHash = hashPassword(token());
  const cookieOptions = { httpOnly: true, secure: new URL(config.ADMIN_ORIGIN || config.APP_ORIGIN).protocol === 'https:', sameSite: 'strict' as const, path: '/api/admin', maxAge: 12 * 3600000 };
  const requireAdmin: RequestHandler = async (req, res, next) => {
    const session = (await db.query(`SELECT s.*,a.email FROM admin_sessions s JOIN admins a ON a.id=s.admin_id
      WHERE token_hash=$1 AND expires_at>now()`, [hash(cookieValue(req.headers.cookie))])).rows[0];
    if (!session) throw new AppError(401, 'UNAUTHORIZED', 'Please sign in.');
    if (!['GET','HEAD'].includes(req.method) && req.headers['x-csrf-token'] !== session.csrf) throw new AppError(403, 'CSRF', 'Session verification failed. Refresh and try again.');
    res.locals.session = session;
    next();
  };
  const login: RequestHandler = async (req, res) => {
    const input = loginSchema.parse(req.body);
    const admin = (await db.query('SELECT * FROM admins WHERE email=$1', [input.email])).rows[0];
    const valid = await verifyPassword(input.password, admin?.password_hash ?? await dummyHash);
    if (!admin || !valid) throw new AppError(401, 'INVALID_LOGIN', 'Email or password is incorrect.');
    const sessionToken = token(), csrf = token();
    await db.query('DELETE FROM admin_sessions WHERE token_hash=$1', [hash(cookieValue(req.headers.cookie))]);
    await db.query("INSERT INTO admin_sessions(token_hash,admin_id,csrf,expires_at) VALUES($1,$2,$3,now()+interval '12 hours')", [hash(sessionToken), admin.id, csrf]);
    res.cookie(cookieName, sessionToken, cookieOptions).json({ email: admin.email, csrf });
  };
  const logout: RequestHandler = async (_req, res) => {
    await db.query('DELETE FROM admin_sessions WHERE token_hash=$1', [res.locals.session.token_hash]);
    res.clearCookie(cookieName, { ...cookieOptions, maxAge: undefined }).status(204).end();
  };
  return { requireAdmin, login, logout };
}

export async function createAdmin(db: Db, email: string, password: string) {
  z.string().email().parse(email);
  z.string().min(14).max(128).parse(password);
  const passwordHash = await hashPassword(password);
  // Explicit CLI administration only. Password changes invalidate all previous sessions.
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(`INSERT INTO admins(id,email,password_hash) VALUES($1,$2,$3)
      ON CONFLICT(email) DO UPDATE SET password_hash=excluded.password_hash RETURNING id`, [randomUUID(), email.toLowerCase(), passwordHash]);
    await client.query('DELETE FROM admin_sessions WHERE admin_id=$1', [rows[0].id]);
    await client.query('COMMIT');
  } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
}
