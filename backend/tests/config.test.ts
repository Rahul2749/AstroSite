import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readConfig } from '../src/config.js';
const env = { DATABASE_URL: 'postgresql://test:test@127.0.0.1/veda_test', NODE_ENV: 'production',
  APP_ORIGIN: 'http://192.0.2.10:8080', ADMIN_ORIGIN: 'http://127.0.0.1:8081', ALLOW_HTTP_TESTING: 'true', PAYMENT_MODE: 'test' };
test('explicit IP test configuration works with production runtime', () => {
  assert.equal(readConfig(env).ALLOW_HTTP_TESTING, true);
});
test('HTTP testing cannot activate live payments or public admin origins', () => {
  assert.throws(() => readConfig({ ...env, PAYMENT_MODE: 'live' }), /test mode/);
  assert.throws(() => readConfig({ ...env, ADMIN_ORIGIN: 'http://192.0.2.10:8081' }), /loopback/);
  assert.throws(() => readConfig({ ...env, APP_ORIGIN: 'http://example.com:8080' }), /IP origin/);
});
test('normal production retains HTTPS enforcement', () => {
  assert.throws(() => readConfig({ ...env, ALLOW_HTTP_TESTING: 'false' }), /HTTPS/);
  assert.equal(readConfig({ ...env, ALLOW_HTTP_TESTING: 'false', APP_ORIGIN: 'https://example.com', ADMIN_ORIGIN: '' }).ALLOW_HTTP_TESTING, false);
});
