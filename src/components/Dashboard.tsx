import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useQuery } from "convex/react";
import {
  Bar, BarChart, Cell, LabelList, Line, LineChart, XAxis, YAxis,
} from "recharts";
import { api } from "../../convex/_generated/api";
import { budgetCalc, tradeCalc, type BudgetRow, type TradeRow } from "../lib/calc";
import { money, pct } from "../lib/format";
import { useGrowwHoldings } from "../lib/useGrowwHoldings";
import { Stat, Count } from "./ui";

export default function Dashboard() {
  const budgetData = useQuery(api.budget.list);
  const swingData = useQuery(api.swing.list);
  const yearlyData = useQuery(api.yearly.list);

  const budget = useMemo(() => (budgetData ?? []) as BudgetRow[], [budgetData]);
  const swing = useMemo(() => (swingData ?? []) as TradeRow[], [swingData]);
  const yearly = useMemo(() => (yearlyData ?? []) as TradeRow[], [yearlyData]);

  const swingC = useMemo(() => swing.map((r) => tradeCalc(r)), [swing]);
  const yearlyC = useMemo(() => yearly.map((r) => tradeCalc(r)), [yearly]);

  const agg = (arr: ReturnType<typeof tradeCalc>[]) => {
    let invested = 0, net = 0, value = 0, wins = 0, closed = 0;
    for (const c of arr) {
      invested += c.invested; net += c.netProfit; value += c.netValue;
      if (c.closed) { closed++; if (c.netProfit > 0) wins++; }
    }
    return { invested, net, value, wins, closed, winRate: closed ? wins / closed : 0 };
  };
  const s = agg(swingC), y = agg(yearlyC);
  const totalNet = s.net + y.net;
  const totalInvested = s.invested + y.invested;

  // Headline portfolio stats come from live Groww holdings (actual invested,
  // positions, current value, unrealized P/L). Fall back to the journal only if
  // holdings can't be loaded (e.g. token not set).
  const h = useGrowwHoldings();
  const real = !h.loading && !h.err && h.totals.count > 0;
  const investedView = real ? h.totals.invested : totalInvested;
  const positionsView = real ? h.totals.count : swing.length + yearly.length;
  const netView = real ? h.totals.pnl : totalNet;
  const netPctView = real ? h.totals.pnlPct : totalInvested ? totalNet / totalInvested : 0;

  // Budget allocation from the latest month (drives the Monthly income stat)
  const latest = budget[budget.length - 1];
  const alloc = latest ? budgetCalc(latest) : null;

  // Month-wise realized net P/L (closed swing + yearly trades, grouped by sell month)
  const monthly = useMemo(() => {
    const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const byMonth = new Map<string, number>();
    for (const r of [...swing, ...yearly]) {
      const c = tradeCalc(r);
      if (!c.closed || !r.sellDate) continue;
      const key = r.sellDate.slice(0, 7); // YYYY-MM
      byMonth.set(key, (byMonth.get(key) ?? 0) + c.netProfit);
    }
    return [...byMonth.entries()]
      .sort((a, b) => (a[0] < b[0] ? -1 : 1))
      .map(([key, pnl]) => {
        const [yr, mo] = key.split("-");
        return { month: `${MONTHS[Number(mo) - 1]} '${yr.slice(2)}`, pnl: Math.round(pnl) };
      });
  }, [swing, yearly]);

  // Y-axis domain with headroom on both ends so value labels never clip
  const pnlDomain = useMemo(() => {
    const vals = monthly.map((d) => d.pnl);
    const max = Math.max(0, ...vals);
    const min = Math.min(0, ...vals);
    const pad = Math.max(80, (max - min) * 0.22);
    return [Math.round(min - pad), Math.round(max + pad)] as [number, number];
  }, [monthly]);

  // Swing cumulative P/L over time (by sell date)
  const equity = useMemo(() => {
    const closed = swing
      .map((r) => ({ r, c: tradeCalc(r) }))
      .filter(({ c }) => c.closed)
      .sort((a, b) => (a.r.sellDate! < b.r.sellDate! ? -1 : 1));
    return closed.map(({ r }, i) => ({
      date: r.sellDate!.slice(5),
      pnl: Math.round(closed.slice(0, i + 1).reduce((sum, { c }) => sum + c.netProfit, 0)),
    }));
  }, [swing]);

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl font-bold text-slate-100">Dashboard</h2>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {/* While Groww holdings load, show a placeholder rather than the journal
            fallback — otherwise the cards flash ~33 positions / ₹1.77L before
            snapping to the real holdings. */}
        <Stat
          label={h.loading || real ? "Holdings P/L (unrealized)" : "Total Net P/L"}
          value={h.loading ? <span className="text-muted">…</span> : <Count value={netView} format={money} />}
          tone={netView >= 0 ? "good" : "bad"}
          sub={h.loading ? "loading…" : pct(netPctView)}
        />
        <Stat
          label="Capital invested"
          value={h.loading ? <span className="text-muted">…</span> : <Count value={investedView} format={money} />}
          sub={h.loading ? "—" : `${positionsView} ${real ? "holdings" : "positions"}`}
        />
        <Stat label="Swing win rate" value={<Count value={s.winRate} format={pct} />} sub={`${s.wins}/${s.closed} closed`} />
        <Stat label="Monthly income" value={<Count value={alloc?.income ?? 0} format={money} />} sub={latest ? latest.date : "—"} />
      </div>

      <div className="card min-w-0 p-3 sm:p-4">
        <div className="mb-2 text-sm font-semibold text-slate-100">Swing equity curve (cumulative net P/L)</div>
        {equity.length ? (
          <ChartBox>
            {({ width, height }) => (
              <LineChart width={width} height={height} data={equity} margin={{ left: 0, right: 4, top: 8, bottom: 0 }}>
                <XAxis dataKey="date" stroke="#9a9a9a" fontSize={11} minTickGap={24} />
                <YAxis stroke="#9a9a9a" fontSize={11} width={42} />
                <Line type="monotone" dataKey="pnl" stroke="#d8b45a" strokeWidth={2} dot={false} isAnimationActive animationDuration={1100} animationEasing="ease-out" />
              </LineChart>
            )}
          </ChartBox>
        ) : (
          <div className="h-52 min-w-0 sm:h-64"><Empty /></div>
        )}
      </div>

      <div className="card min-w-0 p-3 sm:p-4">
        <div className="mb-2 text-sm font-semibold text-slate-100">Month-wise realized P/L</div>
        {monthly.length ? (
          <ChartBox className="h-52 min-w-0 sm:h-64">
            {({ width, height }) => (
              <BarChart width={width} height={height} data={monthly} margin={{ left: 0, right: 4, top: 16, bottom: 4 }}>
                <XAxis dataKey="month" stroke="#9a9a9a" fontSize={11} interval={0} />
                <YAxis stroke="#9a9a9a" fontSize={11} width={42} domain={pnlDomain} />
                <Bar dataKey="pnl" radius={[4, 4, 0, 0]} isAnimationActive animationDuration={1000} animationEasing="ease-out">
                  {monthly.map((d, i) => <Cell key={i} fill={d.pnl >= 0 ? "#2dd4bf" : "#fb7185"} />)}
                  <LabelList
                    dataKey="pnl"
                    position="top"
                    offset={8}
                    fill="#f5f5f5"
                    fontSize={12}
                    fontWeight={700}
                    formatter={(v) => money(Number(v))}
                  />
                </Bar>
              </BarChart>
            )}
          </ChartBox>
        ) : (
          <div className="h-52 min-w-0 sm:h-64"><Empty /></div>
        )}
      </div>

    </div>
  );
}

function ChartBox({
  children,
  className = "h-52 min-w-0 sm:h-64",
}: {
  children: (size: { width: number; height: number }) => ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    const node = ref.current;
    if (!node) return;

    const update = () => {
      const next = { width: node.clientWidth, height: node.clientHeight };
      if (next.width > 0 && next.height > 0) setSize(next);
    };
    update();

    const observer = new ResizeObserver(update);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={ref} className={className}>
      {size.width > 0 && size.height > 0 ? children(size) : <Empty />}
    </div>
  );
}

function Empty() {
  return <div className="flex h-full items-center justify-center text-sm text-muted">No data yet</div>;
}

