import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

const fields = {
  account: v.string(),
  date: v.string(),
  particular: v.string(),
  debit: v.number(),
  credit: v.number(),
};

export const list = query({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query("ledger").collect();
    return rows.sort((a, b) =>
      a.account === b.account
        ? a.order - b.order
        : a.account.localeCompare(b.account),
    );
  },
});

export const add = mutation({
  args: fields,
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("ledger")
      .withIndex("by_account", (q) => q.eq("account", args.account))
      .collect();
    const order = existing.reduce((m, r) => Math.max(m, r.order), -1) + 1;
    return ctx.db.insert("ledger", { ...args, order });
  },
});

export const update = mutation({
  args: { id: v.id("ledger"), ...fields },
  handler: async (ctx, { id, ...rest }) => ctx.db.patch(id, rest),
});

export const remove = mutation({
  args: { id: v.id("ledger") },
  handler: async (ctx, { id }) => ctx.db.delete(id),
});
