# Vedā booking API

Express 5 + TypeScript + PostgreSQL. Razorpay handles payments and refunds. Resend handles transactional emails. The API and background worker run as separate Node processes. No real credentials are included, and booking defaults to disabled.

## Local setup

Requires Node 22.13+ and PostgreSQL 16. The frontend uses `http://127.0.0.1:5173` and proxies `/api/` to port 5100. Use that exact origin for cookie login. Do not mix `localhost` and `127.0.0.1`.

```powershell
# Optional isolated local PostgreSQL. Development credentials only.
docker run --name veda-postgres-dev -e POSTGRES_DB=veda -e POSTGRES_USER=veda -e POSTGRES_PASSWORD=local-development-only -p 127.0.0.1:5438:5432 -v veda_local_postgres:/var/lib/postgresql/data -d postgres:16-alpine

Set-Location C:\Github\Astrology\veda\backend
npm ci
Copy-Item .env.example .env
npm run migrate
npm run admin:create -- your-admin-email@example.com
npm run dev
```

The admin command prompts for a password without echoing it. Minimum length is 14 characters. Running it for an existing email changes that password and revokes its sessions. There is no default admin or public registration endpoint.

In two additional terminals:

```powershell
Set-Location C:\Github\Astrology\veda\backend
npm run worker:dev
```

```powershell
Set-Location C:\Github\Astrology\veda
npm run dev -- --host 127.0.0.1
```

Open `/admin` to sign in. An admin account is required to view any appointment data. The site works with checkout disabled until integrations are configured.

## Configuration

Copy the environment template locally. Store production secrets only on the VPS. Do not commit `.env` or `docker.env`, or put provider secrets in `NEXT_PUBLIC_*` variables.

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | Dedicated PostgreSQL database |
| `APP_ORIGIN` | Exact browser origin, no trailing slash. HTTPS in production |
| `ADMIN_ORIGIN` | Optional separate exact origin for admin requests, defaults to APP_ORIGIN |
| `ALLOW_HTTP_TESTING` | Explicit test-only IP/HTTP exception, requires test mode and loopback ADMIN_ORIGIN; see deploy/IP_TEST_DEPLOYMENT.md |
| `BOOKING_ENABLED` | Defaults to false. Enabling requires payment and email credentials |
| `PAYMENT_MODE` | `test` or `live`, must match Razorpay key prefix |
| `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET` | Credentials for the selected mode |
| `RAZORPAY_WEBHOOK_SECRET` | Separate webhook signing secret |
| `RESEND_API_KEY`, `EMAIL_FROM` | Sending key and address on a verified Resend domain |
| `BOOKING_NOTIFY_EMAIL` | Owner inbox, to be supplied by Rahul |
| `SUPPORT_EMAIL` | Client support address, required for live checkout |
| `PRIVACY_URL`, `TERMS_URL` | Published HTTPS policies, required for live checkout |
| `TRUST_PROXY_HOPS` | 0 locally, 1 for the documented direct Nginx proxy |
| `SCHEDULE_DAYS` | JS weekdays, default `1,2,3,4,5,6` |
| `SCHEDULE_START_HOUR`, `SCHEDULE_END_HOUR` | Default 9–18 IST, last slot 17:30 |
| `HOLD_MINUTES` | Temporary checkout hold, default 15 minutes |
| `BOOKING_DAYS_AHEAD` | Tomorrow through the next 90 days by default |
| `DB_POOL_SIZE` | Max connections per process, default 10 |

Use a separate test and live database/deployment. Each appointment records its payment mode. Refunds and reconciliation do not cross payment environments. Finish test refunds before switching environments.

## Structure

```text
src/domain/          Schedule, catalog, validation, entities, provider interfaces
src/application/     Booking/payment lifecycle, admin actions, transactional outbox
src/infrastructure/  PostgreSQL transactions, crypto, Razorpay/Resend adapters
src/http/            Express routes, cookie sessions, CSRF, rate limits, errors
src/scripts/         Versioned SQL migration runner and admin provisioning
src/server.ts        API composition and graceful shutdown
src/worker.ts        Durable jobs, payment/refund reconciliation, email status
migrations/          Append-only SQL migrations
tests/               PostgreSQL-backed integration tests with provider doubles
```

Service prices live in `src/domain/booking.ts`, in paise. The client submits a stable service ID, never a trusted price. Update homepage marketing prices in `../lib/content.ts` alongside catalog changes. Checkout reads its authoritative prices from the API.

## Payment and scheduling behavior

1. Client fetches current availability. All times are Asia/Kolkata. One private consultation resource is used, with non-overlapping 30-minute slots for sessions lasting up to 30 minutes.
2. The validated order request creates a short slot hold and snapshots the price. A partial unique index and a transaction-level scheduling lock prevent simultaneous reservations. Gateway network calls occur outside scheduling transactions.
3. A random 256-bit client token is both the idempotency key and the private booking access token. Only its SHA-256 hash is stored. Retrying an identical request reuses its order. Changes require a fresh key. Network ambiguity during order creation does not blindly create another provider order. The uncertain hold expires naturally.
4. Razorpay Checkout runs with the server order. The browser signature is checked against the stored order ID. The API fetches the payment and validates its order, currency, amount and captured state. Authorized-only payments never confirm a booking.
5. Signed raw-body webhooks provide independent confirmation. Event IDs and appointment transitions are idempotent. Notifications are committed with the appointment in the same transaction.
6. The worker polls unpaid orders for up to seven days to recover missed webhooks or closed browsers. A payment captured after a hold expires queues a full refund instead of creating a conflicting appointment.
7. Admin cancellation immediately frees the slot and queues a full refund. A stable `X-Refund-Idempotency` key prevents duplicate refund requests. Refund status is reconciled by polling and webhooks.

Configure auto-capture in the Razorpay dashboard. Subscribe to `payment.captured`, `order.paid`, `refund.processed`, and `refund.failed` at:

```text
https://YOUR_DOMAIN/api/webhooks/razorpay
```

The webhook secret is separate from the API key secret. Both callback and webhook verification are required. Never disable signature checks to test a webhook.

## Notifications and recovery

Client and owner messages are separate jobs with immutable payloads. Emails follow confirmation, rescheduling, cancellation, refund outcome, and meeting-link changes. Clients receive English or Hindi according to their booking language. Birth details and private notes are excluded from emails. The admin panel shows recipient, processing status and provider delivery status.

Jobs use `FOR UPDATE SKIP LOCKED`, leases, exponential retries and stable provider idempotency keys. There are eight automatic attempts. Resend retries stop before its 24-hour key-retention window ends. `accepted` does not mean delivered; the worker checks provider delivery state for seven days.

Failed jobs stay visible for operator review. For a failed or ambiguous refund, check the original payment/refund in Razorpay before intervention. Do not create another refund key. For an email beyond the retry window, inspect Resend delivery before any manual resend. The UI intentionally does not offer a blind resend/refund button.

Worker must remain running even when `BOOKING_ENABLED=false`: closing new bookings must not stop outstanding notifications or refunds. Watch worker logs, failed jobs, unpaid orders and refunds. The public health endpoint checks API/database health, not worker or provider health.

## Admin access

12-hour opaque server sessions, hashed tokens, HttpOnly SameSite=Strict cookies, Secure in production. State changes require exact Origin and a session CSRF token. Login and public booking endpoints use database-backed throttling. All mutations use optimistic version checks and an audit log. Completed/no-show actions require that the appointment has ended.

Administrator actions are reschedule, cancel with full refund, mark completed/no-show, and update private notes/HTTPS meeting links. An updated meeting link is emailed to the client and owner. There is no public astrologer profile or client account system.

## API

| Method / path | Access and behavior |
| --- | --- |
| `GET /api/health` | API/database readiness |
| `GET /api/booking/config` | Public catalog, mode, schedule, policy links |
| `GET /api/availability?date=YYYY-MM-DD` | Public available/unavailable slots |
| `POST /api/bookings` | Origin + `Idempotency-Key`, validated client details |
| `GET /api/bookings/:id` | `Authorization: Bearer <booking token>`, minimal receipt |
| `POST /api/bookings/:id/verify` | Booking token + payment ID and signature |
| `POST /api/webhooks/razorpay` | Raw body + Razorpay signature and event ID |
| `POST /api/admin/login` | Email/password, Origin, rate limit |
| `GET /api/admin/me` | Admin session, returns session CSRF token |
| `POST /api/admin/logout` | Admin session + CSRF |
| `GET /api/admin/appointments?q=&status=&page=1` | Admin, 25 rows per page |
| `GET /api/admin/appointments/:id` | Admin, details, jobs, recent activity |
| `POST /api/admin/appointments/:id/actions` | Admin + CSRF + expected `version` |

## Validation

```powershell
docker exec veda-postgres-dev createdb -U veda veda_test
npm test
npm run build
npm audit
```

Tests default to the isolated local `veda_test` database. Override with `TEST_DATABASE_URL`, whose database name must end in `_test`. Tests truncate only that dedicated database. External payment/email providers are injected doubles, so tests do not send email or transfer money.

Actual Razorpay test-mode checkout, public webhook delivery, and Resend delivery still require account credentials and a verified sender. Before live mode, publish business/support details, the actual consultation arrangements and policies, define retention/deletion procedures for client records, and validate backups and restoration. Data is persisted in PostgreSQL; apply disk/backup encryption and limited server access in deployment.

Provider references: [Razorpay integration](https://razorpay.com/docs/payments/server-integration/nodejs/integration-steps/), [webhook verification](https://razorpay.com/docs/webhooks/validate-test/), [idempotent refunds](https://github.com/razorpay/markdown-docs/blob/master/api/refunds/normal-refunds-idempotent.md), [Resend idempotency](https://resend.com/docs/dashboard/emails/idempotency-keys).
