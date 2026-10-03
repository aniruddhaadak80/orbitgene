import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  AA_NAMES,
  CODON_TABLE,
  applySubstitution,
  formalCharge,
  isTransition,
  physicochemicalDisplacement,
  substitutionDial,
  substitutionsFor,
  translateCodon,
} from '@/lib/genetics';
import { parseCdsFeature, parseOrigin, expandLocation, reverseComplement } from '@/lib/sources/ncbi';

/** Real human insulin CDS, sealed in `sources/fallback.ts`. */
const INS_CDS =
  'ATGGCCCTGTGGATGCGCCTCCTGCCCCTGCTGGCGCTGCTGGCCCTCTGGGGACCTGACCCAGCCGCAGCCTTTGTGAACCAACACCTGTGCGGCTCACACCTGGTGGAAGCTCTCTACCTAGTGTGCGGGGAACGAGGCTTCTTCTACACACCCAAGACCCGCCGGGAGGCAGAGGACCTGCAGGTGGGGCAGGTGGAGCTGGGCGGGGGCCCTGGTGCAGGCAGCCTGCAGCCCTTGGCCCTGGAGGGGTCCCTGCAGAAGCGTGGCATTGTGGAACAATGCTGTACCAGCATCTGCTCCCTCTACCAGCTGGAGAACTACTGCAACTAG';

function translate(sequence: string): string {
  let out = '';
  for (let i = 0; i + 2 < sequence.length; i += 3) {
    const aa = translateCodon(sequence.slice(i, i + 3));
    if (aa === '*') break;
    out += aa;
  }
  return out;
}

describe('genetic code', () => {
  test('the real insulin CDS translates to the real insulin protein', () => {
    assert.equal(translate(INS_CDS), 'MALWMRLLPLLALLALWGPDPAAAFVNQHLCGSHLVEALYLVCGERGFFYTPKTRREAEDLQVGQVELGGGPGAGSLQPLALEGSLQKRGIVEQCCTSICSLYQLENYCN');
  });

  test('covers all 64 sense and stop codons', () => {
    assert.equal(Object.keys(CODON_TABLE).length, 64);
    for (const [codon, aa] of Object.entries(CODON_TABLE)) {
      assert.equal(codon.length, 3, `${codon} is not a triplet`);
      assert.ok(/^[A-Z*]$/.test(aa), `${codon} maps to ${aa}`);
    }
  });

  test('every standard residue has a three-letter name and a codon', () => {
    const aminoAcids = 'ACDEFGHIKLMNPQRSTVWY';
    assert.equal(aminoAcids.length, 20);
    for (const aa of aminoAcids) {
      assert.ok(AA_NAMES[aa], aa + ' has no name in AA_NAMES');
      assert.equal(AA_NAMES[aa].length, 3, aa + ' needs a three-letter name');
    }
    assert.equal(AA_NAMES['*'], 'Ter');
  });

  test('the codon table encodes exactly the 20 residues plus the stop', () => {
    const encoded = new Set(Object.values(CODON_TABLE));
    assert.equal(encoded.size, 21);
    assert.ok(encoded.has('*'));
    for (const aa of encoded) {
      if (aa === '*') continue;
      assert.ok(AA_NAMES[aa], aa + ' is encoded but has no name');
    }
  });
});

describe('isTransition', () => {
  test('separates purine and pyrimidine swaps correctly', () => {
    assert.equal(isTransition('A', 'G'), true);
    assert.equal(isTransition('C', 'T'), true);
    assert.equal(isTransition('A', 'C'), false);
    assert.equal(isTransition('G', 'T'), false);
    assert.equal(isTransition('A', 'T'), false);
    assert.equal(isTransition('G', 'C'), false);
  });
});

describe('applySubstitution', () => {
  test('derives a missense change with HGVS notation', () => {
    // Insulin codon 2 is GCC (Ala). Changing its second base C>T gives GTC (Val).
    // HGVS describes a change at the second codon position from the third base.
    const result = applySubstitution(INS_CDS, 2, 'C', 'T', 1);
    assert.equal(result.valid, true);
    assert.equal(result.refCodon, 'GCC');
    assert.equal(result.altCodon, 'GTC');
    assert.equal(result.refAa, 'A');
    assert.equal(result.altAa, 'V');
    assert.equal(result.consequence, 'missense');
    assert.equal(result.hgvsC, 'c.3-1C>T');
    assert.equal(result.hgvsP, 'p.Ala2Val');
    // C to T is a transition: both bases are pyrimidines.
    assert.equal(result.transition, true);
    assert.equal(result.atTerminalCodon, false);
    assert.equal(result.baseOffset, 1);
  });

  test('applies the HGVS 3-prime rule for the first codon position', () => {
    // Codon 2 is GCC; changing its first base shifts two bases toward the 3-prime end.
    const result = applySubstitution(INS_CDS, 2, 'G', 'T', 0);
    assert.equal(result.hgvsC, 'c.4-2G>T');
    assert.equal(result.altCodon, 'TCC');
  });

  test('writes a third-position change as a plain substitution', () => {
    const result = applySubstitution(INS_CDS, 2, 'C', 'T', 2);
    assert.equal(result.hgvsC, 'c.6C>T');
  });

  test('mutates the requested base offset in a homopolymeric codon', () => {
    // Codon 18 is GGA, so the two G bases are only distinguishable by offset.
    const second = applySubstitution(INS_CDS, 18, 'G', 'T', 1);
    assert.equal(second.altCodon, 'GTA');
    assert.equal(second.baseOffset, 1);
    assert.equal(second.refOccurrences, 2);

    const first = applySubstitution(INS_CDS, 18, 'G', 'T', 0);
    assert.equal(first.altCodon, 'TGA');
    assert.equal(first.baseOffset, 0);
    assert.equal(first.consequence, 'nonsense');
    assert.notEqual(second.hgvsC, first.hgvsC);
  });

  test('detects a nonsense change', () => {
    // Insulin codon 4 is TGG (Trp); changing its third base gives TGA.
    const result = applySubstitution(INS_CDS, 4, 'G', 'A', 2);
    assert.equal(result.valid, true);
    assert.equal(result.refCodon, 'TGG');
    assert.equal(result.altCodon, 'TGA');
    assert.equal(result.altAa, '*');
    assert.equal(result.consequence, 'nonsense');
    assert.equal(result.hgvsP, 'p.Trp4Ter');
    assert.equal(result.transition, true);
  });

  test('detects a synonymous change', () => {
    // Codon 2 GCC to GCT both encode alanine.
    const result = applySubstitution(INS_CDS, 2, 'C', 'T', 2);
    assert.equal(result.refCodon, 'GCC');
    assert.equal(result.altCodon, 'GCT');
    assert.equal(result.consequence, 'synonymous');
    assert.equal(result.hgvsP, 'p.Ala2=');
  });

  test('detects start loss at position 1', () => {
    // Codon 1 is ATG; changing its third base G>A gives ATA, which is isoleucine.
    const result = applySubstitution(INS_CDS, 1, 'G', 'A', 2);
    assert.equal(result.valid, true);
    assert.equal(result.refCodon, 'ATG');
    assert.equal(result.altCodon, 'ATA');
    assert.equal(result.consequence, 'start-loss');
    assert.equal(result.atTerminalCodon, true);
  });

  test('rejects an empty sequence', () => {
    const result = applySubstitution('', 2, 'C', 'T');
    assert.equal(result.valid, false);
    assert.equal(result.consequence, 'invalid');
    assert.match(result.reason ?? '', /empty/);
  });

  test('rejects non-ACGT bases', () => {
    assert.equal(applySubstitution(INS_CDS, 2, 'X', 'T').valid, false);
    assert.equal(applySubstitution(INS_CDS, 2, 'C', 'N').valid, false);
  });

  test('rejects a substitution with no change', () => {
    const result = applySubstitution(INS_CDS, 2, 'C', 'C');
    assert.equal(result.valid, false);
    assert.match(result.reason ?? '', /two different bases/);
  });

  test('rejects an explicit offset that does not hold the reference base', () => {
    const result = applySubstitution(INS_CDS, 2, 'C', 'T', 0);
    assert.equal(result.valid, false);
    assert.match(result.reason ?? '', /is G, not C/);
  });

  test('rejects an out-of-range codon offset', () => {
    assert.equal(applySubstitution(INS_CDS, 2, 'C', 'T', 3).valid, false);
    assert.equal(applySubstitution(INS_CDS, 2, 'C', 'T', -1).valid, false);
  });

  test('rejects a position beyond the sequence', () => {
    assert.equal(applySubstitution(INS_CDS, 500, 'C', 'T').valid, false);
  });

  test('rejects non-integer and non-positive positions', () => {
    assert.equal(applySubstitution(INS_CDS, 0, 'C', 'T').valid, false);
    assert.equal(applySubstitution(INS_CDS, -3, 'C', 'T').valid, false);
    assert.equal(applySubstitution(INS_CDS, 1.5, 'C', 'T').valid, false);
  });

  test('is case insensitive', () => {
    const lower = applySubstitution(INS_CDS.toLowerCase(), 2, 'c', 't', 1);
    assert.equal(lower.valid, true);
    assert.equal(lower.altCodon, 'GTC');
  });

  test('is deterministic for repeated calls', () => {
    const a = applySubstitution(INS_CDS, 7, 'C', 'G', 2);
    const b = applySubstitution(INS_CDS, 7, 'C', 'G', 2);
    assert.deepEqual(a, b);
  });
});

describe('substitutionDial', () => {
  test('returns every valid single-nucleotide substitution at a codon', () => {
    // A codon of three distinct bases admits 3 x 3 = 9 substitutions.
    const dial = substitutionDial(INS_CDS, 2);
    assert.equal(dial.length, 9);
    assert.ok(dial.every((d) => d.change.valid));
  });

  test('is ordered by codon position then alternate base', () => {
    const dial = substitutionDial(INS_CDS, 2);
    const keys = dial.map((d) => `${d.change.baseOffset}:${d.altBase}`);
    // Codon 2 of insulin is GCC, so position 0 excludes G, and positions 1 and 2
    // both exclude C.
    assert.deepEqual(keys, [
      '0:A', '0:C', '0:T',
      '1:A', '1:G', '1:T',
      '2:A', '2:G', '2:T',
    ]);
  });

  test('never returns the wild-type base', () => {
    const dial = substitutionDial(INS_CDS, 2);
    assert.ok(dial.every((d) => d.altBase !== d.change.refCodon[d.change.baseOffset]));
  });

  test('returns nothing for a position past the end', () => {
    assert.deepEqual(substitutionDial(INS_CDS, 900), []);
    assert.deepEqual(substitutionDial('', 1), []);
  });
});

describe('substitutionsFor', () => {
  test('always offers the other three bases in A,C,G,T order', () => {
    assert.deepEqual(substitutionsFor('A'), ['C', 'G', 'T']);
    assert.deepEqual(substitutionsFor('T'), ['A', 'C', 'G']);
  });
});

describe('physicochemicalDisplacement', () => {
  test('is zero for a residue against itself', () => {
    assert.equal(physicochemicalDisplacement('W', 'W'), 0);
  });

  test('is symmetric', () => {
    const a = physicochemicalDisplacement('R', 'W');
    const b = physicochemicalDisplacement('W', 'R');
    assert.equal(a, b);
  });

  test('stays inside 0 to 1', () => {
    for (const a of Object.keys(AA_NAMES)) {
      for (const b of Object.keys(AA_NAMES)) {
        const d = physicochemicalDisplacement(a, b);
        assert.ok(d >= 0 && d <= 1, `${a} to ${b} gave ${d}`);
      }
    }
  });

  test('a hydrophobic isomer swap is small', () => {
    // Isoleucine and leucine have identical residue volumes and differ by only
    // 0.7 hydropathy units, so every axis stays near the origin.
    assert.ok(physicochemicalDisplacement('I', 'L') < 0.25);
    assert.ok(physicochemicalDisplacement('I', 'V') < 0.25);
  });

  test('a charge reversal is large', () => {
    assert.ok(physicochemicalDisplacement('D', 'K') > 0.5);
    assert.ok(physicochemicalDisplacement('E', 'R') > 0.5);
  });

  test('ranks a conservative swap below a charge reversal', () => {
    assert.ok(physicochemicalDisplacement('I', 'V') < physicochemicalDisplacement('K', 'D'));
  });
});

describe('formalCharge', () => {
  test('gives histidine a partial positive charge', () => {
    assert.equal(formalCharge('D'), -1);
    assert.equal(formalCharge('E'), -1);
    assert.equal(formalCharge('K'), 1);
    assert.equal(formalCharge('R'), 1);
    assert.equal(formalCharge('H'), 0.5);
    assert.equal(formalCharge('A'), 0);
  });
});

describe('GenBank CDS parsing', () => {
  // Built programmatically so the declared length and the emitted bases cannot
  // drift apart.
  const genome = 'GTTACCGTAGCTTACGATCGGATCCAGTTACGCATCGATCGGCATCGACTACG'
    .repeat(3)
    .slice(0, 99);

  function originBlock(sequence: string): string[] {
    const out: string[] = ['ORIGIN'];
    for (let i = 0; i < sequence.length; i += 60) {
      const chunk = sequence.slice(i, i + 60);
      const groups = chunk.match(/.{1,10}/g) ?? [];
      out.push(`${String(i + 1).padStart(9)} ${groups.join(' ')}`);
    }
    return out;
  }

  const record = [
    'LOCUS       NM_000000             99 bp    mRNA    linear   PRI 01-JAN-2026',
    'DEFINITION  synthetic test record.',
    'FEATURES             Location/Qualifiers',
    '     source          1..99',
    '                     /organism="Homo sapiens"',
    '                     /mol_type="mRNA"',
    '     CDS             60..92',
    '                     /codon_start=1',
    '                     /protein_id="NP_000000.1"',
    '                     /translation="MKT"',
    '     sig_peptide     1..18',
    '                     /note="signal"',
    ...originBlock(genome),
    '//',
  ].join('\n');

  test('extracts the ORIGIN sequence without its line numbers', () => {
    const origin = parseOrigin(record);
    assert.ok(!/\d/.test(origin), 'digits must not survive the ORIGIN parse');
    assert.equal(origin.length, 99, `expected 99 bases, got ${origin.length}`);
    assert.equal(origin, genome);
  });

  test('the annotated window matches the record it was parsed from', () => {
    const feature = parseCdsFeature(record);
    const [start, end] = feature.segments[0];
    assert.equal(genome.slice(start - 1, end).length, end - start + 1);
    assert.equal(feature.complemented, false);
  });

  test('reads a plain forward CDS location and its protein id', () => {
    const feature = parseCdsFeature(record);
    assert.equal(feature.location, '60..92');
    assert.deepEqual(feature.segments, [[60, 92]]);
    assert.equal(feature.complemented, false);
    assert.equal(feature.proteinId, 'NP_000000.1');
  });

  test('does not swallow qualifier lines into the location', () => {
    // A naive continuation rule keyed on indentation alone concatenates
    // /codon_start and /protein_id into the coordinate string.
    assert.doesNotMatch(parseCdsFeature(record).location, /protein_id/);
  });

  test('still reads a wrapped join location', () => {
    const wrapped = [
      'LOCUS       NM_000001            200 bp    mRNA    linear   PRI 01-JAN-2026',
      'FEATURES             Location/Qualifiers',
      '     CDS             join(1..10,',
      '                     20..30)',
      '                     /protein_id="NP_000001.1"',
      'ORIGIN',
    ].join('\n');
    const feature = parseCdsFeature(wrapped);
    assert.equal(feature.location, 'join(1..10,20..30)');
    assert.equal(feature.proteinId, 'NP_000001.1');
    assert.deepEqual(feature.segments, [
      [1, 10],
      [20, 30],
    ]);
  });

  test('expands join() into sorted forward ranges', () => {
    const { ranges, complemented } = expandLocation('join(100..110,1..9,50..59)');
    assert.equal(complemented, false);
    assert.deepEqual(ranges, [
      [1, 9],
      [50, 59],
      [100, 110],
    ]);
  });

  test('flags a minus-strand feature', () => {
    const { ranges, complemented } = expandLocation('complement(join(50..59,1..9))');
    assert.equal(complemented, true);
    assert.deepEqual(ranges, [
      [1, 9],
      [50, 59],
    ]);
  });

  test('handles single-base and fuzzy locations', () => {
    assert.deepEqual(expandLocation('123').ranges, [[123, 123]]);
    assert.deepEqual(expandLocation('<1..>9').ranges, [[1, 9]]);
  });

  test('rejects a record with no CDS feature', () => {
    assert.throws(() => parseCdsFeature('LOCUS x\n//\n'), /no CDS feature/);
  });

  test('throws on a malformed ORIGIN block', () => {
    assert.throws(() => parseOrigin('LOCUS x\n//\n'), /no ORIGIN block/);
  });
});

describe('reverseComplement', () => {
  test('is its own inverse', () => {
    const seq = 'ATGGCCCTGTGGATGCGCCTCCTGCCCCTGCTG';
    assert.equal(reverseComplement(reverseComplement(seq)), seq);
  });

  test('is self-palindromic for a palindromic oligo', () => {
    assert.equal(reverseComplement('GAATTC'), 'GAATTC');
    assert.equal(reverseComplement('GGATCC'), 'GGATCC');
  });
});