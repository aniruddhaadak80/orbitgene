'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, RefreshCw } from 'lucide-react';
import type { EngineResult, SourceMeta } from '@/lib/types';
import { ScoreDial, SourceStrip, Stat, VerdictPill, scoreColor } from './ui';

interface CatalogEntry {
  accession: string;
  symbol: string;
  name: string;
  blurb: string;
  featured: { proteinPosition: number; refAa: string; altAa: string };
}

interface ScoreResponse {
  result: EngineResult;
  sources: SourceMeta[];
  weather: { kpIndex: number; kpLabel: string; protonFluxPfu: number; observationTime: string };
  gene: { accession: string; symbol: string; refseqMrna: string; proteinLength: number };
}

interface ApiError {
  error: { code: string; message: string };
}

/**
 * Landing primary action.
 *
 * This is not a marketing hero with a decorative button: it retrieves a real
 * UniProt entry and its RefSeq coding sequence, runs the real engine against the
 * real live space weather, and shows the actual verdict. The first paint happens
 * before any request so the layout never jumps.
 */
export function LandingDemo() {
  const [catalog, setCatalog] = useState<CatalogEntry[]>([]);
  const [selected, setSelected] = useState<string>('');
  const [data, setData] = useState<ScoreResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [scoring, setScoring] = useState(false);

  /**
   * Scores one catalogue entry.
   *
   * The entry is passed in rather than looked up from `catalog` on purpose. The
   * first score happens from a mount-time effect, where `catalog` is still the
   * empty array, so a closure over that state would always fail to find the gene
   * and the demo would greet every visitor with "choose a gene first" while
   * showing a gene already selected.
   */
  const fetchScore = useCallback(async (entry: CatalogEntry, fresh: boolean): Promise<ScoreResponse> => {
    const response = await fetch('/api/score', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        accession: entry.accession,
        proteinPosition: entry.featured.proteinPosition,
        refAa: entry.featured.refAa,
        altAa: entry.featured.altAa,
        fresh,
      }),
    });
    const body = (await response.json()) as ScoreResponse | ApiError;
    if (!response.ok || 'error' in body) {
      throw new Error('error' in body ? body.error.message : `scoring failed (${response.status})`);
    }
    return body;
  }, []);

  const run = useCallback(
    async (entry: CatalogEntry, fresh = false) => {
      setSelected(entry.accession);
      setScoring(true);
      setError(null);
      try {
        setData(await fetchScore(entry, fresh));
      } catch (e) {
        setError(e instanceof Error ? e.message : 'scoring failed');
      } finally {
        setScoring(false);
      }
    },
    [fetchScore],
  );

  useEffect(() => {
    let cancelled = false;
    fetch('/api/catalog')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`catalog responded ${r.status}`))))
      .then(async (body: { catalog: CatalogEntry[] }) => {
        if (cancelled) return;
        setCatalog(body.catalog);
        const first = body.catalog[0];
        if (!first) return;
        setSelected(first.accession);
        setScoring(true);
        // Awaited inside the promise callback, so no state is written
        // synchronously from an effect body.
        try {
          const scored = await fetchScore(first, false);
          if (!cancelled) setData(scored);
        } catch (e) {
          if (!cancelled) setError(e instanceof Error ? e.message : 'scoring failed');
        } finally {
          if (!cancelled) setScoring(false);
        }
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const entry = catalog.find((c) => c.accession === selected);

  return (
    <div className="plate relative overflow-hidden p-5 sm:p-6">
      {/* Scan line while a real request is in flight. */}
      {scoring ? (
        <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 h-px overflow-hidden">
          <span className="scan-line block h-px w-1/3 bg-signal" />
        </div>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_auto]">
        <div className="min-w-0">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="label">Live readiness read</p>
              <h2 className="display mt-1.5 text-xl leading-tight text-ink sm:text-2xl">
                {data ? (
                  <>
                    {data.result.codon.hgvsP} <span className="text-mutation">{data.result.codon.hgvsC}</span>
                  </>
                ) : (
                  'Pick a gene to score a real substitution'
                )}
              </h2>
            </div>
            {data ? <VerdictPill verdict={data.result.verdict} /> : null}
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            <label htmlFor="landing-gene" className="sr-only">
              Gene to score
            </label>
            <select
              id="landing-gene"
              value={selected}
              onChange={(e) => {
                const next = catalog.find((c) => c.accession === e.target.value);
                if (next) void run(next);
              }}
              className="data min-w-[13rem] rounded-md border border-rim bg-[#0a0e13] px-3 py-2 text-sm text-ink"
            >
              {catalog.map((item) => (
                <option key={item.accession} value={item.accession}>
                  {item.symbol} - {item.accession}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => entry && void run(entry, true)}
              disabled={!selected || scoring}
              className="inline-flex items-center gap-2 rounded-md border border-rim px-3 py-2 text-[0.78rem] text-ink-dim transition-colors hover:border-signal/60 hover:text-signal disabled:opacity-50"
            >
              <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
              Re-fetch live
            </button>
            <Link
              href={selected ? `/variants?accession=${selected}&position=${entry?.featured.proteinPosition ?? ''}` : '/variants'}
              className="inline-flex items-center gap-2 rounded-md bg-signal px-3 py-2 text-[0.78rem] font-semibold text-substrate transition-opacity hover:opacity-90"
            >
              Open the scrub
              <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
            </Link>
          </div>

          {entry ? <p className="mt-3 max-w-prose text-[0.78rem] leading-relaxed text-ink-dim">{entry.blurb}</p> : null}

          {error ? (
            <p role="alert" className="mt-4 rounded-md border border-refused/40 bg-refused/8 px-3 py-2 text-[0.76rem] text-ink-dim">
              {error}
            </p>
          ) : null}

          {data ? (
            <>
              <dl className="mt-5 grid grid-cols-2 gap-4 sm:grid-cols-4">
                <Stat label="Score" value={data.result.score.toFixed(1)} color={scoreColor(data.result.score)} />
                <Stat label="Probe dTm" value={data.result.thermo.deltaTmC.toFixed(2)} unit="C" color="var(--color-caution)" />
                <Stat label="SNR" value={data.result.signal.snr.toFixed(1)} color="var(--color-signal)" />
                <Stat
                  label="Dose"
                  value={data.result.flight.totalDoseKrad.toFixed(3)}
                  unit="krad"
                  color="var(--color-ink-dim)"
                />
              </dl>

              <ul className="mt-5 grid gap-1.5">
                {data.result.factors.map((f) => (
                  <li key={f.key} className="flex items-center gap-2">
                    <span className="label w-40 shrink-0 truncate text-[0.58rem]">{f.label}</span>
                    <span className="h-1 flex-1 overflow-hidden rounded-full bg-rim">
                      <span
                        className="block h-full rounded-full"
                        style={{
                          width: `${Math.max(2, f.support * 100)}%`,
                          background: 'var(--color-signal)',
                        }}
                      />
                    </span>
                    <span className="data w-24 shrink-0 text-right text-[0.68rem] text-ink-dim">
                      {f.contribution.toFixed(3)}
                    </span>
                  </li>
                ))}
              </ul>

              <div className="mt-5">
                <SourceStrip sources={data.sources} />
                <p className="data mt-2 text-[0.66rem] text-ink-faint">
                  Space weather Kp {data.weather.kpIndex} ({data.weather.kpLabel}) at{' '}
                  {data.weather.observationTime}
                </p>
              </div>
            </>
          ) : loading || scoring ? (
            <div className="mt-5 flex items-center gap-3 text-[0.76rem] text-ink-faint">
              <span className="h-2 w-2 animate-pulse rounded-full bg-signal" />
              Retrieving the UniProt entry and its RefSeq coding sequence, then running the engine.
            </div>
          ) : null}
        </div>

        <div className="flex shrink-0 items-center justify-center lg:flex-col lg:items-end">
          {data ? (
            <ScoreDial score={data.result.score} verdict={data.result.verdict} size={148} />
          ) : (
            <div
              className="grid h-[148px] w-[148px] place-items-center rounded-full border border-rim text-[0.68rem] text-ink-faint"
              aria-hidden="true"
            >
              awaiting
            </div>
          )}
        </div>
      </div>
    </div>
  );
}