import Link from 'next/link';
import type { NoteRef, WineType } from '@/lib/types';
import { TYPE_LABEL, origin, price } from '@/lib/format';

export function TypeDot({ type }: { type: WineType }) {
  return <span className={`type-dot type-${type}`} aria-hidden="true" />;
}

export function MatchRing({ value, size = 'sm', label = 'match' }: { value: number; size?: 'sm' | 'lg'; label?: string }) {
  const r = 26, c = 2 * Math.PI * r;
  const v = Math.max(0, Math.min(100, value));
  return (
    <div className={`match ${size === 'lg' ? 'match-lg' : ''}`} role="img" aria-label={`${Math.round(v)} percent ${label}`}>
      <svg viewBox="0 0 60 60">
        <circle className="track" cx="30" cy="30" r={r} fill="none" strokeWidth="2" />
        <circle className="bar" cx="30" cy="30" r={r} fill="none" strokeWidth="2.5" strokeLinecap="round"
          strokeDasharray={c} strokeDashoffset={c * (1 - v / 100)} />
      </svg>
      <div className="val"><b className="num">{Math.round(v)}</b><span>{label}</span></div>
    </div>
  );
}

export interface CardWine {
  slug: string; name: string; producer: string; wine_type: WineType; country: string; region: string;
  appellation: string | null; grapes: string[]; price_usd: number | null; community_rating?: number | null;
}

export function WineCard({ w, match, reasons, cautions, note, matchLabel }: {
  w: CardWine; match?: number; reasons?: NoteRef[]; cautions?: NoteRef[]; note?: React.ReactNode; matchLabel?: string;
}) {
  const showProducer = !w.name.toLowerCase().includes(w.producer.toLowerCase());
  return (
    <Link href={`/wines/${w.slug}`} className="wine-card fade-in" style={{ ['--type-color' as string]: `var(--t-${w.wine_type})` }}>
      <div className="meta">
        <TypeDot type={w.wine_type} />
        <span className="smallcaps">{TYPE_LABEL[w.wine_type]} · {w.region}</span>
      </div>
      <div>
        {showProducer && <div className="producer">{w.producer}</div>}
        <div className="wine-name">{w.name}</div>
        <div className="origin">{origin(w)}{w.grapes.length ? ` — ${w.grapes.slice(0, 3).join(', ')}${w.grapes.length > 3 ? '…' : ''}` : ''}</div>
      </div>
      {match != null ? <MatchRing value={match} label={matchLabel} /> : <span />}
      <div className="foot">
        <div className="reasons">
          {reasons && reasons.length > 0 && <>For your love of <b>{joinLabels(reasons)}</b></>}
          {cautions && cautions.length > 0 && <div className="avoid">Note: shows {joinLabels(cautions)}</div>}
          {note}
        </div>
        {w.price_usd != null ? <div className="price num"><small>c.</small>{price(w.price_usd)}</div>
          : w.community_rating != null ? <div className="price num" title="Community rating"><small>★</small>{Number(w.community_rating).toFixed(1)}</div> : null}
      </div>
    </Link>
  );
}

export function joinLabels(n: NoteRef[]) {
  const l = n.map((x) => x.label.toLowerCase());
  if (l.length <= 1) return l.join('');
  return l.slice(0, -1).join(', ') + ' & ' + l[l.length - 1];
}

export function Dots({ value, n = 5 }: { value: number; n?: number }) {
  const filled = value * n;
  return (
    <span className="dots" aria-hidden="true">
      {Array.from({ length: n }, (_, i) => {
        const cls = filled >= i + 0.75 ? 'on' : filled >= i + 0.25 ? 'half' : '';
        return <i key={i} className={cls} />;
      })}
    </span>
  );
}

export function StarIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 3.2l2.6 5.5 6 .8-4.4 4.1 1.1 5.9L12 16.6l-5.3 2.9 1.1-5.9-4.4-4.1 6-.8z" />
    </svg>
  );
}
