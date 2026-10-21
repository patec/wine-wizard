import { GROUP_COLOR } from '@/lib/format';

export interface WheelNote { key: string; label: string; group: string; groupLabel: string; intensity: number }

const GROUP_ORDER = ['fruit', 'floral', 'herbal', 'spice', 'earth', 'cellar', 'tertiary'];

function polar(cx: number, cy: number, r: number, a: number) {
  return [cx + r * Math.cos(a), cy + r * Math.sin(a)] as const;
}
function wedge(cx: number, cy: number, r0: number, r1: number, a0: number, a1: number) {
  const [x0, y0] = polar(cx, cy, r0, a0), [x1, y1] = polar(cx, cy, r1, a0);
  const [x2, y2] = polar(cx, cy, r1, a1), [x3, y3] = polar(cx, cy, r0, a1);
  const large = a1 - a0 > Math.PI ? 1 : 0;
  return `M${x0},${y0} L${x1},${y1} A${r1},${r1} 0 ${large} 1 ${x2},${y2} L${x3},${y3} A${r0},${r0} 0 ${large} 0 ${x0},${y0} Z`;
}

/** Aroma wheel: each aroma family is a sector; each note a radial petal whose length is its intensity. */
export function AromaWheel({ notes, size = 420, labelTop = 8, title }: { notes: WheelNote[]; size?: number; labelTop?: number; title?: string }) {
  const cx = size / 2, cy = size / 2;
  const R = size * 0.32, r0 = size * 0.09;
  const groups = GROUP_ORDER
    .map((g) => ({ g, items: notes.filter((n) => n.group === g).sort((a, b) => b.intensity - a.intensity).slice(0, 7) }))
    .filter((x) => x.items.length);
  const total = groups.reduce((s, x) => s + x.items.length, 0) || 1;
  const gap = 0.05;
  const span = Math.PI * 2 - gap * groups.length;
  const top = new Set([...notes].sort((a, b) => b.intensity - a.intensity).slice(0, labelTop).map((n) => n.key));

  let a = -Math.PI / 2;
  const petals: React.ReactNode[] = [];
  const labels: React.ReactNode[] = [];
  const arcs: React.ReactNode[] = [];
  for (const { g, items } of groups) {
    const gs = a;
    const per = (span * items.length) / total / items.length;
    for (const n of items) {
      const a0 = a + per * 0.08, a1 = a + per * 0.92;
      const r1 = r0 + (R - r0) * Math.max(0.06, n.intensity);
      petals.push(
        <path key={n.key} d={wedge(cx, cy, r0, r1, a0, a1)} fill={GROUP_COLOR[g]} fillOpacity={0.35 + 0.6 * n.intensity}>
          <title>{`${n.label} — ${Math.round(n.intensity * 100)}%`}</title>
        </path>,
      );
      if (top.has(n.key)) {
        const mid = (a0 + a1) / 2;
        const [lx, ly] = polar(cx, cy, r1 + 10, mid);
        const right = Math.cos(mid) >= 0;
        labels.push(
          <text key={'l' + n.key} x={lx} y={ly} fontSize={size * 0.027} fill="var(--ink)" textAnchor={Math.abs(Math.cos(mid)) < 0.2 ? 'middle' : right ? 'start' : 'end'} dominantBaseline="middle">
            {n.label}
          </text>,
        );
      }
      a += per;
    }
    const ge = a;
    // family arc + label
    const [ax0, ay0] = polar(cx, cy, R + size * 0.075, gs);
    const [ax1, ay1] = polar(cx, cy, R + size * 0.075, ge);
    arcs.push(
      <path key={'arc' + g} d={`M${ax0},${ay0} A${R + size * 0.075},${R + size * 0.075} 0 ${ge - gs > Math.PI ? 1 : 0} 1 ${ax1},${ay1}`}
        fill="none" stroke={GROUP_COLOR[g]} strokeWidth={2} strokeLinecap="round" opacity={0.9} />,
    );
    const mid = (gs + ge) / 2;
    const [tx, ty] = polar(cx, cy, R + size * 0.105, mid);
    const cm = Math.cos(mid);
    arcs.push(
      <text key={'gl' + g} x={tx} y={ty} fontSize={size * 0.024} letterSpacing="0.14em" fontWeight={600}
        fill={GROUP_COLOR[g]} textAnchor={Math.abs(cm) < 0.3 ? 'middle' : cm > 0 ? 'start' : 'end'} dominantBaseline="middle" style={{ textTransform: 'uppercase' }}>
        {items[0] ? groupShort(g) : ''}
      </text>,
    );
    a += gap;
  }

  return (
    <svg className="wheel" viewBox={`0 0 ${size} ${size}`} overflow="visible" role="img" aria-label={title ?? 'Aroma wheel'}>
      {[0.25, 0.5, 0.75, 1].map((f) => (
        <circle key={f} cx={cx} cy={cy} r={r0 + (R - r0) * f} fill="none" stroke="var(--rule)" strokeWidth={f === 1 ? 1 : 0.6} strokeDasharray={f === 1 ? undefined : '2 3'} />
      ))}
      <circle cx={cx} cy={cy} r={r0 - 4} fill="var(--paper-raised)" stroke="var(--rule)" />
      {arcs}
      {petals}
      {labels}
    </svg>
  );
}

function groupShort(g: string) {
  return ({ fruit: 'Fruit', floral: 'Floral', herbal: 'Herbal', spice: 'Spice', earth: 'Earth', cellar: 'Oak & cellar', tertiary: 'Bottle age' } as Record<string, string>)[g] ?? g;
}

const RADAR_SHORT: Record<string, string> = { herbal: 'Herbal', earth: 'Earth', cellar: 'Oak', tertiary: 'Bottle age', texture: 'Texture', style: 'Character' };

/** Palate radar across aroma families (0..1). */
export function PalateRadar({ axes, size = 360 }: { axes: { key: string; label: string; score: number }[]; size?: number }) {
  const cx = size / 2, cy = size / 2, R = size * 0.3;
  const n = axes.length;
  const pt = (i: number, v: number) => polar(cx, cy, R * v, -Math.PI / 2 + (i * 2 * Math.PI) / n);
  const poly = axes.map((ax, i) => pt(i, Math.max(0.04, ax.score)).join(',')).join(' ');
  return (
    <svg viewBox={`0 0 ${size} ${size}`} overflow="visible" role="img" aria-label="Palate profile by aroma family">
      {[0.25, 0.5, 0.75, 1].map((f) => (
        <polygon key={f} points={axes.map((_, i) => pt(i, f).join(',')).join(' ')} fill="none" stroke="var(--rule)" strokeWidth={f === 1 ? 1 : 0.6} />
      ))}
      {axes.map((ax, i) => {
        const [x, y] = pt(i, 1);
        const [lx, ly] = pt(i, 1.18);
        const c = Math.cos(-Math.PI / 2 + (i * 2 * Math.PI) / n);
        return (
          <g key={ax.key}>
            <line x1={cx} y1={cy} x2={x} y2={y} stroke="var(--rule)" strokeWidth={0.6} />
            <text x={lx} y={ly} fontSize={11} letterSpacing="0.12em" fontWeight={600} fill={GROUP_COLOR[ax.key] ?? 'var(--ink-soft)'}
              textAnchor={Math.abs(c) < 0.2 ? 'middle' : c > 0 ? 'start' : 'end'} dominantBaseline="middle" style={{ textTransform: 'uppercase' }}>
              {RADAR_SHORT[ax.key] ?? ax.label}
            </text>
          </g>
        );
      })}
      <polygon points={poly} fill="var(--wine)" fillOpacity={0.16} stroke="var(--wine)" strokeWidth={1.6} strokeLinejoin="round" />
      {axes.map((ax, i) => {
        const [x, y] = pt(i, Math.max(0.04, ax.score));
        return <circle key={'p' + ax.key} cx={x} cy={y} r={3.2} fill="var(--paper-raised)" stroke="var(--wine)" strokeWidth={1.6}><title>{`${ax.label}: ${Math.round(ax.score * 100)}`}</title></circle>;
      })}
    </svg>
  );
}

export interface FingerprintAxis { key: string; label: string }
export interface Fingerprints { axes: FingerprintAxis[]; wines: Record<string, number[]>; palate: number[] | null }

const GLYPH_SHORT: Record<string, string> = { cellar: 'Oak', tertiary: 'Age' };
const GLYPH_FLOOR = 0.08; // keeps lean wines from collapsing into a sliver

/**
 * Aroma fingerprint: a small radar of a wine's aroma groups, with the viewer's palate as a dashed outline.
 * Pure SVG, server-rendered. Pass `wine` without `palate` for a wine-only glyph, or `labels` for the legend.
 */
export function AromaGlyph({ axes, wine, palate, size = 64, labels = false }: {
  axes: FingerprintAxis[]; wine?: number[] | null; palate?: number[] | null; size?: number; labels?: boolean;
}) {
  const n = axes.length;
  if (n < 3) return null;
  const pad = labels ? size * 0.22 : 2;
  const c = size / 2, R = c - pad;
  const pt = (i: number, f: number) => polar(c, c, R * f, -Math.PI / 2 + (i * 2 * Math.PI) / n);
  const ring = (f: number) => axes.map((_, i) => pt(i, f).map((x) => x.toFixed(1)).join(',')).join(' ');
  const shape = (v: number[]) => v.map((x, i) => pt(i, GLYPH_FLOOR + (1 - GLYPH_FLOOR) * Math.max(0, Math.min(1, x))).map((p) => p.toFixed(1)).join(',')).join(' ');
  const desc = wine ? axes.map((a, i) => `${a.label} ${Math.round((wine[i] ?? 0) * 100)}`).join(', ') : undefined;

  return (
    <svg className="aroma-glyph" width={size} height={size} viewBox={`0 0 ${size} ${size}`} overflow="visible"
      role={labels ? 'img' : desc ? 'img' : undefined} aria-hidden={!labels && !desc ? true : undefined}
      aria-label={labels ? 'Aroma fingerprint legend' : desc ? `Aroma fingerprint: ${desc}` : undefined}>
      <polygon points={ring(1)} fill="none" stroke="var(--rule-strong)" strokeWidth={0.75} />
      <polygon points={ring(0.5)} fill="none" stroke="var(--rule)" strokeWidth={0.6} />
      {axes.map((a, i) => {
        const [x, y] = pt(i, 1);
        return <line key={a.key} x1={c} y1={c} x2={x} y2={y} stroke="var(--rule)" strokeWidth={0.5} />;
      })}
      {wine && <polygon points={shape(wine)} fill="var(--wine)" fillOpacity={0.2} stroke="var(--wine)" strokeWidth={1.2} strokeLinejoin="round" />}
      {palate && <polygon points={shape(palate)} fill="none" stroke="var(--gold)" strokeWidth={1.3} strokeDasharray="3 2" strokeLinejoin="round" />}
      {labels && axes.map((a, i) => {
        const [x, y] = pt(i, 1.24);
        const cs = Math.cos(-Math.PI / 2 + (i * 2 * Math.PI) / n);
        return (
          <text key={'l' + a.key} x={x} y={y} fontSize={10} letterSpacing="0.12em" fontWeight={600} fill="var(--ink-soft)"
            textAnchor={Math.abs(cs) < 0.2 ? 'middle' : cs > 0 ? 'start' : 'end'} dominantBaseline="middle" style={{ textTransform: 'uppercase' }}>
            {GLYPH_SHORT[a.key] ?? a.label}
          </text>
        );
      })}
    </svg>
  );
}
