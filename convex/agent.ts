"use node";

import { action } from "./_generated/server";
import { internal, api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";

// Agentic position review — the "brain" of Vance. Reads the latest live F&O
// snapshot (built by groww.ts → pollPosition) and asks Claude Opus 4.8 to reason
// about each open contract toward the goal: PROTECT CAPITAL / BOOK PROFIT. It
// emits a HOLD / TRIM / EXIT verdict per contract with a reason and confidence,
// and writes one review row the Agent tab subscribes to.
//
// PROPOSE-ONLY by design: this action never calls Groww and never places an
// order. Order placement stays on the whitelisted VM (see the live-trading
// architecture). The human reads the verdicts and acts. Cost is controlled by
// skipping the model entirely when there are no open positions.

const MODEL = "claude-opus-4-8";
const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const r2 = (n: number) => Math.round(n * 100) / 100;

type Position = {
  symbol: string;
  underlying: string;
  strike: number;
  isCall: boolean;
  entry: number;
  qty: number;
  ltp: number;
  uLtp: number;
  intrinsic: number;
  timeValue: number;
  pnl: number;
  pnlPct: number;
  dayChange: number;
  oiChange: number;
  oco: { target: number | null; stop: number | null } | null;
  suggestedStop: number | null;
  daysToExpiry: number | null;
  expiry: string;
  urgency: "ok" | "warn" | "danger";
  recs: string[];
};
type Snapshot = { positions: Position[]; marketOpen: boolean; fetchedAtIST: string };

const SYSTEM = `You are a disciplined F&O risk manager for an Indian options trader (NSE, weekly/monthly index & stock options). Your sole goal is to PROTECT CAPITAL and BOOK PROFIT — not to chase upside.

For every open position you must return one action:
- EXIT  — square off the whole position now. Use when: no active OCO/stop AND the trade is in profit (protect gains) or losing (cap the loss); ≤2 days to expiry (theta cliff on a long option); thesis clearly broken (underlying moving against the option with OI confirming).
- TRIM  — book part of the position, ride the rest. Use when: in solid profit with momentum still up and protection in place — lock some in, trail the rest.
- HOLD  — keep as-is. Use when: protected by an OCO, healthy time to expiry, and the move is intact.

Principles:
- An unprotected position (no OCO/stop) is the single biggest risk — bias toward EXIT or demand a stop.
- Long options bleed theta; near expiry, time value collapses — prefer EXIT over hope.
- Booked profit beats paper profit. When in doubt on a winner, TRIM.
- Be decisive and specific. Each reason must be one line a trader can act on immediately, referencing the actual numbers (P&L %, days to expiry, whether a stop exists).
- confidence reflects how clear the call is given the data.

Return ONLY the structured object. No preamble.`;

const SCHEMA = {
  type: "object",
  properties: {
    summary: {
      type: "string",
      description: "One or two sentences on the overall book: total risk posture and the single most important action.",
    },
    verdicts: {
      type: "array",
      items: {
        type: "object",
        properties: {
          symbol: { type: "string" },
          action: { type: "string", enum: ["HOLD", "TRIM", "EXIT"] },
          confidence: { type: "string", enum: ["low", "medium", "high"] },
          reason: { type: "string", description: "One actionable line citing the numbers." },
        },
        required: ["symbol", "action", "confidence", "reason"],
        additionalProperties: false,
      },
    },
  },
  required: ["summary", "verdicts"],
  additionalProperties: false,
};

export const reviewPositions = action({
  args: {},
  handler: async (ctx): Promise<{ reviewed: number; skipped?: string }> => {
    const snap = await ctx.runQuery(internal.growwStore.latestSnapshot, {});
    let data: Snapshot | null = null;
    try {
      data = snap?.payload ? (JSON.parse(snap.payload) as Snapshot) : null;
    } catch {
      data = null;
    }
    const positions = data?.positions ?? [];
    const now = Date.now();

    // No open positions → nothing to manage. Write an empty review and skip the
    // model call entirely (keeps cost near zero while flat).
    if (positions.length === 0) {
      await ctx.runMutation(internal.growwStore.putAgentReview, {
        updatedAt: now,
        payload: JSON.stringify({
          summary: "No open positions — nothing to manage.",
          verdicts: [],
          model: MODEL,
          marketOpen: data?.marketOpen ?? false,
          basedOnSnapshotAt: snap?.updatedAt ?? null,
        }),
      });
      return { reviewed: 0, skipped: "no open positions" };
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error("ANTHROPIC_API_KEY not set on the Convex deployment");

    // Trim each position to the fields the model needs to reason.
    const brief = positions.map((p) => ({
      symbol: p.symbol,
      type: p.isCall ? "CALL" : "PUT",
      underlying: p.underlying,
      strike: p.strike,
      qty: p.qty,
      entry: p.entry,
      ltp: p.ltp,
      underlyingSpot: p.uLtp,
      intrinsic: p.intrinsic,
      timeValue: p.timeValue,
      pnl: p.pnl,
      pnlPct: p.pnlPct,
      optionDayChangePct: p.dayChange,
      oiDayChangePct: p.oiChange,
      hasActiveStop: p.oco != null,
      ocoTarget: p.oco?.target ?? null,
      ocoStop: p.oco?.stop ?? null,
      daysToExpiry: p.daysToExpiry,
    }));

    const userContent = `Market is ${data?.marketOpen ? "OPEN" : "CLOSED"} (${data?.fetchedAtIST ?? "?"}). Review these open positions and return a verdict for each.\n\n${JSON.stringify(brief, null, 2)}`;

    const res = await fetch(ANTHROPIC_URL, {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 2048,
        system: SYSTEM,
        messages: [{ role: "user", content: userContent }],
        output_config: { format: { type: "json_schema", schema: SCHEMA }, effort: "medium" },
      }),
    });

    const body = (await res.json().catch(() => null)) as
      | { content?: Array<{ type: string; text?: string }>; stop_reason?: string; error?: { message?: string } }
      | null;

    if (!res.ok) {
      throw new Error(`Claude review failed (HTTP ${res.status}): ${body?.error?.message ?? "unknown"}`);
    }
    if (body?.stop_reason === "refusal") {
      throw new Error("Claude declined the review request (refusal).");
    }

    const text = body?.content?.find((b) => b.type === "text")?.text ?? "";
    let parsed: { summary: string; verdicts: unknown[] };
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new Error(`Could not parse Claude review output: ${text.slice(0, 200)}`);
    }

    await ctx.runMutation(internal.growwStore.putAgentReview, {
      updatedAt: Date.now(),
      payload: JSON.stringify({
        summary: parsed.summary,
        verdicts: parsed.verdicts,
        model: MODEL,
        marketOpen: data?.marketOpen ?? false,
        basedOnSnapshotAt: snap?.updatedAt ?? null,
      }),
    });

    return { reviewed: positions.length };
  },
});

// ---------------- Daily "best option to trade today" ideas ----------------

type SectorRow = { s: string; w1: number | null; m1: number | null; m3: number | null; breadth: number; trend: string; score: number };
type SectorStock = { name: string; chg: number | null; mcap: number | null; trend: string };
type SectorPayload = {
  ranked: SectorRow[];
  picks: { sector: SectorRow; stocks: SectorStock[] }[];
  fetchedAtIST: string;
};

type IdeaCandidate = {
  underlying: string;
  nseSymbol: string;
  optionType: "CE" | "PE";
  conviction: "low" | "medium" | "high";
  sector: string;
  targetPct: number;
  stopPct: number;
  rationale: string;
};

const IDEAS_SYSTEM = `You are an F&O options strategist for an Indian retail trader (NSE). Your job: from a sector-rotation market scan, pick the single best options trades to BUY today and rank them best-first.

Rules:
- ONLY pick underlyings that have liquid NSE F&O (options) — large/mid caps and index constituents. Do NOT pick illiquid small-caps or names without options.
- Give the exact NSE/F&O ticker in nseSymbol (UPPERCASE, e.g. "HAL", "POLICYBZR", "RELAXO", "BHARTIARTL"). This must match the NSE symbol, not the display name.
- Bullish thesis → optionType "CE"; bearish → "PE".
- Favour strong-momentum, high-breadth sectors for CE; weak/breaking sectors for PE. "Dip in strength" names (red today inside a strong sector) are good CE candidates.
- targetPct and stopPct are percentage moves on the OPTION PREMIUM (not the stock). Use realistic options ranges: target 30–80%, stop 20–35%.
- rationale: one or two crisp lines a trader can act on, citing the sector momentum/breadth and the setup.
- Return 5–6 candidates ranked best-first so weaker picks can be dropped if they lack options. Also give a one/two-sentence marketContext on the overall tape.

Return ONLY the structured object.`;

const IDEAS_SCHEMA = {
  type: "object",
  properties: {
    marketContext: { type: "string" },
    candidates: {
      type: "array",
      items: {
        type: "object",
        properties: {
          underlying: { type: "string" },
          nseSymbol: { type: "string" },
          optionType: { type: "string", enum: ["CE", "PE"] },
          conviction: { type: "string", enum: ["low", "medium", "high"] },
          sector: { type: "string" },
          targetPct: { type: "number" },
          stopPct: { type: "number" },
          rationale: { type: "string" },
        },
        required: ["underlying", "nseSymbol", "optionType", "conviction", "sector", "targetPct", "stopPct", "rationale"],
        additionalProperties: false,
      },
    },
  },
  required: ["marketContext", "candidates"],
  additionalProperties: false,
};

// IST trading-day string (yyyy-mm-dd).
function istDay(): string {
  return new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
}

// Scan the latest sector snapshot, ask Claude for the best option plays, resolve
// the top picks to concrete ATM contracts, and store the day's ideas. PROPOSE-ONLY.
export const generateIdeas = action({
  args: {},
  handler: async (ctx): Promise<{ generated: number; skipped?: string }> => {
    const date = istDay();
    const snap = await ctx.runQuery(api.sector.get, {});
    let sect: SectorPayload | null = null;
    try {
      sect = snap?.payload ? (JSON.parse(snap.payload) as SectorPayload) : null;
    } catch {
      sect = null;
    }
    if (!sect || !sect.ranked?.length) {
      await ctx.runMutation(internal.growwStore.putAgentIdeas, {
        date,
        generatedAt: Date.now(),
        model: MODEL,
        payload: JSON.stringify({ ideas: [], stale: true, marketContext: "No sector-rotation scan available yet — run the sector feed first.", sectorDataAt: snap?.updatedAt ?? null }),
      });
      return { generated: 0, skipped: "no sector data" };
    }

    // STALENESS GUARD (added after a real loss): the directional thesis is only
    // as good as the scan it's built on. A bullish CE picked off week-old momentum
    // burned a real BEL 425 CE trade. So if the sector snapshot isn't fresh, we
    // REFUSE — no Claude call, no ideas — rather than recommend trades off stale
    // data. The feed pushes every ~15 min during market hours, so anything older
    // than 2h means the feed isn't live right now.
    const STALE_MS = 2 * 60 * 60 * 1000;
    const sectorAgeMs = Date.now() - (snap?.updatedAt ?? 0);
    if (!snap?.updatedAt || sectorAgeMs > STALE_MS) {
      const hrs = snap?.updatedAt ? Math.round(sectorAgeMs / 3_600_000) : null;
      await ctx.runMutation(internal.growwStore.putAgentIdeas, {
        date,
        generatedAt: Date.now(),
        model: MODEL,
        payload: JSON.stringify({
          ideas: [],
          stale: true,
          marketContext: `Sector scan is stale (as of ${sect.fetchedAtIST}${hrs != null ? `, ~${hrs}h old` : ""}). Refusing to generate ideas off old momentum — refresh the sector feed (scripts/sector-uptrend.mjs --push) during market hours, then Generate again.`,
          sectorDataAt: snap?.updatedAt ?? null,
          sectorAsOf: sect.fetchedAtIST,
        }),
      });
      return { generated: 0, skipped: "stale sector data" };
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error("ANTHROPIC_API_KEY not set on the Convex deployment");

    // Compact scan for the model: top ranked sectors + the dip-in-strength picks.
    const scan = {
      rankedSectors: sect.ranked.slice(0, 18).map((s) => ({ sector: s.s, mom3M: s.m3, mom1M: s.m1, mom1W: s.w1, breadthPct: Math.round(s.breadth * 100), trend: s.trend, score: s.score })),
      dipCandidates: (sect.picks ?? []).map((p) => ({
        sector: p.sector.s,
        breadthPct: Math.round(p.sector.breadth * 100),
        stocks: p.stocks.map((st) => ({ name: st.name, todayPct: st.chg, mcapCr: st.mcap, trend: st.trend })),
      })),
      asOf: sect.fetchedAtIST,
    };
    const userContent = `Sector-rotation market scan (as of ${sect.fetchedAtIST}). Pick the best options to buy today.\n\n${JSON.stringify(scan, null, 2)}`;

    const res = await fetch(ANTHROPIC_URL, {
      method: "POST",
      headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 2048,
        system: IDEAS_SYSTEM,
        messages: [{ role: "user", content: userContent }],
        output_config: { format: { type: "json_schema", schema: IDEAS_SCHEMA }, effort: "medium" },
      }),
    });
    const body = (await res.json().catch(() => null)) as
      | { content?: Array<{ type: string; text?: string }>; stop_reason?: string; error?: { message?: string } }
      | null;
    if (!res.ok) throw new Error(`Claude ideas failed (HTTP ${res.status}): ${body?.error?.message ?? "unknown"}`);
    if (body?.stop_reason === "refusal") throw new Error("Claude declined the ideas request (refusal).");

    const text = body?.content?.find((b) => b.type === "text")?.text ?? "";
    let parsed: { marketContext: string; candidates: IdeaCandidate[] };
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new Error(`Could not parse Claude ideas output: ${text.slice(0, 200)}`);
    }

    // Resolve every candidate to a concrete ATM contract via Groww (one CSV pass).
    const resolved = await ctx.runAction(internal.groww.resolveAtmOptions, {
      candidates: parsed.candidates.map((c) => ({ underlying: c.nseSymbol, type: c.optionType })),
    });

    // Keep the top 3 that resolved to a real, priced contract, in Claude's order.
    const ideas: Record<string, unknown>[] = [];
    for (let i = 0; i < parsed.candidates.length && ideas.length < 3; i++) {
      const c = parsed.candidates[i];
      const r = resolved[i];
      const ltp = r?.ltp ?? 0;
      if (!r || !r.resolved || !ltp) continue;
      ideas.push({
        rank: ideas.length + 1,
        underlying: c.underlying,
        nseSymbol: c.nseSymbol,
        sector: c.sector,
        optionType: c.optionType,
        conviction: c.conviction,
        rationale: c.rationale,
        symbol: r.symbol ?? "",
        strike: r.strike ?? 0,
        expiry: r.expiry ?? "",
        lotSize: r.lotSize ?? 0,
        spot: r.spot ?? 0,
        ltp,
        entryLow: ltp,
        entryHigh: r2(ltp * 1.04),
        target: r2(ltp * (1 + c.targetPct / 100)),
        stop: r2(ltp * (1 - c.stopPct / 100)),
        targetPct: c.targetPct,
        stopPct: c.stopPct,
      });
    }

    await ctx.runMutation(internal.growwStore.putAgentIdeas, {
      date,
      generatedAt: Date.now(),
      model: MODEL,
      payload: JSON.stringify({ ideas, marketContext: parsed.marketContext, sectorDataAt: snap?.updatedAt ?? null, sectorAsOf: sect.fetchedAtIST }),
    });

    return { generated: ideas.length };
  },
});

// ---------------- Idea outcome tracking ----------------

// Mark every open idea (across all saved sets) with its live premium, peak/trough
// since entry, P&L %, and a locked status: target hit / stopped / expired / open.
// Peak & trough accumulate across polls so a target/stop touch is caught even if
// the premium later reverts. Runs on a cron during market hours + on demand.
export const trackIdeas = action({
  args: {},
  handler: async (ctx): Promise<{ tracked: number }> => {
    const rows = (await ctx.runQuery(internal.growwStore.listIdeaRows, {})) as Array<{ id: string; date: string; payload: string }>;
    const today = istDay();

    // Collect symbols of ideas that aren't already terminal.
    const symbols = new Set<string>();
    const parsedRows = rows.map((row) => {
      let p: { ideas?: Array<Record<string, unknown>> } = {};
      try { p = JSON.parse(row.payload); } catch { p = {}; }
      for (const it of p.ideas ?? []) {
        const st = it.status as string | undefined;
        if (it.symbol && st !== "target" && st !== "stopped" && st !== "expired") symbols.add(String(it.symbol));
      }
      return { row, p };
    });
    if (!symbols.size) return { tracked: 0 };

    const ltps = (await ctx.runAction(internal.groww.quoteFnoLtps, { symbols: [...symbols] })) as Record<string, number>;

    let tracked = 0;
    for (const { row, p } of parsedRows) {
      let changed = false;
      for (const it of p.ideas ?? []) {
        const st = it.status as string | undefined;
        if (st === "target" || st === "stopped" || st === "expired") continue;

        const entry = Number(it.ltp ?? 0);
        const target = Number(it.target ?? 0);
        const stop = Number(it.stop ?? 0);
        const expiry = String(it.expiry ?? "");
        const now = ltps[String(it.symbol)];
        const expired = expiry && expiry < today;

        if (now != null && now > 0) {
          it.nowLtp = now;
          it.nowPnlPct = entry ? Math.round(((now - entry) / entry) * 100) : 0;
          it.peakLtp = Math.max(Number(it.peakLtp ?? entry ?? now), now);
          it.troughLtp = Math.min(Number(it.troughLtp ?? entry ?? now), now);
        }

        const peak = Number(it.peakLtp ?? entry);
        const trough = Number(it.troughLtp ?? entry);
        if (target && peak >= target) it.status = "target";
        else if (stop && trough <= stop) it.status = "stopped";
        else if (expired) it.status = "expired";
        else it.status = "open";
        it.trackedAt = Date.now();
        changed = true;
        tracked++;
      }
      if (changed) await ctx.runMutation(internal.growwStore.setIdeasPayload, { id: row.id as Id<"agentIdeas">, payload: JSON.stringify(p) });
    }
    return { tracked };
  },
});
