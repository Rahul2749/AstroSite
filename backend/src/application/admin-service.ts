import { z } from 'zod';
import type { Config } from '../config.js';
import { AppError, dateSchema, timeSchema, slotStart } from '../domain/booking.js';
import { transaction, scheduleLock, type Db } from '../infrastructure/database.js';
import { notify, queueRefund } from './notifications.js';

export const actionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('reschedule'), date: dateSchema, time: timeSchema, version: z.number().int().min(0) }),
  z.object({ action: z.literal('cancel'), reason: z.string().trim().min(3).max(500), version: z.number().int().min(0) }),
  z.object({ action: z.enum(['completed', 'no_show']), version: z.number().int().min(0) }),
  z.object({ action: z.literal('details'), joinUrl: z.union([z.literal(''), z.string().url().max(2000).refine(v => v.startsWith('https://'), 'Use an HTTPS meeting link.')]), note: z.string().max(2000), version: z.number().int().min(0) }),
]);
export class AdminService {
  constructor(readonly db: Db, readonly config: Config) {}

  async list(search: string, status: string, page: number) {
    const conditions = `($1='' OR name ILIKE $1 OR email ILIKE $1 OR id::text ILIKE $1) AND ($2='' OR status=$2)`;
    const params = [search ? '%' + search.replace(/[\\%_]/g, '\\$&') + '%' : '', status];
    const [appointments, count, stats] = await Promise.all([
      this.db.query(`SELECT id,name,email,service_name,starts_at,status,payment_status,payment_mode,amount,version FROM appointments WHERE ${conditions} ORDER BY starts_at DESC,id LIMIT 25 OFFSET $3`, [...params, (page - 1) * 25]),
      this.db.query(`SELECT count(*)::int AS total FROM appointments WHERE ${conditions}`, params),
      this.db.query(`SELECT count(*) FILTER(WHERE status='confirmed' AND starts_at >= now())::int AS upcoming,
        count(*) FILTER(WHERE payment_status IN ('refund_pending','refund_failed'))::int AS refunds,
        (SELECT count(*)::int FROM jobs WHERE status='failed') AS failed_jobs FROM appointments`),
    ]);
    return { appointments: appointments.rows, total: count.rows[0].total, page, stats: stats.rows[0] };
  }
  async detail(id: string) {
    const a = (await this.db.query(`SELECT id,service_id,service_name,amount,duration,starts_at,language,name,email,details,status,payment_status,payment_mode,order_id,payment_id,refund_id,join_url,admin_note,version,created_at,consent_at FROM appointments WHERE id=$1`, [id])).rows[0];
    if (!a) throw new AppError(404, 'NOT_FOUND', 'Appointment not found.');
    const [jobs, audit] = await Promise.all([
      this.db.query("SELECT id,kind,status,attempts,provider_id,delivery_status,error,created_at,payload->>'to' AS recipient FROM jobs WHERE appointment_id=$1 ORDER BY created_at DESC", [id]),
      this.db.query('SELECT action,data,created_at FROM audit_log WHERE appointment_id=$1 ORDER BY created_at DESC LIMIT 50', [id]),
    ]);
    return { ...a, jobs: jobs.rows, audit: audit.rows };
  }
  async action(id: string, adminId: string, input: z.infer<typeof actionSchema>) {
    await transaction(this.db, async tx => {
      await scheduleLock(tx);
      const a = (await tx.query('SELECT * FROM appointments WHERE id=$1 FOR UPDATE', [id])).rows[0];
      if (!a) throw new AppError(404, 'NOT_FOUND', 'Appointment not found.');
      if (a.version !== input.version) throw new AppError(409, 'STALE_VERSION', 'Appointment changed. Refresh its details before trying again.');
      if (a.status !== 'confirmed') throw new AppError(409, 'INVALID_STATE', 'Only confirmed appointments can be changed.');
      let event = '';
      let auditData: object = {};
      if (input.action === 'reschedule') {
        const start = slotStart(input.date, input.time, this.config);
        if (+start === +new Date(a.starts_at)) throw new AppError(400, 'SAME_SLOT', 'Choose a different time.');
        if (new Date(a.starts_at) <= new Date()) throw new AppError(409, 'INVALID_STATE', 'A past appointment cannot be rescheduled.');
        if ((await tx.query("SELECT id FROM appointments WHERE starts_at=$1 AND id<>$2 AND status IN ('pending','confirmed')", [start, id])).rowCount) throw new AppError(409, 'SLOT_TAKEN', 'That time is unavailable.');
        await tx.query('UPDATE appointments SET starts_at=$2 WHERE id=$1', [id, start]);
        event = 'rescheduled'; auditData = { previous: a.starts_at, next: start };
      } else if (input.action === 'cancel') {
        await tx.query("UPDATE appointments SET status='cancelled',payment_status='refund_pending' WHERE id=$1", [id]);
        await queueRefund(tx, a);
        event = 'cancelled'; auditData = { reason: input.reason };
      } else if (input.action === 'details') {
        await tx.query('UPDATE appointments SET join_url=$2,admin_note=$3 WHERE id=$1', [id, input.joinUrl || null, input.note]);
        if (input.joinUrl && input.joinUrl !== a.join_url) event = 'joining';
        auditData = { joiningLinkChanged: input.joinUrl !== (a.join_url || ''), noteChanged: input.note !== a.admin_note };
      } else {
        if (+new Date(a.starts_at) + a.duration * 60000 > Date.now()) throw new AppError(409, 'TOO_EARLY', 'Wait until the appointment has ended.');
        await tx.query('UPDATE appointments SET status=$2 WHERE id=$1', [id, input.action]);
      }
      const updated = (await tx.query('UPDATE appointments SET version=version+1,updated_at=now() WHERE id=$1 RETURNING *', [id])).rows[0];
      if (event) await notify(tx, this.config, updated, event);
      await tx.query('INSERT INTO audit_log(appointment_id,admin_id,action,data) VALUES($1,$2,$3,$4)', [id, adminId, input.action, auditData]);
    });
    return this.detail(id);
  }
}
