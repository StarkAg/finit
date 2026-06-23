"use node";

import { action, internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import type { ActionCtx } from "./_generated/server";
import { v } from "convex/values";
import { createHash, createHmac } from "node:crypto";

// Live Groww portfolio access. Generates a fresh daily access token from the
// long-lived TOTP credentials (so it survives Groww's 6 AM reset with no manual
// step), then reads holdings. Reads are not IP-whitelist gated, so this works
// from Convex's servers. Set the secrets once:
//   npx convex env set GROWW_TOTP_TOKEN  <long token>
//   npx convex env set GROWW_TOTP_SECRET <base32 seed>
// (Approval-flow fallback: GROWW_API_KEY + GROWW_API_SECRET.)

const BASE = "https://api.groww.in/v1";
const headers = (token: string) => ({
  Authorization: `Bearer ${token}`,
  Accept: "application/json",
  "X-API-VERSION": "1.0",
});

// RFC 6238 TOTP (SHA-1, 6 digits, 30s) from a base32 seed.
function totpFromSecret(base32: string, step = 30, digits = 6): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const clean = base32.replace(/=+$/, "").replace(/\s/g, "").toUpperCase();
  let bits = "";
  for (const c of clean) {
    const idx = alphabet.indexOf(c);
    if (idx === -1) throw new Error(`Invalid base32 char in TOTP secret: ${c}`);
    bits += idx.toString(2).padStart(5, "0");
  }
  const bytes = Buffer.from(bits.match(/.{8}/g)!.map((b) => parseInt(b, 2)));
  const counter = Math.floor(Date.now() / 1000 / step);
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const hmac = createHmac("sha1", bytes).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const code =
    ((hmac[offset] & 0x7f) << 24) | (hmac[offset + 1] << 16) |
    (hmac[offset + 2] << 8) | hmac[offset + 3];
  return String(code % 10 ** digits).padStart(digits, "0");
}

// Two Groww accounts: "primary" (live F&O trading — the Live tab + VM orders)
// and "aditya" (the older account Vance's holdings/orders read from). Aditya
// creds use a GROWW_ADITYA_* prefix; if they aren't set yet, fall back to the
// primary account so nothing breaks before the creds are added.
type Account = "primary" | "aditya";
function accountCreds(account: Account) {
  if (account === "aditya" && process.env.GROWW_ADITYA_TOTP_TOKEN && process.env.GROWW_ADITYA_TOTP_SECRET) {
    return {
      totpToken: process.env.GROWW_ADITYA_TOTP_TOKEN,
      totpSecret: process.env.GROWW_ADITYA_TOTP_SECRET,
      apiKey: process.env.GROWW_ADITYA_API_KEY,
      apiSecret: process.env.GROWW_ADITYA_API_SECRET,
    };
  }
  return {
    totpToken: process.env.GROWW_TOTP_TOKEN,
    totpSecret: process.env.GROWW_TOTP_SECRET,
    apiKey: process.env.GROWW_API_KEY,
    apiSecret: process.env.GROWW_API_SECRET,
  };
}

async function getAccessToken(account: Account = "primary"): Promise<string> {
  const { totpToken, totpSecret, apiKey, apiSecret } = accountCreds(account);

  let bearer: string;
  let body: Record<string, string>;
  if (totpToken && totpSecret) {
    bearer = totpToken;
    body = { key_type: "totp", totp: totpFromSecret(totpSecret) };
  } else if (apiKey && apiSecret) {
    bearer = apiKey;
    const timestamp = String(Math.floor(Date.now() / 1000));
    const checksum = createHash("sha256").update(apiSecret + timestamp).digest("hex");
    body = { key_type: "approval", checksum, timestamp };
  } else {
    throw new Error(
      "Groww credentials not set. Run: npx convex env set GROWW_TOTP_TOKEN <token> && npx convex env set GROWW_TOTP_SECRET <seed>",
    );
  }

  // Headers must be ASCII. A stray '…' (or any non-Latin1 char) means the token
  // env var was pasted truncated — fail with a clear, actionable message.
  bearer = bearer.trim();
  if (/[^\x00-\xFF]/.test(bearer)) {
    throw new Error(
      "Groww token env var looks truncated (contains a non-ASCII char like '…'). Re-set the FULL token: npx convex env set --prod GROWW_TOTP_TOKEN \"$(grep '^GROWW_TOTP_TOKEN=' .env.local | cut -d= -f2-)\"",
    );
  }

  const res = await fetch(`${BASE}/token/api/access`, {
    method: "POST",
    headers: { ...headers(bearer), "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => null)) as
    | { token?: string; status?: string; error?: { message?: string } }
    | null;
  const token = data?.token;
  if (!res.ok || !token) {
    throw new Error(`Groww token generation failed (HTTP ${res.status}): ${data?.error?.message ?? "unknown"}`);
  }
  return token;
}

// Next 06:00 IST (= 00:30 UTC) as an epoch-seconds boundary. Groww invalidates
// access tokens at the daily 6 AM reset regardless of the JWT's own exp claim,
// so the cache must treat the token as dead after the next 6 AM or it'll keep
// serving a token Groww already rejected (→ empty positions / 401s).
function next6amIstEpoch(): number {
  const now = Date.now();
  const d = new Date(now);
  d.setUTCHours(0, 30, 0, 0);
  if (d.getTime() <= now) d.setUTCDate(d.getUTCDate() + 1);
  return Math.floor(d.getTime() / 1000);
}

// Token reused across the per-minute poll: read the cached row, mint only when
// it's expired (or within 5 min of expiry), then persist the fresh one.
async function getCachedToken(ctx: ActionCtx): Promise<string> {
  const cached = await ctx.runQuery(internal.growwStore.getToken, {});
  if (cached && cached.exp > Math.floor(Date.now() / 1000) + 300) return cached.token;
  const token = await getAccessToken();
  let exp = Math.floor(Date.now() / 1000) + 3600;
  try {
    exp = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString()).exp ?? exp;
  } catch {
    // keep the conservative 1h fallback
  }
  exp = Math.min(exp, next6amIstEpoch()); // never trust a token past Groww's 6 AM reset
  await ctx.runMutation(internal.growwStore.putToken, { token, exp });
  return token;
}

export type GrowwHolding = {
  id: string;
  symbol: string;
  qty: number;
  price: number;
  exchange: "NSE" | "BSE";
};

// Current DEMAT holdings — the closest the API offers to "past buys" (the API
// has NO historical order endpoint; the order book is current-day only).
export const holdings = action({
  args: {},
  handler: async (): Promise<GrowwHolding[]> => {
    const token = await getAccessToken("aditya");
    const res = await fetch(`${BASE}/holdings/user`, { headers: headers(token) });
    const data = (await res.json().catch(() => null)) as
      | { payload?: { holdings?: Array<Record<string, unknown>> }; error?: { message?: string } }
      | null;
    if (!res.ok) {
      throw new Error(`Groww holdings failed (HTTP ${res.status}): ${data?.error?.message ?? "unknown"}`);
    }
    return (data?.payload?.holdings ?? [])
      .map((h): GrowwHolding => {
        const exchanges = (h.tradable_exchanges as string[] | undefined) ?? [];
        return {
          id: String(h.isin ?? h.trading_symbol ?? ""),
          symbol: String(h.trading_symbol ?? ""),
          qty: Number(h.quantity ?? 0),
          price: Number(h.average_price ?? 0),
          exchange: exchanges.includes("NSE") || exchanges.length === 0 ? "NSE" : "BSE",
        };
      })
      .filter((h) => h.symbol && h.qty > 0)
      .sort((a, b) => a.symbol.localeCompare(b.symbol));
  },
});

// Open F&O option positions in the ADITYA account, marked live. Positions come
// from the aditya token; live LTP/day-change/OI come from the PRIMARY (Harsh)
// token, which carries the live-data entitlement. Read-only.
export const adityaFnoPositions = action({
  args: {},
  handler: async (ctx): Promise<Array<Record<string, unknown>>> => {
    const adityaToken = await getAccessToken("aditya");
    const liveToken = await getCachedToken(ctx); // Harsh/primary — for live rates

    const res = await fetch(`${BASE}/positions/user?segment=FNO`, { headers: headers(adityaToken) });
    const data = (await res.json().catch(() => null)) as
      | { payload?: { positions?: Array<Record<string, unknown>> }; error?: { message?: string } }
      | null;
    if (!res.ok) {
      throw new Error(`Groww aditya positions failed (HTTP ${res.status}): ${data?.error?.message ?? "unknown"}`);
    }
    const raw = (data?.payload?.positions ?? []).filter((p) => Number(p.quantity ?? 0) !== 0);

    const out: Array<Record<string, unknown>> = [];
    for (const p of raw) {
      const symbol = String(p.trading_symbol);
      const qty = Number(p.quantity ?? 0);
      const entry = Number(p.credit_price ?? p.net_price ?? p.buy_price ?? 0);
      const oq = await quote(liveToken, "FNO", symbol);
      const ltp = Number(oq.last_price ?? 0);
      out.push({
        symbol,
        qty,
        entry,
        ltp,
        pnl: entry ? r2((ltp - entry) * qty) : 0,
        pnlPct: entry ? r2(((ltp - entry) / entry) * 100) : 0,
        dayChange: r2(Number(oq.day_change_perc ?? 0)),
        oiChange: r2(Number(oq.oi_day_change_percentage ?? 0)),
      });
    }
    return out;
  },
});

// Fetch the current trading day's order book and persist it to the growwOrders
// table (upsert by id). The Groww order-list endpoint is day-scoped, so running
// this regularly — on UI open and via the daily cron (convex/crons.ts) —
// accumulates a full order history that the API itself doesn't keep.
export const syncOrders = action({
  args: {},
  handler: async (ctx): Promise<{ inserted: number; updated: number; synced: number }> => {
    const token = await getAccessToken("aditya");
    const res = await fetch(`${BASE}/order/list?segment=CASH&page=0&page_size=100`, {
      headers: headers(token),
    });
    const data = (await res.json().catch(() => null)) as
      | { payload?: { order_list?: Array<Record<string, unknown>> }; error?: { message?: string } }
      | null;
    if (!res.ok) {
      throw new Error(`Groww order list failed (HTTP ${res.status}): ${data?.error?.message ?? "unknown"}`);
    }
    const now = Date.now();
    const orders = (data?.payload?.order_list ?? [])
      .map((o) => {
        const filled = Number(o.filled_quantity ?? 0);
        const when = String(o.trade_date ?? o.exchange_time ?? o.created_at ?? "");
        return {
          growwOrderId: String(o.groww_order_id ?? ""),
          symbol: String(o.trading_symbol ?? ""),
          side: o.transaction_type === "SELL" ? "SELL" : "BUY",
          status: String(o.order_status ?? ""),
          qty: filled > 0 ? filled : Number(o.quantity ?? 0),
          price: Number(o.average_fill_price ?? o.price ?? 0),
          exchange: o.exchange === "BSE" ? "BSE" : "NSE",
          segment: String(o.segment ?? "CASH"),
          date: when ? when.slice(0, 10) : "",
          syncedAt: now,
        };
      })
      .filter((o) => o.growwOrderId && o.symbol);

    const result = await ctx.runMutation(internal.growwStore.upsertOrders, { orders });
    return { ...result, synced: orders.length };
  },
});

// Sync today's F&O orders from the primary trading account. The Groww order
// endpoint is day-scoped; running this daily after close accumulates a full
// history that the API itself doesn't keep. Upserts by growwOrderId so
// re-running is safe.
export const syncFnoOrders = action({
  args: {},
  handler: async (ctx): Promise<{ inserted: number; updated: number; synced: number }> => {
    const token = await getCachedToken(ctx); // primary account
    const res = await fetch(`${BASE}/order/list?segment=FNO&page=0&page_size=100`, {
      headers: headers(token),
    });
    const data = (await res.json().catch(() => null)) as
      | { payload?: { order_list?: Array<Record<string, unknown>>; total_count?: number }; error?: { message?: string } }
      | null;
    if (!res.ok) {
      throw new Error(`Groww FNO order list failed (HTTP ${res.status}): ${data?.error?.message ?? "unknown"}`);
    }
    const now = Date.now();
    const orders = (data?.payload?.order_list ?? [])
      .filter((o) => String(o.order_status ?? "") === "COMPLETE")
      .map((o) => {
        const filled = Number(o.filled_quantity ?? 0);
        const when = String(o.trade_date ?? o.exchange_time ?? o.created_at ?? "");
        return {
          growwOrderId: String(o.groww_order_id ?? ""),
          symbol: String(o.trading_symbol ?? ""),
          side: o.transaction_type === "SELL" ? "SELL" : "BUY",
          status: "COMPLETE",
          qty: filled > 0 ? filled : Number(o.quantity ?? 0),
          price: Number(o.average_fill_price ?? o.price ?? 0),
          date: when ? when.slice(0, 10) : "",
          time: when.length > 10 ? when.slice(11, 16) : undefined,
          syncedAt: now,
        };
      })
      .filter((o) => o.growwOrderId && o.symbol && o.date);
    const result = await ctx.runMutation(internal.growwStore.upsertFnoOrders, { orders });
    return { ...result, synced: orders.length };
  },
});

// ---------------- Live F&O position panel ----------------

const r2 = (n: number) => Math.round(n * 100) / 100;

type InstrMeta = { underlying: string; strike: number; expiry: string; lotSize: number };

// Resolve expiry/strike/underlying for held F&O symbols. Reads the Convex cache
// first; only downloads Groww's instruments CSV for symbols still missing, then
// caches them so subsequent polls don't re-fetch the multi-MB file.
async function resolveInstruments(ctx: ActionCtx, symbols: string[]): Promise<Record<string, InstrMeta>> {
  const cached = (await ctx.runQuery(internal.growwStore.getInstruments, { symbols })) as Record<string, InstrMeta>;
  const missing = symbols.filter((s) => !cached[s]);
  if (missing.length === 0) return cached;

  const res = await fetch("https://growwapi-assets.groww.in/instruments/instrument.csv");
  if (!res.ok) return cached; // best-effort; panel still works without expiry
  const csv = await res.text();
  const want = new Set(missing);
  const found: Array<{ symbol: string } & InstrMeta> = [];
  for (const line of csv.split("\n")) {
    // cols: 2=trading_symbol 9=underlying_symbol 11=expiry_date 12=strike 13=lot_size
    const c = line.split(",");
    const sym = c[2];
    if (!sym || !want.has(sym)) continue;
    found.push({
      symbol: sym,
      underlying: c[9] || sym,
      strike: Number(c[12]) || 0,
      expiry: c[11] || "",
      lotSize: Number(c[13]) || 0,
    });
    want.delete(sym);
    if (want.size === 0) break;
  }
  if (found.length) {
    await ctx.runMutation(internal.growwStore.putInstruments, { rows: found });
    for (const f of found) cached[f.symbol] = { underlying: f.underlying, strike: f.strike, expiry: f.expiry, lotSize: f.lotSize };
  }
  return cached;
}

async function quote(token: string, segment: "FNO" | "CASH", symbol: string): Promise<Record<string, unknown>> {
  const res = await fetch(`${BASE}/live-data/quote?exchange=NSE&segment=${segment}&trading_symbol=${symbol}`, {
    headers: headers(token),
  });
  const data = (await res.json().catch(() => null)) as { payload?: Record<string, unknown> } | null;
  return data?.payload ?? {};
}

// Is NSE cash/F&O open right now? Mon–Fri, 09:15–15:30 IST.
function marketOpenIST(now = new Date()): boolean {
  const ist = new Date(now.getTime() + 5.5 * 3600_000);
  const day = ist.getUTCDay(); // 0 Sun … 6 Sat (on the shifted clock)
  if (day === 0 || day === 6) return false;
  const mins = ist.getUTCHours() * 60 + ist.getUTCMinutes();
  return mins >= 555 && mins <= 930; // 9:15 … 15:30
}

function istStamp(now = new Date()): string {
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: true,
  }).format(now);
}

// Poll every open-market minute (convex/crons.ts). Builds one card per open F&O
// position: live P&L, intrinsic/time value, OCO target/stop status, a suggested
// trailing stop, expiry countdown, and a plain-English recommendation. Stores a
// single snapshot row the Live tab subscribes to. READ-ONLY — never places an order.
export const pollPosition = action({
  args: {},
  handler: async (ctx): Promise<{ positions: number; skipped?: string }> => {
    const open = marketOpenIST();
    const token = await getCachedToken(ctx);

    // Open F&O positions
    const posRes = await fetch(`${BASE}/positions/user?segment=FNO`, { headers: headers(token) });
    const posData = (await posRes.json().catch(() => null)) as
      | { payload?: { positions?: Array<Record<string, unknown>> } }
      | null;
    const raw = (posData?.payload?.positions ?? []).filter((p) => Number(p.quantity ?? 0) > 0);

    // NB: don't early-return on 0 open positions — the scorecard (closed trades)
    // must still refresh its live marks below. With raw empty the loops no-op.
    const symbols = raw.map((p) => String(p.trading_symbol));
    const meta = symbols.length ? await resolveInstruments(ctx, symbols) : {};

    // One OCO list for all positions (skip the call when nothing's open)
    let ocoList: Array<Record<string, unknown>> = [];
    if (raw.length) {
      const ocoRes = await fetch(`${BASE}/order-advance/list?smart_order_type=OCO&segment=FNO&status=ACTIVE`, {
        headers: headers(token),
      });
      const ocoData = (await ocoRes.json().catch(() => null)) as { payload?: { orders?: Array<Record<string, unknown>> } } | null;
      ocoList = ocoData?.payload?.orders ?? [];
    }

    const positions = [];
    const alerts: Array<{ key: string; text: string }> = [];
    const underlyingCache: Record<string, number> = {};

    for (const p of raw) {
      const symbol = String(p.trading_symbol);
      const m = meta[symbol] ?? { underlying: symbol, strike: 0, expiry: "", lotSize: 0 };
      const qty = Number(p.quantity ?? 0);
      const entry = Number(p.credit_price ?? p.net_price ?? 0);
      const isCall = symbol.endsWith("CE");

      const oq = await quote(token, "FNO", symbol);
      const ltp = Number(oq.last_price ?? 0);
      const dayChange = Number(oq.day_change_perc ?? 0);
      const oiChange = Number(oq.oi_day_change_percentage ?? 0);

      if (underlyingCache[m.underlying] === undefined) {
        const uq = await quote(token, "CASH", m.underlying);
        underlyingCache[m.underlying] = Number(uq.last_price ?? 0);
      }
      const uLtp = underlyingCache[m.underlying];

      const intrinsic = m.strike ? Math.max(0, isCall ? uLtp - m.strike : m.strike - uLtp) : 0;
      const timeValue = r2(ltp - intrinsic);
      const pnl = r2((ltp - entry) * qty);
      const pnlPct = entry ? r2(((ltp - entry) / entry) * 100) : 0;

      const oco = ocoList.find((o) => String(o.trading_symbol) === symbol);
      const ocoTarget = oco ? Number((oco.target as Record<string, unknown>)?.triggerPrice ?? 0) : null;
      const ocoStop = oco ? Number((oco.stop_loss as Record<string, unknown>)?.triggerPrice ?? 0) : null;

      const now = Date.now();
      let daysToExpiry = null as number | null;
      if (m.expiry) daysToExpiry = Math.ceil((new Date(`${m.expiry}T15:30:00+05:30`).getTime() - now) / 86400000);
      const suggestedStop = ltp > entry ? r2(Math.max(entry, ltp * 0.85)) : null;

      const recs: string[] = [];
      let urgency: "ok" | "warn" | "danger" = "ok";
      if (!oco) { recs.push("NO ACTIVE OCO — this position is UNPROTECTED. Re-place the bracket from the VM."); urgency = "danger"; }
      if (daysToExpiry != null && daysToExpiry <= 2) { recs.push(`EXIT — expiry in ${daysToExpiry}d. Theta cliff; square off.`); urgency = "danger"; }
      else if (daysToExpiry != null && daysToExpiry <= 4) { recs.push(`Exit soon — ${daysToExpiry}d to ${m.expiry} expiry, theta accelerating.`); if (urgency !== "danger") urgency = "warn"; }
      if (oco && suggestedStop != null && ocoStop != null && suggestedStop > ocoStop + 1) {
        recs.push(`Momentum up — consider trailing stop ₹${ocoStop} → ₹${suggestedStop} (locks ₹${r2((suggestedStop - entry) * qty)}).`);
        if (urgency === "ok") urgency = "warn";
      }
      if (oco && ocoTarget && ltp >= ocoTarget * 0.95) recs.push(`Near target ₹${ocoTarget} — OCO auto-sells on touch.`);
      if (recs.length === 0) recs.push("Protected and on track. Nothing to do.");

      // Speak danger-level conditions on the Echo Flex (once per cooldown — see
      // below). Only while the market is open; expiry takes priority over the
      // unprotected warning since theta is the harder deadline.
      if (open && urgency === "danger") {
        const name = `${m.underlying} ${m.strike} ${isCall ? "call" : "put"}`;
        if (daysToExpiry != null && daysToExpiry <= 2) {
          alerts.push({
            key: `${symbol}:expiry`,
            text: `Alert. Your ${name} expires in ${daysToExpiry} day${daysToExpiry === 1 ? "" : "s"}. Square it off.`,
          });
        } else if (!oco) {
          alerts.push({
            key: `${symbol}:unprotected`,
            text: `Alert. Your ${name} has no active stop loss and is unprotected. Re-place the bracket order.`,
          });
        }
      }

      positions.push({
        symbol, underlying: m.underlying, strike: m.strike, isCall, entry, qty,
        ltp, uLtp, intrinsic: r2(intrinsic), timeValue, pnl, pnlPct,
        dayChange: r2(dayChange), oiChange: r2(oiChange),
        oco: oco ? { target: ocoTarget, stop: ocoStop } : null,
        suggestedStop, daysToExpiry, expiry: m.expiry, urgency, recs,
      });
    }

    // Scorecard: booked vs. if-held using live marks. Guarded so a failure here
    // never blocks the open-position snapshot.
    let trades: Array<Record<string, unknown>> = [];
    try {
      const recs = await ctx.runQuery(internal.growwStore.listFnoTrades, {});
      const ltpCache: Record<string, number> = { ...underlyingCache };
      for (const tr of recs) {
        if (ltpCache[tr.symbol] === undefined) {
          const q = await quote(token, "FNO", tr.symbol);
          ltpCache[tr.symbol] = Number(q.last_price ?? 0);
        }
        const ltp = ltpCache[tr.symbol];
        const closed = tr.sellPrice != null;
        const booked = closed
          ? tr.bookedPnl != null ? r2(tr.bookedPnl as number) : r2(((tr.sellPrice as number) - tr.buyPrice) * tr.qty)
          : null;
        // For blended trades (bookedPnl override), measure ifHeld from the exit
        // price so the verdict answers "was your exit timing good?" not "did 3
        // round-trips beat holding 1 lot?" — those aren't comparable quantities.
        const ifHeld = tr.bookedPnl != null && closed
          ? r2((tr.bookedPnl as number) + (ltp - (tr.sellPrice as number)) * tr.qty)
          : r2((ltp - tr.buyPrice) * tr.qty);
        trades.push({
          name: tr.name, symbol: tr.symbol, qty: tr.qty,
          buy: tr.buyPrice, sell: tr.sellPrice ?? null, ltp,
          booked, ifHeld, delta: booked != null ? r2(booked - ifHeld) : null,
          buyDate: tr.buyDate, sellDate: tr.sellDate ?? null, note: tr.note ?? null,
        });
      }
    } catch {
      trades = [];
    }

    await ctx.runMutation(internal.growwStore.putPositionSnapshot, {
      updatedAt: Date.now(),
      payload: JSON.stringify({ positions, trades, marketOpen: open, fetchedAtIST: istStamp() }),
    });

    // Speak any new danger alerts on the Flex. claimAlert dedupes so each
    // condition announces once per ~trading day (8h covers the 09:15–15:30
    // session), NOT every poll — the Voice Monkey free tier is only 200
    // requests/month (~6.6/day), so a persistent danger must cost 1 alert/day,
    // not 12. Best-effort: a Voice Monkey hiccup must never break the snapshot.
    for (const a of alerts) {
      try {
        const fresh = await ctx.runMutation(internal.growwStore.claimAlert, {
          key: a.key,
          cooldownMs: 8 * 60 * 60 * 1000,
        });
        if (fresh) await ctx.runAction(internal.alexa.announce, { text: a.text });
      } catch {
        /* ignore — announcements are non-critical */
      }
    }

    return { positions: positions.length };
  },
});

// Current LTP for a set of F&O symbols (primary/Harsh token). Used by the ideas
// tracker to mark each idea's live premium. Internal.
export const quoteFnoLtps = internalAction({
  args: { symbols: v.array(v.string()) },
  handler: async (ctx, { symbols }): Promise<Record<string, number>> => {
    if (!symbols.length) return {};
    const token = await getCachedToken(ctx);
    const out: Record<string, number> = {};
    for (const s of symbols) {
      const q = await quote(token, "FNO", s);
      out[s] = Number(q.last_price ?? 0);
    }
    return out;
  },
});

// ---------------- Option resolver (for the daily ideas agent) ----------------

type ResolvedOption = {
  underlying: string;
  type: string;
  resolved: boolean;
  symbol?: string;
  strike?: number;
  expiry?: string;
  lotSize?: number;
  spot?: number;
  ltp?: number;
};

// Given candidate underlyings + CE/PE, resolve each to its front-month ATM option:
// the exact Groww trading symbol, strike, expiry, lot size, live spot, and premium.
// Downloads the instruments CSV once and quotes each underlying's spot + ATM option.
// Internal — called by convex/agent.ts when generating daily ideas.
export const resolveAtmOptions = internalAction({
  args: { candidates: v.array(v.object({ underlying: v.string(), type: v.string() })) },
  handler: async (ctx, { candidates }): Promise<ResolvedOption[]> => {
    if (!candidates.length) return [];
    const token = await getCachedToken(ctx);

    const res = await fetch("https://growwapi-assets.groww.in/instruments/instrument.csv");
    if (!res.ok) return candidates.map((c) => ({ underlying: c.underlying, type: c.type, resolved: false }));
    const csv = await res.text();

    // cols: 2=trading_symbol 9=underlying_symbol 11=expiry_date 12=strike 13=lot_size
    const wanted = new Set(candidates.map((c) => c.underlying.toUpperCase()));
    const byUnderlying: Record<string, Array<{ expiry: string; strike: number; type: string; symbol: string; lotSize: number }>> = {};
    for (const line of csv.split("\n")) {
      const c = line.split(",");
      const sym = c[2];
      if (!sym) continue;
      const t = sym.endsWith("CE") ? "CE" : sym.endsWith("PE") ? "PE" : null;
      if (!t) continue; // options only
      const u = (c[9] || "").toUpperCase();
      if (!wanted.has(u)) continue;
      const strike = Number(c[12]) || 0;
      if (!strike) continue;
      (byUnderlying[u] ||= []).push({ expiry: c[11] || "", strike, type: t, symbol: sym, lotSize: Number(c[13]) || 0 });
    }

    const today = new Date().toISOString().slice(0, 10);
    const out: ResolvedOption[] = [];
    const spotCache: Record<string, number> = {};
    for (const cand of candidates) {
      const u = cand.underlying.toUpperCase();
      const type = cand.type === "PE" ? "PE" : "CE";
      const rows = (byUnderlying[u] || []).filter((r) => r.type === type);
      if (!rows.length) { out.push({ underlying: u, type, resolved: false }); continue; }

      // Front-month: nearest expiry on/after today (fallback to the latest available).
      const allExp = [...new Set(rows.map((r) => r.expiry))].sort();
      const expiry = allExp.find((e) => e >= today) ?? allExp[allExp.length - 1];

      if (spotCache[u] === undefined) {
        const sq = await quote(token, "CASH", u);
        spotCache[u] = Number(sq.last_price ?? 0);
      }
      const spot = spotCache[u];
      const inExpiry = rows.filter((r) => r.expiry === expiry);
      if (!spot || !inExpiry.length) { out.push({ underlying: u, type, resolved: false }); continue; }

      // ATM = strike nearest to spot.
      const atm = inExpiry.reduce((best, r) => (Math.abs(r.strike - spot) < Math.abs(best.strike - spot) ? r : best));
      const oq = await quote(token, "FNO", atm.symbol);
      const ltp = Number(oq.last_price ?? 0);
      out.push({ underlying: u, type, resolved: true, symbol: atm.symbol, strike: atm.strike, expiry, lotSize: atm.lotSize, spot: r2(spot), ltp: r2(ltp) });
    }
    return out;
  },
});
