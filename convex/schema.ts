import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

// All monetary inputs are stored raw; computed fields (P/L, allocations, running
// balances) are derived on the client in src/lib/calc.ts — exactly mirroring the
// original spreadsheet formulas.
export default defineSchema({
  // Monthly Budget — only the inputs are stored; buckets are auto-allocated.
  budget: defineTable({
    date: v.string(), // ISO yyyy-mm-dd
    cash: v.number(),
    online: v.number(),
    gym: v.number(),
    skill: v.number(),
    extra: v.number(), // extra cash flow into stability
    note: v.optional(v.string()),
  }).index("by_date", ["date"]),

  // Swing Trading journal (short-term trades).
  swing: defineTable({
    buyDate: v.string(),
    sellDate: v.optional(v.string()),
    name: v.optional(v.string()),
    qty: v.number(),
    buyPrice: v.number(),
    sellPrice: v.optional(v.number()),
    currentPrice: v.optional(v.number()),
    charges: v.number(),
    budget: v.optional(v.number()),
    other: v.optional(v.number()),
    feedback: v.optional(v.string()),
  }).index("by_buyDate", ["buyDate"]),

  // Yearly Stock journal (long-term holdings).
  yearly: defineTable({
    buyDate: v.string(),
    sellDate: v.optional(v.string()),
    name: v.optional(v.string()),
    qty: v.number(),
    buyPrice: v.number(),
    sellPrice: v.optional(v.number()),
    currentPrice: v.optional(v.number()),
    charges: v.number(),
    budget: v.optional(v.number()),
    other: v.optional(v.number()),
  }).index("by_buyDate", ["buyDate"]),

  // Snapshot of Groww orders. The Groww API only returns the current trading
  // day's order book, so we persist each sync here to build up full history.
  growwOrders: defineTable({
    growwOrderId: v.string(),
    symbol: v.string(),
    side: v.string(), // BUY | SELL
    status: v.string(),
    qty: v.number(),
    price: v.number(),
    exchange: v.string(), // NSE | BSE
    segment: v.string(),
    date: v.string(), // ISO yyyy-mm-dd
    syncedAt: v.number(),
  })
    .index("by_orderId", ["growwOrderId"])
    .index("by_date", ["date"]),

  // Sector-rotation snapshot from Moneycontrol's sector API. A local cron
  // (scripts/sector-cron.sh, residential IP) pushes one row every 15 min during
  // market hours; the dashboard reads the latest. Payload is JSON-stringified —
  // it's a denormalized display blob, never queried by field. See
  // scripts/sector-uptrend.mjs --push.
  sectorRotation: defineTable({
    updatedAt: v.number(), // epoch ms when fetched
    payload: v.string(), // JSON: { ranked, broad, picks, fetchedAtIST }
  }),

  // "Aditya's Sector" snapshot — the Moneycontrol top-10 method: 1d top-10 and
  // 5d top-10 sector returns, the intersection (confirmed uptrends), and a
  // combined bullishness ranking. Single-row table, refreshed from the tab.
  adityaSector: defineTable({
    updatedAt: v.number(), // epoch ms when fetched
    payload: v.string(), // JSON: { d1, d5, both, ranking, fetchedAtIST }
  }),

  // Live F&O position panel. A Convex cron (convex/crons.ts) polls Groww every
  // minute during market hours and writes one snapshot row here; the Live tab
  // reads the latest. Payload is JSON-stringified (array of position cards with
  // P&L, OCO status, momentum, expiry countdown). Reads aren't IP-gated, so this
  // works from Convex — only order PLACEMENT needs the whitelisted VM.
  positionSnapshot: defineTable({
    updatedAt: v.number(), // epoch ms when polled
    payload: v.string(), // JSON: { positions: [...], marketOpen, fetchedAtIST }
  }),

  // Agentic review of open F&O positions. A Convex action (convex/agent.ts)
  // reads the latest live snapshot, asks Claude (Opus 4.8) to reason about each
  // open contract toward the goal "protect capital / book profit", and writes
  // one verdict-set row here. PROPOSE-ONLY — the agent never places an order;
  // the Agent tab renders its hold/trim/exit calls for the human to act on.
  // Single-row table (latest review wins), mirroring positionSnapshot.
  agentReview: defineTable({
    updatedAt: v.number(), // epoch ms when the review ran
    payload: v.string(), // JSON: { summary, verdicts: [...], model, marketOpen, basedOnSnapshotAt }
  }),

  // Daily "best option to trade today" ideas. The agent (convex/agent.ts) scans
  // the latest sector-rotation snapshot, asks Claude to rank the top option plays,
  // then resolves each to a concrete ATM contract (strike/expiry/premium) via Groww.
  // One row per trading day (regenerating replaces the day's row). PROPOSE-ONLY —
  // the Agent tab renders these for the human; nothing is auto-traded.
  agentIdeas: defineTable({
    date: v.string(), // yyyy-mm-dd (IST trading day)
    generatedAt: v.number(), // epoch ms
    model: v.string(),
    payload: v.string(), // JSON: { ideas: [...], marketContext, sectorDataAt }
  }).index("by_date", ["date"]),

  // Cached Groww access token (expires daily at 6 AM IST). Lets the per-minute
  // poll reuse one token instead of re-minting every run. Single-row table.
  growwToken: defineTable({
    token: v.string(),
    exp: v.number(), // epoch seconds (JWT exp)
  }),

  // Resolved instrument metadata (expiry, strike, underlying, lot size) for held
  // F&O symbols. Populated from Groww's instruments CSV on demand and refreshed
  // daily; lets the poll avoid re-downloading the multi-MB CSV every minute.
  instrumentMeta: defineTable({
    symbol: v.string(), // trading_symbol, e.g. BHARTIARTL26JUN1860CE
    underlying: v.string(),
    strike: v.number(),
    expiry: v.string(), // yyyy-mm-dd
    lotSize: v.number(),
    updatedAt: v.number(),
  }).index("by_symbol", ["symbol"]),

  // F&O trade scorecard. Each closed (or open) options trade, so the Scorecard
  // tab can show booked P&L vs. "if I'd held to now" using live marks. The Groww
  // order API is day-scoped, so these are seeded/curated; the poll attaches a
  // live LTP per symbol to compute the if-held column.
  fnoTrades: defineTable({
    symbol: v.string(), // Groww trading_symbol, e.g. LTM26JUN4000CE
    name: v.string(), // display, e.g. "LTM 4000 CE"
    qty: v.number(),
    buyPrice: v.number(),
    sellPrice: v.optional(v.number()), // unset = still open
    buyDate: v.string(),
    sellDate: v.optional(v.string()),
    note: v.optional(v.string()),
    bookedPnl: v.optional(v.number()), // override for blended trades where (sell-buy)*qty ≠ actual cash
  }).index("by_symbol", ["symbol"]),

  // Raw F&O order log — every individual BUY/SELL from the primary trading
  // account, synced daily by the "sync fno orders" cron and seeded once for
  // historical data. Stored by growwOrderId (synthetic HIST_* for seeds).
  fnoOrders: defineTable({
    growwOrderId: v.string(),
    symbol: v.string(),       // e.g. BHARTIARTL26JUN1860CE
    side: v.string(),         // BUY | SELL
    status: v.string(),       // COMPLETE | SEEDED
    qty: v.number(),
    price: v.number(),
    date: v.string(),         // yyyy-mm-dd
    time: v.optional(v.string()), // HH:MM for display
    syncedAt: v.number(),
  })
    .index("by_orderId", ["growwOrderId"])
    .index("by_date", ["date"])
    .index("by_symbol", ["symbol"]),

  // Alert dedupe log. The live poll speaks danger-level position alerts on the
  // Echo Flex (via Voice Monkey — see convex/alexa.ts), but runs every minute.
  // This records the last time each alert key fired so we announce once per
  // cooldown window instead of repeating the same warning 30× in 30 minutes.
  alertLog: defineTable({
    key: v.string(), // e.g. "BHARTIARTL26JUN1860CE:unprotected"
    at: v.number(), // epoch ms last announced
  }).index("by_key", ["key"]),

  // Ledger — six independent double-entry accounts, distinguished by `account`.
  ledger: defineTable({
    account: v.string(), // Gym | Needs | Wants | Fixed Deposit | Saving | Stock
    date: v.string(),
    particular: v.string(),
    debit: v.number(),
    credit: v.number(),
    order: v.number(), // manual sort within an account
  }).index("by_account", ["account", "order"]),
});
