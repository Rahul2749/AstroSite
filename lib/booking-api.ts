export const serviceIds = ['birth-chart', 'career', 'compatibility', 'relationships', 'vastu', 'muhurat', 'planetary', 'clarity'];
export interface BookingConfig {
  enabled: boolean; mode: 'test' | 'live';
  services: { id: string; name: string; hindi: string; amount: number; duration: number; birth: boolean }[];
  schedule: { days: number[]; startHour: number; endHour: number; daysAhead: number };
  supportEmail: string; privacyUrl: string; termsUrl: string;
}
export interface BookingStatus {
  id: string; status: string; paymentStatus: string; service: string; startsAt: string;
  amount: number; duration: number; joinUrl: string | null; holdUntil: string; mode: 'test' | 'live';
}
export interface CheckoutOrder { id: string; orderId: string; amount: number; currency: string; keyId: string; holdUntil: string; mode: string }
export class ApiError extends Error {
  constructor(public code: string, message: string, public status: number) { super(message); }
}
export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch('/api' + path, { ...options, credentials: 'same-origin', cache: 'no-store',
    signal: options.signal ?? AbortSignal.timeout(20000),
    headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...options.headers } });
  if (response.status === 204) return undefined as T;
  const result = await response.json().catch(() => ({ code: 'UNAVAILABLE', message: 'Booking service is unavailable. Please try again shortly.' }));
  if (!response.ok) {
    const failure = result as { code?: string; message?: string };
    throw new ApiError(failure.code || 'UNAVAILABLE', failure.message || 'Please try again shortly.', response.status);
  }
  return result as T;
}
export function newAccessToken() { return Array.from(crypto.getRandomValues(new Uint8Array(32)), byte => byte.toString(16).padStart(2, '0')).join(''); }
interface RazorpayOptions {
  key: string; amount: number; currency: string; order_id: string; name: string; description: string;
  prefill: { name: string; email: string }; theme: { color: string }; timeout: number;
  handler: (result: { razorpay_payment_id: string; razorpay_signature: string }) => void;
  modal: { ondismiss: () => void };
}
declare global { interface Window { Razorpay?: new (options: RazorpayOptions) => { open(): void; on(name: string, cb: () => void): void } } }
let checkoutScript: Promise<void> | undefined;
export function loadRazorpay() {
  if (window.Razorpay) return Promise.resolve();
  if (!checkoutScript) checkoutScript = new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
    const timer = setTimeout(() => { script.remove(); reject(new Error('Checkout could not load. Please try again.')); }, 15000);
    script.src = 'https://checkout.razorpay.com/v1/checkout.js';
    script.onload = () => { clearTimeout(timer); resolve(); };
    script.onerror = () => { clearTimeout(timer); script.remove(); reject(new Error('Checkout could not load. Please try again.')); };
    document.head.appendChild(script);
  }).catch(error => { checkoutScript = undefined; throw error; });
  return checkoutScript;
}
