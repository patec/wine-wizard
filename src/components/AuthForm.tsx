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
