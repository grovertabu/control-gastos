import { lazy, Suspense, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { ArrowLeft, LayoutDashboard, ListOrdered, Plus, Settings as SettingsIcon, Target, Wallet } from 'lucide-react';
import { currentMonth, defaultDateFor } from './lib/format';
import { DataProvider, UICtx, useData, type Tab, type TxDraft, type UI } from './lib/store';
import { ToastHost } from './components/ui';
import { TxSheet } from './components/TxSheet';
import { Resumen } from './pages/Resumen';
import { Movimientos } from './pages/Movimientos';
import { Cuentas } from './pages/Cuentas';
import { Metas } from './pages/Metas';
import { Ajustes } from './pages/Ajustes';
import { localDatabase, type AppDB } from './db/db';

const CloudGate = lazy(() => import('./cloud/CloudGate').then(({ CloudGate }) => ({ default: CloudGate })));
const cloudEnabled = Boolean(import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY);

const TABS: { id: Tab; label: string; icon: typeof Wallet }[] = [
  { id: 'resumen', label: 'Resumen', icon: LayoutDashboard },
  { id: 'movimientos', label: 'Movimientos', icon: ListOrdered },
  { id: 'cuentas', label: 'Cuentas', icon: Wallet },
  { id: 'metas', label: 'Metas', icon: Target },
];
const TITLES: Record<Tab, string> = { resumen: 'Resumen', movimientos: 'Movimientos', cuentas: 'Cuentas', metas: 'Metas', ajustes: 'Ajustes' };

export default function App() {
  if (cloudEnabled) return (
    <Suspense fallback={<main className="grid min-h-dvh place-items-center text-sm text-muted" role="status">Abriendo Control de Gastos…</main>}>
      <CloudGate>{(db, controls) => <Workspace db={db} controls={controls} />}</CloudGate>
    </Suspense>
  );
  return <Workspace db={localDatabase} />;
}

function Workspace({ db, controls }: { db: AppDB; controls?: ReactNode }) {
  return (
    <DataProvider db={db}>
      <Shell controls={controls} />
      <ToastHost />
    </DataProvider>
  );
}

function Shell({ controls }: { controls?: ReactNode }) {
  const { settings } = useData();
  const [tab, setTab] = useState<Tab>('resumen');
  const [lastTab, setLastTab] = useState<Tab>('resumen');
  const [month, setMonth] = useState(currentMonth);
  const [draft, setDraft] = useState<TxDraft | null>(() =>
    // Atajo de la PWA: /?nuevo=gasto abre directamente el registro.
    new URLSearchParams(location.search).get('nuevo') ? { type: 'expense' } : null,
  );

  // Tema: clase en <html>, color de la barra del sistema y copia en localStorage para evitar parpadeo al abrir.
  useEffect(() => {
    const dark = settings.theme !== 'light';
    document.documentElement.classList.toggle('dark', dark);
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#0b0f14' : '#f4f6f8');
    try { localStorage.setItem('cg-theme', settings.theme); } catch { /* almacenamiento bloqueado */ }
  }, [settings.theme]);

  const go = useCallback((t: Tab) => {
    setTab((prev) => {
      if (prev !== 'ajustes') setLastTab(prev);
      return t;
    });
    window.scrollTo(0, 0);
  }, []);

  const openTx = useCallback((d?: TxDraft) => setDraft({ date: defaultDateFor(month), ...d }), [month]);
  const closeTx = useCallback(() => setDraft(null), []);

  const ui = useMemo<UI>(() => ({ tab, go, month, setMonth, openTx }), [tab, go, month, openTx]);

  return (
    <UICtx.Provider value={ui}>
      <div className="mx-auto min-h-dvh max-w-md">
        <header className="sticky top-0 z-30 flex items-center justify-between bg-bg/90 px-4 pt-[max(0.5rem,env(safe-area-inset-top))] pb-2 backdrop-blur">
          <div className="flex items-center gap-1">
            {tab === 'ajustes' && (
              <button className="icon-btn -ml-2" onClick={() => go(lastTab)} aria-label="Volver">
                <ArrowLeft size={22} />
              </button>
            )}
            <h1 className="text-xl font-bold tracking-tight min-[390px]:text-2xl">{TITLES[tab]}</h1>
          </div>
          <div className="flex items-center gap-1">
            {controls}
            {tab !== 'ajustes' && (
              <button className="icon-btn -mr-2" onClick={() => go('ajustes')} aria-label="Ajustes">
                <SettingsIcon size={22} />
              </button>
            )}
          </div>
        </header>

        <main className="px-4 pt-1 pb-[calc(8.5rem+env(safe-area-inset-bottom))]">
          {tab === 'resumen' && <Resumen />}
          {tab === 'movimientos' && <Movimientos />}
          {tab === 'cuentas' && <Cuentas />}
          {tab === 'metas' && <Metas />}
          {tab === 'ajustes' && <Ajustes />}
        </main>

        {tab !== 'ajustes' && (
          <div className="pointer-events-none fixed inset-x-0 bottom-[calc(4.75rem+env(safe-area-inset-bottom))] z-40 mx-auto flex max-w-md justify-end px-4">
            <button
              className="pointer-events-auto flex size-15 items-center justify-center rounded-full bg-accent text-accent-ink shadow-lg shadow-black/30 transition active:scale-90"
              onClick={() => openTx()}
              aria-label="Registrar movimiento"
            >
              <Plus size={30} strokeWidth={2.5} />
            </button>
          </div>
        )}

        <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur" aria-label="Navegación principal">
          <ul className="mx-auto flex max-w-md">
            {TABS.map(({ id, label, icon: Icon }) => {
              const active = tab === id;
              return (
                <li key={id} className="flex-1">
                  <button
                    className={`flex h-16 w-full flex-col items-center justify-center gap-1 text-[11px] font-medium transition ${active ? 'text-accent' : 'text-muted'}`}
                    onClick={() => go(id)}
                    aria-current={active ? 'page' : undefined}
                  >
                    <Icon size={22} strokeWidth={active ? 2.5 : 2} />
                    {label}
                  </button>
                </li>
              );
            })}
          </ul>
        </nav>
      </div>

      <TxSheet draft={draft} onClose={closeTx} />
    </UICtx.Provider>
  );
}
