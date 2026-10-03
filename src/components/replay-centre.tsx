'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { ShieldCheck } from 'lucide-react';
import type { AssayRecord, ReplayReport } from '@/lib/types';
import { EmptyState, ErrorNote, Panel, PanelHeading } from './ui';

interface ListResponse {
  items: AssayRecord[];
  total: number;
}

/**
 * Replay centre.
 *
 * Recomputes each record's chain from its genesis value and reports the first
 * broken link. A tombstone is replayed too, which is the point of keeping the row.
 */
export function ReplayCentre() {
  const [records, setRecords] = useState<AssayRecord[]>([]);
  const [reports, setReports] = useState<Record<string, ReplayReport>>({});
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);

  const fetchRecords = useCallback(async (): Promise<ListResponse> => {
    const response = await fetch('/api/assays?limit=96');
    const body = (await response.json()) as ListResponse;
    if (!response.ok) throw new Error(`listing failed (${response.status})`);
    return body;
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setRecords((await fetchRecords()).items);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'listing failed');
    } finally {
      setLoading(false);
    }
  }, [fetchRecords]);

  // Applied in the promise callback; `load` stays available for the retry control.
  useEffect(() => {
    let cancelled = false;
    fetchRecords()
      .then((body) => {
        if (!cancelled) setRecords(body.items);
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
  }, [fetchRecords]);

  const replayAll = useCallback(async () => {
    setRunning(true);
    setError(null);
    const next: Record<string, ReplayReport> = {};
    for (const record of records) {
      try {
        const response = await fetch(`/api/integrity/${record.id}`);
        const body = await response.json();
        if (response.ok && body.report) next[record.id] = body.report as ReplayReport;
      } catch {
        // A record whose replay cannot be read is left out rather than faked.
      }
    }
    setReports(next);
    setRunning(false);
  }, [records]);

  const broken = Object.values(reports).filter((r) => !r.ok).length;
  const verified = Object.values(reports).filter((r) => r.ok).length;

  return (
    <div className="mx-auto max-w-[1240px] space-y-5 px-4 py-10 sm:px-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="label">Integrity replay</p>
          <h1 className="display mt-2 text-2xl text-ink sm:text-3xl">Re-derive every chain</h1>
          <p className="mt-2 max-w-prose text-[0.85rem] leading-relaxed text-ink-dim">
            Each event carries the SHA-384 seal of its predecessor. Recomputing from the genesis value
            detects any edit, because changing one field changes that seal and therefore every seal
            after it.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void replayAll()}
          disabled={running || records.length === 0}
          className="rounded-md bg-signal px-4 py-2 text-[0.82rem] font-semibold text-substrate hover:opacity-90 disabled:opacity-50"
        >
          {running ? 'Replaying' : `Replay ${records.length} record${records.length === 1 ? '' : 's'}`}
        </button>
      </header>

      {error ? <ErrorNote message={error} onRetry={() => void load()} /> : null}

      {Object.keys(reports).length > 0 ? (
        <Panel>
          <div className="flex flex-wrap gap-6">
            <div>
              <p className="label">Verified</p>
              <p className="data mt-1 text-2xl" style={{ color: 'var(--color-cleared)' }}>
                {verified}
              </p>
            </div>
            <div>
              <p className="label">Broken</p>
              <p className="data mt-1 text-2xl" style={{ color: broken > 0 ? 'var(--color-refused)' : 'var(--color-ink-dim)' }}>
                {broken}
              </p>
            </div>
            <div>
              <p className="label">Total events</p>
              <p className="data mt-1 text-2xl text-ink-dim">
                {Object.values(reports).reduce((acc, r) => acc + r.length, 0)}
              </p>
            </div>
          </div>
        </Panel>
      ) : null}

      {loading ? (
        <Panel>
          <p className="text-[0.82rem] text-ink-faint">Loading records.</p>
        </Panel>
      ) : records.length === 0 ? (
        <Panel>
          <EmptyState
            title="Nothing to replay"
            body="Records appear here once you commit one to the plate. Each carries its own audit chain."
            action={
              <Link href="/variants" className="mt-1 rounded-md bg-signal px-4 py-2 text-[0.8rem] font-semibold text-substrate">
                Score a variant
              </Link>
            }
          />
        </Panel>
      ) : (
        <Panel>
          <PanelHeading title="Records" detail="Press replay to recompute every chain." />
          <ul className="grid gap-2">
            {records.map((record) => {
              const report = reports[record.id];
              return (
                <li key={record.id} className="rounded-lg border border-rim px-3 py-2.5">
                  <div className="flex flex-wrap items-center gap-3">
                    <Link href={`/assay/${record.id}`} className="data text-[0.78rem] text-ink hover:text-signal">
                      {record.well} &middot; {record.geneSymbol} {record.hgvsP}
                    </Link>
                    {record.deletedAt ? (
                      <span className="label text-[0.52rem]" style={{ color: 'var(--color-caution)' }}>
                        tombstone
                      </span>
                    ) : null}
                    {report ? (
                      <span
                        className="ml-auto inline-flex items-center gap-1.5 text-[0.72rem]"
                        style={{ color: report.ok ? 'var(--color-cleared)' : 'var(--color-refused)' }}
                      >
                        <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
                        {report.ok
                          ? `${report.length} event${report.length === 1 ? '' : 's'} verified`
                          : `broken at #${report.brokenAt}`}
                      </span>
                    ) : (
                      <span className="ml-auto text-[0.7rem] text-ink-faint">not replayed</span>
                    )}
                  </div>

                  {report ? (
                    <div className="mt-2 grid gap-1">
                      <p className="data break-all text-[0.62rem] text-ink-faint">
                        genesis {report.genesis} &rarr; head {report.head ?? 'none'}
                      </p>
                      {report.brokenReason ? (
                        <p className="text-[0.7rem]" style={{ color: 'var(--color-refused)' }}>
                          {report.brokenReason}
                        </p>
                      ) : null}
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </Panel>
      )}

      <Panel>
        <PanelHeading title="How the chain is built" />
        <pre className="data overflow-x-auto rounded-md border border-rim bg-[#0a0e13] p-3 text-[0.7rem] leading-relaxed text-ink-dim">
{`seal_0 = "orbitgene/genesis/v1"
seal_n = SHA-384( UTF-8(seal_{n-1}) || canonicalJson(event_n) )

canonicalJson sorts object keys recursively, preserves array order,
drops undefined members, and renders dates as ISO-8601.`}
        </pre>
      </Panel>
    </div>
  );
}