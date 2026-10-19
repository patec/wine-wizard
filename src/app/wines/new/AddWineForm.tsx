'use client';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { supabaseBrowser } from '@/lib/supabase/client';
import { TYPES, TYPE_LABEL, scaleWord } from '@/lib/format';
import type { WineType } from '@/lib/types';

interface A { id: number; key: string; label: string; category: string; kind: string; scale_labels: string[] | null }
interface C { key: string; label: string; group_label: string; kind: string }

const STRUCT_DEFAULT: Record<string, number> = { sweetness: 5, acidity: 60, tannin: 50, alcohol: 55, body: 55, flavor_intensity: 60, finish: 60, oak_influence: 30, effervescence: 0, maturity: 20 };
const slugify = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 70);

export function AddWineForm({ attrs, cats }: { attrs: A[]; cats: C[] }) {
  const router = useRouter();
  const [f, setF] = useState({ producer: '', name: '', wine_type: 'red' as WineType, country: '', region: '', appellation: '', grapes: '', price: '', abv: '', vintage: '', description: '', serve: '', decant: '', window: '', elevage: '' });
  const [struct, setStruct] = useState(STRUCT_DEFAULT);
  const [notes, setNotes] = useState<Record<string, number>>({});
  const [pairings, setPairings] = useState<string[]>([]);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const byKey = useMemo(() => new Map(attrs.map((a) => [a.key, a])), [attrs]);
  const catLabel = useMemo(() => new Map(cats.map((c) => [c.key, c.label])), [cats]);
  const structAttrs = attrs.filter((a) => a.kind === 'structure');
  const pairAttrs = attrs.filter((a) => a.kind === 'pairing');
  const matches = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return [];
    return attrs.filter((a) => ['aroma', 'texture', 'style'].includes(a.kind) && !(a.key in notes) && (a.label.toLowerCase().includes(s) || (catLabel.get(a.category) ?? '').toLowerCase().includes(s))).slice(0, 24);
  }, [q, attrs, notes, catLabel]);

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
      <div className="row"><button className="btn btn-wine" disabled={busy}>{busy ? 'Cellaring…' : 'Add to the cellar'}</button></div>
    </form>
  );
}
