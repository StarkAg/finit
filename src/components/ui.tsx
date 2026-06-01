import { useEffect, type ReactNode } from "react";
import { Icon } from "./icons";

export function Stat({
  label,
  value,
  sub,
  tone = "default",
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  tone?: "default" | "good" | "bad";
}) {
  const toneClass = tone === "good" ? "text-good" : tone === "bad" ? "text-bad" : "text-slate-100";
  return (
    <div className="card min-w-0 p-3 sm:p-4">
      <div className="text-xs font-medium text-muted">{label}</div>
      <div className={`mt-1 break-words text-xl font-bold tracking-tight sm:text-2xl ${toneClass}`}>{value}</div>
      {sub != null && <div className="mt-0.5 text-xs text-muted">{sub}</div>}
    </div>
  );
}

export function Modal({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto overflow-x-hidden bg-black/60 p-4 backdrop-blur-sm">
      <div className="card flex max-h-[88dvh] w-full max-w-2xl flex-col p-4 shadow-2xl sm:p-5">
        <div className="mb-4 flex shrink-0 items-center justify-between">
          <h3 className="text-lg font-semibold text-slate-100">{title}</h3>
          <button onClick={onClose} className="grid h-8 w-8 place-items-center rounded text-muted hover:bg-panel2 hover:text-slate-200" aria-label="Close">
            <Icon name="close" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto pb-[env(safe-area-inset-bottom)]">{children}</div>
      </div>
    </div>
  );
}

export function Field({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div>
      <span className="label">{label}</span>
      {children}
    </div>
  );
}

export function ConfirmDelete({ onConfirm }: { onConfirm: () => void }) {
  return (
    <button
      onClick={() => {
        if (confirm("Delete this entry?")) onConfirm();
      }}
      className="grid h-9 w-9 place-items-center rounded text-muted hover:bg-panel2 hover:text-bad"
      title="Delete"
      aria-label="Delete"
    >
      <Icon name="trash" />
    </button>
  );
}
