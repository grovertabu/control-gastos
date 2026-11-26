import { useRef, useState, type FormEvent } from 'react';
import { Check, LoaderCircle, Trash2 } from 'lucide-react';
import { PALETTE } from '../db/db';
import { Sheet } from './ui';

export interface Field {
  key: string;
  label: string;
  type: 'text' | 'amount' | 'select' | 'color' | 'toggle' | 'date';
  options?: { value: string; label: string }[];
  placeholder?: string;
  hint?: string;
  maxLength?: number;
}

export type Values = Record<string, string | boolean>;

export interface EditConfig {
  title: string;
  fields: Field[];
  initial: Values;
  submitLabel?: string;
  /** Devuelve un texto de error para mostrarlo, o nada si todo salió bien. */
  onSubmit: (v: Values) => Promise<string | void> | string | void;
  onDelete?: () => Promise<void> | void;
  deleteLabel?: string;
  deleteHint?: string;
}

/** Formulario genérico en hoja inferior: se usa para cuentas, metas, gastos fijos, categorías y ajustes. */
export function EditSheet({ config, onClose }: { config: EditConfig | null; onClose: () => void }) {
  return (
    <Sheet open={!!config} onClose={onClose} title={config?.title ?? ''}>
      {config && <Form config={config} onClose={onClose} />}
    </Sheet>
  );
}

function Form({ config, onClose }: { config: EditConfig; onClose: () => void }) {
  const [v, setV] = useState<Values>(config.initial);
  const [error, setError] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);
  const set = (k: string, val: string | boolean) => setV((p) => ({ ...p, [k]: val }));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (submitting.current) return;

    submitting.current = true;
    setError('');
    setBusy(true);
    try {
      const err = await config.onSubmit(v);
      if (err) setError(err);
      else onClose();
    } catch (ex) {
      setError(ex instanceof Error ? ex.message : 'No se pudo guardar.');
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-4 pb-2" noValidate>
      {config.fields.map((f) => {
        const id = `f-${f.key}`;
        return (
          <div key={f.key}>
            {f.type !== 'toggle' && <label htmlFor={id} className="label">{f.label}</label>}
            {f.type === 'text' && (
              <input id={id} className="input" value={String(v[f.key] ?? '')} placeholder={f.placeholder} maxLength={f.maxLength ?? 60} onChange={(e) => set(f.key, e.target.value)} autoComplete="off" />
            )}
            {f.type === 'amount' && (
              <div className="relative">
                <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-sm text-muted">Bs</span>
                <input id={id} className="input tnum pl-10" inputMode="decimal" value={String(v[f.key] ?? '')} placeholder={f.placeholder ?? '0'} onChange={(e) => set(f.key, e.target.value.replace(/[^\d.,-]/g, ''))} onFocus={(e) => e.target.select()} autoComplete="off" />
              </div>
            )}
            {f.type === 'date' && (
              <input id={id} type="date" className="input" value={String(v[f.key] ?? '')} onChange={(e) => set(f.key, e.target.value)} />
            )}
            {f.type === 'select' && (
              <select id={id} className="input" value={String(v[f.key] ?? '')} onChange={(e) => set(f.key, e.target.value)}>
                {f.options?.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            )}
            {f.type === 'color' && (
              <div id={id} className="flex flex-wrap gap-2" role="radiogroup" aria-label={f.label}>
                {PALETTE.map((c) => (
                  <button key={c} type="button" role="radio" aria-checked={v[f.key] === c} aria-label={`Color ${c}`} onClick={() => set(f.key, c)} className="flex size-10 items-center justify-center rounded-full" style={{ background: c }}>
                    {v[f.key] === c && <Check size={18} color="#0b0f14" strokeWidth={3} />}
                  </button>
                ))}
              </div>
            )}
            {f.type === 'toggle' && (
              <label className="flex min-h-11 items-center justify-between gap-3">
                <span className="text-sm font-medium">{f.label}</span>
                <input type="checkbox" className="size-5 accent-(--accent)" checked={!!v[f.key]} onChange={(e) => set(f.key, e.target.checked)} />
              </label>
            )}
            {f.hint && <p className="mt-1.5 text-xs text-muted">{f.hint}</p>}
          </div>
        );
      })}

      {error && <p className="rounded-xl bg-bad/15 px-3 py-2 text-sm text-bad" role="alert">{error}</p>}

      <p className="sr-only" role="status">{busy ? 'Guardando cambios…' : ''}</p>
      <button type="submit" className="btn btn-primary w-full" disabled={busy} aria-busy={busy}>
        {busy && <LoaderCircle size={18} className="motion-safe:animate-spin" aria-hidden="true" />}
        {busy ? 'Guardando…' : config.submitLabel ?? 'Guardar'}
      </button>

      {config.onDelete && (
        <div>
          <button
            type="button"
            className="btn btn-danger w-full"
            disabled={busy}
            onClick={async () => {
              if (!confirmDelete) return setConfirmDelete(true);
              await config.onDelete?.();
              onClose();
            }}
          >
            <Trash2 size={16} />
            {confirmDelete ? 'Toca otra vez para confirmar' : config.deleteLabel ?? 'Eliminar'}
          </button>
          {confirmDelete && config.deleteHint && <p className="mt-1.5 text-center text-xs text-muted">{config.deleteHint}</p>}
        </div>
      )}
    </form>
  );
}
