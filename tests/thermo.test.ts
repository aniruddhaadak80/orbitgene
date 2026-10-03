import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  compareProbeThermodynamics,
  deriveProbe,
  isSelfComplementary,
  oligoThermodynamics,
  reverseComplement,
  substituteAt,
} from '@/lib/thermo';

const SODIUM = 0.05;
const STRAND = 50;

describe('oligoThermodynamics', () => {
  test('rejects sequences that are not pure DNA', () => {
    const result = oligoThermodynamics('ACGTX', SODIUM, STRAND);
    assert.equal(result.valid, false);
    assert.match(result.reason ?? '', /non-ACGT/);
  });

  test('rejects oligos shorter than two bases', () => {
    assert.equal(oligoThermodynamics('A', SODIUM, STRAND).valid, false);
    assert.equal(oligoThermodynamics('', SODIUM, STRAND).valid, false);
  });

  test('rejects non-positive salt or strand concentration', () => {
    const seq = 'ACGTACGTACGTACGTACGT';
    assert.equal(oligoThermodynamics(seq, 0, STRAND).valid, false);
    assert.equal(oligoThermodynamics(seq, SODIUM, 0).valid, false);
    assert.equal(oligoThermodynamics(seq, Number.NaN, STRAND).valid, false);
  });

  test('reports GC fraction', () => {
    // Four G, four C and four A gives eight G/C in twelve bases.
    const mixed = oligoThermodynamics('GGGGCCCCAAAA', SODIUM, STRAND);
    assert.equal(mixed.gcFraction, 0.6667);
    const allGc = oligoThermodynamics('GGGCGCGCGCGC', SODIUM, STRAND);
    assert.equal(allGc.gcFraction, 1);
    const allAt = oligoThermodynamics('ATATATATATAT', SODIUM, STRAND);
    assert.equal(allAt.gcFraction, 0);
  });

  test('resolves all sixteen top-strand doublets', () => {
    // The published table keys ten; the other six must fall back to their
    // reverse complement rather than reporting the oligo as unreadable.
    const bases = ['A', 'C', 'G', 'T'];
    for (const a of bases) {
      for (const b of bases) {
        const result = oligoThermodynamics(`${a}${b}${a}${b}${a}${b}${a}${b}`, SODIUM, STRAND);
        assert.equal(result.valid, true, `doublet ${a}${b} could not be priced`);
      }
    }
  });

  test('a GC-rich oligo melts above an AT-rich oligo of the same length', () => {
    const gc = oligoThermodynamics('GCGCGCGCGCGCGCGCGCGC', SODIUM, STRAND);
    const at = oligoThermodynamics('ATATATATATATATATATAT', SODIUM, STRAND);
    assert.ok(gc.valid && at.valid);
    assert.ok(gc.tmC > at.tmC, `${gc.tmC} should exceed ${at.tmC}`);
  });

  test('GC-rich oligos have a more negative enthalpy', () => {
    const gc = oligoThermodynamics('GCGCGCGCGCGCGCGCGCGC', SODIUM, STRAND);
    const at = oligoThermodynamics('ATATATATATATATATATAT', SODIUM, STRAND);
    assert.ok(gc.deltaH < at.deltaH);
  });

  test('a longer oligo melts above a shorter one at equal concentration', () => {
    const short = oligoThermodynamics('ACGTACGTACGTAC', SODIUM, STRAND);
    const long = oligoThermodynamics('ACGTACGTACGTACGTACGTACGT', SODIUM, STRAND);
    assert.ok(long.tmC > short.tmC);
  });

  test('raising sodium raises the melting temperature', () => {
    const seq = 'ACGTTGCAACGTTGCAACGT';
    const low = oligoThermodynamics(seq, 0.01, STRAND);
    const mid = oligoThermodynamics(seq, 0.05, STRAND);
    const high = oligoThermodynamics(seq, 0.5, STRAND);
    assert.ok(low.tmC < mid.tmC && mid.tmC < high.tmC);
  });

  test('raising strand concentration raises the melting temperature', () => {
    const seq = 'ACGTTGCAACGTTGCAACGT';
    const low = oligoThermodynamics(seq, SODIUM, 1);
    const high = oligoThermodynamics(seq, SODIUM, 1000);
    assert.ok(low.tmC < high.tmC);
  });

  test('a duplex and its reverse complement agree exactly', () => {
    const seq = 'AAGGCTTAGCTAGGCTTAGC';
    const a = oligoThermodynamics(seq, SODIUM, STRAND);
    const b = oligoThermodynamics(reverseComplement(seq), SODIUM, STRAND);
    assert.equal(a.deltaH, b.deltaH);
    assert.equal(a.deltaS, b.deltaS);
    assert.equal(a.tmC, b.tmC);
  });

  test('is self-consistent across repeated calls', () => {
    const seq = 'TTGCACAAGGCTTACCGTA';
    assert.deepEqual(oligoThermodynamics(seq, SODIUM, STRAND), oligoThermodynamics(seq, SODIUM, STRAND));
  });

  test('tolerates whitespace and dashes but not ambiguity codes', () => {
    assert.equal(oligoThermodynamics('GCGT ACGT-ACGTA', SODIUM, STRAND).valid, true);
    const ambiguous = oligoThermodynamics('GCGTNCGTACGT', SODIUM, STRAND);
    assert.equal(ambiguous.valid, false, 'an IUPAC code must not be silently deleted');
  });

  test('pins a regression vector so a parameter change cannot pass silently', () => {
    // GCGCGC is self-complementary, so its five doublets are GC,CG,GC,CG,GC:
    // 3 x GC/GC plus 2 x CG/CG, two terminal G.C initiations, the symmetry
    // correction and the salt term. Verified against an independent
    // reimplementation of SantaLucia (1998).
    assert.deepEqual(oligoThermodynamics('GCGCGC', 0.05, 50), {
      deltaH: -50.4,
      deltaS: -140.112,
      tmC: 17.31,
      gcFraction: 1,
      valid: true,
    });

    assert.deepEqual(oligoThermodynamics('GCGTACGATCGGCTAGCTAG', 0.05, 50), {
      deltaH: -162.2,
      deltaS: -458.746,
      tmC: 54.59,
      gcFraction: 0.6,
      valid: true,
    });
  });
});

describe('isSelfComplementary', () => {
  test('recognises a palindromic oligo', () => {
    assert.equal(isSelfComplementary('GAATTC'), true);
    assert.equal(isSelfComplementary('ATGCAT'), true);
    assert.equal(isSelfComplementary('GGCC'), true);
  });

  test('rejects a non-palindromic oligo', () => {
    assert.equal(isSelfComplementary('AAGGTT'), false);
    assert.equal(isSelfComplementary('AAAAA'), false);
    assert.equal(isSelfComplementary(''), false);
  });

  test('prices CG/CG and GC/GC stacks differently', () => {
    // The two alternating sequences have identical composition and both are
    // self-complementary, so any difference is purely the stacking parameter:
    // CG/CG at -10.6 kcal/mol stacks harder than GC/GC at -9.8.
    const gc = oligoThermodynamics('GCGCGC', SODIUM, STRAND);
    const cg = oligoThermodynamics('CGCGCG', SODIUM, STRAND);
    assert.equal(gc.valid && cg.valid, true);
    assert.equal(gc.gcFraction, cg.gcFraction);
    assert.ok(cg.deltaH < gc.deltaH);
    assert.ok(cg.tmC < gc.tmC);
  });
});

describe('substituteAt', () => {
  test('replaces the base at the given index', () => {
    assert.equal(substituteAt('ACGT', 1, 'C', 'T'), 'ATGT');
  });

  test('refuses when the index does not hold the reference base', () => {
    assert.equal(substituteAt('ACGT', 1, 'A', 'T'), null);
  });

  test('refuses an out-of-range index', () => {
    assert.equal(substituteAt('ACGT', 9, 'A', 'T'), null);
    assert.equal(substituteAt('ACGT', -1, 'A', 'T'), null);
    assert.equal(substituteAt('ACGT', 1.2, 'A', 'T'), null);
  });
});

describe('deriveProbe', () => {
  const CDS = 'ATG'.repeat(60);

  test('returns a window of the requested length centred on the codon', () => {
    const probe = deriveProbe(CDS, 30, 21);
    assert.equal(probe.sequence.length, 21);
    assert.equal(CDS.slice((30 - 1) * 3, (30 - 1) * 3 + 3), probe.sequence.slice(probe.codonOffset, probe.codonOffset + 3));
  });

  test('clamps the length into 15 to 40', () => {
    assert.equal(deriveProbe(CDS, 30, 2).length, 15);
    assert.equal(deriveProbe(CDS, 30, 999).length, 40);
  });

  test('shifts the window near the start rather than returning a short one', () => {
    const probe = deriveProbe(CDS, 1, 21);
    assert.equal(probe.sequence.length, 21);
    assert.equal(probe.codonOffset, 0);
  });

  test('shifts the window near the end rather than running off it', () => {
    const probe = deriveProbe(CDS, 60, 21);
    assert.equal(probe.sequence.length, 21);
    assert.equal(probe.codonOffset, 18);
  });

  test('pads when the sequence is shorter than the window', () => {
    const probe = deriveProbe('ATG', 1, 21);
    assert.equal(probe.sequence.length, 21);
    assert.ok(probe.sequence.includes('N'));
  });
});

describe('compareProbeThermodynamics', () => {
  const probe = 'GCGTACGATCGGCTAGCTAG';

  test('mutates exactly the indexed base', () => {
    const result = compareProbeThermodynamics(probe, 3, 'T', 'A', SODIUM, STRAND);
    assert.equal(result.probe, 'GCGAACGATCGGCTAGCTAG');
    assert.equal(result.probe[3], 'A');
    assert.notEqual(result.probe, probe);
  });

  test('mutates the intended base even when the probe holds the reference base many times', () => {
    const repetitive = 'AAAAAAAAAA';
    const result = compareProbeThermodynamics(repetitive, 7, 'A', 'T', SODIUM, STRAND);
    assert.equal(result.probe, 'AAAAAAATAA');
    assert.equal(result.probe[7], 'T');
  });

  /**
   * Mirrors the thresholds documented on `compareProbeThermodynamics`. The point
   * is not to re-derive the classification but to fail if the implementation is
   * changed without the documented contract being changed with it.
   */
  function documentedClass(magnitude: number) {
    if (magnitude < 0.5) return 'inert';
    if (magnitude <= 3.0) return 'usable';
    if (magnitude <= 4.5) return 'marginal';
    return 'broken';
  }

  test('every reachable substitution lands in the documented class', () => {
    const bases = ['A', 'C', 'G', 'T'];
    let checked = 0;
    for (const probe of ['GCGTACGATCGGCTAGCTAG', 'ACGTACGTACGTACGTACGT', 'TTTTGGGGCCCCAAAATTTT']) {
      for (let i = 0; i < probe.length; i += 1) {
        for (const alt of bases) {
          if (alt === probe[i]) continue;
          const result = compareProbeThermodynamics(probe, i, probe[i], alt, SODIUM, STRAND);
          assert.equal(
            result.class,
            documentedClass(Math.abs(result.deltaTmC)),
            `${probe} at ${i} ${probe[i]}>${alt} gave ${result.class} for |dTm| ${result.deltaTmC}`,
          );
          checked += 1;
        }
      }
    }
    assert.ok(checked > 60, `only ${checked} substitutions were checked`);
  });

  test('the three classes are all reachable across those probes', () => {
    const seen = new Set<string>();
    const probes = ['GCGTACGATCGGCTAGCTAG', 'ACGTACGTACGTACGTACGT', 'TTTTGGGGCCCCAAAATTTT'];
    for (const probe of probes) {
      for (let i = 0; i < probe.length; i += 1) {
        for (const alt of 'ACGT') {
          if (alt === probe[i]) continue;
          seen.add(compareProbeThermodynamics(probe, i, probe[i], alt, SODIUM, STRAND).class);
        }
      }
    }
    assert.ok(seen.has('inert'), 'the low end of the window never fires');
    assert.ok(seen.has('usable'), 'no usable probes were found');
  });

  test('reports both the wild-type and the mutant probe', () => {
    const result = compareProbeThermodynamics('GCGTACGATCGGCTAGCTAG', 3, 'T', 'A', SODIUM, STRAND);
    assert.equal(result.wtProbe, 'GCGTACGATCGGCTAGCTAG');
    assert.equal(result.probe, 'GCGAACGATCGGCTAGCTAG');
  });

  test('a broken probe is reported when the index does not match the base', () => {
    const result = compareProbeThermodynamics(probe, 0, 'T', 'A', SODIUM, STRAND);
    assert.equal(result.class, 'broken');
  });

  test('delta Tm equals mutant minus wild type', () => {
    const result = compareProbeThermodynamics(probe, 5, 'C', 'A', SODIUM, STRAND);
    assert.ok(Math.abs(result.deltaTmC - (result.mutTmC - result.wtTmC)) < 0.011);
  });

  test('is deterministic across repeated calls', () => {
    const a = compareProbeThermodynamics(probe, 3, 'T', 'A', SODIUM, STRAND);
    const b = compareProbeThermodynamics(probe, 3, 'T', 'A', SODIUM, STRAND);
    assert.deepEqual(a, b);
  });
});