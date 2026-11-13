import { randomUUID } from 'node:crypto';
import type { Config } from '../config.js';
import { AppError, type BookingInput, validateDetails, slotStart, timesForDate } from '../domain/booking.js';
import type { PaymentGateway, Payment } from '../domain/ports.js';
import { transaction, scheduleLock, type Db, type Tx } from '../infrastructure/database.js';
import { hash, validSignature } from '../infrastructure/crypto.js';
import { notify, queueRefund } from './notifications.js';

export class BookingService {
  constructor(readonly db: Db, readonly config: Config, readonly gateway: PaymentGateway) {}

  async availability(date: string) {
    const { rows } = await this.db.query(`SELECT to_char(starts_at AT TIME ZONE 'Asia/Kolkata','HH24:MI') AS time
      FROM appointments WHERE starts_at >= $1::date AT TIME ZONE 'Asia/Kolkata' AND starts_at < ($1::date + 1) AT TIME ZONE 'Asia/Kolkata'
      AND (status='confirmed' OR (status='pending' AND hold_until>now()))`, [date]);
    const busy = new Set(rows.map(r => r.time));
    return timesForDate(date, this.config).map(time => ({ time, available: !busy.has(time) }));
  }

  async create(input: BookingInput, accessToken: string) {
    if (!this.config.BOOKING_ENABLED) throw new AppError(503, 'BOOKING_CLOSED', 'Booking is not open yet. Please check back soon.');
    const service = validateDetails(input);
    const start = slotStart(input.date, input.time, this.config);
    const requestHash = hash(JSON.stringify(input));
    const result = await transaction(this.db, async tx => {
      await scheduleLock(tx);
      const previous = (await tx.query('SELECT * FROM appointments WHERE token_hash=$1', [hash(accessToken)])).rows[0];
      if (previous) {
        if (previous.request_hash !== requestHash) throw new AppError(409, 'REQUEST_CHANGED', 'Details changed. Start a new checkout.');
        if (previous.status !== 'pending') throw new AppError(409, 'CHECKOUT_CLOSED', 'This checkout is closed. Check its payment status before starting again.');
        if (!previous.order_id) throw new AppError(409, 'ORDER_UNCERTAIN', 'Order creation is still being checked. Please wait for the hold to expire before retrying.');
        return { appointment: previous, created: false };
      }
      if ((await tx.query("SELECT id FROM appointments WHERE starts_at=$1 AND status IN ('pending','confirmed')", [start])).rowCount) {
        throw new AppError(409, 'SLOT_TAKEN', 'That time was just booked. Please choose another time.');
      }
      const details = { dob: service.birth ? input.dob : undefined, tob: service.birth && !input.unknown ? input.tob : undefined,
        place: service.birth ? input.place : undefined, unknown: service.birth && input.unknown, notes: input.notes };
      const { rows } = await tx.query(`INSERT INTO appointments(id,token_hash,request_hash,service_id,service_name,amount,duration,starts_at,language,name,email,details,hold_until,payment_mode)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,now()+$13*interval '1 minute',$14) RETURNING *`,
        [randomUUID(), hash(accessToken), requestHash, service.id, input.language === 'hi' ? service.hindi : service.name, service.amount, service.duration, start, input.language, input.name, input.email, details, this.config.HOLD_MINUTES, this.config.PAYMENT_MODE]);
      return { appointment: rows[0], created: true };
    });
    const a = result.appointment;
    if (result.created) {
      try {
        const order = await this.gateway.createOrder(a.amount, a.id);
        await this.db.query("UPDATE appointments SET order_id=$2,order_state='ready',updated_at=now() WHERE id=$1", [a.id, order.id]);
        a.order_id = order.id;
      } catch {
        await this.db.query("UPDATE appointments SET order_state='uncertain',updated_at=now() WHERE id=$1", [a.id]);
        throw new AppError(502, 'ORDER_UNCERTAIN', 'Could not open checkout. No payment has been initiated. Please retry after the slot hold expires.');
      }
    }
    return { id: a.id, orderId: a.order_id, amount: a.amount, currency: 'INR', keyId: this.config.RAZORPAY_KEY_ID, holdUntil: a.hold_until, mode: this.config.PAYMENT_MODE };
  }

  async authorized(id: string, accessToken: string) {
    const a = (await this.db.query('SELECT * FROM appointments WHERE id=$1 AND token_hash=$2', [id, hash(accessToken)])).rows[0];
    if (!a) throw new AppError(404, 'NOT_FOUND', 'Booking not found.');
    return a;
  }

  async status(id: string, accessToken: string) {
    const a = await this.authorized(id, accessToken);
    return { id: a.id, status: a.status === 'pending' && new Date(a.hold_until) <= new Date() ? 'expired' : a.status,
      paymentStatus: a.payment_status, service: a.service_name, startsAt: a.starts_at, amount: a.amount, duration: a.duration,
      joinUrl: a.join_url, holdUntil: a.hold_until, mode: a.payment_mode };
  }

  async verify(id: string, accessToken: string, paymentId: string, signature: string) {
    const a = await this.authorized(id, accessToken);
    if (a.payment_mode !== this.config.PAYMENT_MODE) throw new AppError(409, 'PAYMENT_MODE', 'This checkout belongs to a different payment environment.');
    if (!a.order_id || !validSignature(`${a.order_id}|${paymentId}`, signature, this.config.RAZORPAY_KEY_SECRET)) {
      throw new AppError(400, 'INVALID_SIGNATURE', 'Payment signature could not be verified.');
    }
    const payment = await this.gateway.payment(paymentId);
    if (payment.id !== paymentId || payment.order_id !== a.order_id) throw new AppError(409, 'PAYMENT_MISMATCH', 'Payment did not match this order.');
    await this.capture(payment);
    return this.status(id, accessToken);
  }

  async capture(payment: Payment, tx?: Tx) {
    if (payment.status !== 'captured') return;
    const run = async (client: Tx) => {
      await scheduleLock(client);
      const a = (await client.query('SELECT * FROM appointments WHERE order_id=$1 FOR UPDATE', [payment.order_id])).rows[0];
      if (!a) return;
      if (a.payment_mode !== this.config.PAYMENT_MODE) return;
      if (payment.amount !== a.amount || payment.currency !== 'INR') throw new AppError(409, 'PAYMENT_MISMATCH', 'Payment amount or currency did not match.');
      if (a.payment_id) {
        if (a.payment_id !== payment.id) throw new AppError(409, 'PAYMENT_MISMATCH', 'A different payment is already recorded.');
        return;
      }
      // An expired hold is never silently rebooked after another client may have selected it.
      const confirmed = a.status === 'pending' && new Date(a.hold_until) > new Date();
      const { rows } = await client.query(`UPDATE appointments SET payment_id=$2,payment_status=$3,status=$4,version=version+1,updated_at=now() WHERE id=$1 RETURNING *`,
        [a.id, payment.id, confirmed ? 'captured' : 'refund_pending', confirmed ? 'confirmed' : 'cancelled']);
      await notify(client, this.config, rows[0], confirmed ? 'confirmed' : 'late_payment');
      if (!confirmed) await queueRefund(client, rows[0]);
      await client.query('INSERT INTO audit_log(appointment_id,action) VALUES($1,$2)', [a.id, confirmed ? 'payment_confirmed' : 'late_payment_refund']);
    };
    if (tx) await run(tx); else await transaction(this.db, run);
  }

  async webhook(eventId: string, body: Buffer, signature: string) {
    if (!validSignature(body, signature, this.config.RAZORPAY_WEBHOOK_SECRET)) throw new AppError(400, 'INVALID_SIGNATURE', 'Invalid webhook signature.');
    let event: any;
    try { event = JSON.parse(body.toString('utf8')); } catch { throw new AppError(400, 'INVALID_WEBHOOK', 'Invalid webhook payload.'); }
    await transaction(this.db, async tx => {
      if (!(await tx.query('INSERT INTO webhook_events(id) VALUES($1) ON CONFLICT DO NOTHING RETURNING id', [eventId])).rowCount) return;
      if (event.event === 'payment.captured' || event.event === 'order.paid') {
        const p = event.payload?.payment?.entity;
        if (!p || typeof p.id !== 'string' || typeof p.order_id !== 'string' || !Number.isInteger(p.amount)) throw new AppError(400, 'INVALID_WEBHOOK', 'Payment entity is missing.');
        await this.capture(p, tx);
      }
      if (event.event === 'refund.processed' || event.event === 'refund.failed') {
        const r = event.payload?.refund?.entity;
        if (r && typeof r.payment_id === 'string') await this.recordRefund(tx, r);
      }
    });
  }

  async recordRefund(tx: Tx, refund: { id: string; payment_id: string; amount: number; status: string }) {
    const a = (await tx.query('SELECT * FROM appointments WHERE payment_id=$1 FOR UPDATE', [refund.payment_id])).rows[0];
    if (!a || a.amount !== refund.amount || a.payment_status === 'refunded' || !['refund_pending','refund_failed'].includes(a.payment_status)) return;
    const status = refund.status === 'processed' ? 'refunded' : refund.status === 'failed' ? 'refund_failed' : 'refund_pending';
    const { rows } = await tx.query('UPDATE appointments SET refund_id=$2,payment_status=$3,updated_at=now() WHERE id=$1 RETURNING *', [a.id, refund.id, status]);
    if (status !== a.payment_status && status !== 'refund_pending') await notify(tx, this.config, rows[0], status);
  }
}
