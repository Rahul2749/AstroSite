import { randomUUID } from 'node:crypto';
import type { MailGateway } from '../domain/ports.js';
import { transaction } from '../infrastructure/database.js';
import { BookingService } from './booking-service.js';

export class WorkerService {
  constructor(readonly bookings: BookingService, readonly mail: MailGateway) {}
  async runJob(): Promise<boolean> {
    const db = this.bookings.db;
    const lease = randomUUID();
    const { rows } = await db.query(`UPDATE jobs SET status='processing', attempts=attempts+1, lease_id=$1,
      locked_until=now()+interval '2 minutes', first_attempt_at=COALESCE(first_attempt_at,now()),updated_at=now()
      WHERE id=(SELECT id FROM jobs WHERE (status='queued' AND available_at<=now()) OR (status='processing' AND locked_until<now())
      ORDER BY available_at FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING *`, [lease]);
    const job = rows[0];
    if (!job) return false;
    try {
      if (job.kind === 'email') {
        // Resend retains idempotency keys for 24h. Never automatically re-send beyond that window.
        if (+new Date(job.first_attempt_at) < Date.now() - 23 * 3600000) throw new Error('Email retry window expired. Review delivery in Resend before any manual resend.');
        const sent = await this.mail.send(job.payload, job.id);
        await db.query("UPDATE jobs SET status='done',provider_id=$3,delivery_status='accepted',error=NULL,checked_at=now(),updated_at=now() WHERE id=$1 AND lease_id=$2", [job.id, lease, sent.id]);
      } else {
        if (job.payload.mode !== this.bookings.config.PAYMENT_MODE) throw new Error('Payment environment changed. Reconcile this refund using its original Razorpay environment.');
        const refund = await this.bookings.gateway.refund(job.payload.paymentId, job.payload.amount, job.payload.key);
        await transaction(db, async tx => {
          await this.bookings.recordRefund(tx, refund);
          await tx.query("UPDATE jobs SET status='done',provider_id=$3,error=NULL,updated_at=now() WHERE id=$1 AND lease_id=$2", [job.id, lease, refund.id]);
        });
      }
    } catch (error) {
      const exhausted = job.attempts >= 8 || (job.kind === 'email' && +new Date(job.first_attempt_at) < Date.now() - 23 * 3600000);
      await db.query(`UPDATE jobs SET status=$3,error=$4,available_at=now()+$5*interval '1 second',updated_at=now() WHERE id=$1 AND lease_id=$2`,
        [job.id, lease, exhausted ? 'failed' : 'queued', error instanceof Error ? error.message.slice(0, 300) : 'Provider request failed.', Math.min(3600, 30 * 2 ** job.attempts)]);
    }
    return true;
  }

  async reconcile() {
    const { db, gateway } = this.bookings;
    await db.query("UPDATE appointments SET status='expired',updated_at=now() WHERE status='pending' AND hold_until<=now()");
    // Atomic claim keeps multiple workers from polling the same orders simultaneously.
    const { rows } = await db.query(`UPDATE appointments SET reconcile_at=now()+interval '2 minutes' WHERE id IN (
      SELECT id FROM appointments WHERE order_id IS NOT NULL AND payment_status='unpaid' AND reconcile_at<=now()
      AND payment_mode=$1 AND created_at>now()-interval '7 days' ORDER BY reconcile_at FOR UPDATE SKIP LOCKED LIMIT 10) RETURNING order_id`, [this.bookings.config.PAYMENT_MODE]);
    for (const a of rows) {
      try { for (const payment of await gateway.orderPayments(a.order_id)) await this.bookings.capture(payment); }
      catch { /* Retry on the next cycle; never infer failure from a network timeout. */ }
    }
    const refunds = await db.query("SELECT refund_id FROM appointments WHERE payment_status='refund_pending' AND payment_mode=$1 AND refund_id IS NOT NULL LIMIT 20", [this.bookings.config.PAYMENT_MODE]);
    for (const a of refunds.rows) {
      try { const r = await gateway.refundStatus(a.refund_id); await transaction(db, tx => this.bookings.recordRefund(tx, r)); } catch { /* Retry next cycle. */ }
    }
    const messages = await db.query(`UPDATE jobs SET checked_at=now() WHERE id IN (SELECT id FROM jobs WHERE kind='email' AND status='done'
      AND delivery_status NOT IN ('delivered','bounced','failed','complained') AND created_at>now()-interval '7 days'
      AND (checked_at IS NULL OR checked_at<now()-interval '5 minutes') FOR UPDATE SKIP LOCKED LIMIT 10) RETURNING id,provider_id`);
    for (const message of messages.rows) {
      try { await db.query('UPDATE jobs SET delivery_status=$2 WHERE id=$1', [message.id, await this.mail.status(message.provider_id)]); } catch { /* Provider accepted is not proof of inbox delivery. */ }
    }
    await db.query('DELETE FROM admin_sessions WHERE expires_at<now()');
    await db.query('DELETE FROM rate_limits WHERE expires_at<now()');
    await db.query("DELETE FROM webhook_events WHERE received_at<now()-interval '30 days'");
  }
}
