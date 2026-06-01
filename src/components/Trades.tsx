import { useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { tradeCalc, type TradeRow } from "../lib/calc";
import { money, pct, signClass, fmtDate } from "../lib/format";
import { Field, Modal, ConfirmDelete, Stat } from "./ui";
import UploadOrder from "./UploadOrder";
import { Icon } from "./icons";

type Kind = "swing" | "yearly";

type Draft = {
  buyDate: string;
  sellDate: string;
  name: string;
  qty: string;
  buyPrice: string;
  sellPrice: string;
  currentPrice: string;
  charges: string;
  feedback: string;
};
const empty: Draft = { buyDate: "", sellDate: "", name: "", qty: "", buyPrice: "", sellPrice: "", currentPrice: "", charges: "", feedback: "" };
const num = (s: string) => (s.trim() === "" ? 0 : Number(s) || 0);
const opt = (s: string) => (s.trim() === "" ? undefined : Number(s));

export default function Trades({ kind }: { kind: Kind }) {
  const apiMod = kind === "swing" ? api.swing : api.yearly;
  const rowsData = useQuery(apiMod.list);
  const rows = useMemo(() => (rowsData ?? []) as TradeRow[], [rowsData]);
  const add = useMutation(apiMod.add);
  const update = useMutation(apiMod.update);
  const remove = useMutation(apiMod.remove);

  const [open, setOpen] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [d, setD] = useState<Draft>(empty);

  const calc = useMemo(() => rows.map((r) => ({ r, c: tradeCalc(r) })), [rows]);
  const totals = useMemo(() => {
    let invested = 0, netProfit = 0, value = 0, wins = 0, closed = 0;
    for (const { c } of calc) {
      invested += c.invested;
      netProfit += c.netProfit;
      value += c.netValue;
      if (c.closed) {
        closed++;
        if (c.netProfit > 0) wins++;
      }
    }
    return { invested, netProfit, value, wins, closed, winRate: closed ? wins / closed : 0, n: calc.length };
  }, [calc]);

  const openAdd = () => {
    setEditId(null);
    setD({ ...empty, buyDate: new Date().toISOString().slice(0, 10) });
    setOpen(true);
  };
  const openEdit = (r: TradeRow) => {
    setEditId(r._id);
    setD({
      buyDate: r.buyDate, sellDate: r.sellDate ?? "", name: r.name ?? "", qty: String(r.qty),
      buyPrice: String(r.buyPrice), sellPrice: r.sellPrice != null ? String(r.sellPrice) : "",
      currentPrice: r.currentPrice != null ? String(r.currentPrice) : "", charges: String(r.charges),
      feedback: r.feedback ?? "",
    });
    setOpen(true);
  };
  const save = async () => {
    const base: Record<string, unknown> = {
      buyDate: d.buyDate,
      sellDate: d.sellDate || undefined,
      name: d.name || undefined,
      qty: num(d.qty),
      buyPrice: num(d.buyPrice),
      sellPrice: opt(d.sellPrice),
      currentPrice: opt(d.currentPrice) ?? (d.sellDate ? undefined : num(d.buyPrice)),
      charges: num(d.charges),
    };
    if (kind === "swing") base.feedback = d.feedback || undefined;
    if (editId) await update({ id: editId, ...base } as Parameters<typeof update>[0]);
    else await add(base as Parameters<typeof add>[0]);
    setOpen(false);
  };

  const title = kind === "swing" ? "Swing Trading" : "Yearly Stock";
  const preview = tradeCalc({
    _id: "x", buyDate: d.buyDate, sellDate: d.sellDate || undefined, qty: num(d.qty),
    buyPrice: num(d.buyPrice), sellPrice: opt(d.sellPrice), currentPrice: opt(d.currentPrice) ?? (d.sellDate ? undefined : num(d.buyPrice)), charges: num(d.charges),
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h2 className="text-xl font-bold text-slate-100">{title}</h2>
          <p className="text-sm text-muted">
            {kind === "swing" ? "Short-term trades." : "Long-term holdings."} Open positions are marked-to-market at current price.
          </p>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:flex">
          <button className="btn-ghost" onClick={() => setUploadOpen(true)}>
            <Icon name="import" />
            Import order
          </button>
          <button className="btn-brand" onClick={openAdd}>
            <Icon name="plus" />
            Manual trade
          </button>
        </div>
      </div>

      <UploadOrder kind={kind} open={uploadOpen} onClose={() => setUploadOpen(false)} />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Invested" value={money(totals.invested)} />
        <Stat label="Net P/L" value={money(totals.netProfit)} tone={totals.netProfit >= 0 ? "good" : "bad"} sub={pct(totals.invested ? totals.netProfit / totals.invested : 0)} />
        <Stat label="Current value" value={money(totals.value)} />
        <Stat label="Win rate" value={pct(totals.winRate)} sub={`${totals.wins}/${totals.closed} closed · ${totals.n} total`} />
      </div>

      <div className="card overflow-hidden xl:overflow-visible">
        <div className="divide-y divide-line xl:hidden">
          {calc.map(({ r, c }) => (
            <div key={r._id} className="w-full cursor-pointer p-3 text-left hover:bg-panel2/40" onClick={() => openEdit(r)}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="truncate font-semibold text-slate-100">{r.name || "Unnamed"}</span>
                    {!c.closed && <span className="chip shrink-0 bg-warn/15 text-warn">open</span>}
                  </div>
                  <div className="mt-0.5 text-xs text-muted">
                    {fmtDate(r.buyDate)} to {fmtDate(r.sellDate)}
                  </div>
                </div>
                <div className="flex shrink-0 items-start gap-2">
                  <div className="text-right">
                    <div className="text-xs text-muted">Net P/L</div>
                    <div className={`font-semibold ${signClass(c.netProfit)}`}>{money(c.netProfit)}</div>
                  </div>
                  <span onClick={(e) => e.stopPropagation()}>
                    <ConfirmDelete onConfirm={() => remove({ id: r._id as Id<"swing"> })} />
                  </span>
                </div>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2 text-sm sm:grid-cols-3">
                <Mini label="Qty" value={String(r.qty)} />
                <Mini label="Buy" value={String(r.buyPrice)} />
                <Mini label={c.closed ? "Sell" : "Current"} value={(c.closed ? r.sellPrice : r.currentPrice)?.toString() ?? "N/A"} />
                <Mini label="Invested" value={money(c.invested)} />
                <Mini label="Net %" value={pct(c.netProfitPct)} cls={signClass(c.netProfit)} />
                {kind === "swing" && <Mini label="Days" value={String(c.days)} />}
              </div>
              {kind === "swing" && r.feedback && <div className="mt-2 truncate text-xs text-muted">{r.feedback}</div>}
            </div>
          ))}
          {calc.length === 0 && <div className="p-3 text-sm text-muted">No trades yet.</div>}
        </div>

        <div className="hidden xl:block xl:overflow-x-auto">
          <table className="min-w-[1600px] table-fixed text-[13px] 2xl:min-w-[1900px] 2xl:text-sm">
            {kind === "swing" ? (
              <colgroup>
                <col className="w-[29%]" />
                <col className="w-[5.5%]" />
                <col className="w-[5.5%]" />
                <col className="w-[3.25%]" />
                <col className="w-[3.25%]" />
                <col className="w-[5.25%]" />
                <col className="w-[6%]" />
                <col className="w-[6%]" />
                <col className="w-[5.25%]" />
                <col className="w-[5.5%]" />
                <col className="w-[4.5%]" />
                <col className="w-[18%]" />
                <col className="w-[3%]" />
              </colgroup>
            ) : (
              <colgroup>
                <col className="w-[40%]" />
                <col className="w-[7%]" />
                <col className="w-[7%]" />
                <col className="w-[4%]" />
                <col className="w-[6.5%]" />
                <col className="w-[7%]" />
                <col className="w-[7%]" />
                <col className="w-[6.5%]" />
                <col className="w-[6.5%]" />
                <col className="w-[5.5%]" />
                <col className="w-[3%]" />
              </colgroup>
            )}
            <thead className="bg-panel2/60">
              <tr>
                <th className="th px-1">Stock</th>
                <th className="th px-1">Buy</th>
                <th className="th px-1">Sell</th>
                {kind === "swing" && <th className="th px-1 text-right">Days</th>}
                <th className="th px-1 text-right">Qty</th>
                <th className="th px-1 text-right">Buy ₹</th>
                <th className="th px-1 text-right">Sell/Cur</th>
                <th className="th px-1 text-right">Invested</th>
                <th className="th px-1 text-right">Return</th>
                <th className="th px-1 text-right">Net P/L</th>
                <th className="th px-1 text-right">Net %</th>
                {kind === "swing" && <th className="th px-1">Feedback</th>}
                <th className="th"></th>
              </tr>
            </thead>
            <tbody>
              {calc.map(({ r, c }) => (
                <tr key={r._id} className="hover:bg-panel2/40 cursor-pointer" onClick={() => openEdit(r)}>
                  <td className="td px-1 font-medium" title={r.name || "unnamed"}>
                    <span>{r.name || <span className="text-muted italic">unnamed</span>}</span>
                    {!c.closed && <span className="chip ml-2 bg-warn/15 text-warn">open</span>}
                  </td>
                  <td className="td px-1">{fmtDate(r.buyDate)}</td>
                  <td className="td px-1">{fmtDate(r.sellDate)}</td>
                  {kind === "swing" && <td className="td px-1 text-right">{c.days}</td>}
                  <td className="td px-1 text-right">{r.qty}</td>
                  <td className="td px-1 text-right">{r.buyPrice}</td>
                  <td className="td px-1 text-right">{c.closed ? r.sellPrice : r.currentPrice}</td>
                  <td className="td px-1 text-right">{money(c.invested)}</td>
                  <td className={`td px-1 text-right ${signClass(c.grossReturn)}`}>{money(c.grossReturn)}</td>
                  <td className={`td px-1 text-right font-semibold ${signClass(c.netProfit)}`}>{money(c.netProfit)}</td>
                  <td className={`td px-1 text-right ${signClass(c.netProfit)}`}>{pct(c.netProfitPct)}</td>
                  {kind === "swing" && (
                    <td className="td whitespace-normal px-1 leading-snug text-muted" title={r.feedback}>
                      {r.feedback || <span className="text-muted/60">—</span>}
                    </td>
                  )}
                  <td className="td px-1 text-right" onClick={(e) => e.stopPropagation()}>
                    <ConfirmDelete onConfirm={() => remove({ id: r._id as Id<"swing"> })} />
                  </td>
                </tr>
              ))}
              {calc.length === 0 && (
                <tr><td className="td text-muted" colSpan={13}>No trades yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <Modal open={open} onClose={() => setOpen(false)} title={editId ? "Edit trade" : "Add manual trade"}>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Field label="Stock name"><input className="input" value={d.name} onChange={(e) => setD({ ...d, name: e.target.value })} placeholder="e.g. RELIANCE" /></Field>
          <Field label="Buy date"><input type="date" className="input" value={d.buyDate} onChange={(e) => setD({ ...d, buyDate: e.target.value })} /></Field>
          <Field label="Sell date (blank = open)"><input type="date" className="input" value={d.sellDate} onChange={(e) => setD({ ...d, sellDate: e.target.value })} /></Field>
          <Field label="Qty"><input className="input" inputMode="decimal" value={d.qty} onChange={(e) => setD({ ...d, qty: e.target.value })} /></Field>
          <Field label="Buy price"><input className="input" inputMode="decimal" value={d.buyPrice} onChange={(e) => setD({ ...d, buyPrice: e.target.value })} /></Field>
          <Field label="Sell price"><input className="input" inputMode="decimal" value={d.sellPrice} onChange={(e) => setD({ ...d, sellPrice: e.target.value })} /></Field>
          <Field label="Current price (blank = buy)"><input className="input" inputMode="decimal" value={d.currentPrice} onChange={(e) => setD({ ...d, currentPrice: e.target.value })} /></Field>
          <Field label="Charges"><input className="input" inputMode="decimal" value={d.charges} onChange={(e) => setD({ ...d, charges: e.target.value })} /></Field>
          {kind === "swing" && (
            <div className="sm:col-span-3"><Field label="Feedback"><input className="input" value={d.feedback} onChange={(e) => setD({ ...d, feedback: e.target.value })} /></Field></div>
          )}
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2 rounded border border-line bg-panel2/50 p-3 text-sm sm:grid-cols-5">
          <Prev k="Invested" v={money(preview.invested)} />
          <Prev k="Return" v={money(preview.grossReturn)} cls={signClass(preview.grossReturn)} />
          <Prev k="Net P/L" v={money(preview.netProfit)} cls={signClass(preview.netProfit)} />
          <Prev k="Net %" v={pct(preview.netProfitPct)} cls={signClass(preview.netProfit)} />
          <Prev k="Net value" v={money(preview.netValue)} />
        </div>

        <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button className="btn-ghost" onClick={() => setOpen(false)}>Cancel</button>
          <button className="btn-brand" onClick={save} disabled={!d.buyDate || !d.qty}>{editId ? "Save" : "Add"}</button>
        </div>
      </Modal>
    </div>
  );
}

function Prev({ k, v, cls }: { k: string; v: string; cls?: string }) {
  return (
    <div className="rounded bg-panel px-1.5 py-1.5">
      <div className="text-[11px] text-muted">{k}</div>
      <div className={`font-semibold ${cls ?? "text-slate-100"}`}>{v}</div>
    </div>
  );
}

function Mini({ label, value, cls }: { label: string; value: string; cls?: string }) {
  return (
    <div className="min-w-0 rounded bg-panel2/50 px-1.5 py-2">
      <div className="text-[11px] text-muted">{label}</div>
      <div className={`truncate font-semibold ${cls ?? "text-slate-100"}`}>{value || "N/A"}</div>
    </div>
  );
}
