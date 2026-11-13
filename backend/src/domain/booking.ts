import { z } from 'zod';
import type { Config } from '../config.js';

export const catalog = [
  { id: 'birth-chart', name: 'Birth Chart Reading', hindi: 'जन्म कुंडली का विश्लेषण', duration: 30, amount: 49900, birth: true },
  { id: 'career', name: 'Career & Purpose', hindi: 'करियर और जीवन की दिशा', duration: 25, amount: 39900, birth: true },
  { id: 'compatibility', name: 'Marriage & Compatibility', hindi: 'विवाह और अनुकूलता', duration: 30, amount: 49900, birth: true },
  { id: 'relationships', name: 'Relationships & Life', hindi: 'रिश्ते और निजी जीवन', duration: 20, amount: 29900, birth: true },
  { id: 'vastu', name: 'Vastu Consultation', hindi: 'वास्तु परामर्श', duration: 30, amount: 49900, birth: false },
  { id: 'muhurat', name: 'Muhurat Selection', hindi: 'मुहूर्त चयन', duration: 15, amount: 24900, birth: true },
  { id: 'planetary', name: 'Planetary Guidance', hindi: 'ग्रह दशा परामर्श', duration: 20, amount: 29900, birth: true },
  { id: 'clarity', name: 'A Little Clarity', hindi: 'एक सवाल पर परामर्श', duration: 15, amount: 20000, birth: false },
] as const;
export class AppError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}
export function indiaDate(now = new Date()) { return new Date(now.getTime() + 330 * 60000).toISOString().slice(0, 10); }
export const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v => {
  const d = new Date(v + 'T00:00:00Z');
  return Number.isFinite(+d) && d.toISOString().slice(0, 10) === v;
}, 'Invalid date.');
export const timeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
export const bookingSchema = z.object({
  serviceId: z.string(), date: dateSchema, time: timeSchema,
  language: z.enum(['en', 'hi']), name: z.string().trim().min(2).max(100),
  email: z.string().trim().email().max(254).transform(v => v.toLowerCase()),
  dob: z.union([dateSchema, z.literal('')]).optional(), tob: z.union([timeSchema, z.literal('')]).optional(),
  place: z.string().trim().max(150).optional(), unknown: z.boolean().default(false),
  notes: z.string().trim().max(1000).default(''), consent: z.literal(true),
}).strict();
export type BookingInput = z.infer<typeof bookingSchema>;
export function serviceById(id: string) {
  const service = catalog.find(s => s.id === id);
  if (!service) throw new AppError(400, 'INVALID_SERVICE', 'Choose a valid consultation.');
  return service;
}
export function validateDetails(input: BookingInput, now = new Date()) {
  const service = serviceById(input.serviceId);
  if (service.birth && (!input.dob || input.dob < '1900-01-01' || input.dob > indiaDate(now) || !input.place || input.place.length < 2 || (!input.unknown && !input.tob))) {
    throw new AppError(400, 'BIRTH_DETAILS_REQUIRED', 'Check your birth date, time and place.');
  }
  return service;
}
export function timesForDate(date: string, config: Config, now = new Date()): string[] {
  if (!dateSchema.safeParse(date).success) return [];
  const max = indiaDate(new Date(+now + config.BOOKING_DAYS_AHEAD * 86400000));
  if (date <= indiaDate(now) || date > max || !config.SCHEDULE_DAYS.split(',').includes(String(new Date(date + 'T12:00:00Z').getUTCDay()))) return [];
  return Array.from({ length: (config.SCHEDULE_END_HOUR - config.SCHEDULE_START_HOUR) * 2 }, (_, i) =>
    `${String(config.SCHEDULE_START_HOUR + Math.floor(i / 2)).padStart(2, '0')}:${i % 2 ? '30' : '00'}`);
}
export function slotStart(date: string, time: string, config: Config, now = new Date()) {
  if (!timesForDate(date, config, now).includes(time)) throw new AppError(400, 'INVALID_SLOT', 'Choose an available future appointment time.');
  return new Date(`${date}T${time}:00+05:30`);
}
