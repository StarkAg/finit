import { cronJobs } from "convex/server";
import { api } from "./_generated/api";

// Persist the day's Groww orders after market close so history accumulates even
// if the app is never opened. 10:30 UTC = 16:00 IST (NSE closes 15:30 IST).
// Requires GROWW_TOTP_TOKEN + GROWW_TOTP_SECRET set in the Convex deployment.
const crons = cronJobs();

crons.daily("sync groww orders", { hourUTC: 10, minuteUTC: 30 }, api.groww.syncOrders, {});

// Persist today's F&O orders from the primary trading account after close.
// 10:35 UTC = 16:05 IST — 35 min after NSE close to allow exchange confirmation.
crons.daily("sync fno orders", { hourUTC: 10, minuteUTC: 35 }, api.groww.syncFnoOrders, {});

// Live F&O position panel: poll Groww every minute during NSE market hours
// (09:15–15:30 IST = 03:45–10:00 UTC, Mon–Fri). The action itself flags whether
// the market is open; this cron just bounds the work to trading hours so we
// don't mint tokens / hit the API around the clock. Reads only — never trades.
crons.cron("poll live position", "* 3-10 * * 1-5", api.groww.pollPosition, {});

// Agentic review: every 5 min during market hours, ask Claude to reason over the
// latest snapshot and post hold/trim/exit verdicts (convex/agent.ts). The action
// skips the model call when no positions are open, so a flat book costs nothing.
// PROPOSE-ONLY — it never places an order.
crons.cron("agent review", "*/5 3-10 * * 1-5", api.agent.reviewPositions, {});

// Fresh "best options to trade today" once per trading morning. 03:50 UTC =
// 09:20 IST, just after the 09:15 open. Scans the latest sector snapshot, asks
// Claude for the top 3 plays, and saves the day's ideas (history accumulates).
// Costs ~1 Opus call per trading day — delete this line to keep ideas manual-only
// (the "Generate ideas" button still works on demand).
crons.cron("agent daily ideas", "50 3 * * 1-5", api.agent.generateIdeas, {});

export default crons;
