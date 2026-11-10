# Vedā

A bespoke Vedic astrology consultation website, built with React, TypeScript, Vinext (Next.js-compatible), and custom SVG artwork.

## Local development

```sh
npm install
npm run dev
```

Validation: `npx tsc --noEmit`. Production build: `npm run build`.

## Included

- Responsive lime, ink, and ivory editorial homepage.
- Original twelve-house kundli hero, observatory illustration, and journal artwork.
- Eight sample services priced at ₹200–₹499. No public astrologer profiles.
- Four-step booking preview with an Asia/Kolkata calendar, sample slots, conditional birth details, and React Hook Form / Zod validation.
- Demonstrations of successful, failed, pending, and cancelled checkout.
- Clearly marked demo confirmation and tentative `.ics` calendar download.
- Interactive Rashi reference, journal articles, FAQ, and preview privacy/terms notices.
- Keyboard-accessible native dialogs, visible focus styles, reduced-motion support.

## Content

Edit service descriptions and prices in `lib/content.ts`. Vedā is a provisional brand name, not a verified registered trademark. No invented practitioner credentials, testimonials, or ratings are used.

Rashi names were checked against Drik Panchang: https://www.drikpanchang.com/astrology/prediction/info/find-rashi-with-name.html. The artwork is an interpretive reference, not a personal chart calculation. Typography is loaded from Google Fonts with serif and sans-serif fallbacks.

## Before accepting real bookings

The current release is an explicit demo. It does not collect payments, persist details, send email, calculate personal charts, or reserve real appointments. Form data exists only in page memory and is discarded when the dialog closes.

Live operation requires the business identity, support details, final policies, actual consultation delivery arrangements and schedules, and a Razorpay account. Implement server-side order creation with authoritative service prices, signature and webhook verification, idempotent payment processing, expiring slot holds, and transactional scheduling to avoid double bookings. Only verified captured payments may confirm bookings. Add authenticated cancellation/rescheduling, refunds, receipts and joining-link notifications. Keep provider secrets on the server, and implement appropriate data access, retention and deletion controls before storing personal information.

## Verification

TypeScript and production build checks pass. Browser checks covered the desktop homepage, mobile overflow, booking form validation, checkout states and confirmation. Sample availability is deliberately illustrative.
