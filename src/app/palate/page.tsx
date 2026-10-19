import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getUser } from '@/lib/supabase/server';
import { PalateRadar } from '@/components/Charts';
import { Dots, TypeDot } from '@/components/WineBits';
import { TYPES, TYPE_LABEL } from '@/lib/format';
import type { PalateSummary } from '@/lib/types';

export const metadata = { title: 'My palate' };
export const dynamic = 'force-dynamic';

const STRUCT_SHOWN = ['sweetness', 'acidity', 'tannin', 'body', 'oak_influence', 'maturity', 'alcohol', 'finish'];
const STRUCT_NAME: Record<string, string> = { oak_influence: 'Oak', maturity: 'Age', flavor_intensity: 'Intensity' };

export default async function Palate() {
  const { supabase: sb } = await getUser();
  const { data } = await sb.rpc('my_palate_summary');
  const p = data as PalateSummary | null;
  if (!p || (!p.quiz_completed && !p.rating_count)) redirect('/onboarding');

  const learnedShare = p.rating_count ? Math.round(100 * Math.min(1, (p.rating_count * 0.7) / (p.rating_count * 0.7 + 3))) : 0;
  const structure = p.structure.filter((s) => STRUCT_SHOWN.includes(s.key) && s.confidence > 0);

  return (
    <div className="container page">
      <header className="page-head">
        <div className="eyebrow">My palate</div>
        <h1 style={{ marginTop: 10 }}>{p.display_name ? `${p.display_name}’s palate` : 'Your palate'}, read by the engine</h1>
        <p className="lede">A living profile across {p.loved.length + p.avoided.length > 0 ? 'hundreds of' : ''} descriptors. It began with your quiz; each rating teaches it more.</p>
        <div className="row" style={{ gap: 40, marginTop: 24 }}>
          <div className="kpi"><b className="num">{p.rating_count}</b><span>Bottles rated</span></div>
          <div className="kpi"><b className="num">{learnedShare}%</b><span>Learned from ratings</span></div>
          <div className="kpi"><b className="num">{p.budget_max ? `$${p.budget_max}` : '—'}</b><span>Typical ceiling</span></div>
          <Link href="/onboarding" className="btn btn-ghost btn-sm" style={{ marginLeft: 'auto' }}>Retake the quiz</Link>
        </div>
      </header>

      <div className="two-col">
        <section>
          <div className="rule-title"><span className="eyebrow">Where your affinities lie</span></div>
          <div style={{ maxWidth: 440, margin: '0 auto' }}><PalateRadar axes={p.groups} /></div>

          <div className="rule-title" style={{ marginTop: 32 }}><span className="eyebrow">You gravitate toward</span></div>
          {p.loved.length ? (
            <div className="note-list">
              {p.loved.map((n) => (
                <div key={n.key} className="note-row">
                  <span>{n.label} <span className="faint" style={{ fontSize: '.75rem' }}>· {n.category_label}</span></span>
                  <span className="bar-track"><span className="bar-fill" style={{ width: `${Math.min(1, n.weight) * 100}%` }} /></span>
                </div>
              ))}
            </div>
          ) : <p className="muted">Rate a few bottles and your favourite notes will surface here.</p>}

          <div className="rule-title" style={{ marginTop: 32 }}><span className="eyebrow">You tend to avoid</span></div>
          {p.avoided.length ? (
            <div className="chips">{p.avoided.map((n) => <span key={n.key} className="chip chip-avoid">{n.label}</span>)}</div>
          ) : <p className="muted">Nothing yet — you’re an open-minded drinker.</p>}
        </section>

        <aside>
          <div className="rule-title"><span className="eyebrow">The shape you prefer</span></div>
          {structure.map((s) => (
            <div key={s.key} className="scale-row">
              <span className="name">{STRUCT_NAME[s.key] ?? s.label}</span>
              <Dots value={s.target} />
              <span className="word">{s.word}{s.confidence < 1 ? <span className="faint" style={{ fontSize: '.8rem' }}> · tentative</span> : null}</span>
            </div>
          ))}

          <div className="rule-title" style={{ marginTop: 36 }}><span className="eyebrow">Styles you pour</span></div>
          {TYPES.map((t) => {
            const v = p.styles[t] ?? 0;
            return (
              <div key={t} className="scale-row" style={{ gridTemplateColumns: '120px 1fr 60px' }}>
                <span className="name row" style={{ gap: 8 }}><TypeDot type={t} />{TYPE_LABEL[t]}</span>
                <span className="bar-track" style={{ height: 6 }}>
                  <span style={{ position: 'absolute', left: '50%', top: -3, bottom: -3, width: 1, background: 'var(--rule-strong)' }} />
                  <span className="bar-fill" style={{ left: v >= 0 ? '50%' : `${50 + v * 50}%`, width: `${Math.abs(v) * 50}%`, background: v >= 0 ? 'var(--wine)' : 'var(--ink-faint)' }} />
                </span>
                <span className="word" style={{ fontSize: '.9rem' }}>{v > 0.6 ? 'adore' : v > 0.15 ? 'enjoy' : v < -0.15 ? 'avoid' : 'open'}</span>
              </div>
            );
          })}

          <div className="notice" style={{ marginTop: 36 }}>
            <b>How this works.</b> Your palate is a signed weight on every descriptor. Each rating adds (rating − 3) × the wine’s intensity
            for every note it carries, so a 5-star Syrah lifts black pepper and violet while a 1½-star buttery Chardonnay pushes butter and
            vanilla down. Notes you tap as loved or disliked count extra. Your quiz acts like three opening ratings, then gracefully steps aside.
          </div>
        </aside>
      </div>
    </div>
  );
}
