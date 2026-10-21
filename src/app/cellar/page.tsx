import Link from 'next/link';
import { supabaseServer } from '@/lib/supabase/server';
import { CARD_FIELDS, getCountries } from '@/lib/data';
import { WineCard, type CardWine } from '@/components/WineBits';
import { AromaGlyph, type Fingerprints } from '@/components/Charts';
import { Filters } from '@/components/Filters';
import { NaturalSearch } from './NaturalSearch';

export const metadata = { title: 'The cellar' };
export const dynamic = 'force-dynamic';
const PER = 30;

export default async function Cellar({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const sb = await supabaseServer();
  const page = Math.max(1, Number(sp.page) || 1);

  let query = sb.from('wines').select(CARD_FIELDS, { count: 'exact' });
  if (sp.type) query = query.eq('wine_type', sp.type);
  if (sp.country) query = query.eq('country', sp.country);
  if (sp.max) query = query.lte('price_usd', Number(sp.max));
  const sort = sp.sort ?? 'popular';
  query = sort === 'price_asc' ? query.order('price_usd', { ascending: true, nullsFirst: false })
    : sort === 'price_desc' ? query.order('price_usd', { ascending: false, nullsFirst: false })
    : sort === 'region' ? query.order('country').order('region').order('producer')
    : sort === 'producer' ? query.order('producer').order('name')
    : query.order('community_ratings', { ascending: false, nullsFirst: false }).order('producer').order('name');
  const [{ data, count }, countries] = await Promise.all([
    query.range((page - 1) * PER, page * PER - 1),
    getCountries(sb),
  ]);
  const wines = (data ?? []) as CardWine[];
  const ids = wines.map((w) => w.id).filter(Boolean) as string[];
  const { data: fp } = !sp.q && ids.length ? await sb.rpc('aroma_fingerprints', { p_ids: ids }) : { data: null };
  const prints = fp as Fingerprints | null;
  const pages = Math.ceil((count ?? 0) / PER);
  const qs = (p: number) => { const u = new URLSearchParams(sp as Record<string, string>); u.set('page', String(p)); u.delete('q'); return `?${u}`; };

  return (
    <div className="container page">
      <header className="page-head">
        <div className="eyebrow">The cellar · {count ?? 0} wines</div>
        <h1 style={{ marginTop: 10 }}>Ask the cellar</h1>
        <p className="lede">Describe what you’re after in your own words — aromas, a dish, a price, a place — and we’ll read it the way a sommelier would.</p>
        <div style={{ marginTop: 26 }}><NaturalSearch initial={sp.q ?? ''} /></div>
      </header>
      {!sp.q && (
        <>
          <Filters countries={countries} showSort />
          {prints && prints.axes.length >= 3 && <FingerprintLegend prints={prints} />}
          <div className="grid grid-cards">
            {wines.map((w) => (
              <WineCard key={w.slug} w={w}
                aside={prints && w.id && prints.wines[w.id] ? <AromaGlyph axes={prints.axes} wine={prints.wines[w.id]} palate={prints.palate} /> : undefined} />
            ))}
          </div>
          {pages > 1 && (
            <div className="row" style={{ justifyContent: 'center', marginTop: 36 }}>
              {page > 1 && <Link className="btn btn-ghost btn-sm" href={qs(page - 1)}>← Previous</Link>}
              <span className="faint num" style={{ fontSize: '.85rem' }}>Page {page} of {pages}</span>
              {page < pages && <Link className="btn btn-ghost btn-sm" href={qs(page + 1)}>Next →</Link>}
            </div>
          )}
          <p className="faint" style={{ marginTop: 32, fontSize: '.9rem' }}>
            Know a bottle that’s missing? <Link href="/wines/new" className="btn-link">Add it to the cellar</Link>
          </p>
        </>
      )}
    </div>
  );
}

function FingerprintLegend({ prints }: { prints: Fingerprints }) {
  return (
    <div className="fp-legend">
      <AromaGlyph axes={prints.axes} palate={prints.palate} size={132} labels />
      <div className="fp-key">
        <div className="eyebrow">Aroma fingerprints</div>
        <div><i className="fp-swatch fp-wine" aria-hidden="true" />Each wine’s aromas by family</div>
        {prints.palate
          ? <div><i className="fp-swatch fp-palate" aria-hidden="true" />Your palate</div>
          : <div className="faint"><Link href="/login" className="btn-link">Sign in</Link> to see your palate overlaid</div>}
      </div>
    </div>
  );
}
