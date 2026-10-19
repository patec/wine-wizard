'use client';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { supabaseBrowser } from '@/lib/supabase/client';
import { TYPES, TYPE_LABEL } from '@/lib/format';
import { TypeDot } from '@/components/WineBits';
import type { WineType } from '@/lib/types';

export interface QuizData {
  categories: { key: string; label: string; group_label: string; description: string | null; examples: string[] }[];
  attributes: { key: string; label: string; category: string; kind: string }[];
  wines: { id: string; name: string; producer: string; wine_type: WineType; region: string }[];
  previous: Record<string, any> | null;
  name: string | null;
}

type Tri = -1 | 0 | 1 | 2;
const cycle = (s: Tri): Tri => (s === 0 ? 1 : s === 1 ? 2 : s === 2 ? -1 : 0);
const STATE_LABEL: Record<Tri, string> = { 0: '', 1: 'Enjoy', 2: 'Adore', [-1]: 'Avoid' } as Record<Tri, string>;
const toTri = (v: number | undefined): Tri => (v == null ? 0 : v >= 0.9 ? 2 : v > 0 ? 1 : v < 0 ? -1 : 0);

const STYLE_BLURB: Record<WineType, string> = {
  red: 'From silky Pinot to brooding Syrah', white: 'Mineral, aromatic or richly oaked', rose: 'Pale Provence to deep Tavel',
  sparkling: 'Champagne, Cava, Crémant, pét-nat', orange: 'Skin-contact whites with grip', dessert: 'Sauternes, Tokaji, late harvest',
  fortified: 'Sherry, Port, Madeira',
};

const SLIDERS = [
  { key: 'sweetness', q: 'Sweetness', left: 'Bone dry', right: 'Lusciously sweet', def: 8 },
  { key: 'acidity', q: 'Acidity', left: 'Soft & round', right: 'Mouthwatering', def: 62 },
  { key: 'tannin', q: 'Tannin (in reds)', left: 'Silky, gentle', right: 'Firm & grippy', def: 55 },
  { key: 'body', q: 'Body', left: 'Light & airy', right: 'Full & weighty', def: 58 },
  { key: 'oak_influence', q: 'Oak', left: 'Unoaked purity', right: 'Generous oak', def: 35 },
  { key: 'maturity', q: 'Age', left: 'Youthful fruit', right: 'Aged & savory', def: 40 },
];

const STEPS = ['Styles', 'Structure', 'Aromas', 'Notes', 'Bottles', 'Budget'];

export function Quiz({ data }: { data: QuizData }) {
  const router = useRouter();
  const p = data.previous ?? {};
  const [step, setStep] = useState(0);
  const [styles, setStyles] = useState<Record<string, Tri>>(() => Object.fromEntries(TYPES.map((t) => [t, toTri(p.styles?.[t])])));
  const [struct, setStruct] = useState<Record<string, number>>(() =>
    Object.fromEntries(SLIDERS.map((s) => [s.key, p.structure?.[s.key] != null ? Math.round(p.structure[s.key] * 100) : s.def])));
  const [families, setFamilies] = useState<Record<string, Tri>>(() =>
    Object.fromEntries(data.categories.map((c) => [c.key, toTri(p.families?.[c.key])])));
  const [love, setLove] = useState<string[]>(p.notes_love ?? []);
  const [avoid, setAvoid] = useState<string[]>(p.notes_avoid ?? []);
  const [loved, setLoved] = useState<string[]>(p.wines_loved ?? []);
  const [budget, setBudget] = useState<number>(p.budget_max ?? 60);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const styleVal = (s: Tri) => (s === 2 ? 1 : s === 1 ? 0.6 : s === -1 ? -0.7 : 0);
  const famVal = (s: Tri) => (s === 2 ? 1 : s === 1 ? 0.5 : s === -1 ? -0.8 : 0);

  async function save() {
    setBusy(true); setError(null);
    const quiz = {
      styles: Object.fromEntries(Object.entries(styles).filter(([, v]) => v !== 0).map(([k, v]) => [k, styleVal(v)])),
      families: Object.fromEntries(Object.entries(families).filter(([, v]) => v !== 0).map(([k, v]) => [k, famVal(v)])),
      notes_love: love, notes_avoid: avoid,
      structure: Object.fromEntries(Object.entries(struct).map(([k, v]) => [k, v / 100])),
      budget_max: budget >= 300 ? null : budget,
      wines_loved: loved,
    };
    const { error } = await supabaseBrowser().rpc('save_palate_quiz', { p_quiz: quiz });
    setBusy(false);
    if (error) return setError(error.message);
    router.push('/for-you?welcome=1'); router.refresh();
  }

  const isLast = step === STEPS.length - 1;
  return (
    <div className="fade-in">
      <div className="eyebrow">Palate quiz · {step + 1} of {STEPS.length} · {STEPS[step]}</div>
      <div className="quiz-progress" style={{ marginTop: 14 }}>{STEPS.map((s, i) => <i key={s} className={i <= step ? 'on' : ''} />)}</div>

      {step === 0 && (
        <section>
          <h1 style={{ fontSize: 'clamp(2rem,4vw,3rem)' }}>{data.name ? `${data.name}, w` : 'W'}hat do you like to pour?</h1>
          <p className="muted" style={{ margin: '12px 0 28px' }}>Tap once to <b>enjoy</b>, twice to <b>adore</b>, three times to <b>avoid</b>.</p>
          <div className="option-grid">
            {TYPES.map((t) => (
              <button key={t} type="button" className="option" data-state={styles[t]} onClick={() => setStyles((s) => ({ ...s, [t]: cycle(s[t]) }))}>
                <span className="state">{STATE_LABEL[styles[t]] || '\u00a0'}</span>
                <span className="title"><TypeDot type={t} /> {TYPE_LABEL[t]}</span>
                <span className="sub">{STYLE_BLURB[t]}</span>
              </button>
            ))}
          </div>
        </section>
      )}

      {step === 1 && (
        <section>
          <h1 style={{ fontSize: 'clamp(2rem,4vw,3rem)' }}>The shape of a wine you love</h1>
          <p className="muted" style={{ margin: '12px 0 12px' }}>Structure is the architecture beneath the aromas. Set each where your favourite bottles sit.</p>
          {SLIDERS.map((s) => (
            <div key={s.key} className="slider-row">
              <div className="q">{s.q}</div>
              <span className="end">{s.left}</span>
              <input type="range" min={0} max={100} value={struct[s.key]} aria-label={s.q}
                onChange={(e) => setStruct((v) => ({ ...v, [s.key]: +e.target.value }))} />
              <span className="end">{s.right}</span>
            </div>
          ))}
        </section>
      )}

      {step === 2 && (
        <section>
          <h1 style={{ fontSize: 'clamp(2rem,4vw,3rem)' }}>Which aromas draw you in?</h1>
          <p className="muted" style={{ margin: '12px 0 28px' }}>Enjoy, adore or avoid each family. Leave the rest — we’ll learn them from your ratings.</p>
          <div className="option-grid">
            {data.categories.map((c) => (
              <button key={c.key} type="button" className="option" data-state={families[c.key]} onClick={() => setFamilies((s) => ({ ...s, [c.key]: cycle(s[c.key]) }))}>
                <span className="state">{STATE_LABEL[families[c.key]] || '\u00a0'}</span>
                <span className="title">{c.label}</span>
                <span className="sub">{c.examples.join(', ')}…</span>
              </button>
            ))}
          </div>
        </section>
      )}

      {step === 3 && (
        <section>
          <h1 style={{ fontSize: 'clamp(2rem,4vw,3rem)' }}>Any notes you can’t resist — or can’t stand?</h1>
          <p className="muted" style={{ margin: '12px 0 28px' }}>Optional, but powerful: specific notes weigh more than families.</p>
          <div className="two-col" style={{ gap: 32 }}>
            <NotePicker title="Notes I adore" attrs={data.attributes} selected={love} onChange={setLove} exclude={avoid} tone="love" />
            <NotePicker title="Notes I avoid" attrs={data.attributes} selected={avoid} onChange={setAvoid} exclude={love} tone="avoid" />
          </div>
        </section>
      )}

      {step === 4 && (
        <section>
          <h1 style={{ fontSize: 'clamp(2rem,4vw,3rem)' }}>Bottles you’ve loved</h1>
          <p className="muted" style={{ margin: '12px 0 28px' }}>Pick any you know and adore — each becomes a 4½-star rating that anchors your palate.</p>
          <WinePicker wines={data.wines} selected={loved} onChange={setLoved} />
        </section>
      )}

      {step === 5 && (
        <section>
          <h1 style={{ fontSize: 'clamp(2rem,4vw,3rem)' }}>What do you usually spend?</h1>
          <p className="muted" style={{ margin: '12px 0 28px' }}>A soft ceiling — we’ll still show a bottle above it if it’s a remarkable fit.</p>
          <div className="card card-pad" style={{ textAlign: 'center' }}>
            <div className="display num" style={{ fontSize: '3.4rem' }}>{budget >= 300 ? 'No limit' : `up to $${budget}`}</div>
            <input type="range" min={15} max={300} step={5} value={budget} onChange={(e) => setBudget(+e.target.value)} aria-label="Typical maximum spend" style={{ marginTop: 18 }} />
            <div className="row between faint" style={{ fontSize: '.8rem' }}><span>$15</span><span>$300+</span></div>
          </div>
        </section>
      )}

      {error && <p className="error" role="alert" style={{ marginTop: 20 }}>{error}</p>}
      <div className="row between" style={{ marginTop: 36, paddingTop: 20, borderTop: '1px solid var(--rule)' }}>
        <button className="btn btn-ghost" disabled={step === 0} onClick={() => setStep((s) => s - 1)}>Back</button>
        {isLast ? (
          <button className="btn btn-wine" disabled={busy} onClick={save}>{busy ? 'Decanting…' : 'Reveal my wines'}</button>
        ) : (
          <button className="btn" onClick={() => setStep((s) => s + 1)}>Continue</button>
        )}
      </div>
    </div>
  );
}

function NotePicker({ title, attrs, selected, onChange, exclude, tone }: {
  title: string; attrs: QuizData['attributes']; selected: string[]; onChange: (v: string[]) => void; exclude: string[]; tone: 'love' | 'avoid';
}) {
  const [q, setQ] = useState('');
  const byKey = useMemo(() => new Map(attrs.map((a) => [a.key, a])), [attrs]);
  const matches = useMemo(() => {
    const s = q.trim().toLowerCase();
    const pool = attrs.filter((a) => !selected.includes(a.key) && !exclude.includes(a.key) && a.kind === 'aroma');
    return (s ? pool.filter((a) => a.label.toLowerCase().includes(s)) : pool.slice(0, 0)).slice(0, 18);
  }, [q, attrs, selected, exclude]);
  return (
    <div>
      <div className="label" style={{ marginBottom: 8 }}>{title}</div>
      <input className="input" placeholder="Type a note — e.g. violet, petrol, coconut" value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="chips" style={{ marginTop: 12, minHeight: 30 }}>
        {selected.map((k) => (
          <button key={k} type="button" className={`chip ${tone === 'love' ? 'chip-love' : 'chip-avoid'}`} onClick={() => onChange(selected.filter((x) => x !== k))} title="Remove">
            {byKey.get(k)?.label ?? k} ×
          </button>
        ))}
      </div>
      <div className="chips" style={{ marginTop: 10 }}>
        {matches.map((a) => (
          <button key={a.key} type="button" className="chip" onClick={() => { onChange([...selected, a.key]); setQ(''); }}>+ {a.label}</button>
        ))}
      </div>
    </div>
  );
}

function WinePicker({ wines, selected, onChange }: { wines: QuizData['wines']; selected: string[]; onChange: (v: string[]) => void }) {
  const [q, setQ] = useState('');
  const byId = useMemo(() => new Map(wines.map((w) => [w.id, w])), [wines]);
  const matches = useMemo(() => {
    const s = q.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    if (s.length < 2) return [];
    return wines.filter((w) => !selected.includes(w.id) && `${w.producer} ${w.name} ${w.region}`.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').includes(s)).slice(0, 10);
  }, [q, wines, selected]);
  return (
    <div>
      <input className="input" placeholder="Search by producer, wine or region — e.g. Cloudy Bay, Barolo, Rioja" value={q} onChange={(e) => setQ(e.target.value)} />
      {matches.length > 0 && (
        <div className="card" style={{ marginTop: 8 }}>
          {matches.map((w) => (
            <button key={w.id} type="button" onClick={() => { onChange([...selected, w.id]); setQ(''); }}
              style={{ display: 'flex', width: '100%', gap: 10, alignItems: 'center', padding: '10px 14px', background: 'none', border: 0, borderBottom: '1px solid var(--rule)', cursor: 'pointer', textAlign: 'left' }}>
              <TypeDot type={w.wine_type} /><span><b style={{ fontWeight: 600 }}>{w.producer}</b> — <span className="italic">{w.name}</span></span>
              <span className="faint" style={{ marginLeft: 'auto', fontSize: '.8rem' }}>{w.region}</span>
            </button>
          ))}
        </div>
      )}
      <div className="chips" style={{ marginTop: 16 }}>
        {selected.map((id) => {
          const w = byId.get(id);
          return w ? (
            <button key={id} type="button" className="chip chip-love" onClick={() => onChange(selected.filter((x) => x !== id))}>
              <TypeDot type={w.wine_type} /> {w.name.includes(w.producer) ? w.name : `${w.producer} ${w.name}`} ×
            </button>
          ) : null;
        })}
      </div>
    </div>
  );
}
