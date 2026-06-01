import { mutation } from "./_generated/server";

// One-time seed of the data extracted from "Finance Record 2.xlsx".
// Safe to call only once — it refuses to run if the budget table already has rows.
const BUDGET = [
  { date: "2026-01-30", cash: 0, online: 0, gym: 0, skill: 0, extra: 5000 },
  { date: "2026-02-01", cash: 0, online: 10000, gym: 3000, skill: 0, extra: 0 },
  { date: "2026-02-28", cash: 0, online: 10000, gym: 3000, skill: 0, extra: 0 },
  { date: "2026-04-02", cash: 0, online: 10000, gym: 3000, skill: 0, extra: 0 },
];

const SWING = [
  ["2026-02-17", "2026-02-25", 6, 331.75, 316.9, 296.2, 21.5, null],
  ["2026-02-17", "2026-02-25", 1, 1635, 1574.4, 1633, 21.5, null],
  ["2026-02-17", "2026-03-04", 7, 293.7, 266.25, 347.15, 26.49, null],
  ["2026-02-17", "2026-02-23", 5, 418.75, 405.38, 401.15, 21.5, null],
  ["2026-02-19", "2026-03-05", 35, 234.29, 251.72, 249.37, 25.31, null],
  ["2026-02-19", "2026-02-23", 1, 635, 644.85, 728.35, 21.5, null],
  ["2026-02-26", "2026-03-06", 1, 2415.4, 2373.9, 2552.7, 21.5, null],
  ["2026-02-26", "2026-03-06", 10, 44.5, 40.41, 43.24, 21.5, "Trade against Downtrend and war"],
  ["2026-03-23", "2026-03-30", 47, 60.52, 56, 72.37, 0, "bought at top"],
  ["2026-04-01", "2026-04-08", 11, 225.5, 230.47, 249.37, 0, "small capture"],
  ["2026-04-13", "2026-04-17", 146, 38.65, 41.4, 41.49, 0, "Good"],
  ["2026-04-21", "2026-04-24", 15, 203.85, 213, 243.37, 0, "Good"],
  ["2026-04-20", "2026-05-06", 56, 52.14, 54.27, 56.99, 0, null],
  ["2026-04-29", "2026-05-15", 33, 116.09, 103.8, 109.26, 0, "No Stoploss"],
  ["2026-05-08", "2026-05-14", 3, 1945, 2040, 2056.3, 0, null],
  ["2026-05-15", "2026-05-19", 40, 252.25, 255, 249.37, 0, "Great Economy Prediction"],
  ["2026-05-19", "2026-05-20", 20, 253.45, 250.55, 249.37, 0, null],
  ["2026-05-21", "2026-05-21", 5, 1949.2, 1945.9, 2056.3, 0, "Wrong Selected on Market Condition"],
  ["2026-05-22", "2026-05-25", 50, 196.69, 208.02, 239.9, 0, "Miss 20% return Due to rush Profit Book"],
  ["2026-05-25", "2026-05-26", 16, 648.35, 639, 619.7, 0, null],
  ["2026-05-26", "2026-05-27", 40, 251.47, 249.88, 249.37, 0, "Neglect Trading"],
  ["2026-05-27", "2026-05-28", 132, 73, 72.01, 72, 0, "Did Not Book Profit"],
  ["2026-05-29", null, 25, 199.93, null, 195.9, 0, "Wrong Time Entry"],
  ["2026-05-29", null, 32, 153.16, null, 152.32, 0, "Wrong Time Entry"],
] as const;

const YEARLY = [
  ["2025-10-29", 5, 164.25, 243.37],
  ["2025-11-04", 1, 758.46, 767.86],
  ["2026-01-30", 28, 11.38, 12.82],
  ["2026-01-30", 10, 134.25, 243.37],
] as const;

const LEDGER: Record<string, Array<[string, string, number, number]>> = {
  Gym: [
    ["2026-02-01", "Monthly", 0, 3000],
    ["2026-02-28", "Desire and Wants", 2167.76, 0],
    ["2026-02-28", "Monthly", 0, 3000],
    ["2026-04-03", "Monthly", 0, 3000],
    ["2026-04-03", "invested", 3000, 0],
  ],
  Needs: [
    ["2026-02-01", "Monthly", 0, 2000],
    ["2026-02-28", "Net", 2000, 0],
    ["2026-02-28", "Monthly", 0, 2000],
    ["2026-04-03", "Net", 2000, 0],
    ["2026-04-03", "Monthly", 0, 2000],
  ],
  Wants: [
    ["2026-02-01", "Monthly", 0, 2500],
    ["2026-02-28", "Net", 2500, 0],
    ["2026-02-28", "Monthly", 0, 2000],
    ["2026-04-03", "Net", 2000, 0],
    ["2026-04-03", "Monthly", 0, 2000],
  ],
  "Fixed Deposit": [
    ["2026-02-01", "Monthly", 0, 500],
    ["2026-02-28", "Monthly", 0, 500],
    ["2026-02-28", "Monthly", 1000, 0],
    ["2026-04-03", "monthly", 0, 500],
  ],
  Saving: [
    ["2026-02-01", "Monthly", 0, 250],
    ["2026-02-28", "Monthly", 0, 250],
    ["2026-04-23", "party", 500, 0],
  ],
  Stock: [
    ["2026-02-01", "Monthly", 0, 250],
    ["2026-02-28", "Monthly", 0, 250],
    ["2026-04-03", "Monthly", 0, 1300],
    ["2026-04-24", "Stock", 1300, 0],
  ],
};

export const run = mutation({
  args: {},
  handler: async (ctx) => {
    const existing = await ctx.db.query("budget").take(1);
    if (existing.length > 0) return { skipped: true, reason: "already seeded" };

    for (const b of BUDGET) await ctx.db.insert("budget", b);

    for (const [buyDate, sellDate, qty, buyPrice, sellPrice, currentPrice, charges, feedback] of SWING) {
      await ctx.db.insert("swing", {
        buyDate,
        sellDate: sellDate ?? undefined,
        qty,
        buyPrice,
        sellPrice: sellPrice ?? undefined,
        currentPrice: currentPrice ?? undefined,
        charges,
        feedback: feedback ?? undefined,
      });
    }

    for (const [buyDate, qty, buyPrice, currentPrice] of YEARLY) {
      await ctx.db.insert("yearly", {
        buyDate,
        qty,
        buyPrice,
        currentPrice,
        charges: 0,
      });
    }

    for (const [account, rows] of Object.entries(LEDGER)) {
      let order = 0;
      for (const [date, particular, debit, credit] of rows) {
        await ctx.db.insert("ledger", { account, date, particular, debit, credit, order: order++ });
      }
    }

    return { skipped: false };
  },
});
