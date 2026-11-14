import { CAT_SALARY, type Account, type Category, type Contribution, type FixedExpense, type Goal, type Settings, type Tx } from '../db/db';
import { round2 } from './format';

export interface AppData {
  accounts: Account[];
  categories: Category[];
  transactions: Tx[];
  fixedExpenses: FixedExpense[];
  goals: Goal[];
  contributions: Contribution[];
  settings: Settings;
}

const add = (m: Map<string, number>, k: string, v: number) => m.set(k, (m.get(k) ?? 0) + v);

/** Saldo actual de cada cuenta = saldo inicial + ingresos − gastos ± transferencias. */
export function accountBalances(accounts: Account[], txs: Tx[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const a of accounts) m.set(a.id, a.initialBalance);
  for (const t of txs) {
    if (t.type === 'income') add(m, t.accountId, t.amount);
    else if (t.type === 'expense') add(m, t.accountId, -t.amount);
    else {
      add(m, t.accountId, -t.amount);
      if (t.toAccountId) add(m, t.toAccountId, t.amount);
    }
  }
  for (const [k, v] of m) m.set(k, round2(v));
  return m;
}

/** Dinero apartado para metas dentro de cada cuenta. */
export function reservedByAccount(contribs: Contribution[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const c of contribs) add(m, c.accountId, c.amount);
  return m;
}

export function savedByGoal(contribs: Contribution[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const c of contribs) add(m, c.goalId, c.amount);
  return m;
}

/** Cuánto tiene una meta en cada cuenta. */
export function goalByAccount(contribs: Contribution[], goalId: string): Map<string, number> {
  const m = new Map<string, number>();
  for (const c of contribs) if (c.goalId === goalId) add(m, c.accountId, c.amount);
  return m;
}

export interface Slice {
  id: string;
  name: string;
  color: string;
  value: number;
}

export interface FixedStatus {
  fixed: FixedExpense;
  paidTx?: Tx;
}

export interface MonthSummary {
  month: string;
  baseIncome: number;
  extraIncome: number;
  salaryRecorded: number;
  income: number;
  fixedPaid: number;
  fixedPending: number;
  fixedTotal: number;
  variable: number;
  available: number;
  savedToGoals: number;
  fixedList: FixedStatus[];
  byCategory: Slice[];
  byAccount: Slice[];
  totalSpent: number;
}

export function monthSummary(d: AppData, month: string): MonthSummary {
  const catById = new Map(d.categories.map((c) => [c.id, c]));
  const accById = new Map(d.accounts.map((a) => [a.id, a]));
  const txs = d.transactions.filter((t) => t.month === month);

  let extraIncome = 0, salaryRecorded = 0, fixedPaid = 0, variable = 0;
  const cat = new Map<string, number>();
  const acc = new Map<string, number>();
  const paidByFixed = new Map<string, Tx>();

  for (const t of txs) {
    if (t.type === 'income') {
      if (t.categoryId === CAT_SALARY) salaryRecorded += t.amount;
      else extraIncome += t.amount;
    } else if (t.type === 'expense') {
      const isFixed = catById.get(t.categoryId ?? '')?.kind === 'fixed';
      if (isFixed) fixedPaid += t.amount;
      else variable += t.amount;
      if (t.fixedExpenseId) paidByFixed.set(t.fixedExpenseId, t);
      add(cat, t.categoryId ?? '', t.amount);
      add(acc, t.accountId, t.amount);
    }
  }

  const fixedList: FixedStatus[] = d.fixedExpenses
    .filter((f) => f.active || paidByFixed.has(f.id))
    .map((f) => ({ fixed: f, paidTx: paidByFixed.get(f.id) }));
  const fixedPending = fixedList.reduce((s, f) => s + (f.paidTx ? 0 : f.fixed.amount), 0);

  const income = d.settings.monthlyIncome + extraIncome;
  const fixedTotal = fixedPaid + fixedPending;
  const savedToGoals = d.contributions.filter((c) => c.month === month).reduce((s, c) => s + c.amount, 0);

  const toSlices = (m: Map<string, number>, look: (id: string) => { name: string; color: string } | undefined): Slice[] =>
    [...m.entries()]
      .map(([id, value]) => ({ id, value: round2(value), name: look(id)?.name ?? 'Sin categoría', color: look(id)?.color ?? '#94a3b8' }))
      .filter((s) => s.value > 0)
      .sort((a, b) => b.value - a.value);

  return {
    month,
    baseIncome: d.settings.monthlyIncome,
    extraIncome: round2(extraIncome),
    salaryRecorded: round2(salaryRecorded),
    income: round2(income),
    fixedPaid: round2(fixedPaid),
    fixedPending: round2(fixedPending),
    fixedTotal: round2(fixedTotal),
    variable: round2(variable),
    available: round2(income - fixedTotal - variable),
    savedToGoals: round2(savedToGoals),
    fixedList,
    byCategory: toSlices(cat, (id) => catById.get(id)),
    byAccount: toSlices(acc, (id) => accById.get(id)),
    totalSpent: round2(fixedPaid + variable),
  };
}

export interface CompareRow {
  id: string;
  name: string;
  color: string;
  current: number;
  previous: number;
  delta: number;
  /** null cuando el mes anterior fue 0. */
  pct: number | null;
}

/** Gasto por categoría: este mes vs. el anterior, ordenado por mayor subida. */
export function compareMonths(cur: MonthSummary, prev: MonthSummary): CompareRow[] {
  const ids = new Map<string, { name: string; color: string }>();
  for (const s of [...cur.byCategory, ...prev.byCategory]) ids.set(s.id, s);
  const val = (list: Slice[], id: string) => list.find((s) => s.id === id)?.value ?? 0;
  return [...ids.entries()]
    .map(([id, meta]) => {
      const current = val(cur.byCategory, id);
      const previous = val(prev.byCategory, id);
      const delta = round2(current - previous);
      return { id, name: meta.name, color: meta.color, current, previous, delta, pct: previous > 0 ? (delta / previous) * 100 : null };
    })
    .sort((a, b) => b.delta - a.delta);
}
