import { createInterface } from 'node:readline/promises';
import { Writable } from 'node:stream';
import { readConfig } from '../config.js';
import { database } from '../infrastructure/database.js';
import { createAdmin } from '../http/auth.js';
const email = process.argv[2];
if (!email) throw new Error('Usage: npm run admin:create -- your@email.com');
if (!process.stdin.isTTY) throw new Error('Run this command in an interactive terminal. Password input is hidden.');
const mutedOutput = new Writable({ write(_chunk, _encoding, callback) { callback(); } });
const input = createInterface({ input: process.stdin, output: mutedOutput, terminal: true });
process.stdout.write('New admin password (minimum 14 characters, hidden): ');
const password = await input.question('');
process.stdout.write('\nConfirm password (hidden): ');
const confirm = await input.question('');
input.close();
if (confirm !== password) throw new Error('Passwords do not match.');
const db = database(readConfig());
try { await createAdmin(db, email, password); console.log('\nAdmin saved. Existing sessions for this account were revoked.'); } finally { await db.end(); }
