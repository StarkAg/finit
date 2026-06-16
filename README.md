# Vance

Vance is a personal finance and trading journal web app for tracking budgets, stock positions, Groww order screenshots, and ledger balances in one place.

Production: https://finance-record-iota.vercel.app  
Vercel project: `finance-record`

## Features

- Dashboard for budget, trading, and ledger overview
- Swing trading and yearly stock journals
- Manual trade entry for buy/sell positions
- Groww order screenshot import for BUY and SELL orders
- Monthly budget allocation preview
- Six-account ledger with running debit/credit balances
- Phone-optimized UI with bottom navigation
- Premium black/white theme with champagne accent
- Convex-backed live data sync

## Tech Stack

- React 19
- TypeScript
- Vite
- Tailwind CSS
- Convex
- Recharts
- Tesseract.js OCR
- Vercel

## Local Setup

```bash
npm install
cp .env.example .env.local
npm run dev
```

Set `VITE_CONVEX_URL` in `.env.local` before running the app.

## Scripts

```bash
npm run dev
npm run build
npm run lint
npm run preview
```

## Deployment

The app is linked to the existing Vercel project:

```text
projectName: finance-record
production: https://finance-record-iota.vercel.app
```

The project can be deployed from this repo using Vercel’s standard install/build flow.
