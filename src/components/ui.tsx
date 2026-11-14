import { useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import { addMonths, currentMonth, monthLabel } from '../lib/format';
import { onToast } from '../lib/store';

// ---------- Hoja inferior (modal) ----------
export function Sheet({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center">
      <div className="anim-fade absolute inset-0 bg-black/60" onClick={onClose} aria-hidden="true" />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="anim-up relative max-h-[94dvh] w-full max-w-md overflow-y-auto rounded-t-3xl border-t border-line bg-surface pb-[max(1rem,env(safe-area-inset-bottom))]"
      >
        <div className="sticky top-0 z-10 flex items-center justify-between bg-surface py-2 pr-2 pl-5">
          <h2 className="text-base font-semibold">{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Cerrar">
            <X size={20} />
          </button>
        </div>
        <div className="px-5">{children}</div>
      </div>
    </div>,
    document.body,
  );
}

// ---------- Selector de mes ----------
export function MonthSwitcher({ month, onChange }: { month: string; onChange: (m: string) => void }) {
  const isCurrent = month === currentMonth();
  return (
    <div className="flex items-center justify-between">
      <button className="icon-btn" onClick={() => onChange(addMonths(month, -1))} aria-label="Mes anterior">
        <ChevronLeft size={22} />
      </button>
      <button
        className="flex min-h-11 flex-col items-center justify-center px-3"
        onClick={() => onChange(currentMonth())}
        disabled={isCurrent}
        style={{ opacity: 1 }}
        aria-label={isCurrent ? monthLabel(month) : `${monthLabel(month)}. Volver al mes actual`}
      >
        <span className="text-base font-semibold">{monthLabel(month)}</span>
        {!isCurrent && <span className="text-xs text-accent">Volver a hoy</span>}
      </button>
      <button className="icon-btn" onClick={() => onChange(addMonths(month, 1))} aria-label="Mes siguiente">
        <ChevronRight size={22} />
      </button>
    </div>
  );
}

// ---------- Barra de progreso ----------
export function Bar({ value, max, color, height = 10 }: { value: number; max: number; color: string; height?: number }) {
  const pct = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
  return (
    <div className="w-full overflow-hidden rounded-full bg-surface-2" style={{ height }} role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
      <div className="h-full rounded-full transition-[width] duration-500" style={{ width: `${pct}%`, background: color }} />
    </div>
  );
}

// ---------- Control segmentado ----------
export function Segmented<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: { value: T; label: string }[] }) {
  return (
    <div className="flex rounded-xl bg-surface-2 p-1" role="tablist">
      {options.map((o) => (
        <button
          key={o.value}
          role="tab"
          aria-selected={value === o.value}
          onClick={() => onChange(o.value)}
          className={`min-h-10 flex-1 rounded-lg px-2 text-sm font-semibold transition ${value === o.value ? 'bg-surface text-ink shadow-sm' : 'text-muted'}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

// ---------- Estado vacío ----------
export function Empty({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="py-8 text-center">
      <p className="text-sm font-medium">{title}</p>
      {hint && <p className="mt-1 text-sm text-muted">{hint}</p>}
    </div>
  );
}

// ---------- Toast ----------
export function ToastHost() {
  const [msg, setMsg] = useState<{ text: string; id: number } | null>(null);
  useEffect(() => onToast((text) => setMsg({ text, id: Date.now() })), []);
  useEffect(() => {
    if (!msg) return;
    const t = setTimeout(() => setMsg(null), 2400);
    return () => clearTimeout(t);
  }, [msg]);
  if (!msg) return null;
  return createPortal(
    <div className="pointer-events-none fixed inset-x-0 bottom-28 z-[60] flex justify-center px-4" role="status" aria-live="polite">
      <div key={msg.id} className="anim-toast rounded-full bg-ink px-4 py-2.5 text-sm font-medium text-bg shadow-lg">
        {msg.text}
      </div>
    </div>,
    document.body,
  );
}
