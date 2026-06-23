"use node";

import { action } from "./_generated/server";
import { api } from "./_generated/api";

// Server-side sector-rotation scan — a port of scripts/sector-uptrend.mjs.
// (The script's "datacenter IPs are bot-blocked" warning turned out to be stale;
// Convex reaches Moneycontrol fine, so the scan can run on demand from the app.)
// Pulls cap-weighted sector returns (1d/5d/1m/3m) + advance/decline breadth, finds
// aligned uptrend sectors, and lists liquid red-today "dip in strength" names.

const MIN_BREADTH = 0.3;
const MIN_MCAP = 500; // ₹ Cr
const WEIGHTS = { m3: 0.4, m1: 0.35, w1: 0.25, breadth: 3 };

const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
  Accept: "application/json,text/html;q=0.9",
  "Accept-Language": "en-US,en;q=0.9",
  Referer: "https://www.moneycontrol.com/",
};
const API = "https://api.moneycontrol.com/mcapi/v1/sector/performance";
const PAGE = "https://www.moneycontrol.com/markets/sector-analysis";

const num = (v: unknown): number | null => {
  const n = parseFloat(String(v ?? "").replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(n) ? n : null;
};

// Deep-walk a __NEXT_DATA__ tree for the largest array of objects matching a probe.
function findArray(root: unknown, probe: (o: Record<string, unknown>) => boolean): Record<string, unknown>[] {
  let best: Record<string, unknown>[] = [];
  const seen = new Set<unknown>();
  (function walk(n: unknown) {
    if (!n || typeof n !== "object" || seen.has(n)) return;
    seen.add(n);
    if (Array.isArray(n)) {
      const first = n[0] as Record<string, unknown> | undefined;
      if (first && typeof first === "object" && probe(first) && n.length > best.length) best = n as Record<string, unknown>[];
      n.forEach(walk);
    } else {
      Object.values(n as Record<string, unknown>).forEach(walk);
    }
  })(root);
  return best;
}

async function returns(dur: string): Promise<Record<string, number>> {
  const res = await fetch(`${API}?dur=${dur}&type=top&section=sector&limit=60`, { headers: HEADERS });
  if (!res.ok) throw new Error(`Moneycontrol sector API HTTP ${res.status} (dur=${dur}) — blocked or changed.`);
  const j = (await res.json()) as { success?: number; data?: Array<{ sector: string; mcapPerChange: number }> };
  if (j.success !== 1 || !Array.isArray(j.data)) throw new Error(`Unexpected sector API payload (dur=${dur}).`);
  return Object.fromEntries(j.data.map((r) => [r.sector, r.mcapPerChange]));
}

async function nextData(url: string): Promise<unknown> {
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
  const html = await res.text();
  const m = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) throw new Error(`No __NEXT_DATA__ at ${url}`);
  return JSON.parse(m[1]);
}

type Meta = { breadth: number; trend: string; slug: string | null };

async function breadthAndTrend(): Promise<Record<string, Meta>> {
  const rows = findArray(await nextData(PAGE), (o) => "sector" in o && "advance" in o);
  const map: Record<string, Meta> = {};
  for (const r of rows) {
    const advance = Number(r.advance ?? 0);
    const decline = Number(r.decline ?? 0);
    const tot = advance + decline;
    map[String(r.sector)] = {
      breadth: tot ? (advance - decline) / tot : 0,
      trend: String(r.trend ?? ""),
      slug: r.slug ? String(r.slug) : null,
    };
  }
  return map;
}

async function sectorStocks(slug: string) {
  const rows = findArray(await nextData(`${PAGE}/${slug}/`), (o) => "stockName" in o && "perChange" in o);
  return rows.map((r) => ({
    name: String(r.stockName ?? ""),
    scId: String(r.scId ?? ""),
    price: num(r.currPrice),
    chg: num(r.perChange),
    mcap: num(r.marketCap),
    trend: String(r.techTrend ?? ""),
  }));
}

async function scan() {
  const [d1, w1, m1, m3, meta] = await Promise.all([
    returns("1d"), returns("5d"), returns("1m"), returns("3m"), breadthAndTrend(),
  ]);

  const sectors = [...new Set([...Object.keys(m1), ...Object.keys(m3)])]
    .map((s) => {
      const b = meta[s] || { breadth: 0, trend: "", slug: null };
      return { s, d1: d1[s] ?? null, w1: w1[s] ?? null, m1: m1[s] ?? null, m3: m3[s] ?? null, ...b };
    })
    .filter((x) => (x.m3 ?? 0) > 0 && (x.m1 ?? 0) > 0 && (x.w1 ?? 0) > 0)
    .map((x) => ({
      ...x,
      score: +((x.m3! * WEIGHTS.m3) + (x.m1! * WEIGHTS.m1) + (x.w1! * WEIGHTS.w1) + (x.breadth * WEIGHTS.breadth)).toFixed(2),
    }))
    .sort((a, b) => b.score - a.score);

  const broad = sectors.filter((x) => x.breadth >= MIN_BREADTH);

  const picks = await Promise.all(
    broad.map(async (sec) => {
      const stocks = sec.slug
        ? (await sectorStocks(sec.slug))
            .filter((st) => st.chg !== null && st.chg < 0 && st.mcap !== null && st.mcap >= MIN_MCAP)
            .sort((a, b) => (a.chg ?? 0) - (b.chg ?? 0))
        : [];
      return { sector: sec, stocks };
    }),
  );

  const now = Date.now();
  const fetchedAtIST = new Date(now + 5.5 * 3600_000).toISOString().replace("T", " ").slice(0, 16) + " IST";
  return { payload: { ranked: sectors, broad, picks, fetchedAtIST }, updatedAt: now, broadCount: broad.length, fetchedAtIST };
}

// Run the scan and store it as the live sector snapshot.
export const runSectorScan = action({
  args: {},
  handler: async (ctx): Promise<{ broad: number; sectors: number; fetchedAtIST: string }> => {
    const { payload, updatedAt, broadCount, fetchedAtIST } = await scan();
    await ctx.runMutation(api.sector.push, { updatedAt, payload: JSON.stringify(payload) });
    return { broad: broadCount, sectors: payload.ranked.length, fetchedAtIST };
  },
});

// ---------------------------------------------------------------------------
// "Aditya's Sector" — the original Moneycontrol top-10 method.
// Take the 1d top-10 sectors and the 5d top-10 sectors; the ones in BOTH lists
// are confirmed uptrends (a 1-day pop without a 5-day trend behind it isn't
// real). Also rank every listed sector by combined bullishness.
// ---------------------------------------------------------------------------

type RankedSector = { sector: string; change: number; rank: number };

// The sector API's `type` is one of "top" (gainers) or "under" (losers). To
// rank high→low across ALL sectors (so the top-10 is real even on a red day),
// fetch both halves and merge.
async function half(dur: string, type: "top" | "under"): Promise<Record<string, number>> {
  const res = await fetch(`${API}?dur=${dur}&type=${type}&section=sector&limit=60`, { headers: HEADERS });
  if (!res.ok) throw new Error(`Moneycontrol sector API HTTP ${res.status} (dur=${dur}, type=${type}).`);
  const j = (await res.json()) as { success?: number; data?: Array<{ sector: string; mcapPerChange: number }> };
  if (j.success !== 1 || !Array.isArray(j.data)) return {};
  return Object.fromEntries(j.data.map((r) => [r.sector, r.mcapPerChange]));
}

async function allReturns(dur: string): Promise<Record<string, number>> {
  const [top, under] = await Promise.all([half(dur, "top"), half(dur, "under")]);
  return { ...under, ...top };
}

async function adityaScan() {
  const [d1map, d5map] = await Promise.all([allReturns("1d"), allReturns("5d")]);

  const top10 = (m: Record<string, number>): RankedSector[] =>
    Object.entries(m)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([sector, change], i) => ({ sector, change: +change.toFixed(2), rank: i + 1 }));

  const d1 = top10(d1map);
  const d5 = top10(d5map);
  const d1Rank = new Map(d1.map((r) => [r.sector, r.rank]));
  const d5Rank = new Map(d5.map((r) => [r.sector, r.rank]));

  // Sectors present in both top-10s, ordered by their 5d rank (the established trend).
  const both = d5.filter((r) => d1Rank.has(r.sector)).map((r) => r.sector);

  const union = [...new Set([...d1, ...d5].map((r) => r.sector))];
  const ranking = union
    .map((sector) => {
      const r1 = d1Rank.get(sector) ?? null;
      const r5 = d5Rank.get(sector) ?? null;
      // Bullishness: rank 1 in a list = 10 pts, rank 10 = 1 pt. A sector in both
      // top-10s can reach 20, so confirmed uptrends float to the top.
      const score = (r1 ? 11 - r1 : 0) + (r5 ? 11 - r5 : 0);
      return {
        sector,
        d1: d1map[sector] != null ? +d1map[sector].toFixed(2) : null,
        d5: d5map[sector] != null ? +d5map[sector].toFixed(2) : null,
        d1Rank: r1,
        d5Rank: r5,
        inBoth: r1 != null && r5 != null,
        score,
      };
    })
    .sort((a, b) => b.score - a.score || (b.d5 ?? -999) - (a.d5 ?? -999) || (b.d1 ?? -999) - (a.d1 ?? -999))
    .map((r, i) => ({ ...r, bullRank: i + 1 }));

  const now = Date.now();
  const fetchedAtIST = new Date(now + 5.5 * 3600_000).toISOString().replace("T", " ").slice(0, 16) + " IST";
  return { payload: { d1, d5, both, ranking, fetchedAtIST }, updatedAt: now };
}

// Refresh button on the Aditya's Sector tab: scan 1d/5d top-10 and store it.
export const runAdityaScan = action({
  args: {},
  handler: async (ctx): Promise<{ both: number; fetchedAtIST: string }> => {
    const { payload, updatedAt } = await adityaScan();
    await ctx.runMutation(api.adityaSector.push, { updatedAt, payload: JSON.stringify(payload) });
    return { both: payload.both.length, fetchedAtIST: payload.fetchedAtIST };
  },
});

// The button flow: scan fresh sector data, then generate today's option ideas off it.
export const scanAndGenerate = action({
  args: {},
  handler: async (ctx): Promise<{ broad: number; generated: number; skipped?: string }> => {
    const { payload, updatedAt, broadCount } = await scan();
    await ctx.runMutation(api.sector.push, { updatedAt, payload: JSON.stringify(payload) });
    const ideas = await ctx.runAction(api.agent.generateIdeas, {});
    return { broad: broadCount, ...ideas };
  },
});
