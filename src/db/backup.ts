import { db, uid, TABLES, CAT_OTHER, CAT_EXTRA, PALETTE, type Tx, type TxType } from './db';
import { parseAmount, todayISO } from '../lib/format';

const APP_ID = 'control-gastos';

// ---------- Descarga / compartir ----------
async function deliver(filename: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/** Comparte el archivo con el menú nativo (útil en iOS, donde las descargas de una PWA fallan). */
export async function shareFile(filename: string, content: string, mime: string): Promise<boolean> {
  try {
    const file = new File([content], filename, { type: mime });
    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], title: filename });
      return true;
    }
  } catch {
    /* cancelado o no soportado */
  }
  return false;
}

// ---------- JSON (respaldo completo) ----------
export async function buildJSON(): Promise<{ filename: string; content: string }> {
  const data: Record<string, unknown[]> = {};
  for (const t of TABLES) data[t] = await db[t].toArray();
  const content = JSON.stringify({ app: APP_ID, version: 1, exportedAt: new Date().toISOString(), data }, null, 2);
  return { filename: `control-gastos-respaldo-${todayISO()}.json`, content };
}

export async function exportJSON() {
  const { filename, content } = await buildJSON();
  await deliver(filename, content, 'application/json');
}

/** Reemplaza TODOS los datos por los del respaldo. Devuelve cuántos movimientos se restauraron. */
export async function importJSON(text: string): Promise<number> {
  let parsed: { app?: string; data?: Record<string, unknown[]> };
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('El archivo no es un JSON válido.');
  }
  if (parsed?.app !== APP_ID || !parsed.data) throw new Error('Este archivo no es un respaldo de Control de Gastos.');
  const data = parsed.data;
  for (const t of ['accounts', 'categories', 'transactions'] as const) {
    if (!Array.isArray(data[t])) throw new Error(`El respaldo está incompleto (falta "${t}").`);
  }
  await db.transaction('rw', TABLES.map((t) => db[t]), async () => {
    for (const t of TABLES) {
      await db[t].clear();
      if (Array.isArray(data[t])) await (db[t] as import('dexie').Table).bulkPut(data[t]);
    }
  });
  return data.transactions.length;
}

// ---------- CSV (movimientos) ----------
const CSV_HEAD = ['fecha', 'tipo', 'monto', 'cuenta', 'cuenta_destino', 'categoria', 'nota'];
const TYPE_ES: Record<TxType, string> = { expense: 'gasto', income: 'ingreso', transfer: 'transferencia' };

const esc = (v: string) => (/[",\n;]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

export async function buildCSV(): Promise<{ filename: string; content: string }> {
  const [txs, accounts, categories] = await Promise.all([
    db.transactions.orderBy('date').toArray(), db.accounts.toArray(), db.categories.toArray(),
  ]);
  const acc = new Map(accounts.map((a) => [a.id, a.name]));
  const cat = new Map(categories.map((c) => [c.id, c.name]));
  const rows = txs.map((t) => [
    t.date, TYPE_ES[t.type], String(t.amount), acc.get(t.accountId) ?? '',
    t.toAccountId ? acc.get(t.toAccountId) ?? '' : '', t.categoryId ? cat.get(t.categoryId) ?? '' : '', t.note,
  ].map(esc).join(','));
  // BOM para que Excel reconozca los acentos.
  return { filename: `control-gastos-movimientos-${todayISO()}.csv`, content: '﻿' + [CSV_HEAD.join(','), ...rows].join('\n') };
}

export async function exportCSV() {
  const { filename, content } = await buildCSV();
  await deliver(filename, content, 'text/csv;charset=utf-8');
}

function parseCSV(text: string): string[][] {
  const src = text.replace(/^﻿/, '');
  const firstLine = src.split(/\r?\n/, 1)[0] ?? '';
  const sep = firstLine.split(';').length > firstLine.split(',').length ? ';' : ',';
  const rows: string[][] = [];
  let row: string[] = [], cell = '', quoted = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === sep) { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      if (row.some((c) => c.trim() !== '')) rows.push(row);
      row = [];
    } else cell += ch;
  }
  row.push(cell);
  if (row.some((c) => c.trim() !== '')) rows.push(row);
  return rows;
}

const norm = (s: string) => s.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

/** Agrega movimientos desde un CSV (no borra nada). Crea cuentas/categorías que no existan. */
export async function importCSV(text: string): Promise<{ added: number; skipped: number }> {
  const rows = parseCSV(text);
  if (rows.length < 2) throw new Error('El CSV está vacío.');
  const head = rows[0].map(norm);
  const col = (name: string) => head.indexOf(name);
  const iDate = col('fecha'), iType = col('tipo'), iAmount = col('monto'), iAcc = col('cuenta');
  const iTo = col('cuenta_destino'), iCat = col('categoria'), iNote = col('nota');
  if (iDate < 0 || iType < 0 || iAmount < 0 || iAcc < 0) {
    throw new Error('Faltan columnas. Se esperan: ' + CSV_HEAD.join(', '));
  }

  let added = 0, skipped = 0;
  await db.transaction('rw', db.transactions, db.accounts, db.categories, async () => {
    const accounts = await db.accounts.toArray();
    const categories = await db.categories.toArray();

    const accountId = async (name: string): Promise<string> => {
      const found = accounts.find((a) => norm(a.name) === norm(name));
      if (found) return found.id;
      const a = { id: uid(), name: name.trim(), kind: 'bank' as const, initialBalance: 0, color: PALETTE[accounts.length % PALETTE.length], order: Date.now() };
      await db.accounts.add(a);
      accounts.push(a);
      return a.id;
    };
    const categoryId = async (name: string, type: TxType): Promise<string> => {
      if (!name.trim()) return type === 'income' ? CAT_EXTRA : CAT_OTHER;
      const found = categories.find((c) => norm(c.name) === norm(name));
      if (found) return found.id;
      const c = { id: uid(), name: name.trim(), kind: type === 'income' ? ('income' as const) : ('expense' as const), color: PALETTE[categories.length % PALETTE.length], order: Date.now() };
      await db.categories.add(c);
      categories.push(c);
      return c.id;
    };

    const batch: Tx[] = [];
    for (const r of rows.slice(1)) {
      const get = (i: number) => (i >= 0 ? (r[i] ?? '').trim() : '');
      const tRaw = norm(get(iType));
      const type: TxType | null = tRaw.startsWith('gasto') || tRaw === 'expense' ? 'expense'
        : tRaw.startsWith('ingreso') || tRaw === 'income' ? 'income'
        : tRaw.startsWith('transfer') ? 'transfer' : null;
      let date = get(iDate);
      const dmY = date.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
      if (dmY) date = `${dmY[3]}-${dmY[2].padStart(2, '0')}-${dmY[1].padStart(2, '0')}`;
      const amount = Math.abs(parseAmount(get(iAmount)));
      if (!type || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !(amount > 0) || !get(iAcc)) { skipped++; continue; }
      if (type === 'transfer' && !get(iTo)) { skipped++; continue; }

      const tx: Tx = {
        id: uid(), type, amount, accountId: await accountId(get(iAcc)), note: get(iNote),
        date, month: date.slice(0, 7), createdAt: Date.now(),
      };
      if (type === 'transfer') tx.toAccountId = await accountId(get(iTo));
      else tx.categoryId = await categoryId(get(iCat), type);
      batch.push(tx);
      added++;
    }
    await db.transactions.bulkAdd(batch);
  });
  return { added, skipped };
}
