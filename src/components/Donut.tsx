import type { Slice } from '../lib/stats';
import { bs, num } from '../lib/format';

/** Gráfico de dona en SVG puro (sin librerías) con leyenda. */
export function Donut({ slices, centerLabel }: { slices: Slice[]; centerLabel: string }) {
  const total = slices.reduce((s, x) => s + x.value, 0);
  const R = 40;
  const C = 2 * Math.PI * R;
  const gap = slices.length > 1 ? 1.5 : 0;
  let acc = 0;

  return (
    <div className="flex items-center gap-4">
      <svg viewBox="0 0 100 100" className="size-28 shrink-0" role="img" aria-label={`${centerLabel}: ${bs(total)}`}>
        <circle cx="50" cy="50" r={R} fill="none" stroke="var(--surface-2)" strokeWidth="13" />
        <g transform="rotate(-90 50 50)">
          {slices.map((s) => {
            const len = (s.value / total) * C;
            const el = (
              <circle
                key={s.id}
                cx="50" cy="50" r={R} fill="none" stroke={s.color} strokeWidth="13"
                strokeDasharray={`${Math.max(len - gap, 0.5)} ${C}`}
                strokeDashoffset={-acc}
              />
            );
            acc += len;
            return el;
          })}
        </g>
        <text x="50" y="47" textAnchor="middle" fontSize="7" fill="var(--muted)">{centerLabel}</text>
        <text x="50" y="58" textAnchor="middle" fontSize="10.5" fontWeight="700" fill="var(--ink)">{num(Math.round(total))}</text>
      </svg>

      <ul className="min-w-0 flex-1 space-y-2">
        {slices.map((s) => (
          <li key={s.id} className="flex items-start gap-2 text-sm">
            <span className="mt-1.5 size-2.5 shrink-0 rounded-full" style={{ background: s.color }} />
            <span className="min-w-0 flex-1">
              <span className="block truncate">{s.name}</span>
              <span className="tnum block text-xs text-muted">{Math.round((s.value / total) * 100)}%</span>
            </span>
            <span className="tnum shrink-0 font-medium">{num(s.value)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
