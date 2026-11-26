import { useCallback, useEffect, useState } from 'react';
import { ArrowRight, Delete, Trash2 } from 'lucide-react';
import { CAT_EXTRA, CAT_FIXED, CAT_SALARY, type TxType } from '../db/db';
import { deleteTx, saveTx } from '../db/actions';
import { num, todayISO } from '../lib/format';
import { useDatabase, toast, useData, type TxDraft } from '../lib/store';
import { Segmented, Sheet } from './ui';

const TYPE_OPTIONS: { value: TxType; label: string }[] = [
  { value: 'expense', label: 'Gasto' },
  { value: 'income', label: 'Ingreso' },
  { value: 'transfer', label: 'Transferencia' },
];
const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', ',', '0', 'del'];

export function TxSheet({ draft, onClose }: { draft: TxDraft | null; onClose: () => void }) {
  const editing = !!draft?.id;
  return (
    <Sheet open={!!draft} onClose={onClose} title={editing ? 'Editar movimiento' : 'Nuevo movimiento'}>
      {draft && <TxForm draft={draft} onClose={onClose} />}
    </Sheet>
  );
}

/** "1234.5" -> "1.234,5" conservando lo que el usuario va tecleando. */
function showTyping(s: string): string {
  if (!s) return '0';
  const [int, dec] = s.split('.');
  return num(Number(int || '0')) + (s.includes('.') ? ',' + (dec ?? '') : '');
}

function TxForm({ draft, onClose }: { draft: TxDraft; onClose: () => void }) {
  const db = useDatabase();
  const { accounts, categories, settings, fixedExpenses } = useData();
  const isFixedPayment = !!draft.fixedExpenseId;
  const firstAccount = accounts.find((a) => a.id === settings.lastAccountId)?.id ?? accounts[0]?.id ?? '';

  const [type, setType] = useState<TxType>(draft.type ?? 'expense');
  const [amount, setAmount] = useState(draft.amount ? String(draft.amount) : '');
  const [accountId, setAccountId] = useState(draft.accountId ?? firstAccount);
  const [toAccountId, setToAccountId] = useState(draft.toAccountId ?? accounts.find((a) => a.id !== (draft.accountId ?? firstAccount))?.id ?? '');
  const [categoryId, setCategoryId] = useState(draft.categoryId ?? '');
  const [note, setNote] = useState(draft.note ?? '');
  const [date, setDate] = useState(draft.date ?? todayISO());
  const [confirmDelete, setConfirmDelete] = useState(false);

  const cats = categories.filter((c) => c.kind === (type === 'income' ? 'income' : 'expense'));
  // La categoría elegida solo vale si pertenece al tipo actual; si no, se usa la primera.
  const effectiveCategory = isFixedPayment
    ? CAT_FIXED
    : cats.find((c) => c.id === categoryId)?.id ?? (type === 'income' ? (cats.find((c) => c.id === CAT_EXTRA) ?? cats[0])?.id : cats[0]?.id) ?? '';

  const press = useCallback((k: string) => {
    setAmount((a) => {
      if (k === 'del') return a.slice(0, -1);
      if (k === ',') return a.includes('.') ? a : (a || '0') + '.';
      if (a.includes('.') && a.split('.')[1].length >= 2) return a;
      if (a.replace('.', '').length >= 9) return a;
      if (a === '0') return k;
      return a + k;
    });
  }, []);

  const value = Number(amount || '0');
  const canSave = value > 0 && !!accountId && (type !== 'transfer' || (!!toAccountId && toAccountId !== accountId));

  const save = useCallback(async () => {
    if (!(value > 0)) return toast('Escribe un monto mayor a 0');
    if (!accountId) return toast('Primero crea una cuenta');
    if (type === 'transfer' && (!toAccountId || toAccountId === accountId)) return toast('Elige una cuenta destino distinta');
    await saveTx(db, {
        type, amount: value, accountId, note, date: date || todayISO(),
        toAccountId: type === 'transfer' ? toAccountId : undefined,
        categoryId: type === 'transfer' ? undefined : effectiveCategory,
        fixedExpenseId: draft.fixedExpenseId,
      },
      draft.id,
    );
    toast(draft.id ? 'Movimiento actualizado' : type === 'expense' ? 'Gasto registrado' : type === 'income' ? 'Ingreso registrado' : 'Transferencia registrada');
    onClose();
  }, [value, accountId, toAccountId, type, note, date, effectiveCategory, draft.id, draft.fixedExpenseId, onClose]);

  // Teclado físico (escritorio): dígitos, coma/punto, retroceso y Enter.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el.tagName === 'INPUT' || el.tagName === 'SELECT' || el.tagName === 'TEXTAREA') return;
      if (/^\d$/.test(e.key)) press(e.key);
      else if (e.key === ',' || e.key === '.') press(',');
      else if (e.key === 'Backspace') press('del');
      else if (e.key === 'Enter') { e.preventDefault(); void save(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [press, save]);

  const amountColor = type === 'expense' ? 'text-bad' : type === 'income' ? 'text-good' : 'text-ink';
  const fixedName = fixedExpenses.find((f) => f.id === draft.fixedExpenseId)?.name;

  const accountChips = (selected: string, onPick: (id: string) => void, label: string) => (
    <div>
      <span className="label">{label}</span>
      <div className="no-scrollbar -mx-5 flex gap-2 overflow-x-auto px-5" role="radiogroup" aria-label={label}>
        {accounts.map((a) => (
          <button key={a.id} type="button" role="radio" aria-checked={selected === a.id} onClick={() => onPick(a.id)} className={`chip ${selected === a.id ? 'chip-on' : ''}`}>
            <span className="size-2.5 shrink-0 rounded-full" style={{ background: a.color }} />
            <span className="max-w-36 truncate">{a.name}</span>
          </button>
        ))}
      </div>
    </div>
  );

  return (
    <div className="space-y-3.5">
      {isFixedPayment ? (
        <p className="rounded-xl bg-surface-2 px-3 py-2 text-sm text-muted">Pago de gasto fijo{fixedName ? `: ${fixedName}` : ''}</p>
      ) : (
        <Segmented value={type} onChange={setType} options={TYPE_OPTIONS} />
      )}

      <div className="flex items-baseline justify-center gap-2 py-1" aria-live="polite">
        <span className="text-xl font-medium text-muted">Bs</span>
        <span className={`tnum text-5xl font-bold tracking-tight ${amountColor}`}>{showTyping(amount)}</span>
      </div>

      {accountChips(accountId, setAccountId, type === 'transfer' ? 'Desde' : type === 'income' ? 'Entra a' : 'Sale de')}
      {type === 'transfer' && (
        <>
          <div className="flex justify-center text-muted"><ArrowRight size={16} className="rotate-90" /></div>
          {accountChips(toAccountId, setToAccountId, 'Hacia')}
        </>
      )}

      {type !== 'transfer' && !isFixedPayment && (
        <div>
          <span className="label">Categoría</span>
          <div className="no-scrollbar -mx-5 flex gap-2 overflow-x-auto px-5" role="radiogroup" aria-label="Categoría">
            {cats.map((c) => (
              <button key={c.id} type="button" role="radio" aria-checked={effectiveCategory === c.id} onClick={() => setCategoryId(c.id)} className={`chip ${effectiveCategory === c.id ? 'chip-on' : ''}`}>
                <span className="size-2.5 shrink-0 rounded-full" style={{ background: c.color }} />
                {c.name}
              </button>
            ))}
          </div>
          {type === 'income' && effectiveCategory === CAT_SALARY && (
            <p className="mt-1.5 text-xs text-muted">El sueldo suma al saldo de la cuenta, pero no al presupuesto del mes: ya está contado como ingreso base.</p>
          )}
        </div>
      )}

      <div className="flex gap-2">
        <input className="input min-w-0 flex-1" placeholder="Nota (opcional)" aria-label="Nota" value={note} maxLength={80} onChange={(e) => setNote(e.target.value)} autoComplete="off" />
        <input type="date" className="input w-auto shrink-0 px-2" aria-label="Fecha" value={date} onChange={(e) => setDate(e.target.value)} />
      </div>

      <div className="grid grid-cols-3 gap-2" aria-label="Teclado numérico">
        {KEYS.map((k) => (
          <button key={k} type="button" onClick={() => press(k)} aria-label={k === 'del' ? 'Borrar' : k === ',' ? 'Coma decimal' : k} className="flex h-13 items-center justify-center rounded-xl bg-surface-2 text-2xl font-semibold transition select-none active:scale-95 active:bg-line">
            {k === 'del' ? <Delete size={24} /> : k}
          </button>
        ))}
      </div>

      <div className="flex gap-2">
        {draft.id && (
          <button
            type="button"
            className="btn btn-danger h-13 shrink-0"
            aria-label="Eliminar movimiento"
            onClick={async () => {
              if (!confirmDelete) return setConfirmDelete(true);
              await deleteTx(db, draft.id!);
              toast('Movimiento eliminado');
              onClose();
            }}
          >
            <Trash2 size={18} />
            {confirmDelete && '¿Seguro?'}
          </button>
        )}
        <button type="button" className="btn btn-primary h-13 flex-1 text-base" onClick={save} disabled={!canSave}>
          {draft.id ? 'Guardar cambios' : 'Guardar'}
        </button>
      </div>
    </div>
  );
}
