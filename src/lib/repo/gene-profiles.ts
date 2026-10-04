import type { Db } from '../db/client';
import type { GeneProfile } from '../types';

/**
 * Persistent cache of resolved gene profiles.
 *
 * Resolving a gene is genuinely expensive: UniProt, then a scan of up to ten
 * candidate transcripts, each one a GenBank round trip, accepted only when the
 * CDS translates to the UniProt protein exactly. That is fifteen to twenty
 * seconds of upstream calls for one BRCA1 request.
 *
 * An in-process cache is not enough, because a serverless platform starts from
 * a cold instance constantly and then pays that cost on the visitor's first
 * request, which is also the request most likely to exceed a function timeout.
 * Keeping the resolved profile in Postgres makes every request after the first
 * one sub-second, and keeps repeated visitors from burning upstream quota.
 *
 * The cached `fetchedAt` is the original retrieval time and is carried through
 * to the source strip, so a cached answer still shows when it was retrieved
 * rather than pretending to be fresh.
 */

export async function readCachedProfile(
  db: Db,
  accession: string,
): Promise<{ profile: GeneProfile; resolvedAt: string } | null> {
  const rows = await db.query<{ payload: GeneProfile; resolved_at: string | Date }>(
    `select payload, resolved_at from gene_profiles where accession = $1`,
    [accession],
  );
  const row = rows[0];
  if (!row?.payload) return null;
  return {
    profile: row.payload,
    resolvedAt: row.resolved_at instanceof Date ? row.resolved_at.toISOString() : String(row.resolved_at),
  };
}

export async function writeCachedProfile(db: Db, accession: string, profile: GeneProfile): Promise<void> {
  await db.query(
    `insert into gene_profiles (accession, payload, resolved_at)
     values ($1, $2::jsonb, now())
     on conflict (accession) do update
       set payload = excluded.payload,
           resolved_at = excluded.resolved_at`,
    [accession, JSON.stringify(profile)],
  );
}

/**
 * Clears one cached profile so the next request re-resolves it upstream.
 * Used by the "re-fetch live entry" control, which is why it is a delete rather
 * than an overwrite: overwriting would require resolving first, which is the
 * slow thing the caller is trying to escape.
 */
export async function invalidateCachedProfile(db: Db, accession: string): Promise<void> {
  await db.query(`delete from gene_profiles where accession = $1`, [accession]);
}