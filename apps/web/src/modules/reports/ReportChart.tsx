import type { ReportChartType, ReportResult } from '@erp/shared';
import { currentLanguage, tr } from '../../lib/i18n';
import { chartValue, headerLabel } from './cells';

// The report's chart, drawn here as SVG from the result already on the screen (no chart package). The chart only reads the numbers the
// database computed. Bars and lines read right to left in Arabic. At most 30 points; a pie shows the 7 largest and "Other".

const W = 640;
const H = 260;
const PAD = { top: 16, bottom: 48, side: 16 };
// Distinct, colour-blind-safe hues (Okabe-Ito), so pie slices can be told apart in light and dark mode.
const PALETTE = ['#0072B2', '#E69F00', '#009E73', '#CC79A7', '#56B4E9', '#D55E00', '#F0E442', '#999999'];

type Point = { label: string; value: number };

export function chartPoints(result: ReportResult, x: string, y: string, label: (raw: unknown, key: string) => string): Point[] {
  const xi = result.columns.findIndex((c) => c.key === x);
  const yi = result.columns.findIndex((c) => c.key === y);
  if (xi < 0 || yi < 0) return [];
  const yType = result.columns[yi]?.type ?? 'number';
  return result.rows.map((r) => ({ label: label(r[xi], x), value: chartValue(r[yi] ?? null, yType) })).filter((p) => Number.isFinite(p.value));
}

const short = (s: string) => (s.length > 14 ? `${s.slice(0, 13)}…` : s);
const fmt = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: 2, notation: Math.abs(n) >= 100_000 ? 'compact' : 'standard' });

export function ReportChart({ result, type, x, y, label }: { result: ReportResult; type: ReportChartType; x: string; y: string; label: (raw: unknown, key: string) => string }) {
  const all = chartPoints(result, x, y, label);
  if (all.length === 0) return <p className="muted small">{tr('Nothing to draw yet: run the report first.')}</p>;
  const title = `${headerLabel(y, result)} · ${headerLabel(x, result)}`;
  const rtl = currentLanguage() === 'ar';

  if (type === 'pie') {
    const sorted = [...all].filter((p) => p.value > 0).sort((a, b) => b.value - a.value);
    const top = sorted.slice(0, 7);
    const rest = sorted.slice(7).reduce((n, p) => n + p.value, 0);
    const slices = rest > 0 ? [...top, { label: tr('Other'), value: rest }] : top;
    const sum = slices.reduce((n, p) => n + p.value, 0);
    if (sum <= 0) return <p className="muted small">{tr('A pie needs values above zero.')}</p>;
    let a = -Math.PI / 2;
    const cx = 130;
    const cy = H / 2;
    const r = 100;
    return (
      <figure className="report-chart">
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={title}>
          {slices.map((s, i) => {
            const b = a + (s.value / sum) * Math.PI * 2;
            const large = b - a > Math.PI ? 1 : 0;
            const d = slices.length === 1
              ? `M ${cx - r} ${cy} a ${r} ${r} 0 1 0 ${2 * r} 0 a ${r} ${r} 0 1 0 ${-2 * r} 0`
              : `M ${cx} ${cy} L ${cx + r * Math.cos(a)} ${cy + r * Math.sin(a)} A ${r} ${r} 0 ${large} 1 ${cx + r * Math.cos(b)} ${cy + r * Math.sin(b)} Z`;
            a = b;
            return <path key={s.label + i} d={d} fill={PALETTE[i % PALETTE.length]} stroke="var(--card, #fff)" strokeWidth={1.5}><title>{`${s.label}: ${fmt(s.value)}`}</title></path>;
          })}
          {slices.map((s, i) => (
            <g key={`l${s.label}${i}`} transform={`translate(270 ${30 + i * 26})`}>
              <rect width={12} height={12} rx={2} fill={PALETTE[i % PALETTE.length]} />
              <text x={20} y={11} fontSize={13} fill="currentColor">{`${short(s.label)}  ${fmt(s.value)} (${Math.round((s.value / sum) * 100)}%)`}</text>
            </g>
          ))}
        </svg>
        <figcaption className="muted small">{title}</figcaption>
      </figure>
    );
  }

  const pts = all.slice(0, 30);
  const max = Math.max(0, ...pts.map((p) => p.value));
  const min = Math.min(0, ...pts.map((p) => p.value));
  const span = max - min || 1;
  const innerW = W - PAD.side * 2;
  const innerH = H - PAD.top - PAD.bottom;
  const step = innerW / pts.length;
  const xAt = (i: number) => PAD.side + (rtl ? pts.length - 1 - i : i) * step + step / 2;
  const yAt = (v: number) => PAD.top + ((max - v) / span) * innerH;
  const zero = yAt(0);
  return (
    <figure className="report-chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={title}>
        <line x1={PAD.side} x2={W - PAD.side} y1={zero} y2={zero} stroke="currentColor" strokeOpacity={0.3} />
        {type === 'bar'
          ? pts.map((p, i) => (
              <rect key={p.label + i} x={xAt(i) - step * 0.35} width={step * 0.7} y={Math.min(yAt(p.value), zero)} height={Math.max(1, Math.abs(zero - yAt(p.value)))} fill={PALETTE[0]} rx={2}>
                <title>{`${p.label}: ${fmt(p.value)}`}</title>
              </rect>
            ))
          : (
            <>
              <polyline fill="none" stroke={PALETTE[0]} strokeWidth={2} points={pts.map((p, i) => `${xAt(i)},${yAt(p.value)}`).join(' ')} />
              {pts.map((p, i) => <circle key={p.label + i} cx={xAt(i)} cy={yAt(p.value)} r={3} fill={PALETTE[0]}><title>{`${p.label}: ${fmt(p.value)}`}</title></circle>)}
            </>
          )}
        {pts.length <= 15 &&
          pts.map((p, i) => <text key={`v${p.label}${i}`} x={xAt(i)} y={yAt(p.value) - 4} fontSize={11} textAnchor="middle" fill="currentColor">{fmt(p.value)}</text>)}
        {pts.map((p, i) => (
          <text key={`x${p.label}${i}`} x={xAt(i)} y={H - PAD.bottom + 16} fontSize={11} textAnchor="middle" fill="currentColor" opacity={0.8}>
            {pts.length <= 12 ? short(p.label) : i % Math.ceil(pts.length / 12) === 0 ? short(p.label) : ''}
          </text>
        ))}
      </svg>
      <figcaption className="muted small">{all.length > 30 ? `${title} · ${tr('the first 30 rows')}` : title}</figcaption>
    </figure>
  );
}
