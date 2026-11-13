import { before, after, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac, randomUUID } from 'node:crypto';
import request from 'supertest';
import pino from 'pino';
import { readConfig } from '../src/config.js';
import { database, transaction } from '../src/infrastructure/database.js';
import { token } from '../src/infrastructure/crypto.js';
import { migrate } from '../src/scripts/migrate.js';
import { bookingSchema, indiaDate, timesForDate, slotStart } from '../src/domain/booking.js';
import type { Payment, PaymentGateway, MailGateway, MailMessage, Refund } from '../src/domain/ports.js';
import { BookingService } from '../src/application/booking-service.js';
import { WorkerService } from '../src/application/worker-service.js';
import { AdminService, actionSchema } from '../src/application/admin-service.js';
import { createApp } from '../src/http/app.js';
import { createAdmin } from '../src/http/auth.js';

const connection = process.env.TEST_DATABASE_URL || 'postgresql://veda:local-development-only@127.0.0.1:5438/veda_test';
if (!new URL(connection).pathname.endsWith('_test')) throw new Error('Tests require a dedicated database name ending in _test.');
const config = readConfig({ NODE_ENV: 'test', DATABASE_URL: connection, BOOKING_ENABLED: 'true', APP_ORIGIN: 'http://127.0.0.1:5173',
  RAZORPAY_KEY_ID: 'rzp_test_local', RAZORPAY_KEY_SECRET: 'test-secret', RAZORPAY_WEBHOOK_SECRET: 'test-webhook',
  RESEND_API_KEY: 'test-only', EMAIL_FROM: 'Vedā <test@example.test>', BOOKING_NOTIFY_EMAIL: 'owner@example.test' });
const db = database(config);
const payments = new Map<string, Payment>();
const orders: string[] = [], refunds: string[] = [], emails: { message: MailMessage; key: string }[] = [];
let orderFail = false, emailFail = false;
const gateway: PaymentGateway = {
  async createOrder() { if (orderFail) throw new Error('timeout'); const id = 'order_' + randomUUID().replaceAll('-', ''); orders.push(id); return { id }; },
  async payment(id) { const p = payments.get(id); if (!p) throw new Error('Not found'); return p; },
  async orderPayments(order) { return [...payments.values()].filter(p => p.order_id === order); },
  async refund(id, amount, key) { refunds.push(key); return { id: 'rfnd_' + key, payment_id: id, amount, status: 'processed' }; },
  async refundStatus() { throw new Error('Not needed'); },
};
const mail: MailGateway = {
  async send(message, key) { emails.push({ message, key }); if (emailFail) throw new Error('Provider unavailable'); return { id: 'mail_' + key }; },
  async status() { return 'delivered'; },
};
const bookings = new BookingService(db, config, gateway), admin = new AdminService(db, config), worker = new WorkerService(bookings, mail);
const app = createApp(config, db, gateway, pino({ enabled: false }));
function dateAfter(days = 1) {
  while (true) { const date = indiaDate(new Date(Date.now() + days * 86400000)); if (timesForDate(date, config).length) return date; days++; }
}
function input(time = '09:00') { return bookingSchema.parse({ serviceId: 'clarity', date: dateAfter(), time, language: 'en', name: 'Test Client', email: 'delivered@example.test', consent: true }); }
async function create(time = '09:00') { const accessToken = token(); return { ...await bookings.create(input(time), accessToken), accessToken }; }
function payment(orderId: string, overrides: Partial<Payment> = {}) {
  const p = { id: 'pay_' + randomUUID().replaceAll('-', ''), order_id: orderId, amount: 20000, currency: 'INR', status: 'captured', ...overrides };
  payments.set(p.id, p); return p;
}
async function confirmed(time = '09:00') { const a = await create(time); const p = payment(a.orderId); await bookings.capture(p); return { ...a, payment: p }; }
const sign = (body: string | Buffer, secret = config.RAZORPAY_WEBHOOK_SECRET) => createHmac('sha256', secret).update(body).digest('hex');
before(async () => { await migrate(db); });
beforeEach(async () => {
  await db.query('TRUNCATE appointments,jobs,webhook_events,admins,admin_sessions,audit_log,rate_limits RESTART IDENTITY CASCADE');
  payments.clear(); orders.length = 0; refunds.length = 0; emails.length = 0; orderFail = false; emailFail = false;
});
after(async () => { await db.end(); });

test('IST calendar validates real dates, future horizon, Sundays and 30-minute boundaries', () => {
  const now = new Date('2026-11-14T20:00:00Z'); // Sunday in India.
  assert.equal(indiaDate(now), '2026-11-15');
  assert.deepEqual(timesForDate('2026-11-15', config, now), []);
  assert.equal(timesForDate('2026-11-16', config, now).length, 18);
  assert.equal(timesForDate('2026-11-16', config, now).at(-1), '17:30');
  assert.deepEqual(timesForDate('2026-02-31', config, now), []);
  assert.throws(() => slotStart('2026-11-16', '18:00', config, now));
  assert.throws(() => slotStart('2026-11-16', '09:15', config, now));
});
test('server owns price and rejects client price injection and missing birth details', async () => {
  await request(app).post('/api/bookings').set('Origin', config.APP_ORIGIN).set('Idempotency-Key', token()).send({ ...input(), amount: 1 }).expect(400);
  await assert.rejects(bookings.create({ ...input(), serviceId: 'birth-chart' }, token()), /birth/);
  assert.equal((await create()).amount, 20000);
});
test('concurrent clients cannot hold the same slot', async () => {
  const results = await Promise.allSettled([create(), create()]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(orders.length, 1);
  assert.equal((await db.query('SELECT * FROM appointments')).rowCount, 1);
});
test('same request reuses the order and changed details with the same token are rejected', async () => {
  const a = await create();
  assert.equal((await bookings.create(input(), a.accessToken)).orderId, a.orderId);
  assert.equal(orders.length, 1);
  await assert.rejects(bookings.create({ ...input(), name: 'Changed Client' }, a.accessToken), /Details changed/);
});
test('uncertain order creation never repeats external order creation automatically', async () => {
  orderFail = true; const accessToken = token();
  await assert.rejects(bookings.create(input(), accessToken), /Could not open/);
  orderFail = false;
  await assert.rejects(bookings.create(input(), accessToken), /still being checked/);
  assert.equal(orders.length, 0);
});
test('expired holds are released, but late payments are refunded without displacing the new booking', async () => {
  const old = await create();
  await db.query("UPDATE appointments SET hold_until=now()-interval '1 minute' WHERE id=$1", [old.id]);
  const replacement = await create();
  await bookings.capture(payment(old.orderId));
  const a = await bookings.status(old.id, old.accessToken);
  assert.equal(a.status, 'cancelled'); assert.equal(a.paymentStatus, 'refund_pending');
  assert.equal((await bookings.status(replacement.id, replacement.accessToken)).status, 'pending');
  assert.equal((await db.query("SELECT * FROM jobs WHERE kind='refund'")).rowCount, 1);
});
test('authorized but uncaptured payments cannot confirm appointments', async () => {
  const a = await create(); await bookings.capture(payment(a.orderId, { status: 'authorized' }));
  assert.equal((await bookings.status(a.id, a.accessToken)).status, 'pending');
  assert.equal((await db.query('SELECT * FROM jobs')).rowCount, 0);
});
test('payment amount and currency must match the stored order', async () => {
  const a = await create();
  await assert.rejects(bookings.capture(payment(a.orderId, { amount: 1 })), /amount/);
  await assert.rejects(bookings.capture(payment(a.orderId, { currency: 'USD' })), /currency/);
  assert.equal((await bookings.status(a.id, a.accessToken)).status, 'pending');
});
test('client signature is checked against the stored order and provider payment', async () => {
  const a = await create(), p = payment(a.orderId);
  await assert.rejects(bookings.verify(a.id, a.accessToken, p.id, sign('wrong', config.RAZORPAY_KEY_SECRET)), /signature/);
  const signature = sign(`${a.orderId}|${p.id}`, config.RAZORPAY_KEY_SECRET);
  assert.equal((await bookings.verify(a.id, a.accessToken, p.id, signature)).status, 'confirmed');
});
test('webhook HMAC uses raw bytes and deduplicates concurrent callback/webhook delivery', async () => {
  const a = await create(), p = payment(a.orderId);
  const body = JSON.stringify({ event: 'payment.captured', payload: { payment: { entity: p } } });
  await request(app).post('/api/webhooks/razorpay').set('Content-Type', 'application/json').set('X-Razorpay-Event-Id', 'evt_bad').set('X-Razorpay-Signature', sign(body)).send(body + ' ').expect(400);
  await Promise.all([bookings.capture(p), bookings.webhook('evt_one', Buffer.from(body), sign(body)), bookings.webhook('evt_one', Buffer.from(body), sign(body))]);
  assert.equal((await db.query('SELECT * FROM webhook_events')).rowCount, 1);
  assert.equal((await db.query("SELECT * FROM jobs WHERE kind='email'")).rowCount, 2);
  assert.equal((await bookings.status(a.id, a.accessToken)).status, 'confirmed');
});
test('a foreign booking token cannot read another client appointment', async () => {
  const a = await create();
  await request(app).get('/api/bookings/' + a.id).set('Authorization', 'Bearer ' + token()).expect(404);
  const response = await request(app).get('/api/bookings/' + a.id).set('Authorization', 'Bearer ' + a.accessToken).expect(200);
  assert.equal(response.body.email, undefined); assert.equal(response.body.details, undefined);
});
test('email outbox survives provider failures and retries the same immutable message/key', async () => {
  await confirmed(); emailFail = true; await worker.runJob();
  const job = (await db.query("SELECT * FROM jobs WHERE attempts=1")).rows[0];
  assert.equal(job.status, 'queued');
  emailFail = false;
  await db.query('UPDATE jobs SET available_at=now()-interval \'1 minute\' WHERE id=$1', [job.id]);
  await worker.runJob();
  assert.equal(emails[0].key, emails[1].key); assert.deepEqual(emails[0].message, emails[1].message);
  assert.equal((await db.query('SELECT status FROM jobs WHERE id=$1', [job.id])).rows[0].status, 'done');
});
test('emails older than provider idempotency retention are stopped for review', async () => {
  await confirmed();
  await db.query("UPDATE jobs SET first_attempt_at=now()-interval '25 hours'");
  await worker.runJob(); assert.equal(emails.length, 0);
  assert.equal((await db.query("SELECT * FROM jobs WHERE status='failed'")).rowCount, 1);
});
test('payment reconciliation confirms capture even if the browser closes and webhook is missed', async () => {
  const a = await create(); payment(a.orderId); await worker.reconcile();
  assert.equal((await bookings.status(a.id, a.accessToken)).status, 'confirmed');
});
test('admin requires authentication, an allowed Origin and a session-bound CSRF token', async () => {
  await request(app).get('/api/admin/appointments').expect(401);
  await createAdmin(db, 'admin@example.test', 'Long-local-test-password');
  const agent = request.agent(app);
  await agent.post('/api/admin/login').send({ email: 'admin@example.test', password: 'Long-local-test-password' }).expect(403);
  const response = await agent.post('/api/admin/login').set('Origin', config.APP_ORIGIN).send({ email: 'admin@example.test', password: 'Long-local-test-password' }).expect(200);
  const cookie = response.headers['set-cookie'][0]; assert.match(cookie, /HttpOnly/); assert.match(cookie, /SameSite=Strict/);
  await agent.get('/api/admin/appointments').expect(200);
  await agent.post('/api/admin/logout').set('Origin', config.APP_ORIGIN).expect(403);
  await agent.post('/api/admin/logout').set('Origin', config.APP_ORIGIN).set('X-CSRF-Token', response.body.csrf).expect(204);
  await agent.get('/api/admin/me').expect(401);
});
test('login throttling is persisted and protects repeated bad passwords', async () => {
  for (let i = 0; i < 10; i++) await request(app).post('/api/admin/login').set('Origin', config.APP_ORIGIN).send({ email: 'none@example.test', password: 'wrong' }).expect(401);
  await request(app).post('/api/admin/login').set('Origin', config.APP_ORIGIN).send({ email: 'none@example.test', password: 'wrong' }).expect(429);
});
test('admin reschedule conflict rolls back and stale updates are rejected', async () => {
  const a = await confirmed(), b = await confirmed('09:30');
  await assert.rejects(admin.action(a.id, null as unknown as string, { action: 'reschedule', date: dateAfter(), time: '09:30', version: 1 }), /unavailable/);
  assert.equal((await admin.detail(a.id)).starts_at.toISOString(), (await bookings.status(a.id, a.accessToken)).startsAt.toISOString());
  await admin.action(a.id, null as unknown as string, { action: 'reschedule', date: dateAfter(), time: '10:00', version: 1 });
  await assert.rejects(admin.action(a.id, null as unknown as string, { action: 'cancel', reason: 'Test cancellation', version: 1 }), /changed/);
  assert.equal((await bookings.status(b.id, b.accessToken)).status, 'confirmed');
});
test('cancellation queues a full refund exactly once and tracks processed status', async () => {
  const a = await confirmed();
  await admin.action(a.id, null as unknown as string, { action: 'cancel', reason: 'Client requested cancellation', version: 1 });
  await assert.rejects(admin.action(a.id, null as unknown as string, { action: 'cancel', reason: 'Repeated cancellation', version: 2 }), /confirmed/);
  for (let i = 0; i < 8; i++) await worker.runJob();
  assert.deepEqual(refunds, [a.id]);
  assert.equal((await bookings.status(a.id, a.accessToken)).paymentStatus, 'refunded');
  await transaction(db, tx => bookings.recordRefund(tx, { id: 'rfnd_' + a.id, payment_id: a.payment.id, amount: 20000, status: 'failed' }));
  assert.equal((await bookings.status(a.id, a.accessToken)).paymentStatus, 'refunded');
});
test('completed/no-show actions are rejected before the appointment ends', async () => {
  const a = await confirmed();
  await assert.rejects(admin.action(a.id, null as unknown as string, { action: 'no_show', version: 1 }), /ended/);
  await db.query("UPDATE appointments SET starts_at=now()-interval '1 hour' WHERE id=$1", [a.id]);
  assert.equal((await admin.action(a.id, null as unknown as string, { action: 'completed', version: 1 })).status, 'completed');
});
test('Hindi email contains the localized consultation and omits private birth details', async () => {
  const a = await bookings.create({ ...input(), language: 'hi', serviceId: 'birth-chart', dob: '1990-01-01', place: 'Private birth city', unknown: true, notes: 'Private client question' }, token());
  await bookings.capture(payment(a.orderId, { amount: 49900 }));
  const rows = (await db.query("SELECT payload FROM jobs WHERE kind='email'")).rows;
  assert.equal(rows.length, 2);
  for (const { payload } of rows) { assert.match(payload.text, /जन्म कुंडली/); assert.doesNotMatch(payload.text, /Private birth city|Private client question|1990-01-01/); }
});

test('admin can save a private note with an empty meeting link; invalid URLs return validation errors', async () => {
  const a = await confirmed();
  const parsed = actionSchema.parse({ action: 'details', joinUrl: '', note: 'A private admin note.', version: 1 });
  const changed = await admin.action(a.id, null as unknown as string, parsed);
  assert.equal(changed.admin_note, 'A private admin note.');
  assert.equal(changed.join_url, null);
  assert.equal((await db.query("SELECT * FROM jobs WHERE kind='email'")).rowCount, 2);
  for (const link of ['not a url', 'javascript:alert(1)', 'http://example.test/meet']) {
    assert.equal(actionSchema.safeParse({ ...parsed, joinUrl: link }).success, false);
  }
});

test('two workers claim separate email jobs and record provider acceptance once', async () => {
  await confirmed();
  const other = new WorkerService(bookings, mail);
  await Promise.all([worker.runJob(), other.runJob()]);
  assert.equal(new Set(emails.map(e => e.key)).size, 2);
  assert.equal((await db.query("SELECT * FROM jobs WHERE status='done'")).rowCount, 2);
});

test('provider payment lookup cannot confirm a different order', async () => {
  const a = await create(), b = await create('09:30');
  const p = payment(b.orderId);
  await assert.rejects(bookings.verify(a.id, a.accessToken, p.id, sign(`${a.orderId}|${p.id}`, config.RAZORPAY_KEY_SECRET)), /match this order/);
  assert.equal((await bookings.status(a.id, a.accessToken)).status, 'pending');
  assert.equal((await bookings.status(b.id, b.accessToken)).status, 'pending');
});
