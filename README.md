# Vedā — Astrology consultations

English and Hindi astrology website with Razorpay appointment booking, Resend notifications, and a private administrator panel. Consultations are priced from ₹200 to ₹499. No public astrologer profiles are shown.

## Stack

- React 19, TypeScript, Next.js-compatible Vinext development, standard Next.js standalone build for VPS hosting
- Express 5 and PostgreSQL 16
- Razorpay test/live payment verification, signed webhooks, expiring slot holds and refunds
- Resend transactional email outbox with retries and delivery tracking
- Docker Compose and Nginx

## Get started

Requires Node.js 22.13+ and PostgreSQL 16.

```sh
npm ci
cd backend
npm ci
cp .env.example .env
# Configure the local database and integration settings in .env.
npm run migrate
npm run admin:create -- your-admin-email@example.com
npm run dev
```

In separate terminals, run `npm run worker:dev` from `backend/` and `npm run dev` from the repository root. The website runs at `http://127.0.0.1:5173` and proxies API calls to port 5100. Admin login is at `/admin`.

Checkout defaults to disabled. Fill provider credentials and notification settings before enabling it. No API keys, database credentials, or default administrator account are included in this repository.

## Deployment

For the initial test deployment without a domain, follow **[IP-and-port deployment steps](deploy/IP_TEST_DEPLOYMENT.md)**. The website uses port 8080, while admin access uses a private SSH tunnel. Test mode is mandatory for this HTTP setup.

For the later HTTPS deployment, follow [VPS deployment preparation](deploy/README.md). Run all server commands yourself in a separate `/opt/veda` checkout.

## Commands

| Location | Command | Purpose |
| --- | --- | --- |
| Root | `npm run dev` | Local frontend |
| Root | `npm run build:vps` | Next.js standalone production build |
| Root | `npm run build` | Vinext build |
| Backend | `npm run dev` | Express development API |
| Backend | `npm run worker:dev` | Email, payment and refund jobs |
| Backend | `npm run migrate` | Apply versioned SQL migrations |
| Backend | `npm run admin:create -- EMAIL` | Create/update an admin using a hidden password prompt |
| Backend | `npm test` | Integration tests using a dedicated PostgreSQL database ending in `_test` |
| Backend | `npm run build` | Compile the backend |

## Documentation

- [Backend setup, architecture and API](backend/README.md)
- [IP-and-port test deployment](deploy/IP_TEST_DEPLOYMENT.md)
- [HTTPS VPS deployment](deploy/README.md)
- [Design and project notes](PROJECT.md)
- [Original Sites starter documentation](docs/SITES_STARTER.md)

## Launch status

The implementation is prepared for test deployment. Actual Razorpay checkout/webhook and Resend delivery must be verified with your accounts before live use. Use sample personal details during HTTP testing. Configure business/support details, final policies, retention procedures and backups before opening live bookings.
