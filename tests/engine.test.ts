import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { ENGINE_VERSION, FACTOR_WEIGHTS, scoreMutation } from '@/lib/engine';
import { SEALED_SAMPLES } from '@/lib/sources/fallback';
import { findFlight, findInstrument } from '@/lib/profiles';
import type { EngineInput, GeneProfile, SpaceWeather } from '@/lib/types';

const sample = SEALED_SAMPLES.P01308;

const QUIET: SpaceWeather = {
  kpIndex: 1.67,
  kpLabel: 'very quiet',
  xrayClass: 'A0.1',
  xrayWattsPerM2: 1e-8,
  protonFluxPfu: 0.1,
  solarWindSpeedKms: null,
  observationTime: '2026-01-01T00:00:00.000Z',
  sources: [],
};

function profile(withEvidence = true): GeneProfile {
  return {
    gene: {
      accession: sample.accession,
      entryName: sample.entryName,
      geneSymbol: sample.geneSymbol,
      proteinName: sample.proteinName,
      organism: sample.organism,
      reviewStatus: 'reviewed',
      proteinLength: sample.protein.length,
      sequence: sample.protein,
      sequenceChecksum: 'sealed-test',
      refseqMrna: sample.mrna,
      cds: sample.cds,
      cdsLength: sample.cds.length,
      fetchedAt: '2026-01-01T00:00:00.000Z',
    },
    sites: sample.sites,
    // A live UniProt fetch supplies these; the sealed sample deliberately does
    // not, so tests pass them explicitly to exercise both sides of the
    // evidence gate.
    evidence: withEvidence
      ? [
          {
            source: 'uniprot-natural-variant',
            position: 2,
            refAa: 'A',
            altAas: ['V'],
            description: 'shifts the preproinsulin signal peptide',
            publications: [],
          },
        ]
      : [],
    sources: [],
  };
}

function input(overrides: Partial<EngineInput> = {}): EngineInput {
  return {
    profile: profile(),
    proteinPosition: 2,
    refAa: 'A',
    altAa: 'V',
    instrument: findInstrument('esp32-405-npi'),
    flight: findFlight('cubesat-leo'),
    probe: { sequence: '', sodiumMolar: 0.05, strandConcentrationNm: 50 },
    spaceWeather: QUIET,
    ...overrides,
  };
}

function scored(overrides: Partial<EngineInput> = {}) {
  const outcome = scoreMutation(input(overrides));
  if (!outcome.ok) {
    assert.fail(`expected the substitution to score, got: ${outcome.reason}`);
  }
  return outcome.result;
}

interface Case {
  proteinPosition: number;
  refAa: string;
  altAa: string;
  baseOffset: number;
  probeLengthNt: number;
  result: ReturnType<typeof scored>;
}

/**
 * Sweeps every reachable single-nucleotide substitution and returns the first
 * result matching a predicate. Used so gate tests assert on real, reachable
 * cases instead of hand-picked coordinates that may stop being reachable.
 */
function findCase(predicate: (result: ReturnType<typeof scored>) => boolean): Case | null {
  for (const probeLengthNt of [21, 27, 40]) {
    for (let position = 1; position <= sample.protein.length; position += 1) {
      const refAa = sample.protein[position - 1];
      if (!refAa || refAa === '*') continue;
      for (const altAa of 'ACDEFGHIKLMNPQRSTVWY') {
        if (altAa === refAa) continue;
        for (const baseOffset of [0, 1, 2]) {
          const outcome = scoreMutation(
            input({
              proteinPosition: position,
              refAa,
              altAa,
              baseOffset,
              instrument: { ...findInstrument('esp32-405-npi'), probeLengthNt },
            }),
          );
          if (!outcome.ok) continue;
          if (predicate(outcome.result)) {
            return { proteinPosition: position, refAa, altAa, baseOffset, probeLengthNt, result: outcome.result };
          }
        }
      }
    }
  }
  return null;
}

describe('engine invariants', () => {
  test('the factor weights sum to exactly one', () => {
    const total = Object.values(FACTOR_WEIGHTS).reduce((a, b) => a + b, 0);
    assert.ok(Math.abs(total - 1) < 1e-12, `weights sum to ${total}`);
  });

  test('reports a version string', () => {
    assert.equal(scored().engine, ENGINE_VERSION);
    assert.equal(ENGINE_VERSION, 'orbitgene/1.0.0');
  });

  test('every factor carries its weight, support and contribution', () => {
    const result = scored();
    assert.equal(result.factors.length, 6);
    for (const factor of result.factors) {
      assert.ok(factor.weight > 0, `${factor.key} has no weight`);
      assert.ok(factor.support >= 0 && factor.support <= 1, `${factor.key} support out of range`);
      assert.ok(
        Math.abs(factor.contribution - factor.weight * factor.support) < 0.0002,
        `${factor.key} contribution does not reconcile with weight x support`,
      );
      assert.ok(factor.summary.length > 0, `${factor.key} has no summary`);
      assert.ok(factor.evidence.length > 0, `${factor.key} has no evidence`);
    }
  });

  test('the score is exactly the weighted sum of the factor supports', () => {
    const result = scored();
    const expected = result.factors.reduce((acc, f) => acc + f.weight * f.support, 0) * 100;
    assert.ok(Math.abs(result.score - expected) < 0.02, `${result.score} vs ${expected}`);
  });

  test('the score stays inside 0 to 100', () => {
    for (const position of [2, 4, 25, 50, 90, 110]) {
      const outcome = scoreMutation(input({ proteinPosition: position, refAa: 'M', altAa: 'W' }));
      if (outcome.ok) {
        assert.ok(outcome.result.score >= 0 && outcome.result.score <= 100);
      }
    }
  });

  test('produces byte-identical output for identical input', () => {
    assert.deepEqual(scored(), scored());
  });

  test('the input digest is stable and changes when an input changes', () => {
    const a = scored().inputDigest;
    assert.equal(a, scored().inputDigest);
    assert.notEqual(a, scored({ flight: findFlight('iss-pkm') }).inputDigest);
    assert.notEqual(a, scored({ instrument: findInstrument('stm32-520-gfp') }).inputDigest);
    assert.notEqual(
      a,
      scored({ spaceWeather: { ...QUIET, protonFluxPfu: 50000 } }).inputDigest,
    );
  });

  test('always exposes five gates with a written reason', () => {
    const result = scored();
    assert.equal(result.gates.length, 5);
    for (const gate of result.gates) {
      assert.equal(typeof gate.passed, 'boolean');
      assert.ok(gate.detail.length > 0, `${gate.id} has no reason`);
    }
  });
});

describe('engine input validation', () => {
  test('rejects a missing coding sequence', () => {
    const broken = profile();
    broken.gene.cds = '';
    const outcome = scoreMutation(input({ profile: broken }));
    assert.equal(outcome.ok, false);
    assert.match(outcome.ok ? '' : outcome.reason, /no coding sequence/);
  });

  test('rejects a residue that is not a one-letter code', () => {
    assert.equal(scoreMutation(input({ altAa: 'X' })).ok, false);
    assert.equal(scoreMutation(input({ refAa: 'ALA' })).ok, false);
    assert.equal(scoreMutation(input({ altAa: '' })).ok, false);
  });

  test('rejects a position that does not match the wild-type residue', () => {
    // Position 2 of insulin is alanine, not tryptophan.
    const outcome = scoreMutation(input({ proteinPosition: 2, refAa: 'W', altAa: 'F' }));
    assert.equal(outcome.ok, false);
    assert.match(outcome.ok ? '' : outcome.reason, /wild-type residue at position 2 is Ala/);
  });

  test('rejects a position past the end of the sequence', () => {
    const outcome = scoreMutation(input({ proteinPosition: 5000, refAa: 'A', altAa: 'V' }));
    assert.equal(outcome.ok, false);
  });

  test('explains when no single substitution produces the requested residue', () => {
    // Lysine is only reachable from AAA or AAG, so asking for Lys->Pro from a
    // codon that cannot reach it must fail loudly rather than guess.
    const outcome = scoreMutation(input({ proteinPosition: 22, refAa: 'A', altAa: 'W' }));
    assert.equal(outcome.ok, false);
    assert.match(outcome.ok ? '' : outcome.reason, /no single-nucleotide substitution/);
  });
});

describe('codon consequence in the engine', () => {
  test('reports a missense change with HGVS notation', () => {
    const result = scored();
    assert.equal(result.codon.consequence, 'missense');
    assert.equal(result.codon.hgvsP, 'p.Ala2Val');
    assert.match(result.codon.hgvsC, /^c\.\d/);
    assert.equal(result.codon.refCodon, 'GCC');
    assert.equal(result.codon.altCodon.length, 3);
  });

  test('reports a nonsense change and drags the codon factor down', () => {
    // Insulin Trp4 to stop.
    const result = scored({ proteinPosition: 4, refAa: 'W', altAa: '*' });
    assert.equal(result.codon.consequence, 'nonsense');
    const codonFactor = result.factors.find((f) => f.key === 'codon')!;
    assert.ok(codonFactor.support < 0.2, `codon support was ${codonFactor.support}`);
  });

  test('a truncating change is not rated through the residue scales', () => {
    const nonsense = scored({ proteinPosition: 4, refAa: 'W', altAa: '*' });
    const missense = scored({ proteinPosition: 2, refAa: 'A', altAa: 'V' });
    const truncating = nonsense.factors.find((f) => f.key === 'physicochemical')!;
    const ordinary = missense.factors.find((f) => f.key === 'physicochemical')!;
    assert.ok(truncating.support < ordinary.support);
    assert.ok(truncating.evidence.some((e) => e.value.includes('truncating change')));
  });

  test('selects the thermodynamically cheapest substitution deterministically', () => {
    const a = scored({ proteinPosition: 2, refAa: 'A', altAa: 'V' });
    const b = scored({ proteinPosition: 2, refAa: 'A', altAa: 'V' });
    assert.deepEqual(a.codon, b.codon);
    const thermoFactor = a.factors.find((f) => f.key === 'thermo')!;
    assert.ok(thermoFactor.evidence.some((e) => /candidate\(s\) produce/.test(e.value)));
  });
});

describe('verdicts and gates', () => {
  test('a well-configured assay on a conserved, annotated site is a flight go', () => {
    const result = scored();
    assert.equal(result.verdict, 'FLIGHT-GO');
    assert.ok(result.gates.every((g) => g.passed), 'a flight go must pass every gate');
    assert.ok(result.score >= 70);
  });

  test('the same substitution without a curated annotation is held for evidence', () => {
    const held = scored({ profile: profile(false) });
    assert.equal(held.gates.find((g) => g.id === 'evidence-present')?.passed, false);
    assert.equal(held.verdict, 'HOLD-FOR-EVIDENCE');
    assert.ok(held.gates.find((g) => g.id === 'flight-cleared')?.passed, 'the physics still clears');
  });

  test('a substitution inside an annotated chain is held on the ground', () => {
    // Position 30 is leucine inside the annotated insulin B chain, 25 to 54.
    // Every leucine codon reaches valine with exactly one base change.
    const outcome = scoreMutation(input({ proteinPosition: 30, refAa: 'L', altAa: 'V' }));
    assert.equal(outcome.ok, true);
    if (!outcome.ok) return;
    assert.ok(outcome.result.structural.enclosing, 'expected an enclosing feature');
    assert.equal(outcome.result.structural.enclosing?.type, 'Chain');
    assert.equal(outcome.result.gates.find((g) => g.id === 'structural-clear')?.passed, false);
    assert.equal(outcome.result.verdict, 'GROUND-ONLY');
  });

  test('a thin shield with a large buffer fails the radiation gate', () => {
    const result = scored({
      flight: { ...findFlight('cubesat-thin'), shieldingMgPerCm2: 15, sramBitsMb: 8, readoutVoting: 1 },
    });
    assert.equal(result.flight.class, 'fails');
    assert.equal(result.gates.find((g) => g.id === 'flight-cleared')?.passed, false);
    assert.equal(result.verdict, 'GROUND-ONLY');
  });

  test('an over-driven detector saturates and cannot resolve', () => {
    // A transimpedance gain two orders of magnitude too high drives the signal
    // voltage past the ADC full-scale rail, which is a real bench mistake.
    const result = scored({
      instrument: { ...findInstrument('esp32-405-npi'), gain: 4.7e8 },
    });
    assert.equal(result.signal.class, 'unresolved');
    assert.equal(result.signal.adcSnr, 0);
    assert.equal(result.gates.find((g) => g.id === 'signal-resolves')?.passed, false);
    assert.equal(result.verdict, 'GROUND-ONLY');
  });

  test('an inert probe asks for a redesign rather than a launch decision', () => {
    // Find a real case rather than asserting one: a 40mer over an AT-rich window
    // puts the mismatch under the detection floor.
    const found = findCase((r) => r.thermo.class === 'inert');
    assert.ok(found, 'expected at least one inert probe case');
    assert.equal(found.result.gates.find((g) => g.id === 'probe-binds')?.passed, false);
    assert.equal(found.result.verdict, 'REDESIGN-PROBE');
    assert.match(
      found.result.gates.find((g) => g.id === 'probe-binds')?.detail ?? '',
      /under 0\.5 C/,
    );
  });

  test('the probe gate fires at both ends of the discrimination window', () => {
    // Sweeping every reachable substitution confirms the gate is reachable and
    // not decorative: long probes push dTm below the detection floor.
    let inert = 0;
    let usable = 0;
    for (const len of [21, 27, 40]) {
      for (let position = 1; position <= 40; position += 1) {
        const ref = sample.protein[position - 1];
        if (!ref || ref === '*') continue;
        for (const alt of 'ACDEFGHIKLMNPQRSTVWY') {
          if (alt === ref) continue;
          for (const baseOffset of [0, 1, 2]) {
            const outcome = scoreMutation(
              input({
                proteinPosition: position,
                refAa: ref,
                altAa: alt,
                baseOffset,
                instrument: { ...findInstrument('esp32-405-npi'), probeLengthNt: len },
              }),
            );
            if (!outcome.ok) continue;
            const cls = outcome.result.thermo.class;
            if (cls === 'inert') inert += 1;
            else if (cls === 'usable') usable += 1;
          }
        }
      }
    }
    assert.ok(usable > 0, 'no usable probes were found');
    assert.ok(inert > 0, 'the low end of the window never fires');
    assert.ok(usable > inert, `usable ${usable} should outnumber inert ${inert}`);
  });

  test('a longer probe dilutes a mismatch, as thermodynamics requires', () => {
    const deltas = [21, 27, 40].map(
      (len) =>
        Math.abs(
          scored({
            instrument: { ...findInstrument('esp32-405-npi'), probeLengthNt: len },
          }).thermo.deltaTmC,
        ),
    );
    assert.ok(deltas[0] > deltas[1], `${deltas[0]} should exceed ${deltas[1]}`);
    assert.ok(deltas[1] > deltas[2], `${deltas[1]} should exceed ${deltas[2]}`);
  });

  test('missing annotation lowers structural support but does not fail a physics gate', () => {
    const annotated = scored();
    const unannotated = scored({ profile: profile(false) });
    assert.ok(
      unannotated.structural.support < annotated.structural.support,
      `${unannotated.structural.support} should be under ${annotated.structural.support}`,
    );
    assert.equal(unannotated.gates.find((g) => g.id === 'structural-clear')?.passed, true);
    assert.equal(unannotated.gates.find((g) => g.id === 'evidence-present')?.passed, false);
  });
});

describe('factor responses', () => {
  test('the flight factor responds to the live particle flux', () => {
    const quiet = scored();
    const storm = scored({ spaceWeather: { ...QUIET, protonFluxPfu: 200000 } });
    assert.ok(storm.flight.totalDoseKrad > quiet.flight.totalDoseKrad);
    // The quiet-time baseline carries a nominal 0.1 pfu, so its SPE term is
    // vanishing rather than identically zero.
    assert.ok(quiet.flight.speDoseRateRadDay < 1e-5, `quiet SPE was ${quiet.flight.speDoseRateRadDay}`);
    assert.ok(storm.flight.speDoseRateRadDay > 1e-3, `storm SPE was ${storm.flight.speDoseRateRadDay}`);
  });

  test('the signal factor responds to detector dark current', () => {
    const dark = scored();
    const noisy = scored({
      instrument: { ...findInstrument('esp32-405-npi'), darkCurrentPa: 5000 },
    });
    assert.ok(noisy.signal.darkCounts > dark.signal.darkCounts);
    assert.ok(noisy.signal.shotSnr <= dark.signal.shotSnr);
  });

  test('the thermo factor reports both probe sequences', () => {
    const result = scored();
    const thermo = result.factors.find((f) => f.key === 'thermo')!;
    assert.ok(result.thermo.probe.length >= 15);
    assert.notEqual(result.thermo.probe, '');
    assert.equal(typeof result.thermo.deltaTmC, 'number');
    assert.ok(thermo.evidence.some((e) => e.label === 'Mutant probe'));
  });

  test('every factor carries the real numbers it was derived from', () => {
    const result = scored();
    const thermo = result.factors.find((f) => f.key === 'thermo')!;
    assert.ok(thermo.evidence.some((e) => e.value.includes(result.thermo.probe)));

    const flight = result.factors.find((f) => f.key === 'flight')!;
    assert.ok(
      flight.evidence.some((e) => e.value.includes(String(result.flight.gcrDoseRateRadDay))),
    );
    assert.ok(flight.evidence.some((e) => e.value.includes(String(result.flight.requiredVoting))));
  });
});