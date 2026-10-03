import { cached, TTL } from './http';
import { loadCds, resolveMrna } from './ncbi';
import { loadUniProt, isValidAccession } from './uniprot';
import { sealedProfile } from './fallback';
import { sha256 } from '../canonical';
import { translateCodon } from '../genetics';
import type { GeneProfile, SourceMeta } from '../types';

/**
 * Gene profile aggregator.
 *
 * Pulls the protein sequence and its structural and variant annotations from
 * UniProt, then the coding sequence from RefSeq through NCBI, and normalises both
 * into one `GeneProfile`. When any upstream read fails the sealed sample is used
 * instead and every source is labelled `fallback`, so the UI can say exactly what
 * it is showing.
 *
 * The assembled profile is cached for six hours per process, which keeps a burst
 * of visitors from hammering two public APIs while a cold start still pays the
 * real latency.
 */

export interface LoadOptions {
  /** Skip the cache, used by the refresh control and by the live verifier. */
  fresh?: boolean;
  /** Use a specific RefSeq transcript instead of resolving one. */
  mrna?: string;
}

/** Translates a coding sequence up to its stop codon. */
function translateCds(cds: string): string {
  let out = '';
  for (let i = 0; i + 2 < cds.length; i += 3) {
    const residue = translateCodon(cds.slice(i, i + 3));
    if (residue === '*') break;
    out += residue;
  }
  return out;
}

async function buildLive(accession: string, mrna?: string): Promise<GeneProfile> {
  const protein = await loadUniProt(accession);
  const sources: SourceMeta[] = [];
  const now = new Date().toISOString();

  sources.push({
    id: 'uniprot',
    label: `UniProtKB ${protein.entryName}`,
    status: 'live',
    url: protein.url,
    fetchedAt: now,
    note: `${protein.length} residues, ${protein.sites.length} structural features, ${protein.evidence.length} variant or mutagenesis annotations, ${protein.reviewed ? 'reviewed' : 'unreviewed'}`,
  });

  if (mrna) {
    return assemble(protein, await loadCds(mrna), sources, now);
  }

  // Candidate transcripts come from two independent routes: the RefSeq mRNA
  // cross-references in the UniProt flat file, and NCBI's protein-to-mRNA link
  // built from the NP_ accessions. Each candidate is only accepted when its
  // coding sequence actually translates to the UniProt protein, which is the
  // check that catches a minus-strand slip, a truncated isoform and a wrong
  // transcript in one go.
  const candidates: string[] = [...protein.mrnaCandidates];

  for (const anchor of protein.refseqProteins.slice(0, 6)) {
    try {
      candidates.push((await resolveMrna(anchor)).mrna);
    } catch {
      // No link for this protein accession; the flat-file candidates remain.
    }
  }

  const attempts: string[] = [];
  for (const candidate of candidates.slice(0, 10)) {
    try {
      const cds = await loadCds(candidate);
      const translated = translateCds(cds.cds);
      if (translated === protein.sequence) {
        return assemble(protein, cds, sources, now, true);
      }
      attempts.push(
        `${candidate}: translates to ${translated.length} aa against ${protein.length}`,
      );
    } catch (error) {
      attempts.push(`${candidate}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  throw new Error(
    `No RefSeq coding sequence for ${protein.accession} reproduces the UniProt protein after ${candidates.length} candidate transcripts. ${attempts[0] ?? 'no candidates were offered'}`,
  );
}

function assemble(
  protein: Awaited<ReturnType<typeof loadUniProt>>,
  cds: Awaited<ReturnType<typeof loadCds>>,
  sources: SourceMeta[],
  now: string,
  verified = false,
): GeneProfile {
  sources.push({
    id: 'refseq-cds',
    label: `RefSeq ${cds.mrnaVersioned} coding sequence`,
    status: 'live',
    url: cds.url,
    fetchedAt: now,
    note: `${cds.cdsLength} nt from the annotated CDS at ${cds.location}${cds.complemented ? ', reverse-complemented to transcript orientation' : ''}${verified ? ', verified to translate to the UniProt sequence exactly' : ''}`,
  });

  return {
    gene: {
      accession: protein.accession,
      entryName: protein.entryName,
      geneSymbol: protein.geneSymbol,
      proteinName: protein.proteinName,
      organism: protein.organism,
      reviewStatus: protein.reviewed ? 'reviewed' : 'unreviewed',
      proteinLength: protein.length,
      sequence: protein.sequence,
      sequenceChecksum: sha256(protein.sequence).slice(0, 16),
      refseqMrna: cds.mrnaVersioned,
      cds: cds.cds,
      cdsLength: cds.cdsLength,
      fetchedAt: now,
    },
    sites: protein.sites,
    evidence: protein.evidence,
    sources,
  };
}

export async function loadGeneProfile(
  accession: string,
  options: LoadOptions = {},
): Promise<GeneProfile> {
  const bare = accession.split('_')[0].toUpperCase();

  if (!isValidAccession(bare)) {
    throw new Error(`"${accession}" is not a UniProt accession`);
  }

  const key = `gene:${bare}:${options.mrna ?? 'auto'}`;

  if (options.fresh) {
    try {
      return await buildLive(bare, options.mrna);
    } catch {
      const sealed = sealedProfile(bare);
      if (sealed) return sealed;
      throw new Error(
        `Could not retrieve ${bare} from UniProt or RefSeq, and no sealed sample exists for it.`,
      );
    }
  }

  try {
    return await cached(key, TTL.gene, () => buildLive(bare, options.mrna));
  } catch (error) {
    // Logged rather than returned: the caller only ever sees the generic
    // message, so without this the deployment log cannot explain a fallback.
    console.error(`[orbitgene] live retrieval failed for ${bare}:`, error);
    const sealed = sealedProfile(bare);
    if (sealed) return sealed;
    throw new Error(
      `Could not retrieve ${bare} from UniProt or RefSeq, and no sealed sample exists for it.`,
    );
  }
}

/**
 * A profile assembled from a coding sequence the visitor supplied themselves.
 * Nothing is fetched, so this always reports `fallback` and names the sequence.
 */
export function importedProfile(
  geneSymbol: string,
  cds: string,
  protein: string,
): GeneProfile {
  const now = new Date().toISOString();
  const cleanCds = cds.toUpperCase().replace(/[^ACGT]/g, '');
  const cleanProtein = protein.toUpperCase().replace(/[^A-Z*]/g, '').replace(/\*/g, '');

  return {
    gene: {
      accession: 'IMPORTED',
      entryName: `${geneSymbol.toUpperCase()}_IMPORTED`,
      geneSymbol: geneSymbol.toUpperCase().slice(0, 24) || 'IMPORTED',
      proteinName: `Imported ${geneSymbol}`,
      organism: 'unspecified',
      reviewStatus: 'unreviewed',
      proteinLength: cleanProtein.length,
      sequence: cleanProtein,
      sequenceChecksum: `import-${sha256(cleanProtein || cleanCds).slice(0, 16)}`,
      refseqMrna: 'not-applicable',
      cds: cleanCds,
      cdsLength: cleanCds.length,
      fetchedAt: now,
    },
    sites: [],
    evidence: [],
    sources: [
      {
        id: 'visitor-import',
        label: 'Coding sequence supplied by the visitor',
        status: 'fallback',
        url: 'https://rest.uniprot.org/',
        fetchedAt: now,
        note: 'No upstream data was consulted. Scores reflect only the sequence you pasted and your assay configuration.',
      },
    ],
  };
}