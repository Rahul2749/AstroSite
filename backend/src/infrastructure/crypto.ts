import { createHash, createHmac, timingSafeEqual, scrypt, randomBytes } from 'node:crypto';
import { promisify } from 'node:util';
const derive = promisify(scrypt);
export const hash = (value: string) => createHash('sha256').update(value).digest('hex');
export const token = () => randomBytes(32).toString('hex');
export function validSignature(value: string | Buffer, signature: string, secret: string) {
  if (!secret || !/^[a-f0-9]{64}$/i.test(signature)) return false;
  const expected = createHmac('sha256', secret).update(value).digest();
  return timingSafeEqual(expected, Buffer.from(signature, 'hex'));
}
export async function hashPassword(password: string) {
  const salt = randomBytes(16).toString('hex');
  const derived = await derive(password, salt, 64) as Buffer;
  return `scrypt:${salt}:${derived.toString('hex')}`;
}
export async function verifyPassword(password: string, stored: string) {
  const [algorithm, salt, expected] = stored.split(':');
  if (algorithm !== 'scrypt' || !salt || !expected) return false;
  const derived = await derive(password, salt, 64) as Buffer;
  const actual = Buffer.from(expected, 'hex');
  return actual.length === derived.length && timingSafeEqual(actual, derived);
}
