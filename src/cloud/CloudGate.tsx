import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { useLiveQuery } from 'dexie-react-hooks';
import { Cloud, LockKeyhole, Wallet } from 'lucide-react';
import { AppDB, starterSnapshot, type Snapshot } from '../db/db';
import { parseBackup } from '../db/backup';
import { authStorageKey, sessionRemote, supabase, type SyncRemote } from './remote';
import { hasPending, initializeSnapshot } from './sync';
import { SyncPanel } from './SyncPanel';

const trustedKey = 'control-gastos-trusted-user';
const errorMessage = (error: unknown) => error instanceof Error ? error.message : 'Ocurrió un error. Intenta de nuevo.';

type RenderWorkspace = (db: AppDB, controls: ReactNode) => ReactNode;

function GateScreen({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center p-5">
      <div className="card space-y-4 p-6">
        <Wallet className="text-accent" size={30} aria-hidden="true" />
        <p className="text-sm font-medium text-muted">Control de Gastos</p>
        <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
        {children}
      </div>
    </main>
  );
}

export function CloudGate({ children }: { children: RenderWorkspace }) {
  const [session, setSession] = useState<Session | null | undefined>();
  const [trusted, setTrusted] = useState(() => localStorage.getItem(trustedKey));
  const [signingOut, setSigningOut] = useState(false);
  const [oauthReturn] = useState(() => new URLSearchParams(location.search).has('code'));
  const [error, setError] = useState(() => {
    const params = new URLSearchParams(location.search);
    return params.has('error') || params.has('error_code')
      ? 'Google no pudo completar el acceso. Comprueba que tengas una invitación y vuelve a intentarlo.'
      : '';
  });

  useEffect(() => {
    const { data: { subscription } } = supabase!.auth.onAuthStateChange((_event, next) => setSession(next));
    const storageChanged = (event: StorageEvent) => {
      if (event.key === trustedKey || event.key === null) setTrusted(localStorage.getItem(trustedKey));
    };
    window.addEventListener('storage', storageChanged);
    return () => {
      subscription.unsubscribe();
      window.removeEventListener('storage', storageChanged);
    };
  }, []);

  const signIn = useCallback(async () => {
    setError('');
    const { error } = await supabase!.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: location.origin + '/', queryParams: { prompt: 'select_account' } },
    });
    if (error) throw new Error('No se pudo abrir el inicio de sesión de Google.');
  }, []);

  const trust = (uid: string) => {
    localStorage.setItem(trustedKey, uid);
    setTrusted(uid);
  };

  async function signOut(db?: AppDB, exportedGeneration?: number) {
    if (db) {
      await db.transaction('rw', db.syncState, async () => {
        const current = await db.syncState.get('snapshot');
        if (!current) return;
        if (hasPending(current) && exportedGeneration !== current.generation) {
          throw new Error('Hay cambios pendientes. Sincroniza o descarga un respaldo actualizado.');
        }
        await db.syncState.put({ ...current, closing: true });
      });
    }

    setSigningOut(true);
    try {
      if (db) await db.delete({ disableAutoOpen: true });
    } catch {
      if (db) {
        await db.open();
        await db.syncState.update('snapshot', { closing: false });
      }
      setSigningOut(false);
      throw new Error('No se pudo quitar la copia de este dispositivo. Cierra las otras pestañas e inténtalo de nuevo.');
    }

    localStorage.removeItem(trustedKey);
    const timeout = new Promise<void>((resolve) => window.setTimeout(resolve, 2500));
    await Promise.race([supabase!.auth.signOut({ scope: 'local' }).catch(() => undefined), timeout]);
    // Local access ends even when a refresh or revocation request is waiting for the network.
    localStorage.removeItem(authStorageKey);
    localStorage.removeItem(authStorageKey + '-code-verifier');
    localStorage.removeItem(authStorageKey + '-user');
    location.replace(location.origin + '/');
  }

  if (signingOut) return <GateScreen title="Cerrando sesión"><p role="status">Quitando la copia de este dispositivo…</p></GateScreen>;

  if (oauthReturn && session === undefined) {
    return <GateScreen title="Conectando con Google"><p className="text-sm text-muted" role="status">Comprobando la cuenta…</p></GateScreen>;
  }

  const uid = session?.user.id ?? trusted;
  if (!uid) return (
    <GateScreen title="Inicia sesión con Google">
      <p className="text-sm text-muted">Ingresa con el correo de tu invitación. Tus gastos podrán acompañarte entre dispositivos.</p>
      {error && <p className="text-sm text-bad" role="alert">{error}</p>}
      <button className="btn btn-primary w-full" onClick={() => void signIn().catch((e) => setError(errorMessage(e)))} disabled={session === undefined}>
        Continuar con Google
      </button>
    </GateScreen>
  );

  return (
    <Workspace key={uid} uid={uid} session={session} trusted={trusted === uid} trust={trust} signIn={signIn} signOut={signOut}>
      {children}
    </Workspace>
  );
}

function Workspace({ uid, session, trusted, trust, signIn, signOut, children }: {
  uid: string;
  session: Session | null | undefined;
  trusted: boolean;
  trust: (uid: string) => void;
  signIn: () => Promise<void>;
  signOut: (db?: AppDB, exportedGeneration?: number) => Promise<void>;
  children: RenderWorkspace;
}) {
  const [db] = useState(() => new AppDB(uid));
  const state = useLiveQuery(() => db.syncState.get('snapshot').then((value) => value ?? null), [db]);
  const remote = useMemo(() => session?.user.id === uid ? sessionRemote(session) : null, [session, uid]);
  const [onboarding, setOnboarding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => () => db.close({ disableAutoOpen: false }), [db]);

  async function perform(operation: () => Promise<void>) {
    setBusy(true);
    setError('');
    try {
      await operation();
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function activate(remote: SyncRemote) {
    const copy = await remote.pull(null);
    if (copy.status === 'snapshot') {
      await initializeSnapshot(db, copy.data, copy.revision);
      trust(uid);
    } else if (copy.status === 'empty') {
      setOnboarding(true);
    }
  }

  async function start(data: Snapshot) {
    await initializeSnapshot(db, data, 0);
    trust(uid);
  }

  if (state && trusted && !state.closing) {
    return children(db, <SyncPanel
      db={db} state={state} session={session} remote={remote} signIn={signIn}
      signOut={(generation) => signOut(db, generation)}
    />);
  }

  if (state === undefined && trusted) return <GateScreen title="Cargando tus datos…"><p role="status">Abriendo la copia de este dispositivo.</p></GateScreen>;

  if (state?.closing) return (
    <GateScreen title="Completa el cierre de sesión">
      <p className="text-sm text-muted">Se quitará la copia de este dispositivo.</p>
      {error && <p className="text-sm text-bad" role="alert">{error}</p>}
      <button className="btn btn-danger w-full" disabled={busy} onClick={() => void perform(() => signOut(db, state.generation))}>Cerrar sesión</button>
    </GateScreen>
  );

  if (onboarding) return (
    <GateScreen title="Prepara tus datos">
      <p className="text-sm text-muted">Importa el archivo JSON que exportaste desde Ajustes o crea un presupuesto propio.</p>
      {error && <p className="text-sm text-bad" role="alert">{error}</p>}
      <label className="block space-y-2 text-sm font-medium">
        <span>Importar respaldo JSON</span>
        <input
          className="input py-2 file:mr-2 file:bg-transparent file:text-ink"
          type="file" accept=".json,application/json" disabled={busy}
          onChange={(event) => {
            const file = event.currentTarget.files?.[0];
            event.currentTarget.value = '';
            if (file) void perform(async () => start(parseBackup(await file.text())));
          }}
        />
      </label>
      <button className="btn btn-primary w-full" disabled={busy} onClick={() => void perform(() => start(starterSnapshot()))}>
        Empezar de cero
      </button>
      <button className="btn btn-soft w-full" disabled={busy} onClick={() => void perform(() => signOut())}>Cerrar sesión</button>
    </GateScreen>
  );

  return (
    <GateScreen title={remote ? 'Activa este dispositivo' : 'Recupera tu sesión'}>
      <p className="flex items-start gap-2 break-all text-sm text-muted"><LockKeyhole className="shrink-0" size={18} aria-hidden="true" />{session?.user.email ?? 'Control de Gastos'}</p>
      <p className="text-sm text-muted">Activa el acceso sin internet en un dispositivo de confianza. Se guardará una copia de tus gastos en este navegador.</p>
      {error && <p className="text-sm text-bad" role="alert">{error}</p>}
      <button className="btn btn-primary w-full" disabled={busy} onClick={() => void perform(() => remote ? activate(remote) : signIn())}>
        <Cloud size={18} aria-hidden="true" />{busy ? 'Comprobando…' : remote ? 'Activar en este dispositivo' : 'Continuar con Google'}
      </button>
      {remote && <button className="btn btn-soft w-full" disabled={busy} onClick={() => void perform(() => signOut())}>Cerrar sesión</button>}
    </GateScreen>
  );
}
