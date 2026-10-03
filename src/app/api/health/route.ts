import { NextResponse } from 'next/server';
import { getDb, LATEST_MIGRATION } from '@/lib/db';
import { countOwned } from '@/lib/repo/assays';
import { withOwner } from '@/lib/http';
import type { HealthReport } from '@/lib/types';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Health check that actually exercises the persistence path.
 *
 * It round-trips a real `SELECT 1`, reads row counts and reports which adapter
 * answered. A static `{ ok: true }` would pass while the database was
 * unreachable, which is exactly the failure this endpoint exists to catch.
 *
 * `durable` is false whenever the embedded adapter is in play, so an ephemeral
 * serverless filesystem can never be mistaken for a real store; `/verify:live`
 * asserts this is true on production.
 */
export async function GET(request: Request): Promise<NextResponse> {
  return withOwner(request, async (ownerId) => {
    const started = Date.now();
    let report: HealthReport;

    try {
      const db = await getDb();

      const probe = await db.query<{ ok: number }>('select 1 as ok');
      if (Number(probe[0]?.ok) !== 1) {
        throw new Error('persistence probe did not return 1');
      }

      const owned = await countOwned(db, ownerId);
      const catalog = await db.query<{ n: number }>(
        'select count(*)::bigint as n from gene_catalog',
      );

      report = {
        status: 'ok',
        store: db.kind,
        durable: db.kind === 'neon-postgres',
        latencyMs: Date.now() - started,
        migration: LATEST_MIGRATION,
        counts: { ...owned, catalog: Number(catalog[0]?.n ?? 0) },
        checkedAt: new Date().toISOString(),
      };
    } catch (error) {
      // Never returned to the browser; logged so a store failure is diagnosable
      // from the deployment logs instead of surfacing as a bare 503.
      console.error('[orbitgene] persistence probe failed:', error);
      report = {
        status: 'degraded',
        store: 'unavailable',
        durable: false,
        latencyMs: Date.now() - started,
        migration: LATEST_MIGRATION,
        counts: {},
        checkedAt: new Date().toISOString(),
      };
    }

    return NextResponse.json(report, {
      status: report.status === 'ok' ? 200 : 503,
      headers: { 'cache-control': 'no-store' },
    });
  });
}