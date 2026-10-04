import { randomUUID } from 'node:crypto';
import { scoreMutation, type EngineOutcome } from '../engine';
import { translateCodon } from '../genetics';
import { getDb, type Db } from '../db';
import { findFlight, findInstrument } from '../profiles';
import { loadGeneProfile, type LoadOptions } from '../sources/gene';
import { invalidateCachedProfile, readCachedProfile, writeCachedProfile } from '../repo/gene-profiles';
import { searchClinVarSubstitution } from '../sources/ncbi';
import { loadSpaceWeather } from '../sources/spaceweather';
import {
  createAssay,
  createShare,
  deleteAssay,
  getAssay,
  getAssayAnyState,
  getSharedAssay,
  listAudit,
  listAssays,
  recordDecision,
  updateAssay,
  type ListQueryLike,
} from '../repo/assays';
import { replay } from '../integrity';
import type {
  AssayDecision,
  AssayRecord,
  AssayStatus,
  ClinicalContext,
  ClinVarSubstitution,
  SealedResult,
  SourceMeta,
  GeneProfile,
  ReplayReport,
  SessionSettings,
  SpaceWeather,
} from '../types';

/**
 * The single service layer.
 *
 * Every write path funnels through here: the REST routes, the mutation scrub and
 * the MCP tools all call these functions. That is what makes the agent interface
 * provably the same code path as the interface a human clicks, rather than a
 * parallel implementation that can drift.
 */

export interface ScoreRequest {
  accession: string;
  proteinPosition: number;
  /**
   * Wild-type residue. Optional: when omitted the service translates the codon
   * from the retrieved coding sequence, so a visitor never has to look up the
   * reference residue before they can score anything.
   */
  refAa?: string;
  altAa: string;
  /** Which base of the codon changes; omitted lets the engine price every option. */
  baseOffset?: number;
  instrumentId: string;
  flightProfileId: string;
}

export interface ScoreResponse {
  outcome: EngineOutcome;
  profile: GeneProfile;
  weather: SpaceWeather;
  clinical: ClinicalContext;
}

/** Reads the residue the retrieved coding sequence actually encodes. */
export function observedResidue(profile: GeneProfile, proteinPosition: number): string | null {
  const offset = (proteinPosition - 1) * 3;
  const codon = profile.gene.cds.slice(offset, offset + 3).toUpperCase();
  if (codon.length !== 3) return null;
  const residue = translateCodon(codon);
  return residue === 'X' ? null : residue;
}

/**
 * Checks a caller-supplied reference residue against the retrieved coding
 * sequence.
 *
 * The retrieved CDS is the authority on what the wild type is at a position. A
 * reference that disagrees with it describes a substitution that does not exist,
 * so scoring it would produce a confident, well-evidenced verdict about a
 * residue that was never there. This returns a reason to reject, or null when
 * the reference agrees or was omitted.
 *
 * This check is the reason the catalogue's featured positions cannot silently
 * drift away from the sequences UniProt now serves: a mismatch is reported
 * instead of scored.
 */
export function referenceMismatchReason(
  profile: GeneProfile,
  proteinPosition: number,
  refAa: string | undefined,
): string | null {
  if (!refAa) return null;

  const observed = observedResidue(profile, proteinPosition);
  if (observed === null) return null;

  const claimed = refAa.trim().toUpperCase();
  if (claimed === observed) return null;

  return (
    `Position ${proteinPosition} of ${profile.gene.geneSymbol} is ${observed} in the retrieved ` +
    `${profile.gene.refseqMrna} coding sequence, not ${claimed}. ` +
    `Scoring ${claimed} would describe a substitution that does not exist in this transcript.`
  );
}

export async function score(
  request: ScoreRequest,
  options: LoadOptions = {},
): Promise<ScoreResponse> {
  const [profile, weather] = await Promise.all([
    resolveGeneProfile(request.accession, options),
    loadSpaceWeather(),
  ]);

  const mismatch = referenceMismatchReason(profile, request.proteinPosition, request.refAa);
  if (mismatch) {
    return {
      outcome: { ok: false, reason: mismatch },
      profile,
      weather,
      clinical: {
        status: 'unavailable',
        query: '',
        hit: null,
        source: {
          id: 'clinvar',
          label: 'ClinVar',
          status: 'fallback',
          url: 'https://www.ncbi.nlm.nih.gov/clinvar/',
          fetchedAt: new Date().toISOString(),
          note: 'No lookup was attempted, because the requested reference residue does not match the coding sequence.',
        },
      },
    };
  }

  const refAa = request.refAa || observedResidue(profile, request.proteinPosition) || '';

  // ClinVar is queried for the resolved wild-type residue rather than the raw
  // request, so a visitor who omits refAa still gets the right lookup. It runs
  // after the sequence is known because the gene symbol comes from the profile.
  const clinical = await loadClinicalContext(
    profile.gene.geneSymbol,
    refAa,
    request.proteinPosition,
    request.altAa,
  );

  const instrument = findInstrument(request.instrumentId);
  const flight = findFlight(request.flightProfileId);

  const outcome = scoreMutation({
    profile,
    proteinPosition: request.proteinPosition,
    refAa,
    altAa: request.altAa,
    baseOffset: request.baseOffset,
    instrument,
    flight,
    probe: { sequence: '', sodiumMolar: 0.05, strandConcentrationNm: 50 },
    spaceWeather: weather,
  });

  return { outcome, profile, weather, clinical };
}

/**
 * Resolves the ClinVar classification for one substitution, and always returns a
 * source entry so the clinical line in the UI is labelled with where it came
 * from rather than appearing as an unexplained assertion.
 */
async function loadClinicalContext(
  geneSymbol: string,
  refAa: string,
  proteinPosition: number,
  altAa: string,
): Promise<ClinicalContext> {
  const now = new Date().toISOString();
  const result = await searchClinVarSubstitution(geneSymbol, refAa, proteinPosition, altAa);
  return classifyClinicalLookup(result, now);
}

/**
 * Maps a ClinVar lookup outcome onto the status a reader sees.
 *
 * Split out as a pure function because this single branch is the difference
 * between "ClinVar searched and holds nothing" and "ClinVar was never reached",
 * and a rate-limited lookup that renders as the first one tells a reader that
 * ClinVar has nothing on a variant nobody managed to ask about.
 */
export function classifyClinicalLookup(
  result: { hit: ClinVarSubstitution | null; query: string; failure?: string },
  now: string,
): ClinicalContext {
  if (result.failure || !result.query) {
    const reason = result.failure ?? 'the wild-type residue could not be resolved';
    return {
      status: 'unavailable',
      query: result.query,
      hit: null,
      source: {
        id: 'clinvar',
        label: 'ClinVar',
        status: 'fallback',
        url: 'https://www.ncbi.nlm.nih.gov/clinvar/',
        fetchedAt: now,
        note: `The ClinVar lookup did not complete: ${reason}. This is an upstream failure, not a statement about the variant.`,
      },
    };
  }

  const source: SourceMeta = result.hit
    ? {
        id: 'clinvar',
        label: `ClinVar ${result.hit.accession}`,
        status: 'live',
        url: result.hit.url,
        fetchedAt: now,
        note: `${result.hit.significance}, ${result.hit.reviewStatus}${
          result.hit.lastEvaluated ? `, last evaluated ${result.hit.lastEvaluated.slice(0, 10)}` : ''
        }`,
      }
    : {
        id: 'clinvar',
        label: 'ClinVar',
        status: 'live',
        url: 'https://www.ncbi.nlm.nih.gov/clinvar/',
        fetchedAt: now,
        note: `No ClinVar record matches "${result.query}". Absence of a record is not evidence of benignity.`,
      };

  return {
    status: result.hit ? 'reported' : 'not-reported',
    query: result.query,
    hit: result.hit,
    source,
  };
}

/**
 * Reads a gene profile through the persistent cache.
 *
 * The cache is authoritative for speed but never for truth: a cache miss falls
 * through to the live retriever, and the retriever's own fallback rules still
 * apply, so a sealed fallback is cached too and stays labelled `fallback` rather
 * than being upgraded to `live` by having been stored once.
 *
 * A cache write failure is logged and ignored. A slow answer is better than an
 * error, and the next request will simply pay the upstream cost again.
 */
export async function resolveGeneProfile(
  accession: string,
  options: LoadOptions = {},
): Promise<GeneProfile> {
  const bare = accession.split('_')[0].toUpperCase();

  let db: Db | null = null;
  try {
    db = await getDb();
  } catch (error) {
    console.warn('[orbitgene] profile cache unavailable:', error instanceof Error ? error.message : error);
  }

  if (db && !options.fresh) {
    try {
      const cached = await readCachedProfile(db, bare);
      if (cached) return cached.profile;
    } catch (error) {
      console.warn(`[orbitgene] profile cache read failed for ${bare}:`, error);
    }
  }

  const profile = await loadGeneProfile(bare, options);

  if (db) {
    try {
      if (options.fresh) await invalidateCachedProfile(db, bare);
      await writeCachedProfile(db, bare, profile);
    } catch (error) {
      console.warn(`[orbitgene] profile cache write failed for ${bare}:`, error);
    }
  }

  return profile;
}

export interface CreateParams extends Omit<ScoreRequest, 'instrumentId' | 'flightProfileId'> {
  well: string;
  notes: string;
  /** Both fall back to the session configuration when omitted. */
  instrumentId?: string;
  flightProfileId?: string;
  idempotencyKey?: string;
}

export type CreateResult =
  | { status: 'created' | 'replayed'; assay: AssayRecord }
  | { status: 'error'; code: string; message: string; details?: Record<string, string> };

export async function createAssayRecord(
  db: Db,
  ownerId: string,
  params: CreateParams,
  now: string,
  settings: SessionSettings,
  options: LoadOptions = {},
): Promise<CreateResult> {
  // Session settings supply the defaults, so a visitor who tuned their optics on
  // /settings gets those optics applied to every record they do not override.
  const instrument = findInstrument(params.instrumentId || settings.instrument.id);
  const flight = findFlight(params.flightProfileId || settings.flight.id);

  const { outcome, profile, weather, clinical } = await score(
    {
      accession: params.accession,
      proteinPosition: params.proteinPosition,
      refAa: params.refAa,
      altAa: params.altAa,
      baseOffset: params.baseOffset,
      instrumentId: instrument.id,
      flightProfileId: flight.id,
    },
    options,
  );

  if (!outcome.ok) {
    return { status: 'error', code: 'not-scorable', message: outcome.reason };
  }

  const result = outcome.result;

  const created = await createAssay(db, {
    id: randomUUID(),
    ownerId,
    well: params.well,
    geneSymbol: profile.gene.geneSymbol,
    uniprotAccession: profile.gene.accession,
    refseqMrna: profile.gene.refseqMrna,
    proteinPosition: params.proteinPosition,
    refAa: result.codon.refAa,
    altAa: result.codon.altAa,
    hgvsP: result.codon.hgvsP,
    hgvsC: result.codon.hgvsC,
    consequence: result.codon.consequence,
    probeSequence: result.thermo.probe,
    instrumentId: instrument.id,
    flightProfileId: flight.id,
    notes: params.notes.slice(0, 500),
    score: result.score,
    verdict: result.verdict,
    // Sealed with the score, not looked up on read: the record shows what ClinVar
    // said about this substitution when it was scored, so replaying an old record
    // shows its own historical context rather than today's.
    result: { ...result, clinical } satisfies SealedResult,
    idempotencyKey: params.idempotencyKey ?? null,
    now,
  });

  void weather;
  return { status: created.status, assay: created.assay };
}

export async function patchAssay(
  db: Db,
  ownerId: string,
  id: string,
  patch: {
    well?: string;
    status?: AssayStatus;
    notes?: string;
    instrumentId?: string;
    flightProfileId?: string;
  },
  now: string,
  actor: 'session' | 'agent',
): Promise<CreateResult> {
  const outcome = await updateAssay(db, ownerId, id, patch, now, actor);
  if ('conflict' in outcome) {
    return {
      status: 'error',
      code: outcome.conflict,
      message:
        outcome.conflict === 'not-found'
          ? 'That assay does not exist in this session.'
          : 'The record changed while you were editing it. Reload and try again.',
    };
  }
  return { status: 'created', assay: outcome.assay };
}

export async function decide(
  db: Db,
  ownerId: string,
  id: string,
  verdict: AssayDecision['verdict'],
  rationale: string,
  now: string,
  actor: 'session' | 'agent',
): Promise<CreateResult> {
  const decision: AssayDecision = {
    verdict,
    rationale: rationale.trim().slice(0, 600),
    decidedAt: now,
  };
  const outcome = await recordDecision(db, ownerId, id, decision, now, actor);
  if ('conflict' in outcome) {
    return {
      status: 'error',
      code: outcome.conflict,
      message: 'That assay does not exist in this session.',
    };
  }
  return { status: 'created', assay: outcome.assay };
}

export type DeleteResult =
  | { status: 'deleted'; assay: AssayRecord }
  | { status: 'error'; code: string; message: string; expectedSeal?: string };

export async function retire(
  db: Db,
  ownerId: string,
  id: string,
  seal: string,
  now: string,
  actor: 'session' | 'agent',
): Promise<DeleteResult> {
  const outcome = await deleteAssay(db, ownerId, id, seal, now, actor);

  if ('assay' in outcome) return { status: 'deleted', assay: outcome.assay };

  switch (outcome.conflict) {
    case 'not-found':
      return { status: 'error', code: 'not-found', message: 'That assay does not exist in this session.' };
    case 'already-deleted':
      return { status: 'error', code: 'already-deleted', message: 'That assay was already retired.' };
    default:
      return {
        status: 'error',
        code: 'seal-mismatch',
        message:
          'The seal you supplied does not match the current head of the chain, so nothing was deleted.',
        expectedSeal: outcome.expected,
      };
  }
}

export async function fetchReplay(
  db: Db,
  ownerId: string,
  id: string,
): Promise<{ report: ReplayReport; assay: AssayRecord | null; owned: boolean }> {
  const assay = await getAssayAnyState(db, ownerId, id);
  const events = await listAudit(db, id);
  const report = replay(id, events);
  return { report, assay, owned: assay !== null || events.length > 0 };
}

export async function plateMap(db: Db, ownerId: string, query?: Partial<ListQueryLike>) {
  return listAssays(db, ownerId, {
    status: query?.status,
    gene: query?.gene,
    q: query?.q,
    limit: query?.limit ?? 96,
    offset: query?.offset ?? 0,
  });
}

/** Used by the MCP `list_assays` tool. */
export function listAssaysWith(db: Db, ownerId: string, query: ListQueryLike) {
  return listAssays(db, ownerId, {
    status: query.status,
    gene: query.gene,
    q: query.q,
    limit: query.limit ?? 50,
    offset: query.offset ?? 0,
  });
}

export async function share(db: Db, ownerId: string, assayId: string, token: string, now: string) {
  const assay = await getAssay(db, ownerId, assayId);
  if (!assay) {
    return { status: 'error' as const, message: 'That assay does not exist in this session.' };
  }
  await createShare(db, ownerId, assayId, token, now);
  return { status: 'ok' as const, token };
}

export async function readShare(db: Db, token: string) {
  return getSharedAssay(db, token);
}

export { getDb };