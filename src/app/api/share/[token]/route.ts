import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { listAudit } from '@/lib/repo/assays';
import { readShare } from '@/lib/services/assays';
import { replay } from '@/lib/integrity';
import { fail, ok, withoutOwner } from '@/lib/http';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type Context = { params: Promise<{ token: string }> };

const TOKEN = /^[0-9a-f]{32}$/;

/**
 * Public, read-only view of a shared record.
 *
 * No owner cookie is required: the token is the capability. The full audit chain
 * is included and re-verified on read, so a recipient can confirm the record was
 * not edited after it was shared.
 */
export async function GET(_request: Request, context: Context): Promise<NextResponse> {
  const { token } = await context.params;
  if (!TOKEN.test(token)) return fail(400, 'invalid-token', 'That share link is malformed.');

  return withoutOwner(async () => {
    const db = await getDb();
    const found = await readShare(db, token);
    if (!found) return fail(404, 'not-found', 'That share link does not exist.');

    const events = await listAudit(db, found.assay.id);
    const report = replay(found.assay.id, events);

    return ok({
      assay: found.assay,
      sharedAt: found.share.createdAt,
      integrity: {
        ok: report.ok,
        length: report.length,
        genesis: report.genesis,
        head: report.head,
        brokenAt: report.brokenAt,
        brokenReason: report.brokenReason,
      },
      events,
    });
  });
}