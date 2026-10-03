import { round } from './genetics';
import type { FlightAnalysis, SpaceWeather } from './types';

/**
 * Spacecraft radiation budget for a low-Earth-orbit DNA assay payload.
 *
 * Sources and engineering model, stated explicitly so the arithmetic on screen
 * can be argued with:
 *
 * 1. Galactic cosmic rays (GCR) give a steady absorbed dose of roughly
 *    0.3-1.0 rad(Si)/day behind light spacecraft structure. `GCR_BASE_RAD_PER_DAY`
 *    uses 0.35 rad(Si)/day, the conservative end of that range.
 *
 * 2. Solar particle events (SPE) scale with the >10 MeV integral proton flux
 *    reported by GOES in proton flux units (pfu). Dose is taken as linear in
 *    instantaneous flux, which over a multi-day event approximates the
 *    fluence relationship; `SPE_RAD_PER_DAY_PER_PFU` sets a strong 1e5 pfu event
 *    at about 4 rad(Si)/day.
 *
 * 3. Shielding attenuation follows the two-regime fit for proton and electron
 *    bremsstrahlung: dose falls about rho^-1.7 below the crossover areal density
 *    and about rho^-0.5 above it, where rho is in g/cm2 of aluminium equivalent.
 *    The two branches are joined in log space, so the function is continuous at
 *    `CROSSOVER_G_PER_CM2` and monotonically decreasing everywhere.
 *
 *    The `rho^-1.7` law is a marginal law: it describes how much *extra* areal
 *    density reduces dose, and it diverges at rho = 0. It is therefore anchored
 *    so that a typical smallsat bus, `REFERENCE_MG_PER_CM2`, has unit
 *    attenuation. Values above that read as a dose reduction and values below it
 *    as an increase, which is the honest reading for a thin-shielded payload.
 *
 * 4. Single-event upsets scale linearly with dose and exposed SRAM bits using
 *    `UPSETS_PER_BIT_PER_RAD`, taken as 1e-10 upsets per bit per rad(Si) for a
 *    sub-micron CMOS SRAM without ECC or scrubbing. This is a representative
 *    engineering figure, not a measurement: older and larger cells run nearer
 *    1e-9, and parts with ECC and scrubbing run nearer 1e-11. The value is stated
 *    here so a reader can substitute their own and get a different answer rather
 *    than having to trust a hidden constant.
 */

export const GCR_BASE_RAD_PER_DAY = 0.35;
export const SPE_RAD_PER_DAY_PER_PFU = 4e-5;
export const CROSSOVER_G_PER_CM2 = 10;
/** Areal density of a typical smallsat bus, taken as unit attenuation. */
export const REFERENCE_MG_PER_CM2 = 100;
export const UPSETS_PER_BIT_PER_RAD = 1e-10;
/** Probability budget a single readout must meet. */
export const UPSET_TOLERANCE = 1e-3;

/**
 * Dose-retention factor versus areal density. Continuous and strictly decreasing:
 * for rho at or below the crossover it is (rho/ref)^-1.7; above it the exponent
 * relaxes to -0.5 from the crossover value.
 */
export function shieldingAttenuation(mgPerCm2: number): number {
  const rho = Math.max(1e-3, mgPerCm2) / 1000; // mg/cm2 -> g/cm2
  const ref = REFERENCE_MG_PER_CM2 / 1000;
  const cross = CROSSOVER_G_PER_CM2;

  if (rho <= cross) {
    return (rho / ref) ** -1.7;
  }
  return (cross / ref) ** -1.7 * (rho / cross) ** -0.5;
}

function xrayWatts(classLetter: string): number {
  // NOAA GOES X-ray flux class bands, W/m^2, used only as an X-ray/SPE proxy.
  switch (classLetter.toUpperCase()) {
    case 'X': return 1e-4;
    case 'M': return 1e-5;
    case 'C': return 1e-6;
    case 'B': return 1e-7;
    case 'A': return 1e-8;
    default: return 1e-9;
  }
}

export interface FlightInput {
  shieldingMgPerCm2: number;
  missionDays: number;
  altitudeKm: number;
  inclinationDeg: number;
  sramBitsMb: number;
  readoutVoting: number;
  weather: SpaceWeather;
}

/**
 * Deterministic radiation budget. Returns dose rates, total dose, expected
 * upsets and the readout redundancy the mission actually needs to meet the
 * single-readout upset tolerance.
 */
export function computeFlightBudget(input: FlightInput): FlightAnalysis {
  const attenuation = shieldingAttenuation(input.shieldingMgPerCm2);

  // Above about 600 km the geomagnetic cutoff no longer offers much protection,
  // so dose drifts up with altitude and with inclination (which changes the
  // fraction of orbit time spent in the polar cusps).
  const altitudeFactor = 1 + Math.max(0, input.altitudeKm - 400) / 1000 * 0.35;
  const inclinationFactor = 1 + Math.max(0, input.inclinationDeg - 28) / 90 * 0.25;

  const gcrDoseRateRadDay =
    GCR_BASE_RAD_PER_DAY * attenuation * altitudeFactor * inclinationFactor;

  const pfu = Number.isFinite(input.weather.protonFluxPfu)
    ? Math.max(0, input.weather.protonFluxPfu)
    : 0;
  const speDoseRateRadDay =
    SPE_RAD_PER_DAY_PER_PFU * pfu * attenuation * altitudeFactor * inclinationFactor;

  const baseDoseRateRadDay =
    GCR_BASE_RAD_PER_DAY * altitudeFactor * inclinationFactor;

  const missionDays = Math.max(0, input.missionDays);
  const totalDoseRad = (gcrDoseRateRadDay + speDoseRateRadDay) * missionDays;
  const totalDoseKrad = totalDoseRad / 1000;

  const bits = Math.max(0, input.sramBitsMb) * 1e6;
  const expectedUpsets = bits * totalDoseRad * UPSETS_PER_BIT_PER_RAD;

  // One measurement reads the whole buffer once, so a measurement is corrupted
  // if any bit in the buffer is hit during the mission.
  const perMeasurement = 1 - Math.exp(-expectedUpsets);
  const corruptionProbability = perMeasurement;

  const requiredVoting =
    perMeasurement >= 1
      ? Number.POSITIVE_INFINITY
      : Math.max(1, Math.ceil(Math.log(UPSET_TOLERANCE) / Math.log(perMeasurement)));

  const supplied = Math.max(1, Math.floor(input.readoutVoting));
  let cls: FlightAnalysis['class'];
  if (!Number.isFinite(requiredVoting)) cls = 'fails';
  else if (supplied >= requiredVoting) cls = 'cleared';
  else if (supplied >= requiredVoting - 1) cls = 'marginal';
  else cls = 'fails';

  return {
    baseDoseRateRadDay: round(baseDoseRateRadDay, 6),
    gcrDoseRateRadDay: round(gcrDoseRateRadDay, 6),
    speDoseRateRadDay: round(speDoseRateRadDay, 6),
    shielding: round(attenuation, 6),
    totalDoseKrad: round(totalDoseKrad, 6),
    // Rounded to six places on purpose: the interesting range for a small buffer
    // is around 1e-4 upsets, and rounding to three would report it as zero while
    // the probability beside it was non-zero.
    expectedUpsets: round(expectedUpsets, 6),
    corruptionProbability: round(corruptionProbability, 9),
    requiredVoting,
    class: cls,
  };
}

/** Storm classification from the planetary K index, used for display only. */
export function kpLabel(kp: number): string {
  if (!Number.isFinite(kp)) return 'unknown';
  if (kp >= 8) return 'extreme storm';
  if (kp >= 7) return 'strong storm';
  if (kp >= 6) return 'moderate storm';
  if (kp >= 5) return 'minor storm';
  if (kp >= 4) return 'active';
  if (kp >= 3) return 'unsettled';
  if (kp >= 2) return 'quiet';
  return 'very quiet';
}

/**
 * Decodes a NOAA planetary K-index label such as `"3M"`, `"5+"`, `"7-"`.
 * The third character carries the sub-interval: `5+` is 5.33 and `5-` is 4.67.
 */
export function parseKp(raw: string): number {
  const text = String(raw).trim();
  const match = /^([0-9])([+-]?)([+-])?$/.exec(text);
  if (match) {
    const base = Number(match[1]);
    // NOAA writes the sub-interval as either a trailing sign on the integer or
    // a second sign character, so accept whichever is present.
    const sign = match[2] || match[3] || '';
    if (sign === '+') return base + 1 / 3;
    if (sign === '-') return base - 1 / 3;
    return base;
  }
  // NOAA also emits a `"G"` scale value, e.g. "2G", which maps through
  // Kp = 9 * log10(G) + 4.
  const g = /^([0-9]+)G$/i.exec(text);
  if (g) {
    const value = Number(g[1]);
    return value > 0 ? 9 * Math.log10(value) + 4 : Number.NaN;
  }
  return Number.NaN;
}

export function parseXrayClass(raw: string): { class: string; watts: number } {
  const match = /^([A-Z])([+-]?)([0-9.]+)$/i.exec(String(raw).trim());
  if (!match) return { class: '?', watts: 0 };
  const letter = match[1].toUpperCase();
  const sign = match[2] === '-' ? -1 : 1;
  const mantissa = Number(match[3]);
  const watts = mantissa * sign * xrayWatts(letter);
  return { class: `${match[1].toUpperCase()}${match[2]}${match[3]}`, watts: Math.abs(watts) };
}