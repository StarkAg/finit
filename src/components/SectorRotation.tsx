import { useMemo } from "react";
import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";

// Shapes mirror scripts/sector-uptrend.mjs payload.
type Sector = {
  s: string;
  d1: number | null;
  w1: number | null;
  m1: number | null;
  m3: number | null;
  breadth: number;
  trend: string;
  slug: string | null;
  score: number;
};
type Pick = { sector: Sector; stocks: Stock[] };
type Stock = { name: string; scId: string; price: number | null; chg: number | null; mcap: number | null; trend: string };
type Payload = { ranked: Sector[]; broad: Sector[]; picks: Pick[]; fetchedAtIST: string };

const pctClass = (n: number | null | undefined) => (n == null ? "text-muted" : n > 0 ? "text-good" : n < 0 ? "text-bad" : "text-slate-300");
const pct = (n: number | null | undefined) => (n == null ? "—" : `${n > 0 ? "+" : ""}${n}%`);
const cr = (n: number | null) => (n == null ? "—" : n >= 100000 ? `₹${(n / 100000).toFixed(2)}L Cr` : `₹${n.toLocaleString("en-IN")} Cr`);
const trendClass = (t: string) =>
  /very bullish/i.test(t) ? "text-good" : /bullish/i.test(t) ? "text-good/80" : /bearish/i.test(t) ? "text-bad" : "text-muted";

function ago(ms: number) {
  const m = Math.round((Date.now() - ms) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  return h < 24 ? `${h}h ago` : `${Math.round(h / 24)}d ago`;
}

export default function SectorRotation() {
  const snap = useQuery(api.sector.get);
  const data = useMemo<Payload | null>(() => {
    if (!snap?.payload) return null;
    try { return JSON.parse(snap.payload) as Payload; } catch { return null; }
  }, [snap]);

  if (snap === undefined) return <Shell><div className="text-sm text-muted">Loading…</div></Shell>;
  if (!data) {
    return (
      <Shell>
        <div className="card p-5 text-sm text-muted">
          No snapshot yet. Run <code className="rounded bg-panel2 px-1.5 py-0.5 text-brand">node scripts/sector-uptrend.mjs --push</code> (or wait for the 15-min cron during market hours).
        </div>
      </Shell>
    );
  }

  const stale = Date.now() - (snap?.updatedAt ?? 0) > 45 * 60000;

  return (
    <Shell
      meta={
        <span className={stale ? "text-bad" : "text-muted"}>
          {data.fetchedAtIST} · {ago(snap!.updatedAt)}{stale ? " · stale" : ""}
        </span>
      }
    >
      {/* Buy candidates first — that's the actionable output */}
      <div className="card min-w-0 p-3 sm:p-4">
        <div className="mb-1 text-sm font-semibold text-slate-100">Dip-in-strength buy candidates</div>
        <div className="mb-3 text-xs text-muted">Broad sectors (breadth ≥ 30%) · stocks red today · mcap ≥ ₹500 Cr · biggest dip first</div>
        {data.picks.some((p) => p.stocks.length) ? (
          <div className="space-y-4">
            {data.picks.map((p) => (
              <div key={p.sector.s}>
                <div className="mb-1.5 flex items-baseline gap-2">
                  <span className="text-sm font-semibold text-slate-200">{p.sector.s}</span>
                  <span className="text-xs text-brand">breadth {(p.sector.breadth * 100).toFixed(0)}%</span>
                  <span className="text-xs text-muted">score {p.sector.score}</span>
                </div>
                {p.stocks.length ? (
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[460px] table-fixed text-sm">
                      {/* Shared fixed widths so every sector lines up column-for-column */}
                      <colgroup>
                        <col className="w-[30%]" />
                        <col className="w-[15%]" />
                        <col className="w-[17%]" />
                        <col className="w-[20%]" />
                        <col className="w-[18%]" />
                      </colgroup>
                      <thead>
                        <tr className="text-left text-xs text-muted">
                          <th className="py-1 pr-2 font-medium">Stock</th>
                          <th className="py-1 px-2 text-right font-medium">Today</th>
                          <th className="py-1 px-2 text-right font-medium">Price</th>
                          <th className="py-1 px-2 text-right font-medium">Mcap</th>
                          <th className="py-1 pl-2 text-right font-medium">Trend</th>
                        </tr>
                      </thead>
                      <tbody>
                        {p.stocks.map((st) => (
                          <tr key={st.scId} className="border-t border-line/60">
                            <td className="truncate py-1.5 pr-2 font-medium text-slate-200">{st.name}</td>
                            <td className={`py-1.5 px-2 text-right font-semibold ${pctClass(st.chg)}`}>{pct(st.chg)}</td>
                            <td className="py-1.5 px-2 text-right tabular-nums text-slate-300">₹{st.price?.toLocaleString("en-IN") ?? "—"}</td>
                            <td className="py-1.5 px-2 text-right tabular-nums text-muted">{cr(st.mcap)}</td>
                            <td className={`py-1.5 pl-2 text-right text-xs ${trendClass(st.trend)}`}>{st.trend || "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="text-xs text-muted">— no liquid red-today names —</div>
                )}
              </div>
            ))}
          </div>
        ) : (
          <div className="text-sm text-muted">No dips in the broad sectors right now — everything's green.</div>
        )}
      </div>

      {/* Full ranked sector table */}
      <div className="card min-w-0 p-3 sm:p-4">
        <div className="mb-1 text-sm font-semibold text-slate-100">Aligned uptrend sectors</div>
        <div className="mb-3 text-xs text-muted">Positive on 3M, 1M &amp; 1W · ranked by momentum + breadth · ◆ = broad</div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-sm">
            <thead>
              <tr className="text-left text-xs text-muted">
                <th className="py-1 pr-2 font-medium">Sector</th>
                <th className="py-1 px-2 text-right font-medium">3M</th>
                <th className="py-1 px-2 text-right font-medium">1M</th>
                <th className="py-1 px-2 text-right font-medium">1W</th>
                <th className="py-1 px-2 text-right font-medium">Breadth</th>
                <th className="py-1 px-2 text-right font-medium">Score</th>
                <th className="py-1 pl-2 text-right font-medium">Trend</th>
              </tr>
            </thead>
            <tbody>
              {data.ranked.map((x) => {
                const broad = x.breadth >= 0.3;
                return (
                  <tr key={x.s} className={`border-t border-line/60 ${broad ? "bg-brand/5" : ""}`}>
                    <td className="py-1.5 pr-2 font-medium text-slate-200">
                      {broad && <span className="mr-1 text-brand">◆</span>}{x.s}
                    </td>
                    <td className={`py-1.5 px-2 text-right ${pctClass(x.m3)}`}>{pct(x.m3)}</td>
                    <td className={`py-1.5 px-2 text-right ${pctClass(x.m1)}`}>{pct(x.m1)}</td>
                    <td className={`py-1.5 px-2 text-right ${pctClass(x.w1)}`}>{pct(x.w1)}</td>
                    <td className={`py-1.5 px-2 text-right tabular-nums ${x.breadth > 0 ? "text-good" : "text-bad"}`}>{(x.breadth * 100).toFixed(0)}%</td>
                    <td className="py-1.5 px-2 text-right font-semibold tabular-nums text-slate-200">{x.score}</td>
                    <td className={`py-1.5 pl-2 text-right text-xs ${trendClass(x.trend)}`}>{x.trend || "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <p className="px-1 text-xs text-muted">
        Heuristic sector-rotation screen from Moneycontrol data — not investment advice. Always check the actual chart before acting.
      </p>
    </Shell>
  );
}

function Shell({ children, meta }: { children: React.ReactNode; meta?: React.ReactNode }) {
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-xl font-bold text-slate-100">Sector Rotation</h2>
        {meta && <span className="text-xs">{meta}</span>}
      </div>
      {children}
    </div>
  );
}
