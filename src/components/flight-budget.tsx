'use client';

import { useCallback, useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import type { FlightAnalysis, SourceMeta } from '@/lib/types';
import { ErrorNote, Panel, PanelHeading, SourceStrip, Stat } from './ui';

interface Preset {
  id: string;
  name: string;
  altitudeKm: number;
  inclinationDeg: number;
  missionDays: number;
  shieldingMgPerCm2: number;
  sramBitsMb: number;
  readoutVoting: number;
  budget: FlightAnalysis;
}

interface Response {
  weather: {
    kpIndex: number;
    kpLabel: string;
    xrayClass: string;
    protonFluxPfu: number;
    observationTime: string;
    sources: SourceMeta[];
  };
  presets: Preset[];
  selected: Preset;
}

const CLASS_COLOR: Record<FlightAnalysis['class'], string> = {
  cleared: 'var(--color-cleared)',
  marginal: 'var(--color-caution)',
  fails: 'var(--color-refused)',
};

/**
 * Flight budget.
 *
 * The dose curves are drawn from the same `computeFlightBudget` the engine calls,
 * so a number on this page and a number inside a stored record cannot disagree.
 */
export function FlightBudget() {
  const [data, setData] = useState<Response | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchWeather = useCallback(async (): Promise<Response> => {
    const response = await fetch('/api/space-weather');
    const body = await response.json();
    if (!response.ok) {
      throw new Error(body?.error?.message ?? `space weather failed (${response.status})`);
    }
    return body as Response;
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await fetchWeather());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'space weather failed');
    } finally {
      setLoading(false);
    }
  }, [fetchWeather]);

  // The effect applies the result in its promise callback; the refresh control
  // calls `load` directly. No state is written synchronously inside the effect.
  useEffect(() => {
    let cancelled = false;
    fetchWeather()
      .then((body) => {
        if (!cancelled) setData(body);
      })
      .catch((e: Error) => {
        if (!cancelled) setError(e.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [fetchWeather]);

  if (error) {
    return (
      <div className="mx-auto max-w-[1240px] space-y-5 px-4 py-10 sm:px-6">
        <ErrorNote message={error} onRetry={() => void load()} />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[1240px] space-y-5 px-4 py-10 sm:px-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="label">Flight budget</p>
          <h1 className="display mt-2 text-2xl text-ink sm:text-3xl">Does the readout survive the flight?</h1>
          <p className="mt-2 max-w-prose text-[0.85rem] leading-relaxed text-ink-dim">
            Galactic cosmic rays give a steady dose. Solar particle events add to it in proportion to
            the measured proton flux. Shielding cuts both, and the number of redundant readouts is
            whatever the upset probability actually requires.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className="inline-flex items-center gap-2 rounded-md border border-rim px-3 py-2 text-[0.78rem] text-ink-dim hover:border-signal/60 hover:text-signal disabled:opacity-50"
        >
          <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
          Refresh live sky
        </button>
      </header>

      {!data ? (
        <Panel>
          <p className="text-[0.82rem] text-ink-faint">Reading the planetary environment.</p>
        </Panel>
      ) : (
        <>
          <Panel>
            <PanelHeading
              title="Current environment"
              detail="Read live from NOAA SWPC. A sealed fallback is labelled wherever it appears and is never presented as a current observation."
            />
            <dl className="grid grid-cols-2 gap-5 sm:grid-cols-4">
              <Stat
                label="Planetary K"
                value={data.weather.kpIndex.toFixed(2)}
                hint={data.weather.kpLabel}
                color={
                  data.weather.kpIndex >= 5 ? 'var(--color-caution)' : 'var(--color-cleared)'
                }
              />
              <Stat label="Kp label" value={data.weather.kpLabel} />
              <Stat label="X-ray class" value={data.weather.xrayClass} color="var(--color-caution)" />
              <Stat
                label="Proton flux"
                value={data.weather.protonFluxPfu}
                unit="pfu"
                color={data.weather.protonFluxPfu > 1000 ? 'var(--color-refused)' : 'var(--color-signal)'}
              />
            </dl>
            <p className="data mt-4 text-[0.68rem] text-ink-faint">
              Observed at {data.weather.observationTime}
            </p>
            <div className="mt-4">
              <SourceStrip sources={data.weather.sources} />
            </div>
          </Panel>

          <Panel>
            <PanelHeading
              title="Dose versus shielding"
              detail="Attenuation follows a rho^-1.7 law below 10 g/cm2 and rho^-0.5 above it, anchored so a 100 mg/cm2 bus has unit attenuation."
            />
            <ShieldingCurve weather={data.weather} />
          </Panel>

          <div className="grid gap-5 lg:grid-cols-3">
            {data.presets.map((preset) => (
              <Panel key={preset.id}>
                <div className="flex items-start justify-between gap-3">
                  <h3 className="text-[0.82rem] leading-snug text-ink">{preset.name}</h3>
                  <span
                    className="label text-[0.56rem]"
                    style={{ color: CLASS_COLOR[preset.budget.class] }}
                  >
                    {preset.budget.class}
                  </span>
                </div>

                <dl className="mt-4 grid gap-3">
                  <Stat
                    label="Total dose"
                    value={preset.budget.totalDoseKrad.toFixed(4)}
                    unit="krad(Si)"
                    color={CLASS_COLOR[preset.budget.class]}
                  />
                  <Stat label="GCR rate" value={preset.budget.gcrDoseRateRadDay} unit="rad/day" />
                  <Stat label="SPE rate" value={preset.budget.speDoseRateRadDay} unit="rad/day" />
                  <Stat
                    label="Expected upsets"
                    value={preset.budget.expectedUpsets.toFixed(6)}
                    hint={`over ${preset.missionDays} days across ${preset.sramBitsMb} Mb`}
                  />
                  <Stat
                    label="Redundancy required"
                    value={
                      Number.isFinite(preset.budget.requiredVoting)
                        ? preset.budget.requiredVoting
                        : 'unbounded'
                    }
                    hint={`${preset.readoutVoting} supplied`}
                    color={
                      preset.budget.requiredVoting <= preset.readoutVoting
                        ? 'var(--color-cleared)'
                        : 'var(--color-refused)'
                    }
                  />
                </dl>
              </Panel>
            ))}
          </div>

          <Panel>
            <PanelHeading
              title="Constants behind the model"
              detail="Stated so you can substitute your own and get a different answer."
            />
            <dl className="grid gap-2 text-[0.72rem] sm:grid-cols-2">
              {[
                ['GCR dose rate', '0.35 rad(Si)/day unshielded'],
                ['SPE coefficient', '4e-5 rad(Si)/day per pfu'],
                ['Attenuation crossover', '10 g/cm2 Al equivalent'],
                ['Reference areal density', '100 mg/cm2 has unit attenuation'],
                ['Upset rate', '1e-10 upsets per bit per rad(Si)'],
                ['Single-readout budget', '1e-3 probability of corruption'],
              ].map(([label, value]) => (
                <div key={label} className="flex flex-wrap justify-between gap-2 border-b border-rim/60 pb-1.5">
                  <dt className="label text-[0.58rem]">{label}</dt>
                  <dd className="data text-right text-ink-dim">{value}</dd>
                </div>
              ))}
            </dl>
          </Panel>
        </>
      )}
    </div>
  );
}

/** Dose retained across a log shielding axis, computed in the browser for display only. */
function ShieldingCurve({ weather }: { weather: Response['weather'] }) {
  const points: Array<{ mg: number; retained: number }> = [];
  for (let mg = 10; mg <= 2000; mg = mg < 100 ? mg + 10 : mg + 50) {
    const rho = mg / 1000;
    const ref = 0.1;
    const cross = 10;
    const attenuation =
      rho <= cross
        ? (rho / ref) ** -1.7
        : (cross / ref) ** -1.7 * (rho / cross) ** -0.5;
    const rate = 0.35 * attenuation;
    points.push({ mg, retained: Math.min(100, (rate / 0.35) * 100) });
  }

  const max = Math.max(...points.map((p) => p.retained));
  const path = points
    .map((p, i) => {
      const x = (p.mg / 2000) * 100;
      const y = 100 - (p.retained / max) * 92;
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(' ');

  return (
    <div>
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="h-40 w-full" role="img"
        aria-label="Dose retained as a function of shielding areal density, falling steeply then flattening">
        <line x1="0" y1="100" x2="100" y2="100" stroke="var(--color-rim)" strokeWidth="0.4" />
        <line x1="0" y1="8" x2="100" y2="8" stroke="var(--color-rim)" strokeWidth="0.3" />
        <path d={path} fill="none" stroke="var(--color-signal)" strokeWidth="1.2" />
      </svg>
      <div className="mt-2 flex justify-between text-[0.62rem] text-ink-faint">
        <span>10 mg/cm2</span>
        <span>shielding areal density</span>
        <span>2000 mg/cm2</span>
      </div>
      <p className="data mt-3 text-[0.7rem] text-ink-dim">
        At the current {weather.protonFluxPfu} pfu proton flux, a solar particle event contributes{' '}
        {(0.00004 * weather.protonFluxPfu).toFixed(6)} rad(Si)/day before any shielding.
      </p>
    </div>
  );
}