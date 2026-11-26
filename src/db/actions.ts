import {
  uid, CAT_FIXED, CAT_OTHER, CAT_SALARY, TABLES, seedData, starterSnapshot,
  type AppDB,
  type Account, type Category, type FixedExpense, type Goal, type Settings, type Tx,
} from './db';
import { round2 } from '../lib/format';

// ---------- Ajustes ----------
export async function setSetting<K extends keyof Settings>(db: AppDB, key: K, value: Settings[K]) {
  await db.write(() => db.settings.put({ key, value }));
}

// ---------- Movimientos ----------
export type TxInput = Omit<Tx, 'id' | 'month' | 'createdAt'>;

export async function saveTx(db: AppDB, input: TxInput, id?: string) {
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
  await db.write(async () => {
    if (id) {
      await db.transactions.update(id, base);
    } else {
      await db.transactions.add({ ...base, id: uid(), createdAt: Date.now() });
    }
    await db.settings.put({ key: 'lastAccountId', value: base.accountId });
  });
}

export async function deleteTx(db: AppDB, id: string) {
  await db.write(() => db.transactions.delete(id));
}

// ---------- Gastos fijos ----------
export async function payFixed(db: AppDB, f: FixedExpense, month: string, date: string, accountId: string) {
  await db.write(async () => {
    const already = await db.transactions.where('fixedExpenseId').equals(f.id).filter((t) => t.month === month).count();
    if (already) return;
    await db.transactions.add({
      id: uid(), type: 'expense', amount: f.amount, accountId, categoryId: CAT_FIXED,
      note: f.name, date, month, fixedExpenseId: f.id, createdAt: Date.now(),
    });
    await db.fixedExpenses.update(f.id, { accountId });
  });
}

export async function unpayFixed(db: AppDB, fixedId: string, month: string) {
  await db.write(() => db.transactions.where('fixedExpenseId').equals(fixedId).filter((t) => t.month === month).delete());
}

/** Cambia la cuenta de un gasto fijo (y la de su pago del mes, si ya está pagado). */
export async function setFixedAccount(db: AppDB, fixedId: string, month: string, accountId: string) {
  await db.write(async () => {
    await db.fixedExpenses.update(fixedId, { accountId });
    await db.transactions.where('fixedExpenseId').equals(fixedId).filter((t) => t.month === month).modify({ accountId });
  });
}

export async function saveFixed(db: AppDB, data: Omit<FixedExpense, 'id' | 'order'>, id?: string) {
  await db.write(async () => {
    if (id) await db.fixedExpenses.update(id, data);
    else await db.fixedExpenses.add({ ...data, id: uid(), order: Date.now() });
  });
}

/** Elimina el compromiso; los pagos ya registrados se conservan como historial. */
export async function deleteFixed(db: AppDB, id: string) {
  await db.write(async () => {
    await db.transactions.where('fixedExpenseId').equals(id).modify((t) => { delete t.fixedExpenseId; });
    await db.fixedExpenses.delete(id);
  });
}

// ---------- Cuentas ----------
export async function saveAccount(db: AppDB, data: Omit<Account, 'id' | 'order'>, id?: string) {
  await db.write(async () => {
    if (id) await db.accounts.update(id, data);
    else await db.accounts.add({ ...data, id: uid(), order: Date.now() });
  });
}

/** Elimina la cuenta junto con sus movimientos y el dinero apartado en ella. */
export async function deleteAccount(db: AppDB, id: string) {
  await db.write(async () => {
    await db.transactions.where('accountId').equals(id).delete();
    await db.transactions.where('toAccountId').equals(id).delete();
    await db.contributions.where('accountId').equals(id).delete();
    await db.fixedExpenses.filter((f) => f.accountId === id).modify((f) => { delete f.accountId; });
    await db.accounts.delete(id);
  });
}

// ---------- Categorías ----------
export async function saveCategory(db: AppDB, data: Omit<Category, 'id' | 'order'>, id?: string) {
  await db.write(async () => {
    if (id) await db.categories.update(id, data);
    else await db.categories.add({ ...data, id: uid(), order: Date.now() });
  });
}

/** Elimina la categoría y mueve sus movimientos a "Otros" (o "Sueldo" si era de ingreso). */
export async function deleteCategory(db: AppDB, c: Category) {
  await db.write(async () => {
    const fallback = c.kind === 'income' ? CAT_SALARY : CAT_OTHER;
    await db.transactions.where('categoryId').equals(c.id).modify({ categoryId: fallback });
    await db.categories.delete(c.id);
  });
}

// ---------- Metas ----------
export async function saveGoal(db: AppDB, data: Omit<Goal, 'id' | 'order'>, id?: string) {
  await db.write(async () => {
    if (id) await db.goals.update(id, data);
    else await db.goals.add({ ...data, id: uid(), order: Date.now() });
  });
}

export async function deleteGoal(db: AppDB, id: string) {
  await db.write(async () => {
    await db.contributions.where('goalId').equals(id).delete();
    await db.goals.delete(id);
  });
}

/** amount > 0 aparta dinero; amount < 0 lo libera. */
export async function contribute(db: AppDB, goalId: string, accountId: string, amount: number, date: string) {
  await db.write(() => db.contributions.add({
    id: uid(), goalId, accountId, amount: round2(amount), date, month: date.slice(0, 7), createdAt: Date.now(),
  }));
}

// ---------- Restablecer ----------
export async function resetAll(db: AppDB) {
  await db.write(async () => {
    for (const t of TABLES) await db[t].clear();
    const s = db.userId ? starterSnapshot() : seedData();
    await db.accounts.bulkAdd(s.accounts);
    await db.categories.bulkAdd(s.categories);
    await db.fixedExpenses.bulkAdd(s.fixedExpenses);
    await db.goals.bulkAdd(s.goals);
    await db.settings.bulkAdd(s.settings);
  });
}
