import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

const fields = {
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
};

export const list = query({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query("swing").withIndex("by_buyDate").collect();
    return rows.sort((a, b) => a.buyDate.localeCompare(b.buyDate));
  },
});

export const add = mutation({
  args: fields,
  handler: async (ctx, args) => ctx.db.insert("swing", args),
});

export const update = mutation({
  args: { id: v.id("swing"), ...fields },
  handler: async (ctx, { id, ...rest }) => ctx.db.patch(id, rest),
});

export const remove = mutation({
  args: { id: v.id("swing") },
  handler: async (ctx, { id }) => ctx.db.delete(id),
});
