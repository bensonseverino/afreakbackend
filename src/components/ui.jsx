import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { formatMoney, toMinor } from "../../shared/money.js";

/* ---------------------------------------------------------------- Button */
const BTN = {
  primary: "bg-ink text-paper border border-ink hover:bg-graphite",
  volt: "bg-volt text-ink border border-volt hover:brightness-95",
  outline: "bg-card text-ink border border-ink hover:bg-mist",
  ghost: "bg-transparent text-ink border border-line hover:border-ink",
  danger: "bg-danger text-paper border border-danger hover:brightness-95",
};

export function Button({ variant = "primary", size = "md", className = "", ...props }) {
  const sizes = {
    sm: "px-3 py-2 text-[12px]",
    md: "px-4 py-2.5 text-[13px]",
    lg: "px-5 py-3 text-[14px]",
  };
  return (
    <button
      {...props}
      className={`label inline-flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed ${BTN[variant]} ${sizes[size]} ${className}`}
    />
  );
}

/* ----------------------------------------------------------------- Field */
export function Field({ label, hint, error, children, className = "" }) {
  return (
    <label className={`block ${className}`}>
      {label && <span className="label block mb-2 text-graphite">{label}</span>}
      {children}
      {hint && !error && <span className="mt-1 block text-[12px] text-stone">{hint}</span>}
      {error && <span className="mt-1 block text-[12px] text-danger">{error}</span>}
    </label>
  );
}

const INPUT =
  "w-full border border-line bg-card px-3 py-2.5 text-[15px] text-ink placeholder:text-stone focus:border-ink outline-none disabled:bg-mist";

export function TextInput({ className = "", ...props }) {
  return <input {...props} className={`${INPUT} ${className}`} />;
}

/**
 * Money field in store minor units. The prefix shows the currency code; the
 * typed value is echoed below exactly as the storefront will render it.
 */
export function MoneyInput({
  value,
  onChange,
  currency = "KES",
  locale = "en-KE",
  allowEmpty = false,
  showFormatted = true,
  className = "",
  placeholder,
  ...props
}) {
  // `null` means "not being edited": show the value derived from props. While
  // typing we keep the raw text so a trailing "." or "0" is not swallowed.
  const [text, setText] = useState(null);
  const display = text ?? (value == null ? "" : (value / 100).toString());

  return (
    <div className={className}>
      <div className="flex items-stretch border border-line bg-card focus-within:border-ink">
        <span className="label flex items-center border-r border-line px-2.5 text-stone">
          {currency}
        </span>
        <input
          {...props}
          inputMode="decimal"
          className="min-w-0 flex-1 bg-transparent px-3 py-2.5 text-[14px] text-ink outline-none"
          placeholder={placeholder}
          value={display}
          onFocus={() => setText(value == null ? "" : (value / 100).toString())}
          onBlur={() => setText(null)}
          onChange={(e) => {
            const raw = e.target.value.replace(/[^\d.]/g, "");
            setText(raw);
            if (raw === "") {
              onChange?.(allowEmpty ? null : 0);
            } else {
              const [whole, ...rest] = raw.split(".");
              const decimals = rest.join("").slice(0, 2);
              onChange?.(toMinor(rest.length ? `${whole}.${decimals}` : whole));
            }
          }}
        />
      </div>
      {showFormatted && (
        <p className="mt-1 text-[11px] text-stone">
          {value == null || text === "" ? "No amount" : formatMoney(value, currency, locale)}
        </p>
      )}
    </div>
  );
}

export function TextArea({ className = "", rows = 4, ...props }) {
  return <textarea rows={rows} {...props} className={`${INPUT} ${className}`} />;
}

export function Select({ className = "", children, ...props }) {
  return (
    <select {...props} className={`${INPUT} ${className}`}>
      {children}
    </select>
  );
}

export function Checkbox({ label, ...props }) {
  return (
    <label className="inline-flex items-center gap-2 cursor-pointer select-none">
      <input type="checkbox" {...props} className="h-4 w-4 accent-ink" />
      <span className="text-[13px] text-graphite">{label}</span>
    </label>
  );
}

/* ----------------------------------------------------------------- Badge */
export function Badge({ tone = "default", children }) {
  const tones = {
    default: "border border-line text-graphite",
    solid: "bg-ink text-paper",
    outline: "border border-ink text-ink",
    stone: "bg-mist text-stone border border-line",
    ok: "border border-ok text-ok",
    warn: "border border-warn text-warn",
    danger: "border border-danger text-danger",
  };
  return <span className={`label inline-block px-2 py-1 ${tones[tone]}`}>{children}</span>;
}

export function StatusDot({ tone }) {
  const map = { ok: "bg-ok", warn: "bg-warn", danger: "bg-danger", graphite: "bg-graphite" };
  return <span className={`inline-block h-2 w-2 ${map[tone] ?? "bg-stone"}`} />;
}

/* -------------------------------------------------------------- Spinner */
export function Spinner({ label = "Loading" }) {
  return (
    <div className="label flex items-center gap-3 py-12 text-stone">
      <span className="h-3 w-3 border-2 border-line border-t-ink animate-spin rounded-full" />
      {label}…
    </div>
  );
}

export function EmptyState({ title, hint, action }) {
  return (
    <div className="border border-dashed border-line bg-card px-6 py-16 text-center">
      <p className="font-display text-[18px] uppercase">{title}</p>
      {hint && <p className="mt-2 text-[13px] text-stone">{hint}</p>}
      {action && <div className="mt-5 flex justify-center">{action}</div>}
    </div>
  );
}

export function ErrorState({ error, onRetry }) {
  return (
    <div className="border border-danger bg-card px-6 py-10 text-center">
      <p className="label text-danger">{error?.message || "Something went wrong"}</p>
      <div className="mt-4">
        <Button variant="outline" onClick={onRetry}>
          Retry
        </Button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------- PageHeader */
export function PageHeader({ title, children }) {
  return (
    <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
      <h1 className="font-display text-[26px] font-extrabold uppercase tracking-tight">{title}</h1>
      <div className="flex flex-wrap items-center gap-2">{children}</div>
    </div>
  );
}

export function Card({ className = "", children }) {
  return <div className={`border border-line bg-card ${className}`}>{children}</div>;
}

export function StatCard({ label, value, sub }) {
  return (
    <Card className="p-4">
      <p className="label text-stone">{label}</p>
      <p className="mt-2 font-display text-[26px] font-extrabold">{value}</p>
      {sub && <p className="mt-1 text-[12px] text-stone">{sub}</p>}
    </Card>
  );
}

/* ----------------------------------------------------------------- Modal */
export function Modal({ open, onClose, title, children, footer, wide }) {
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event) => {
      if (event.key === "Escape") onClose?.();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-ink/50 p-0 sm:p-4">
      <div
        className={`max-h-[92vh] w-full overflow-auto border border-line bg-card ${wide ? "sm:max-w-3xl" : "sm:max-w-lg"}`}
      >
        <div className="sticky top-0 flex items-center justify-between border-b border-line bg-card px-5 py-4">
          <h2 className="font-display text-[15px] font-extrabold uppercase">{title}</h2>
          <button onClick={onClose} className="label text-stone hover:text-ink">
            Close
          </button>
        </div>
        <div className="p-5">{children}</div>
        {footer && (
          <div className="sticky bottom-0 flex justify-end gap-2 border-t border-line bg-card px-5 py-4">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}

export function ConfirmDialog({ open, title, message, confirmLabel = "Confirm", onConfirm, onClose }) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="danger" onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <p className="text-[14px] text-graphite">{message}</p>
    </Modal>
  );
}

/* ------------------------------------------------------------- Pagination */
export function Pagination({ page, pages, onChange }) {
  if (!pages || pages <= 1) return null;
  return (
    <div className="mt-5 flex items-center justify-between">
      <span className="label text-stone">
        Page {page} / {pages}
      </span>
      <div className="flex gap-2">
        <Button variant="ghost" size="sm" disabled={page <= 1} onClick={() => onChange(page - 1)}>
          Prev
        </Button>
        <Button variant="ghost" size="sm" disabled={page >= pages} onClick={() => onChange(page + 1)}>
          Next
        </Button>
      </div>
    </div>
  );
}

/* ----------------------------------------------------------------- Toast */
const ToastCtx = createContext({ push: () => {} });
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }) {
  const [items, setItems] = useState([]);
  const push = useCallback((message, tone = "ink") => {
    const id = Math.random().toString(36).slice(2);
    setItems((prev) => [...prev, { id, message, tone }]);
    setTimeout(() => setItems((prev) => prev.filter((t) => t.id !== id)), 3200);
  }, []);
  const value = useMemo(() => ({ push }), [push]);

  return (
    <ToastCtx.Provider value={value}>
      {children}
      <div className="fixed bottom-4 left-1/2 z-[100] flex -translate-x-1/2 flex-col gap-2">
        {items.map((t) => (
          <div
            key={t.id}
            className={`label border px-4 py-3 ${
              t.tone === "danger" ? "border-danger bg-danger text-paper" : "border-ink bg-ink text-paper"
            }`}
          >
            {t.message}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

/* ------------------------------------------------------------------ Table */
export function Table({ head, children }) {
  return (
    <div className="overflow-x-auto border border-line bg-card">
      <table className="w-full min-w-[640px] border-collapse text-left">
        <thead>
          <tr className="border-b border-line">
            {head.map((h) => (
              <th key={h} className="label px-4 py-3 text-stone whitespace-nowrap">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

export function Toggle({ checked, onChange, label }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className={`label inline-flex items-center gap-2 border px-3 py-2 ${
        checked ? "border-ink bg-ink text-paper" : "border-line bg-card text-stone"
      }`}
    >
      <span className={`inline-block h-2 w-2 ${checked ? "bg-volt" : "bg-stone"}`} />
      {label}
    </button>
  );
}
