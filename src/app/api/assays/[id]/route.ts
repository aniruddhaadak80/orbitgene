import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getAssay, listAudit } from '@/lib/repo/assays';
import { patchAssay, retire } from '@/lib/services/assays';
import { fail, fromValidation, ok, withOwner } from '@/lib/http';
import { deleteAssaySchema, updateAssaySchema } from '@/lib/validation';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type Context = { params: Promise<{ id: string }> };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export async function GET(request: Request, context: Context): Promise<NextResponse> {
  const { id } = await context.params;
  if (!UUID.test(id)) return fail(400, 'invalid-id', 'The assay id is not a UUID.');

  return withOwner(request, async (ownerId) => {
    const db = await getDb();
    const assay = await getAssay(db, ownerId, id);
    if (!assay) {
      // Another session's record is reported exactly like a missing one, so ids
      // cannot be probed for existence.
      return fail(404, 'not-found', 'No assay with that id exists in this session.');
    }
    return ok({ assay, events: await listAudit(db, id) });
  });
}

export async function PATCH(request: Request, context: Context): Promise<NextResponse> {
  const { id } = await context.params;
  if (!UUID.test(id)) return fail(400, 'invalid-id', 'The assay id is not a UUID.');

  return withOwner(request, async (ownerId) => {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return fail(400, 'invalid-json', 'The request body was not valid JSON.');
    }

    const parsed = updateAssaySchema.safeParse(body);
    if (!parsed.success) return fromValidation(parsed.error);

    const db = await getDb();
    const result = await patchAssay(db, ownerId, id, parsed.data, new Date().toISOString(), 'session');

    if (result.status === 'error') {
      return result.code === 'not-found'
        ? fail(404, 'not-found', result.message)
        : fail(409, result.code, result.message);
    }
    return ok({ assay: result.assay });
  });
}

/**
 * Retires a record.
 *
 * The caller must echo the record's current terminal seal and confirm. The row
 * and its audit chain are retained as a tombstone so replay still works
 * afterwards, and a mismatched seal is refused rather than deleting the wrong
 * thing.
 */
export async function DELETE(request: Request, context: Context): Promise<NextResponse> {
  const { id } = await context.params;
  if (!UUID.test(id)) return fail(400, 'invalid-id', 'The assay id is not a UUID.');

  return withOwner(request, async (ownerId) => {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return fail(400, 'confirmation-required', 'A destructive request must supply the record seal and confirm:true.');
    }

    const parsed = deleteAssaySchema.safeParse(body);
    if (!parsed.success) {
      return fail(
        400,
        'confirmation-required',
        'A destructive request must supply the record seal and confirm:true.',
      );
    }

    const db = await getDb();
    const result = await retire(db, ownerId, id, parsed.data.seal, new Date().toISOString(), 'session');

    if (result.status === 'error') {
      if (result.code === 'not-found') return fail(404, 'not-found', result.message);
      if (result.code === 'seal-mismatch') {
        return fail(409, 'seal-mismatch', result.message, { expectedSeal: result.expectedSeal ?? '' });
      }
      return fail(409, result.code, result.message);
    }

    return ok({
      retired: result.assay.id,
      tombstone: true,
      seal: result.assay.seal,
      deletedAt: result.assay.deletedAt,
    });
  });
}