import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

// All monetary inputs are stored raw; computed fields (P/L, allocations, running
// balances) are derived on the client in src/lib/calc.ts — exactly mirroring the
// original spreadsheet formulas.
export default defineSchema({
  // Monthly Budget — only the inputs are stored; buckets are auto-allocated.
  budget: defineTable({
    date: v.string(), // ISO yyyy-mm-dd
    cash: v.number(),
    online: v.number(),
    gym: v.number(),
    skill: v.number(),
    extra: v.number(), // extra cash flow into stability
    note: v.optional(v.string()),
  }).index("by_date", ["date"]),

  // Swing Trading journal (short-term trades).
  swing: defineTable({
    buyDate: v.string(),
    sellDate: v.optional(v.string()),
    name: v.optional(v.string()),
    qty: v.number(),
    buyPrice: v.number(),
    sellPrice: v.optional(v.number()),
    currentPrice: v.optional(v.number()),
    charges: v.number(),
    budget: v.optional(v.number()),
    other: v.optional(v.number()),
    feedback: v.optional(v.string()),
  }).index("by_buyDate", ["buyDate"]),

  // Yearly Stock journal (long-term holdings).
  yearly: defineTable({
    buyDate: v.string(),
    sellDate: v.optional(v.string()),
    name: v.optional(v.string()),
    qty: v.number(),
    buyPrice: v.number(),
    sellPrice: v.optional(v.number()),
    currentPrice: v.optional(v.number()),
    charges: v.number(),
    budget: v.optional(v.number()),
    other: v.optional(v.number()),
  }).index("by_buyDate", ["buyDate"]),

  // Ledger — six independent double-entry accounts, distinguished by `account`.
  ledger: defineTable({
    account: v.string(), // Gym | Needs | Wants | Fixed Deposit | Saving | Stock
    date: v.string(),
    particular: v.string(),
    debit: v.number(),
    credit: v.number(),
    order: v.number(), // manual sort within an account
  }).index("by_account", ["account", "order"]),
});
