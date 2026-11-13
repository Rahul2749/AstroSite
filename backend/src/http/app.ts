import express, { type ErrorRequestHandler, type RequestHandler } from 'express';
import helmet from 'helmet';
import { z, ZodError } from 'zod';
import { randomUUID } from 'node:crypto';
import type { Logger } from 'pino';
import type { Config } from '../config.js';
import type { Db } from '../infrastructure/database.js';
import { hash } from '../infrastructure/crypto.js';
import { AppError, bookingSchema, catalog, dateSchema } from '../domain/booking.js';
import type { PaymentGateway } from '../domain/ports.js';
import { BookingService } from '../application/booking-service.js';
import { AdminService, actionSchema } from '../application/admin-service.js';
import { auth } from './auth.js';

export function createApp(config: Config, db: Db, gateway: PaymentGateway, logger: Logger) {
  const app = express();
  const admin = new AdminService(db, config);
  const bookings = new BookingService(db, config, gateway);
  const authentication = auth(db, config);
  app.disable('x-powered-by');
  app.set('trust proxy', config.TRUST_PROXY_HOPS);
  app.use(helmet());
  app.use((req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Request-Id', randomUUID());
    // Never log request bodies, auth headers, query strings, emails or birth data.
    const start = Date.now();
    res.on('finish', () => logger.info({ method: req.method, route: req.route?.path ?? 'unmatched', status: res.statusCode, ms: Date.now() - start }, 'request'));
    next();
  });
  const limit = (scope: string, max: number, seconds: number): RequestHandler => async (req, _res, next) => {
    const key = hash(`${scope}:${req.ip}`);
    const { rows } = await db.query(`INSERT INTO rate_limits(key,hits,expires_at) VALUES($1,1,now()+$2*interval '1 second')
      ON CONFLICT(key) DO UPDATE SET hits=CASE WHEN rate_limits.expires_at<now() THEN 1 ELSE rate_limits.hits+1 END,
      expires_at=CASE WHEN rate_limits.expires_at<now() THEN excluded.expires_at ELSE rate_limits.expires_at END RETURNING hits`, [key, seconds]);
    if (rows[0].hits > max) throw new AppError(429, 'RATE_LIMIT', 'Too many requests. Please try again later.');
    next();
  };
  const origin: RequestHandler = (req, _res, next) => {
    const expected = /^\/admin(?:\/|$)/.test(req.path) ? config.ADMIN_ORIGIN || config.APP_ORIGIN : config.APP_ORIGIN;
    if (!['GET','HEAD','OPTIONS'].includes(req.method) && req.get('origin') !== expected) throw new AppError(403, 'ORIGIN', 'Request origin is not allowed.');
    next();
  };
  app.get('/api/health', async (_req, res) => { await db.query('SELECT 1'); res.json({ status: 'ok' }); });
  app.post('/api/webhooks/razorpay', express.raw({ type: 'application/json', limit: '128kb' }), async (req, res) => {
    const eventId = z.string().min(1).max(200).parse(req.get('x-razorpay-event-id'));
    if (!Buffer.isBuffer(req.body)) throw new AppError(400, 'INVALID_WEBHOOK', 'JSON body required.');
    await bookings.webhook(eventId, req.body, req.get('x-razorpay-signature') ?? '');
    res.json({ received: true });
  });
  app.use('/api', origin, express.json({ limit: '16kb' }));
  app.get('/api/booking/config', (_req, res) => res.json({ enabled: config.BOOKING_ENABLED, mode: config.PAYMENT_MODE, services: catalog,
    schedule: { days: config.SCHEDULE_DAYS.split(',').map(Number), startHour: config.SCHEDULE_START_HOUR, endHour: config.SCHEDULE_END_HOUR, daysAhead: config.BOOKING_DAYS_AHEAD },
    supportEmail: config.SUPPORT_EMAIL, privacyUrl: config.PRIVACY_URL, termsUrl: config.TERMS_URL }));
  app.get('/api/availability', limit('availability', 120, 60), async (req, res) => res.json({ slots: await bookings.availability(dateSchema.parse(req.query.date)) }));
  app.post('/api/bookings', limit('checkout', 12, 900), async (req, res) => {
    const accessToken = z.string().regex(/^[a-f0-9]{64}$/).parse(req.get('idempotency-key'));
    res.status(201).json(await bookings.create(bookingSchema.parse(req.body), accessToken));
  });
  const bookingAccess = (req: express.Request) => ({ id: z.string().uuid().parse(req.params.id), accessToken: z.string().regex(/^[a-f0-9]{64}$/).parse(req.get('authorization')?.replace(/^Bearer /, '')) });
  app.get('/api/bookings/:id', limit('status', 120, 60), async (req, res) => { const { id, accessToken } = bookingAccess(req); res.json(await bookings.status(id, accessToken)); });
  app.post('/api/bookings/:id/verify', limit('verify', 30, 60), async (req, res) => {
    const { id, accessToken } = bookingAccess(req);
    const input = z.object({ paymentId: z.string().regex(/^pay_[a-zA-Z0-9]+$/), signature: z.string().regex(/^[a-f0-9]{64}$/) }).strict().parse(req.body);
    res.json(await bookings.verify(id, accessToken, input.paymentId, input.signature));
  });
  app.post('/api/admin/login', limit('login', 10, 900), authentication.login);
  app.use('/api/admin', authentication.requireAdmin);
  app.get('/api/admin/me', (_req, res) => res.json({ email: res.locals.session.email, csrf: res.locals.session.csrf }));
  app.post('/api/admin/logout', authentication.logout);
  app.get('/api/admin/appointments', async (req, res) => {
    const query = z.object({ q: z.string().max(100).default(''), status: z.enum(['','pending','expired','confirmed','cancelled','completed','no_show']).default(''), page: z.coerce.number().int().min(1).max(10000).default(1) }).parse(req.query);
    res.json(await admin.list(query.q, query.status, query.page));
  });
  app.get('/api/admin/appointments/:id', async (req, res) => res.json(await admin.detail(z.string().uuid().parse(req.params.id))));
  app.post('/api/admin/appointments/:id/actions', async (req, res) => res.json(await admin.action(z.string().uuid().parse(req.params.id), res.locals.session.admin_id, actionSchema.parse(req.body))));
  app.use((_req, res) => res.status(404).json({ code: 'NOT_FOUND', message: 'Endpoint not found.' }));
  const errors: ErrorRequestHandler = (error, _req, res, _next) => {
    if (error instanceof ZodError) { res.status(400).json({ code: 'VALIDATION', message: 'Please check the submitted details.', fields: error.flatten().fieldErrors }); return; }
    if (error instanceof AppError) { res.status(error.status).json({ code: error.code, message: error.message }); return; }
    if (error.type === 'entity.parse.failed' || error.type === 'entity.too.large') { res.status(400).json({ code: 'INVALID_BODY', message: 'Invalid request body.' }); return; }
    logger.error({ errorType: error?.name, code: error?.code }, 'Request failed');
    res.status(500).json({ code: 'INTERNAL', message: 'Something went wrong. Please try again shortly.' });
  };
  app.use(errors);
  return app;
}
