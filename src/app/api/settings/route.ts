import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { readSettings, writeSettings } from '@/lib/session';
import { fail, fromValidation, ok, withOwner } from '@/lib/http';
import { settingsSchema } from '@/lib/validation';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** Reads the assay configuration this session applies to every new record. */
export async function GET(request: Request): Promise<NextResponse> {
  return withOwner(request, async (ownerId) => {
    await getDb();
    return ok(await readSettings(ownerId));
  });
}

/** Persists the assay configuration. */
export async function PUT(request: Request): Promise<NextResponse> {
  return withOwner(request, async (ownerId) => {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return fail(400, 'invalid-json', 'The request body was not valid JSON.');
    }

    const parsed = settingsSchema.safeParse(body);
    if (!parsed.success) return fromValidation(parsed.error);

    await getDb();
    return ok(await writeSettings(ownerId, parsed.data));
  });
}