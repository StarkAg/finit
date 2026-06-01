import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

const fields = {
  date: v.string(),
  cash: v.number(),
  online: v.number(),
  gym: v.number(),
  skill: v.number(),
  extra: v.number(),
  note: v.optional(v.string()),
};

export const list = query({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query("budget").withIndex("by_date").collect();
    return rows.sort((a, b) => a.date.localeCompare(b.date));
  },
});

export const add = mutation({
  args: fields,
  handler: async (ctx, args) => ctx.db.insert("budget", args),
});

export const update = mutation({
  args: { id: v.id("budget"), ...fields },
  handler: async (ctx, { id, ...rest }) => ctx.db.patch(id, rest),
});

export const remove = mutation({
  args: { id: v.id("budget") },
  handler: async (ctx, { id }) => ctx.db.delete(id),
});
