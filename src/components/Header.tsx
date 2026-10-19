'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { LogoMark } from './Logo';
import { ThemeToggle } from './ThemeToggle';

const LINKS_IN = [
  { href: '/for-you', label: 'For You' },
  { href: '/cellar', label: 'The Cellar' },
  { href: '/palate', label: 'My Palate' },
  { href: '/journal', label: 'Journal' },
  { href: '/lexicon', label: 'Lexicon' },
];
const LINKS_OUT = [
  { href: '/cellar', label: 'The Cellar' },
  { href: '/lexicon', label: 'Lexicon' },
  { href: '/#method', label: 'The Method' },
];

export function Header({ signedIn }: { signedIn: boolean }) {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const links = signedIn ? LINKS_IN : LINKS_OUT;
  return (
    <header className="site-header">
      <div className="container inner">
        <Link href={signedIn ? '/for-you' : '/'} className="brand" aria-label="Wine Wizard home">
          <LogoMark />
          <span className="word">Wine <i>Wizard</i></span>
        </Link>
        <nav className="nav" data-open={open} onClick={() => setOpen(false)}>
          {links.map((l) => (
            <Link key={l.href} href={l.href} aria-current={path === l.href || path.startsWith(l.href + '/') ? 'page' : undefined}>
              {l.label}
            </Link>
          ))}
        </nav>
        <div className="header-actions">
          <ThemeToggle />
          {signedIn ? (
            <form action="/auth/signout" method="post">
              <button className="btn btn-ghost btn-sm" type="submit">Sign out</button>
            </form>
          ) : (
            <>
              <Link href="/login" className="btn btn-ghost btn-sm">Sign in</Link>
              <Link href="/signup" className="btn btn-sm">Join</Link>
            </>
          )}
          <button className="btn btn-ghost btn-icon menu-toggle" aria-label="Menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M4 7h16M4 12h16M4 17h16" /></svg>
          </button>
        </div>
      </div>
    </header>
  );
}
