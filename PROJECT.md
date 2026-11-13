# Vedā

A bespoke Vedic astrology consultation website, built with React, TypeScript, Vinext (Next.js-compatible), and custom SVG artwork.

## Local development

```sh
npm install
npm run dev
```

Validation: `npx tsc --noEmit`. Sites build: `npm run build`. VPS standalone build: `npm run build:vps`.

The Express backend lives in `backend/`. Read [backend setup](backend/README.md) for PostgreSQL, provider configuration, the background worker and admin account provisioning. The frontend proxies `/api/` to `127.0.0.1:5100` in development. The admin panel is at `/admin`. Read [VPS preparation](deploy/README.md) for the future Docker/Nginx deployment alongside the existing website.

## Included

- English and Hindi throughout the homepage, booking flow and client email notifications. The selected language is saved in the browser.
- Responsive lime, ink, and ivory editorial homepage.
- Original twelve-house kundli hero, observatory illustration, and journal artwork.
- Eight services priced at ₹200–₹499. No public astrologer profiles.
- Four-step booking with server availability, an Asia/Kolkata calendar, conditional birth details and form validation.
- Express/PostgreSQL booking API, verified Razorpay checkout/webhooks, temporary slot holds, reconciliation and full refunds.
- Transactional email queue with Resend, retry handling and email delivery status.
- Authenticated mobile admin panel for search/filter, appointment details, rescheduling, cancellation/refunds, completed/no-show status, meeting links and private notes.
- Server-confirmed receipts and `.ics` calendar downloads. Test-mode confirmations are clearly labelled.
- Interactive Rashi reference, journal articles, FAQ, and preview privacy/terms notices.
- Keyboard-accessible native dialogs, visible focus styles, reduced-motion support.

## Content

Edit service descriptions and prices in `lib/content.ts`. Vedā is a provisional brand name, not a verified registered trademark. No invented practitioner credentials, testimonials, or ratings are used.

Rashi names were checked against Drik Panchang: https://www.drikpanchang.com/astrology/prediction/info/find-rashi-with-name.html. The artwork is an interpretive reference. English uses Newsreader and Manrope. Hindi uses Noto Serif Devanagari and Hind. The WOFF2 files and their Open Font Licenses are in `public/fonts`.

## Before accepting real bookings

Checkout defaults to disabled. Provider credentials, the owner notification inbox and the verified sender have not been supplied. The implemented integration needs a real Razorpay test-mode and Resend end-to-end check before launch. No provider payments or emails were made during automated tests.

Starting checkout persists contact and consultation details in PostgreSQL. Publish the business identity, support contact, privacy/retention/deletion arrangements and final policies before enabling live mode. The agreed schedule is Monday–Saturday, 09:00–18:00 IST, with 30-minute calendar slots. Client and owner emails are queued after confirmed payment. Meeting links are added by the administrator and emailed separately. The application does not calculate charts or provide video hosting.

## Verification

PostgreSQL integration tests cover concurrent reservations, server pricing, validation, signatures, replayed webhooks, payment capture, late payment refunds, email retries, admin authentication/CSRF, rescheduling conflicts and refund state. Provider adapters are replaced by test doubles in this suite. See `backend/README.md` for commands and remaining provider verification.
