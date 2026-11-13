import type { Config } from '../config.js';
import type { PaymentGateway, MailGateway, Payment, Refund } from '../domain/ports.js';

async function request<T>(url: string, init: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(12000) });
  if (!response.ok) throw new Error(`Provider request failed (HTTP ${response.status}).`);
  return await response.json() as T;
}
export function razorpay(config: Config): PaymentGateway {
  const headers = { Authorization: 'Basic ' + Buffer.from(`${config.RAZORPAY_KEY_ID}:${config.RAZORPAY_KEY_SECRET}`).toString('base64'), 'Content-Type': 'application/json' };
  const call = <T>(path: string, body?: object, extra = {}) => request<T>('https://api.razorpay.com/v1' + path, {
    method: body ? 'POST' : 'GET', headers: { ...headers, ...extra }, body: body ? JSON.stringify(body) : undefined,
  });
  return {
    createOrder: (amount, receipt) => call('/orders', { amount, currency: 'INR', receipt, partial_payment: false }),
    payment: id => call<Payment>('/payments/' + encodeURIComponent(id)),
    orderPayments: async id => (await call<{ items: Payment[] }>('/orders/' + encodeURIComponent(id) + '/payments')).items,
    refund: (paymentId, amount, key) => call<Refund>('/payments/' + encodeURIComponent(paymentId) + '/refund',
      { amount, speed: 'normal', receipt: key }, { 'X-Refund-Idempotency': key }),
    refundStatus: id => call<Refund>('/refunds/' + encodeURIComponent(id)),
  };
}
export function resend(config: Config): MailGateway {
  const headers = { Authorization: `Bearer ${config.RESEND_API_KEY}`, 'Content-Type': 'application/json' };
  return {
    send: (message, key) => request('https://api.resend.com/emails', {
      method: 'POST', headers: { ...headers, 'Idempotency-Key': key }, body: JSON.stringify(message),
    }),
    status: async id => (await request<{ last_event: string }>('https://api.resend.com/emails/' + encodeURIComponent(id), { headers })).last_event,
  };
}
