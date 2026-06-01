import { useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { ocrImage } from "../lib/ocr";
import { parseGrowwOrder, normName, type ParsedOrder } from "../lib/parseGroww";
import { tradeCalc, type TradeRow } from "../lib/calc";
import { money, pct, signClass, fmtDate } from "../lib/format";
import { Field, Modal } from "./ui";
import { Icon } from "./icons";

type Kind = "swing" | "yearly";

// Score how well a parsed name + qty matches an open position (higher = better).
function matchScore(p: ParsedOrder, t: TradeRow): number {
  let s = 0;
  if (p.stockName && t.name) {
    const a = normName(p.stockName);
    const b = normName(t.name);
    if (a && b) {
      if (a === b) s += 100;
      else if (b.includes(a) || a.includes(b)) s += 60;
      else if (a.slice(0, 4) === b.slice(0, 4)) s += 20;
    }
  }
  if (p.qty != null && p.qty === t.qty) s += 30;
  return s;
}

export default function UploadOrder({ kind, open, onClose }: { kind: Kind; open: boolean; onClose: () => void }) {
  const apiMod = kind === "swing" ? api.swing : api.yearly;
  const allData = useQuery(apiMod.list);
  const all = useMemo(() => (allData ?? []) as TradeRow[], [allData]);
  const add = useMutation(apiMod.add);
  const update = useMutation(apiMod.update);

  const openTrades = useMemo(() => all.filter((t) => !t.sellDate), [all]);

  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [parsed, setParsed] = useState<ParsedOrder | null>(null);
  const [targetId, setTargetId] = useState<string>("");
  const [orderPrice, setOrderPrice] = useState("");
  const [orderDate, setOrderDate] = useState("");
  const [orderQty, setOrderQty] = useState("");
  const [orderName, setOrderName] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const reset = () => {
    setParsed(null); setTargetId(""); setOrderPrice(""); setOrderDate(""); setOrderQty(""); setOrderName(""); setErr(null); setProgress(0);
  };
  const close = () => { reset(); onClose(); };

  const handleFile = async (file: File) => {
    reset();
    setBusy(true);
    try {
      const text = await ocrImage(file, setProgress);
      const p = parseGrowwOrder(text);
      setParsed(p);
      setOrderPrice(p.avgPrice != null ? String(p.avgPrice) : "");
      setOrderDate(p.date ?? "");
      setOrderQty(p.qty != null ? String(p.qty) : "");
      setOrderName(p.stockName ?? "");
      // auto-pick best matching open position
      const ranked = openTrades.map((t) => ({ t, score: matchScore(p, t) })).sort((a, b) => b.score - a.score);
      if (ranked[0] && ranked[0].score > 0) setTargetId(ranked[0].t._id);
    } catch {
      setErr("Could not read the image. Try a clearer screenshot.");
    } finally {
      setBusy(false);
    }
  };

  const target = openTrades.find((t) => t._id === targetId) ?? null;
  const previewCalc = target
    ? tradeCalc({ ...target, sellDate: orderDate || undefined, sellPrice: orderPrice ? Number(orderPrice) : undefined })
    : null;
  const isBuy = parsed?.side === "BUY";
  const isSell = parsed?.side === "SELL";
  const buyPreview = isBuy
    ? tradeCalc({
        _id: "preview",
        buyDate: orderDate,
        name: orderName || undefined,
        qty: Number(orderQty) || 0,
        buyPrice: Number(orderPrice) || 0,
        currentPrice: Number(orderPrice) || undefined,
        charges: 0,
      })
    : null;

  const save = async () => {
    if (isBuy) {
      await add({
        buyDate: orderDate,
        name: orderName || undefined,
        qty: Number(orderQty) || 0,
        buyPrice: Number(orderPrice) || 0,
        currentPrice: Number(orderPrice) || undefined,
        charges: 0,
        ...(kind === "swing" ? { feedback: undefined } : {}),
      } as Parameters<typeof add>[0]);
      close();
      return;
    }
    if (!target) return;
    await update({
      id: target._id as Id<"swing">,
      buyDate: target.buyDate,
      sellDate: orderDate || undefined,
      name: target.name,
      qty: target.qty,
      buyPrice: target.buyPrice,
      sellPrice: orderPrice ? Number(orderPrice) : undefined,
      currentPrice: target.currentPrice,
      charges: target.charges,
      budget: target.budget,
      other: target.other,
      ...(kind === "swing" ? { feedback: target.feedback } : {}),
    } as Parameters<typeof update>[0]);
    close();
  };

  return (
    <Modal open={open} onClose={close} title="Import Groww order">
      {!parsed && (
        <div>
          <div
            onClick={() => fileRef.current?.click()}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files?.[0]; if (f) handleFile(f); }}
            className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded border-2 border-dashed border-line bg-panel2/40 px-4 py-10 text-center hover:border-brand sm:px-6 sm:py-12"
          >
            <div className="grid h-12 w-12 place-items-center rounded bg-brand/10 text-brand">
              <Icon name="import" className="h-6 w-6" />
            </div>
            <div className="text-sm font-medium text-slate-200">Drop a Groww order screenshot, or click to choose</div>
            <div className="text-xs text-muted">Reads buy or sell details on-device — nothing is uploaded.</div>
          </div>
          <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />
          {busy && (
            <div className="mt-4">
              <div className="mb-1 text-xs text-muted">Reading image… {Math.round(progress * 100)}%</div>
              <div className="h-1.5 w-full overflow-hidden rounded bg-panel2">
                <div className="h-full bg-brand transition-all" style={{ width: `${Math.max(5, progress * 100)}%` }} />
              </div>
            </div>
          )}
          {err && <div className="mt-3 text-sm text-bad">{err}</div>}
        </div>
      )}

      {parsed && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className={`chip ${parsed.side === "SELL" ? "bg-good/15 text-good" : "bg-warn/15 text-warn"}`}>
              {parsed.side ?? "UNKNOWN"} order
            </span>
            <span className="text-slate-200 font-medium">{parsed.stockName ?? "—"}</span>
            <span className="text-muted">· {parsed.qty ?? "?"} qty · {parsed.exchange ?? ""}</span>
          </div>
          {!parsed.side && (
            <div className="rounded border border-warn/40 bg-warn/10 px-3 py-2 text-xs text-warn">
              Could not confirm whether this is BUY or SELL. Check the fields before saving.
            </div>
          )}

          {isSell && (
            <Field label="Apply to open position">
              <select className="input" value={targetId} onChange={(e) => setTargetId(e.target.value)}>
                <option value="">— select an open position —</option>
                {openTrades.map((t) => (
                  <option key={t._id} value={t._id}>
                    {(t.name || "unnamed")} · {t.qty} qty · buy {t.buyPrice} · {fmtDate(t.buyDate)}
                  </option>
                ))}
              </select>
              {openTrades.length === 0 && <div className="mt-1 text-xs text-muted">No open positions to close.</div>}
            </Field>
          )}

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {isBuy && <Field label="Stock name"><input className="input" value={orderName} onChange={(e) => setOrderName(e.target.value)} /></Field>}
            <Field label={`${isBuy ? "Buy" : "Sell"} price (avg)`}><input className="input" inputMode="decimal" value={orderPrice} onChange={(e) => setOrderPrice(e.target.value)} /></Field>
            <Field label={`${isBuy ? "Buy" : "Sell"} date`}><input type="date" className="input" value={orderDate} onChange={(e) => setOrderDate(e.target.value)} /></Field>
            {isBuy && <Field label="Qty"><input className="input" inputMode="numeric" value={orderQty} onChange={(e) => setOrderQty(e.target.value)} /></Field>}
          </div>

          {isBuy && buyPreview && (
            <div className="grid grid-cols-2 gap-2 rounded border border-line bg-panel2/50 p-3 text-sm sm:grid-cols-4">
              <Cell k="Invested" v={money(buyPreview.invested)} />
              <Cell k="Current value" v={money(buyPreview.valued)} />
              <Cell k="Qty" v={orderQty || "0"} />
              <Cell k="Status" v="Open" />
            </div>
          )}

          {isSell && target && previewCalc && (
            <div className="grid grid-cols-2 gap-2 rounded border border-line bg-panel2/50 p-3 text-sm sm:grid-cols-4">
              <Cell k="Invested" v={money(previewCalc.invested)} />
              <Cell k="Sell value" v={money(previewCalc.valued)} />
              <Cell k="Net P/L" v={money(previewCalc.netProfit)} cls={signClass(previewCalc.netProfit)} />
              <Cell k="Net %" v={pct(previewCalc.netProfitPct)} cls={signClass(previewCalc.netProfit)} />
            </div>
          )}

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <button className="inline-flex items-center gap-1.5 text-xs text-muted hover:text-slate-200" onClick={reset}>
              <Icon name="reset" className="h-3.5 w-3.5" />
              Try another image
            </button>
            <div className="flex flex-col-reverse gap-2 sm:flex-row">
              <button className="btn-ghost" onClick={close}>Cancel</button>
              <button
                className="btn-brand"
                onClick={save}
                disabled={isBuy ? !orderName || !orderQty || !orderPrice || !orderDate : !target || !orderPrice || !orderDate}
              >
                {isBuy ? "Confirm & add buy" : "Confirm & close position"}
              </button>
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}

function Cell({ k, v, cls }: { k: string; v: string; cls?: string }) {
  return (
    <div className="rounded bg-panel px-2.5 py-1.5">
      <div className="text-[11px] text-muted">{k}</div>
      <div className={`font-semibold ${cls ?? "text-slate-100"}`}>{v}</div>
    </div>
  );
}
