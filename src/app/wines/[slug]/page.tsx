import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getUser } from '@/lib/supabase/server';
import { getCategories, getWine, wheelNotes } from '@/lib/data';
import { AromaWheel } from '@/components/Charts';
import { Dots, MatchRing, TypeDot, WineCard, joinLabels } from '@/components/WineBits';
import { GROUP_COLOR, STRUCT_ORDER, TYPE_LABEL, origin, price, scaleWord } from '@/lib/format';
import type { NoteRef } from '@/lib/types';
import { RatePanel } from './RatePanel';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { supabase } = await getUser();
  const { data } = await supabase.from('wines').select('name,producer,description').eq('slug', slug).maybeSingle();
  return data ? { title: data.name.includes(data.producer) ? data.name : `${data.producer} ${data.name}`, description: data.description } : {};
}

export default async function WinePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { supabase: sb, user } = await getUser();
  const [wine, cats] = await Promise.all([getWine(sb, slug), getCategories(sb)]);
  if (!wine) notFound();

  const [{ data: similar }, match, rating] = await Promise.all([
    sb.rpc('similar_wines', { p_wine: wine.id, p_limit: 6 }),
    user ? sb.rpc('wine_match', { p_wine: wine.id }).then((r) => r.data as null | { match: number; flavor: number; structure: number; style: number; reasons: NoteRef[]; cautions: NoteRef[] }) : Promise.resolve(null),
    user ? sb.from('ratings').select('rating,notes,vintage,tasted_on,loved_notes,disliked_notes,context').eq('wine_id', wine.id).eq('user_id', user.id).maybeSingle().then((r) => r.data) : Promise.resolve(null),
  ]);

  const attrs = wine.wine_attributes;
  const structure = STRUCT_ORDER.map((k) => attrs.find((a) => a.attributes.key === k)).filter(Boolean) as typeof attrs;
  const aromas = attrs.filter((a) => a.attributes.kind === 'aroma').sort((a, b) => b.intensity - a.intensity);
  const character = attrs.filter((a) => (a.attributes.kind === 'texture' || a.attributes.kind === 'style') && a.intensity >= 0.3).sort((a, b) => b.intensity - a.intensity);
  const pairings = attrs.filter((a) => a.attributes.kind === 'pairing');
  const groups = new Map<string, { label: string; items: typeof aromas }>();
  for (const a of aromas) {
    const c = cats.get(a.attributes.category);
    const g = c?.group_key ?? 'fruit';
    if (!groups.has(g)) groups.set(g, { label: c?.group_label ?? g, items: [] });
    groups.get(g)!.items.push(a);
  }
  const showProducer = !wine.name.toLowerCase().includes(wine.producer.toLowerCase());
  const isTannic = (attrs.find((a) => a.attributes.key === 'tannin')?.intensity ?? 0) >= 0.15;
  const isSparkling = (attrs.find((a) => a.attributes.key === 'effervescence')?.intensity ?? 0) >= 0.1;

  return (
    <div className="container" style={{ paddingBottom: 96 }}>
      <nav className="smallcaps" style={{ paddingTop: 28 }}>
        <Link href="/cellar">The cellar</Link> &nbsp;/&nbsp; <Link href={`/cellar?country=${encodeURIComponent(wine.country)}`}>{wine.country}</Link> &nbsp;/&nbsp; {wine.region}
      </nav>
      <header className="detail-head" style={{ ['--type-color' as string]: `var(--t-${wine.wine_type})` }}>
        <div>
          {showProducer && <div className="producer">{wine.producer}</div>}
          <h1>{wine.name}</h1>
          <div className="origin">{origin(wine)}</div>
          <div className="chips" style={{ marginTop: 18 }}>
            <span className="chip"><TypeDot type={wine.wine_type} /> {TYPE_LABEL[wine.wine_type]}</span>
            {wine.grapes.map((g) => <span key={g} className="chip">{g}</span>)}
            {wine.abv && <span className="chip num">{wine.abv}% abv</span>}
            <span className="chip chip-gold num">c. {price(wine.price_usd)}</span>
            {!wine.is_curated && <span className="chip">Member-added</span>}
          </div>
        </div>
        <div style={{ textAlign: 'center' }}>
          {match ? (
            <>
              <MatchRing value={match.match} size="lg" />
              <div className="smallcaps" style={{ marginTop: 8 }}>for your palate</div>
            </>
          ) : (
            <div className="card card-pad" style={{ maxWidth: 260, textAlign: 'left' }}>
              <div className="eyebrow">Is it for you?</div>
              <p className="muted" style={{ margin: '8px 0 14px', fontSize: '.9rem' }}>Map your palate to see how closely this wine fits.</p>
              <Link className="btn btn-sm btn-wine" href={user ? '/onboarding' : `/signup`}>{user ? 'Take the palate quiz' : 'Map my palate'}</Link>
            </div>
          )}
        </div>
      </header>

      {match && (match.reasons.length > 0 || match.cautions.length > 0) && (
        <div className="notice" style={{ margin: '28px 0 0' }}>
          {match.reasons.length > 0 && <>It speaks to your love of <b style={{ color: 'var(--wine)' }}>{joinLabels(match.reasons)}</b>. </>}
          {match.cautions.length > 0 && <span className="muted">Be aware it shows {joinLabels(match.cautions)}, which you tend to avoid. </span>}
          <span className="faint num">Aroma {Math.round(match.flavor)} · Structure {Math.round(match.structure)} · Style {Math.round(match.style)}</span>
        </div>
      )}

      <div className="two-col" style={{ marginTop: 48 }}>
        <section>
          {wine.description && <p className="tasting-note">{wine.description}</p>}
          <div className="rule-title" style={{ marginTop: 40 }}><span className="eyebrow">On the nose &amp; palate</span></div>
          <div style={{ maxWidth: 520, margin: '0 auto' }}>
            <AromaWheel notes={wheelNotes(wine, cats)} title={`Aroma wheel for ${wine.name}`} />
          </div>
          {[...groups.entries()].map(([g, { label, items }]) => (
            <div key={g}>
              <div className="group-title"><span className="swatch" style={{ background: GROUP_COLOR[g] }} /><span className="smallcaps" style={{ color: 'var(--ink-soft)' }}>{label}</span></div>
              <div className="note-list">
                {items.map((a) => (
                  <div key={a.attributes.key} className="note-row">
                    <span>{a.attributes.label}</span>
                    <span className="bar-track" title={`${Math.round(a.intensity * 100)}%`}><span className="bar-fill" style={{ width: `${a.intensity * 100}%`, background: GROUP_COLOR[g] }} /></span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </section>

        <aside>
          <div className="rule-title"><span className="eyebrow">Structure</span></div>
          <div>
            {structure.filter((s) => (s.attributes.key !== 'tannin' || isTannic) && (s.attributes.key !== 'effervescence' || isSparkling)).map((s) => (
              <div key={s.attributes.key} className="scale-row">
                <span className="name">{s.attributes.label === 'Flavor intensity' ? 'Intensity' : s.attributes.label === 'Oak influence' ? 'Oak' : s.attributes.label}</span>
                <Dots value={s.intensity} />
                <span className="word">{scaleWord(s.attributes.scale_labels, s.intensity)}</span>
              </div>
            ))}
          </div>

          {character.length > 0 && (
            <>
              <div className="rule-title" style={{ marginTop: 36 }}><span className="eyebrow">Texture &amp; character</span></div>
              <div className="chips">{character.map((c) => <span key={c.attributes.key} className="chip" style={{ opacity: 0.55 + c.intensity * 0.45 }}>{c.attributes.label}</span>)}</div>
            </>
          )}

          <div className="rule-title" style={{ marginTop: 36 }}><span className="eyebrow">Service</span></div>
          <dl className="service">
            <div><dt>Serve</dt><dd>{wine.serve ?? '—'}</dd></div>
            <div><dt>Decant</dt><dd>{wine.decant ?? '—'}</dd></div>
            <div><dt>Drinking window</dt><dd>{wine.drink_window ?? '—'}</dd></div>
            <div><dt>Élevage</dt><dd>{wine.elevage ?? '—'}</dd></div>
          </dl>

          {pairings.length > 0 && (
            <>
              <div className="rule-title" style={{ marginTop: 36 }}><span className="eyebrow">At the table</span></div>
              <div className="chips">{pairings.map((p) => <Link key={p.attributes.key} href={`/cellar?q=${encodeURIComponent('wine for ' + p.attributes.label.toLowerCase())}`} className="chip">{p.attributes.label}</Link>)}</div>
            </>
          )}

          <div style={{ marginTop: 40 }}>
            <RatePanel wineId={wine.id} signedIn={!!user} existing={rating}
              notes={aromas.slice(0, 16).map((a) => ({ key: a.attributes.key, label: a.attributes.label }))} />
          </div>
        </aside>
      </div>

      {similar && similar.length > 0 && (
        <section style={{ marginTop: 72 }}>
          <div className="rule-title"><span className="eyebrow">Drinks alike</span></div>
          <div className="grid grid-cards">
            {similar.map((s: any) => (
              <WineCard key={s.slug} w={s} match={s.similarity} matchLabel="alike" note={s.shared?.length ? <>Shares <b>{joinLabels(s.shared)}</b></> : null} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
