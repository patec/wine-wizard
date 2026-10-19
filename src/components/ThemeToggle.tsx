'use client';
import { useEffect, useState } from 'react';

type Mode = 'light' | 'dark' | null;

export function ThemeToggle() {
  const [mode, setMode] = useState<Mode>(null);
  useEffect(() => {
    try { setMode((localStorage.getItem('ww-theme') as Mode) ?? null); } catch {}
  }, []);
  const next = () => {
    const sysDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    const current = mode ?? (sysDark ? 'dark' : 'light');
    const m: Mode = current === 'dark' ? 'light' : 'dark';
    setMode(m);
    document.documentElement.dataset.theme = m;
    try { localStorage.setItem('ww-theme', m); } catch {}
  };
  return (
    <button className="btn btn-ghost btn-icon" onClick={next} aria-label="Toggle light / cellar mode" title="Light / cellar mode">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
        <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z" />
      </svg>
    </button>
  );
}
