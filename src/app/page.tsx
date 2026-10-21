import Link from 'next/link';
import { supabaseServer } from '@/lib/supabase/server';
import { CARD_FIELDS, getCategories, getWine, wheelNotes } from '@/lib/data';
import { AromaWheel } from '@/components/Charts';
import { WineCard, type CardWine } from '@/components/WineBits';

export const revalidate = 3600;

const SAMPLE_QUERIES = [
  'a smoky Syrah for brisket under $40',
  'crisp white with wet stone and lemon for oysters',
  'something like Barolo — rose petals and tar',
  'dry rosé for a picnic under $25',
  'old-school Rioja, leather and dried cherry',
  'Champagne with brioche for a celebration',
];

export default async function Home() {
  const sb = await supabaseServer();
  const [{ data: { user } }, cats, showcase, { count }, { count: attrCount }, { data: featured }] = await Promise.all([
    sb.auth.getUser(),
    getCategories(sb),
    getWine(sb, 'chateau-margaux-margaux'),
    sb.from('wines').select('id', { count: 'exact', head: true }),
    sb.from('attributes').select('id', { count: 'exact', head: true }),
    sb.from('wines').select(CARD_FIELDS).in('slug', ['domaine-de-la-pepiere-muscadet-sevre-et-maine-sur-lie', 'domaine-pierre-gonon-saint-joseph-rouge', 'bartolo-mascarello-barolo']).limit(3),
  ]);

  return (
    <>
      <section className="hero">
        <div className="container hero-grid">
          <div>
            <div className="eyebrow">A personal sommelier, built on {attrCount ?? 300}+ dimensions of taste</div>
            <h1 style={{ marginTop: 18 }}>A cellar that knows <em>your palate.</em></h1>
            <p className="lede">
              Every wine here is mapped across hundreds of named descriptors — from blackberry and graphite to chalky tannins and
              flor — and so is your taste. Tell us what you love, rate what you open, and we pour you toward the bottles that fit.
            </p>
            <div className="row">
              {user ? (
                <Link href="/for-you" className="btn btn-wine">See your recommendations</Link>
              ) : (
                <Link href="/signup" className="btn btn-wine">Map my palate</Link>
              )}
              <Link href="/cellar" className="btn btn-ghost">Browse the cellar</Link>
            </div>
            <p className="faint" style={{ marginTop: 22, fontSize: '.85rem' }}>{(count ?? 200).toLocaleString('en-US')} wines profiled · free, private, ad-free</p>
          </div>
          <div className="hero-art">
            {showcase && (
              <figure style={{ margin: 0 }}>
                <AromaWheel notes={wheelNotes(showcase, cats)} size={460} labelTop={9} title="Aroma wheel for Château Margaux" />
                <figcaption className="smallcaps" style={{ textAlign: 'center', marginTop: -6 }}>
                  Château Margaux, as the engine sees it
                </figcaption>
              </figure>
            )}
          </div>
        </div>
      </section>

      <section id="method" className="container" style={{ padding: '72px 24px 24px' }}>
        <div className="rule-title"><span className="eyebrow">The method</span></div>
        <h2 style={{ maxWidth: 760 }}>Taste, made measurable — without losing the poetry.</h2>
        <div className="feature-grid" style={{ marginTop: 36 }}>
          <div>
            <div className="numeral">i.</div>
            <h3>A sommelier’s lexicon</h3>
            <p className="muted" style={{ marginTop: 10 }}>
              {attrCount ?? 323} descriptors in 27 families — red and black fruit, garrigue, petrol, flint, rancio, chalky tannins,
              whole-cluster, age-worthiness — plus WSET-style structure scales. Each one is a dimension.
            </p>
          </div>
          <div>
            <div className="numeral">ii.</div>
            <h3>Your palate, as a vector</h3>
            <p className="muted" style={{ marginTop: 10 }}>
              A short tasting quiz seeds your profile. Every bottle you rate refines it: what you adore pulls you toward its notes,
              what disappoints pushes you away. Your quiz answers fade as your ratings take over.
            </p>
          </div>
          <div>
            <div className="numeral">iii.</div>
            <h3>Recommendations that explain themselves</h3>
            <p className="muted" style={{ marginTop: 10 }}>
              Each pick blends aroma similarity, structural fit and style, then tells you why: <em>for your love of cassis &amp; graphite</em> —
              and warns you when a wine carries something you avoid.
            </p>
          </div>
        </div>
      </section>

      <section className="container" style={{ padding: '56px 24px' }}>
        <div className="rule-title"><span className="eyebrow">Ask as you would a sommelier</span></div>
        <div className="chips" style={{ gap: 10 }}>
          {SAMPLE_QUERIES.map((q) => (
            <Link key={q} href={`/cellar?q=${encodeURIComponent(q)}`} className="chip" style={{ height: 36, padding: '0 16px', fontSize: '.95rem', fontFamily: 'var(--font-display)', fontStyle: 'italic' }}>
              “{q}”
            </Link>
          ))}
        </div>
      </section>

      {featured && featured.length > 0 && (
        <section className="container" style={{ padding: '24px 24px 40px' }}>
          <div className="rule-title"><span className="eyebrow">From the cellar</span></div>
          <div className="grid grid-cards">
            {(featured as CardWine[]).map((w) => <WineCard key={w.slug} w={w} />)}
          </div>
        </section>
      )}
      <div className="ornament">✦ ✦ ✦</div>
    </>
  );
}
