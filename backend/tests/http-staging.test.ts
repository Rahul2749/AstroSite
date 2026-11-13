import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import pino from 'pino';
import { readConfig } from '../src/config.js';
import { createApp } from '../src/http/app.js';
import { hashPassword } from '../src/infrastructure/crypto.js';
import type { Db } from '../src/infrastructure/database.js';
import type { PaymentGateway } from '../src/domain/ports.js';

const staging = { DATABASE_URL: 'postgresql://test:test@127.0.0.1/veda_test', NODE_ENV: 'production',
  APP_ORIGIN: 'http://192.0.2.10:8080', ADMIN_ORIGIN: 'http://127.0.0.1:8081', ALLOW_HTTP_TESTING: 'true' };
// These tests exercise HTTP middleware only. No database or provider requests occur.
async function fixture(env = staging) {
  const passwordHash = await hashPassword('Temporary-unit-test-password');
  const db = { query: async (sql: string) => {
    if (sql.includes('FROM admins WHERE')) return { rows: [{ id: 'unit-admin', email: 'admin@example.test', password_hash: passwordHash }] };
    if (sql.includes('FROM admin_sessions s')) return { rows: [{ token_hash: 'unit-session', csrf: 'unit-csrf', admin_id: 'unit-admin', email: 'admin@example.test' }] };
    return { rows: [{ hits: 1 }], rowCount: 1 };
  } } as unknown as Db;
  return createApp(readConfig(env), db, {} as PaymentGateway, pino({ enabled: false }));
}
test('admin mutations accept the private tunnel origin and reject the public site origin', async () => {
  const app = await fixture();
  await request(app).post('/api/admin/logout').set('Origin', staging.APP_ORIGIN).set('X-CSRF-Token', 'unit-csrf').expect(403);
  await request(app).post('/api/admin/logout').set('Origin', staging.ADMIN_ORIGIN).set('X-CSRF-Token', 'unit-csrf').expect(204);
  await request(app).post('/api/admin/logout').set('Origin', staging.ADMIN_ORIGIN).expect(403);
});
test('public booking requests retain the public origin restriction', async () => {
  const app = await fixture();
  await request(app).post('/api/bookings').set('Origin', staging.ADMIN_ORIGIN).send({}).expect(403);
  // Correct public origin passes Origin validation and reaches body/header validation.
  await request(app).post('/api/bookings').set('Origin', staging.APP_ORIGIN).send({}).expect(400);
});
test('test tunnel login uses HttpOnly/Strict cookies over loopback HTTP', async () => {
  const app = await fixture();
  const response = await request(app).post('/api/admin/login').set('Origin', staging.ADMIN_ORIGIN)
    .send({ email: 'admin@example.test', password: 'Temporary-unit-test-password' }).expect(200);
  const cookie = response.headers['set-cookie'][0];
  assert.match(cookie, /HttpOnly/); assert.match(cookie, /SameSite=Strict/); assert.doesNotMatch(cookie, /; Secure/);
});
test('normal HTTPS deployment retains Secure admin cookies', async () => {
  const app = await fixture({ ...staging, APP_ORIGIN: 'https://example.com', ADMIN_ORIGIN: '', ALLOW_HTTP_TESTING: 'false' });
  const response = await request(app).post('/api/admin/login').set('Origin', 'https://example.com')
    .send({ email: 'admin@example.test', password: 'Temporary-unit-test-password' }).expect(200);
  assert.match(response.headers['set-cookie'][0], /; Secure/);
});
