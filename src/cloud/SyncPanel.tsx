import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { Cloud } from 'lucide-react';
import { downloadSnapshot } from '../db/backup';
import type { AppDB, SyncState } from '../db/db';
import { readSnapshot } from '../db/snapshot';
import { useData } from '../lib/store';
import { SyncError, type SyncRemote } from './remote';
import { hasPending, resolveConflict, syncSnapshot } from './sync';

export function SyncPanel({ db, state, session, remote, signIn, signOut }: {
  db: AppDB;
  state: SyncState;
  session: Session | null | undefined;
  remote: SyncRemote | null;
  signIn: () => Promise<void>;
  signOut: (exportedGeneration?: number) => Promise<void>;
}) {
  const { transactions } = useData();
  const [notice, setNotice] = useState('');
  const [online, setOnline] = useState(navigator.onLine);
  const [problem, setProblem] = useState('');
  const [reason, setReason] = useState<SyncError['reason'] | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirmExit, setConfirmExit] = useState(false);
  const [exportedGeneration, setExportedGeneration] = useState<number>();
  const running = useRef<Promise<void> | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  const report = useCallback((error: unknown) => {
    setReason(error instanceof SyncError ? error.reason : null);
    setProblem(error instanceof SyncError || (error instanceof Error && error.name !== 'ZodError')
      ? error.message
      : 'No se pudo verificar la copia de la nube. Puedes exportar tus datos locales.');
  }, []);

  const sync = useCallback(() => {
    if (running.current) return running.current;
    if (!remote || !navigator.onLine) return Promise.resolve();

    setSyncing(true);
    setProblem('');
    setReason(null);
    const pending = syncSnapshot(db, remote).catch(report).finally(() => {
      running.current = null;
      setSyncing(false);
    });
    running.current = pending;
    return pending;
  }, [db, remote, report]);

  useEffect(() => {
    const wentOnline = () => { setOnline(true); void sync(); };
    const wentOffline = () => setOnline(false);
    const whenVisible = () => { if (document.visibilityState === 'visible') void sync(); };
    window.addEventListener('online', wentOnline);
    window.addEventListener('offline', wentOffline);
    document.addEventListener('visibilitychange', whenVisible);
    const retry = window.setInterval(whenVisible, 45000);
    return () => {
      window.removeEventListener('online', wentOnline);
      window.removeEventListener('offline', wentOffline);
      document.removeEventListener('visibilitychange', whenVisible);
      window.clearInterval(retry);
    };
  }, [sync]);

  useEffect(() => {
    if (!online || !remote || state.conflict || state.closing) return;
    const timer = window.setTimeout(() => void sync(), 350);
    return () => window.clearTimeout(timer);
  }, [online, remote, state.generation, state.syncedGeneration, state.conflict, state.closing, sync]);

  async function perform(operation: () => Promise<void>) {
    setBusy(true);
    setProblem('');
    setNotice('');
    try {
      await operation();
    } catch (error) {
      report(error);
    } finally {
      setBusy(false);
    }
  }

  const pending = hasPending(state);
  const conflict = state.conflict;
  const requiresLogin = !remote || reason === 'session';
  let label = 'Sincronizado';
  if (conflict) label = 'Conflicto';
  else if (!online) label = 'Sin conexión';
  else if (requiresLogin) label = 'Iniciar sesión';
  else if (syncing) label = 'Sincronizando…';
  else if (problem) label = 'Revisar nube';
  else if (pending) label = 'Pendiente';

  async function exportLocal() {
    const copy = await db.transaction('r', [...db.dataTables, db.syncState], async () => {
      const latest = await db.syncState.get('snapshot');
      return { generation: latest?.generation, data: await readSnapshot(db) };
    });
    await downloadSnapshot(copy.data, 'copia-local');
    setExportedGeneration(copy.generation);
  }

  return (
    <>
      <button
        className="btn btn-soft min-w-0 gap-1.5 px-2.5 text-xs"
        onClick={() => dialog.current?.showModal()}
        aria-haspopup="dialog"
      >
        <Cloud size={16} className="shrink-0" aria-hidden="true" />
        <span>{label}</span>
      </button>
      <span className="sr-only" role="status">{label}</span>
      <dialog
        ref={dialog} aria-labelledby={titleId}
        className="cloud-dialog card m-auto max-h-[90dvh] w-[calc(100%-2rem)] max-w-md overflow-y-auto bg-surface p-5 text-ink"
        onClose={() => { setConfirmExit(false); setExportedGeneration(undefined); setNotice(''); }}
      >
        <div className="space-y-4">
          <h1 className="text-xl font-bold" id={titleId}>Sincronización</h1>
          <p className="break-all text-sm text-muted">{session?.user.email}</p>
          <p className="text-sm font-medium" role="status">{label}</p>
          {pending && <p className="text-sm text-muted">Tus cambios están guardados en este dispositivo.</p>}
          {problem && <p className="text-sm text-bad" role="alert">{problem}</p>}
          {notice && <p className="text-sm text-muted" role="status">{notice}</p>}
          {requiresLogin && online && (
            <button className="btn btn-primary w-full" disabled={busy} onClick={() => void perform(signIn)}>Volver a iniciar sesión</button>
          )}
          {conflict && (
            <div className="space-y-3">
              <p className="text-sm">Hay cambios en dos dispositivos. Exporta las copias que quieras conservar y elige cuál se sincronizará.</p>
              <div className="grid gap-2">
                <section className="space-y-2 rounded-xl border border-line p-3">
                  <h2 className="text-sm font-semibold">Este dispositivo</h2>
                  <p className="text-sm text-muted">{transactions.length} movimientos</p>
                  <button className="btn btn-soft w-full" disabled={busy} onClick={() => void perform(exportLocal)}>Exportar copia local</button>
                  <button className="btn btn-primary w-full" disabled={busy || !online || !remote} onClick={() => void perform(async () => {
                    if (remote) {
                      const chosen = await resolveConflict(db, remote, state, 'local');
                      if (chosen) await sync();
                      else setNotice('Cambió una versión. Revisa las copias y vuelve a elegir.');
                    }
                  })}>Conservar esta copia</button>
                </section>
                <section className="space-y-2 rounded-xl border border-line p-3">
                  <h2 className="text-sm font-semibold">Nube · versión {conflict.revision}</h2>
                  <p className="text-sm text-muted">{new Date(conflict.updatedAt).toLocaleString('es-BO')} · {conflict.data.transactions.length} movimientos</p>
                  <button className="btn btn-soft w-full" disabled={busy} onClick={() => void perform(() => downloadSnapshot(conflict.data, 'copia-nube'))}>Exportar copia de la nube</button>
                  <button className="btn btn-primary w-full" disabled={busy || !online || !remote} onClick={() => void perform(async () => {
                    if (remote && !await resolveConflict(db, remote, state, 'cloud')) {
                      setNotice('Cambió una versión. Revisa las copias y vuelve a elegir.');
                    }
                  })}>Conservar la copia de la nube</button>
                </section>
              </div>
            </div>
          )}
          {!conflict && !requiresLogin && online && (
            <button className="btn btn-soft w-full" disabled={busy || syncing} onClick={() => void sync()}>Sincronizar ahora</button>
          )}
          {confirmExit ? (
            <div className="space-y-2 rounded-xl border border-line p-3">
              <p className="text-sm">Cerrar sesión quita tus datos de este dispositivo. {pending && 'Sincroniza o descarga una copia con los cambios pendientes antes de continuar.'}</p>
              {pending && <button className="btn btn-soft w-full" disabled={busy} onClick={() => void perform(exportLocal)}>
                {exportedGeneration === state.generation ? 'Volver a descargar respaldo' : 'Descargar respaldo'}
              </button>}
              {pending && exportedGeneration === state.generation && <p role="status" className="text-sm text-muted">Descarga iniciada. Comprueba el archivo antes de cerrar sesión.</p>}
              <button className="btn btn-danger w-full" disabled={busy || (pending && exportedGeneration !== state.generation)}
                onClick={() => void perform(() => signOut(exportedGeneration))}>Confirmar cierre</button>
            </div>
          ) : (
            <button className="btn btn-soft w-full" disabled={busy} onClick={() => setConfirmExit(true)}>Cerrar sesión</button>
          )}
          <form method="dialog">
            <button className="btn btn-soft w-full" autoFocus>Cerrar panel</button>
          </form>
        </div>
      </dialog>
    </>
  );
}
