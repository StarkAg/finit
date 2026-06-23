import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

// Latest "Aditya's Sector" snapshot (Moneycontrol 1d/5d top-10 method). Returns
// null until the tab's Refresh button has pushed at least once. Parsing of
// `payload` happens client-side.
export const get = query({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query("adityaSector").collect();
    if (!rows.length) return null;
    const latest = rows.reduce((a, b) => (b.updatedAt > a.updatedAt ? b : a));
    return { updatedAt: latest.updatedAt, payload: latest.payload };
  },
});

// Replace the snapshot (single-row table). Called by the runAdityaScan action.
export const push = mutation({
  args: { updatedAt: v.number(), payload: v.string() },
  handler: async (ctx, { updatedAt, payload }) => {
    const existing = await ctx.db.query("adityaSector").collect();
    for (const row of existing) await ctx.db.delete(row._id);
    await ctx.db.insert("adityaSector", { updatedAt, payload });
  },
});
