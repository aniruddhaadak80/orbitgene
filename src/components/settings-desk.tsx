'use client';

import { useCallback, useEffect, useState } from 'react';
import { Save } from 'lucide-react';
import { INSTRUMENT_PRESETS, FLIGHT_PRESETS } from '@/lib/profiles';
import type { SessionSettings } from '@/lib/types';
import { ErrorNote, Panel, PanelHeading, Stat } from './ui';

/**
 * Assay settings.
 *
 * The instrument and flight fields are the real inputs to the engine, so changing
 * one here visibly changes the next score. Everything is persisted per session.
 */
export function SettingsDesk() {
  const [settings, setSettings] = useState<SessionSettings | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const fetchSettings = useCallback(async (): Promise<SessionSettings> => {
    const response = await fetch('/api/settings');
    const body = await response.json();
    if (!response.ok) throw new Error(`settings failed (${response.status})`);
    return body as SessionSettings;
  }, []);

  const load = useCallback(async () => {
    try {
      setSettings(await fetchSettings());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'settings failed');
    }
  }, [fetchSettings]);

  // Applied in the promise callback; `load` stays available for the retry control.
  useEffect(() => {
    let cancelled = false;
    fetchSettings()
      .then((body) => {
        if (!cancelled) setSettings(body);
      })
      .catch((e: Error) => {
        if (!cancelled) setError(e.message);
      });
    return () => {
      cancelled = true;
    };
  }, [fetchSettings]);

  async function save() {
    if (!settings) return;
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const response = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(settings),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body?.error?.message ?? `save failed (${response.status})`);
      setSettings(body as SessionSettings);
      setSaved(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'save failed');
    } finally {
      setBusy(false);
    }
  }

  if (!settings) {
    return (
      <div className="mx-auto max-w-[1240px] space-y-5 px-4 py-10 sm:px-6">
        {error ? <ErrorNote message={error} onRetry={() => void load()} /> : <p className="text-[0.85rem] text-ink-faint">Loading settings.</p>}
      </div>
    );
  }

  const update = (group: 'instrument' | 'flight' | 'probe', key: string, value: number | string) => {
    setSaved(false);
    setSettings((current) =>
      current
        ? ({ ...current, [group]: { ...current[group], [key]: value } } as SessionSettings)
        : current,
    );
  };

  return (
    <div className="mx-auto max-w-[1240px] space-y-5 px-4 py-10 sm:px-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="label">Assay settings</p>
          <h1 className="display mt-2 text-2xl text-ink sm:text-3xl">Your hardware, your orbit</h1>
          <p className="mt-2 max-w-prose text-[0.85rem] leading-relaxed text-ink-dim">
            These values are the engine&apos;s inputs, not preferences. Change the ADC resolution or
            the shielding and the next score moves, because the arithmetic genuinely depends on them.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void save()}
          disabled={busy}
          className="inline-flex items-center gap-2 rounded-md bg-signal px-4 py-2 text-[0.82rem] font-semibold text-substrate hover:opacity-90 disabled:opacity-50"
        >
          <Save className="h-4 w-4" aria-hidden="true" />
          {busy ? 'Saving' : saved ? 'Saved' : 'Save settings'}
        </button>
      </header>

      {error ? <ErrorNote message={error} onRetry={() => void load()} /> : null}

      <div className="grid gap-5 lg:grid-cols-2">
        <Panel>
          <PanelHeading title="Instrument" detail="Presets are real, orderable configurations." />

          <label className="grid gap-1.5">
            <span className="label">Preset</span>
            <select
              value={settings.instrument.id}
              onChange={(e) => {
                const preset = INSTRUMENT_PRESETS.find((p) => p.id === e.target.value);
                if (preset) {
                  setSaved(false);
                  setSettings((c) => (c ? { ...c, instrument: { ...preset } } : c));
                }
              }}
              className="data rounded-md border border-rim bg-[#0a0e13] px-3 py-2 text-sm text-ink"
            >
              {INSTRUMENT_PRESETS.map((preset) => (
                <option key={preset.id} value={preset.id}>
                  {preset.name}
                </option>
              ))}
            </select>
          </label>

          <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3">
            {[
              ['emitterNm', 'Emitter (nm)', 200, 1200, 1],
              ['emitterMw', 'Optical power (mW)', 0, 500, 0.1],
              ['detectorResponsivityAw', 'Responsivity (A/W)', 0, 100, 0.01],
              ['darkCurrentPa', 'Dark current (pA)', 0, 1e5, 0.1],
              ['gain', 'Transimpedance gain (V/A)', 1, 1e12, 1000],
              ['adcBits', 'ADC resolution (bits)', 8, 24, 1],
              ['adcFullScaleV', 'ADC full scale (V)', 0.1, 10, 0.001],
              ['integrationMs', 'Integration (ms)', 0.1, 60000, 1],
              ['quantumYield', 'Quantum yield', 0, 1, 0.01],
              ['volumeUl', 'Sample volume (uL)', 0.1, 5000, 1],
              ['probeLengthNt', 'Probe length (nt)', 15, 40, 1],
            ].map(([key, label, min, max, step]) => (
              <label key={key} className="grid gap-1.5">
                <span className="label text-[0.56rem]">{String(label)}</span>
                <input
                  type="number"
                  min={min}
                  max={max}
                  step={step}
                  value={Number(settings.instrument[key as keyof typeof settings.instrument])}
                  onChange={(e) => update('instrument', String(key), Number(e.target.value))}
                  className="data rounded-md border border-rim bg-[#0a0e13] px-2.5 py-1.5 text-sm text-ink"
                />
              </label>
            ))}
          </div>
        </Panel>

        <div className="space-y-5">
          <Panel>
            <PanelHeading title="Flight profile" detail="Presets span a smallsat bus to a pallet on the ISS." />
            <label className="grid gap-1.5">
              <span className="label">Preset</span>
              <select
                value={settings.flight.id}
                onChange={(e) => {
                  const preset = FLIGHT_PRESETS.find((p) => p.id === e.target.value);
                  if (preset) {
                    setSaved(false);
                    setSettings((c) => (c ? { ...c, flight: { ...preset } } : c));
                  }
                }}
                className="data rounded-md border border-rim bg-[#0a0e13] px-3 py-2 text-sm text-ink"
              >
                {FLIGHT_PRESETS.map((preset) => (
                  <option key={preset.id} value={preset.id}>
                    {preset.name}
                  </option>
                ))}
              </select>
            </label>

            <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3">
              {[
                ['altitudeKm', 'Altitude (km)', 120, 40000, 10],
                ['inclinationDeg', 'Inclination (deg)', 0, 180, 0.1],
                ['missionDays', 'Mission (days)', 1, 3650, 1],
                ['shieldingMgPerCm2', 'Shielding (mg/cm2)', 1, 20000, 5],
                ['sramBitsMb', 'Buffer (Mb)', 0.001, 4096, 0.1],
                ['readoutVoting', 'Redundant reads', 1, 32, 1],
              ].map(([key, label, min, max, step]) => (
                <label key={key} className="grid gap-1.5">
                  <span className="label text-[0.56rem]">{String(label)}</span>
                  <input
                    type="number"
                    min={min}
                    max={max}
                    step={step}
                    value={Number(settings.flight[key as keyof typeof settings.flight])}
                    onChange={(e) => update('flight', String(key), Number(e.target.value))}
                    className="data rounded-md border border-rim bg-[#0a0e13] px-2.5 py-1.5 text-sm text-ink"
                  />
                </label>
              ))}
            </div>
          </Panel>

          <Panel>
            <PanelHeading title="Hybridisation chemistry" />
            <div className="grid grid-cols-2 gap-4">
              <label className="grid gap-1.5">
                <span className="label">Sodium (mol/L)</span>
                <input
                  type="number"
                  min={0.0001}
                  max={5}
                  step={0.01}
                  value={settings.probe.sodiumMolar}
                  onChange={(e) => update('probe', 'sodiumMolar', Number(e.target.value))}
                  className="data rounded-md border border-rim bg-[#0a0e13] px-2.5 py-1.5 text-sm text-ink"
                />
              </label>
              <label className="grid gap-1.5">
                <span className="label">Strand (nM)</span>
                <input
                  type="number"
                  min={0.001}
                  max={1e6}
                  step={1}
                  value={settings.probe.strandConcentrationNm}
                  onChange={(e) => update('probe', 'strandConcentrationNm', Number(e.target.value))}
                  className="data rounded-md border border-rim bg-[#0a0e13] px-2.5 py-1.5 text-sm text-ink"
                />
              </label>
            </div>
            <p className="mt-3 text-[0.74rem] leading-relaxed text-ink-dim">
              Higher salt raises the melting temperature and lowers the discrimination margin, which is
              why a bench that works at one salt strength can fail at another.
            </p>
          </Panel>

          <Panel>
            <PanelHeading title="Live consequence" />
            <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <Stat label="Wavelength" value={settings.instrument.emitterNm} unit="nm" />
              <Stat label="ADC" value={settings.instrument.adcBits} unit="bit" />
              <Stat label="Shielding" value={settings.flight.shieldingMgPerCm2} unit="mg/cm2" />
              <Stat label="Mission" value={settings.flight.missionDays} unit="d" />
            </dl>
            <p className="mt-3 text-[0.74rem] text-ink-dim">
              Score something on{' '}
              <a href="/variants" className="text-signal hover:underline">
                the workbench
              </a>{' '}
              to see these inputs move the score.
            </p>
          </Panel>
        </div>
      </div>
    </div>
  );
}