'use client';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { TYPES, TYPE_LABEL } from '@/lib/format';
import { TypeDot } from './WineBits';

export function Filters({ countries, showSort = false }: { countries: string[]; showSort?: boolean }) {
  const router = useRouter();
  const path = usePathname();
  const params = useSearchParams();
  const set = (k: string, v: string | null) => {
    const p = new URLSearchParams(params.toString());
    if (v === null || v === '') p.delete(k); else p.set(k, v);
    p.delete('page');
    router.replace(`${path}?${p.toString()}`, { scroll: false });
  };
  const type = params.get('type');
  return (
    <div className="toolbar">
      <div className="field" style={{ flex: '1 1 420px' }}>
        <span className="label">Style</span>
        <div className="pills">
          <button className="pill" aria-pressed={!type} onClick={() => set('type', null)}>All</button>
          {TYPES.map((t) => (
            <button key={t} className="pill" aria-pressed={type === t} onClick={() => set('type', type === t ? null : t)}>
              <TypeDot type={t} />{TYPE_LABEL[t]}
            </button>
          ))}
        </div>
      </div>
      <div className="field">
        <label htmlFor="f-country">Country</label>
        <select id="f-country" className="select" value={params.get('country') ?? ''} onChange={(e) => set('country', e.target.value)}>
          <option value="">Anywhere</option>
          {countries.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>
      <div className="field">
        <label htmlFor="f-price">Up to</label>
        <select id="f-price" className="select" value={params.get('max') ?? ''} onChange={(e) => set('max', e.target.value)}>
          <option value="">Any price</option>
          {[20, 30, 50, 75, 100, 200].map((p) => <option key={p} value={p}>${p}</option>)}
        </select>
      </div>
      {showSort && (
        <div className="field">
          <label htmlFor="f-sort">Order</label>
          <select id="f-sort" className="select" value={params.get('sort') ?? 'popular'} onChange={(e) => set('sort', e.target.value)}>
            <option value="popular">Most rated</option>
            <option value="producer">Producer A–Z</option>
            <option value="price_asc">Price, low to high</option>
            <option value="price_desc">Price, high to low</option>
            <option value="region">Region</option>
          </select>
        </div>
      )}
    </div>
  );
}
