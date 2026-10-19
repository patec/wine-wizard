import { supabaseServer } from '@/lib/supabase/server';
import { GROUP_COLOR } from '@/lib/format';
import type { Attribute, Category } from '@/lib/types';

export const metadata = { title: 'The lexicon', description: 'Every dimension of the Wine Wizard vector space.' };
export const revalidate = 3600;

export default async function Lexicon() {
  const sb = await supabaseServer();
  const [{ data: cats }, { data: attrs }, { data: stats }] = await Promise.all([
    sb.from('attribute_categories').select('*').order('sort'),
    sb.from('attributes').select('id,key,label,category,kind,synonyms,scale_labels,sort').order('sort'),
    sb.from('attribute_stats').select('key,wine_count'),
  ]);
  const count = new Map((stats ?? []).map((s) => [s.key, s.wine_count as number]));
  const groups: { key: string; label: string; cats: (Category & { attrs: Attribute[] })[] }[] = [];
  for (const c of (cats ?? []) as Category[]) {
    let g = groups.find((x) => x.key === c.group_key);
    if (!g) { g = { key: c.group_key, label: c.group_label, cats: [] }; groups.push(g); }
    g.cats.push({ ...c, attrs: ((attrs ?? []) as Attribute[]).filter((a) => a.category === c.key) });
  }
  const total = attrs?.length ?? 0;
  const dims = (attrs ?? []).filter((a) => ['aroma', 'texture', 'style'].includes(a.kind)).length;

  return (
    <div className="container page">
      <header className="page-head">
        <div className="eyebrow">The lexicon · {total} descriptors</div>
        <h1 style={{ marginTop: 10 }}>The language of the glass</h1>
        <p className="lede">
          Every descriptor below is a dimension of the vector space: {dims} aroma, texture and style dimensions compared by cosine
          similarity, ten WSET-style structure scales compared by distance, and a table of classic pairings. Numbers show how many
          wines in the cellar carry each note.
        </p>
        <div className="chips" style={{ marginTop: 20 }}>
          {groups.map((g) => <a key={g.key} href={`#${g.key}`} className="chip"><span className="dot" style={{ color: GROUP_COLOR[g.key] ?? 'var(--gold)' }} />{g.label}</a>)}
        </div>
      </header>
      {groups.map((g) => (
        <section key={g.key} id={g.key} style={{ marginBottom: 56, scrollMarginTop: 90 }}>
          <h2 style={{ marginBottom: 20 }}><span style={{ color: GROUP_COLOR[g.key] ?? 'var(--gold)' }}>§</span> {g.label}</h2>
          <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 28 }}>
            {g.cats.map((c) => (
              <div key={c.key}>
                <div className="rule-title" style={{ marginBottom: 8 }}><h3 style={{ fontSize: '1.3rem' }}>{c.label}</h3></div>
                {c.description && <p className="muted italic" style={{ fontSize: '1rem', lineHeight: 1.45 }}>{c.description}</p>}
                <div>
                  {c.attrs.map((a) => (
                    <div key={a.key} className="note-row" style={{ gridTemplateColumns: '1fr auto' }} title={a.synonyms.length ? `Also: ${a.synonyms.join(', ')}` : undefined}>
                      <span>{a.label}{a.scale_labels ? <span className="faint" style={{ fontSize: '.78rem' }}> · {a.scale_labels.join(' → ')}</span> : null}</span>
                      <span className="faint num" style={{ fontSize: '.8rem' }}>{count.get(a.key) ?? 0}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
