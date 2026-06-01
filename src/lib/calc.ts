// Pure calculation helpers — faithful ports of the spreadsheet formulas.
// Inputs are stored in Convex; everything here is derived.

export type BudgetRow = {
  _id: string;
  date: string;
  cash: number;
  online: number;
  gym: number;
  skill: number;
  extra: number;
  note?: string;
};

export type TradeRow = {
  _id: string;
  buyDate: string;
  sellDate?: string;
  name?: string;
  qty: number;
  buyPrice: number;
  sellPrice?: number;
  currentPrice?: number;
  charges: number;
  budget?: number;
  other?: number;
  feedback?: string;
};

// ---- Monthly Budget allocation (mirrors Table10 formulas) ----
export function budgetCalc(r: Pick<BudgetRow, "cash" | "online" | "gym" | "skill" | "extra">) {
  const income = r.cash + r.online; // E = C + D
  const expenses = (income - r.gym) * 0.3; // F
  const want = (income - r.gym) * 0.3; // G
  const consumption = expenses + want; // H
  const investBase = income * 0.25 * 0.7 - r.skill; // (E*25%*70%) - skill
  const stock = investBase * 0.3; // K
  const sip = investBase * 0.7; // L
  const investment = r.gym + r.skill + stock + sip; // M
  const saving = income * 0.25 * 0.3 * 0.3; // N
  const fixed = income * 0.25 * 0.3 * 0.7; // O
  const stability = saving + fixed + r.extra; // Q
  const total = consumption + investment + stability; // R
  return { income, expenses, want, consumption, stock, sip, investment, saving, fixed, stability, total };
}

// ---- Trade P/L (mirrors Swing Table2 / Yearly Table4) ----
const MS_DAY = 86_400_000;
function daysInclusive(from: string, to: string) {
  const a = Date.parse(from);
  const b = Date.parse(to);
  if (isNaN(a) || isNaN(b)) return 0;
  return Math.round((b - a) / MS_DAY) + 1; // spreadsheet uses D - C + 1
}

export function tradeCalc(t: TradeRow, today = new Date().toISOString().slice(0, 10)) {
  const closed = t.sellDate != null && t.sellDate !== "";
  const invested = t.buyPrice * t.qty; // K / H
  const sellPx = t.sellPrice ?? 0;
  const curPx = t.currentPrice ?? 0;
  const valued = closed ? sellPx * t.qty : curPx * t.qty; // mark-to-market when open
  // N: if invested 0 -> 0; if not sold -> (current*qty - invested); else (sold*qty - invested)
  const grossReturn = invested === 0 ? 0 : closed ? sellPx * t.qty - invested : curPx * t.qty - invested;
  const returnPct = invested ? grossReturn / invested : 0;
  const netProfit = grossReturn - t.charges; // P
  const netProfitPct = invested ? netProfit / invested : 0; // Q
  const netValue = invested + netProfit; // R
  const days = closed ? daysInclusive(t.buyDate, t.sellDate!) : daysInclusive(t.buyDate, today);
  const perDay = days ? grossReturn / days : 0; // V
  return { closed, invested, valued, grossReturn, returnPct, netProfit, netProfitPct, netValue, days, perDay };
}

// ---- Ledger running balance (mirrors per-account double entry) ----
export type LedgerRow = {
  _id: string;
  account: string;
  date: string;
  particular: string;
  debit: number;
  credit: number;
  order: number;
};

export function withRunningBalance(rows: LedgerRow[]) {
  let bal = 0;
  return rows.map((r) => {
    bal = bal + r.debit - r.credit; // G = prev + debit - credit
    const flag = bal < 0 ? "Cr" : bal > 0 ? "Dr" : "";
    return { ...r, balance: bal, displayBalance: Math.abs(bal), flag };
  });
}

export const LEDGER_ACCOUNTS = ["Gym", "Needs", "Wants", "Fixed Deposit", "Saving", "Stock"] as const;
