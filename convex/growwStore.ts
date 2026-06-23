import { internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { v } from "convex/values";

// Persisted Groww order history. The sync action (convex/groww.ts) feeds this;
// the UI reads `savedOrders`. Lives in a non-"use node" file because Convex
// only allows actions in "use node" modules.

const orderObject = v.object({
  growwOrderId: v.string(),
  symbol: v.string(),
  side: v.string(),
  status: v.string(),
  qty: v.number(),
  price: v.number(),
  exchange: v.string(),
  segment: v.string(),
  date: v.string(),
  syncedAt: v.number(),
});

// All accumulated orders, newest first.
export const savedOrders = query({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query("growwOrders").withIndex("by_date").collect();
    return rows.sort((a, b) => b.date.localeCompare(a.date) || b.syncedAt - a.syncedAt);
  },
});

// Upsert a batch by growwOrderId (so re-syncing the same day updates status/fills
// instead of duplicating). Internal — only the sync action calls it.
export const upsertOrders = internalMutation({
  args: { orders: v.array(orderObject) },
  handler: async (ctx, { orders }) => {
    let inserted = 0;
    let updated = 0;
    for (const o of orders) {
      const existing = await ctx.db
        .query("growwOrders")
        .withIndex("by_orderId", (q) => q.eq("growwOrderId", o.growwOrderId))
        .first();
      if (existing) {
        await ctx.db.patch(existing._id, o);
        updated++;
      } else {
        await ctx.db.insert("growwOrders", o);
        inserted++;
      }
    }
    return { inserted, updated };
  },
});

// ---------------- Live position panel ----------------

// Latest live-position snapshot for the Live tab. null until the first poll.
export const positionSnapshot = query({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query("positionSnapshot").collect();
    if (!rows.length) return null;
    const latest = rows.reduce((a, b) => (b.updatedAt > a.updatedAt ? b : a));
    return { updatedAt: latest.updatedAt, payload: latest.payload };
  },
});

// Replace the snapshot (single-row table). Internal — only the poll action writes.
export const putPositionSnapshot = internalMutation({
  args: { updatedAt: v.number(), payload: v.string() },
  handler: async (ctx, { updatedAt, payload }) => {
    const existing = await ctx.db.query("positionSnapshot").collect();
    for (const row of existing) await ctx.db.delete(row._id);
    await ctx.db.insert("positionSnapshot", { updatedAt, payload });
  },
});

// ---------------- Agentic position review ----------------

// Latest agent review for the Agent tab. null until the first review runs.
export const agentReview = query({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query("agentReview").collect();
    if (!rows.length) return null;
    const latest = rows.reduce((a, b) => (b.updatedAt > a.updatedAt ? b : a));
    return { updatedAt: latest.updatedAt, payload: latest.payload };
  },
});

// Replace the review (single-row table). Internal — only the agent action writes.
export const putAgentReview = internalMutation({
  args: { updatedAt: v.number(), payload: v.string() },
  handler: async (ctx, { updatedAt, payload }) => {
    const existing = await ctx.db.query("agentReview").collect();
    for (const row of existing) await ctx.db.delete(row._id);
    await ctx.db.insert("agentReview", { updatedAt, payload });
  },
});

// Internal read of the latest live snapshot for the agent to reason over.
export const latestSnapshot = internalQuery({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query("positionSnapshot").collect();
    if (!rows.length) return null;
    const latest = rows.reduce((a, b) => (b.updatedAt > a.updatedAt ? b : a));
    return { updatedAt: latest.updatedAt, payload: latest.payload };
  },
});

// ---------------- Daily option ideas ----------------

// Most recent idea set for the Agent tab (latest generation, not just latest day).
export const agentIdeas = query({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query("agentIdeas").collect();
    if (!rows.length) return null;
    const latest = rows.reduce((a, b) => (b.generatedAt > a.generatedAt ? b : a));
    return { date: latest.date, generatedAt: latest.generatedAt, model: latest.model, payload: latest.payload };
  },
});

// Full history (newest first). Every generation is kept (we append, never
// overwrite), so prior idea sets stay around with their tracked outcomes.
export const agentIdeasHistory = query({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query("agentIdeas").collect();
    return rows
      .sort((a, b) => b.generatedAt - a.generatedAt)
      .map((r) => ({ date: r.date, generatedAt: r.generatedAt, model: r.model, payload: r.payload }));
  },
});

// Internal: all idea rows (with _id) for the tracker to read + update.
export const listIdeaRows = internalQuery({
  args: {},
  handler: async (ctx) =>
    (await ctx.db.query("agentIdeas").collect()).map((r) => ({ id: r._id, date: r.date, generatedAt: r.generatedAt, payload: r.payload })),
});

// Internal: overwrite one idea row's payload (used by the tracker to write back
// current premium / peak / status).
export const setIdeasPayload = internalMutation({
  args: { id: v.id("agentIdeas"), payload: v.string() },
  handler: async (ctx, { id, payload }) => {
    await ctx.db.patch(id, { payload });
  },
});

// Append a new idea set. Every generation is kept (never overwritten) so the
// prior picks stay in history with their tracked outcomes.
export const putAgentIdeas = internalMutation({
  args: { date: v.string(), generatedAt: v.number(), model: v.string(), payload: v.string() },
  handler: async (ctx, { date, generatedAt, model, payload }) => {
    await ctx.db.insert("agentIdeas", { date, generatedAt, model, payload });
  },
});

// Cached access token read/write (single row).
export const getToken = internalQuery({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query("growwToken").collect();
    return rows.length ? rows[0] : null;
  },
});

export const putToken = internalMutation({
  args: { token: v.string(), exp: v.number() },
  handler: async (ctx, { token, exp }) => {
    const existing = await ctx.db.query("growwToken").collect();
    for (const row of existing) await ctx.db.delete(row._id);
    await ctx.db.insert("growwToken", { token, exp });
  },
});

// Instrument metadata cache (expiry/strike/underlying) keyed by trading symbol.
export const getInstruments = internalQuery({
  args: { symbols: v.array(v.string()) },
  handler: async (ctx, { symbols }) => {
    const out: Record<string, { underlying: string; strike: number; expiry: string; lotSize: number }> = {};
    for (const symbol of symbols) {
      const row = await ctx.db
        .query("instrumentMeta")
        .withIndex("by_symbol", (q) => q.eq("symbol", symbol))
        .first();
      if (row) out[symbol] = { underlying: row.underlying, strike: row.strike, expiry: row.expiry, lotSize: row.lotSize };
    }
    return out;
  },
});

export const putInstruments = internalMutation({
  args: {
    rows: v.array(
      v.object({
        symbol: v.string(),
        underlying: v.string(),
        strike: v.number(),
        expiry: v.string(),
        lotSize: v.number(),
      }),
    ),
  },
  handler: async (ctx, { rows }) => {
    const now = Date.now();
    for (const r of rows) {
      const existing = await ctx.db
        .query("instrumentMeta")
        .withIndex("by_symbol", (q) => q.eq("symbol", r.symbol))
        .first();
      if (existing) await ctx.db.patch(existing._id, { ...r, updatedAt: now });
      else await ctx.db.insert("instrumentMeta", { ...r, updatedAt: now });
    }
  },
});

// ---------------- Alert dedupe ----------------

// Atomically claim an alert key: returns true (and records "now") only if this
// key hasn't fired within `cooldownMs`. The poll calls this before speaking a
// danger alert so the Flex announces each condition once per cooldown, not every
// minute. Read+write in one mutation keeps it race-free across overlapping polls.
export const claimAlert = internalMutation({
  args: { key: v.string(), cooldownMs: v.number() },
  handler: async (ctx, { key, cooldownMs }) => {
    const now = Date.now();
    const existing = await ctx.db
      .query("alertLog")
      .withIndex("by_key", (q) => q.eq("key", key))
      .first();
    if (existing && now - existing.at < cooldownMs) return false;
    if (existing) await ctx.db.patch(existing._id, { at: now });
    else await ctx.db.insert("alertLog", { key, at: now });
    return true;
  },
});

// ---------------- F&O trade scorecard ----------------

// All scorecard trades (for the poll to attach live marks).
export const listFnoTrades = internalQuery({
  args: {},
  handler: async (ctx) => ctx.db.query("fnoTrades").collect(),
});

// Public list for the Scorecard tab (raw rows; marks come from the snapshot).
export const fnoTrades = query({
  args: {},
  handler: async (ctx) => ctx.db.query("fnoTrades").collect(),
});

// ---------------- F&O order book ----------------

const fnoOrderObj = v.object({
  growwOrderId: v.string(),
  symbol: v.string(),
  side: v.string(),
  status: v.string(),
  qty: v.number(),
  price: v.number(),
  date: v.string(),
  time: v.optional(v.string()),
  syncedAt: v.number(),
});

// Upsert by growwOrderId — daily cron and manual seed both call this.
export const upsertFnoOrders = internalMutation({
  args: { orders: v.array(fnoOrderObj) },
  handler: async (ctx, { orders }) => {
    let inserted = 0, updated = 0;
    for (const o of orders) {
      const existing = await ctx.db
        .query("fnoOrders")
        .withIndex("by_orderId", (q) => q.eq("growwOrderId", o.growwOrderId))
        .first();
      if (existing) { await ctx.db.patch(existing._id, o); updated++; }
      else { await ctx.db.insert("fnoOrders", o); inserted++; }
    }
    return { inserted, updated };
  },
});

// All FNO orders for the poll / scorecard computation (internal).
export const listFnoOrders = internalQuery({
  args: {},
  handler: async (ctx) => ctx.db.query("fnoOrders").collect(),
});

// Public order book, newest first (for the Order Book tab).
export const fnoOrderBook = query({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query("fnoOrders").collect();
    return rows.sort((a, b) =>
      b.date.localeCompare(a.date) || (b.time ?? "").localeCompare(a.time ?? ""),
    );
  },
});

// Seed historical FNO orders (idempotent by growwOrderId).
export const seedFnoOrders = mutation({
  args: { orders: v.array(fnoOrderObj), replace: v.optional(v.boolean()) },
  handler: async (ctx, { orders, replace }) => {
    if (replace) {
      for (const row of await ctx.db.query("fnoOrders").collect()) await ctx.db.delete(row._id);
    }
    let inserted = 0;
    for (const o of orders) {
      const exists = await ctx.db
        .query("fnoOrders")
        .withIndex("by_orderId", (q) => q.eq("growwOrderId", o.growwOrderId))
        .first();
      if (!exists) { await ctx.db.insert("fnoOrders", o); inserted++; }
    }
    return { inserted };
  },
});

// Replace the whole scorecard set (idempotent seed). Upserts by symbol+buyDate
// so re-seeding doesn't duplicate.
export const seedFnoTrades = mutation({
  args: {
    trades: v.array(
      v.object({
        symbol: v.string(),
        name: v.string(),
        qty: v.number(),
        buyPrice: v.number(),
        sellPrice: v.optional(v.number()),
        buyDate: v.string(),
        sellDate: v.optional(v.string()),
        note: v.optional(v.string()),
        bookedPnl: v.optional(v.number()),
      }),
    ),
    replace: v.optional(v.boolean()),
  },
  handler: async (ctx, { trades, replace }) => {
    if (replace) {
      for (const row of await ctx.db.query("fnoTrades").collect()) await ctx.db.delete(row._id);
    }
    let n = 0;
    for (const t of trades) {
      await ctx.db.insert("fnoTrades", t);
      n++;
    }
    return { inserted: n };
  },
});
