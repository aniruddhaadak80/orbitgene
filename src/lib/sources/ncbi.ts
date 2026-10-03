import { AA_NAMES, isResidue } from '../genetics';
import { cached, fetchJson, fetchText, TTL, UpstreamError } from './http';

/**
 * NCBI E-utilities access.
 *
 * The coding sequence is not simply the mRNA, so ORBITGENE retrieves the GenBank
 * flat file, reads the annotated `CDS` location, and extracts exactly those
 * bases. Clients sometimes pass `secseqstyle=coding` expecting the record to be
 * filtered, but eutils ignores it and returns the entire locus, so relying on it
 * silently scores the wrong DNA.
 */

const EUTILS = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils';

export interface CdsRecord {
  /** RefSeq mRNA accession without version, e.g. `NM_000207`. */
  mrna: string;
  mrnaVersioned: string;
  cds: string;
  cdsLength: number;
  /** Location exactly as it appears in the GenBank record. */
  location: string;
  complemented: boolean;
  proteinId: string | null;
  url: string;
}

interface ElinkResponse {
  linksets?: Array<{ linksetdbs?: Array<{ links: number[] }> }>;
}

interface EsummaryResponse {
  result?: Record<string, { caption?: string; title?: string; biomol?: string }>;
}

/**
 * Translates a UniProt protein accession to its coding RefSeq transcript.
 *
 * UniProt cross-references list `NP_` protein accessions only, so the transcript
 * is resolved through `elink` and then `esummary` (GI to accession).
 *
 * Two link names are tried. `protein_nuccore_mrna` is the precise one but NCBI
 * populates it inconsistently, returning nothing for plenty of ordinary
 * accessions, so `protein_nuccore` is used as a fallback and the NM_ prefix is
 * applied when choosing between the results.
 *
 * A specific `mrnaOverride` short-circuits the lookup entirely.
 */
export async function resolveMrna(
  proteinAccession: string,
  mrnaOverride?: string,
): Promise<{ mrna: string; url: string }> {
  if (mrnaOverride && /^N[MPRG]_\d+(\.\d+)?$/.test(mrnaOverride)) {
    return {
      mrna: mrnaOverride,
      url: `${EUTILS}/efetch.fcgi?db=nuccore&id=${encodeURIComponent(mrnaOverride)}&rettype=gb`,
    };
  }

  const linkNames = ['protein_nuccore_mrna', 'protein_nuccore'];
  const seen = new Set<string>();

  for (const linkName of linkNames) {
    const elinkUrl = `${EUTILS}/elink.fcgi?dbfrom=protein&db=nuccore&id=${encodeURIComponent(
      proteinAccession,
    )}&linkname=${linkName}&retmode=json`;

    let gis: number[] = [];
    try {
      const elink = await cached(`elink:${proteinAccession}:${linkName}`, TTL.gene, () =>
        fetchJson<ElinkResponse>(elinkUrl, `NCBI elink for ${proteinAccession}`),
      );
      gis = (elink.linksets?.[0]?.linksetdbs?.[0]?.links ?? []).filter((g) => Number.isFinite(g));
    } catch {
      gis = [];
    }

    for (const gi of gis) {
      if (seen.has(String(gi))) continue;
      seen.add(String(gi));
    }
    if (seen.size === 0) continue;

    // One protein can link to several nucleotide records in arbitrary order and
    // the first is not reliably the coding transcript, so every candidate is
    // resolved and the first NM_ accession wins: that prefix identifies a RefSeq
    // mRNA, which is the only record whose CDS can be translated here.
    const candidates: string[] = [];
    for (const gi of [...seen].slice(0, 10)) {
      try {
        const summary = await cached(`esummary:nuccore:${gi}`, TTL.gene, () =>
          fetchJson<EsummaryResponse>(
            `${EUTILS}/esummary.fcgi?db=nuccore&id=${gi}&retmode=json`,
            `NCBI esummary for ${gi}`,
          ),
        );
        const caption = summary.result?.[String(gi)]?.caption;
        if (caption) candidates.push(caption);
      } catch {
        // A single unresolvable GI must not fail the whole lookup.
      }
    }

    const mrna = candidates.find((c) => /^NM_/.test(c)) ?? candidates[0];
    if (mrna) {
      return { mrna, url: `${EUTILS}/efetch.fcgi?db=nuccore&id=${mrna}&rettype=gb` };
    }
  }

  throw new UpstreamError(
    `no RefSeq mRNA could be resolved for ${proteinAccession}`,
    `${EUTILS}/elink.fcgi?dbfrom=protein&db=nuccore&id=${proteinAccession}`,
    404,
  );
}

/* ------------------------------------------------------------------ */
/* GenBank flat-file parsing                                           */
/* ------------------------------------------------------------------ */

const COMPLEMENT: Record<string, string> = { A: 'T', C: 'G', G: 'C', T: 'A', N: 'N' };

export function reverseComplement(seq: string): string {
  return seq
    .toUpperCase()
    .split('')
    .reverse()
    .map((b) => COMPLEMENT[b] ?? 'N')
    .join('');
}

/** Strips the sequence out of the ORIGIN block. */
export function parseOrigin(text: string): string {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((l) => l.startsWith('ORIGIN'));
  if (start === -1) throw new Error('GenBank record has no ORIGIN block');

  const chunks: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (line.startsWith('//')) break;
    const match = /^\s*\d+\s+([a-zA-Z\s]+)$/.exec(line);
    if (match) chunks.push(match[1].replace(/\s+/g, ''));
  }

  const dna = chunks.join('').toUpperCase();
  if (dna.length === 0) throw new Error('GenBank ORIGIN block contained no bases');
  return dna;
}

/**
 * Expands a GenBank location into plus-strand coordinate ranges plus a flag for
 * whether the feature reads on the minus strand.
 *
 * Handles `123..456`, `123`, `join(1..10,20..30)` and `complement(join(...))`.
 * Ranges always come back sorted ascending on the forward strand; the caller
 * reverse-complements and walks them backwards when `complemented` is set, which
 * is exactly what a minus-strand gene such as BRCA1 needs.
 */
export function expandLocation(location: string): {
  ranges: Array<[number, number]>;
  complemented: boolean;
} {
  const text = location.replace(/\s+/g, '');
  const wrapped = /^complement\((.*)\)$/.exec(text);
  const complemented = wrapped !== null;
  const inner = complemented ? (wrapped as RegExpExecArray)[1] : text;

  const ranges: Array<[number, number]> = [];
  const body = /^join\((.*)\)$/.exec(inner)?.[1] ?? inner;

  for (const piece of body.split(',')) {
    const m = /^<?(\d+)(?:\.\.>?(\d+))?>?$/.exec(piece.trim());
    if (!m) continue;
    const start = Number(m[1]);
    const end = m[2] ? Number(m[2]) : start;
    ranges.push([Math.min(start, end), Math.max(start, end)]);
  }

  return { ranges: ranges.sort((a, b) => a[0] - b[0]), complemented };
}

export interface CdsFeature {
  location: string;
  segments: Array<[number, number]>;
  complemented: boolean;
  proteinId: string | null;
}

/** Reads the `CDS` feature location and its `/protein_id` from a flat file. */
export function parseCdsFeature(text: string): CdsFeature {
  const lines = text.split(/\r?\n/);

  let inCds = false;
  let location = '';
  let proteinId: string | null = null;

  for (const line of lines) {
    if (!inCds) {
      if (/^ {5}CDS\s+\S/.test(line)) {
        inCds = true;
        location = line.slice(10).trim();
      }
      continue;
    }

    if (isLocationContinuation(line)) {
      location += line.trim();
      continue;
    }
    if (/^ {6,}\/\w+=/.test(line)) {
      if (proteinId === null && /\/protein_id=/.test(line)) {
        proteinId = /"([^"]+)"/.exec(line)?.[1] ?? null;
      }
      continue;
    }
    // The next feature key, or the terminator, ends this block.
    if (/^ {5}\S/.test(line) || /^\S/.test(line)) break;
  }

  if (!location) throw new Error('GenBank record has no CDS feature');

  const { ranges, complemented } = expandLocation(location);
  if (ranges.length === 0) {
    throw new Error(`CDS location "${location.slice(0, 80)}" could not be parsed`);
  }
  return { location, segments: ranges, complemented, proteinId };
}

/**
 * True when a deeper-indented line continues a wrapped coordinate.
 *
 * Indentation alone is not enough: a long `/note` or `/product` value wraps at the
 * same column without repeating the slash, and treating those as coordinates
 * concatenates prose into the location and makes it unparseable. A coordinate
 * continuation can only contain digits, separators and brackets, and must contain
 * at least one digit.
 */
function isLocationContinuation(line: string): boolean {
  if (!/^ {21,}\S/.test(line)) return false;
  const trimmed = line.trim();
  if (trimmed.startsWith('/')) return false;
  if (!/\d/.test(trimmed)) return false;
  return /^[\d\s,.<>()]+$/.test(trimmed);
}

/** Retrieves a transcript's annotated coding sequence in transcript orientation. */
export async function loadCds(mrna: string): Promise<CdsRecord> {
  const bare = mrna.split('.')[0];
  const url = `${EUTILS}/efetch.fcgi?db=nuccore&id=${encodeURIComponent(bare)}&rettype=gb&retmode=text`;

  const text = await cached(`genbank:${bare}`, TTL.gene, () =>
    fetchText(url, `NCBI GenBank ${bare}`),
  );

  const genome = parseOrigin(text);
  const { location, segments, complemented, proteinId } = parseCdsFeature(text);

  // A minus-strand feature is annotated on the plus strand, so its 5' end is the
  // highest coordinate: walk backwards and reverse-complement.
  const ordered = complemented ? [...segments].reverse() : segments;
  let cds = ordered.map(([start, end]) => genome.slice(start - 1, end)).join('');
  if (complemented) cds = reverseComplement(cds);
  cds = cds.replace(/[^ACGT]/g, '');

  if (cds.length === 0) throw new Error(`CDS for ${bare} resolved to an empty sequence`);

  return {
    mrna: bare,
    mrnaVersioned: mrna,
    cds,
    cdsLength: cds.length,
    location,
    complemented,
    proteinId,
    url,
  };
}

/* ------------------------------------------------------------------ */
/* ClinVar                                                             */
/* ------------------------------------------------------------------ */

export interface ClinVarSearchResult {
  total: number;
  ids: string[];
  url: string;
}

export async function searchClinVar(query: string, retMax = 5): Promise<ClinVarSearchResult> {
  const term = encodeURIComponent(query);
  const url = `${EUTILS}/esearch.fcgi?db=clinvar&term=${term}&retmax=${retMax}&retmode=json`;
  const payload = await cached(`clinvar:${query}`, TTL.clinvar, () =>
    fetchJson<{ esearchresult: { count: string; idlist: string[] } }>(url, 'ClinVar esearch'),
  );
  return {
    total: Number(payload.esearchresult.count ?? 0),
    ids: payload.esearchresult.idlist ?? [],
    url,
  };
}

/** The subset of a ClinVar esummary record that ORBITGENE reads. */
interface ClinVarSummaryEntry {
  accession?: string;
  accession_version?: string;
  title?: string;
  protein_change?: string;
  obj_type?: string;
  germline_classification?: {
    description?: string;
    review_status?: string;
    last_evaluated?: string;
    trait_set?: Array<{ trait_name?: string }>;
  };
}

export interface ClinVarSubstitution {
  /** ClinVar variation accession, e.g. `VCV000012374`. */
  accession: string;
  accessionVersion: string;
  /** ClinVar's own title, e.g. `NM_000546.6(TP53):c.524G>A`. */
  title: string;
  /** Compact protein change as ClinVar stores it, e.g. `R175H`. */
  proteinChange: string | null;
  /** Germline classification, e.g. `Pathogenic`. */
  significance: string;
  /** ClinVar review status, e.g. `reviewed by expert panel`. */
  reviewStatus: string;
  /** Last date the classification was evaluated, ISO date or empty. */
  lastEvaluated: string;
  /** MedGen trait name when ClinVar records one. */
  trait: string | null;
  url: string;
}

/**
 * Looks up one exact protein substitution in ClinVar.
 *
 * ClinVar indexes UniProt-style three-letter protein changes, so
 * `BRCA1[gene] AND Ile26Phe` resolves to a single variation record rather than
 * to the tens of thousands of variants the gene itself carries. That precision
 * matters: a gene-level count would say nothing about whether the substitution
 * on this plate is the one a clinician has already classified.
 *
 * Returns `null` when ClinVar holds no record for the substitution, which is the
 * common and unremarkable case. Never throws on an upstream failure: clinical
 * context is an annotation, and a missing annotation must not fail a score.
 */
/**
 * Builds the ClinVar query for one exact substitution.
 *
 * ClinVar indexes UniProt-style three-letter protein changes, so
 * `BRCA1[gene] AND Ile26Phe` resolves to a single variation record rather than
 * to the tens of thousands of variants the gene itself carries. That precision
 * is the whole point: a gene-level count would say nothing about whether the
 * substitution on this plate is one a clinician has already classified.
 *
 * Returns `null` when the inputs cannot form a valid query, which is how the
 * caller distinguishes "no record" from "no query".
 */
export function clinVarSubstitutionQuery(
  geneSymbol: string,
  refAa: string,
  proteinPosition: number,
  altAa: string,
): string | null {
  const symbol = geneSymbol.trim().toUpperCase();
  const ref = refAa.trim().toUpperCase();
  const alt = altAa.trim().toUpperCase();

  // Missense only. ClinVar does index nonsense changes as `Gln72Ter`, but this
  // is a probe-design lookup for a substituted residue, and a stop codon has no
  // residue to substitute. `isResidue` deliberately accepts '*' for nonsense
  // assays, so the stop codon is excluded explicitly here.
  if (!isResidue(ref) || ref === '*' || !isResidue(alt) || alt === '*') return null;

  const refName = AA_NAMES[ref];
  const altName = AA_NAMES[alt];

  if (!symbol || !Number.isInteger(proteinPosition) || proteinPosition < 1) return null;

  return `${symbol}[gene] AND ${refName}${proteinPosition}${altName}`;
}

export async function searchClinVarSubstitution(
  geneSymbol: string,
  refAa: string,
  proteinPosition: number,
  altAa: string,
): Promise<{ hit: ClinVarSubstitution | null; query: string; url: string }> {
  const term = clinVarSubstitutionQuery(geneSymbol, refAa, proteinPosition, altAa);
  if (!term) return { hit: null, query: '', url: '' };

  const searchUrl = `${EUTILS}/esearch.fcgi?db=clinvar&term=${encodeURIComponent(term)}&retmax=5&retmode=json`;

  try {
    const search = await cached(`clinvar-sub:${term}`, TTL.clinvar, () =>
      fetchJson<{ esearchresult: { count: string; idlist: string[] } }>(searchUrl, 'ClinVar esearch'),
    );
    const ids = search.esearchresult?.idlist ?? [];
    if (ids.length === 0) return { hit: null, query: term, url: searchUrl };

    const summaryUrl = `${EUTILS}/esummary.fcgi?db=clinvar&id=${ids.join(',')}&retmode=json`;
    const summary = await cached(`clinvar-sub-sum:${term}`, TTL.clinvar, () =>
      fetchJson<{ result: Record<string, ClinVarSummaryEntry> }>(summaryUrl, 'ClinVar esummary'),
    );

    // esummary keys results by uid, so the requested id is resolved first and
    // only then looked up; assuming the key is the accession silently drops
    // every record.
    const entry = ids.map((id) => summary.result?.[id]).find((row) => row?.accession);
    if (!entry?.accession) return { hit: null, query: term, url: searchUrl };

    const germline = entry.germline_classification;
    const traits = Array.isArray(germline?.trait_set) ? germline.trait_set : [];

    return {
      hit: {
        accession: entry.accession,
        accessionVersion: entry.accession_version ?? '',
        title: entry.title ?? '',
        proteinChange: entry.protein_change ?? null,
        significance: germline?.description ?? 'not provided',
        reviewStatus: germline?.review_status ?? 'not provided',
        lastEvaluated: germline?.last_evaluated ?? '',
        trait: traits[0]?.trait_name ?? null,
        url: `https://www.ncbi.nlm.nih.gov/clinvar/variation/${entry.accession}/`,
      },
      query: term,
      url: searchUrl,
    };
  } catch (error) {
    console.warn(`[orbitgene] ClinVar lookup failed for ${term}:`, error);
    return { hit: null, query: term, url: searchUrl };
  }
}