// Parse the OCR text of a Groww "Order Details" screenshot into structured fields.
// The layout is fixed, so we anchor on the labels. Everything is best-effort —
// the UI lets the user correct before saving.

export type ParsedOrder = {
  side: "BUY" | "SELL" | null;
  stockName: string | null;
  qty: number | null;
  avgPrice: number | null;
  orderPrice: number | null; // "Limit at ₹X" value; null for Market orders
  date: string | null; // ISO yyyy-mm-dd
  exchange: string | null;
  status: "success" | "failed" | null; // executed vs cancelled/rejected
  raw: string;
};

const LABEL_RE = /order\s*details|qty|order\s*type|order\s*price|trigger\s*price|avg\s*price|exchange|validity|list of trades|order status|successful|request received/i;

const MONTHS: Record<string, string> = {
  jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
  jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
};

function parseDate(text: string): string | null {
  // e.g. "11 February 2025" or "15 April 2026, 1:47PM"
  const m = text.match(/(\d{1,2})\s+([A-Za-z]{3,9})\s+(\d{4})/);
  if (!m) return null;
  const day = m[1].padStart(2, "0");
  const mon = MONTHS[m[2].slice(0, 3).toLowerCase()];
  if (!mon) return null;
  return `${m[3]}-${mon}-${day}`;
}

function num(s: string): number | null {
  const n = Number(s.replace(/[^0-9.]/g, ""));
  return isNaN(n) ? null : n;
}

export function parseGrowwOrder(raw: string): ParsedOrder {
  const text = raw;
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  const lower = text.toLowerCase();

  const valueAfterLabel = (label: RegExp) => {
    const idx = lines.findIndex((l) => label.test(l));
    if (idx < 0) return "";
    const sameLine = lines[idx].replace(label, "").trim();
    return sameLine || lines[idx + 1] || "";
  };

  // The "Order Type" row is the most reliably-OCR'd anchor in the layout:
  //   <N Qty> / <Stock name> / Order Type <side, ...> / Order price / Avg price ...
  const otIdx = lines.findIndex((l) => /order\s*type/i.test(l));

  // Side from "Order Type Sell, Delivery, Regular". Prefer the order-type line,
  // fall back to scanning the full text.
  let side: ParsedOrder["side"] = null;
  const sideHay = otIdx >= 0 ? lines[otIdx] : "";
  if (/\bsell\b/i.test(sideHay)) side = "SELL";
  else if (/\bbuy\b/i.test(sideHay)) side = "BUY";
  else if (/\bsell\b/i.test(lower)) side = "SELL";
  else if (/\bbuy\b/i.test(lower)) side = "BUY";

  // Avg price — prefer "Avg price ₹X" (the ₹ often OCRs as junk or vanishes);
  // fall back to the next line, then to "Limit at ₹X".
  // Order price — the "Limit at ₹X" value (null for Market orders). Used both as
  // an avg-price fallback and as a sanity cross-check in the review UI.
  const limM = text.match(/limit\s*at[^\d₹]*₹?\s*([\d,]+\.?\d*)/i);
  const orderPrice = limM ? num(limM[1]) : null;

  let avgPrice: number | null = null;
  const avgM = text.match(/avg\s*price[^\d₹]*₹?\s*([\d,]+\.?\d*)/i);
  if (avgM) avgPrice = num(avgM[1]);
  if (avgPrice == null) {
    const avgLine = valueAfterLabel(/avg\s*price/i);
    if (avgLine) avgPrice = num(avgLine);
  }
  if (avgPrice == null) avgPrice = orderPrice;

  // Qty — "1 Qty" when clean; else the number two lines above Order Type
  // ("2 Qty" → "210y", "16 Qty" → "16 ov" — the label gets garbled, the digits don't).
  let qty: number | null = null;
  const qtyM = text.match(/(\d+)\s*qty/i) ?? text.match(/qty\s*[:]?\s*(\d+)/i);
  if (qtyM) qty = num(qtyM[1]);
  if (qty == null && otIdx >= 2) {
    const m = lines[otIdx - 2].match(/\d+/);
    if (m) qty = num(m[0]);
  }

  // Exchange
  const exM = text.match(/\b(NSE|BSE)\b/);
  const exchange = exM ? exM[1] : null;

  // Date — prefer the "Order Executed" timestamp (the true trade date); the date
  // may be on the same line or the next one. Fall back to the first date in text.
  const execIdx = lines.findIndex((l) => /order\s*executed/i.test(l));
  let date: string | null = null;
  if (execIdx >= 0) date = parseDate(`${lines[execIdx]} ${lines[execIdx + 1] ?? ""}`);
  if (!date) date = parseDate(text);

  // Stock name — the line directly above "Order Type", minus the trailing chevron.
  let stockName: string | null = null;
  if (otIdx > 0) {
    const cand = lines[otIdx - 1].replace(/[^A-Za-z0-9.&)]+$/, "").trim();
    if (cand && /[A-Za-z]{2,}/.test(cand) && !LABEL_RE.test(cand)) stockName = cand;
  }
  if (!stockName) {
    // Fallback: first line after a "Qty" line that looks like a name.
    const qtyIdx = lines.findIndex((l) => /\bqty\b/i.test(l));
    if (qtyIdx >= 0) {
      for (let i = qtyIdx + 1; i < lines.length; i++) {
        const l = lines[i].replace(/[>›→]/g, "").trim();
        if (l && /[A-Za-z]{3,}/.test(l) && !LABEL_RE.test(l) && !/₹|\bNSE\b|\bBSE\b/.test(l)) {
          stockName = l;
          break;
        }
      }
    }
  }

  // Status — cancelled/rejected orders never executed, so they shouldn't import.
  let status: ParsedOrder["status"] = null;
  if (/unsuccessful|cancel|reject|fail/i.test(text)) status = "failed";
  else if (/successful/i.test(text)) status = "success";

  return { side, stockName, qty, avgPrice, orderPrice, date, exchange, status, raw };
}

// Normalize a name for fuzzy matching against journal entries.
export function normName(s: string): string {
  return s
    .toLowerCase()
    .replace(/\(.*?\)/g, " ") // drop "(XNSE:RVNL)"
    .replace(/\b(limited|ltd|the|nigam|india|industries|system|systems|mobility|energy|brands)\b/g, " ")
    .replace(/[^a-z0-9]+/g, "")
    .trim();
}
