import { mutation } from "./_generated/server";

// Backfill stock names harvested from the user's spreadsheet screenshots.
// Matched by buyPrice (unique within each table). Names are reproduced exactly
// as shown in the sheet's linked "Stocks" data type.

const SWING_NAMES: Record<string, string> = {
  "331.75": "EIH LIMITED (XNSE:EIHOTEL)",
  "1635": "KIRLOSKAR BROTHERS LIMITED (XNSE:KIRLOSBROS)",
  "293.7": "CEIGALL INDIA LIMITED (XNSE:CEIGALL)",
  "418.75": "GUJARAT ENERGY LIMITED (XNSE:GUJGASLTD)",
  "234.29": "NIPPON INDIA SILVER ETF (XNSE:SILVERBEES)",
  "635": "ASTER DM HEALTHCARE LIMITED (XNSE:ASTERDM)",
  "2415.4": "RATNAMANI METALS AND TUBES LIMITED (XNSE:RATNAMANI)",
  "44.5": "MOREPEN LABORATORIES LIMITED (XNSE:MOREPENLAB)",
  "60.52": "JAI BALAJI INDUSTRIES LIMITED (XNSE:JAIBALAJI)",
  "225.5": "NIPPON INDIA SILVER ETF (XNSE:SILVERBEES)",
  "38.65": "OLA ELECTRIC MOBILITY LIMITED (XNSE:OLAELEC)",
  "203.85": "ADANI POWER LIMITED (XNSE:ADANIPOWER)",
  "52.14": "SUZLON ENERGY LIMITED (XNSE:SUZLON)",
  "116.09": "WEBSOL ENERGY SYSTEM LIMITED (XNSE:WEBELSOLAR)",
  "1945": "R R KABEL LIMITED (XNSE:RRKABEL)",
  "252.25": "NIPPON INDIA SILVER ETF (XNSE:SILVERBEES)",
  "253.45": "NIPPON INDIA SILVER ETF (XNSE:SILVERBEES)",
  "1949.2": "R R KABEL LIMITED (XNSE:RRKABEL)",
  "196.69": "CORDS CABLE INDUSTRIES LIMITED (XNSE:CORDSCABLE)",
  "648.35": "SALZER ELECTRONICS LIMITED (XNSE:SALZERELEC)",
  "251.47": "NIPPON INDIA SILVER ETF (XNSE:SILVERBEES)",
  "73": "NATIONAL OXYGEN LIMITED (XBOM:507813)",
  "199.93": "DCX SYSTEMS LIMITED (XNSE:DCXINDIA)",
  "153.16": "IKIO TECHNOLOGIES LIMITED (XNSE:IKIO)",
};

const YEARLY_NAMES: Record<string, string> = {
  "164.25": "ADANI POWER LIMITED (XNSE:ADANIPOWER)",
  "758.46": "NIPPON ETF NIFTY NEXT 50 JR BEES (XNSE:JUNIORBEES)",
  "11.38": "GROWW NIFTY METAL ETF (XNSE:GROWWMETAL)",
  "134.25": "ADANI POWER LIMITED (XNSE:ADANIPOWER)",
};

export const backfillSwing = mutation({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query("swing").collect();
    let updated = 0;
    for (const r of rows) {
      const name = SWING_NAMES[String(r.buyPrice)];
      if (name && r.name !== name) {
        await ctx.db.patch(r._id, { name });
        updated++;
      }
    }
    return { updated, total: rows.length };
  },
});

export const backfillYearly = mutation({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query("yearly").collect();
    let updated = 0;
    for (const r of rows) {
      const name = YEARLY_NAMES[String(r.buyPrice)];
      if (name && r.name !== name) {
        await ctx.db.patch(r._id, { name });
        updated++;
      }
    }
    return { updated, total: rows.length };
  },
});
