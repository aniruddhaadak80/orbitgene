import { NextResponse, type NextRequest } from 'next/server';
import { SESSION_COOKIE, mintSessionId } from '@/lib/session';

/**
 * Mints the anonymous owner cookie before any route runs.
 *
 * This has to happen here: `cookies().set()` is a no-op inside Server
 * Components, so a session created during a server render is discarded and every
 * request would arrive with a fresh id and nothing would persist. Route Handlers
 * and Server Actions can set cookies, but they cannot cover the reads.
 */
export function proxy(request: NextRequest): NextResponse {
  const existing = request.cookies.get(SESSION_COOKIE)?.value;
  if (existing && /^[0-9a-f]{32}$/.test(existing)) {
    return NextResponse.next();
  }

  const id = mintSessionId();
  const response = NextResponse.next();
  response.cookies.set({
    name: SESSION_COOKIE,
    value: id,
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 60 * 60 * 24 * 180,
  });
  return response;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|webp|ico)$).*)'],
};