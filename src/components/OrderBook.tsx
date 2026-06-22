import { useMemo, useState } from "react";
import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { Icon } from "./icons";

type FnoOrder = {
  _id: string;
  growwOrderId: string;
  symbol: string;
  side: string;
  status: string;
  qty: number;
  price: number;
  date: string;
  time?: string;
  syncedAt: number;
};

const inr = (n: number) =>
  `₹${n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// BHARTIARTL26JUN1860CE → "BHARTIARTL 1860 CE"
function symbolToName(sym: string): string {
  const m = sym.match(/^(.+?)(\d{2}[A-Z]{3})(\d+)(CE|PE)$/);
  return m ? `${m[1]} ${m[3]} ${m[4]}` : sym;
}

// Group orders by symbol and compute aggregated P&L per contract.
function summarise(orders: FnoOrder[]) {
  const map: Record<string, { buys: FnoOrder[]; sells: FnoOrder[] }> = {};
  for (const o of orders) {
    if (!map[o.symbol]) map[o.symbol] = { buys: [], sells: [] };
    if (o.side === "BUY") map[o.symbol].buys.push(o);
    else map[o.symbol].sells.push(o);
  }
  return Object.entries(map).map(([symbol, { buys, sells }]) => {
    const totalBuyQty = buys.reduce((s, o) => s + o.qty, 0);
    const totalSellQty = sells.reduce((s, o) => s + o.qty, 0);
    const avgBuy = totalBuyQty
      ? buys.reduce((s, o) => s + o.price * o.qty, 0) / totalBuyQty
      : 0;
    const avgSell = totalSellQty
      ? sells.reduce((s, o) => s + o.price * o.qty, 0) / totalSellQty
      : 0;
    const closedQty = Math.min(totalBuyQty, totalSellQty);
    const booked = closedQty ? (avgSell - avgBuy) * closedQty : null;
    const openQty = totalBuyQty - totalSellQty;
    const firstBuy = [...buys].sort((a, b) => a.date.localeCompare(b.date))[0]?.date ?? "";
    const lastSell =
      totalSellQty >= totalBuyQty
        ? [...sells].sort((a, b) => b.date.localeCompare(a.date))[0]?.date ?? null
        : null;
    return { symbol, name: symbolToName(symbol), totalBuyQty, totalSellQty, avgBuy, avgSell, closedQty, booked, openQty, firstBuy, lastSell };
  });
}

export default function OrderBook() {
  const orders = useQuery(api.growwStore.fnoOrderBook) as FnoOrder[] | undefined;
  const [view, setView] = useState<"orders" | "summary">("orders");

  const summary = useMemo(() => (orders ? summarise(orders) : []), [orders]);

  const totalBooked = useMemo(
    () => summary.reduce((s, r) => s + (r.booked ?? 0), 0),
    [summary],
  );

  if (orders === undefined)
    return (
      <Shell>
        <div className="text-sm text-muted">Loading…</div>
      </Shell>
    );

  return (
    <Shell>
      {/* Toggle */}
      <div className="flex items-center gap-2">
        {(["orders", "summary"] as const).map((v) => (
          <button
            key={v}
            onClick={() => setView(v)}
            className={`rounded px-3 py-1 text-sm font-medium transition-colors ${
              view === v ? "bg-panel2 text-slate-100" : "text-muted hover:text-slate-200"
            }`}
          >
            {v === "orders" ? "All Orders" : "By Contract"}
          </button>
        ))}
        <span className="ml-auto text-xs text-muted">{orders.length} orders</span>
      </div>

      {view === "summary" ? (
        <SummaryTable rows={summary} totalBooked={totalBooked} />
      ) : (
        <OrdersTable orders={orders} />
      )}

      <p className="px-1 text-xs text-muted">
        Synced daily at 16:05 IST via cron · historical orders seeded from screenshots ·
        seeded IDs start with HIST_
      </p>
    </Shell>
  );
}

function OrdersTable({ orders }: { orders: FnoOrder[] }) {
  if (orders.length === 0)
    return (
      <div className="card p-5 text-sm text-muted">
        No orders yet. Run <code className="text-brand">npx convex run growwStore:seedFnoOrders --prod</code> to seed historical data,
        or wait for the 16:05 IST cron to sync today's orders.
      </div>
    );

  // Group by date for section headers
  const byDate: Record<string, FnoOrder[]> = {};
  for (const o of orders) {
    if (!byDate[o.date]) byDate[o.date] = [];
    byDate[o.date].push(o);
  }

  return (
    <div className="space-y-4">
      {Object.entries(byDate).map(([date, rows]) => (
        <div key={date} className="card min-w-0 p-3 sm:p-4">
          <div className="mb-2 text-xs font-semibold text-muted">{fmtDate(date)}</div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[480px] table-fixed text-sm">
              {/* Shared fixed widths so every date group lines up column-for-column */}
              <colgroup>
                <col className="w-[36%]" />
                <col className="w-[12%]" />
                <col className="w-[12%]" />
                <col className="w-[13%]" />
                <col className="w-[15%]" />
                <col className="w-[12%]" />
              </colgroup>
              <thead>
                <tr className="text-left text-xs text-muted">
                  <th className="py-1 pr-2 font-medium">Contract</th>
                  <th className="py-1 px-2 font-medium">Side</th>
                  <th className="py-1 px-2 text-right font-medium">Qty</th>
                  <th className="py-1 px-2 text-right font-medium">Price</th>
                  <th className="py-1 pl-2 text-right font-medium">Value</th>
                  <th className="py-1 pl-2 text-right font-medium">Time</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((o) => (
                  <tr key={o._id} className="border-t border-line/60">
                    <td className="truncate py-1.5 pr-2 font-medium text-slate-200">
                      {symbolToName(o.symbol)}
                      {o.growwOrderId.startsWith("HIST_") && (
                        <span className="ml-1.5 text-[9px] text-muted">seed</span>
                      )}
                    </td>
                    <td className="py-1.5 px-2">
                      <span
                        className={`rounded px-1.5 py-0.5 text-xs font-bold ${
                          o.side === "BUY"
                            ? "bg-good/15 text-good"
                            : "bg-bad/15 text-bad"
                        }`}
                      >
                        {o.side}
                      </span>
                    </td>
                    <td className="py-1.5 px-2 text-right tabular-nums text-slate-300">
                      {o.qty.toLocaleString("en-IN")}
                    </td>
                    <td className="py-1.5 px-2 text-right tabular-nums text-slate-300">
                      {inr(o.price)}
                    </td>
                    <td className="py-1.5 pl-2 text-right tabular-nums text-slate-300">
                      {inr(o.price * o.qty)}
                    </td>
                    <td className="py-1.5 pl-2 text-right tabular-nums text-muted">
                      {o.time ?? "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </div>
  );
}

function SummaryTable({
  rows,
  totalBooked,
}: {
  rows: ReturnType<typeof summarise>;
  totalBooked: number;
}) {
  if (rows.length === 0)
    return <div className="card p-5 text-sm text-muted">No orders to summarise.</div>;

  return (
    <div className="card min-w-0 p-3 sm:p-4">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-sm">
          <thead>
            <tr className="text-left text-xs text-muted">
              <th className="py-1 pr-2 font-medium">Contract</th>
              <th className="py-1 px-2 text-right font-medium">Avg Buy</th>
              <th className="py-1 px-2 text-right font-medium">Avg Sell</th>
              <th className="py-1 px-2 text-right font-medium">Closed Qty</th>
              <th className="py-1 px-2 text-right font-medium">Open Qty</th>
              <th className="py-1 px-2 text-right font-medium">Booked P&amp;L</th>
              <th className="py-1 pl-2 text-right font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {rows
              .sort((a, b) => b.firstBuy.localeCompare(a.firstBuy))
              .map((r) => {
                const pnlCls =
                  r.booked == null
                    ? "text-muted"
                    : r.booked >= 0
                    ? "text-good"
                    : "text-bad";
                return (
                  <tr key={r.symbol} className="border-t border-line/60">
                    <td className="py-1.5 pr-2 font-medium text-slate-200">{r.name}</td>
                    <td className="py-1.5 px-2 text-right tabular-nums text-slate-300">
                      {inr(r.avgBuy)}
                    </td>
                    <td className="py-1.5 px-2 text-right tabular-nums text-slate-300">
                      {r.avgSell ? inr(r.avgSell) : "—"}
                    </td>
                    <td className="py-1.5 px-2 text-right tabular-nums text-slate-300">
                      {r.closedQty ? r.closedQty.toLocaleString("en-IN") : "—"}
                    </td>
                    <td className="py-1.5 px-2 text-right tabular-nums text-muted">
                      {r.openQty > 0 ? r.openQty.toLocaleString("en-IN") : "—"}
                    </td>
                    <td className={`py-1.5 px-2 text-right font-semibold tabular-nums ${pnlCls}`}>
                      {r.booked != null
                        ? `${r.booked >= 0 ? "+" : "−"}₹${Math.abs(Math.round(r.booked)).toLocaleString("en-IN")}`
                        : "—"}
                    </td>
                    <td className="py-1.5 pl-2 text-right">
                      {r.openQty <= 0 ? (
                        <span className="inline-flex items-center gap-1 text-xs text-good">
                          <Icon name="check" className="h-3 w-3" /> Closed
                        </span>
                      ) : (
                        <span className="text-xs text-amber-400">Open</span>
                      )}
                    </td>
                  </tr>
                );
              })}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-line">
              <td colSpan={5} className="py-2 pr-2 text-xs text-muted">
                Total booked P&amp;L
              </td>
              <td
                className={`py-2 px-2 text-right font-bold tabular-nums text-base ${
                  totalBooked >= 0 ? "text-good" : "text-bad"
                }`}
              >
                {totalBooked >= 0 ? "+" : "−"}₹
                {Math.abs(Math.round(totalBooked)).toLocaleString("en-IN")}
              </td>
              <td />
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

function fmtDate(d: string) {
  return new Date(d + "T00:00:00").toLocaleDateString("en-IN", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="space-y-5">
      <h2 className="text-xl font-bold text-slate-100">F&amp;O Order Book</h2>
      {children}
    </div>
  );
}
