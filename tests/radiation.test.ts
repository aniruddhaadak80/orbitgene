import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  CROSSOVER_G_PER_CM2,
  REFERENCE_MG_PER_CM2,
  UPSET_TOLERANCE,
  computeFlightBudget,
  kpLabel,
  parseKp,
  parseXrayClass,
  shieldingAttenuation,
} from '@/lib/radiation';
import type { SpaceWeather } from '@/lib/types';

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

function budget(overrides: Partial<Parameters<typeof computeFlightBudget>[0]> = {}) {
  return computeFlightBudget({
    shieldingMgPerCm2: 250,
    missionDays: 30,
    altitudeKm: 400,
    inclinationDeg: 51.6,
    sramBitsMb: 0.5,
    readoutVoting: 3,
    weather: QUIET,
    ...overrides,
  });
}

describe('shieldingAttenuation', () => {
  test('is unit at the reference areal density', () => {
    assert.ok(Math.abs(shieldingAttenuation(REFERENCE_MG_PER_CM2) - 1) < 1e-12);
  });

  test('cuts dose below one for realistic spacecraft shielding', () => {
    // 250 mg/cm2 is a typical smallsat bus plus a box: about a fivefold reduction.
    assert.ok(shieldingAttenuation(250) > 0.1 && shieldingAttenuation(250) < 0.3);
    assert.ok(shieldingAttenuation(100) > shieldingAttenuation(250));
    assert.ok(shieldingAttenuation(2000) < shieldingAttenuation(250));
  });

  test('raises the dose for a payload thinner than the reference bus', () => {
    assert.ok(shieldingAttenuation(20) > 1);
  });

  test('is monotonically decreasing in areal density', () => {
    let previous = Number.POSITIVE_INFINITY;
    for (let mg = 5; mg <= 5000; mg += 5) {
      const value = shieldingAttenuation(mg);
      assert.ok(value < previous, `attenuation rose at ${mg} mg/cm2`);
      assert.ok(value > 0);
      previous = value;
    }
  });

  test('is continuous across the crossover', () => {
    const just = CROSSOVER_G_PER_CM2 * 1000;
    assert.ok(Math.abs(shieldingAttenuation(just - 1) - shieldingAttenuation(just + 1)) < 0.01);
  });

  test('never returns zero or a negative factor for a very thin shield', () => {
    assert.ok(shieldingAttenuation(0.1) > 1);
    assert.ok(shieldingAttenuation(1) > 1);
  });
});

describe('parseKp', () => {
  test('decodes an integer label', () => {
    assert.equal(parseKp('4'), 4);
  });

  test('decodes the plus and minus sub-intervals', () => {
    assert.ok(Math.abs(parseKp('5+') - 5.3333) < 1e-3);
    assert.ok(Math.abs(parseKp('5-') - 4.6667) < 1e-3);
  });

  test('decodes the G scale NOAA also emits', () => {
    // Kp = 9*log10(G) + 4, so G=5 gives Kp about 6.29.
    assert.ok(Math.abs(parseKp('5G') - (9 * Math.log10(5) + 4)) < 1e-9);
  });

  test('rejects junk', () => {
    assert.ok(Number.isNaN(parseKp('sunny')));
    assert.ok(Number.isNaN(parseKp('')));
    assert.ok(Number.isNaN(parseKp('0G')));
  });
});

describe('parseXrayClass', () => {
  test('orders the classes by magnitude', () => {
    const order = ['A', 'B', 'C', 'M', 'X'].map((c) => parseXrayClass(`${c}1.0`).watts);
    for (let i = 1; i < order.length; i += 1) {
      assert.ok(order[i] > order[i - 1], `class index ${i} did not increase`);
    }
  });

  test('reads the magnitude', () => {
    assert.ok(Math.abs(parseXrayClass('M5.0').watts - 5e-5) < 1e-12);
  });

  test('returns zero for an unreadable value', () => {
    assert.equal(parseXrayClass('n/a').watts, 0);
  });
});

describe('kpLabel', () => {
  test('labels the quiet and stormy ends', () => {
    assert.equal(kpLabel(0.5), 'very quiet');
    assert.equal(kpLabel(3), 'unsettled');
    assert.equal(kpLabel(5), 'minor storm');
    assert.equal(kpLabel(9), 'extreme storm');
  });

  test('handles a non-numeric index', () => {
    assert.equal(kpLabel(Number.NaN), 'unknown');
  });
});

describe('computeFlightBudget', () => {
  test('adds a solar particle event dose on top of GCR', () => {
    const quiet = budget();
    const storm = budget({
      weather: { ...QUIET, protonFluxPfu: 100000 },
    });
    assert.ok(storm.speDoseRateRadDay > quiet.speDoseRateRadDay);
    assert.ok(storm.totalDoseKrad > quiet.totalDoseKrad);
  });

  test('charges no SPE dose when the proton flux is zero', () => {
    assert.equal(budget({ weather: { ...QUIET, protonFluxPfu: 0 } }).speDoseRateRadDay, 0);
  });

  test('scales total dose linearly with mission duration', () => {
    const short = budget({ missionDays: 10 });
    const long = budget({ missionDays: 20 });
    assert.ok(Math.abs(long.totalDoseKrad - 2 * short.totalDoseKrad) < 1e-5);
  });

  test('more shielding means less dose', () => {
    const thin = budget({ shieldingMgPerCm2: 20 });
    const thick = budget({ shieldingMgPerCm2: 2000 });
    assert.ok(thick.totalDoseKrad < thin.totalDoseKrad);
  });

  test('a higher orbit and a higher inclination both increase dose', () => {
    const low = budget({ altitudeKm: 300, inclinationDeg: 28 });
    const high = budget({ altitudeKm: 800, inclinationDeg: 98 });
    assert.ok(high.gcrDoseRateRadDay > low.gcrDoseRateRadDay);
  });

  test('a bigger buffer accumulates more upsets', () => {
    assert.ok(budget({ sramBitsMb: 4 }).expectedUpsets > budget({ sramBitsMb: 0.5 }).expectedUpsets);
  });

  test('raising the readout count clears a budget that was failing', () => {
    const failing = budget({ sramBitsMb: 64, missionDays: 365, readoutVoting: 1 });
    const cleared = budget({ sramBitsMb: 64, missionDays: 365, readoutVoting: 4 });
    assert.equal(failing.class, 'fails');
    assert.equal(cleared.class, 'cleared');
    assert.ok(cleared.requiredVoting > 1);
  });

  test('the default flight profile clears the radiation gate', () => {
    // A 3U CubeSat reading a 500 kbit buffer must be a plausible FLIGHT-GO
    // candidate, otherwise the gate is a permanent red light.
    const result = budget();
    assert.equal(result.class, 'cleared');
    assert.ok(result.totalDoseKrad > 0);
    assert.ok(result.expectedUpsets > 0);
  });

  test('a thin-shielded long mission pushes the gate to fails', () => {
    const result = budget({ shieldingMgPerCm2: 20, missionDays: 365, sramBitsMb: 8 });
    assert.equal(result.class, 'fails');
    assert.ok(result.gcrDoseRateRadDay > budget().gcrDoseRateRadDay);
  });

  test('required voting drives the corruption probability below tolerance', () => {
    const result = budget({ sramBitsMb: 2, missionDays: 180 });
    const combined = result.corruptionProbability ** result.requiredVoting;
    assert.ok(Number.isFinite(result.requiredVoting));
    assert.ok(combined <= UPSET_TOLERANCE * 1.0001, `${combined} exceeds ${UPSET_TOLERANCE}`);
  });

  test('is deterministic for identical inputs', () => {
    assert.deepEqual(budget(), budget());
  });

  test('clamps negative and nonsensical inputs instead of producing nonsense doses', () => {
    const result = budget({
      shieldingMgPerCm2: 250,
      missionDays: -10,
      altitudeKm: 400,
      inclinationDeg: 51.6,
      sramBitsMb: -1,
      readoutVoting: 0,
      weather: { ...QUIET, protonFluxPfu: -5 },
    });
    assert.equal(result.totalDoseKrad, 0);
    assert.equal(result.expectedUpsets, 0);
    assert.equal(result.speDoseRateRadDay, 0);
    assert.ok(Number.isFinite(result.requiredVoting));
  });

  test('reports the unshielded rate above the shielded rate', () => {
    const result = budget();
    assert.ok(result.baseDoseRateRadDay > result.gcrDoseRateRadDay);
    assert.ok(result.shielding < 1);
  });
});