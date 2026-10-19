import Link from 'next/link';
import { getUser } from '@/lib/supabase/server';
import { TypeDot, StarIcon } from '@/components/WineBits';
import { TYPE_LABEL } from '@/lib/format';

export const metadata = { title: 'Journal' };
export const dynamic = 'force-dynamic';

function Stars({ v }: { v: number }) {
  return (
    <span className="stars" aria-label={`${v} of 5`}>
      {[1, 2, 3, 4, 5].map((i) => {
        const fill = Math.max(0, Math.min(1, v - (i - 1)));
        return (
          <span key={i} style={{ position: 'relative', width: 16, height: 16, display: 'inline-block' }}>
            <span style={{ position: 'absolute', inset: 0, color: 'var(--rule-strong)' }}><StarIcon /></span>
            <span style={{ position: 'absolute', inset: 0, color: 'var(--wine)', clipPath: `inset(0 ${100 - fill * 100}% 0 0)` }}><StarIcon /></span>
          </span>
        );
      })}
    </span>
  );
}

export default async function Journal() {
  const { supabase: sb, user } = await getUser();
  const { data } = await sb
    .from('ratings')
    .select('id, rating, notes, vintage, tasted_on, context, loved_notes, updated_at, wines(slug, name, producer, wine_type, region, country)')
    .eq('user_id', user!.id)
    .order('updated_at', { ascending: false });
  const rows = (data ?? []) as any[];
  const avg = rows.length ? rows.reduce((s, r) => s + Number(r.rating), 0) / rows.length : 0;

  return (
    <div className="container page">
      <header className="page-head">
        <div className="eyebrow">Tasting journal</div>
        <h1 style={{ marginTop: 10 }}>Bottles you’ve opened</h1>
        <div className="row" style={{ gap: 40, marginTop: 20 }}>
          <div className="kpi"><b className="num">{rows.length}</b><span>Entries</span></div>
          <div className="kpi"><b className="num">{avg ? avg.toFixed(1) : '—'}</b><span>Average rating</span></div>
        </div>
      </header>
      {rows.length === 0 ? (
        <div className="empty">
          <h3>Your journal is waiting for its first entry</h3>
          <p>Open any wine in <Link href="/cellar" className="btn-link">the cellar</Link> and rate it — your recommendations learn from every note.</p>
        </div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table className="table">
            <thead><tr><th>Wine</th><th>Rating</th><th>Notes</th><th>Tasted</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td style={{ minWidth: 240 }}>
                    <Link href={`/wines/${r.wines.slug}`}>
                      <div className="smallcaps row" style={{ gap: 6 }}><TypeDot type={r.wines.wine_type} />{TYPE_LABEL[r.wines.wine_type as keyof typeof TYPE_LABEL]} · {r.wines.region}</div>
                      <div className="display" style={{ fontSize: '1.25rem', fontWeight: 600, marginTop: 4 }}>{r.wines.name.includes(r.wines.producer) ? r.wines.name : `${r.wines.producer} — ${r.wines.name}`}{r.vintage ? ` ${r.vintage}` : ''}</div>
                    </Link>
                  </td>
                  <td style={{ whiteSpace: 'nowrap' }}><Stars v={Number(r.rating)} /> <span className="num faint" style={{ fontSize: '.85rem', marginLeft: 6 }}>{Number(r.rating).toFixed(1)}</span></td>
                  <td style={{ maxWidth: 420 }}>
                    {r.notes ? <span className="italic">{r.notes}</span> : <span className="faint">{r.context === 'onboarding' ? 'Added as a favourite during your palate quiz' : '—'}</span>}
                  </td>
                  <td className="faint num" style={{ whiteSpace: 'nowrap', fontSize: '.85rem' }}>{r.tasted_on ? new Date(r.tasted_on + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
