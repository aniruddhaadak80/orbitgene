import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { listAssays } from '@/lib/repo/assays';
import { createAssayRecord } from '@/lib/services/assays';
import { readSettings } from '@/lib/session';
import { fail, fromValidation, ok, withOwner } from '@/lib/http';
import { createAssaySchema, listQuerySchema } from '@/lib/validation';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Lists the current session's plate.
 *
 * Filters and pagination live in the query string, so a link to a filtered plate
 * survives a refresh and can be handed to a colleague.
 */
export async function GET(request: Request): Promise<NextResponse> {
  return withOwner(request, async (ownerId) => {
    const url = new URL(request.url);
    const parsed = listQuerySchema.safeParse({
      status: url.searchParams.get('status') ?? undefined,
      gene: url.searchParams.get('gene') ?? undefined,
      q: url.searchParams.get('q') ?? undefined,
      limit: url.searchParams.get('limit') ?? undefined,
      offset: url.searchParams.get('offset') ?? undefined,
    });
    if (!parsed.success) return fromValidation(parsed.error);

    const db = await getDb();
    return ok(await listAssays(db, ownerId, parsed.data));
  });
}

/**
 * Creates a scored plate record and its first sealed audit event.
 *
 * Repeating a request with the same `idempotencyKey` returns the original record
 * with `replayed: true` instead of creating a duplicate, so an agent can retry
 * safely.
 */
export async function POST(request: Request): Promise<NextResponse> {
  return withOwner(request, async (ownerId) => {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return fail(400, 'invalid-json', 'The request body was not valid JSON.');
    }

    const parsed = createAssaySchema.safeParse(body);
    if (!parsed.success) return fromValidation(parsed.error);

    const db = await getDb();
    const settings = await readSettings(ownerId);
    const result = await createAssayRecord(db, ownerId, parsed.data, new Date().toISOString(), settings);

    if (result.status === 'error') {
      return result.code === 'not-scorable'
        ? fail(422, 'not-scorable', result.message)
        : fail(409, result.code, result.message);
    }

    return ok(
      { assay: result.assay, replayed: result.status === 'replayed' },
      { status: result.status === 'replayed' ? 200 : 201 },
    );
  });
}