const nf = new Intl.NumberFormat('es-BO', { minimumFractionDigits: 0, maximumFractionDigits: 2 });

/** 1234.5 -> "1.234,5" */
export function num(n: number): string {
  return nf.format(round2(n));
}

/** 1234.5 -> "Bs 1.234,5" */
export function bs(n: number): string {
  const r = round2(n);
  return (r < 0 ? '−' : '') + 'Bs ' + nf.format(Math.abs(r));
}

export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/** Acepta "1.234,50", "1234.5", "1234,5". */
export function parseAmount(s: string): number {
  let t = String(s).trim().replace(/\s|Bs/gi, '');
  if (t.includes(',') && t.includes('.')) t = t.replace(/\./g, '').replace(',', '.');
  else t = t.replace(',', '.');
  const n = Number(t);
  return Number.isFinite(n) ? round2(n) : NaN;
}

const pad = (n: number) => String(n).padStart(2, '0');

export function toISO(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
export const todayISO = () => toISO(new Date());
export const currentMonth = () => todayISO().slice(0, 7);

export function addMonths(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function monthLabel(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return cap(new Intl.DateTimeFormat('es', { month: 'long', year: 'numeric' }).format(new Date(y, m - 1, 1)));
}

export function monthShort(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return cap(new Intl.DateTimeFormat('es', { month: 'short' }).format(new Date(y, m - 1, 1)).replace('.', ''));
}

export function dayLabel(iso: string): string {
  const today = todayISO();
  if (iso === today) return 'Hoy';
  const y = new Date();
  y.setDate(y.getDate() - 1);
  if (iso === toISO(y)) return 'Ayer';
  const [yy, mm, dd] = iso.split('-').map(Number);
  return cap(new Intl.DateTimeFormat('es', { weekday: 'long', day: 'numeric', month: 'short' }).format(new Date(yy, mm - 1, dd)));
}

/** Días que quedan del mes contando hoy (0 si el mes ya pasó, total si es futuro). */
export function daysLeft(month: string): number {
  const [y, m] = month.split('-').map(Number);
  const total = new Date(y, m, 0).getDate();
  const cur = currentMonth();
  if (month < cur) return 0;
  if (month > cur) return total;
  return total - new Date().getDate() + 1;
}

/** Fecha por defecto para registrar algo en un mes: hoy si es el mes actual, si no el día 1. */
export function defaultDateFor(month: string): string {
  return month === currentMonth() ? todayISO() : `${month}-01`;
}
