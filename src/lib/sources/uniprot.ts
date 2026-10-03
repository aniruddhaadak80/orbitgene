import { cached, fetchJson, fetchText, TTL } from './http';
import type { AnnotatedSite, SiteType, VariantEvidence } from '../types';

interface UniProtFeature {
  type: string;
  location: { start: { value: number }; end: { value: number } };
  description?: string;
  alternativeSequence?: {
    originalSequence?: string;
    alternativeSequences?: string[];
  };
  evidences?: Array<{ source?: string; id?: string }>;
}

interface UniProtEntry {
  primaryAccession: string;
  uniProtkbId: string;
  entryType: string;
  sequence: { length: number; value: string };
  proteinDescription?: { recommendedName?: { fullName?: { value: string } } };
  genes?: Array<{ geneName?: { value: string } }>;
  organism?: { scientificName: string };
  features?: UniProtFeature[];
  uniProtKBCrossReferences?: Array<{ database: string; id: string }>;
}

const STRUCTURAL: SiteType[] = [
  'Helix',
  'Beta strand',
  'Region',
  'Domain',
  'Chain',
  'Zinc finger',
  'Compositional bias',
  'Active site',
  'Binding site',
];

export interface UniProtRecord {
  accession: string;
  entryName: string;
  geneSymbol: string;
  proteinName: string;
  organism: string;
  reviewed: boolean;
  sequence: string;
  length: number;
  sites: AnnotatedSite[];
  evidence: VariantEvidence[];
  /** UniProt protein RefSeq accessions, used to locate the coding transcript. */
  refseqProteins: string[];
  /**
   * RefSeq mRNA accessions read from the entry's flat-text cross-references.
   * The JSON view exposes protein accessions only, and NCBI's `elink` is
   * inconsistent about protein to mRNA links, so the flat file is the reliable
   * place to get candidate transcripts.
   */
  mrnaCandidates: string[];
  /** Canonical upstream URL this record came from. */
  url: string;
}

const accessionPattern = /^[A-Z0-9]{6,10}$/;

export function isValidAccession(accession: string): boolean {
  return accessionPattern.test(accession);
}

/** Strips the species suffix UniProt puts on its canonical URLs. */
function canonicalUrl(accession: string): string {
  const bare = accession.split('_')[0];
  return `https://rest.uniprot.org/uniprotkb/${bare}.json`;
}

/**
 * Reads the RefSeq mRNA cross-references out of the flat-text entry.
 * Returns a stable, de-duplicated list in the order UniProt lists them.
 */
function parseMrnaCandidates(text: string): string[] {
  const found = text.match(/\bNM_\d+\.\d+\b/g) ?? [];
  const unique: string[] = [];
  for (const accession of found) {
    if (!unique.includes(accession)) unique.push(accession);
  }
  return unique;
}

export async function loadUniProt(accession: string): Promise<UniProtRecord> {
  const bare = accession.split('_')[0];
  const url = `https://rest.uniprot.org/uniprotkb/${bare}.json`;

  const entry = await cached(`uniprot:${bare}`, TTL.gene, () =>
    fetchJson<UniProtEntry>(url, `UniProt ${bare}`),
  );

  const sequence = (entry.sequence?.value ?? '').replace(/[^A-Z]/g, '');
  if (sequence.length === 0) {
    throw new Error(`UniProt ${bare} returned no protein sequence`);
  }

  const sites: AnnotatedSite[] = [];
  const evidence: VariantEvidence[] = [];

  for (const feature of entry.features ?? []) {
    const start = feature.location?.start?.value;
    const end = feature.location?.end?.value;
    if (!start || !end) continue;

    if (STRUCTURAL.includes(feature.type as SiteType)) {
      sites.push({
        type: feature.type as SiteType,
        start,
        end,
        description: feature.description ?? '',
      });
      continue;
    }

    if (feature.type === 'Natural variant' || feature.type === 'Mutagenesis') {
      const original = feature.alternativeSequence?.originalSequence;
      const alternatives = feature.alternativeSequence?.alternativeSequences ?? [];
      if (!original || alternatives.length === 0) continue;
      evidence.push({
        source: feature.type === 'Mutagenesis' ? 'uniprot-mutagenesis' : 'uniprot-natural-variant',
        position: start,
        refAa: original,
        altAas: alternatives,
        description: feature.description ?? '',
        publications: (feature.evidences ?? [])
          .filter((e) => e.source === 'PubMed' && e.id)
          .map((e) => e.id as string),
      });
    }
  }

  const refseqProteins = (entry.uniProtKBCrossReferences ?? [])
    .filter((x) => x.database === 'RefSeq' && x.id.startsWith('NP_'))
    .map((x) => x.id);

  // The flat-text entry is the only UniProt representation that lists the RefSeq
  // mRNA cross-references, and it is cheap: one request, cached for six hours.
  const flat = await cached(`uniprot-text:${bare}`, TTL.gene, () =>
    fetchText(`https://rest.uniprot.org/uniprotkb/${bare}.txt`, `UniProt flat text ${bare}`).catch(() => ''),
  );

  return {
    accession: entry.primaryAccession ?? bare,
    entryName: entry.uniProtkbId ?? bare,
    geneSymbol: entry.genes?.[0]?.geneName?.value ?? bare,
    proteinName:
      entry.proteinDescription?.recommendedName?.fullName?.value ?? 'Unnamed protein',
    organism: entry.organism?.scientificName ?? 'unknown',
    reviewed: String(entry.entryType).includes('reviewed'),
    sequence,
    length: sequence.length,
    sites,
    evidence,
    refseqProteins,
    mrnaCandidates: parseMrnaCandidates(flat),
    url: canonicalUrl(bare),
  };
}

export { canonicalUrl as uniprotUrl };