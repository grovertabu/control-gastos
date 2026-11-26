import { readSnapshot, replaceSnapshot } from '../db/snapshot';
import type { AppDB, RemoteSnapshot, Snapshot, SyncState } from '../db/db';
import { SyncError, type SyncRemote } from './remote';

const key = 'snapshot';
const isDirty = (state: SyncState) => state.generation !== state.syncedGeneration;
export const hasPending = (state: SyncState) => Boolean(state.pending || state.conflict || isDirty(state));

export function initializeSnapshot(db: AppDB, data: Snapshot, revision: number) {
  return db.transaction('rw', [...db.dataTables, db.syncState], async () => {
    if (await db.syncState.get(key)) return;

    await replaceSnapshot(db, data);
    await db.syncState.add({ key, revision, generation: 0, syncedGeneration: revision ? 0 : -1 });
  });
}

function useCloudCopy(db: AppDB, state: SyncState, copy: RemoteSnapshot) {
  return replaceSnapshot(db, copy.data).then(() => db.syncState.put({
    key, revision: copy.revision, generation: state.generation + 1, syncedGeneration: state.generation + 1,
  }));
}

export async function syncSnapshot(db: AppDB, remote: SyncRemote) {
  const before = await db.transaction('rw', [...db.dataTables, db.syncState], async () => {
    const state = await db.syncState.get(key);
    if (!state || state.closing || state.conflict || state.pending || !isDirty(state)) return state;

    const pending = {
      id: crypto.randomUUID(), revision: state.revision, generation: state.generation, data: await readSnapshot(db),
    };
    const updated = { ...state, pending };
    await db.syncState.put(updated);
    return updated;
  });
  if (!before || before.closing || before.conflict) return;

  if (before.pending) {
    const pending = before.pending;
    let result: Awaited<ReturnType<SyncRemote['push']>>;
    try {
      result = await remote.push(pending);
    } catch (error) {
      // A definitive rejection can be corrected locally. Ambiguous failures retry the same operation.
      if (error instanceof SyncError && error.reason === 'rejected') {
        await db.transaction('rw', db.syncState, async () => {
          const state = await db.syncState.get(key);
          if (state?.pending?.id === pending.id) await db.syncState.put({ ...state, pending: undefined });
        });
      }
      throw error;
    }

    await db.transaction('rw', db.syncState, async () => {
      const state = await db.syncState.get(key);
      if (!state || state.closing || state.pending?.id !== pending.id) return;

      if (result.status === 'saved') {
        await db.syncState.put({ ...state, revision: result.revision, syncedGeneration: pending.generation, pending: undefined });
      } else if (result.status === 'snapshot') {
        await db.syncState.put({ ...state, pending: undefined, conflict: result });
      } else {
        throw new Error('No se encontró la copia en la nube. Exporta un respaldo antes de reintentar.');
      }
    });
    return;
  }

  const result = await remote.pull(before.revision);
  if (result.status !== 'snapshot') return;

  await db.transaction('rw', [...db.dataTables, db.syncState], async () => {
    const state = await db.syncState.get(key);
    if (!state || state.closing || state.conflict || state.pending || state.revision !== before.revision) return;

    if (isDirty(state)) await db.syncState.put({ ...state, conflict: result });
    else await useCloudCopy(db, state, result);
  });
}

export async function resolveConflict(
  db: AppDB, remote: SyncRemote, shown: SyncState, keep: 'local' | 'cloud',
) {
  const conflict = shown.conflict;
  if (!conflict) return false;
  const fresh = await remote.pull(conflict.revision);

  return db.transaction('rw', [...db.dataTables, db.syncState], async () => {
    const state = await db.syncState.get(key);
    if (!state || state.closing || state.conflict?.revision !== conflict.revision || state.generation !== shown.generation) return false;

    if (fresh.status === 'snapshot') {
      await db.syncState.put({ ...state, conflict: fresh });
      return false;
    }
    if (fresh.status === 'empty') throw new Error('La versión en la nube ya no está disponible.');

    if (keep === 'cloud') await useCloudCopy(db, state, conflict);
    else await db.syncState.put({
      ...state, revision: conflict.revision, conflict: undefined,
      pending: {
        id: crypto.randomUUID(), revision: conflict.revision, generation: state.generation, data: await readSnapshot(db),
      },
    });
    return true;
  });
}
