import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getUser } from '@/lib/supabase/server';
import { WineCard } from '@/components/WineBits';
import { Filters } from '@/components/Filters';
import type { Recommendation } from '@/lib/types';

export const metadata = { title: 'For you' };
export const dynamic = 'force-dynamic';

export default async function ForYou({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const { supabase: sb, user } = await getUser();
  const { data: palate } = await sb.from('palates').select('display_name, quiz_completed_at, rating_count, flavor_vec').eq('user_id', user!.id).maybeSingle();
  if (!palate?.quiz_completed_at && !palate?.rating_count) redirect('/onboarding');

  const [{ data: recs, error }, { data: countryRows }] = await Promise.all([
    sb.rpc('recommend_wines', {
      p_limit: 24,
      p_type: sp.type ?? null,
      p_max_price: sp.max ? Number(sp.max) : null,
      p_country: sp.country ?? null,
    }),
    sb.from('wines').select('country'),
  ]);
  const countries = [...new Set((countryRows ?? []).map((r) => r.country))].sort();
  const list = (recs ?? []) as Recommendation[];
  const [first, ...rest] = list;

  return (
    <div className="container page">
      <header className="page-head">
        <div className="eyebrow">{sp.welcome ? 'Your palate is mapped' : `Selected for ${palate?.display_name ?? 'you'}`}</div>
        <h1 style={{ marginTop: 10 }}>Poured for your palate</h1>
        <p className="lede">
          Ranked by how closely each wine’s aromas, structure and style match yours.
          {palate?.rating_count ? ` Refined by ${palate.rating_count} rating${palate.rating_count === 1 ? '' : 's'} so far.` : ' Rate what you drink and these sharpen.'}
        </p>
      </header>
      <Filters countries={countries} />
      {error && <p className="error">{error.message}</p>}
      {list.length === 0 ? (
        <div className="empty"><h3>Nothing matches those filters</h3><p>Try widening the price or style.</p></div>
      ) : (
        <>
          {first && (
            <div style={{ marginBottom: 28 }}>
              <div className="rule-title"><span className="eyebrow">The sommelier’s first pour</span></div>
              <WineCard w={first} match={first.match} reasons={first.reasons} cautions={first.cautions}
                note={first.description ? <p className="italic" style={{ marginTop: 8, color: 'var(--ink)', fontSize: '1.08rem', lineHeight: 1.5 }}>{first.description}</p> : null} />
            </div>
          )}
          <div className="rule-title"><span className="eyebrow">Further down the list</span></div>
          <div className="grid grid-cards">
            {rest.map((w) => <WineCard key={w.id} w={w} match={w.match} reasons={w.reasons} cautions={w.cautions} />)}
          </div>
        </>
      )}
      <p className="faint" style={{ marginTop: 40, fontSize: '.88rem' }}>
        Wines you’ve rated are left out. <Link className="btn-link" href="/palate">See how your palate is read →</Link>
      </p>
    </div>
  );
}
