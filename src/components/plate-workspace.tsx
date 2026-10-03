'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Loader2, Search } from 'lucide-react';
import type { AssayRecord } from '@/lib/types';
import { PlateGrid, PlateLegend, type PlateWell } from './plate-grid';
import { EmptyState, ErrorNote, Panel, PanelHeading, VerdictPill, scoreColor } from './ui';

interface ListResponse {
  items: AssayRecord[];
  total: number;
  limit: number;
  offset: number;
}

interface ApiError {
  error: { code: string; message: string };
}

const STATUSES = ['scored', 'probe-ordered', 'in-flight', 'retired'] as const;

/**
 * The plate workspace.
 *
 * Filters, sort and the selected well live in the query string, so the exact
 * plate a visitor is looking at survives a refresh and can be linked.
 */
export function PlateWorkspace() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const [data, setData] = useState<ListResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState(params.get('q') ?? '');
  const [selected, setSelected] = useState<string | null>(params.get('well'));

  const status = params.get('status') ?? '';
  const gene = params.get('gene') ?? '';

  const setParam = useCallback(
    (key: string, value: string) => {
      const next = new URLSearchParams(params.toString());
      if (value) next.set(key, value);
      else next.delete(key);
      router.replace(`${pathname}?${next.toString()}`, { scroll: false });
    },
    [params, pathname, router],
  );

  const fetchPlate = useCallback(async (): Promise<ListResponse> => {
    const search = new URLSearchParams();
    if (status) search.set('status', status);
    if (gene) search.set('gene', gene);
    if (query) search.set('q', query);
    search.set('limit', '96');

    const response = await fetch(`/api/assays?${search.toString()}`);
    const body = (await response.json()) as ListResponse | ApiError;
    if (!response.ok || 'error' in body) {
      throw new Error('error' in body ? body.error.message : `listing failed (${response.status})`);
    }
    return body;
  }, [status, gene, query]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await fetchPlate());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'listing failed');
    } finally {
      setLoading(false);
    }
  }, [fetchPlate]);

  // The effect applies the result in its promise callback; the URL-state writers
  // and the retry control call `load` directly.
  useEffect(() => {
    let cancelled = false;
    fetchPlate()
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
  }, [fetchPlate]);

  const wells: PlateWell[] = useMemo(
    () =>
      (data?.items ?? []).map((assay) => ({
        well: assay.well,
        score: assay.score,
        verdict: assay.verdict,
        href: `/assay/${assay.id}`,
        selected: selected === assay.well,
      })),
    [data, selected],
  );

  const focus = (data?.items ?? []).find((a) => a.well === selected) ?? null;

  return (
    <div className="mx-auto max-w-[1240px] space-y-5 px-4 py-10 sm:px-6">
      <header>
        <p className="label">Plate map</p>
        <h1 className="display mt-2 text-2xl text-ink sm:text-3xl">Your records</h1>
        <p className="mt-2 max-w-prose text-[0.85rem] leading-relaxed text-ink-dim">
          One well per scored record, coloured by its real readiness score. This plate belongs to an
          anonymous session cookie, so nothing here is visible to anyone else.
        </p>
      </header>

      {error ? <ErrorNote message={error} onRetry={() => void load()} /> : null}

      <Panel>
        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_11rem_9rem]">
          <label className="grid gap-1.5">
            <span className="label">Search</span>
            <div className="relative">
              <Search
                className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-faint"
                aria-hidden="true"
              />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onBlur={() => setParam('q', query)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') setParam('q', query);
                }}
                placeholder="gene, HGVS or note"
                className="data w-full rounded-md border border-rim bg-[#0a0e13] py-2 pl-9 pr-3 text-sm text-ink"
              />
            </div>
          </label>

          <label className="grid gap-1.5">
            <span className="label">Status</span>
            <select
              value={status}
              onChange={(e) => setParam('status', e.target.value)}
              className="data rounded-md border border-rim bg-[#0a0e13] px-3 py-2 text-sm text-ink"
            >
              <option value="">Any</option>
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>

          <label className="grid gap-1.5">
            <span className="label">Gene</span>
            <input
              defaultValue={gene}
              onBlur={(e) => setParam('gene', (e.target as HTMLInputElement).value.trim())}
              onKeyDown={(e) => {
                if (e.key === 'Enter') setParam('gene', (e.target as HTMLInputElement).value.trim());
              }}
              placeholder="BRCA1"
              className="data rounded-md border border-rim bg-[#0a0e13] px-3 py-2 text-sm uppercase text-ink"
            />
          </label>
        </div>

        <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
          <PlateLegend />
          <p className="data text-[0.7rem] text-ink-faint" aria-live="polite">
            {loading
              ? 'loading records'
              : `${data?.items.length ?? 0} of ${data?.total ?? 0} record${(data?.total ?? 0) === 1 ? '' : 's'}`}
          </p>
        </div>

        <div className="mt-4">
          {loading && !data ? (
            <div className="flex items-center gap-3 py-10 text-[0.8rem] text-ink-faint">
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
              Reading the plate from the database.
            </div>
          ) : (
            <PlateGrid
              wells={wells}
              selected={selected ?? undefined}
              onSelect={(well) => {
                setSelected(well);
                setParam('well', well);
              }}
            />
          )}
        </div>
      </Panel>

      {focus ? (
        <Panel>
          <PanelHeading
            title={`Well ${focus.well}`}
            detail={`${focus.geneSymbol} ${focus.hgvsP} (${focus.hgvsC})`}
            action={<VerdictPill verdict={focus.verdict} />}
          />
          <div className="flex flex-wrap items-center gap-6">
            <p className="data text-3xl" style={{ color: scoreColor(focus.score) }}>
              {focus.score.toFixed(1)}
            </p>
            <div className="flex flex-wrap gap-4 text-[0.75rem] text-ink-dim">
              <span>{focus.consequence}</span>
              <span>probe dTm {focus.result.thermo.deltaTmC.toFixed(2)} C</span>
              <span>{focus.status}</span>
              {focus.decision ? <span>decided {focus.verdict}</span> : <span>no decision yet</span>}
            </div>
            <Link
              href={`/assay/${focus.id}`}
              className="ml-auto rounded-md bg-signal px-4 py-2 text-[0.8rem] font-semibold text-substrate hover:opacity-90"
            >
              Open record
            </Link>
          </div>
        </Panel>
      ) : null}

      {!loading && (data?.items.length ?? 0) === 0 ? (
        <Panel>
          <EmptyState
            title="This plate is empty"
            body="Score a substitution and commit it to a well. Records persist against this browser session, survive reloads, and can be sealed, shared and retired."
            action={
              <Link
                href="/variants"
                className="mt-1 rounded-md bg-signal px-4 py-2 text-[0.8rem] font-semibold text-substrate hover:opacity-90"
              >
                Score a variant
              </Link>
            }
          />
        </Panel>
      ) : null}

      {data && data.items.length > 0 ? (
        <Panel>
          <PanelHeading title="Records" detail="Newest first." />
          <ul className="grid gap-2">
            {data.items.map((assay) => (
              <li key={assay.id}>
                <Link
                  href={`/assay/${assay.id}`}
                  className="flex flex-wrap items-center gap-3 rounded-lg border border-rim px-3 py-2.5 transition-colors hover:border-signal/50"
                >
                  <span
                    className="data grid h-8 w-8 shrink-0 place-items-center rounded-full border text-[0.6rem] font-semibold"
                    style={{
                      borderColor: scoreColor(assay.score),
                      color: scoreColor(assay.score),
                      background: `color-mix(in oklab, ${scoreColor(assay.score)} 12%, transparent)`,
                    }}
                  >
                    {assay.well}
                  </span>
                  <span className="data text-[0.78rem] text-ink">
                    {assay.geneSymbol} {assay.hgvsP}
                  </span>
                  <span className="data text-[0.7rem] text-ink-faint">{assay.hgvsC}</span>
                  <span className="data ml-auto text-[0.78rem]" style={{ color: scoreColor(assay.score) }}>
                    {assay.score.toFixed(1)}
                  </span>
                  <VerdictPill verdict={assay.verdict} />
                </Link>
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}
    </div>
  );
}