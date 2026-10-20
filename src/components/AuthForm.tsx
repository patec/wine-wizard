'use client';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { supabaseBrowser } from '@/lib/supabase/client';

export function AuthForm({ mode }: { mode: 'login' | 'signup' }) {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get('next') || (mode === 'signup' ? '/onboarding' : '/for-you');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(params.get('error'));
  const [sent, setSent] = useState(false);

  async function google() {
    setBusy(true); setError(null);
    const { error } = await supabaseBrowser().auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}` },
    });
    // On success the browser is already navigating to Google.
    if (error) { setBusy(false); setError(error.message); }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    const sb = supabaseBrowser();
    if (mode === 'signup') {
      const { data, error } = await sb.auth.signUp({
        email, password,
        options: { data: { display_name: name }, emailRedirectTo: `${window.location.origin}/auth/callback?next=/onboarding` },
      });
      setBusy(false);
      if (error) return setError(error.message);
      if (!data.session) return setSent(true); // email confirmation required
      router.push('/onboarding'); router.refresh();
    } else {
      const { error } = await sb.auth.signInWithPassword({ email, password });
      setBusy(false);
      if (error) return setError(error.message);
      router.push(next); router.refresh();
    }
  }

  if (sent) {
    return (
      <div className="card card-pad auth-card fade-in">
        <div className="eyebrow">One more step</div>
        <h2 style={{ margin: '10px 0 12px' }}>Check your inbox</h2>
        <p className="muted">We sent a confirmation link to <b>{email}</b>. Open it and you’ll land straight in your palate quiz.</p>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="card card-pad auth-card stack fade-in" style={{ ['--gap' as string]: '18px' }}>
      <div>
        <div className="eyebrow">{mode === 'signup' ? 'Begin your cellar' : 'Welcome back'}</div>
        <h2 style={{ marginTop: 10 }}>{mode === 'signup' ? 'Create your account' : 'Sign in'}</h2>
      </div>
      <button type="button" className="btn btn-ghost" onClick={google} disabled={busy}>
        <GoogleMark /> Continue with Google
      </button>
      <div className="or-rule">or with email</div>
      {mode === 'signup' && (
        <div className="field">
          <label htmlFor="name">What should we call you?</label>
          <input id="name" className="input" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" placeholder="First name" />
        </div>
      )}
      <div className="field">
        <label htmlFor="email">Email</label>
        <input id="email" className="input" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
      </div>
      <div className="field">
        <label htmlFor="password">Password</label>
        <input id="password" className="input" type="password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={mode === 'signup' ? 'new-password' : 'current-password'} />
      </div>
      {error && <p className="error" role="alert">{error}</p>}
      <button className="btn btn-wine" disabled={busy}>{busy ? 'One moment…' : mode === 'signup' ? 'Create account' : 'Sign in'}</button>
      <p className="faint" style={{ fontSize: '.88rem', margin: 0 }}>
        {mode === 'signup' ? <>Already a member? <Link href="/login" className="btn-link">Sign in</Link></> : <>New here? <Link href="/signup" className="btn-link">Create an account</Link></>}
      </p>
    </form>
  );
}

function GoogleMark() {
  return (
    <svg width="16" height="16" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </svg>
  );
}
