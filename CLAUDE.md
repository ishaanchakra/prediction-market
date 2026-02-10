# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

- `npm run dev` — Start dev server (uses Webpack, required for Tailwind/PostCSS in Next.js 16)
- `npm run build` — Production build
- `npm run lint` — ESLint (flat config with next/core-web-vitals)
- `node scripts/reset-database.js` — Reset Firestore: deletes all markets/bets/notifications, resets user rep to 500 (requires `serviceAccountKey.json`, interactive confirmation)

## Architecture

**Next.js 16 App Router** with Firebase (Firestore + Google Auth). All pages are client-side (`'use client'`). No API routes — all Firestore reads/writes happen directly from the browser.

### Key directories
- `lib/firebase.js` — Firebase client init, auth config. Google Auth restricted to `@cornell.edu` emails via `hd` parameter.
- `utils/lmsr.js` — LMSR (Logarithmic Market Scoring Rule) with `calculateBet()`, `calculateSell()`, and `getPrice()`. Uses log-sum-exp trick for numerical stability.
- `app/admin/page.js` — Admin panel for creating/resolving markets. Access gated by hardcoded `ADMIN_EMAILS` array.
- `app/market/[id]/page.js` — Main trading page with buy/sell, probability chart (recharts AreaChart), liquidity pie chart, and activity feed.

### Firestore collections
- `markets` — `{ question, probability, outstandingShares: { yes, no }, b, resolution, resolvedAt, createdAt }`
- `bets` — `{ userId, marketId, side, amount, shares, probability, timestamp, type: 'BUY'|'SELL' }`
- `users` — `{ email, weeklyRep, lifetimeRep }`
- `notifications` — `{ userId, type, marketId, marketQuestion, amount, resolution, read, createdAt }`

### Trading mechanics
Uses LMSR (Logarithmic Market Scoring Rule). Cost function: C(q) = b * ln(e^(q_yes/b) + e^(q_no/b)). Price of YES = e^(q_yes/b) / (e^(q_yes/b) + e^(q_no/b)). The `b` parameter (default 100) controls liquidity depth — higher b means less price impact per trade. On market resolution, winning side receives shares as rep payout; losing side gets nothing.

### Brand colors (Tailwind)
Custom `brand-red` (#DC2626), `brand-darkred` (#991B1B), `brand-pink` (#EC4899), `brand-lightpink` (#F9A8D4) defined in `tailwind.config.js`.

### Environment variables
Firebase config uses `NEXT_PUBLIC_FIREBASE_*` env vars (API_KEY, AUTH_DOMAIN, PROJECT_ID, STORAGE_BUCKET, MESSAGING_SENDER_ID, APP_ID). The reset script uses `serviceAccountKey.json` (firebase-admin).
