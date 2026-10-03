import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { fetchReplay } from '@/lib/services/assays';
import { fail, ok, withOwner } from '@/lib/http';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type Context = { params: Promise<{ id: string }> };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * Recomputes a record's hash chain from its genesis value and reports the first
 * event whose seal does not verify. A broken link is a finding rather than a
 * failure, so the endpoint answers 200 with `report.ok === false`.
 */
export async function GET(request: Request, context: Context): Promise<NextResponse> {
  const { id } = await context.params;
  if (!UUID.test(id)) return fail(400, 'invalid-id', 'The assay id is not a UUID.');

  return withOwner(request, async (ownerId) => {
    const db = await getDb();
    const { report, assay } = await fetchReplay(db, ownerId, id);
    if (!report.owned) {
      return fail(404, 'not-found', 'No assay with that id exists in this session.');
    }
    return ok({
      report,
      tombstone: assay?.deletedAt ? { deletedAt: assay.deletedAt } : null,
    });
  });
}