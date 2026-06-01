import { action } from "./_generated/server";
import { v } from "convex/values";

type YahooChartResponse = {
  chart?: {
    result?: Array<{
      meta?: {
        currency?: string;
        regularMarketPrice?: number;
        symbol?: string;
      };
      indicators?: {
        quote?: Array<{
          close?: Array<number | null>;
        }>;
      };
    }>;
    error?: {
      code?: string;
      description?: string;
    } | null;
  };
};

function lastNumber(values: Array<number | null> | undefined) {
  if (!values) return undefined;
  for (let i = values.length - 1; i >= 0; i--) {
    const value = values[i];
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return undefined;
}

async function fetchYahooPrice(symbol: string) {
  const url = `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=1d&interval=1m`;
  const res = await fetch(url, {
    headers: {
      Accept: "application/json",
      "User-Agent": "Mozilla/5.0",
    },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  const data = (await res.json()) as YahooChartResponse;
  const result = data.chart?.result?.[0];
  const price = result?.meta?.regularMarketPrice ?? lastNumber(result?.indicators?.quote?.[0]?.close);
  if (typeof price !== "number" || !Number.isFinite(price)) {
    throw new Error(data.chart?.error?.description ?? "No live price returned");
  }

  return {
    symbol,
    yahooSymbol: result?.meta?.symbol ?? symbol,
    price,
    currency: result?.meta?.currency ?? "INR",
  };
}

export const latest = action({
  args: {
    symbols: v.array(v.string()),
  },
  handler: async (_ctx, { symbols }) => {
    const uniqueSymbols = [...new Set(symbols.map((s) => s.trim().toUpperCase()).filter(Boolean))].slice(0, 50);
    const results = await Promise.allSettled(uniqueSymbols.map(fetchYahooPrice));

    return results.map((result, index) => {
      const symbol = uniqueSymbols[index];
      if (result.status === "fulfilled") return { ok: true as const, ...result.value };
      return { ok: false as const, symbol, error: result.reason instanceof Error ? result.reason.message : "Price fetch failed" };
    });
  },
});
