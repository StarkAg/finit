import { useMemo, useState } from "react";
import { useQuery, useAction } from "convex/react";
import { api } from "../../convex/_generated/api";
import { Icon } from "./icons";

// ---- Position review (existing) ----
type Verdict = {
  symbol: string;
  action: "HOLD" | "TRIM" | "EXIT";
  confidence: "low" | "medium" | "high";
  reason: string;
};
type Review = {
  summary: string;
  verdicts: Verdict[];
  model: string;
  marketOpen: boolean;
  basedOnSnapshotAt: number | null;
};

// ---- Daily option ideas ----
type Idea = {
  rank: number;
  underlying: string;
  nseSymbol: string;
  sector: string;
  optionType: "CE" | "PE";
  conviction: "low" | "medium" | "high";
  rationale: string;
  symbol: string;
  strike: number;
  expiry: string;
  lotSize: number;
  spot: number;
  ltp: number;
  entryLow: number;
  entryHigh: number;
  target: number;
  stop: number;
  // tracking (filled by the tracker cron)
  nowLtp?: number;
  nowPnlPct?: number;
  peakLtp?: number;
  troughLtp?: number;
  status?: "open" | "target" | "stopped" | "expired";
  trackedAt?: number;
};

const statusStyle: Record<NonNullable<Idea["status"]>, string> = {
  target: "bg-good/15 text-good",
  stopped: "bg-bad/15 text-bad",
  expired: "bg-panel2 text-muted",
  open: "bg-amber-500/15 text-amber-400",
};
const statusLabel: Record<NonNullable<Idea["status"]>, string> = {
  target: "✓ Target hit",
  stopped: "✗ Stopped",
  expired: "Expired",
  open: "Open",
};
type Ideas = { ideas: Idea[]; marketContext: string; sectorAsOf?: string; stale?: boolean };
type IdeaDay = { date: string; generatedAt: number; model: string; payload: string };

const actionStyle: Record<Verdict["action"], string> = {
  EXIT: "bg-bad/15 text-bad",
  TRIM: "bg-amber-500/15 text-amber-400",
  HOLD: "bg-good/15 text-good",
};
const convStyle: Record<Idea["conviction"], string> = {
  high: "text-good",
  medium: "text-amber-400",
  low: "text-muted",
};

const prem = (n: number) => `₹${n.toFixed(2)}`;
const money = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;

function ago(ms: number) {
  const m = Math.round((Date.now() - ms) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  return h < 24 ? `${h}h ago` : `${Math.round(h / 24)}d ago`;
}
const parse = <T,>(s: string | undefined): T | null => {
  if (!s) return null;
  try { return JSON.parse(s) as T; } catch { return null; }
};

export default function AgentPanel() {
  const reviewSnap = useQuery(api.growwStore.agentReview);
  const ideasSnap = useQuery(api.growwStore.agentIdeas) as IdeaDay | null | undefined;
  const history = useQuery(api.growwStore.agentIdeasHistory) as IdeaDay[] | undefined;
  const runReview = useAction(api.agent.reviewPositions);
  const scanAndGenerate = useAction(api.sectorScan.scanAndGenerate);

  const [running, setRunning] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const review = useMemo(() => parse<Review>(reviewSnap?.payload), [reviewSnap]);
  const today = useMemo(() => parse<Ideas>(ideasSnap?.payload), [ideasSnap]);

  async function onReview() {
    setRunning(true); setErr(null);
    try { await runReview({}); } catch (e) { setErr(e instanceof Error ? e.message : "Review failed"); } finally { setRunning(false); }
  }
  async function onGenerate() {
    setGenerating(true); setErr(null);
    try { await scanAndGenerate({}); } catch (e) { setErr(e instanceof Error ? e.message : "Scan / idea generation failed"); } finally { setGenerating(false); }
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2">
        <Icon name="bot" className="h-5 w-5 text-brand" />
        <h2 className="text-xl font-bold text-slate-100">Agent</h2>
      </div>

      {/* Goal banner */}
      <div className="card flex items-center gap-3 p-3 text-sm">
        <span className="rounded-full bg-brand/15 px-2.5 py-0.5 text-xs font-bold text-brand">GOAL</span>
        <span className="text-slate-300">Find the best option to trade today &amp; protect capital. Everything here is a proposal — you place orders yourself.</span>
      </div>

      {err && <div className="card border-bad/40 p-3 text-sm text-bad">{err}</div>}

      {/* ---------- Best options to trade today ---------- */}
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-base font-bold text-slate-100">Best options to trade today</h3>
            {ideasSnap && (
              <span className="text-xs text-muted">
                {ideasSnap.date}
                {today?.sectorAsOf ? ` · scan ${today.sectorAsOf}` : ""} · {ago(ideasSnap.generatedAt)}
              </span>
            )}
          </div>
          <button
            onClick={onGenerate}
            disabled={generating}
            className="rounded-lg bg-brand/15 px-3 py-1.5 text-sm font-semibold text-brand transition-colors hover:bg-brand/25 disabled:opacity-50"
          >
            {generating ? "Scanning market…" : "Scan & generate ideas"}
          </button>
        </div>

        {ideasSnap === undefined ? (
          <div className="text-sm text-muted">Loading…</div>
        ) : !today || today.ideas.length === 0 ? (
          <div className={`card p-5 text-sm ${today?.stale ? "border-amber-500/40 text-amber-300" : "text-muted"}`}>
            {today?.stale && <span className="font-semibold">⚠ Stale scan — no ideas generated. </span>}
            {today?.marketContext ?? (
              <>No ideas yet. Hit <span className="text-brand">Scan &amp; generate ideas</span> to pull fresh sector data and rank today&apos;s best option trades.</>
            )}
          </div>
        ) : (
          <>
            {today.marketContext && (
              <div className="card p-3 text-sm text-slate-300">{today.marketContext}</div>
            )}
            <div className="space-y-2">
              {today.ideas.map((it) => (
                <IdeaCard key={it.symbol} it={it} />
              ))}
            </div>
          </>
        )}

        {/* History */}
        {history && history.length > 0 && (
          <div>
            <button
              onClick={() => setShowHistory((s) => !s)}
              className="text-xs font-medium text-muted hover:text-slate-200"
            >
              {showHistory ? "▾" : "▸"} History ({history.length} day{history.length === 1 ? "" : "s"})
            </button>
            {showHistory && (
              <div className="mt-2 space-y-3">
                {history.map((d) => {
                  const p = parse<Ideas>(d.payload);
                  return (
                    <div key={d.date} className="card p-3">
                      <div className="mb-1.5 text-xs font-semibold text-muted">{d.date}</div>
                      {p && p.ideas.length ? (
                        <div className="space-y-1">
                          {p.ideas.map((it) => (
                            <div key={it.symbol} className="flex items-center justify-between gap-2 text-xs">
                              <span className="truncate text-slate-300">
                                #{it.rank} {it.underlying} {it.strike} {it.optionType}
                              </span>
                              <span className="flex shrink-0 items-center gap-2 tabular-nums text-muted">
                                <span>@ {prem(it.ltp)}{it.nowLtp != null ? ` → ${prem(it.nowLtp)}` : ""}</span>
                                {it.nowPnlPct != null && (
                                  <span className={(it.nowPnlPct ?? 0) >= 0 ? "text-good" : "text-bad"}>
                                    {(it.nowPnlPct ?? 0) >= 0 ? "+" : ""}{it.nowPnlPct}%
                                  </span>
                                )}
                                {it.status && (
                                  <span className={`rounded px-1 py-0.5 text-[9px] font-bold ${statusStyle[it.status]}`}>
                                    {statusLabel[it.status]}
                                  </span>
                                )}
                              </span>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="text-xs text-muted">{p?.marketContext ?? "No ideas."}</div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ---------- Open-position review ---------- */}
      <div className="space-y-3 border-t border-line/60 pt-5">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-base font-bold text-slate-100">Open-position review</h3>
          <div className="flex items-center gap-3">
            {reviewSnap && <span className="text-xs text-muted">reviewed {ago(reviewSnap.updatedAt)}</span>}
            <button
              onClick={onReview}
              disabled={running}
              className="rounded-lg bg-brand/15 px-3 py-1.5 text-sm font-semibold text-brand transition-colors hover:bg-brand/25 disabled:opacity-50"
            >
              {running ? "Reviewing…" : "Review now"}
            </button>
          </div>
        </div>

        {reviewSnap === undefined ? (
          <div className="text-sm text-muted">Loading…</div>
        ) : !review ? (
          <div className="card p-5 text-sm text-muted">
            No review yet. Hit <span className="text-brand">Review now</span> — or it runs automatically every 5 min during market hours.
          </div>
        ) : review.verdicts.length === 0 ? (
          <div className="card p-5 text-sm text-muted">{review.summary}</div>
        ) : (
          <>
            <div className="card p-3 text-sm text-slate-300">{review.summary}</div>
            <div className="space-y-2">
              {review.verdicts.map((v) => (
                <div key={v.symbol} className="card flex items-start justify-between gap-3 p-3">
                  <div className="min-w-0">
                    <div className="font-semibold text-slate-100">{v.symbol}</div>
                    <p className="mt-0.5 text-sm text-slate-300">{v.reason}</p>
                    <div className="mt-1 text-[11px] text-muted">confidence: {v.confidence}</div>
                  </div>
                  <span className={`shrink-0 rounded-full px-3 py-1 text-xs font-bold ${actionStyle[v.action]}`}>{v.action}</span>
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      <p className="px-1 text-xs text-muted">
        Powered by Claude (claude-opus-4-8). Read-only — ideas and verdicts are proposals; you place any orders yourself from the VM.
      </p>
    </div>
  );
}

function IdeaCard({ it }: { it: Idea }) {
  const best = it.rank === 1;
  return (
    <div className={`card p-3 ${best ? "ring-1 ring-brand/50" : ""}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${best ? "bg-brand/20 text-brand" : "bg-panel2 text-muted"}`}>
              #{it.rank}{best ? " BEST" : ""}
            </span>
            <span className="font-semibold text-slate-100">
              {it.underlying} {it.strike}
            </span>
            <span className={`rounded px-1.5 py-0.5 text-xs font-bold ${it.optionType === "CE" ? "bg-good/15 text-good" : "bg-bad/15 text-bad"}`}>
              {it.optionType}
            </span>
          </div>
          <div className="mt-0.5 text-[11px] text-muted">{it.sector}</div>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <span className={`text-xs font-bold ${convStyle[it.conviction]}`}>{it.conviction}</span>
          {it.status && (
            <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${statusStyle[it.status]}`}>
              {statusLabel[it.status]}
            </span>
          )}
        </div>
      </div>

      <p className="mt-2 text-sm text-slate-300">{it.rationale}</p>

      {it.nowLtp != null && (
        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
          <span className="text-muted">
            Now <span className="font-semibold tabular-nums text-slate-200">{prem(it.nowLtp)}</span>
          </span>
          <span className={`font-semibold tabular-nums ${(it.nowPnlPct ?? 0) >= 0 ? "text-good" : "text-bad"}`}>
            {(it.nowPnlPct ?? 0) >= 0 ? "+" : ""}{it.nowPnlPct}% vs entry
          </span>
          {it.peakLtp != null && <span className="text-muted">peak <span className="tabular-nums text-good">{prem(it.peakLtp)}</span></span>}
          {it.troughLtp != null && <span className="text-muted">low <span className="tabular-nums text-bad">{prem(it.troughLtp)}</span></span>}
        </div>
      )}

      <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs sm:grid-cols-4">
        <KV k="Premium" v={prem(it.ltp)} />
        <KV k="Entry" v={`${prem(it.entryLow)}–${prem(it.entryHigh)}`} />
        <KV k="Target" v={prem(it.target)} cls="text-good" />
        <KV k="Stop" v={prem(it.stop)} cls="text-bad" />
        <KV k="Spot" v={money(it.spot)} />
        <KV k="Expiry" v={it.expiry} />
        <KV k="Lot" v={String(it.lotSize)} />
        <KV k="Symbol" v={it.symbol} />
      </div>
    </div>
  );
}

function KV({ k, v, cls = "text-slate-200" }: { k: string; v: string; cls?: string }) {
  return (
    <div className="flex min-w-0 items-baseline justify-between gap-2">
      <span className="shrink-0 text-muted">{k}</span>
      <span className={`truncate text-right font-medium tabular-nums ${cls}`}>{v}</span>
    </div>
  );
}
