import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { decide } from '@/lib/services/assays';
import { fail, fromValidation, ok, withOwner } from '@/lib/http';
import { decisionSchema } from '@/lib/validation';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type Context = { params: Promise<{ id: string }> };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Records a signed-off verdict against a plate record and extends its chain. */
export async function POST(request: Request, context: Context): Promise<NextResponse> {
  const { id } = await context.params;
  if (!UUID.test(id)) return fail(400, 'invalid-id', 'The assay id is not a UUID.');

  return withOwner(request, async (ownerId) => {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return fail(400, 'invalid-json', 'The request body was not valid JSON.');
    }

    const parsed = decisionSchema.safeParse(body);
    if (!parsed.success) return fromValidation(parsed.error);

    const db = await getDb();
    const result = await decide(
      db,
      ownerId,
      id,
      parsed.data.verdict,
      parsed.data.rationale,
      new Date().toISOString(),
      'session',
    );

    if (result.status === 'error') {
      return result.code === 'not-found'
        ? fail(404, 'not-found', result.message)
        : fail(409, result.code, result.message);
    }
    return ok({ assay: result.assay, seal: result.assay.seal });
  });
}