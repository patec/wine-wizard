'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { supabaseBrowser } from '@/lib/supabase/client';
import { WineCard, type CardWine } from '@/components/WineBits';
import { TYPE_LABEL } from '@/lib/format';
import type { WineType } from '@/lib/types';

interface Interp {
  type: WineType | null; min_price: number | null; max_price: number | null;
  notes: { key: string; label: string }[]; pairings: { key: string; label: string }[]; structure: string[]; terms: string[];
}
type Result = CardWine & { score: number; matched: { notes: string[]; pairings: string[] } };

const EXAMPLES = ['a smoky Syrah for brisket under $40', 'mineral white for oysters', 'Barolo-like, rose petals and tar', 'juicy chillable red under $25'];

export function NaturalSearch({ initial }: { initial: string }) {
  const router = useRouter();
  const path = usePathname();
  const [q, setQ] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [res, setRes] = useState<{ query: string; interpretation: Interp; results: Result[] } | null>(null);

  const run = useCallback(async (text: string) => {
    if (!text.trim()) { setRes(null); return; }
    setBusy(true); setError(null);
    const { data, error } = await supabaseBrowser().functions.invoke('search', { body: { q: text, limit: 24 } });
    setBusy(false);
    if (error) { setError('The sommelier is momentarily away — please try again.'); return; }
    setRes(data);
  }, []);

  useEffect(() => { if (initial) run(initial); }, [initial, run]);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    router.replace(q.trim() ? `${path}?q=${encodeURIComponent(q.trim())}` : path, { scroll: false });
    run(q);
  }

  const i = res?.interpretation;
  return (
    <div>
      <form onSubmit={submit} className="searchbar" role="search">
        <svg className="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><circle cx="11" cy="11" r="6.5" /><path d="m20 20-4.2-4.2" /></svg>
        <input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Try “a smoky Syrah for brisket under $40”" aria-label="Describe the wine you want" />
        <button className="btn btn-wine" disabled={busy}>{busy ? 'Pouring…' : 'Search'}</button>
      </form>
      {!res && !busy && (
        <div className="interpretation">
          <span className="faint">Or try</span>
          {EXAMPLES.map((ex) => (
            <button key={ex} type="button" className="chip" onClick={() => { setQ(ex); router.replace(`${path}?q=${encodeURIComponent(ex)}`, { scroll: false }); run(ex); }}>
              <span className="italic">{ex}</span>
            </button>
          ))}
        </div>
      )}
      {error && <p className="error" style={{ marginTop: 12 }}>{error}</p>}
      {i && (
        <div className="interpretation fade-in">
          <span className="smallcaps">Reading this as</span>
          {i.type && <span className="chip chip-gold">{TYPE_LABEL[i.type]}</span>}
          {i.notes.map((n) => <span key={n.key} className="chip chip-love">{n.label}</span>)}
          {i.pairings.map((n) => <span key={n.key} className="chip">with {n.label.toLowerCase()}</span>)}
          {i.structure.map((s) => <span key={s} className="chip">{s}</span>)}
          {i.terms.map((t) => <span key={t} className="chip">“{t}”</span>)}
          {(i.min_price != null || i.max_price != null) && (
            <span className="chip chip-gold">{i.min_price != null && i.max_price != null ? `$${i.min_price}–$${i.max_price}` : i.max_price != null ? `under $${i.max_price}` : `over $${i.min_price}`}</span>
          )}
          <button type="button" className="btn-link" style={{ marginLeft: 6 }} onClick={() => { setQ(''); setRes(null); router.replace(path, { scroll: false }); }}>Clear</button>
        </div>
      )}
      {busy && !res && <div className="grid grid-cards" style={{ marginTop: 28 }}>{[0, 1, 2].map((k) => <div key={k} className="skeleton" style={{ height: 180 }} />)}</div>}
      {res && (
        <div className="grid grid-cards" style={{ marginTop: 28, opacity: busy ? 0.5 : 1 }}>
          {res.results.length === 0 && <div className="empty"><h3>No bottles fit that brief</h3><p>Loosen the price, or describe it another way. Looking for a particular bottle? <Link href={`/wines/new?q=${encodeURIComponent(res.query)}`} className="btn-link">Look it up online</Link> and add it.</p></div>}
          {res.results.map((w) => (
            <WineCard key={w.slug} w={w} match={w.score} matchLabel="fit"
              note={(w.matched.notes.length > 0 || w.matched.pairings.length > 0) ? <>Shows <b>{[...w.matched.notes, ...w.matched.pairings.map((p) => `a match for ${p.toLowerCase()}`)].join(', ').toLowerCase()}</b></> : null} />
          ))}
        </div>
      )}
      {res && res.results.length > 0 && (
        <p className="faint" style={{ marginTop: 24, fontSize: '.9rem' }}>
          Not seeing the bottle you meant? <Link href={`/wines/new?q=${encodeURIComponent(res.query)}`} className="btn-link">Look up “{res.query}” online</Link> and add it to the cellar.
        </p>
      )}
    </div>
  );
}
