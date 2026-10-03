import type { Consequence } from './types';

/* ------------------------------------------------------------------ */
/* Genetic code                                                       */
/* ------------------------------------------------------------------ */

export const CODON_TABLE: Readonly<Record<string, string>> = Object.freeze({
  TTT: 'F', TTC: 'F', TTA: 'L', TTG: 'L',
  CTT: 'L', CTC: 'L', CTA: 'L', CTG: 'L',
  ATT: 'I', ATC: 'I', ATA: 'I', ATG: 'M',
  GTT: 'V', GTC: 'V', GTA: 'V', GTG: 'V',
  TCT: 'S', TCC: 'S', TCA: 'S', TCG: 'S',
  CCT: 'P', CCC: 'P', CCA: 'P', CCG: 'P',
  ACT: 'T', ACC: 'T', ACA: 'T', ACG: 'T',
  GCT: 'A', GCC: 'A', GCA: 'A', GCG: 'A',
  TAT: 'Y', TAC: 'Y', TAA: '*', TAG: '*',
  CAT: 'H', CAC: 'H', CAA: 'Q', CAG: 'Q',
  AAT: 'N', AAC: 'N', AAA: 'K', AAG: 'K',
  GAT: 'D', GAC: 'D', GAA: 'E', GAG: 'E',
  TGT: 'C', TGC: 'C', TGA: '*', TGG: 'W',
  CGT: 'R', CGC: 'R', CGA: 'R', CGG: 'R',
  AGT: 'S', AGC: 'S', AGA: 'R', AGG: 'R',
  GGT: 'G', GGC: 'G', GGA: 'G', GGG: 'G',
});

export const AA_NAMES: Readonly<Record<string, string>> = Object.freeze({
  A: 'Ala', R: 'Arg', N: 'Asn', D: 'Asp', C: 'Cys',
  Q: 'Gln', E: 'Glu', G: 'Gly', H: 'His', I: 'Ile',
  L: 'Leu', K: 'Lys', M: 'Met', F: 'Phe', P: 'Pro',
  S: 'Ser', T: 'Thr', W: 'Trp', Y: 'Tyr', V: 'Val',
  '*': 'Ter',
});

export const DNA_BASES = ['A', 'C', 'G', 'T'] as const;

/** Case-insensitive membership test for a single DNA base. */
export function isBase(b: string): boolean {
  return typeof b === 'string' && (DNA_BASES as readonly string[]).includes(b.toUpperCase());
}

/**
 * The four bases that a single-nucleotide substitution of `ref` can produce.
 * Ordering is fixed (A, C, G, T) so the scrubber's dial is stable across renders.
 */
export function substitutionsFor(ref: string): string[] {
  return DNA_BASES.filter((b) => b !== ref.toUpperCase());
}

export function translateCodon(codon: string): string {
  return CODON_TABLE[codon.toUpperCase()] ?? 'X';
}

/* ------------------------------------------------------------------ */
/* Published per-residue scales                                        */
/* ------------------------------------------------------------------ */

/**
 * Kyte & Doolittle (1982) hydropathy index. J Theor Biol 100:413-532.
 * Positive is hydrophobic, negative is hydrophilic.
 */
export const HYDROPATHY: Readonly<Record<string, number>> = Object.freeze({
  I: 4.5, V: 4.2, L: 3.8, F: 2.8, C: 2.5, M: 1.9, A: 1.8,
  G: -0.4, T: -0.7, S: -0.8, W: -0.9, Y: -1.3, P: -1.6,
  H: -3.2, E: -3.5, Q: -3.5, D: -3.5, N: -3.5, K: -3.9, R: -4.5,
});

/**
 * Zamyatnin (1972) residue volumes in cubic angstroms.
 * Prog Biophys Mol Biol 24:107-123.
 */
export const RESIDUE_VOLUME: Readonly<Record<string, number>> = Object.freeze({
  A: 88.6, R: 173.4, N: 114.1, D: 111.1, C: 108.5, Q: 143.8,
  E: 138.4, G: 60.1, H: 153.2, I: 166.7, L: 166.7, K: 168.6,
  M: 162.9, F: 189.9, P: 112.7, S: 89.0, T: 116.1, W: 227.8,
  Y: 193.6, V: 140.0,
});

/**
 * Chou & Fasman (1978) conformational parameters. Adv Enzymol 47:45-148.
 * Palpha helix propensity, Pbeta extended-sheet propensity, Pturn turn propensity.
 */
export const HELIX_PROPENSITY: Readonly<Record<string, number>> = Object.freeze({
  A: 1.42, R: 0.98, N: 0.67, D: 1.01, C: 0.70, Q: 1.11, E: 1.51,
  G: 0.57, H: 1.00, I: 1.08, L: 1.21, K: 1.16, M: 1.45, F: 1.13,
  P: 0.57, S: 0.77, T: 0.83, W: 1.08, Y: 0.69, V: 1.06,
});

export const SHEET_PROPENSITY: Readonly<Record<string, number>> = Object.freeze({
  A: 0.83, R: 0.93, N: 0.89, D: 0.54, C: 1.19, Q: 1.10, E: 0.37,
  G: 0.75, H: 0.87, I: 1.60, L: 1.30, K: 0.74, M: 1.05, F: 1.38,
  P: 0.55, S: 0.75, T: 1.19, W: 1.37, Y: 1.47, V: 1.70,
});

export const TURN_PROPENSITY: Readonly<Record<string, number>> = Object.freeze({
  A: 0.66, R: 0.95, N: 1.56, D: 1.46, C: 1.19, Q: 0.98, E: 0.74,
  G: 1.56, H: 0.95, I: 0.47, L: 0.59, K: 1.01, M: 0.60, F: 0.60,
  P: 1.52, S: 1.43, T: 0.96, W: 0.96, Y: 1.14, V: 1.14,
});

export type ResidueClass =
  | 'aliphatic'
  | 'aromatic'
  | 'polar-uncharged'
  | 'acidic'
  | 'basic'
  | 'sulfur'
  | 'special';

/** The 20 standard residues plus the termination codon. */
export const RESIDUES = 'ACDEFGHIKLMNPQRSTVWY' as const;

/**
 * Membership test for a one-letter amino-acid code. `*` is accepted because a
 * nonsense assay deliberately targets the stop codon.
 */
export function isResidue(aa: string): boolean {
  return typeof aa === 'string' && aa.length === 1 && (aa === '*' || (RESIDUES as string).includes(aa));
}

export const RESIDUE_CLASS: Readonly<Record<string, ResidueClass>> = Object.freeze({
  A: 'aliphatic', V: 'aliphatic', L: 'aliphatic', I: 'aliphatic',
  M: 'sulfur', C: 'sulfur',
  F: 'aromatic', W: 'aromatic', Y: 'aromatic',
  S: 'polar-uncharged', T: 'polar-uncharged', N: 'polar-uncharged',
  Q: 'polar-uncharged',
  D: 'acidic', E: 'acidic',
  K: 'basic', R: 'basic',
  G: 'special', P: 'special', H: 'aromatic',
});

/** Net formal charge at physiological pH. Histidine is counted as +0.5. */
export function formalCharge(aa: string): number {
  if (aa === 'D' || aa === 'E') return -1;
  if (aa === 'K' || aa === 'R') return 1;
  if (aa === 'H') return 0.5;
  return 0;
}


/**
 * Normalised physicochemical displacement between two residues, 0..1.
 *
 * Each of five signed axes is squashed through a half-range so that any single
 * axis is bounded by 1, then combined as a root-mean-square. Weighting is
 * documented in `engine.ts`; the scales above are the published sources.
 *
 *   hydropathy  half-range 4.5   (Kyte & Doolittle 1982 full span)
 *   volume      half-range 83.9  (Zamyatnin 1972 max minus min)
 *   charge      half-range 1.0   (formal charge difference)
 *   helix       half-range 0.47  (Chou & Fasman 1978 max 1.51 minus min 0.57)
 *   sheet       half-range 1.33  (Chou & Fasman 1978 max 1.70 minus min 0.37)
 */
export function physicochemicalDisplacement(ref: string, alt: string): number {
  const axes = [
    Math.abs((HYDROPATHY[alt] ?? 0) - (HYDROPATHY[ref] ?? 0)) / 4.5,
    Math.abs((RESIDUE_VOLUME[alt] ?? 0) - (RESIDUE_VOLUME[ref] ?? 0)) / 83.9,
    Math.abs(formalCharge(alt) - formalCharge(ref)) / 1.0,
    Math.abs((HELIX_PROPENSITY[alt] ?? 0) - (HELIX_PROPENSITY[ref] ?? 0)) / 0.47,
    Math.abs((SHEET_PROPENSITY[alt] ?? 0) - (SHEET_PROPENSITY[ref] ?? 0)) / 1.33,
  ];
  const squares = axes.map((a) => Math.min(1, a) ** 2);
  const rms = Math.sqrt(squares.reduce((a, b) => a + b, 0) / squares.length);
  return round(rms, 4);
}

/* ------------------------------------------------------------------ */
/* Codon-level consequence                                             */
/* ------------------------------------------------------------------ */

export interface CodonChange {
  valid: boolean;
  reason?: string;
  refCodon: string;
  altCodon: string;
  codonIndex: number;
  hgvsC: string;
  hgvsP: string;
  refAa: string;
  altAa: string;
  transition: boolean;
  consequence: Consequence;
  atTerminalCodon: boolean;
  /** Zero-based position of the changed base inside the codon. */
  baseOffset: number;
  /** How many times the reference base occurs in this codon. */
  refOccurrences: number;
}

const PURINES = new Set(['A', 'G']);
const PYRIMIDINES = new Set(['C', 'T']);

/** A transition is a purine to purine or pyrimidine to pyrimidine substitution. */
export function isTransition(ref: string, alt: string): boolean {
  return (
    (PURINES.has(ref) && PURINES.has(alt)) || (PYRIMIDINES.has(ref) && PYRIMIDINES.has(alt))
  );
}

/**
 * Formats a coding-DNA change in HGVS nomenclature. `baseOffset` is zero-based.
 *
 * The HGVS 3' rule applies: a change in the first or second base of a codon is
 * described from the third base with a shift, so a change at codon position 1 of
 * codon 2 is written `c.4-2` and at position 2 it is `c.3-1`. A change already at
 * the third base is a plain substitution.
 */
export function hgvsCodingChange(
  codonIndex: number,
  baseOffset: number,
  ref: string,
  alt: string,
): string {
  if (baseOffset === 2) return `c.${codonIndex * 3}${ref}>${alt}`;
  if (baseOffset === 1) return `c.${codonIndex + 1}-1${ref}>${alt}`;
  return `c.${codonIndex + 2}-2${ref}>${alt}`;
}

/**
 * Applies a single-nucleotide substitution to a coding sequence and reports the
 * full codon-level consequence. `proteinPosition` is 1-based and `cds` must
 * already be trimmed to the coding region.
 *
 * `baseOffset` selects which of the three codon positions is being changed. It
 * matters whenever the codon is not a homopolymer-free triplet: for `GGC`,
 * changing position 1 and changing position 2 are different mutations, so
 * resolving the reference base by first occurrence alone would silently report
 * the wrong nucleotide and therefore the wrong melting temperature.
 */
export function applySubstitution(
  cds: string,
  proteinPosition: number,
  refBase: string,
  altBase: string,
  baseOffset?: number,
): CodonChange {
  const empty: CodonChange = {
    valid: false,
    reason: 'empty coding sequence',
    refCodon: '',
    altCodon: '',
    codonIndex: 0,
    hgvsC: '',
    hgvsP: '',
    refAa: '',
    altAa: '',
    transition: false,
    consequence: 'invalid',
    atTerminalCodon: false,
    baseOffset: 0,
    refOccurrences: 0,
  };

  if (typeof cds !== 'string' || cds.length === 0) return empty;
  if (!Number.isInteger(proteinPosition) || proteinPosition < 1) {
    return { ...empty, reason: 'protein position must be a positive integer' };
  }
  if (!isBase(refBase) || !isBase(altBase)) {
    return { ...empty, reason: 'reference and alternate bases must each be A, C, G or T' };
  }
  if (refBase === altBase) {
    return { ...empty, reason: 'a substitution requires two different bases' };
  }

  const offset = (proteinPosition - 1) * 3;
  const refCodon = cds.slice(offset, offset + 3).toUpperCase();
  if (refCodon.length !== 3 || [...refCodon].some((b) => !isBase(b))) {
    return { ...empty, reason: `codon ${proteinPosition} is not a complete ACGT triplet` };
  }

  let target = baseOffset;
  if (target !== undefined) {
    if (!Number.isInteger(target) || target < 0 || target > 2) {
      return { ...empty, reason: `codon base offset ${baseOffset} is out of range`, refCodon };
    }
    if (refCodon[target] !== refBase.toUpperCase()) {
      return {
        ...empty,
        reason: `codon position ${target} of ${refCodon} is ${refCodon[target]}, not ${refBase}`,
        refCodon,
      };
    }
  } else {
    target = refCodon.indexOf(refBase.toUpperCase());
  }

  const occurrences = [...refCodon].filter((b) => b === refBase.toUpperCase()).length;

  const upperRef = refBase.toUpperCase();
  const upperAlt = altBase.toUpperCase();
  const altCodon = refCodon.slice(0, target) + upperAlt + refCodon.slice(target + 1);

  const refAa = translateCodon(refCodon);
  const altAa = translateCodon(altCodon);
  const hgvsC = hgvsCodingChange(proteinPosition, target, upperRef, upperAlt);
  const atTerminalCodon = proteinPosition === 1 || refAa === '*';

  let consequence: Consequence;
  if (proteinPosition === 1 && altAa !== 'M') {
    consequence = 'start-loss';
  } else if (refAa !== '*' && altAa === '*') {
    consequence = 'nonsense';
  } else if (refAa === '*' && altAa !== '*') {
    consequence = 'stop-loss';
  } else if (refAa === altAa) {
    consequence = 'synonymous';
  } else {
    consequence = 'missense';
  }

  return {
    valid: true,
    refCodon,
    altCodon,
    codonIndex: proteinPosition,
    hgvsC,
    hgvsP: `p.${AA_NAMES[refAa] ?? 'Xaa'}${proteinPosition}${altAa === refAa ? '=' : AA_NAMES[altAa] ?? 'Xaa'}`,
    refAa,
    altAa,
    transition: isTransition(upperRef, upperAlt),
    consequence,
    atTerminalCodon,
    baseOffset: target,
    refOccurrences: occurrences,
  };
}

/**
 * Every single-nucleotide substitution at a protein position, ordered
 * deterministically, so the mutation scrub's dial never reshuffles between
 * renders or between two visitors looking at the same codon.
 */
export function substitutionDial(
  cds: string,
  proteinPosition: number,
): Array<{ altBase: string; change: CodonChange }> {
  const codonOffset = (proteinPosition - 1) * 3;
  const codon = typeof cds === 'string' ? cds.slice(codonOffset, codonOffset + 3).toUpperCase() : '';
  if (codon.length !== 3) return [];

  const out: Array<{ altBase: string; change: CodonChange }> = [];
  for (const change of [0, 1, 2].flatMap((i) =>
    DNA_BASES.filter((alt) => alt !== codon[i]).map((alt) =>
      applySubstitution(cds, proteinPosition, codon[i], alt, i),
    ),
  )) {
    out.push({ altBase: change.altCodon[change.baseOffset], change });
  }
  return out;
}

export function round(value: number, places: number): number {
  const f = 10 ** places;
  return Math.round(value * f) / f;
}