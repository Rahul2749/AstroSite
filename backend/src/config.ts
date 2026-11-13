import { z } from 'zod';
import { isIP } from 'node:net';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().default('127.0.0.1'),
  PORT: z.coerce.number().int().min(1).max(65535).default(5100),
  DATABASE_URL: z.string().url(),
  APP_ORIGIN: z.string().url().default('http://127.0.0.1:5173'),
  ADMIN_ORIGIN: z.string().default(''),
  ALLOW_HTTP_TESTING: z.enum(['true', 'false']).default('false').transform(v => v === 'true'),
  BOOKING_ENABLED: z.enum(['true', 'false']).default('false').transform(v => v === 'true'),
  PAYMENT_MODE: z.enum(['test', 'live']).default('test'),
  RAZORPAY_KEY_ID: z.string().default(''), RAZORPAY_KEY_SECRET: z.string().default(''),
  RAZORPAY_WEBHOOK_SECRET: z.string().default(''), RESEND_API_KEY: z.string().default(''),
  EMAIL_FROM: z.string().default(''), BOOKING_NOTIFY_EMAIL: z.string().default(''),
  SUPPORT_EMAIL: z.string().default(''), PRIVACY_URL: z.string().default(''), TERMS_URL: z.string().default(''),
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(3).default(0),
  DB_POOL_SIZE: z.coerce.number().int().min(1).max(30).default(10),
  HOLD_MINUTES: z.coerce.number().int().min(5).max(30).default(15),
  BOOKING_DAYS_AHEAD: z.coerce.number().int().min(1).max(90).default(90),
  SCHEDULE_DAYS: z.string().regex(/^[0-6](,[0-6])*$/).default('1,2,3,4,5,6'),
  SCHEDULE_START_HOUR: z.coerce.number().int().min(0).max(22).default(9),
  SCHEDULE_END_HOUR: z.coerce.number().int().min(1).max(23).default(18),
});
export type Config = z.infer<typeof schema>;
export function readConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const c = schema.parse(env);
  if (c.APP_ORIGIN !== new URL(c.APP_ORIGIN).origin) throw new Error('APP_ORIGIN must be an origin without a path or trailing slash.');
  if (c.SCHEDULE_START_HOUR >= c.SCHEDULE_END_HOUR) throw new Error('Invalid schedule hours.');
  const appUrl = new URL(c.APP_ORIGIN);
  if (c.ALLOW_HTTP_TESTING) {
    if (c.PAYMENT_MODE !== 'test' || appUrl.protocol !== 'http:' || !isIP(appUrl.hostname.replace(/^\[|\]$/g, ''))) {
      throw new Error('HTTP testing requires an HTTP IP origin and Razorpay test mode.');
    }
    const adminUrl = new URL(c.ADMIN_ORIGIN);
    if (adminUrl.origin !== c.ADMIN_ORIGIN || adminUrl.protocol !== 'http:' || adminUrl.hostname !== '127.0.0.1') {
      throw new Error('HTTP testing requires a loopback ADMIN_ORIGIN accessed through an SSH tunnel.');
    }
  } else {
    if (c.NODE_ENV === 'production' && appUrl.protocol !== 'https:') throw new Error('Production requires HTTPS.');
    if (c.ADMIN_ORIGIN && (new URL(c.ADMIN_ORIGIN).origin !== c.ADMIN_ORIGIN || (c.NODE_ENV === 'production' && !c.ADMIN_ORIGIN.startsWith('https://')))) {
      throw new Error('Invalid admin origin. Production admin access requires HTTPS.');
    }
  }
  if (c.BOOKING_ENABLED) {
    for (const key of ['RAZORPAY_KEY_ID', 'RAZORPAY_KEY_SECRET', 'RAZORPAY_WEBHOOK_SECRET', 'RESEND_API_KEY', 'EMAIL_FROM', 'BOOKING_NOTIFY_EMAIL'] as const) {
      if (!c[key]) throw new Error(`${key} is required before opening bookings.`);
    }
    z.string().email().parse(c.BOOKING_NOTIFY_EMAIL);
    if (!c.RAZORPAY_KEY_ID.startsWith(`rzp_${c.PAYMENT_MODE}_`)) throw new Error('Razorpay key does not match PAYMENT_MODE.');
    if (c.PAYMENT_MODE === 'live') {
      z.string().email().parse(c.SUPPORT_EMAIL);
      for (const url of [c.PRIVACY_URL, c.TERMS_URL]) if (!url.startsWith('https://')) throw new Error('Live booking requires published HTTPS privacy and terms URLs.');
    }
  }
  return c;
}
