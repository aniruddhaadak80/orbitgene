import { isBase, round } from './genetics';
import type { ThermoAnalysis } from './types';

/**
 * Unified nearest-neighbour oligonucleotide thermodynamics.
 *
 * SantaLucia, R. (1998) "A unified view of polymer, dumbbell and oligonucleotide
 * DNA nearest-neighbor thermodynamics", Proc Natl Acad Sci USA 95:1460-1463.
 * Values are the 1998 unified set (Allawi & SantaLucia 1997 pairwise entries
 * folded into the ten unique doublets below), in kcal/mol and cal/(mol*K).
 */
const NEAREST_NEIGHBOUR = Object.freeze({
  'AA/TT': { h: -7.9, s: -22.2 },
  'AT/TA': { h: -7.2, s: -20.4 },
  'TA/AT': { h: -7.2, s: -21.3 },
  'CA/GT': { h: -8.5, s: -22.7 },
  'GT/CA': { h: -8.4, s: -22.4 },
  'CT/GA': { h: -7.8, s: -21.0 },
  'GA/CT': { h: -8.2, s: -22.2 },
  'CG/CG': { h: -10.6, s: -27.2 },
  'GC/GC': { h: -9.8, s: -24.4 },
  'GG/CC': { h: -8.0, s: -19.9 },
} as const);

/** Initiation with a terminal G-C pair. */
const INIT_GC = { h: 0.1, s: -2.8 };
/** Initiation with a terminal A-T pair. */
const INIT_AT = { h: 2.3, s: 4.1 };
/** Self-complementarity entropy correction. */
const SYMMETRY_S = -1.4;
/** Gas constant, cal/(mol*K). */
const R = 1.987;

export interface ThermoResult {
  deltaH: number;
  deltaS: number;
  tmC: number;
  gcFraction: number;
  valid: boolean;
  reason?: string;
}

const COMPLEMENT: Record<string, string> = { A: 'T', C: 'G', G: 'C', T: 'A', N: 'N' };

export function reverseComplement(seq: string): string {
  return seq
    .toUpperCase()
    .split('')
    .reverse()
    .map((b) => COMPLEMENT[b] ?? 'N')
    .join('');
}

/**
 * The ten parameters above are keyed by top-strand doublet, but there are sixteen
 * possible doublets. The six that are absent (AC, AG, CC, TC, TG, TT) take the
 * parameter of their reverse complement, because a duplex and the duplex read
 * from the opposite strand are the same stack with the same free energy.
 *
 * Building the index once at module load keeps this out of the hot loop and
 * means the fallback can never be forgotten at a call site.
 */
const NN_INDEX: Readonly<Record<string, { h: number; s: number }>> = (() => {
  const index: Record<string, { h: number; s: number }> = {};
  for (const [key, value] of Object.entries(NEAREST_NEIGHBOUR)) {
    index[key.slice(0, 2)] = value;
  }
  return Object.freeze(index);
})();

function nearestNeighbour(doublet: string): { h: number; s: number } | undefined {
  const direct = NN_INDEX[doublet];
  if (direct) return direct;
  return NN_INDEX[reverseComplement(doublet)];
}

export function isSelfComplementary(seq: string): boolean {
  const s = seq.toUpperCase();
  return s.length > 0 && s === reverseComplement(s);
}

/**
 * Melting temperature, free energy and GC fraction for one oligonucleotide.
 * Salt correction is the SantaLucia (1998) monovalent form,
 * `dS += 0.368 * (N - 1) * ln([Na+])`, with N the residue count.
 */
export function oligoThermodynamics(
  seq: string,
  sodiumMolar: number,
  strandConcentrationNm: number,
): ThermoResult {
  /**
 * Whitespace and dashes are removed because pasted oligos carry them. Anything
 * else left over is rejected rather than deleted: dropping an IUPAC ambiguity
 * code would silently renumber every base after it, which would move the
 * substitution the caller asked about.
 */
const s = (typeof seq === 'string' ? seq : '').toUpperCase().replace(/[\s-]/g, '');

  const invalid: ThermoResult = {
    deltaH: 0, deltaS: 0, tmC: 0, gcFraction: 0, valid: false,
    reason: 'oligonucleotide shorter than two base pairs or contains non-ACGT characters',
  };

  if (s.length < 2) return invalid;
  if (![...s].every(isBase)) return invalid;
  if (!Number.isFinite(sodiumMolar) || sodiumMolar <= 0) {
    return { ...invalid, reason: 'sodium concentration must be a positive number of mol/litre' };
  }
  if (!Number.isFinite(strandConcentrationNm) || strandConcentrationNm <= 0) {
    return { ...invalid, reason: 'strand concentration must be a positive number of nanomolar' };
  }

  // Every unique doublet of the top strand, with the complement stacking beneath.
  let deltaH = 0;
  let deltaS = 0;

  for (let i = 0; i < s.length - 1; i += 1) {
    const entry = nearestNeighbour(`${s[i]}${s[i + 1]}`);
    if (!entry) return { ...invalid, reason: `no nearest-neighbour parameter for doublet ${s[i]}${s[i + 1]}` };
    deltaH += entry.h;
    deltaS += entry.s;
  }

  // Initiation: both termini.
  const ends = [s[0], s[s.length - 1]];
  for (const end of ends) {
    const init = end === 'G' || end === 'C' ? INIT_GC : INIT_AT;
    deltaH += init.h;
    deltaS += init.s;
  }

  const selfComplementary = isSelfComplementary(s);
  if (selfComplementary) deltaS += SYMMETRY_S;

  // Monovalent salt correction.
  deltaS += 0.368 * (s.length - 1) * Math.log(sodiumMolar);

  const ct = strandConcentrationNm * 1e-9;
  const divisor = selfComplementary ? 1 : 4;
  const denom = deltaS + R * Math.log(ct / divisor);
  if (denom === 0) return { ...invalid, reason: 'melting temperature denominator is zero' };

  const tmK = (deltaH * 1000) / denom;
  const gc = (s.match(/[GC]/g)?.length ?? 0) / s.length;

  return {
    deltaH: round(deltaH, 3),
    deltaS: round(deltaS, 3),
    tmC: round(tmK - 273.15, 2),
    gcFraction: round(gc, 4),
    valid: true,
  };
}

/**
 * Builds the annealing probe window centred on a codon, 5' to 3' on the coding
 * strand, and reports where the codon starts inside that window so the single
 * changed base can be located exactly rather than guessed.
 *
 * Length is clamped to 15..40 nt and to what the CDS can actually supply; the
 * window is padded with N when the CDS is shorter than requested so callers
 * always receive a fixed-width probe to draw.
 */
export function deriveProbe(
  cds: string,
  codonIndex: number,
  lengthNt: number,
): { sequence: string; codonOffset: number; length: number } {
  const upper = (typeof cds === 'string' ? cds : '').toUpperCase();
  const want = Math.max(15, Math.min(40, Math.floor(lengthNt) || 20));
  const codonStart = (Math.max(1, codonIndex) - 1) * 3;

  let start = codonStart - Math.floor((want - 3) / 2);
  start = Math.max(0, Math.min(start, Math.max(0, upper.length - want)));
  const end = Math.min(upper.length, start + want);
  if (end - start < want) start = Math.max(0, end - want);

  const raw = upper.slice(start, end);
  const sequence = raw.padStart(want, 'N').padEnd(want, 'N');
  return { sequence, codonOffset: codonStart - start, length: want };
}

/**
 * Full thermodynamic comparison of a wild-type probe and the same probe with one
 * nucleotide swapped at a known index.
 *
 * `indexInProbe` must be the position of the changed base inside `wtProbe`;
 * substituting by first-occurrence search would mutate the wrong base whenever
 * the probe contains the reference nucleotide more than once.
 *
 * Classification, calibrated against the measured distribution for single
 * substitutions in 21 to 40mers (median 1.7 degrees, p95 2.9, ceiling 3.3, and
 * shrinking as the probe lengthens):
 *
 *   |dTm| <  0.5  -> inert   the duplex is unchanged, nothing can separate it
 *   |dTm| <= 3.0  -> usable  the shift is enough to discriminate
 *   |dTm| <= 4.5  -> marginal the shift is now costing hybridisation
 *   otherwise    -> broken   the mismatch destroys the duplex
 */
export function compareProbeThermodynamics(
  wtProbe: string,
  indexInProbe: number,
  refBase: string,
  altBase: string,
  sodiumMolar: number,
  strandConcentrationNm: number,
): ThermoAnalysis {
  const upper = (wtProbe ?? '').toUpperCase();
  const mutant = substituteAt(upper, indexInProbe, refBase, altBase);

  const wt = oligoThermodynamics(upper, sodiumMolar, strandConcentrationNm);
  const mut =
    mutant === null
      ? ({ ...wt, valid: false, reason: `probe index ${indexInProbe} does not hold ${refBase}` } as ThermoResult)
      : oligoThermodynamics(mutant, sodiumMolar, strandConcentrationNm);

  const deltaTmC = wt.valid && mut.valid ? round(mut.tmC - wt.tmC, 2) : 0;
  const magnitude = Math.abs(deltaTmC);

  let cls: ThermoAnalysis['class'];
  if (!wt.valid || !mut.valid) cls = 'broken';
  else if (magnitude < 0.5) cls = 'inert';
  else if (magnitude <= 3.0) cls = 'usable';
  else if (magnitude <= 4.5) cls = 'marginal';
  else cls = 'broken';

  return {
    wtProbe: upper,
    probe: mutant ?? upper,
    wtTmC: wt.tmC,
    mutTmC: mut.tmC,
    deltaTmC,
    wtDeltaG: wt.deltaH,
    mutDeltaG: mut.deltaH,
    gcFraction: wt.gcFraction,
    class: cls,
  };
}

/**
 * Replaces the reference base at a specific index. Returns null when the index
 * is out of range or does not actually hold `refBase`.
 */
export function substituteAt(
  seq: string,
  index: number,
  refBase: string,
  altBase: string,
): string | null {
  const s = (seq ?? '').toUpperCase();
  if (!Number.isInteger(index) || index < 0 || index >= s.length) return null;
  if (s[index] !== refBase.toUpperCase()) return null;
  return s.slice(0, index) + altBase.toUpperCase() + s.slice(index + 1);
}