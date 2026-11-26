import { useMemo, useState } from 'react';
import { ArrowLeftRight, Banknote, Landmark, PiggyBank, Plus } from 'lucide-react';
import { PALETTE, type Account, type AccountKind } from '../db/db';
import { deleteAccount, saveAccount } from '../db/actions';
import { bs, num, parseAmount, round2 } from '../lib/format';
import { accountBalances, reservedByAccount } from '../lib/stats';
import { useDatabase, toast, useData, useUI } from '../lib/store';
import { Empty } from '../components/ui';
import { EditSheet, type EditConfig } from '../components/EditSheet';

const KIND_ICON = { cash: Banknote, bank: Landmark, savings: PiggyBank };
const KIND_OPTIONS = [
  { value: 'bank', label: 'Banco' },
  { value: 'cash', label: 'Efectivo / Billetera' },
  { value: 'savings', label: 'Ahorros' },
];

export function Cuentas() {
  const db = useDatabase();
  const { accounts, transactions, contributions } = useData();
  const { openTx } = useUI();
  const [sheet, setSheet] = useState<EditConfig | null>(null);

  const balances = useMemo(() => accountBalances(accounts, transactions), [accounts, transactions]);
  const reserved = useMemo(() => reservedByAccount(contributions), [contributions]);

  const total = accounts.reduce((s, a) => s + (balances.get(a.id) ?? 0), 0);
  const totalReserved = accounts.reduce((s, a) => s + (reserved.get(a.id) ?? 0), 0);
  const free = total - totalReserved;

  const edit = (a?: Account) => {
    const balance = a ? balances.get(a.id) ?? 0 : 0;
    const movCount = a ? transactions.filter((t) => t.accountId === a.id || t.toAccountId === a.id).length : 0;
    setSheet({
      title: a ? 'Editar cuenta' : 'Nueva cuenta',
      fields: [
        { key: 'name', label: 'Nombre', type: 'text', placeholder: 'Ej. Banco Unión, Tigo Money…' },
        { key: 'kind', label: 'Tipo', type: 'select', options: KIND_OPTIONS },
        { key: 'balance', label: a ? 'Saldo actual' : 'Saldo inicial', type: 'amount', hint: a ? 'Si lo cambias, se ajusta el saldo sin crear un movimiento.' : 'Cuánto dinero hay hoy en esta cuenta.' },
        { key: 'color', label: 'Color', type: 'color' },
      ],
      initial: { name: a?.name ?? '', kind: a?.kind ?? 'bank', balance: String(balance), color: a?.color ?? PALETTE[accounts.length % PALETTE.length] },
      onSubmit: async (v) => {
        const name = String(v.name).trim();
        const wanted = parseAmount(String(v.balance) || '0');
        if (!name) return 'Ponle un nombre a la cuenta.';
        if (Number.isNaN(wanted)) return 'El saldo no es un número válido.';
        // El saldo se deriva de los movimientos: se ajusta el saldo inicial para llegar al valor deseado.
        const initialBalance = round2((a?.initialBalance ?? 0) + (wanted - balance));
        await saveAccount(db, { name, kind: v.kind as AccountKind, color: String(v.color), initialBalance }, a?.id);
        toast(a ? 'Cuenta actualizada' : 'Cuenta creada');
      },
      onDelete: a
        ? async () => {
            await deleteAccount(db, a.id);
            toast('Cuenta eliminada');
          }
        : undefined,
      deleteLabel: 'Eliminar cuenta',
      deleteHint: movCount > 0 ? `También se borrarán sus ${movCount} movimientos y lo apartado en metas desde esta cuenta.` : 'Esta acción no se puede deshacer.',
    });
  };

  return (
    <div className="space-y-4">
      <section className="card" aria-labelledby="h-total">
        <h2 id="h-total" className="text-sm text-muted">Dinero total</h2>
        <p className={`tnum mt-1 text-4xl font-bold tracking-tight ${total < 0 ? 'text-bad' : ''}`}>{bs(total)}</p>
        <div className="mt-4 grid grid-cols-2 gap-3 border-t border-line pt-3">
          <div>
            <p className="text-xs text-muted">Libre para gastar</p>
            <p className={`tnum text-lg font-semibold ${free < 0 ? 'text-bad' : ''}`}>{num(free)}</p>
          </div>
          <div>
            <p className="text-xs text-muted">Apartado en metas</p>
            <p className="tnum text-lg font-semibold text-accent">{num(totalReserved)}</p>
          </div>
        </div>
      </section>

      <div className="grid grid-cols-2 gap-3">
        <button className="btn btn-soft" onClick={() => openTx({ type: 'transfer' })} disabled={accounts.length < 2}>
          <ArrowLeftRight size={16} /> Transferir
        </button>
        <button className="btn btn-soft" onClick={() => edit()}>
          <Plus size={16} /> Nueva cuenta
        </button>
      </div>

      {accounts.length === 0 ? (
        <Empty title="No tienes cuentas" hint="Crea una para empezar a registrar movimientos." />
      ) : (
        <ul className="space-y-3">
          {accounts.map((a) => {
            const Icon = KIND_ICON[a.kind] ?? Landmark;
            const bal = balances.get(a.id) ?? 0;
            const res = reserved.get(a.id) ?? 0;
            const libre = bal - res;
            return (
              <li key={a.id}>
                <button className="card w-full text-left active:bg-surface-2" onClick={() => edit(a)} aria-label={`Editar ${a.name}`}>
                  <div className="flex items-center gap-3">
                    <span className="flex size-11 shrink-0 items-center justify-center rounded-full" style={{ background: `color-mix(in srgb, ${a.color} 18%, transparent)`, color: a.color }}>
                      <Icon size={20} />
                    </span>
                    <span className="min-w-0 flex-1 text-sm font-medium">{a.name}</span>
                    <span className={`tnum shrink-0 text-lg font-bold ${bal < 0 ? 'text-bad' : ''}`}>{num(bal)}</span>
                  </div>
                  {res !== 0 && (
                    <div className="mt-3 flex justify-between border-t border-line pt-2.5 text-xs">
                      <span className="text-muted">Apartado en metas: <span className="tnum font-semibold text-accent">{num(res)}</span></span>
                      <span className="text-muted">Libre: <span className={`tnum font-semibold ${libre < 0 ? 'text-bad' : 'text-ink'}`}>{num(libre)}</span></span>
                    </div>
                  )}
                  {libre < 0 && res > 0 && <p className="mt-2 text-xs text-bad">Estás usando {bs(-libre)} del dinero de tus metas.</p>}
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <EditSheet config={sheet} onClose={() => setSheet(null)} />
    </div>
  );
}
