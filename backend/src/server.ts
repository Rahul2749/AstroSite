import pino from 'pino';
import { readConfig } from './config.js';
import { database } from './infrastructure/database.js';
import { razorpay } from './infrastructure/providers.js';
import { createApp } from './http/app.js';
const config = readConfig(), db = database(config), logger = pino();
await db.query('SELECT 1');
const server = createApp(config, db, razorpay(config), logger).listen(config.PORT, config.HOST, () => logger.info({ port: config.PORT, bookingEnabled: config.BOOKING_ENABLED }, 'Booking API ready'));
server.requestTimeout = 30000;
server.headersTimeout = 35000;
let closing = false;
async function stop() {
  if (closing) return;
  closing = true;
  server.close(async () => { await db.end(); process.exit(0); });
  setTimeout(() => process.exit(1), 15000).unref();
}
process.on('SIGINT', stop); process.on('SIGTERM', stop);
