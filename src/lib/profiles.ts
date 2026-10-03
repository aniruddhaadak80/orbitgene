import type { FlightProfile, InstrumentProfile, ProbeDesign } from './types';

/**
 * Concrete assay boards and flight profiles. Each entry is a real, orderable
 * configuration rather than a placeholder: an emitter wavelength and optical
 * output, a photodiode responsivity, an ADC and a transimpedance gain that a
 * hobbyist actually specifies. Changing any of these changes the signal factor,
 * so the defaults are editable per session on `/settings`.
 */

export const INSTRUMENT_PRESETS: InstrumentProfile[] = [
  {
    id: 'esp32-405-npi',
    name: 'DIY NPI reader, 405 nm LED + TLV2372 photodiode and 4.7 Mohm transimpedance amp',
    emitterNm: 405,
    emitterMw: 3,
    detectorResponsivityAw: 0.42,
    darkCurrentPa: 1.5,
    gain: 4.7e6,
    adcBits: 12,
    adcFullScaleV: 3.3,
    integrationMs: 40,
    quantumYield: 0.62,
    volumeUl: 50,
    probeLengthNt: 21,
  },
  {
    id: 'rp2040-470-sx',
    name: 'RP2040 pico plate reader, 470 nm LED + TLV2462, 16-bit ADC',
    emitterNm: 470,
    emitterMw: 1.5,
    detectorResponsivityAw: 0.33,
    darkCurrentPa: 0.8,
    gain: 1e7,
    adcBits: 16,
    adcFullScaleV: 3.3,
    integrationMs: 100,
    quantumYield: 0.7,
    volumeUl: 100,
    probeLengthNt: 24,
  },
  {
    id: 'stm32-520-gfp',
    name: 'STM32L4 GFP reader, 520 nm + APD-900-01 avalanche photodiode',
    emitterNm: 520,
    emitterMw: 1.2,
    detectorResponsivityAw: 4.8,
    darkCurrentPa: 12,
    gain: 2.2e6,
    adcBits: 12,
    adcFullScaleV: 2.048,
    integrationMs: 250,
    quantumYield: 0.79,
    volumeUl: 200,
    probeLengthNt: 27,
  },
];

export const FLIGHT_PRESETS: FlightProfile[] = [
  {
    id: 'cubesat-leo',
    name: '3U CubeSat, 400 km at 51.6 degrees, 30 days',
    altitudeKm: 400,
    inclinationDeg: 51.6,
    missionDays: 30,
    shieldingMgPerCm2: 250,
    sramBitsMb: 0.5,
    readoutVoting: 3,
  },
  {
    id: 'cubesat-thin',
    name: '1U CubeSat, 450 km at 97.5 degrees, 90 days, minimal shielding',
    altitudeKm: 450,
    inclinationDeg: 97.5,
    missionDays: 90,
    shieldingMgPerCm2: 60,
    sramBitsMb: 0.25,
    readoutVoting: 2,
  },
  {
    id: 'iss-pkm',
    name: 'Sample pallet on ISS, 400 km at 51.6 degrees, 180 days, 100 mg/cm2',
    altitudeKm: 400,
    inclinationDeg: 51.6,
    missionDays: 180,
    shieldingMgPerCm2: 100,
    sramBitsMb: 2,
    readoutVoting: 3,
  },
];

export const DEFAULT_PROBE: ProbeDesign = {
  sequence: '',
  sodiumMolar: 0.05,
  strandConcentrationNm: 50,
};

export const DEFAULT_INSTRUMENT = INSTRUMENT_PRESETS[0];
export const DEFAULT_FLIGHT = FLIGHT_PRESETS[0];

export function findInstrument(id: string): InstrumentProfile {
  return INSTRUMENT_PRESETS.find((p) => p.id === id) ?? DEFAULT_INSTRUMENT;
}

export function findFlight(id: string): FlightProfile {
  return FLIGHT_PRESETS.find((p) => p.id === id) ?? DEFAULT_FLIGHT;
}

/**
 * Well identifiers in a 96-well plate: rows A to H, columns 1 to 12.
 * Order is fixed so a saved record always returns to the same well.
 */
export const WELL_ROWS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'] as const;
export const WELL_COLUMNS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] as const;

export function allWells(): string[] {
  return WELL_ROWS.flatMap((row) => WELL_COLUMNS.map((col) => `${row}${col}`));
}

export function isWell(value: string): boolean {
  return /^[A-H](?:[1-9]|1[0-2])$/.test(value);
}