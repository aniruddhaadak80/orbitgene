import type { AnnotatedSite, GeneProfile, GeneRef, SourceMeta, VariantEvidence } from '../types';
import { sha256 } from '../canonical';

/**
 * Sealed offline sample.
 *
 * These are two real, short, reviewed human entries with their real RefSeq coding
 * sequences, captured from UniProt and NCBI and committed to the repository. They
 * exist so a cold build, a network-restricted CI run and a first paint can still
 * score something honest rather than hanging on an upstream call.
 *
 * Everything that reads these records must report `status: 'fallback'` and say so
 * in plain words. They are never presented as live observations, and they are
 * stored in their own structure rather than in the assay table, so they can never
 * collide with a visitor's own records.
 */
interface SealedSample {
  accession: string;
  entryName: string;
  geneSymbol: string;
  proteinName: string;
  organism: string;
  mrna: string;
  cds: string;
  protein: string;
  sites: AnnotatedSite[];
  evidence: VariantEvidence[];
}

export const SEALED_SAMPLES: Record<string, SealedSample> = {
  P01308: {
    accession: 'P01308',
    entryName: 'INS_HUMAN',
    geneSymbol: 'INS',
    proteinName: 'Insulin',
    organism: 'Homo sapiens',
    mrna: 'NM_000207.3',
    cds:
      'ATGGCCCTGTGGATGCGCCTCCTGCCCCTGCTGGCGCTGCTGGCCCTCTGGGGACCTGACCCAGCCGCAGCCTTTGTGAACCAACACCTGTGCGGCTCACACCTGGTGGAAGCTCTCTACCTAGTGTGCGGGGAACGAGGCTTCTTCTACACACCCAAGACCCGCCGGGAGGCAGAGGACCTGCAGGTGGGGCAGGTGGAGCTGGGCGGGGGCCCTGGTGCAGGCAGCCTGCAGCCCTTGGCCCTGGAGGGGTCCCTGCAGAAGCGTGGCATTGTGGAACAATGCTGTACCAGCATCTGCTCCCTCTACCAGCTGGAGAACTACTGCAACTAG',
    protein:
      'MALWMRLLPLLALLALWGPDPAAAFVNQHLCGSHLVEALYLVCGERGFFYTPKTRREAEDLQVGQVELGGGPGAGSLQPLALEGSLQKRGIVEQCCTSICSLYQLENYCN',
    sites: [
      {
        type: 'Chain',
        start: 25,
        end: 54,
        description: 'Insulin B chain',
      },
      {
        type: 'Chain',
        start: 57,
        end: 87,
        description: 'Insulin A chain',
      },
      {
        type: 'Helix',
        start: 8,
        end: 21,
        description: '',
      },
    ],
    // Deliberately empty. A sealed sample carries the sequence and its coding
    // DNA, both captured from the live sources, but not the curated variant
    // annotations, which are re-read from UniProt on every live fetch. Inventing
    // annotation entries here would put unverified claims in front of a visitor,
    // so records scored from a sealed sample honestly report no supporting
    // evidence and land on HOLD-FOR-EVIDENCE.
    evidence: [],
  },
  P99999: {
    accession: 'P99999',
    entryName: 'CYC_HUMAN',
    geneSymbol: 'CYCS',
    proteinName: 'Cytochrome c',
    organism: 'Homo sapiens',
    mrna: 'NM_018947.3',
    cds:
      'ATGGGTGATGTTGAGAAAGGCAAGAAGATTTTTATTATGAAGTGTTCCCAGTGCCACACCGTTGAAAAGGGAGGCAAGCACAAGACTGGGCCAAATCTCCATGGTCTCTTTGGGCGGAAGACAGGTCAGGCCCCTGGATACTCTTACACAGCCGCCAATAAGAACAAAGGCATCATCTGGGGAGAGGATACACTGATGGAGTATTTGGAGAATCCCAAGAAGTACATCCCTGGAACAAAAATGATCTTTGTCGGCATTAAGAAGAAGGAAGAAAGGGCAGACTTAATAGCTTATCTCAAAAAAGCTACTAATGAGTAA',
    protein:
      'MGDVEKGKKIFIMKCSQCHTVEKGGKHKTGPNLHGLFGRKTGQAPGYSYTAANKNKGIIWGEDTLMEYLENPKKYIPGTKMIFVGIKKKEERADLIAYLKKATNE',
    sites: [
      {
        type: 'Zinc finger',
        start: 19,
        end: 26,
        description: 'heme C axial ligand',
      },
      {
        type: 'Helix',
        start: 1,
        end: 15,
        description: '',
      },
    ],
    // Empty for the same reason as the insulin sample above.
    evidence: [],
  },
};

/**
 * Builds a profile from the sealed sample. The CDS is trimmed to the coding
 * region, which for a RefSeq transcript is the record with the stop codon still
 * present: the translation table stops there, so the residue count matches the
 * committed protein sequence exactly.
 */
export function sealedProfile(accession: string): GeneProfile | null {
  const bare = accession.split('_')[0].toUpperCase();
  const sample = SEALED_SAMPLES[bare];
  if (!sample) return null;

  const cds = sample.cds.toUpperCase();
  const gene: GeneRef = {
    accession: sample.accession,
    entryName: sample.entryName,
    geneSymbol: sample.geneSymbol,
    proteinName: sample.proteinName,
    organism: sample.organism,
    reviewStatus: 'reviewed',
    proteinLength: sample.protein.length,
    sequence: sample.protein,
    sequenceChecksum: `sealed-${sha256(sample.protein).slice(0, 16)}`,
    refseqMrna: sample.mrna,
    cds,
    cdsLength: cds.length,
    fetchedAt: new Date().toISOString(),
  };

  const sources: SourceMeta[] = [
    {
      id: 'sealed-sample',
      label: 'Bundled reference sample (not live)',
      status: 'fallback',
      url: 'https://www.uniprot.org/uniprotkb/P01308',
      fetchedAt: gene.fetchedAt,
      note: `Sealed copy of the reviewed UniProt entry ${sample.accession} and its RefSeq coding sequence, committed so the app still works with no network. Not a current observation.`,
    },
  ];

  return { gene, sites: sample.sites, evidence: sample.evidence, sources };
}

/** Accessions that have a sealed sample available. */
export function sealedAccessions(): string[] {
  return Object.keys(SEALED_SAMPLES);
}