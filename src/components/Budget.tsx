import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { budgetCalc, type BudgetRow } from "../lib/calc";
import { money } from "../lib/format";
import { Field, Modal, ConfirmDelete } from "./ui";
import { Icon } from "./icons";

type Draft = {
  date: string;
  cash: string;
  online: string;
  gym: string;
  skill: string;
  extra: string;
  note: string;
};

const empty: Draft = { date: "", cash: "", online: "", gym: "", skill: "", extra: "", note: "" };
const num = (s: string) => (s.trim() === "" ? 0 : Number(s) || 0);

export default function Budget() {
  const rows = (useQuery(api.budget.list) ?? []) as BudgetRow[];
  const add = useMutation(api.budget.add);
  const update = useMutation(api.budget.update);
  const remove = useMutation(api.budget.remove);

  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState<Id<"budget"> | null>(null);
  const [d, setD] = useState<Draft>(empty);

  const preview = budgetCalc({ cash: num(d.cash), online: num(d.online), gym: num(d.gym), skill: num(d.skill), extra: num(d.extra) });

  const openAdd = () => {
    setEditId(null);
    setD({ ...empty, date: new Date().toISOString().slice(0, 10) });
    setOpen(true);
  };
  const openEdit = (r: BudgetRow) => {
    setEditId(r._id as Id<"budget">);
    setD({ date: r.date, cash: String(r.cash), online: String(r.online), gym: String(r.gym), skill: String(r.skill), extra: String(r.extra), note: r.note ?? "" });
    setOpen(true);
  };
  const save = async () => {
    const payload = { date: d.date, cash: num(d.cash), online: num(d.online), gym: num(d.gym), skill: num(d.skill), extra: num(d.extra), note: d.note || undefined };
    if (editId) await update({ id: editId, ...payload });
    else await add(payload);
    setOpen(false);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h2 className="text-xl font-bold text-slate-100">Monthly Budget</h2>
          <p className="text-sm text-muted">Income auto-allocated into Consumption, Investment &amp; Stability.</p>
        </div>
        <button className="btn-brand w-full sm:w-auto" onClick={openAdd}>
          <Icon name="plus" />
          Add month
        </button>
      </div>

      <div className="card overflow-hidden">
        <div className="divide-y divide-line xl:hidden">
          {rows.map((r) => {
            const c = budgetCalc(r);
            return (
              <div key={r._id} className="w-full cursor-pointer p-3 text-left hover:bg-panel2/40" onClick={() => openEdit(r)}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="font-semibold text-slate-100">{r.date}</div>
                    <div className="text-xs text-muted">{r.note || "Monthly allocation"}</div>
                  </div>
                  <div className="flex shrink-0 items-start gap-2">
                    <div className="text-right">
                      <div className="text-xs text-muted">Total</div>
                      <div className="font-semibold text-slate-100">{money(c.total)}</div>
                    </div>
                    <span onClick={(e) => e.stopPropagation()}>
                      <ConfirmDelete onConfirm={() => remove({ id: r._id as Id<"budget"> })} />
                    </span>
                  </div>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2 text-sm sm:grid-cols-3">
                  <Mini label="Income" value={money(c.income)} />
                  <Mini label="Expenses" value={money(c.expenses)} />
                  <Mini label="Want" value={money(c.want)} />
                  <Mini label="Stock" value={money(c.stock)} />
                  <Mini label="SIP" value={money(c.sip)} />
                  <Mini label="Saving" value={money(c.saving)} />
                </div>
              </div>
            );
          })}
          {rows.length === 0 && <div className="p-3 text-sm text-muted">No budget entries yet.</div>}
        </div>

        <div className="hidden xl:block">
          <table className="w-full">
            <thead className="bg-panel2/60">
              <tr>
                <th className="th">Date</th>
                <th className="th text-right">Income</th>
                <th className="th text-right">Expenses</th>
                <th className="th text-right">Want</th>
                <th className="th text-right">Gym</th>
                <th className="th text-right">Skill</th>
                <th className="th text-right">Stock</th>
                <th className="th text-right">SIP</th>
                <th className="th text-right">Saving</th>
                <th className="th text-right">Fixed</th>
                <th className="th text-right">Extra</th>
                <th className="th text-right">Total</th>
                <th className="th"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const c = budgetCalc(r);
                return (
                  <tr key={r._id} className="hover:bg-panel2/40 cursor-pointer" onClick={() => openEdit(r)}>
                    <td className="td font-medium">{r.date}</td>
                    <td className="td text-right">{money(c.income)}</td>
                    <td className="td text-right">{money(c.expenses)}</td>
                    <td className="td text-right">{money(c.want)}</td>
                    <td className="td text-right">{money(r.gym)}</td>
                    <td className="td text-right">{money(r.skill)}</td>
                    <td className="td text-right text-brand">{money(c.stock)}</td>
                    <td className="td text-right text-brand">{money(c.sip)}</td>
                    <td className="td text-right">{money(c.saving)}</td>
                    <td className="td text-right">{money(c.fixed)}</td>
                    <td className="td text-right">{money(r.extra)}</td>
                    <td className="td text-right font-semibold">{money(c.total)}</td>
                    <td className="td text-right" onClick={(e) => e.stopPropagation()}>
                      <ConfirmDelete onConfirm={() => remove({ id: r._id as Id<"budget"> })} />
                    </td>
                  </tr>
                );
              })}
              {rows.length === 0 && (
                <tr><td className="td text-muted" colSpan={13}>No budget entries yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <Modal open={open} onClose={() => setOpen(false)} title={editId ? "Edit month" : "Add month"}>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Field label="Date"><input type="date" className="input" value={d.date} onChange={(e) => setD({ ...d, date: e.target.value })} /></Field>
          <Field label="Cash in"><input className="input" inputMode="decimal" value={d.cash} onChange={(e) => setD({ ...d, cash: e.target.value })} /></Field>
          <Field label="Online in"><input className="input" inputMode="decimal" value={d.online} onChange={(e) => setD({ ...d, online: e.target.value })} /></Field>
          <Field label="Gym"><input className="input" inputMode="decimal" value={d.gym} onChange={(e) => setD({ ...d, gym: e.target.value })} /></Field>
          <Field label="Skill"><input className="input" inputMode="decimal" value={d.skill} onChange={(e) => setD({ ...d, skill: e.target.value })} /></Field>
          <Field label="Extra cashflow"><input className="input" inputMode="decimal" value={d.extra} onChange={(e) => setD({ ...d, extra: e.target.value })} /></Field>
          <div className="sm:col-span-3"><Field label="Note"><input className="input" value={d.note} onChange={(e) => setD({ ...d, note: e.target.value })} /></Field></div>
        </div>

        <div className="mt-4 rounded border border-line bg-panel2/50 p-3">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Auto allocation preview</div>
          <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
            <Prev k="Income" v={preview.income} />
            <Prev k="Expenses" v={preview.expenses} />
            <Prev k="Want" v={preview.want} />
            <Prev k="Consumption" v={preview.consumption} />
            <Prev k="Stock" v={preview.stock} />
            <Prev k="SIP" v={preview.sip} />
            <Prev k="Investment" v={preview.investment} />
            <Prev k="Saving" v={preview.saving} />
            <Prev k="Fixed" v={preview.fixed} />
            <Prev k="Stability" v={preview.stability} />
            <Prev k="Total" v={preview.total} />
          </div>
        </div>

        <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button className="btn-ghost" onClick={() => setOpen(false)}>Cancel</button>
          <button className="btn-brand" onClick={save} disabled={!d.date}>{editId ? "Save" : "Add"}</button>
        </div>
      </Modal>
    </div>
  );
}

function Prev({ k, v }: { k: string; v: number }) {
  return (
    <div className="rounded bg-panel px-2.5 py-1.5">
      <div className="text-[11px] text-muted">{k}</div>
      <div className="font-semibold text-slate-100">{money(v)}</div>
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
