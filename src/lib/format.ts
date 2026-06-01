const inr = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });
const inr2 = new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const money = (n: number | undefined | null, dp = 0) =>
  n == null || isNaN(n) ? "—" : "₹" + (dp === 2 ? inr2 : inr).format(n);

export const pct = (n: number | undefined | null) =>
  n == null || isNaN(n) ? "—" : (n * 100).toFixed(2) + "%";

export const signClass = (n: number) => (n > 0 ? "text-good" : n < 0 ? "text-bad" : "text-muted");

export const fmtDate = (iso?: string) => {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "2-digit" });
};
