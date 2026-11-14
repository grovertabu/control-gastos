import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, DEFAULT_SETTINGS, type Settings, type TxType } from '../db/db';
import type { AppData } from './stats';

// ---------- Datos (reactivos a IndexedDB) ----------
const DataCtx = createContext<AppData | null>(null);

export function DataProvider({ children }: { children: ReactNode }) {
  const raw = useLiveQuery(async () => {
    const [accounts, categories, transactions, fixedExpenses, goals, contributions, settingRows] = await Promise.all([
      db.accounts.orderBy('order').toArray(),
      db.categories.orderBy('order').toArray(),
      db.transactions.toArray(),
      db.fixedExpenses.orderBy('order').toArray(),
      db.goals.orderBy('order').toArray(),
      db.contributions.toArray(),
      db.settings.toArray(),
    ]);
    return { accounts, categories, transactions, fixedExpenses, goals, contributions, settingRows };
  }, []);

  const data = useMemo<AppData | null>(() => {
    if (!raw) return null;
    const settings = { ...DEFAULT_SETTINGS } as Settings;
    for (const r of raw.settingRows) {
      if (r.key in settings) (settings as unknown as Record<string, unknown>)[r.key] = r.value;
    }
    const transactions = [...raw.transactions].sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt);
    return { ...raw, transactions, settings };
  }, [raw]);

  if (!data) {
    return (
      <div className="flex min-h-dvh items-center justify-center text-sm text-muted" role="status">
        Cargando tus datos…
      </div>
    );
  }
  return <DataCtx.Provider value={data}>{children}</DataCtx.Provider>;
}

export function useData(): AppData {
  const d = useContext(DataCtx);
  if (!d) throw new Error('useData fuera de DataProvider');
  return d;
}

// ---------- Estado de interfaz compartido ----------
export type Tab = 'resumen' | 'movimientos' | 'cuentas' | 'metas' | 'ajustes';

export interface TxDraft {
  id?: string;
  type?: TxType;
  amount?: number;
  accountId?: string;
  toAccountId?: string;
  categoryId?: string;
  note?: string;
  date?: string;
  fixedExpenseId?: string;
}

export interface UI {
  tab: Tab;
  go: (t: Tab) => void;
  month: string;
  setMonth: (m: string) => void;
  openTx: (draft?: TxDraft) => void;
}

export const UICtx = createContext<UI | null>(null);

export function useUI(): UI {
  const u = useContext(UICtx);
  if (!u) throw new Error('useUI fuera de UICtx');
  return u;
}

// ---------- Avisos breves (toast) ----------
type Listener = (msg: string) => void;
const listeners = new Set<Listener>();
export function toast(msg: string) {
  listeners.forEach((l) => l(msg));
}
export function onToast(l: Listener): () => void {
  listeners.add(l);
  return () => { listeners.delete(l); };
}
