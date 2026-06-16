import { useMemo, useRef, useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { ocrImage } from "../lib/ocr";
import { parseGrowwOrder, normName, type ParsedOrder } from "../lib/parseGroww";
import { tradeCalc, type TradeRow } from "../lib/calc";
import { money, signClass, fmtDate } from "../lib/format";
import { Field, Modal } from "./ui";
import { Icon } from "./icons";

type Kind = "swing" | "yearly";

// Read a File as base64 (no data: prefix) + its media type, for the vision action.
const fileToBase64 = (file: File) =>
  new Promise<{ data: string; mediaType: string }>((resolve, reject) => {
    const r = new FileReader();
    r.onerror = () => reject(new Error("Could not read file"));
    r.onload = () => {
      const s = r.result as string;
      const comma = s.indexOf(",");
      const mediaType = s.slice(5, s.indexOf(";")) || file.type || "image/jpeg";
      resolve({ data: s.slice(comma + 1), mediaType });
    };
    r.readAsDataURL(file);
  });

// One parsed screenshot, with user-editable fields, awaiting confirmation.
type ReviewItem = {
  id: string;
  fileName: string;
  parsed: ParsedOrder;
  side: "BUY" | "SELL" | null;
  name: string;
  qty: string;
  price: string;
  date: string;
  targetId: string; // for SELL: open position to close
  include: boolean;
};

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

const toItem = (fileName: string, p: ParsedOrder): ReviewItem => ({
  id: crypto.randomUUID(),
  fileName,
  parsed: p,
  side: p.side,
  name: p.stockName ?? "",
  qty: p.qty != null ? String(p.qty) : "",
  price: p.avgPrice != null ? String(p.avgPrice) : "",
  date: p.date ?? "",
  targetId: "",
  include: p.status !== "failed", // cancelled/rejected orders never executed
});

const itemValid = (it: ReviewItem): boolean =>
  it.side === "BUY"
    ? Boolean(it.name && it.qty && it.price && it.date)
    : it.side === "SELL"
      ? Boolean(it.targetId && it.price && it.date)
      : false;

export default function UploadOrder({ kind, open, onClose }: { kind: Kind; open: boolean; onClose: () => void }) {
  const apiMod = kind === "swing" ? api.swing : api.yearly;
  const allData = useQuery(apiMod.list);
  const all = useMemo(() => (allData ?? []) as TradeRow[], [allData]);
  const add = useMutation(apiMod.add);
  const update = useMutation(apiMod.update);
  const extractOrder = useAction(api.ocr.extractOrder);

  const openTrades = useMemo(() => all.filter((t) => !t.sellDate), [all]);

  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [current, setCurrent] = useState(0);
  const [total, setTotal] = useState(0);
  const [items, setItems] = useState<ReviewItem[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const reset = () => {
    setItems([]); setErr(null); setProgress(0); setCurrent(0); setTotal(0);
  };
  const close = () => { reset(); onClose(); };

  // Greedily assign each SELL its best-matching open position, never reusing one.
  const assignTargets = (list: ReviewItem[], used: Set<string> = new Set<string>()) => {
    for (const it of list) {
      if (it.side !== "SELL") continue;
      const ranked = openTrades
        .filter((t) => !used.has(t._id))
        .map((t) => ({ t, score: matchScore(it.parsed, t) }))
        .sort((a, b) => b.score - a.score);
      if (ranked[0] && ranked[0].score > 0) {
        it.targetId = ranked[0].t._id;
        used.add(ranked[0].t._id);
      }
    }
  };

  const handleFiles = async (files: File[]) => {
    if (!files.length) return;
    setErr(null);
    setBusy(true);
    const next: ReviewItem[] = [];
    const failed: string[] = [];
    try {
      for (let i = 0; i < files.length; i++) {
        setCurrent(i + 1);
        setTotal(files.length);
        setProgress(0);
        try {
          let parsed: ParsedOrder;
          try {
            // Primary: Claude Sonnet vision (accurate, reads ₹/labels/qty).
            const { data, mediaType } = await fileToBase64(files[i]);
            const r = await extractOrder({ image: data, mediaType });
            parsed = { ...r, raw: "" };
          } catch {
            // Fallback: on-device model if the API call fails (e.g. key not set).
            parsed = parseGrowwOrder(await ocrImage(files[i], setProgress));
          }
          next.push(toItem(files[i].name, parsed));
        } catch {
          failed.push(files[i].name);
        }
      }
      // Append to whatever's already in review; don't reuse a position another SELL took.
      setItems((prev) => {
        const used = new Set(prev.filter((p) => p.side === "SELL" && p.targetId).map((p) => p.targetId));
        assignTargets(next, used);
        return [...prev, ...next];
      });
      if (failed.length) {
        setErr(`Couldn't read ${failed.length} image${failed.length > 1 ? "s" : ""}: ${failed.join(", ")}. Try clearer screenshots.`);
      }
    } finally {
      setBusy(false);
      setProgress(0);
      setCurrent(0);
      setTotal(0);
    }
  };

  const patch = (id: string, p: Partial<ReviewItem>) =>
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, ...p } : it)));
  const removeItem = (id: string) => setItems((prev) => prev.filter((it) => it.id !== id));

  const importable = items.filter((it) => it.include && itemValid(it));
  const blocked = items.some((it) => it.include && !itemValid(it));

  const importAll = async () => {
    setBusy(true);
    try {
      for (const it of importable) {
        if (it.side === "BUY") {
          await add({
            buyDate: it.date,
            name: it.name || undefined,
            qty: Number(it.qty) || 0,
            buyPrice: Number(it.price) || 0,
            currentPrice: Number(it.price) || undefined,
            charges: 0,
            ...(kind === "swing" ? { feedback: undefined } : {}),
          } as Parameters<typeof add>[0]);
        } else if (it.side === "SELL") {
          const t = openTrades.find((o) => o._id === it.targetId);
          if (!t) continue;
          await update({
            id: t._id as Id<"swing">,
            buyDate: t.buyDate,
            sellDate: it.date || undefined,
            name: t.name,
            qty: t.qty,
            buyPrice: t.buyPrice,
            sellPrice: it.price ? Number(it.price) : undefined,
            currentPrice: t.currentPrice,
            charges: t.charges,
            budget: t.budget,
            other: t.other,
            ...(kind === "swing" ? { feedback: t.feedback } : {}),
          } as Parameters<typeof update>[0]);
        }
      }
      close();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={close} title="Import Groww orders">
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(e) => { void handleFiles(Array.from(e.target.files ?? [])); e.target.value = ""; }}
      />
      {items.length === 0 && (
        <div>
          <div
            onClick={() => !busy && fileRef.current?.click()}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => { e.preventDefault(); if (!busy) void handleFiles(Array.from(e.dataTransfer.files ?? [])); }}
            className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded border-2 border-dashed border-line bg-panel2/40 px-4 py-10 text-center hover:border-brand sm:px-6 sm:py-12"
          >
            <div className="grid h-12 w-12 place-items-center rounded bg-brand/10 text-brand">
              <Icon name="import" className="h-6 w-6" />
            </div>
            <div className="text-sm font-medium text-slate-200">Drop Groww order screenshots, or click to choose</div>
            <div className="text-xs text-muted">Select multiple images at once — each is read by AI for accurate extraction.</div>
          </div>
          {busy && (
            <div className="mt-4">
              <div className="mb-1 text-xs text-muted">
                Reading image {current} of {total}… {Math.round(progress * 100)}%
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded bg-panel2">
                <div className="h-full bg-brand transition-all" style={{ width: `${Math.max(5, progress * 100)}%` }} />
              </div>
            </div>
          )}
          {err && <div className="mt-3 text-sm text-bad">{err}</div>}
        </div>
      )}

      {items.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-2 text-sm">
            <span className="text-muted">
              {items.length} screenshot{items.length > 1 ? "s" : ""} read · <span className="text-slate-200">{importable.length} ready</span>
            </span>
            <div className="flex items-center gap-3">
              <button className="inline-flex items-center gap-1.5 text-xs text-brand hover:text-slate-200 disabled:opacity-50" onClick={() => fileRef.current?.click()} disabled={busy}>
                <Icon name="plus" className="h-3.5 w-3.5" />
                Add more
              </button>
              <button className="inline-flex items-center gap-1.5 text-xs text-muted hover:text-slate-200 disabled:opacity-50" onClick={reset} disabled={busy}>
                <Icon name="reset" className="h-3.5 w-3.5" />
                Start over
              </button>
            </div>
          </div>

          {busy && (
            <div>
              <div className="mb-1 text-xs text-muted">Reading image {current} of {total}… {Math.round(progress * 100)}%</div>
              <div className="h-1.5 w-full overflow-hidden rounded bg-panel2">
                <div className="h-full bg-brand transition-all" style={{ width: `${Math.max(5, progress * 100)}%` }} />
              </div>
            </div>
          )}

          {err && <div className="rounded border border-warn/40 bg-warn/10 px-3 py-2 text-xs text-warn">{err}</div>}

          <div className="space-y-3">
            {items.map((it) => (
              <ItemCard
                key={it.id}
                it={it}
                openTrades={openTrades}
                onChange={(p) => patch(it.id, p)}
                onRemove={() => removeItem(it.id)}
              />
            ))}
          </div>

          <div className="flex flex-col-reverse gap-2 pt-1 sm:flex-row sm:justify-end">
            <button className="btn-ghost" onClick={close} disabled={busy}>Cancel</button>
            <button className="btn-brand" onClick={importAll} disabled={busy || importable.length === 0 || blocked}>
              {busy ? "Importing…" : `Import ${importable.length} order${importable.length === 1 ? "" : "s"}`}
            </button>
          </div>
          {blocked && (
            <div className="text-right text-xs text-warn">Some selected orders are missing required fields — fix or uncheck them.</div>
          )}
        </div>
      )}
    </Modal>
  );
}

function ItemCard({
  it, openTrades, onChange, onRemove,
}: {
  it: ReviewItem;
  openTrades: TradeRow[];
  onChange: (p: Partial<ReviewItem>) => void;
  onRemove: () => void;
}) {
  const isBuy = it.side === "BUY";
  const isSell = it.side === "SELL";
  const target = openTrades.find((t) => t._id === it.targetId) ?? null;
  const valid = itemValid(it);

  // Sanity check: a limit order fills at ~the limit price. A large gap means the
  // avg price was likely misread (a dropped/added digit from the ₹ glyph).
  const op = it.parsed.orderPrice;
  const entered = Number(it.price);
  const priceSuspect = op != null && it.price !== "" && entered > 0 && Math.abs(entered - op) / op > 0.2;

  let summary: { k: string; v: string; cls?: string } | null = null;
  if (isBuy && it.qty && it.price) {
    summary = { k: "Invested", v: money((Number(it.qty) || 0) * (Number(it.price) || 0)) };
  } else if (isSell && target && it.price) {
    const c = tradeCalc({ ...target, sellDate: it.date || undefined, sellPrice: Number(it.price) });
    summary = { k: "Net P/L", v: money(c.netProfit), cls: signClass(c.netProfit) };
  }

  return (
    <div className={`rounded border bg-panel2/40 p-3 ${it.include ? "border-line" : "border-line/40 opacity-60"}`}>
      <div className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={it.include}
          onChange={(e) => onChange({ include: e.target.checked })}
          className="h-4 w-4 shrink-0 accent-[#d8b45a]"
          aria-label="Include this order"
        />
        <select
          className="input w-auto py-1 text-xs"
          value={it.side ?? ""}
          onChange={(e) => onChange({ side: (e.target.value || null) as ReviewItem["side"] })}
        >
          <option value="">Unknown</option>
          <option value="BUY">BUY</option>
          <option value="SELL">SELL</option>
        </select>
        <span className="min-w-0 flex-1 truncate text-xs text-muted" title={it.fileName}>{it.fileName}</span>
        {summary && <span className={`shrink-0 text-xs font-semibold ${summary.cls ?? "text-slate-100"}`}>{summary.k}: {summary.v}</span>}
        <button className="shrink-0 text-muted hover:text-bad" onClick={onRemove} aria-label="Remove" title="Remove">
          <Icon name="close" className="h-4 w-4" />
        </button>
      </div>

      {it.parsed.status === "failed" && (
        <div className="mt-2 text-xs text-bad">This order was cancelled / not executed — unchecked by default. Check it only if you want to import it anyway.</div>
      )}
      {!it.side && (
        <div className="mt-2 text-xs text-warn">Pick BUY or SELL — couldn't detect it from the screenshot.</div>
      )}

      <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
        {isBuy && (
          <Field label="Stock name">
            <input className="input" value={it.name} onChange={(e) => onChange({ name: e.target.value })} placeholder="e.g. RELIANCE" />
          </Field>
        )}
        {isSell && (
          <Field label="Apply to open position">
            <select className="input" value={it.targetId} onChange={(e) => onChange({ targetId: e.target.value })}>
              <option value="">— select an open position —</option>
              {openTrades.map((t) => (
                <option key={t._id} value={t._id}>
                  {(t.name || "unnamed")} · {t.qty} qty · buy {t.buyPrice} · {fmtDate(t.buyDate)}
                </option>
              ))}
            </select>
          </Field>
        )}
        <Field label={`${isSell ? "Sell" : "Buy"} price (avg)`}>
          <input className="input" inputMode="decimal" value={it.price} onChange={(e) => onChange({ price: e.target.value })} />
        </Field>
        <Field label={`${isSell ? "Sell" : "Buy"} date`}>
          <input type="date" className="input" value={it.date} onChange={(e) => onChange({ date: e.target.value })} />
        </Field>
        {isBuy && (
          <Field label="Qty">
            <input className="input" inputMode="numeric" value={it.qty} onChange={(e) => onChange({ qty: e.target.value })} />
          </Field>
        )}
      </div>

      {priceSuspect && (
        <div className="mt-2 text-xs text-warn">
          Price may be misread — this order was a limit at ₹{op}. Double-check the {isSell ? "sell" : "buy"} price.
        </div>
      )}
      {it.include && !valid && (
        <div className="mt-2 text-xs text-warn">
          {it.side === "SELL" && !it.targetId ? "Select the open position to close." : "Fill in all fields to import this order."}
        </div>
      )}
    </div>
  );
}
