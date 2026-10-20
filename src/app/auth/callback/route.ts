import { NextResponse, type NextRequest } from 'next/server';
import { supabaseServer } from '@/lib/supabase/server';

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const next = url.searchParams.get('next') ?? '/for-you';
  const authError = url.searchParams.get('error_description');

  let failed = authError;
  if (!failed && code) {
    const sb = await supabaseServer();
    const { error } = await sb.auth.exchangeCodeForSession(code);
    // The usual cause is opening the link in a different browser from the one that signed up
    // (the PKCE verifier cookie lives there). The email is still confirmed, so password sign-in works.
    if (error) failed = 'Your email is confirmed, but we couldn’t sign you in from that link. Please sign in below.';
  }
  if (failed || !code) {
    const login = new URL('/login', url.origin);
    login.searchParams.set('error', failed ?? 'That sign-in link is missing its code. Please sign in below.');
    return NextResponse.redirect(login);
  }
  return NextResponse.redirect(new URL(next.startsWith('/') && !next.startsWith('//') ? next : '/for-you', url.origin));
}
