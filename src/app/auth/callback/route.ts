import { NextResponse, type NextRequest } from 'next/server';
import { supabaseServer } from '@/lib/supabase/server';

// Only same-origin paths: "//host" and "/\host" would resolve to another site.
function safePath(next: string | null) {
  return next && next.startsWith('/') && !next.startsWith('//') && !next.startsWith('/\\') ? next : '/for-you';
}

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const next = safePath(url.searchParams.get('next'));
  // OAuth providers report a declined or failed sign-in as ?error=…&error_description=…
  let error = url.searchParams.get('error_description') ?? url.searchParams.get('error');
  if (code && !error) {
    const sb = await supabaseServer();
    const res = await sb.auth.exchangeCodeForSession(code);
    if (res.error) error = res.error.message;
  }
  if (error) {
    const login = new URL('/login', url.origin);
    login.searchParams.set('next', next);
    login.searchParams.set('error', error);
    return NextResponse.redirect(login);
  }
  return NextResponse.redirect(new URL(next, url.origin));
}
