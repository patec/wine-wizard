'use client';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { supabaseBrowser } from '@/lib/supabase/client';
import { TYPES, TYPE_LABEL, scaleWord } from '@/lib/format';
import type { WineType } from '@/lib/types';

interface A { id: number; key: string; label: string; category: string; kind: string; scale_labels: string[] | null }
interface C { key: string; label: string; group_label: string; kind: string }
interface Draft {
  found: boolean;
  wine: { producer: string; name: string; wine_type: WineType; country: string; region: string; appellation: string; grapes: string[]; price_usd: number | null; abv: number | null; vintage: number | null; description: string; serve: string; decant: string; drink_window: string; elevage: string };
  structure: Record<string, number>; notes: Record<string, number>; pairings: string[];
  confidence: 'documented' | 'partly_inferred' | 'inferred'; caveat: string | null; sources: { url: string; title: string }[];
}
const CONFIDENCE: Record<Draft['confidence'], string> = {
  documented: 'Profiled from tasting notes and tech sheets for this wine.',
  partly_inferred: 'Partly profiled from published notes; some gaps filled from grape and region typicity.',
  inferred: 'Little has been published on this bottle, so most of the profile comes from grape and region typicity.',
};

const STRUCT_DEFAULT: Record<string, number> = { sweetness: 5, acidity: 60, tannin: 50, alcohol: 55, body: 55, flavor_intensity: 60, finish: 60, oak_influence: 30, effervescence: 0, maturity: 20 };
const slugify = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 70);

export function AddWineForm({ attrs, cats, initialQuery = '' }: { attrs: A[]; cats: C[]; initialQuery?: string }) {
  const router = useRouter();
  const [f, setF] = useState({ producer: '', name: '', wine_type: 'red' as WineType, country: '', region: '', appellation: '', grapes: '', price: '', abv: '', vintage: '', description: '', serve: '', decant: '', window: '', elevage: '' });
  const [struct, setStruct] = useState(STRUCT_DEFAULT);
  const [notes, setNotes] = useState<Record<string, number>>({});
  const [pairings, setPairings] = useState<string[]>([]);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lq, setLq] = useState(initialQuery);
  const [looking, setLooking] = useState(false);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const autoRan = useRef(false);

  const byKey = useMemo(() => new Map(attrs.map((a) => [a.key, a])), [attrs]);
  const catLabel = useMemo(() => new Map(cats.map((c) => [c.key, c.label])), [cats]);
  const structAttrs = attrs.filter((a) => a.kind === 'structure');
  const pairAttrs = attrs.filter((a) => a.kind === 'pairing');
  const matches = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return [];
    return attrs.filter((a) => ['aroma', 'texture', 'style'].includes(a.kind) && !(a.key in notes) && (a.label.toLowerCase().includes(s) || (catLabel.get(a.category) ?? '').toLowerCase().includes(s))).slice(0, 24);
  }, [q, attrs, notes, catLabel]);

  async function lookup(text: string) {
    if (text.trim().length < 3) return;
    setLooking(true); setLookupError(null); setDraft(null);
    const { data, error: err } = await supabaseBrowser().functions.invoke('lookup-wine', { body: { q: text.trim() } });
    setLooking(false);
    if (err) {
      const detail = await (err as { context?: Response }).context?.json?.().catch(() => null);
      setLookupError(detail?.error ?? 'The lookup didn’t come back. Try again, or profile the bottle by hand below.');
      return;
    }
    const d = data as Draft;
    setDraft(d);
    if (!d.found) return;
    const w = d.wine;
    setF({
      producer: w.producer, name: w.name, wine_type: w.wine_type, country: w.country, region: w.region, appellation: w.appellation,
      grapes: w.grapes.join(', '), price: w.price_usd?.toString() ?? '', abv: w.abv?.toString() ?? '', vintage: w.vintage?.toString() ?? '',
      description: w.description, serve: w.serve, decant: w.decant, window: w.drink_window, elevage: w.elevage,
    });
    setStruct({ ...STRUCT_DEFAULT, ...d.structure });
    setNotes(Object.fromEntries(Object.entries(d.notes).filter(([k]) => byKey.has(k))));
    setPairings(d.pairings.filter((k) => byKey.has(k)));
  }

  // Arriving from a cellar search ("Look it up online") starts the lookup straight away.
  useEffect(() => {
    if (initialQuery && !autoRan.current) { autoRan.current = true; lookup(initialQuery); }
  }, [initialQuery]);

  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (Object.keys(notes).length < 5) { setError('Add at least five aroma or character notes so the wine can be matched.'); return; }
    setBusy(true); setError(null);
    const sb = supabaseBrowser();
    const slug = `${slugify(`${f.producer} ${f.name}`)}-${Math.random().toString(36).slice(2, 6)}`;
    const { data: { user } } = await sb.auth.getUser();
    const { data: wine, error: e1 } = await sb.from('wines').insert({
      slug, name: f.name.trim(), producer: f.producer.trim(), wine_type: f.wine_type, country: f.country.trim(), region: f.region.trim(),
      appellation: f.appellation.trim() || null, grapes: f.grapes.split(',').map((g) => g.trim()).filter(Boolean),
      price_usd: f.price ? Number(f.price) : null, abv: f.abv ? Number(f.abv) : null, vintage: f.vintage ? Number(f.vintage) : null,
      description: f.description.trim() || null, serve: f.serve || null, decant: f.decant || null, drink_window: f.window || null, elevage: f.elevage || null,
      created_by: user?.id,
    }).select('id, slug').single();
    if (e1 || !wine) { setBusy(false); setError(e1?.message ?? 'Could not save the wine.'); return; }
    const rows = [
      ...structAttrs.map((a) => ({ wine_id: wine.id, attribute_id: a.id, intensity: (struct[a.key] ?? 50) / 100 })),
      ...Object.entries(notes).map(([k, v]) => ({ wine_id: wine.id, attribute_id: byKey.get(k)!.id, intensity: Math.max(0.01, v / 100) })),
      ...pairings.map((k) => ({ wine_id: wine.id, attribute_id: byKey.get(k)!.id, intensity: 1 })),
    ];
    const { error: e2 } = await sb.from('wine_attributes').insert(rows);
    if (e2) { setBusy(false); setError(e2.message); return; }
    // semantic embedding (best effort)
    await sb.functions.invoke('embed-wines', { body: { wine_id: wine.id } }).catch(() => null);
    router.push(`/wines/${wine.slug}`);
  }

  return (
    <div className="stack" style={{ ['--gap' as string]: '40px' }}>
      <section>
        <div className="rule-title"><span className="eyebrow">Find it online</span></div>
        <form onSubmit={(e) => { e.preventDefault(); lookup(lq); }} className="searchbar" role="search">
          <svg className="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><circle cx="11" cy="11" r="6.5" /><path d="m20 20-4.2-4.2" /></svg>
          <input className="input" value={lq} onChange={(e) => setLq(e.target.value)} placeholder="Producer and wine, e.g. “Three Harbors Coastal Red Blend”" aria-label="Producer and wine to look up" />
          <button className="btn btn-wine" disabled={looking || lq.trim().length < 3}>{looking ? 'Searching…' : 'Look it up'}</button>
        </form>
        <p className="faint" style={{ marginTop: 10, fontSize: '.88rem' }}>
          We’ll search winery pages, tech sheets and reviews, then fill in the form below for you to check before it’s added.
        </p>
        {looking && (
          <div className="notice fade-in" style={{ marginTop: 14 }} role="status">
            Reading up on <i>{lq.trim()}</i>. This usually takes under a minute.
          </div>
        )}
        {lookupError && <p className="error" role="alert" style={{ marginTop: 14 }}>{lookupError}</p>}
        {draft && !draft.found && (
          <div className="notice fade-in" style={{ marginTop: 14 }} role="status">
            We couldn’t find that exact bottle online. Try adding the producer, region or grape, or profile it by hand below.
          </div>
        )}
        {draft?.found && (
          <div className="notice fade-in" style={{ marginTop: 14 }} role="status">
            <p><b>Drafted {draft.wine.producer} {draft.wine.name}.</b> {CONFIDENCE[draft.confidence]} Check it against your own impression before saving.</p>
            {draft.caveat && <p style={{ marginTop: 6 }}>{draft.caveat}</p>}
            {draft.sources.length > 0 && (
              <p className="faint" style={{ marginTop: 8, fontSize: '.85rem' }}>
                Sources:{' '}
                {draft.sources.map((s, i) => (
                  <span key={s.url}>{i > 0 && ' · '}<a href={s.url} target="_blank" rel="noopener noreferrer nofollow" className="btn-link" style={{ fontSize: '.85rem' }}>{s.title}</a></span>
                ))}
              </p>
            )}
          </div>
        )}
      </section>

      <form onSubmit={submit} className="stack" style={{ ['--gap' as string]: '40px' }}>
        <section>
          <div className="rule-title"><span className="eyebrow">The label</span></div>
          <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16 }}>
            <div className="field"><label>Producer *</label><input className="input" required value={f.producer} onChange={set('producer')} placeholder="Domaine Tempier" /></div>
            <div className="field"><label>Wine *</label><input className="input" required value={f.name} onChange={set('name')} placeholder="Bandol Rouge" /></div>
            <div className="field"><label>Style *</label>
              <select className="select" value={f.wine_type} onChange={set('wine_type')}>{TYPES.map((t) => <option key={t} value={t}>{TYPE_LABEL[t]}</option>)}</select></div>
            <div className="field"><label>Country *</label><input className="input" required value={f.country} onChange={set('country')} placeholder="France" /></div>
            <div className="field"><label>Region *</label><input className="input" required value={f.region} onChange={set('region')} placeholder="Provence" /></div>
            <div className="field"><label>Appellation</label><input className="input" value={f.appellation} onChange={set('appellation')} placeholder="Bandol" /></div>
            <div className="field"><label>Grapes</label><input className="input" value={f.grapes} onChange={set('grapes')} placeholder="Mourvèdre, Grenache, Cinsault" /></div>
            <div className="field"><label>Price (USD)</label><input className="input" inputMode="numeric" value={f.price} onChange={set('price')} placeholder="55" /></div>
            <div className="field"><label>ABV %</label><input className="input" inputMode="decimal" value={f.abv} onChange={set('abv')} placeholder="14" /></div>
            <div className="field"><label>Vintage</label><input className="input" inputMode="numeric" value={f.vintage} onChange={set('vintage')} placeholder="optional" /></div>
          </div>
          <div className="field" style={{ marginTop: 16 }}><label>Tasting note</label><textarea className="textarea" value={f.description} onChange={set('description')} placeholder="In your own words…" /></div>
        </section>

        <section>
          <div className="rule-title"><span className="eyebrow">Structure</span></div>
          {structAttrs.map((a) => (
            <div key={a.key} className="scale-row" style={{ gridTemplateColumns: '140px 1fr 130px' }}>
              <span className="name">{a.label}</span>
              <input type="range" min={0} max={100} value={struct[a.key]} onChange={(e) => setStruct({ ...struct, [a.key]: +e.target.value })} aria-label={a.label} />
              <span className="word">{scaleWord(a.scale_labels, struct[a.key] / 100)}</span>
            </div>
          ))}
        </section>

        <section>
          <div className="rule-title"><span className="eyebrow">Aromas, texture &amp; character</span></div>
          <input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search the lexicon — cassis, violet, chalky tannins, whole cluster…" />
          {matches.length > 0 && (
            <div className="chips" style={{ marginTop: 10 }}>
              {matches.map((a) => <button key={a.key} type="button" className="chip" onClick={() => { setNotes({ ...notes, [a.key]: 60 }); setQ(''); }}>+ {a.label} <span className="faint">· {catLabel.get(a.category)}</span></button>)}
            </div>
          )}
          <div style={{ marginTop: 16 }}>
            {Object.entries(notes).map(([k, v]) => (
              <div key={k} className="scale-row" style={{ gridTemplateColumns: '180px 1fr 90px' }}>
                <span>{byKey.get(k)?.label} <span className="faint" style={{ fontSize: '.75rem' }}>{catLabel.get(byKey.get(k)?.category ?? '')}</span></span>
                <input type="range" min={5} max={100} value={v} onChange={(e) => setNotes({ ...notes, [k]: +e.target.value })} aria-label={`${byKey.get(k)?.label} intensity`} />
                <span className="row" style={{ justifyContent: 'flex-end', gap: 8 }}>
                  <span className="faint num" style={{ fontSize: '.8rem' }}>{v < 30 ? 'hint' : v < 65 ? 'clear' : 'signature'}</span>
                  <button type="button" className="btn-link" aria-label="Remove" onClick={() => { const n = { ...notes }; delete n[k]; setNotes(n); }}>×</button>
                </span>
              </div>
            ))}
            {Object.keys(notes).length === 0 && <p className="faint" style={{ marginTop: 8 }}>No notes yet — add at least five.</p>}
          </div>
        </section>

        <section>
          <div className="rule-title"><span className="eyebrow">At the table</span></div>
          <div className="chips">
            {pairAttrs.map((a) => (
              <button key={a.key} type="button" className="chip" aria-pressed={pairings.includes(a.key)} onClick={() => setPairings(pairings.includes(a.key) ? pairings.filter((x) => x !== a.key) : [...pairings, a.key])}>{a.label}</button>
            ))}
          </div>
        </section>

        <section>
          <div className="rule-title"><span className="eyebrow">Service (optional)</span></div>
          <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16 }}>
            <div className="field"><label>Serve</label><input className="input" value={f.serve} onChange={set('serve')} placeholder="16–18°C" /></div>
            <div className="field"><label>Decant</label><input className="input" value={f.decant} onChange={set('decant')} placeholder="1 hour" /></div>
            <div className="field"><label>Drinking window</label><input className="input" value={f.window} onChange={set('window')} placeholder="Now–2035" /></div>
            <div className="field"><label>Élevage</label><input className="input" value={f.elevage} onChange={set('elevage')} placeholder="18 months in large foudres" /></div>
          </div>
        </section>

        {error && <p className="error" role="alert">{error}</p>}
        <div className="row"><button className="btn btn-wine" disabled={busy || looking}>{busy ? 'Cellaring…' : 'Add to the cellar'}</button></div>
      </form>
    </div>
  );
}
