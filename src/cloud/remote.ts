import { createClient, type Session } from '@supabase/supabase-js';
import { z } from 'zod';
import { snapshotSchema } from '../db/snapshot';
import type { PendingSnapshot } from '../db/db';

const url = import.meta.env.VITE_SUPABASE_URL?.replace(/\/$/, '') as string | undefined;
const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;

export const authStorageKey = 'control-gastos-auth';
export const supabase = url && publishableKey
  ? createClient(url, publishableKey, { auth: { flowType: 'pkce', storageKey: authStorageKey } })
  : null;

const revision = z.int().nonnegative();
const snapshot = z.object({ status: z.literal('snapshot'), revision, updatedAt: z.string(), data: snapshotSchema });
const pullResult = z.discriminatedUnion('status', [
  snapshot,
  z.object({ status: z.literal('empty'), revision: z.literal(0) }),
  z.object({ status: z.literal('unchanged'), revision }),
]);
const pushResult = z.discriminatedUnion('status', [
  snapshot,
  z.object({ status: z.literal('saved'), revision }),
  z.object({ status: z.literal('empty'), revision: z.literal(0) }),
]);

export interface SyncRemote {
  pull(knownRevision: number | null): Promise<z.infer<typeof pullResult>>;
  push(pending: PendingSnapshot): Promise<z.infer<typeof pushResult>>;
}

export class SyncError extends Error {
  constructor(public reason: 'session' | 'denied' | 'network' | 'rejected', message: string) {
    super(message);
  }
}

// Bind each request to the workspace's token, even when another tab switches accounts.
export function sessionRemote(session: Session): SyncRemote {
  async function rpc(name: string, payload: unknown): Promise<unknown> {
    let response: Response;
    try {
      response = await fetch(`${url}/rest/v1/rpc/${name}`, {
        method: 'POST',
        headers: {
          apikey: publishableKey!,
          Authorization: `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(15000),
      });
    } catch {
      throw new SyncError('network', 'La nube no está disponible. Los cambios quedan en este dispositivo.');
    }

    if (response.status === 401) throw new SyncError('session', 'Vuelve a iniciar sesión para sincronizar.');
    if (response.status === 403) throw new SyncError('denied', 'Esta cuenta ya no tiene acceso al piloto.');
    if (response.status >= 500 || response.status === 429) {
      throw new SyncError('network', 'La nube no está disponible. Puedes reintentar en unos minutos.');
    }
    if (!response.ok) throw new SyncError('rejected', 'La nube rechazó el respaldo. Puedes exportarlo desde Ajustes.');
    return response.json();
  }

  return {
    async pull(knownRevision) {
      return pullResult.parse(await rpc('pull_snapshot', { p_known_revision: knownRevision }));
    },
    async push(pending) {
      return pushResult.parse(await rpc('push_snapshot', {
        p_base_revision: pending.revision,
        p_operation_id: pending.id,
        p_data: pending.data,
      }));
    },
  };
}
