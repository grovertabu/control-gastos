import { useRef, useState, type ReactNode } from 'react';
import { ChevronRight, Download, Plus, RotateCcw, Share2, Upload } from 'lucide-react';
import { PALETTE, SYSTEM_CATEGORIES, type Category, type FixedExpense } from '../db/db';
import { deleteCategory, deleteFixed, resetAll, saveCategory, saveFixed, setSetting } from '../db/actions';
import { buildCSV, buildJSON, exportCSV, exportJSON, importCSV, importJSON, shareFile } from '../db/backup';
import { bs, num, parseAmount } from '../lib/format';
import { toast, useData } from '../lib/store';
import { Segmented } from '../components/ui';
import { EditSheet, type EditConfig } from '../components/EditSheet';

function Row({ label, value, onClick, color }: { label: string; value?: string; onClick: () => void; color?: string }) {
  return (
    <button className="flex min-h-12 w-full items-center gap-3 px-4 py-2.5 text-left active:bg-surface-2" onClick={onClick}>
      {color && <span className="size-2.5 shrink-0 rounded-full" style={{ background: color }} />}
      <span className="min-w-0 flex-1 truncate text-sm">{label}</span>
      {value && <span className="tnum shrink-0 text-sm text-muted">{value}</span>}
      <ChevronRight size={16} className="shrink-0 text-muted" />
    </button>
  );
}

function Section({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  return (
    <section>
      <div className="mb-1.5 flex items-center justify-between px-1">
        <h2 className="text-xs font-semibold tracking-wide text-muted uppercase">{title}</h2>
        {action}
      </div>
      <div className="card divide-y divide-line overflow-hidden p-0">{children}</div>
    </section>
  );
}

export function Ajustes() {
  const { settings, fixedExpenses, categories, accounts, transactions } = useData();
  const [sheet, setSheet] = useState<EditConfig | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const jsonInput = useRef<HTMLInputElement>(null);
  const csvInput = useRef<HTMLInputElement>(null);
  const canShare = typeof navigator !== 'undefined' && typeof navigator.canShare === 'function';

  const editAmountSetting = (key: 'monthlyIncome' | 'variableLimit', title: string, hint: string) =>
    setSheet({
      title,
      fields: [{ key: 'value', label: 'Monto mensual', type: 'amount', hint }],
      initial: { value: String(settings[key]) },
      onSubmit: async (v) => {
        const n = parseAmount(String(v.value));
        if (!(n >= 0)) return 'Escribe un monto válido.';
        await setSetting(key, n);
        toast('Guardado');
      },
    });

  const editFixed = (f?: FixedExpense) =>
    setSheet({
      title: f ? 'Editar gasto fijo' : 'Nuevo gasto fijo',
      fields: [
        { key: 'name', label: 'Nombre', type: 'text', placeholder: 'Ej. Luz, Agua, Netflix…' },
        { key: 'amount', label: 'Monto mensual', type: 'amount' },
        { key: 'account', label: 'Se paga normalmente desde', type: 'select', options: accounts.map((a) => ({ value: a.id, label: a.name })) },
        { key: 'active', label: 'Activo (aparece cada mes)', type: 'toggle' },
      ],
      initial: { name: f?.name ?? '', amount: f ? String(f.amount) : '', account: f?.accountId ?? accounts[0]?.id ?? '', active: f?.active ?? true },
      onSubmit: async (v) => {
        const name = String(v.name).trim();
        const amount = parseAmount(String(v.amount));
        if (!name) return 'Ponle un nombre.';
        if (!(amount > 0)) return 'Escribe un monto mayor a 0.';
        await saveFixed({ name, amount, accountId: String(v.account) || undefined, active: !!v.active }, f?.id);
        toast('Guardado');
      },
      onDelete: f ? async () => { await deleteFixed(f.id); toast('Gasto fijo eliminado'); } : undefined,
      deleteHint: 'Los pagos ya registrados se conservan en tu historial.',
    });

  const editCategory = (c?: Category) => {
    const system = !!c && SYSTEM_CATEGORIES.includes(c.id);
    setSheet({
      title: c ? 'Editar categoría' : 'Nueva categoría',
      fields: [
        { key: 'name', label: 'Nombre', type: 'text' },
        ...(c ? [] : [{ key: 'kind', label: 'Tipo', type: 'select' as const, options: [{ value: 'expense', label: 'Gasto variable' }, { value: 'income', label: 'Ingreso' }] }]),
        { key: 'color', label: 'Color', type: 'color' },
      ],
      initial: { name: c?.name ?? '', kind: c?.kind ?? 'expense', color: c?.color ?? PALETTE[categories.length % PALETTE.length] },
      onSubmit: async (v) => {
        const name = String(v.name).trim();
        if (!name) return 'Ponle un nombre.';
        await saveCategory({ name, color: String(v.color), kind: c?.kind ?? (v.kind as Category['kind']) }, c?.id);
        toast('Guardado');
      },
      onDelete: c && !system ? async () => { await deleteCategory(c); toast('Categoría eliminada'); } : undefined,
      deleteHint: 'Sus movimientos pasarán a "Otros".',
    });
  };

  const setTheme = (theme: 'dark' | 'light') => void setSetting('theme', theme);

  const onFile = async (file: File | undefined, kind: 'json' | 'csv') => {
    if (!file) return;
    try {
      const text = await file.text();
      if (kind === 'json') {
        const n = await importJSON(text);
        toast(`Respaldo restaurado (${n} movimientos)`);
      } else {
        const { added, skipped } = await importCSV(text);
        toast(`${added} movimientos importados${skipped ? `, ${skipped} filas omitidas` : ''}`);
      }
    } catch (e) {
      toast(e instanceof Error ? e.message : 'No se pudo importar el archivo');
    }
  };

  const share = async (kind: 'json' | 'csv') => {
    const { filename, content } = kind === 'json' ? await buildJSON() : await buildCSV();
    const ok = await shareFile(filename, content, kind === 'json' ? 'application/json' : 'text/csv');
    if (!ok) await (kind === 'json' ? exportJSON() : exportCSV());
  };

  const actionBtn = 'flex min-h-12 w-full items-center gap-3 px-4 py-2.5 text-left text-sm active:bg-surface-2';

  return (
    <div className="space-y-5">
      <Section title="Presupuesto">
        <Row label="Ingreso mensual base" value={bs(settings.monthlyIncome)} onClick={() => editAmountSetting('monthlyIncome', 'Ingreso mensual base', 'Tu sueldo fijo. Los ingresos extra que registres se suman aparte.')} />
        <Row label='Límite de "Gasto sin culpa"' value={bs(settings.variableLimit)} onClick={() => editAmountSetting('variableLimit', 'Límite de "Gasto sin culpa"', 'Tope mensual para gastos variables (comida, salidas, compras…).')} />
      </Section>

      <Section title="Apariencia">
        <div className="p-3">
          <Segmented
            value={settings.theme}
            onChange={setTheme}
            options={[{ value: 'dark', label: '🌙 Oscuro' }, { value: 'light', label: '☀️ Claro' }]}
          />
        </div>
      </Section>

      <Section
        title="Gastos fijos"
        action={<button className="inline-flex min-h-9 items-center gap-1 px-2 text-xs font-semibold text-accent" onClick={() => editFixed()}><Plus size={14} /> Agregar</button>}
      >
        {fixedExpenses.length === 0 && <p className="px-4 py-3 text-sm text-muted">No tienes gastos fijos.</p>}
        {fixedExpenses.map((f) => (
          <Row key={f.id} label={f.name + (f.active ? '' : ' (inactivo)')} value={num(f.amount)} onClick={() => editFixed(f)} />
        ))}
        {fixedExpenses.length > 0 && (
          <p className="px-4 py-2.5 text-xs text-muted">Total mensual: <span className="tnum font-semibold text-ink">{bs(fixedExpenses.filter((f) => f.active).reduce((s, f) => s + f.amount, 0))}</span></p>
        )}
      </Section>

      <Section
        title="Categorías"
        action={<button className="inline-flex min-h-9 items-center gap-1 px-2 text-xs font-semibold text-accent" onClick={() => editCategory()}><Plus size={14} /> Agregar</button>}
      >
        {categories.map((c) => (
          <Row key={c.id} label={c.name} color={c.color} value={c.kind === 'income' ? 'Ingreso' : c.kind === 'fixed' ? 'Fijos' : 'Gasto'} onClick={() => editCategory(c)} />
        ))}
      </Section>

      <Section title="Respaldo de datos">
        <p className="px-4 py-3 text-xs text-muted">
          Tus datos viven solo en este dispositivo ({transactions.length} movimientos). Exporta un respaldo de vez en cuando y antes de cambiar de teléfono.
        </p>
        <button className={actionBtn} onClick={() => exportJSON().then(() => toast('Respaldo JSON descargado'))}><Download size={18} className="text-accent" /> Exportar respaldo completo (JSON)</button>
        <button className={actionBtn} onClick={() => jsonInput.current?.click()}><Upload size={18} className="text-accent" /> Importar respaldo (JSON) — reemplaza todo</button>
        <button className={actionBtn} onClick={() => exportCSV().then(() => toast('CSV descargado'))}><Download size={18} className="text-accent" /> Exportar movimientos (CSV / Excel)</button>
        <button className={actionBtn} onClick={() => csvInput.current?.click()}><Upload size={18} className="text-accent" /> Importar movimientos (CSV) — los agrega</button>
        {canShare && (
          <button className={actionBtn} onClick={() => share('json')}><Share2 size={18} className="text-accent" /> Compartir respaldo (Drive, WhatsApp, correo…)</button>
        )}
        <input ref={jsonInput} type="file" accept="application/json,.json" className="hidden" onChange={(e) => { void onFile(e.target.files?.[0], 'json'); e.target.value = ''; }} />
        <input ref={csvInput} type="file" accept="text/csv,.csv" className="hidden" onChange={(e) => { void onFile(e.target.files?.[0], 'csv'); e.target.value = ''; }} />
      </Section>

      <Section title="Zona de peligro">
        <button
          className={`${actionBtn} text-bad`}
          onClick={async () => {
            if (!confirmReset) {
              setConfirmReset(true);
              setTimeout(() => setConfirmReset(false), 4000);
              return;
            }
            await resetAll();
            setConfirmReset(false);
            toast('Datos restablecidos');
          }}
        >
          <RotateCcw size={18} />
          {confirmReset ? 'Toca otra vez para borrar TODO' : 'Borrar todo y volver a los datos iniciales'}
        </button>
      </Section>

      <p className="px-1 pb-4 text-center text-xs text-muted">
        Control de Gastos v1.0 · Sin servidores, sin cuentas, sin rastreo.
        <br />
        Para instalarla: menú del navegador → "Agregar a pantalla de inicio".
      </p>

      <EditSheet config={sheet} onClose={() => setSheet(null)} />
    </div>
  );
}
