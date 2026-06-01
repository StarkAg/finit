import { useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { withRunningBalance, LEDGER_ACCOUNTS, type LedgerRow } from "../lib/calc";
import { money, fmtDate } from "../lib/format";
import { Field, Modal, ConfirmDelete } from "./ui";
import { Icon } from "./icons";

type Draft = { account: string; date: string; particular: string; debit: string; credit: string };
const num = (s: string) => (s.trim() === "" ? 0 : Number(s) || 0);

export default function Ledger() {
  const allData = useQuery(api.ledger.list);
  const all = useMemo(() => (allData ?? []) as LedgerRow[], [allData]);
  const add = useMutation(api.ledger.add);
  const update = useMutation(api.ledger.update);
  const remove = useMutation(api.ledger.remove);

  const [account, setAccount] = useState<string>(LEDGER_ACCOUNTS[0]);
  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [d, setD] = useState<Draft>({ account, date: "", particular: "", debit: "", credit: "" });

  const byAccount = useMemo(() => {
    const m: Record<string, LedgerRow[]> = {};
    for (const a of LEDGER_ACCOUNTS) m[a] = [];
    for (const r of all) (m[r.account] ??= []).push(r);
    return m;
  }, [all]);

  const rows = withRunningBalance(byAccount[account] ?? []);
  const balance = rows.length ? rows[rows.length - 1] : null;

  const openAdd = () => {
    setEditId(null);
    setD({ account, date: new Date().toISOString().slice(0, 10), particular: "", debit: "", credit: "" });
    setOpen(true);
  };
  const openEdit = (r: LedgerRow) => {
    setEditId(r._id);
    setD({ account: r.account, date: r.date, particular: r.particular, debit: r.debit ? String(r.debit) : "", credit: r.credit ? String(r.credit) : "" });
    setOpen(true);
  };
  const save = async () => {
    const payload = { account: d.account, date: d.date, particular: d.particular, debit: num(d.debit), credit: num(d.credit) };
    if (editId) await update({ id: editId as Id<"ledger">, ...payload });
    else await add(payload);
    setOpen(false);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h2 className="text-xl font-bold text-slate-100">Ledger</h2>
          <p className="text-sm text-muted">Six accounts, double-entry. Running balance = prior + debit − credit.</p>
        </div>
        <button className="btn-brand w-full sm:w-auto" onClick={openAdd}>
          <Icon name="plus" />
          Add entry
        </button>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
        {LEDGER_ACCOUNTS.map((a) => {
          const b = withRunningBalance(byAccount[a] ?? []);
          const last = b.length ? b[b.length - 1] : null;
          return (
            <button
              key={a}
              onClick={() => setAccount(a)}
              className={`min-w-0 rounded border px-3 py-2 text-left text-sm transition-colors ${a === account ? "border-brand bg-brand/10 text-slate-100" : "border-line bg-panel hover:bg-panel2 text-muted"}`}
            >
              <div className="truncate font-semibold">{a}</div>
              <div className="text-xs">{last ? `${money(last.displayBalance)} ${last.flag}` : "—"}</div>
            </button>
          );
        })}
      </div>

      <div className="card overflow-hidden">
        <div className="flex flex-col gap-1 border-b border-line px-3 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-4">
          <h3 className="font-semibold text-slate-100">{account}</h3>
          {balance && (
            <span className="text-sm text-muted">
              Balance <span className="font-semibold text-slate-100">{money(balance.displayBalance)}</span> {balance.flag}
            </span>
          )}
        </div>
        <div className="divide-y divide-line md:hidden">
          {rows.map((r, i) => (
            <div key={r._id} className="w-full cursor-pointer p-3 text-left hover:bg-panel2/40" onClick={() => openEdit(r)}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-semibold text-slate-100">#{i + 1} · {fmtDate(r.date)}</div>
                  <div className="truncate text-xs text-muted">{r.particular}</div>
                </div>
                <span onClick={(e) => e.stopPropagation()}>
                  <ConfirmDelete onConfirm={() => remove({ id: r._id as Id<"ledger"> })} />
                </span>
              </div>
              <div className="mt-3 grid grid-cols-3 gap-2 text-sm">
                <Mini label="Debit" value={r.debit ? money(r.debit) : "—"} />
                <Mini label="Credit" value={r.credit ? money(r.credit) : "—"} />
                <Mini label="Balance" value={`${money(r.displayBalance)} ${r.flag}`} />
              </div>
            </div>
          ))}
          {rows.length === 0 && <div className="p-3 text-sm text-muted">No entries in {account}.</div>}
        </div>

        <div className="hidden md:block">
          <table className="w-full">
            <thead className="bg-panel2/60">
              <tr>
                <th className="th">#</th>
                <th className="th">Date</th>
                <th className="th">Particular</th>
                <th className="th text-right">Debit</th>
                <th className="th text-right">Credit</th>
                <th className="th text-right">Balance</th>
                <th className="th"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r._id} className="hover:bg-panel2/40 cursor-pointer" onClick={() => openEdit(r)}>
                  <td className="td text-muted">{i + 1}</td>
                  <td className="td">{fmtDate(r.date)}</td>
                  <td className="td">{r.particular}</td>
                  <td className="td text-right">{r.debit ? money(r.debit) : "—"}</td>
                  <td className="td text-right">{r.credit ? money(r.credit) : "—"}</td>
                  <td className="td text-right font-medium">{money(r.displayBalance)} <span className="text-xs text-muted">{r.flag}</span></td>
                  <td className="td text-right" onClick={(e) => e.stopPropagation()}>
                    <ConfirmDelete onConfirm={() => remove({ id: r._id as Id<"ledger"> })} />
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr><td className="td text-muted" colSpan={7}>No entries in {account}.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <Modal open={open} onClose={() => setOpen(false)} title={editId ? "Edit entry" : "Add ledger entry"}>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Account">
            <select className="input" value={d.account} onChange={(e) => setD({ ...d, account: e.target.value })}>
              {LEDGER_ACCOUNTS.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
          </Field>
          <Field label="Date"><input type="date" className="input" value={d.date} onChange={(e) => setD({ ...d, date: e.target.value })} /></Field>
          <div className="sm:col-span-2"><Field label="Particular"><input className="input" value={d.particular} onChange={(e) => setD({ ...d, particular: e.target.value })} placeholder="e.g. Monthly, Net, invested" /></Field></div>
          <Field label="Debit (out)"><input className="input" inputMode="decimal" value={d.debit} onChange={(e) => setD({ ...d, debit: e.target.value })} /></Field>
          <Field label="Credit (in)"><input className="input" inputMode="decimal" value={d.credit} onChange={(e) => setD({ ...d, credit: e.target.value })} /></Field>
        </div>
        <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button className="btn-ghost" onClick={() => setOpen(false)}>Cancel</button>
          <button className="btn-brand" onClick={save} disabled={!d.date || !d.particular}>{editId ? "Save" : "Add"}</button>
        </div>
      </Modal>
    </div>
  );
}

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded bg-panel2/50 px-2.5 py-2">
      <div className="text-[11px] text-muted">{label}</div>
      <div className="truncate font-semibold text-slate-100">{value}</div>
    </div>
  );
}
