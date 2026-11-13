export interface Payment {
  id: string; order_id: string; amount: number; currency: string; status: string;
  amount_refunded?: number;
}
export interface Refund { id: string; payment_id: string; amount: number; status: string }
export interface PaymentGateway {
  createOrder(amount: number, receipt: string): Promise<{ id: string }>;
  payment(id: string): Promise<Payment>;
  orderPayments(orderId: string): Promise<Payment[]>;
  refund(paymentId: string, amount: number, key: string): Promise<Refund>;
  refundStatus(id: string): Promise<Refund>;
}
export interface MailMessage { from: string; to: string; subject: string; text: string }
export interface MailGateway {
  send(message: MailMessage, key: string): Promise<{ id: string }>;
  status(id: string): Promise<string>;
}
