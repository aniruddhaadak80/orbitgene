import { NextResponse } from 'next/server';
import { randomBytes } from 'node:crypto';
import { getDb } from '@/lib/db';
import { share } from '@/lib/services/assays';
import { fail, fromValidation, ok, withOwner } from '@/lib/http';
import { shareSchema } from '@/lib/validation';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** Mints an unguessable 128-bit share token for one record. */
export async function POST(request: Request): Promise<NextResponse> {
  return withOwner(request, async (ownerId) => {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return fail(400, 'invalid-json', 'The request body was not valid JSON.');
    }

    const parsed = shareSchema.safeParse(body);
    if (!parsed.success) return fromValidation(parsed.error);

    const db = await getDb();
    const token = randomBytes(16).toString('hex');
    const result = await share(db, ownerId, parsed.data.assayId, token, new Date().toISOString());

    if (result.status === 'error') return fail(404, 'not-found', result.message);
    return ok({ token, path: `/s/${token}` }, { status: 201 });
  });
}