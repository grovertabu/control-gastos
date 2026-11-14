import {
  db, uid, CAT_FIXED, CAT_OTHER, CAT_SALARY, TABLES, seedData,
  type Account, type Category, type FixedExpense, type Goal, type Settings, type Tx,
} from './db';
import { round2 } from '../lib/format';

// ---------- Ajustes ----------
export async function setSetting<K extends keyof Settings>(key: K, value: Settings[K]) {
  await db.settings.put({ key, value });
}

// ---------- Movimientos ----------
export type TxInput = Omit<Tx, 'id' | 'month' | 'createdAt'>;

export async function saveTx(input: TxInput, id?: string) {
  const base = {
    ...input,
    amount: round2(input.amount),
    note: input.note.trim(),
    month: input.date.slice(0, 7),
  };
  if (base.type !== 'transfer') delete base.toAccountId;
  if (base.type === 'transfer') {
    delete base.categoryId;
    delete base.fixedExpenseId;
  }
  if (id) {
    await db.transactions.update(id, base);
  } else {
    await db.transactions.add({ ...base, id: uid(), createdAt: Date.now() });
  }
  await setSetting('lastAccountId', base.accountId);
}

export async function deleteTx(id: string) {
  await db.transactions.delete(id);
}

// ---------- Gastos fijos ----------
export async function payFixed(f: FixedExpense, month: string, date: string, accountId: string) {
  await db.transaction('rw', db.transactions, db.fixedExpenses, async () => {
    const already = await db.transactions.where('fixedExpenseId').equals(f.id).filter((t) => t.month === month).count();
    if (already) return;
    await db.transactions.add({
      id: uid(), type: 'expense', amount: f.amount, accountId, categoryId: CAT_FIXED,
      note: f.name, date, month, fixedExpenseId: f.id, createdAt: Date.now(),
    });
    await db.fixedExpenses.update(f.id, { accountId });
  });
}

export async function unpayFixed(fixedId: string, month: string) {
  const ids = await db.transactions.where('fixedExpenseId').equals(fixedId).filter((t) => t.month === month).primaryKeys();
  await db.transactions.bulkDelete(ids);
}

/** Cambia la cuenta de un gasto fijo (y la de su pago del mes, si ya está pagado). */
export async function setFixedAccount(fixedId: string, month: string, accountId: string) {
  await db.transaction('rw', db.transactions, db.fixedExpenses, async () => {
    await db.fixedExpenses.update(fixedId, { accountId });
    await db.transactions.where('fixedExpenseId').equals(fixedId).filter((t) => t.month === month).modify({ accountId });
  });
}

export async function saveFixed(data: Omit<FixedExpense, 'id' | 'order'>, id?: string) {
  if (id) await db.fixedExpenses.update(id, data);
  else await db.fixedExpenses.add({ ...data, id: uid(), order: Date.now() });
}

/** Elimina el compromiso; los pagos ya registrados se conservan como historial. */
export async function deleteFixed(id: string) {
  await db.transaction('rw', db.transactions, db.fixedExpenses, async () => {
    await db.transactions.where('fixedExpenseId').equals(id).modify((t) => { delete t.fixedExpenseId; });
    await db.fixedExpenses.delete(id);
  });
}

// ---------- Cuentas ----------
export async function saveAccount(data: Omit<Account, 'id' | 'order'>, id?: string) {
  if (id) await db.accounts.update(id, data);
  else await db.accounts.add({ ...data, id: uid(), order: Date.now() });
}

/** Elimina la cuenta junto con sus movimientos y el dinero apartado en ella. */
export async function deleteAccount(id: string) {
  await db.transaction('rw', db.accounts, db.transactions, db.contributions, db.fixedExpenses, async () => {
    await db.transactions.where('accountId').equals(id).delete();
    await db.transactions.where('toAccountId').equals(id).delete();
    await db.contributions.where('accountId').equals(id).delete();
    await db.fixedExpenses.filter((f) => f.accountId === id).modify((f) => { delete f.accountId; });
    await db.accounts.delete(id);
  });
}

// ---------- Categorías ----------
export async function saveCategory(data: Omit<Category, 'id' | 'order'>, id?: string) {
  if (id) await db.categories.update(id, data);
  else await db.categories.add({ ...data, id: uid(), order: Date.now() });
}

/** Elimina la categoría y mueve sus movimientos a "Otros" (o "Sueldo" si era de ingreso). */
export async function deleteCategory(c: Category) {
  await db.transaction('rw', db.categories, db.transactions, async () => {
    const fallback = c.kind === 'income' ? CAT_SALARY : CAT_OTHER;
    await db.transactions.where('categoryId').equals(c.id).modify({ categoryId: fallback });
    await db.categories.delete(c.id);
  });
}

// ---------- Metas ----------
export async function saveGoal(data: Omit<Goal, 'id' | 'order'>, id?: string) {
  if (id) await db.goals.update(id, data);
  else await db.goals.add({ ...data, id: uid(), order: Date.now() });
}

export async function deleteGoal(id: string) {
  await db.transaction('rw', db.goals, db.contributions, async () => {
    await db.contributions.where('goalId').equals(id).delete();
    await db.goals.delete(id);
  });
}

/** amount > 0 aparta dinero; amount < 0 lo libera. */
export async function contribute(goalId: string, accountId: string, amount: number, date: string) {
  await db.contributions.add({
    id: uid(), goalId, accountId, amount: round2(amount), date, month: date.slice(0, 7), createdAt: Date.now(),
  });
}

// ---------- Restablecer ----------
export async function resetAll() {
  await db.transaction('rw', TABLES.map((t) => db[t]), async () => {
    for (const t of TABLES) await db[t].clear();
    const s = seedData();
    await db.accounts.bulkAdd(s.accounts);
    await db.categories.bulkAdd(s.categories);
    await db.fixedExpenses.bulkAdd(s.fixedExpenses);
    await db.goals.bulkAdd(s.goals);
    await db.settings.bulkAdd(s.settings);
  });
}
