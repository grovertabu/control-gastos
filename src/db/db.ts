import Dexie, { type Table } from 'dexie';

export type TxType = 'expense' | 'income' | 'transfer';
export type AccountKind = 'cash' | 'bank' | 'savings';
export type CategoryKind = 'expense' | 'income' | 'fixed';

export interface Account {
  id: string;
  name: string;
  kind: AccountKind;
  /** Saldo con el que arranca la cuenta; el saldo actual se deriva de los movimientos. */
  initialBalance: number;
  color: string;
  order: number;
}

export interface Category {
  id: string;
  name: string;
  color: string;
  kind: CategoryKind;
  order: number;
}

export interface Tx {
  id: string;
  type: TxType;
  amount: number;
  accountId: string;
  /** Solo para transferencias. */
  toAccountId?: string;
  categoryId?: string;
  note: string;
  /** YYYY-MM-DD (hora local). */
  date: string;
  /** YYYY-MM, derivado de date para consultas rápidas. */
  month: string;
  /** Si es el pago mensual de un gasto fijo. */
  fixedExpenseId?: string;
  createdAt: number;
}

export interface FixedExpense {
  id: string;
  name: string;
  amount: number;
  /** Cuenta desde la que normalmente se paga. */
  accountId?: string;
  active: boolean;
  order: number;
}

export interface Goal {
  id: string;
  name: string;
  target: number;
  color: string;
  emoji: string;
  order: number;
}

/** Dinero apartado para una meta dentro de una cuenta (negativo = retiro). */
export interface Contribution {
  id: string;
  goalId: string;
  accountId: string;
  amount: number;
  date: string;
  month: string;
  createdAt: number;
}

export interface SettingRow {
  key: string;
  value: unknown;
}

export interface Settings {
  monthlyIncome: number;
  variableLimit: number;
  theme: 'dark' | 'light';
  lastAccountId: string;
}

export const DEFAULT_SETTINGS: Settings = {
  monthlyIncome: 4333,
  variableLimit: 1300,
  theme: 'dark',
  lastAccountId: 'acc-banco',
};

/** Ids de categorías del sistema (no se pueden eliminar). */
export const CAT_FIXED = 'cat-fijos';
export const CAT_SALARY = 'cat-sueldo';
export const CAT_EXTRA = 'cat-extra';
export const CAT_OTHER = 'cat-otros';
export const SYSTEM_CATEGORIES = [CAT_FIXED, CAT_SALARY, CAT_EXTRA, CAT_OTHER];

export const PALETTE = [
  '#f59e0b', '#a78bfa', '#f472b6', '#2dd4bf', '#60a5fa', '#94a3b8',
  '#fb7185', '#34d399', '#fbbf24', '#38bdf8', '#c084fc', '#f97316',
];

class AppDB extends Dexie {
  accounts!: Table<Account, string>;
  categories!: Table<Category, string>;
  transactions!: Table<Tx, string>;
  fixedExpenses!: Table<FixedExpense, string>;
  goals!: Table<Goal, string>;
  contributions!: Table<Contribution, string>;
  settings!: Table<SettingRow, string>;

  constructor() {
    super('control-gastos');
    this.version(1).stores({
      accounts: 'id, order',
      categories: 'id, kind, order',
      transactions: 'id, date, month, type, accountId, toAccountId, categoryId, fixedExpenseId',
      fixedExpenses: 'id, order',
      goals: 'id, order',
      contributions: 'id, goalId, accountId, month',
      settings: 'key',
    });
    this.on('populate', () => seed(this));
  }
}

export const TABLES = [
  'accounts', 'categories', 'transactions', 'fixedExpenses', 'goals', 'contributions', 'settings',
] as const;
export type TableName = (typeof TABLES)[number];

export function seedData() {
  const accounts: Account[] = [
    { id: 'acc-efectivo', name: 'Efectivo / Billetera', kind: 'cash', initialBalance: 0, color: '#fbbf24', order: 0 },
    { id: 'acc-banco', name: 'Cuenta Bancaria Principal / Sueldo', kind: 'bank', initialBalance: 0, color: '#60a5fa', order: 1 },
    { id: 'acc-ahorros', name: 'Cuenta de Ahorros / Reserva', kind: 'savings', initialBalance: 0, color: '#34d399', order: 2 },
  ];
  const categories: Category[] = [
    { id: 'cat-alimentacion', name: 'Alimentación', color: '#f59e0b', kind: 'expense', order: 0 },
    { id: 'cat-ocio', name: 'Salidas y Ocio', color: '#a78bfa', kind: 'expense', order: 1 },
    { id: 'cat-compras', name: 'Compras / Ropa', color: '#f472b6', kind: 'expense', order: 2 },
    { id: 'cat-salud', name: 'Salud', color: '#2dd4bf', kind: 'expense', order: 3 },
    { id: 'cat-suscripciones', name: 'Suscripciones', color: '#60a5fa', kind: 'expense', order: 4 },
    { id: CAT_OTHER, name: 'Otros', color: '#94a3b8', kind: 'expense', order: 5 },
    { id: CAT_FIXED, name: 'Gastos fijos', color: '#fb7185', kind: 'fixed', order: 6 },
    { id: CAT_SALARY, name: 'Sueldo', color: '#34d399', kind: 'income', order: 7 },
    { id: CAT_EXTRA, name: 'Ingreso extra', color: '#38bdf8', kind: 'income', order: 8 },
  ];
  const fixedExpenses: FixedExpense[] = [
    { id: 'fix-alquiler', name: 'Alquiler', amount: 1000, accountId: 'acc-banco', active: true, order: 0 },
    { id: 'fix-internet', name: 'Internet', amount: 150, accountId: 'acc-banco', active: true, order: 1 },
    { id: 'fix-transporte', name: 'Pasajes / Transporte', amount: 200, accountId: 'acc-efectivo', active: true, order: 2 },
    { id: 'fix-gimnasio', name: 'Gimnasio', amount: 150, accountId: 'acc-banco', active: true, order: 3 },
    { id: 'fix-minoxidil', name: 'Tratamiento / Cuidado personal (Minoxidil)', amount: 180, accountId: 'acc-efectivo', active: true, order: 4 },
  ];
  const goals: Goal[] = [
    { id: 'goal-emergencia', name: 'Fondo de Emergencia', target: 13000, color: '#34d399', emoji: '🛟', order: 0 },
    { id: 'goal-invertir', name: 'Fondo para Invertir', target: 5000, color: '#60a5fa', emoji: '📈', order: 1 },
    { id: 'goal-viaje', name: 'Viaje / Gustos', target: 3000, color: '#f472b6', emoji: '✈️', order: 2 },
  ];
  const settings: SettingRow[] = Object.entries(DEFAULT_SETTINGS).map(([key, value]) => ({ key, value }));
  return { accounts, categories, fixedExpenses, goals, settings };
}

function seed(d: AppDB) {
  const s = seedData();
  d.accounts.bulkAdd(s.accounts);
  d.categories.bulkAdd(s.categories);
  d.fixedExpenses.bulkAdd(s.fixedExpenses);
  d.goals.bulkAdd(s.goals);
  d.settings.bulkAdd(s.settings);
}

export const db = new AppDB();

/** Id único que también funciona en contextos no seguros (http por Wi-Fi). */
export function uid(): string {
  return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
}
