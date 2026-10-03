import type { NextResponse } from 'next/server';
import { randomBytes, randomUUID } from 'node:crypto';
import { cookies } from 'next/headers';
import { getDb } from './db';
import { DEFAULT_FLIGHT, DEFAULT_INSTRUMENT, DEFAULT_PROBE } from './profiles';
import type { SessionSettings } from './types';

export const SESSION_COOKIE = 'orbitgene_sid';

/**
 * Anonymous ownership.
 *
 * ORBITGENE has no accounts. A visitor gets a 32-hex-character owner id held in
 * an HTTP-only cookie, minted in `src/proxy.ts` because `cookies().set()` is a
 * silent no-op inside Server Components. The id is unguessable, every query is
 * filtered by it, and destructive operations additionally require the record's
 * terminal seal, so one session can never read or remove another's plate.
 */
export function mintSessionId(): string {
  return randomBytes(16).toString('hex');
}

/** Reads the current owner id, or null when the request has no session yet. */
export async function currentOwnerId(): Promise<string | null> {
  const jar = await cookies();
  const value = jar.get(SESSION_COOKIE)?.value;
  if (!value) return null;
  return /^[0-9a-f]{32}$/.test(value) ? value : null;
}

export function defaultSettings(): SessionSettings {
  return {
    instrument: { ...DEFAULT_INSTRUMENT },
    flight: { ...DEFAULT_FLIGHT },
    probe: { ...DEFAULT_PROBE },
  };
}

export async function readSettings(ownerId: string): Promise<SessionSettings> {
  const db = await getDb();
  const rows = await db.query<{ settings: SessionSettings }>(
    `select settings from sessions where id = $1`,
    [ownerId],
  );
  const stored = rows[0]?.settings;
  if (!stored) return defaultSettings();

  // Merge over defaults so a settings payload written by an older build still
  // loads after new fields are added.
  return {
    instrument: { ...defaultSettings().instrument, ...(stored.instrument ?? {}) },
    flight: { ...defaultSettings().flight, ...(stored.flight ?? {}) },
    probe: { ...defaultSettings().probe, ...(stored.probe ?? {}) },
  };
}

export async function writeSettings(
  ownerId: string,
  settings: SessionSettings,
): Promise<SessionSettings> {
  const db = await getDb();
  await db.query(
    `insert into sessions (id, created_at, settings) values ($1, now(), $2)
     on conflict (id) do update set settings = excluded.settings`,
    [ownerId, settings],
  );
  return settings;
}

export function newIdempotencyKey(prefix: string): string {
  return `${prefix}-${randomUUID()}`;
}

/**
 * Resolves the owner for an API request.
 *
 * `src/proxy.ts` normally mints the cookie before any route runs, so this almost
 * always reads an existing session. It still mints one when the cookie is
 * missing so that a bare `curl` or an agent calling the MCP endpoint directly
 * gets a working, isolated session rather than a 401, and so that the cookie is
 * returned on the response.
 */
export async function resolveOwner(request: Request): Promise<{
  ownerId: string;
  minted: boolean;
}> {
  const header = request.headers.get('cookie') ?? '';
  const match = new RegExp(`${SESSION_COOKIE}=([0-9a-f]{32})`).exec(header);
  if (match) return { ownerId: match[1], minted: false };
  return { ownerId: mintSessionId(), minted: true };
}

/** Attaches a freshly minted session cookie to a response. */
export function attachSessionCookie<T extends NextResponse>(response: T, ownerId: string): T {
  response.cookies.set({
    name: SESSION_COOKIE,
    value: ownerId,
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 60 * 60 * 24 * 180,
  });
  return response;
}