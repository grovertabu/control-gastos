import { z } from 'zod';
import { TABLES, type AppDB, type Snapshot } from './db';

const id = z.string().min(1);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const month = z.string().regex(/^\d{4}-\d{2}$/);
const ordered = z.object({ id, name: z.string(), order: z.number() });
const colored = ordered.extend({ color: z.string() });

export const snapshotSchema = z.object({
  accounts: colored.extend({ kind: z.enum(['cash', 'bank', 'savings']), initialBalance: z.number() }).array(),
  categories: colored.extend({ kind: z.enum(['expense', 'income', 'fixed']) }).array(),
  transactions: z.object({
    id, type: z.enum(['expense', 'income', 'transfer']), amount: z.number(), accountId: id,
    toAccountId: id.optional(), categoryId: id.optional(), fixedExpenseId: id.optional(),
    note: z.string(), date, month, createdAt: z.number(),
  }).array(),
  fixedExpenses: ordered.extend({ amount: z.number(), accountId: id.optional(), active: z.boolean() }).array().default([]),
  goals: colored.extend({ target: z.number(), emoji: z.string() }).array().default([]),
  contributions: z.object({ id, goalId: id, accountId: id, amount: z.number(), date, month, createdAt: z.number() }).array().default([]),
  settings: z.object({ key: z.string(), value: z.unknown() }).refine(({ key, value }) => {
    switch (key) {
      case 'monthlyIncome':
      case 'variableLimit':
        return typeof value === 'number' && Number.isFinite(value);
      case 'theme':
        return value === 'dark' || value === 'light';
      case 'lastAccountId':
        return typeof value === 'string';
      default:
        return true;
    }
  }).array().default([]),
}).superRefine((data, ctx) => {
  for (const table of TABLES) {
    const keys = data[table].map((row) => 'id' in row ? row.id : row.key);
    if (new Set(keys).size !== keys.length) {
      ctx.addIssue({ code: 'custom', path: [table], message: 'Identificadores duplicados.' });
    }
  }
});

export function readSnapshot(db: AppDB): Promise<Snapshot> {
  return db.transaction('r', db.dataTables, async () => {
    const [accounts, categories, transactions, fixedExpenses, goals, contributions, settings] =
      await Promise.all([
        db.accounts.toArray(), db.categories.toArray(), db.transactions.toArray(), db.fixedExpenses.toArray(),
        db.goals.toArray(), db.contributions.toArray(), db.settings.toArray(),
      ]);
    return { accounts, categories, transactions, fixedExpenses, goals, contributions, settings };
  });
}

/** The caller owns the write transaction, including the synchronization metadata. */
export async function replaceSnapshot(db: AppDB, data: Snapshot) {
  for (const table of TABLES) {
    const target = db[table];
    await target.clear();
    await (target as import('dexie').Table).bulkAdd(data[table]);
  }
}
