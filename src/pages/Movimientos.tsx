import { useMemo, useState } from 'react';
import { ArrowDownLeft, ArrowLeftRight, ArrowUpRight, Search } from 'lucide-react';
import type { Tx, TxType } from '../db/db';
import { bs, dayLabel, num } from '../lib/format';
import { useData, useUI } from '../lib/store';
import { Empty, MonthSwitcher } from '../components/ui';

const FILTERS: { value: TxType | 'all'; label: string }[] = [
  { value: 'all', label: 'Todos' },
  { value: 'expense', label: 'Gastos' },
  { value: 'income', label: 'Ingresos' },
  { value: 'transfer', label: 'Transferencias' },
];

const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

export function Movimientos() {
  const { transactions, accounts, categories } = useData();
  const { month, setMonth, openTx } = useUI();
  const [filter, setFilter] = useState<TxType | 'all'>('all');
  const [query, setQuery] = useState('');

  const acc = useMemo(() => new Map(accounts.map((a) => [a.id, a])), [accounts]);
  const cat = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);

  const { groups, income, expense } = useMemo(() => {
    const q = norm(query.trim());
    const list = transactions.filter((t) => {
      if (t.month !== month) return false;
      if (filter !== 'all' && t.type !== filter) return false;
      if (!q) return true;
      const hay = norm([t.note, cat.get(t.categoryId ?? '')?.name, acc.get(t.accountId)?.name, acc.get(t.toAccountId ?? '')?.name, String(t.amount)].filter(Boolean).join(' '));
      return hay.includes(q);
    });
    const byDay = new Map<string, Tx[]>();
    let income = 0, expense = 0;
    for (const t of list) {
      if (!byDay.has(t.date)) byDay.set(t.date, []);
      byDay.get(t.date)!.push(t);
      if (t.type === 'income') income += t.amount;
      if (t.type === 'expense') expense += t.amount;
    }
    return { groups: [...byDay.entries()], income, expense };
  }, [transactions, month, filter, query, acc, cat]);

  return (
    <div className="space-y-4">
      <MonthSwitcher month={month} onChange={setMonth} />

      <div className="grid grid-cols-2 gap-3">
        <div className="card py-3">
          <p className="text-xs text-muted">Ingresos</p>
          <p className="tnum text-lg font-bold text-good">+{num(income)}</p>
        </div>
        <div className="card py-3">
          <p className="text-xs text-muted">Gastos</p>
          <p className="tnum text-lg font-bold text-bad">−{num(expense)}</p>
        </div>
      </div>

      <div className="relative">
        <Search size={16} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted" />
        <input className="input pl-9" type="search" placeholder="Buscar por nota, categoría o cuenta" aria-label="Buscar movimientos" value={query} onChange={(e) => setQuery(e.target.value)} />
      </div>

      <div className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4" role="radiogroup" aria-label="Filtrar por tipo">
        {FILTERS.map((f) => (
          <button key={f.value} role="radio" aria-checked={filter === f.value} onClick={() => setFilter(f.value)} className={`chip ${filter === f.value ? 'chip-on' : ''}`}>
            {f.label}
          </button>
        ))}
      </div>

      {groups.length === 0 ? (
        <Empty title={query || filter !== 'all' ? 'Nada coincide con el filtro' : 'Sin movimientos este mes'} hint={query || filter !== 'all' ? undefined : 'Toca + para registrar un gasto, ingreso o transferencia.'} />
      ) : (
        groups.map(([date, list]) => {
          const net = list.reduce((s, t) => s + (t.type === 'income' ? t.amount : t.type === 'expense' ? -t.amount : 0), 0);
          return (
            <section key={date}>
              <div className="mb-1.5 flex items-baseline justify-between px-1">
                <h2 className="text-xs font-semibold tracking-wide text-muted uppercase">{dayLabel(date)}</h2>
                {net !== 0 && <span className="tnum text-xs text-muted">{net > 0 ? '+' : '−'}{num(Math.abs(net))}</span>}
              </div>
              <ul className="card divide-y divide-line p-0">
                {list.map((t) => {
                  const c = cat.get(t.categoryId ?? '');
                  const a = acc.get(t.accountId);
                  const to = acc.get(t.toAccountId ?? '');
                  const title = t.note || (t.type === 'transfer' ? 'Transferencia' : c?.name ?? 'Movimiento');
                  const sub = t.type === 'transfer' ? `${a?.name ?? '—'} → ${to?.name ?? '—'}` : [t.note ? c?.name : null, a?.name].filter(Boolean).join(' · ');
                  const Icon = t.type === 'income' ? ArrowDownLeft : t.type === 'expense' ? ArrowUpRight : ArrowLeftRight;
                  const tint = t.type === 'transfer' ? 'var(--muted)' : c?.color ?? 'var(--muted)';
                  return (
                    <li key={t.id}>
                      <button className="flex w-full items-center gap-3 px-4 py-3 text-left active:bg-surface-2" onClick={() => openTx({ ...t })}>
                        <span className="flex size-10 shrink-0 items-center justify-center rounded-full" style={{ background: `color-mix(in srgb, ${tint} 18%, transparent)`, color: tint }}>
                          <Icon size={18} />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium">{title}</span>
                          <span className="block truncate text-xs text-muted">{sub}</span>
                        </span>
                        <span className={`tnum shrink-0 text-sm font-semibold ${t.type === 'income' ? 'text-good' : t.type === 'expense' ? '' : 'text-muted'}`}>
                          {t.type === 'income' ? '+' : t.type === 'expense' ? '−' : ''}{num(t.amount)}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })
      )}
      {groups.length > 0 && <p className="pb-2 text-center text-xs text-muted">Balance del mes: {bs(income - expense)}</p>}
    </div>
  );
}
