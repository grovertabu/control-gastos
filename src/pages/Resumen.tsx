import { useMemo, useState } from 'react';
import { Check, Pencil, TrendingDown, TrendingUp } from 'lucide-react';
import { CAT_SALARY } from '../db/db';
import { payFixed, setFixedAccount, setSetting, unpayFixed } from '../db/actions';
import { addMonths, bs, currentMonth, daysLeft, defaultDateFor, monthShort, num, parseAmount } from '../lib/format';
import { compareMonths, monthSummary } from '../lib/stats';
import { toast, useData, useUI } from '../lib/store';
import { Bar, Empty, MonthSwitcher, Segmented } from '../components/ui';
import { Donut } from '../components/Donut';
import { EditSheet, type EditConfig } from '../components/EditSheet';

export function Resumen() {
  const data = useData();
  const { month, setMonth, openTx } = useUI();
  const [sheet, setSheet] = useState<EditConfig | null>(null);
  const [chartBy, setChartBy] = useState<'category' | 'account'>('category');

  const cur = useMemo(() => monthSummary(data, month), [data, month]);
  const prevMonth = addMonths(month, -1);
  const prev = useMemo(() => monthSummary(data, prevMonth), [data, prevMonth]);
  const compare = useMemo(() => compareMonths(cur, prev), [cur, prev]);

  const { settings, accounts } = data;
  const limit = settings.variableLimit;
  const ratio = limit > 0 ? cur.variable / limit : cur.variable > 0 ? 2 : 0;
  const over = cur.variable - limit;
  const left = daysLeft(month);
  const zone = ratio > 1 ? 'bad' : ratio >= 0.8 ? 'warn' : 'good';
  const zoneColor = `var(--${zone})`;

  const editLimit = () =>
    setSheet({
      title: 'Límite de "Gasto sin culpa"',
      fields: [{ key: 'limit', label: 'Límite mensual para gastos variables', type: 'amount', hint: 'Lo que puedes gastar en comida, salidas, compras, etc. sin tocar tus ahorros.' }],
      initial: { limit: String(limit) },
      onSubmit: async (v) => {
        const n = parseAmount(String(v.limit));
        if (!(n >= 0)) return 'Escribe un monto válido.';
        await setSetting('variableLimit', n);
      },
    });

  const editIncome = () =>
    setSheet({
      title: 'Ingreso mensual base',
      fields: [{ key: 'income', label: 'Ingreso mensual', type: 'amount', hint: 'Tu sueldo fijo. Los ingresos extra que registres se suman aparte.' }],
      initial: { income: String(settings.monthlyIncome) },
      onSubmit: async (v) => {
        const n = parseAmount(String(v.income));
        if (!(n >= 0)) return 'Escribe un monto válido.';
        await setSetting('monthlyIncome', n);
      },
    });

  const paidCount = cur.fixedList.filter((f) => f.paidTx).length;
  const slices = chartBy === 'category' ? cur.byCategory : cur.byAccount;
  const topRise = compare.find((r) => r.delta > 0);
  const maxCompare = Math.max(1, ...compare.map((r) => Math.max(r.current, r.previous)));
  const totalDelta = cur.totalSpent - prev.totalSpent;
  const showSalaryPrompt = month === currentMonth() && cur.salaryRecorded === 0 && settings.monthlyIncome > 0;

  return (
    <div className="space-y-4">
      <MonthSwitcher month={month} onChange={setMonth} />

      {/* Saldo disponible real */}
      <section className="card" aria-labelledby="h-disp">
        <h2 id="h-disp" className="text-sm text-muted">Disponible real este mes</h2>
        <p className={`tnum mt-1 text-4xl font-bold tracking-tight ${cur.available < 0 ? 'text-bad' : ''}`}>{bs(cur.available)}</p>
        <p className="mt-1 text-sm text-muted">
          {cur.available < 0
            ? 'Ya gastaste más de lo que ingresa este mes.'
            : left > 0
              ? `≈ ${bs(cur.available / left)} por día durante ${left} ${left === 1 ? 'día' : 'días'}`
              : 'Así cerró el mes.'}
        </p>

        <dl className="mt-4 space-y-2 border-t border-line pt-3 text-sm">
          <div className="flex items-center justify-between">
            <dt className="text-muted">
              <button className="-my-2 inline-flex min-h-9 items-center gap-1.5" onClick={editIncome} aria-label="Editar ingreso mensual base">
                Ingreso base <Pencil size={12} />
              </button>
            </dt>
            <dd className="tnum font-medium">{num(cur.baseIncome)}</dd>
          </div>
          {cur.extraIncome > 0 && (
            <div className="flex justify-between"><dt className="text-muted">Ingresos extra</dt><dd className="tnum font-medium text-good">+{num(cur.extraIncome)}</dd></div>
          )}
          <div className="flex justify-between">
            <dt className="text-muted">Gastos fijos <span className="text-xs">({num(cur.fixedPaid)} pagado · {num(cur.fixedPending)} pendiente)</span></dt>
            <dd className="tnum font-medium">{cur.fixedTotal > 0 ? '−' : ''}{num(cur.fixedTotal)}</dd>
          </div>
          <div className="flex justify-between"><dt className="text-muted">Gastos variables</dt><dd className="tnum font-medium">{cur.variable > 0 ? '−' : ''}{num(cur.variable)}</dd></div>
          {cur.savedToGoals !== 0 && (
            <div className="flex justify-between border-t border-line pt-2"><dt className="text-muted">Apartado a metas este mes</dt><dd className="tnum font-medium text-accent">{num(cur.savedToGoals)}</dd></div>
          )}
        </dl>

        {showSalaryPrompt && (
          <button
            className="btn btn-soft mt-3 w-full"
            onClick={() => openTx({ type: 'income', amount: settings.monthlyIncome, categoryId: CAT_SALARY, accountId: accounts.find((a) => a.kind === 'bank')?.id, note: 'Sueldo' })}
          >
            ¿Ya te pagaron? Registrar sueldo en tu cuenta
          </button>
        )}
      </section>

      {/* Gasto sin culpa vs. desvío */}
      <section className="card" aria-labelledby="h-culpa">
        <div className="flex items-start justify-between gap-2">
          <div>
            <h2 id="h-culpa" className="text-sm font-semibold">{ratio > 1 ? 'Desvío' : 'Gasto sin culpa'}</h2>
            <p className="tnum mt-1 text-2xl font-bold" style={{ color: zoneColor }}>
              {num(cur.variable)} <span className="text-sm font-medium text-muted">de {num(limit)} Bs</span>
            </p>
          </div>
          <button className="btn btn-soft min-h-9 px-3 text-xs" onClick={editLimit}>
            <Pencil size={12} /> Límite
          </button>
        </div>
        <div className="mt-3">
          <Bar value={cur.variable} max={limit || cur.variable || 1} color={zoneColor} height={12} />
        </div>
        <p className="mt-2 text-sm text-muted">
          {ratio > 1
            ? `Te pasaste por ${bs(over)}: ese dinero sale de tus ahorros.`
            : ratio >= 0.8
              ? `Cuidado, te quedan ${bs(-over)} de gasto sano${left > 0 ? ` para ${left} ${left === 1 ? 'día' : 'días'}` : ''}.`
              : `Vas bien. Te quedan ${bs(-over)}${left > 0 ? ` (≈ ${bs(-over / left)} por día)` : ''}.`}
        </p>
      </section>

      {/* Gastos fijos */}
      <section className="card" aria-labelledby="h-fijos">
        <div className="flex items-baseline justify-between">
          <h2 id="h-fijos" className="text-sm font-semibold">Gastos fijos del mes</h2>
          <span className="text-xs text-muted">{paidCount}/{cur.fixedList.length} pagados</span>
        </div>
        {cur.fixedList.length === 0 ? (
          <Empty title="Sin gastos fijos" hint="Agrégalos desde Ajustes." />
        ) : (
          <ul className="mt-2 divide-y divide-line">
            {cur.fixedList.map(({ fixed: f, paidTx }) => {
              const accId = paidTx?.accountId ?? (accounts.some((a) => a.id === f.accountId) ? f.accountId! : accounts[0]?.id ?? '');
              return (
                <li key={f.id} className="flex items-center gap-3 py-2.5">
                  <button
                    role="switch"
                    aria-checked={!!paidTx}
                    aria-label={`${f.name}: ${paidTx ? 'pagado' : 'pendiente'}`}
                    className={`flex size-11 shrink-0 items-center justify-center rounded-full border-2 transition active:scale-90 ${paidTx ? 'border-accent bg-accent text-accent-ink' : 'border-line text-transparent'}`}
                    onClick={async () => {
                      if (paidTx) {
                        await unpayFixed(f.id, month);
                        toast(`${f.name}: marcado como pendiente`);
                      } else if (!accId) {
                        toast('Primero crea una cuenta');
                      } else {
                        await payFixed(f, month, defaultDateFor(month), accId);
                        toast(`${f.name} pagado · ${bs(f.amount)}`);
                      }
                    }}
                  >
                    <Check size={20} strokeWidth={3} />
                  </button>
                  <div className="min-w-0 flex-1">
                    <p className={`truncate text-sm font-medium ${paidTx ? 'text-muted line-through' : ''}`}>{f.name}</p>
                    <select
                      className="mt-0.5 max-w-full truncate rounded-md bg-transparent py-1 text-xs text-muted"
                      aria-label={`Cuenta de pago de ${f.name}`}
                      value={accId}
                      onChange={(e) => setFixedAccount(f.id, month, e.target.value)}
                    >
                      {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                    </select>
                  </div>
                  <span className="tnum shrink-0 text-sm font-semibold">{num(paidTx?.amount ?? f.amount)}</span>
                </li>
              );
            })}
          </ul>
        )}
        {cur.fixedPending > 0 && <p className="mt-2 border-t border-line pt-2 text-sm text-muted">Te falta pagar <span className="tnum font-semibold text-ink">{bs(cur.fixedPending)}</span></p>}
      </section>

      {/* Distribución */}
      <section className="card" aria-labelledby="h-dist">
        <h2 id="h-dist" className="mb-3 text-sm font-semibold">¿En qué se fue el dinero?</h2>
        <Segmented value={chartBy} onChange={setChartBy} options={[{ value: 'category', label: 'Por categoría' }, { value: 'account', label: 'Por cuenta' }]} />
        <div className="mt-4">
          {slices.length === 0 ? (
            <Empty title="Aún no hay gastos este mes" hint="Toca + para registrar el primero." />
          ) : (
            <Donut slices={slices} centerLabel="Gastado" />
          )}
        </div>
      </section>

      {/* Comparativa mes a mes */}
      <section className="card" aria-labelledby="h-comp">
        <div className="flex items-baseline justify-between">
          <h2 id="h-comp" className="text-sm font-semibold">{monthShort(month)} vs. {monthShort(prevMonth)}</h2>
          <div className="flex items-center gap-3 text-xs text-muted">
            <span className="flex items-center gap-1"><span className="size-2 rounded-full bg-accent" />{monthShort(month)}</span>
            <span className="flex items-center gap-1"><span className="size-2 rounded-full bg-muted/50" />{monthShort(prevMonth)}</span>
          </div>
        </div>

        {compare.length === 0 ? (
          <Empty title="Sin datos para comparar" hint="Cuando registres gastos verás aquí en qué rubro subiste o bajaste." />
        ) : (
          <>
            <div className="mt-3 flex items-center gap-3 rounded-xl bg-surface-2 p-3">
              {totalDelta > 0 ? <TrendingUp className="shrink-0 text-bad" size={22} /> : <TrendingDown className="shrink-0 text-good" size={22} />}
              <p className="text-sm">
                Gastaste <span className="tnum font-semibold">{bs(cur.totalSpent)}</span>,{' '}
                {totalDelta === 0 ? 'igual que' : <><span className={`tnum font-semibold ${totalDelta > 0 ? 'text-bad' : 'text-good'}`}>{bs(Math.abs(totalDelta))} {totalDelta > 0 ? 'más' : 'menos'}</span> que</>} el mes anterior.
                {topRise && prev.totalSpent > 0 && <> Tu mayor subida: <span className="font-semibold">{topRise.name}</span> (+{num(topRise.delta)}).</>}
              </p>
            </div>
            <ul className="mt-3 space-y-3.5">
              {compare.map((r) => (
                <li key={r.id}>
                  <div className="flex items-baseline justify-between gap-2 text-sm">
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="size-2.5 shrink-0 rounded-full" style={{ background: r.color }} />
                      <span className="truncate">{r.name}</span>
                    </span>
                    <span className={`tnum shrink-0 text-xs font-semibold ${r.delta > 0 ? 'text-bad' : r.delta < 0 ? 'text-good' : 'text-muted'}`}>
                      {r.delta === 0 ? 'Igual' : `${r.delta > 0 ? '▲ +' : '▼ −'}${num(Math.abs(r.delta))}${r.pct !== null ? ` (${Math.abs(Math.round(r.pct))}%)` : ''}`}
                    </span>
                  </div>
                  <div className="mt-1.5 space-y-1">
                    <div className="flex items-center gap-2">
                      <div className="flex-1"><div className="h-2 rounded-full bg-accent" style={{ width: `${Math.max((r.current / maxCompare) * 100, r.current > 0 ? 1.5 : 0)}%` }} /></div>
                      <span className="tnum w-14 shrink-0 text-right text-xs font-medium">{num(r.current)}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="flex-1"><div className="h-2 rounded-full bg-muted/50" style={{ width: `${Math.max((r.previous / maxCompare) * 100, r.previous > 0 ? 1.5 : 0)}%` }} /></div>
                      <span className="tnum w-14 shrink-0 text-right text-xs text-muted">{num(r.previous)}</span>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      <EditSheet config={sheet} onClose={() => setSheet(null)} />
    </div>
  );
}
