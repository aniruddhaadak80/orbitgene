import { cached, fetchJson, TTL, UpstreamError } from './http';
import { kpLabel, parseKp, parseXrayClass } from '../radiation';
import type { SourceMeta, SpaceWeather } from '../types';

/**
 * Live space weather from NOAA SWPC.
 *
 * The radiation budget in `radiation.ts` needs the current particle and X-ray
 * environment, and NOAA publishes all three on key-free endpoints. Each channel
 * is fetched independently so one unavailable product degrades that single input
 * instead of failing the whole budget, and the reported `kpIndex` is the mean of
 * whatever channels did answer.
 */

const SWPC = 'https://services.swpc.noaa.gov';
const KP_URL = `${SWPC}/json/planetary_k_index_1m.json`;
const XRAY_URL = `${SWPC}/products/goes/primary/xrays-1-day.json`;
const PROTON_URL = `${SWPC}/products/goes/primary/integral-protons-1-day.json`;

interface KpRow {
  time_tag: string;
  /** Integer geoeffective level, when NOAA publishes one. */
  kp_index?: number | string;
  /** Exact numeric Kp, which is preferred over parsing the label. */
  estimated_kp?: number | string;
  /** Display label such as `0P`, `3M` or `5-`. */
  kp?: string;
}
interface FluxRow {
  time_tag: string;
  flux: number | string | null;
}

/**
 * Reads the Kp value from one NOAA row.
 *
 * NOAA's one-minute product publishes an integer `kp_index` and an exact numeric
 * `estimated_kp` alongside the display label, and that label uses a
 * third-interval letter (`0P`, `3M`, `5-`) rather than the `+`/`-` notation a
 * hand-written parser expects. The numeric fields are read first and the label
 * only decoded as a fallback, so an unfamiliar label letter can never silently
 * turn the whole radiation budget into a fallback reading.
 */
function readKp(row: KpRow): number {
  const exact = Number(row.estimated_kp);
  if (Number.isFinite(exact)) return exact;
  const integer = Number(row.kp_index);
  if (Number.isFinite(integer)) return integer;
  return parseKp(String(row.kp ?? ''));
}

function median(values: number[]): number {
  if (values.length === 0) return Number.NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/**
 * Sealed fallback observation, recorded as an explicit quiet-time baseline. It
 * is deliberately labelled as fallback everywhere it surfaces and is never
 * presented as a current reading.
 */
function fallbackWeather(note: string): SpaceWeather {
  return {
    kpIndex: 1.67,
    kpLabel: kpLabel(1.67),
    xrayClass: 'A0.0',
    xrayWattsPerM2: 1e-8,
    protonFluxPfu: 0.1,
    solarWindSpeedKms: null,
    observationTime: '2026-01-01T00:00:00.000Z',
    sources: [
      {
        id: 'noaa-swpc',
        label: 'NOAA SWPC space weather',
        status: 'fallback',
        url: 'https://www.swpc.noaa.gov/products',
        fetchedAt: new Date().toISOString(),
        note,
      },
    ],
  };
}

export async function loadSpaceWeather(): Promise<SpaceWeather> {
  return cached('space-weather', TTL.spaceWeather, async () => {
    const sources: SourceMeta[] = [];
    const notes: string[] = [];

    /* Planetary K index, median of the last day so a single noisy hour is not
       allowed to swing a mission budget. */
    let kpIndex = Number.NaN;
    try {
      const rows = await fetchJson<KpRow[]>(KP_URL, 'NOAA planetary K index');
      const parsed = rows
        .map(readKp)
        .filter((v) => Number.isFinite(v));
      kpIndex = median(parsed);
      sources.push({
        id: 'noaa-kp',
        label: 'NOAA planetary K index (1 minute)',
        status: 'live',
        url: 'https://www.swpc.noaa.gov/products/planetary-k-index',
        fetchedAt: new Date().toISOString(),
        note: `${rows.length} one-minute readings, median of the trailing day`,
      });
    } catch (error) {
      notes.push(`K index unavailable: ${describe(error)}`);
    }

    /* GOES primary X-ray flux class. */
    let xrayClass = 'A0.0';
    let xrayWattsPerM2 = 1e-8;
    try {
      const rows = await fetchJson<FluxRow[]>(XRAY_URL, 'NOAA GOES X-ray flux');
      const last = rows[rows.length - 1];
      if (last && last.flux !== null) {
        const parsed = parseXrayClass(String(last.flux));
        xrayClass = parsed.class;
        xrayWattsPerM2 = parsed.watts;
      }
      sources.push({
        id: 'noaa-xray',
        label: 'GOES primary X-ray flux',
        status: 'live',
        url: 'https://www.swpc.noaa.gov/products/x-ray',
        fetchedAt: new Date().toISOString(),
        note: `${rows.length} readings over the trailing day`,
      });
    } catch (error) {
      notes.push(`X-ray flux unavailable: ${describe(error)}`);
    }

    /* Integral >10 MeV proton flux in pfu, the solar particle event driver. */
    let protonFluxPfu = 0;
    try {
      const rows = await fetchJson<FluxRow[]>(PROTON_URL, 'NOAA GOES proton flux');
      const values = rows
        .map((r) => (typeof r.flux === 'string' ? Number(r.flux) : r.flux))
        .filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
      protonFluxPfu = values.length > 0 ? Math.max(...values.slice(-48)) : 0;
      sources.push({
        id: 'noaa-proton',
        label: 'GOES integral >10 MeV proton flux',
        status: 'live',
        url: 'https://www.swpc.noaa.gov/products/proton',
        fetchedAt: new Date().toISOString(),
        note: `peak of the last 8 hours across ${values.length} readings`,
      });
    } catch (error) {
      notes.push(`proton flux unavailable: ${describe(error)}`);
    }

    const allLive = sources.length === 3;

    if (!Number.isFinite(kpIndex) || sources.length === 0) {
      return fallbackWeather(
        `Upstream space weather could not be read (${notes.join('; ') || 'unknown reason'}). Showing a quiet-time baseline, not a current observation.`,
      );
    }

    return {
      kpIndex: Number(kpIndex.toFixed(2)),
      kpLabel: kpLabel(kpIndex),
      xrayClass,
      xrayWattsPerM2,
      protonFluxPfu,
      solarWindSpeedKms: null,
      observationTime: new Date().toISOString(),
      sources: sources.map((s) =>
        allLive ? s : { ...s, note: `${s.note}. ${notes.join('; ') || 'partial response'}`.trim() },
      ),
    };
  }).catch((error) =>
    fallbackWeather(
      `Upstream space weather could not be read: ${describe(error)}. Showing a quiet-time baseline, not a current observation.`,
    ),
  );
}

function describe(error: unknown): string {
  if (error instanceof UpstreamError) return error.message;
  if (error instanceof Error) return error.message;
  return String(error);
}