import { computeSeal, GENESIS } from '../integrity';
import type { Db } from '../db/client';
import type {
  AssayDecision,
  AssayRecord,
  AssayStatus,
  AuditAction,
  AuditEvent,
  Consequence,
  EngineResult,
  SealedResult,
  ShareLink,
  Verdict,
} from '../types';

export interface ListQueryLike {
  status?: AssayStatus;
  gene?: string;
  q?: string;
  limit: number;
  offset: number;
}

interface AssayRow {
  id: string;
  owner_id: string;
  well: string;
  gene_symbol: string;
  uniprot_accession: string;
  refseq_mrna: string;
  protein_position: number;
  ref_aa: string;
  alt_aa: string;
  hgvs_p: string;
  hgvs_c: string;
  consequence: string;
  probe_sequence: string;
  instrument_id: string;
  flight_profile_id: string;
  notes: string;
  status: string;
  score: number | string;
  verdict: string;
  decision: AssayDecision | null;
  result: EngineResult;
  created_at: string | Date;
  updated_at: string | Date;
  deleted_at: string | Date | null;
  seal: string;
}

function iso(value: string | Date | null): string {
  if (value === null) return '';
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

export function rowToAssay(row: AssayRow): AssayRecord {
  return {
    id: row.id,
    well: row.well,
    ownerId: row.owner_id,
    geneSymbol: row.gene_symbol,
    uniprotAccession: row.uniprot_accession,
    refseqMrna: row.refseq_mrna,
    proteinPosition: Number(row.protein_position),
    refAa: row.ref_aa,
    altAa: row.alt_aa,
    hgvsP: row.hgvs_p,
    hgvsC: row.hgvs_c,
    consequence: row.consequence as Consequence,
    probeSequence: row.probe_sequence,
    instrumentId: row.instrument_id,
    flightProfileId: row.flight_profile_id,
    notes: row.notes ?? '',
    status: row.status as AssayStatus,
    score: Number(row.score),
    verdict: row.verdict as Verdict,
    decision: row.decision ?? null,
    result: row.result,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
    deletedAt: row.deleted_at ? iso(row.deleted_at) : null,
    seal: row.seal,
  };
}

const COLUMN_NAMES = [
  'id',
  'owner_id',
  'well',
  'gene_symbol',
  'uniprot_accession',
  'refseq_mrna',
  'protein_position',
  'ref_aa',
  'alt_aa',
  'hgvs_p',
  'hgvs_c',
  'consequence',
  'probe_sequence',
  'instrument_id',
  'flight_profile_id',
  'notes',
  'status',
  'score',
  'verdict',
  'decision',
  'result',
  'created_at',
  'updated_at',
  'deleted_at',
  'seal',
] as const;

/** For `insert ... returning`, where the target columns are unqualified. */
const COLUMNS = COLUMN_NAMES.join(', ');

/**
 * For `update ... from next_event returning ...`.
 *
 * `next_event` also exposes `seal`, so an unqualified `returning seal` is
 * ambiguous and Postgres rejects the whole statement. Qualifying against the
 * updated table keeps the append-only event as the single source of the new
 * seal rather than silently reading the stale one.
 */
const COLUMNS_FROM = COLUMN_NAMES.map((name) => `assays.${name}`).join(', ');

export interface NewAssay {
  id: string;
  ownerId: string;
  well: string;
  geneSymbol: string;
  uniprotAccession: string;
  refseqMrna: string;
  proteinPosition: number;
  refAa: string;
  altAa: string;
  hgvsP: string;
  hgvsC: string;
  consequence: Consequence;
  probeSequence: string;
  instrumentId: string;
  flightProfileId: string;
  notes: string;
  score: number;
  verdict: Verdict;
  result: SealedResult;
  idempotencyKey: string | null;
  now: string;
}

export type CreateOutcome =
  | { status: 'created'; assay: AssayRecord }
  | { status: 'replayed'; assay: AssayRecord };

/**
 * Creates a record and its first audit event in one statement.
 *
 * A data-modifying CTE keeps both inserts in a single Postgres statement, so a
 * record can never exist without the seal event that explains it, and the seal
 * can never exist without the record it describes. There is no window in which a
 * failure leaves a half-written plate entry.
 */
export async function createAssay(db: Db, input: NewAssay): Promise<CreateOutcome> {
  if (input.idempotencyKey) {
    const existing = await db.query<AssayRow>(
      `select ${COLUMNS} from assays where owner_id = $1 and idempotency_key = $2`,
      [input.ownerId, input.idempotencyKey],
    );
    if (existing.length > 0) {
      return { status: 'replayed', assay: rowToAssay(existing[0]) };
    }
  }

  const event = {
    seq: 1,
    entityId: input.id,
    action: 'created' as AuditAction,
    at: input.now,
    actor: 'session' as const,
    detail: {
      gene: input.geneSymbol,
      accession: input.uniprotAccession,
      change: input.hgvsP,
      hgvsC: input.hgvsC,
      well: input.well,
      verdict: input.verdict,
      score: input.score,
      engine: input.result.engine,
      inputDigest: input.result.inputDigest,
    },
  };
  const seal = computeSeal(GENESIS, event);

  const rows = await db.query<AssayRow>(
    `with first_event as (
       insert into audit_events (entity_id, seq, action, at, actor, detail, prev_seal, seal)
       values ($1, $2, $3, $4, $5, $6::jsonb, $7, $8)
       returning seal
     )
     insert into assays (
       id, owner_id, well, gene_symbol, uniprot_accession, refseq_mrna, protein_position,
       ref_aa, alt_aa, hgvs_p, hgvs_c, consequence, probe_sequence, instrument_id,
       flight_profile_id, notes, status, score, verdict, decision, result, idempotency_key,
       created_at, updated_at, deleted_at, seal
     )
     select $1, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23,
            'scored', $24, $25, null, $26::jsonb, $27, $28, $28, null, first_event.seal
from first_event
      returning ${COLUMNS}`,
    [
      input.id,
      event.seq,
      event.action,
      event.at,
      event.actor,
      JSON.stringify(event.detail),
      GENESIS,
      seal,
      input.ownerId,
      input.well,
      input.geneSymbol,
      input.uniprotAccession,
      input.refseqMrna,
      input.proteinPosition,
      input.refAa,
      input.altAa,
      input.hgvsP,
      input.hgvsC,
      input.consequence,
      input.probeSequence,
      input.instrumentId,
      input.flightProfileId,
      input.notes,
      input.score,
      input.verdict,
      JSON.stringify(input.result),
      input.idempotencyKey,
      input.now,
    ],
  );

  return { status: 'created', assay: rowToAssay(rows[0]) };
}

export interface ListResult {
  items: AssayRecord[];
  total: number;
  limit: number;
  offset: number;
}

export async function listAssays(
  db: Db,
  ownerId: string,
  query: ListQueryLike,
): Promise<ListResult> {
  const filters: string[] = ['owner_id = $1', 'deleted_at is null'];
  const params: unknown[] = [ownerId];

  if (query.status) {
    params.push(query.status);
    filters.push(`status = $${params.length}`);
  }
  if (query.gene) {
    params.push(query.gene.toLowerCase());
    filters.push(`lower(gene_symbol) = $${params.length}`);
  }
  if (query.q) {
    params.push(`%${query.q.toLowerCase()}%`);
    filters.push(
      `(lower(gene_symbol) like $${params.length} or lower(hgvs_p) like $${params.length} or lower(notes) like $${params.length})`,
    );
  }

  const where = filters.join(' and ');
  const countRows = await db.query<{ count: number }>(
    `select count(*)::bigint as count from assays where ${where}`,
    params,
  );

  params.push(query.limit, query.offset);
  const rows = await db.query<AssayRow>(
    `select ${COLUMNS} from assays where ${where}
     order by created_at desc, well asc
     limit $${params.length - 1} offset $${params.length}`,
    params,
  );

  return {
    items: rows.map(rowToAssay),
    total: Number(countRows[0]?.count ?? 0),
    limit: query.limit,
    offset: query.offset,
  };
}

/** Live records only. A tombstoned record resolves to null, never to a partial. */
export async function getAssay(
  db: Db,
  ownerId: string,
  id: string,
): Promise<AssayRecord | null> {
  const rows = await db.query<AssayRow>(
    `select ${COLUMNS} from assays
     where id = $1 and owner_id = $2 and deleted_at is null`,
    [id, ownerId],
  );
  return rows.length > 0 ? rowToAssay(rows[0]) : null;
}

export async function getAssayAnyState(
  db: Db,
  ownerId: string,
  id: string,
): Promise<AssayRecord | null> {
  const rows = await db.query<AssayRow>(
    `select ${COLUMNS} from assays where id = $1 and owner_id = $2`,
    [id, ownerId],
  );
  return rows.length > 0 ? rowToAssay(rows[0]) : null;
}

async function head(db: Db, entityId: string): Promise<{ seq: number; seal: string }> {
  const rows = await db.query<{ seq: number; seal: string }>(
    `select seq, seal from audit_events where entity_id = $1 order by seq desc limit 1`,
    [entityId],
  );
  if (rows.length === 0) return { seq: 0, seal: GENESIS };
  return { seq: Number(rows[0].seq), seal: rows[0].seal };
}

export interface PatchInput {
  well?: string;
  status?: AssayStatus;
  notes?: string;
  instrumentId?: string;
  flightProfileId?: string;
}

export async function updateAssay(
  db: Db,
  ownerId: string,
  id: string,
  patch: PatchInput,
  now: string,
  actor: 'session' | 'agent',
): Promise<{ assay: AssayRecord } | { conflict: string }> {
  const current = await getAssay(db, ownerId, id);
  if (!current) return { conflict: 'not-found' };

  const next: AssayRecord = {
    ...current,
    well: patch.well ?? current.well,
    status: patch.status ?? current.status,
    notes: patch.notes ?? current.notes,
    instrumentId: patch.instrumentId ?? current.instrumentId,
    flightProfileId: patch.flightProfileId ?? current.flightProfileId,
    updatedAt: now,
  };

  const state = await head(db, id);
  const event = {
    seq: state.seq + 1,
    entityId: id,
    action: 'updated' as AuditAction,
    at: now,
    actor,
    detail: {
      well: next.well,
      status: next.status,
      notes: next.notes,
      instrumentId: next.instrumentId,
      flightProfileId: next.flightProfileId,
    },
  };
  const seal = computeSeal(state.seal, event);

  const rows = await db.query<AssayRow>(
    `with next_event as (
       insert into audit_events (entity_id, seq, action, at, actor, detail, prev_seal, seal)
       values ($1, $2, $3, $4, $5, $6::jsonb, $7, $8)
       returning seal
     )
     update assays set
       well = $9, status = $10, notes = $11, instrument_id = $12,
       flight_profile_id = $13, updated_at = $14, seal = next_event.seal
     from next_event
     where id = $1 and owner_id = $15 and deleted_at is null
     returning ${COLUMNS_FROM}`,
    [
      id,
      event.seq,
      event.action,
      event.at,
      event.actor,
      JSON.stringify(event.detail),
      state.seal,
      seal,
      next.well,
      next.status,
      next.notes,
      next.instrumentId,
      next.flightProfileId,
      now,
      ownerId,
    ],
  );

  if (rows.length === 0) return { conflict: 'not-found' };
  return { assay: rowToAssay(rows[0]) };
}

export async function recordDecision(
  db: Db,
  ownerId: string,
  id: string,
  decision: AssayDecision,
  now: string,
  actor: 'session' | 'agent',
): Promise<{ assay: AssayRecord } | { conflict: string }> {
  const current = await getAssay(db, ownerId, id);
  if (!current) return { conflict: 'not-found' };

  const state = await head(db, id);
  const event = {
    seq: state.seq + 1,
    entityId: id,
    action: 'decided' as AuditAction,
    at: now,
    actor,
    detail: { verdict: decision.verdict, rationale: decision.rationale },
  };
  const seal = computeSeal(state.seal, event);

  const rows = await db.query<AssayRow>(
    `with next_event as (
       insert into audit_events (entity_id, seq, action, at, actor, detail, prev_seal, seal)
       values ($1, $2, $3, $4, $5, $6::jsonb, $7, $8)
       returning seal
     )
     update assays set
       decision = $9::jsonb,
       status = case when $10::text = 'GROUND-ONLY' then 'retired'::text else status end,
       updated_at = $11,
       seal = next_event.seal
     from next_event
     where id = $1 and owner_id = $12 and deleted_at is null
     returning ${COLUMNS_FROM}`,
    [
      id,
      event.seq,
      event.action,
      event.at,
      event.actor,
      JSON.stringify(event.detail),
      state.seal,
      seal,
      JSON.stringify(decision),
      decision.verdict,
      now,
      ownerId,
    ],
  );

  if (rows.length === 0) return { conflict: 'not-found' };
  return { assay: rowToAssay(rows[0]) };
}

/**
 * Retires a record. The row and its audit chain are kept as a tombstone so the
 * replay keeps working after a deletion, which is the whole point of an
 * append-only chain. A wrong seal is refused with a conflict rather than
 * deleting the wrong thing.
 */
export async function deleteAssay(
  db: Db,
  ownerId: string,
  id: string,
  expectedSeal: string,
  now: string,
  actor: 'session' | 'agent',
): Promise<{ assay: AssayRecord } | { conflict: string; expected?: string }> {
  const current = await getAssayAnyState(db, ownerId, id);
  if (!current) return { conflict: 'not-found' };
  if (current.deletedAt) return { conflict: 'already-deleted' };
  if (current.seal !== expectedSeal) {
    return { conflict: 'seal-mismatch', expected: current.seal };
  }

  const state = await head(db, id);
  const event = {
    seq: state.seq + 1,
    entityId: id,
    action: 'deleted' as AuditAction,
    at: now,
    actor,
    detail: { sealAtDeletion: current.seal, statusAtDeletion: current.status },
  };
  const seal = computeSeal(state.seal, event);

  const rows = await db.query<AssayRow>(
    `with next_event as (
       insert into audit_events (entity_id, seq, action, at, actor, detail, prev_seal, seal)
       values ($1, $2, $3, $4, $5, $6::jsonb, $7, $8)
       returning seal
     )
     update assays set
       deleted_at = $9, updated_at = $9, status = 'retired', seal = next_event.seal
     from next_event
     where id = $1 and owner_id = $10 and deleted_at is null
     returning ${COLUMNS_FROM}`,
    [
      id,
      event.seq,
      event.action,
      event.at,
      event.actor,
      JSON.stringify(event.detail),
      state.seal,
      seal,
      now,
      ownerId,
    ],
  );

  if (rows.length === 0) return { conflict: 'already-deleted' };
  return { assay: rowToAssay(rows[0]) };
}

export async function listAudit(db: Db, entityId: string): Promise<AuditEvent[]> {
  const rows = await db.query<{
    seq: number;
    entity_id: string;
    action: string;
    at: string | Date;
    actor: string;
    detail: Record<string, unknown>;
    prev_seal: string;
    seal: string;
  }>(
    `select seq, entity_id, action, at, actor, detail, prev_seal, seal
     from audit_events where entity_id = $1 order by seq asc`,
    [entityId],
  );

  return rows.map((row) => ({
    seq: Number(row.seq),
    entityId: row.entity_id,
    action: row.action as AuditAction,
    at: iso(row.at),
    actor: row.actor as 'session' | 'agent',
    detail: row.detail ?? {},
    prevSeal: row.prev_seal,
    seal: row.seal,
  }));
}

export async function createShare(
  db: Db,
  ownerId: string,
  assayId: string,
  token: string,
  now: string,
): Promise<ShareLink> {
  await db.query(
    `insert into share_links (token, assay_id, owner_id, created_at)
     values ($1, $2, $3, $4)
     on conflict (token) do nothing`,
    [token, assayId, ownerId, now],
  );
  return { token, assayId, ownerId, createdAt: now };
}

export async function findShare(db: Db, token: string): Promise<ShareLink | null> {
  const rows = await db.query<{
    token: string;
    assay_id: string;
    owner_id: string;
    created_at: string | Date;
  }>(
    `select token, assay_id, owner_id, created_at from share_links where token = $1`,
    [token],
  );
  if (rows.length === 0) return null;
  return {
    token: rows[0].token,
    assayId: rows[0].assay_id,
    ownerId: rows[0].owner_id,
    createdAt: iso(rows[0].created_at),
  };
}

/** Public read used by the share route. Owner id is returned for verification. */
export async function getSharedAssay(
  db: Db,
  token: string,
): Promise<{ assay: AssayRecord; share: ShareLink } | null> {
  const link = await findShare(db, token);
  if (!link) return null;
  const rows = await db.query<AssayRow>(
    `select ${COLUMNS} from assays where id = $1 and owner_id = $2`,
    [link.assayId, link.ownerId],
  );
  if (rows.length === 0) return null;
  return { assay: rowToAssay(rows[0]), share: link };
}

export async function countOwned(db: Db, ownerId: string): Promise<Record<string, number>> {
  const rows = await db.query<{ state: string; n: number }>(
    `select case when deleted_at is null then 'live' else 'retired' end as state, count(*)::bigint as n
     from assays where owner_id = $1 group by 1`,
    [ownerId],
  );
  const counts: Record<string, number> = { live: 0, retired: 0 };
  for (const row of rows) counts[row.state] = Number(row.n);
  return counts;
}