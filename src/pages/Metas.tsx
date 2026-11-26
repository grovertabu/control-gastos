import { useMemo, useState } from 'react';
import { Minus, Pencil, Plus } from 'lucide-react';
import { PALETTE, type Goal } from '../db/db';
import { contribute, deleteGoal, saveGoal } from '../db/actions';
import { bs, num, parseAmount, todayISO } from '../lib/format';
import { accountBalances, goalByAccount, reservedByAccount, savedByGoal } from '../lib/stats';
import { useDatabase, toast, useData } from '../lib/store';
import { Bar, Empty } from '../components/ui';
import { EditSheet, type EditConfig } from '../components/EditSheet';

export function Metas() {
  const db = useDatabase();
  const { goals, contributions, accounts, transactions } = useData();
  const [sheet, setSheet] = useState<EditConfig | null>(null);

  const saved = useMemo(() => savedByGoal(contributions), [contributions]);
  const balances = useMemo(() => accountBalances(accounts, transactions), [accounts, transactions]);
  const reserved = useMemo(() => reservedByAccount(contributions), [contributions]);
  const freeOf = (accId: string) => (balances.get(accId) ?? 0) - (reserved.get(accId) ?? 0);

  const totalSaved = goals.reduce((s, g) => s + (saved.get(g.id) ?? 0), 0);
  const totalTarget = goals.reduce((s, g) => s + g.target, 0);

  const editGoal = (g?: Goal) =>
    setSheet({
      title: g ? 'Editar meta' : 'Nueva meta',
      fields: [
        { key: 'name', label: 'Nombre', type: 'text', placeholder: 'Ej. Fondo de emergencia' },
        { key: 'emoji', label: 'Emoji', type: 'text', placeholder: '🎯', maxLength: 4 },
        { key: 'target', label: 'Monto objetivo', type: 'amount' },
        { key: 'color', label: 'Color', type: 'color' },
      ],
      initial: { name: g?.name ?? '', emoji: g?.emoji ?? '🎯', target: g ? String(g.target) : '', color: g?.color ?? PALETTE[(goals.length + 7) % PALETTE.length] },
      onSubmit: async (v) => {
        const name = String(v.name).trim();
        const target = parseAmount(String(v.target));
        if (!name) return 'Ponle un nombre a la meta.';
        if (!(target > 0)) return 'Define un monto objetivo mayor a 0.';
        await saveGoal(db, { name, target, emoji: String(v.emoji).trim() || '🎯', color: String(v.color) }, g?.id);
        toast(g ? 'Meta actualizada' : 'Meta creada');
      },
      onDelete: g
        ? async () => {
            await deleteGoal(db, g.id);
            toast('Meta eliminada');
          }
        : undefined,
      deleteLabel: 'Eliminar meta',
      deleteHint: 'El dinero apartado vuelve a quedar libre en tus cuentas.',
    });

  const deposit = (g: Goal) => {
    if (accounts.length === 0) return toast('Primero crea una cuenta');
    const preferred = accounts.find((a) => a.kind === 'savings' && freeOf(a.id) > 0) ?? [...accounts].sort((a, b) => freeOf(b.id) - freeOf(a.id))[0];
    setSheet({
      title: `Apartar para ${g.name}`,
      submitLabel: 'Apartar dinero',
      fields: [
        { key: 'amount', label: 'Monto', type: 'amount' },
        { key: 'account', label: 'Desde la cuenta', type: 'select', options: accounts.map((a) => ({ value: a.id, label: `${a.name} · libre ${num(freeOf(a.id))}` })), hint: 'El dinero sigue en la cuenta, pero queda reservado para esta meta y deja de contarse como libre.' },
      ],
      initial: { amount: '', account: preferred.id },
      onSubmit: async (v) => {
        const amount = parseAmount(String(v.amount));
        const accId = String(v.account);
        if (!(amount > 0)) return 'Escribe un monto mayor a 0.';
        const free = freeOf(accId);
        if (amount > free + 0.001) return free > 0 ? `En esa cuenta solo tienes ${bs(free)} libres.` : 'Esa cuenta no tiene dinero libre. Registra un ingreso o transfiere dinero primero.';
        await contribute(db, g.id, accId, amount, todayISO());
        toast(`${bs(amount)} apartados para ${g.name}`);
      },
    });
  };

  const withdraw = (g: Goal) => {
    const perAccount = goalByAccount(contributions, g.id);
    const options = accounts.filter((a) => (perAccount.get(a.id) ?? 0) > 0);
    if (options.length === 0) return toast('Esta meta aún no tiene dinero');
    setSheet({
      title: `Retirar de ${g.name}`,
      submitLabel: 'Liberar dinero',
      fields: [
        { key: 'amount', label: 'Monto', type: 'amount' },
        { key: 'account', label: 'Liberar en la cuenta', type: 'select', options: options.map((a) => ({ value: a.id, label: `${a.name} · apartado ${num(perAccount.get(a.id) ?? 0)}` })), hint: 'El dinero vuelve a contarse como libre en esa cuenta.' },
      ],
      initial: { amount: '', account: options[0].id },
      onSubmit: async (v) => {
        const amount = parseAmount(String(v.amount));
        const accId = String(v.account);
        const max = perAccount.get(accId) ?? 0;
        if (!(amount > 0)) return 'Escribe un monto mayor a 0.';
        if (amount > max + 0.001) return `En esa cuenta la meta solo tiene ${bs(max)}.`;
        await contribute(db, g.id, accId, -amount, todayISO());
        toast(`${bs(amount)} liberados`);
      },
    });
  };

  return (
    <div className="space-y-4">
      <section className="card" aria-labelledby="h-metas">
        <h2 id="h-metas" className="text-sm text-muted">Ahorro con propósito</h2>
        <p className="tnum mt-1 text-4xl font-bold tracking-tight text-accent">{bs(totalSaved)}</p>
        {totalTarget > 0 && (
          <>
            <div className="mt-3"><Bar value={totalSaved} max={totalTarget} color="var(--accent)" /></div>
            <p className="mt-2 text-sm text-muted">{Math.round((totalSaved / totalTarget) * 100)}% de {bs(totalTarget)} entre todas tus metas</p>
          </>
        )}
      </section>

      {goals.length === 0 ? (
        <Empty title="Aún no tienes metas" hint="Crea un bolsillo y dale un propósito a tu ahorro." />
      ) : (
        <ul className="space-y-3">
          {goals.map((g) => {
            const s = saved.get(g.id) ?? 0;
            const pct = g.target > 0 ? Math.min(100, Math.round((s / g.target) * 100)) : 0;
            const done = s >= g.target && g.target > 0;
            return (
              <li key={g.id} className="card">
                <div className="flex items-start gap-3">
                  <span className="flex size-11 shrink-0 items-center justify-center rounded-full text-xl" style={{ background: `color-mix(in srgb, ${g.color} 18%, transparent)` }} aria-hidden="true">{g.emoji}</span>
                  <div className="min-w-0 flex-1">
                    <h3 className="truncate text-sm font-semibold">{g.name}</h3>
                    <p className="tnum text-sm text-muted"><span className="font-semibold text-ink">{num(s)}</span> de {num(g.target)} Bs</p>
                  </div>
                  <span className="tnum shrink-0 text-xl font-bold" style={{ color: g.color }}>{pct}%</span>
                </div>
                <div className="mt-3"><Bar value={s} max={g.target} color={g.color} /></div>
                <p className="mt-2 text-xs text-muted">{done ? '¡Meta cumplida! 🎉' : `Te faltan ${bs(g.target - s)}`}</p>
                <div className="mt-3 flex gap-2">
                  <button className="btn btn-primary flex-1" onClick={() => deposit(g)}><Plus size={16} /> Apartar</button>
                  <button className="btn btn-soft flex-1" onClick={() => withdraw(g)} disabled={s <= 0}><Minus size={16} /> Retirar</button>
                  <button className="btn btn-soft px-3" onClick={() => editGoal(g)} aria-label={`Editar ${g.name}`}><Pencil size={16} /></button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <button className="btn btn-soft w-full" onClick={() => editGoal()}><Plus size={16} /> Nueva meta</button>

      <EditSheet config={sheet} onClose={() => setSheet(null)} />
    </div>
  );
}
