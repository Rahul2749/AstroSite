import { randomUUID } from 'node:crypto';
import type { Config } from '../config.js';
import type { Tx } from '../infrastructure/database.js';
import type { Appointment } from '../domain/entities.js';

export async function notify(tx: Tx, config: Config, appointment: Appointment, event: string) {
  const a = appointment;
  const hi = a.language === 'hi';
  const when = new Date(a.starts_at).toLocaleString(hi ? 'hi-IN' : 'en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'full', timeStyle: 'short' });
  const titles: Record<string, [string, string]> = {
    confirmed: ['Your consultation is confirmed', 'आपका परामर्श तय हो गया है'],
    rescheduled: ['Your consultation has been rescheduled', 'आपके परामर्श का समय बदला गया है'],
    cancelled: ['Your consultation is cancelled — refund requested', 'परामर्श रद्द — रिफ़ंड का अनुरोध किया गया है'],
    refunded: ['Your refund has been processed', 'आपका रिफ़ंड जारी कर दिया गया है'],
    refund_failed: ['Your refund needs assistance', 'आपके रिफ़ंड में सहायता की ज़रूरत है'],
    late_payment: ['Payment received after your slot expired — refund requested', 'समय समाप्त होने के बाद भुगतान मिला — रिफ़ंड का अनुरोध किया गया है'],
    joining: ['Joining details for your consultation', 'परामर्श में जुड़ने का विवरण'],
  };
  const title = titles[event]?.[hi ? 1 : 0] ?? event;
  const testLabel = a.payment_mode === 'test' ? '[TEST] ' : '';
  const text = [
    `${testLabel}${title}`, '',
    `${hi ? 'क्रमांक' : 'Reference'}: ${a.id}`,
    `${hi ? 'परामर्श' : 'Consultation'}: ${a.service_name}`,
    `${hi ? 'दिन और समय' : 'When'}: ${when} IST`,
    `${hi ? 'शुल्क' : 'Amount'}: INR ${(a.amount / 100).toFixed(2)}`,
    `${hi ? 'स्थिति' : 'Status'}: ${a.status}`,
    a.status === 'confirmed' ? (a.join_url ? `${hi ? 'जुड़ने का लिंक' : 'Join'}: ${a.join_url}` : (hi ? 'जुड़ने का विवरण अलग ईमेल में भेजा जाएगा।' : 'Joining instructions will arrive in a separate email.')) : '',
    ['cancelled', 'late_payment'].includes(event) ? (hi ? 'रिफ़ंड की प्रक्रिया चल रही है। बैंक में राशि आने का समय अलग हो सकता है।' : 'Your full refund is being processed. Bank credit times vary.') : '',
    config.SUPPORT_EMAIL ? `${hi ? 'सहायता' : 'Support'}: ${config.SUPPORT_EMAIL}` : '',
    a.payment_mode === 'test' ? (hi ? 'केवल परीक्षण। यह असली परामर्श की बुकिंग नहीं है।' : 'Test mode only. This is not a real consultation reservation.') : '',
  ].filter(Boolean).join('\n');
  for (const [recipient, to] of [['client', a.email], ['owner', config.BOOKING_NOTIFY_EMAIL]]) {
    if (!to) continue;
    const payload = { from: config.EMAIL_FROM, to, subject: `${testLabel}Vedā · ${title}`, text: recipient === 'owner'
      ? `${text}\n\nClient: ${a.name}\nEmail: ${a.email}\nManage: ${config.APP_ORIGIN}/admin\nBirth information and private notes are available only in the admin panel.` : text };
    await tx.query(`INSERT INTO jobs(id,appointment_id,kind,dedupe_key,payload) VALUES($1,$2,'email',$3,$4) ON CONFLICT(dedupe_key) DO NOTHING`,
      [randomUUID(), a.id, `${a.id}:${event}:${a.version}:${recipient}`, payload]);
  }
}
export async function queueRefund(tx: Tx, appointment: Appointment) {
  await tx.query(`INSERT INTO jobs(id,appointment_id,kind,dedupe_key,payload) VALUES($1,$2,'refund',$3,$4) ON CONFLICT(dedupe_key) DO NOTHING`,
    [randomUUID(), appointment.id, `refund:${appointment.id}`, { paymentId: appointment.payment_id, amount: appointment.amount, key: appointment.id, mode: appointment.payment_mode }]);
}
