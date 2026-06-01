// Parse the OCR text of a Groww "Order Details" screenshot into structured fields.
// The layout is fixed, so we anchor on the labels. Everything is best-effort —
// the UI lets the user correct before saving.

export type ParsedOrder = {
  side: "BUY" | "SELL" | null;
  stockName: string | null;
  qty: number | null;
  avgPrice: number | null;
  date: string | null; // ISO yyyy-mm-dd
  exchange: string | null;
  raw: string;
};

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
  const text = raw.replace(/₹/g, "₹");
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  const lower = text.toLowerCase();

  const valueAfterLabel = (label: RegExp) => {
    const idx = lines.findIndex((l) => label.test(l));
    if (idx < 0) return "";
    const sameLine = lines[idx].replace(label, "").trim();
    return sameLine || lines[idx + 1] || "";
  };

  // Side from "Order Type: Sell, Delivery, Regular". OCR sometimes separates
  // the label and value onto different lines, so inspect both local and full text.
  let side: ParsedOrder["side"] = null;
  const otLine = valueAfterLabel(/order\s*type/i);
  const sideHay = `${otLine} ${lower}`;
  if (/\bsell\b/i.test(sideHay)) side = "SELL";
  else if (/\bbuy\b/i.test(sideHay)) side = "BUY";

  // Avg price — prefer "Avg price ₹X"; fall back to "Limit at ₹X"
  let avgPrice: number | null = null;
  const avgM = text.match(/avg\s*price[^\d₹]*₹?\s*([\d,]+\.?\d*)/i);
  if (avgM) avgPrice = num(avgM[1]);
  if (avgPrice == null) {
    const avgLine = valueAfterLabel(/avg\s*price/i);
    if (avgLine) avgPrice = num(avgLine);
  }
  if (avgPrice == null) {
    const limM = text.match(/limit\s*at[^\d₹]*₹?\s*([\d,]+\.?\d*)/i);
    if (limM) avgPrice = num(limM[1]);
  }

  // Qty — "1 Qty" / "Qty 1"
  let qty: number | null = null;
  const qtyM = text.match(/(\d+)\s*qty/i) ?? text.match(/qty\s*[:]?\s*(\d+)/i);
  if (qtyM) qty = num(qtyM[1]);

  // Exchange
  const exM = text.match(/\b(NSE|BSE)\b/);
  const exchange = exM ? exM[1] : null;

  // Date — from the order-status timeline
  const date = parseDate(text);

  // Stock name — the line sitting between the qty block and "Order Type".
  // Heuristic: first line after a "Qty" line that has letters and isn't a known label.
  let stockName: string | null = null;
  const labelRe = /order\s*details|qty|order\s*type|order\s*price|avg\s*price|exchange|validity|list of trades|order status|successful|request received/i;
  const qtyIdx = lines.findIndex((l) => /\bqty\b/i.test(l));
  if (qtyIdx >= 0) {
    for (let i = qtyIdx + 1; i < lines.length; i++) {
      const l = lines[i].replace(/[>›→]/g, "").trim();
      if (l && /[A-Za-z]{3,}/.test(l) && !labelRe.test(l) && !/₹|\bNSE\b|\bBSE\b/.test(l)) {
        stockName = l;
        break;
      }
    }
  }

  return { side, stockName, qty, avgPrice, date, exchange, raw };
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
