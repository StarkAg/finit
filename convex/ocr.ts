"use node";

import { action } from "./_generated/server";
import { v } from "convex/values";
import { api } from "./_generated/api";
import Anthropic from "@anthropic-ai/sdk";

// Read a Groww "Order Details" screenshot with Claude Sonnet vision and return
// structured fields. Runs server-side so the API key stays secret (no CORS).
// Set the key once:  npx convex env set ANTHROPIC_API_KEY sk-ant-...

const SYSTEM = `You read screenshots of the Groww app "Order Details" screen and return the order as strict JSON.
Output ONLY a JSON object with exactly these keys (use null when unreadable):
{
  "side": "BUY" | "SELL" | null,        // from "Order Type" (e.g. "Buy, Delivery, Regular" -> "BUY")
  "stockName": string | null,           // the stock/ETF name under the quantity
  "qty": integer | null,                // the number next to "Qty" near the top
  "avgPrice": number | null,            // the number after "Avg price" (the executed ₹ amount)
  "orderPrice": number | null,          // the number in "Limit at ₹X"/"Trigger price ₹X"; null for "Market"
  "date": string | null,                // "Order Executed" date as ISO yyyy-mm-dd (else first date shown)
  "exchange": "NSE" | "BSE" | null,
  "status": "success" | "failed" | null, // "failed" if Cancelled/Unsuccessful/Rejected, else "success"
  "ticker": string | null               // the stock's NSE/BSE trading symbol from your knowledge (e.g. "RELIANCE", "JUNIORBEES", "ANDHRAPET", "PANACEABIO") — UPPERCASE, no .NS/.BO suffix. null if unsure.
}
No prose, no markdown fences — only the JSON object.`;

type Media = "image/jpeg" | "image/png" | "image/gif" | "image/webp";

export const extractOrder = action({
  args: { image: v.string(), mediaType: v.string() }, // image = base64 (no data: prefix)
  handler: async (ctx, { image, mediaType }) => {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error("ANTHROPIC_API_KEY not set. Run: npx convex env set ANTHROPIC_API_KEY sk-ant-...");
    }
    const client = new Anthropic({ apiKey });
    const media: Media = (["image/jpeg", "image/png", "image/gif", "image/webp"].includes(mediaType)
      ? mediaType
      : "image/jpeg") as Media;

    const resp = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 700,
      system: SYSTEM,
      messages: [
        {
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: media, data: image } },
            { type: "text", text: "Extract this Groww order as JSON." },
          ],
        },
      ],
    });

    const textBlock = resp.content.find((b) => b.type === "text");
    const raw = textBlock && textBlock.type === "text" ? textBlock.text : "";
    const match = raw.match(/\{[\s\S]*\}/); // tolerate stray prose/fences
    if (!match) throw new Error("Model did not return JSON");
    const parsed = JSON.parse(match[0]);

    let stockName: string | null = parsed.stockName ?? null;
    const exchange: "NSE" | "BSE" | null = parsed.exchange ?? null;
    const ticker: string | null = typeof parsed.ticker === "string" ? parsed.ticker.trim().toUpperCase() : null;

    // Resolve the live-market symbol: validate the model's ticker guess against a
    // real Yahoo quote, then embed the verified code in the name so the app's
    // existing price-refresh (quoteSymbol parses "(XNSE:TICKER)") matches it.
    if (parsed.status !== "failed" && stockName && exchange && ticker && !/\(X?(NSE|BSE|BOM):/i.test(stockName)) {
      const yahoo = `${ticker.replace(/[^A-Z0-9&-]/g, "")}.${exchange === "BSE" ? "BO" : "NS"}`;
      try {
        const res = await ctx.runAction(api.quotes.latest, { symbols: [yahoo] });
        if (res[0]?.ok) {
          stockName = `${stockName} (${exchange === "BSE" ? "XBOM" : "XNSE"}:${ticker})`;
        }
      } catch {
        // leave name plain if validation fails — user can fix in review
      }
    }

    return {
      side: parsed.side ?? null,
      stockName,
      qty: typeof parsed.qty === "number" ? parsed.qty : null,
      avgPrice: typeof parsed.avgPrice === "number" ? parsed.avgPrice : null,
      orderPrice: typeof parsed.orderPrice === "number" ? parsed.orderPrice : null,
      date: parsed.date ?? null,
      exchange: parsed.exchange ?? null,
      status: parsed.status ?? null,
    } as {
      side: "BUY" | "SELL" | null;
      stockName: string | null;
      qty: number | null;
      avgPrice: number | null;
      orderPrice: number | null;
      date: string | null;
      exchange: "NSE" | "BSE" | null;
      status: "success" | "failed" | null;
    };
  },
});
