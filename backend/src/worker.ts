import pino from 'pino';
import { setTimeout } from 'node:timers/promises';
import { readConfig } from './config.js';
import { database } from './infrastructure/database.js';
import { razorpay, resend } from './infrastructure/providers.js';
import { BookingService } from './application/booking-service.js';
import { WorkerService } from './application/worker-service.js';
const config = readConfig(), db = database(config), logger = pino();
const worker = new WorkerService(new BookingService(db, config, razorpay(config)), resend(config));
let stopping = false, nextReconcile = 0;
process.on('SIGINT', () => { stopping = true; }); process.on('SIGTERM', () => { stopping = true; });
logger.info('Booking worker ready');
try {
  while (!stopping) {
    try {
      if (Date.now() > nextReconcile) { await worker.reconcile(); nextReconcile = Date.now() + 60000; }
      await worker.runJob();
    } catch (error) { logger.error({ errorType: error instanceof Error ? error.name : 'unknown' }, 'Worker cycle failed'); }
    // Bound provider request rate and allow prompt shutdown.
    if (!stopping) await setTimeout(1000);
  }
} finally { await db.end(); }
