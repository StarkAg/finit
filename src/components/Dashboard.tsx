import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useQuery } from "convex/react";
import {
  Bar, BarChart, Cell, Legend, Line, LineChart, Pie, PieChart, Tooltip, XAxis, YAxis,
} from "recharts";
import { api } from "../../convex/_generated/api";
import { budgetCalc, tradeCalc, withRunningBalance, LEDGER_ACCOUNTS, type BudgetRow, type TradeRow, type LedgerRow } from "../lib/calc";
import { money, pct } from "../lib/format";
import { Stat } from "./ui";

const COLORS = ["#d8b45a", "#f5f5f5", "#737373", "#2dd4bf", "#fb7185", "#f59e0b"];

export default function Dashboard({ go }: { go: (t: string) => void }) {
  const budgetData = useQuery(api.budget.list);
  const swingData = useQuery(api.swing.list);
  const yearlyData = useQuery(api.yearly.list);
  const ledgerData = useQuery(api.ledger.list);

  const budget = useMemo(() => (budgetData ?? []) as BudgetRow[], [budgetData]);
  const swing = useMemo(() => (swingData ?? []) as TradeRow[], [swingData]);
  const yearly = useMemo(() => (yearlyData ?? []) as TradeRow[], [yearlyData]);
  const ledger = useMemo(() => (ledgerData ?? []) as LedgerRow[], [ledgerData]);

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

  // Budget allocation from the latest month
  const latest = budget[budget.length - 1];
  const alloc = latest ? budgetCalc(latest) : null;
  const allocData = alloc
    ? [
        { name: "Expenses", value: Math.max(0, alloc.expenses) },
        { name: "Want", value: Math.max(0, alloc.want) },
        { name: "Investment", value: Math.max(0, alloc.investment) },
        { name: "Saving", value: Math.max(0, alloc.saving) },
        { name: "Fixed", value: Math.max(0, alloc.fixed) },
        { name: "Extra", value: Math.max(0, latest.extra) },
      ].filter((d) => d.value > 0)
    : [];

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

  const ledgerBalances = LEDGER_ACCOUNTS.map((a) => {
    const rows = withRunningBalance(ledger.filter((r) => r.account === a));
    const last = rows.length ? rows[rows.length - 1] : null;
    return { name: a, balance: last ? Math.abs(last.balance) : 0 };
  });
  const hasLedgerBalances = ledgerBalances.some((r) => r.balance > 0);

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl font-bold text-slate-100">Dashboard</h2>
        <p className="text-sm text-muted">Overview across budget, trading and ledger.</p>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Total Net P/L" value={money(totalNet)} tone={totalNet >= 0 ? "good" : "bad"} sub={pct(totalInvested ? totalNet / totalInvested : 0)} />
        <Stat label="Capital invested" value={money(totalInvested)} sub={`${swing.length + yearly.length} positions`} />
        <Stat label="Swing win rate" value={pct(s.winRate)} sub={`${s.wins}/${s.closed} closed`} />
        <Stat label="Monthly income" value={money(alloc?.income ?? 0)} sub={latest ? latest.date : "—"} />
      </div>

      <div className="grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="card min-w-0 p-3 sm:p-4 lg:col-span-2">
          <div className="mb-2 text-sm font-semibold text-slate-100">Swing equity curve (cumulative net P/L)</div>
          {equity.length ? (
            <ChartBox>
              {({ width, height }) => (
                <LineChart width={width} height={height} data={equity} margin={{ left: 0, right: 4, top: 8, bottom: 0 }}>
                  <XAxis dataKey="date" stroke="#9a9a9a" fontSize={11} />
                  <YAxis stroke="#9a9a9a" fontSize={11} width={42} />
                  <Tooltip contentStyle={tooltipStyle} formatter={tooltipMoney} />
                  <Line type="monotone" dataKey="pnl" stroke="#d8b45a" strokeWidth={2} dot={false} />
                </LineChart>
              )}
            </ChartBox>
          ) : (
            <div className="h-52 min-w-0 sm:h-64"><Empty /></div>
          )}
        </div>

        <div className="card min-w-0 p-3 sm:p-4">
          <div className="mb-2 text-sm font-semibold text-slate-100">Latest budget allocation</div>
          {allocData.length ? (
            <ChartBox>
              {({ width, height }) => (
                <PieChart width={width} height={height}>
                  <Pie data={allocData} dataKey="value" nameKey="name" innerRadius={40} outerRadius={68} paddingAngle={2}>
                    {allocData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                  </Pie>
                  <Tooltip contentStyle={tooltipStyle} formatter={tooltipMoney} />
                  <Legend wrapperStyle={{ fontSize: 10, color: "#9a9a9a" }} />
                </PieChart>
              )}
            </ChartBox>
          ) : (
            <div className="h-52 min-w-0 sm:h-64"><Empty /></div>
          )}
        </div>
      </div>

      <div className="grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="card min-w-0 p-3 sm:p-4">
          <div className="mb-2 text-sm font-semibold text-slate-100">Ledger balances</div>
          {hasLedgerBalances ? (
            <ChartBox className="h-52 min-w-0 sm:h-56">
              {({ width, height }) => (
                <BarChart width={width} height={height} data={ledgerBalances} margin={{ left: 0, right: 4, top: 8, bottom: 0 }}>
                  <XAxis dataKey="name" stroke="#9a9a9a" fontSize={9} interval={0} angle={-20} textAnchor="end" height={54} />
                  <YAxis stroke="#9a9a9a" fontSize={11} width={42} />
                  <Tooltip contentStyle={tooltipStyle} formatter={tooltipMoney} cursor={{ fill: "#ffffff0d" }} />
                  <Bar dataKey="balance" radius={[4, 4, 0, 0]}>
                    {ledgerBalances.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                  </Bar>
                </BarChart>
              )}
            </ChartBox>
          ) : (
            <div className="h-52 min-w-0 sm:h-56"><Empty /></div>
          )}
        </div>

        <div className="card min-w-0 p-3 sm:p-4">
          <div className="mb-3 text-sm font-semibold text-slate-100">Trading breakdown</div>
          <div className="space-y-3">
            <Row label="Swing — net P/L" value={money(s.net)} tone={s.net} onClick={() => go("swing")} sub={`${money(s.invested)} invested`} />
            <Row label="Yearly — net P/L" value={money(y.net)} tone={y.net} onClick={() => go("yearly")} sub={`${money(y.invested)} invested`} />
            <Row label="Current portfolio value" value={money(s.value + y.value)} tone={0} sub="mark-to-market" />
          </div>
        </div>
      </div>
    </div>
  );
}

const tooltipStyle = { background: "#0d0d0d", border: "1px solid #2a2a2a", borderRadius: 4, color: "#f5f5f5", fontSize: 12 };
const tooltipMoney = (v: unknown) => money(Number(v));

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

function Row({ label, value, sub, tone, onClick }: { label: string; value: string; sub?: string; tone: number; onClick?: () => void }) {
  const cls = tone > 0 ? "text-good" : tone < 0 ? "text-bad" : "text-slate-100";
  return (
    <button onClick={onClick} className="flex w-full items-center justify-between gap-3 rounded border border-line bg-panel2/40 px-3 py-2.5 text-left hover:bg-panel2">
      <div className="min-w-0">
        <div className="text-sm font-medium text-slate-200">{label}</div>
        {sub && <div className="text-xs text-muted">{sub}</div>}
      </div>
      <div className={`shrink-0 text-right text-base font-bold sm:text-lg ${cls}`}>{value}</div>
    </button>
  );
}
