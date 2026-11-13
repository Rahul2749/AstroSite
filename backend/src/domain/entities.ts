export interface Appointment {
  id: string; token_hash: string; request_hash: string; service_id: string; service_name: string;
  amount: number; duration: number; starts_at: Date; language: 'en' | 'hi'; payment_mode: 'test' | 'live';
  name: string; email: string; details: { dob?: string; tob?: string; place?: string; unknown?: boolean; notes?: string };
  status: 'pending' | 'expired' | 'confirmed' | 'completed' | 'no_show' | 'cancelled';
  payment_status: 'unpaid' | 'captured' | 'refund_pending' | 'refunded' | 'refund_failed';
  hold_until: Date; order_id: string | null; payment_id: string | null; refund_id: string | null;
  join_url: string | null; admin_note: string; version: number; created_at: Date; updated_at: Date;
}
