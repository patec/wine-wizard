'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { supabaseBrowser } from '@/lib/supabase/client';
import { StarIcon } from '@/components/WineBits';

interface Existing { rating: number; notes: string | null; vintage: number | null; tasted_on: string | null; loved_notes: string[]; disliked_notes: string[]; context: string | null }

export function RatePanel({ wineId, signedIn, existing, notes }: { wineId: string; signedIn: boolean; existing: Existing | null; notes: { key: string; label: string }[] }) {
  const router = useRouter();
  const [rating, setRating] = useState<number>(existing?.rating ? Number(existing.rating) : 0);
  const [hover, setHover] = useState<number | null>(null);
  const [text, setText] = useState(existing?.notes ?? '');
  const [vintage, setVintage] = useState(existing?.vintage ? String(existing.vintage) : '');
  const [tastedOn, setTastedOn] = useState(existing?.tasted_on ?? new Date().toISOString().slice(0, 10));
  const [loved, setLoved] = useState<string[]>(existing?.loved_notes ?? []);
  const [disliked, setDisliked] = useState<string[]>(existing?.disliked_notes ?? []);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  if (!signedIn) {
    return (
      <div className="card card-pad">
        <div className="eyebrow">Tasted it?</div>
        <p className="muted" style={{ margin: '8px 0 14px' }}>Sign in to rate this bottle — every rating sharpens your recommendations.</p>
        <Link href="/login" className="btn btn-sm">Sign in to rate</Link>
      </div>
    );
  }

  const cycleNote = (k: string) => {
    if (loved.includes(k)) { setLoved(loved.filter((x) => x !== k)); setDisliked([...disliked, k]); }
    else if (disliked.includes(k)) setDisliked(disliked.filter((x) => x !== k));
    else setLoved([...loved, k]);
  };

  async function save() {
    if (!rating) { setMsg('Choose a rating first.'); return; }
    setBusy(true); setMsg(null);
    const { error } = await supabaseBrowser().rpc('rate_wine', {
      p_wine: wineId, p_rating: rating, p_notes: text, p_loved: loved, p_disliked: disliked,
      p_vintage: vintage ? Number(vintage) : null, p_tasted_on: tastedOn || null, p_context: 'tasting',
    });
    setBusy(false);
    if (error) { setMsg(error.message); return; }
    setMsg('Saved to your journal — your palate has been updated.');
    router.refresh();
  }

  const shown = hover ?? rating;
  const words = ['', 'Not for me', 'Disappointing', 'Pleasant', 'Admirable', 'Very good', 'Excellent', 'Outstanding', 'Superb', 'Sublime', 'Unforgettable'];
  return (
    <div className="card card-pad stack" style={{ ['--gap' as string]: '16px' }}>
      <div>
        <div className="eyebrow">{existing ? 'Your tasting note' : 'Tasted it? Rate it'}</div>
        <div className="row" style={{ marginTop: 8, gap: 14 }}>
          <div className="stars" onMouseLeave={() => setHover(null)} role="radiogroup" aria-label="Rating">
            {[1, 2, 3, 4, 5].map((i) => {
              const fill = Math.max(0, Math.min(1, shown - (i - 1)));
              return (
                <span key={i} className="star" style={{ position: 'relative', width: 26, height: 26, display: 'inline-block' }}>
                  <span style={{ position: 'absolute', inset: 0, color: 'var(--rule-strong)' }}><StarIcon /></span>
                  <span style={{ position: 'absolute', inset: 0, color: 'var(--wine)', clipPath: `inset(0 ${100 - fill * 100}% 0 0)` }}><StarIcon /></span>
                  <button type="button" aria-label={`${i - 0.5} stars`} onMouseEnter={() => setHover(i - 0.5)} onFocus={() => setHover(i - 0.5)} onClick={() => setRating(i - 0.5)}
                    style={{ position: 'absolute', left: 0, top: 0, width: '50%', height: '100%', opacity: 0, cursor: 'pointer', padding: 0 }} />
                  <button type="button" aria-label={`${i} stars`} onMouseEnter={() => setHover(i)} onFocus={() => setHover(i)} onClick={() => setRating(i)}
                    style={{ position: 'absolute', right: 0, top: 0, width: '50%', height: '100%', opacity: 0, cursor: 'pointer', padding: 0 }} />
                </span>
              );
            })}
          </div>
          <span className="italic muted">{shown ? `${shown} — ${words[Math.round(shown * 2)]}` : 'Tap to rate'}</span>
        </div>
      </div>
      {notes.length > 0 && (
        <div>
          <div className="label" style={{ marginBottom: 6 }}>What did you notice? <span className="faint" style={{ textTransform: 'none', letterSpacing: 0, fontWeight: 400 }}>tap once to love, twice to dislike</span></div>
          <div className="chips">
            {notes.map((n) => (
              <button key={n.key} type="button" className={`chip ${loved.includes(n.key) ? 'chip-love' : disliked.includes(n.key) ? 'chip-avoid' : ''}`} onClick={() => cycleNote(n.key)}>
                {loved.includes(n.key) ? '♥ ' : disliked.includes(n.key) ? '✕ ' : ''}{n.label}
              </button>
            ))}
          </div>
        </div>
      )}
      <div className="field">
        <label htmlFor="rnotes">Notes</label>
        <textarea id="rnotes" className="textarea" value={text} onChange={(e) => setText(e.target.value)} placeholder="Where, with whom, what it was like…" />
      </div>
      <div className="row" style={{ gap: 12 }}>
        <div className="field" style={{ flex: 1 }}><label htmlFor="rv">Vintage</label><input id="rv" className="input" inputMode="numeric" value={vintage} onChange={(e) => setVintage(e.target.value.replace(/\D/g, '').slice(0, 4))} placeholder="e.g. 2019" /></div>
        <div className="field" style={{ flex: 1 }}><label htmlFor="rd">Tasted on</label><input id="rd" className="input" type="date" value={tastedOn ?? ''} onChange={(e) => setTastedOn(e.target.value)} /></div>
      </div>
      <div className="row between">
        <button className="btn btn-wine" disabled={busy} onClick={save}>{busy ? 'Saving…' : existing ? 'Update rating' : 'Save to journal'}</button>
        {msg && <span className="faint" style={{ fontSize: '.85rem' }}>{msg}</span>}
      </div>
    </div>
  );
}
