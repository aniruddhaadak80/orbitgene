'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Copy, ExternalLink, ShieldCheck, Trash2 } from 'lucide-react';
import type { AssayRecord, FlightProfile, InstrumentProfile } from '@/lib/types';
import { FactorLedger, GateList } from './factor-ledger';
import { Panel, PanelHeading, ScoreDial, Stat, VerdictPill } from './ui';

const VERDICTS = ['FLIGHT-GO', 'GROUND-ONLY', 'REDESIGN-PROBE', 'HOLD-FOR-EVIDENCE'] as const;
const STATUSES = ['scored', 'probe-ordered', 'in-flight', 'retired'] as const;

interface IntegritySummary {
  ok: boolean;
  length: number;
  genesis: string;
  head: string | null;
  brokenAt: number | null;
  brokenReason: string | null;
}

/**
 * A single record.
 *
 * Every control here mutates persisted state: the status and notes write back and
 * extend the chain, the decision is sealed into it, the share token mints a public
 * read-only view, and the retirement demands the record's own terminal seal.
 */
export function AssayDetail({
  assay: initial,
  integrity,
  instrument,
  flight,
}: {
  assay: AssayRecord;
  integrity: IntegritySummary;
  instrument: InstrumentProfile;
  flight: FlightProfile;
  defaults: unknown;
}) {
  const router = useRouter();
  const [assay, setAssay] = useState(initial);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [rationale, setRationale] = useState('');
  const [sharePath, setSharePath] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [confirming, setConfirming] = useState(false);

  async function call(path: string, body: unknown, label: string, method = 'POST') {
    setBusy(label);
    setError(null);
    try {
      const response = await fetch(path, {
        method,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const payload = (await response.json()) as {
        assay?: AssayRecord;
        path?: string;
        retired?: string;
        error?: { message: string };
      };
      if (!response.ok) {
        throw new Error(payload.error?.message ?? `${label} failed (${response.status})`);
      }
      if (payload.assay) setAssay(payload.assay);
      if (payload.path) setSharePath(payload.path);
      router.refresh();
      return payload;
    } catch (e) {
      setError(e instanceof Error ? e.message : `${label} failed`);
      return null;
    } finally {
      setBusy(null);
    }
  }

  const result = assay.result;
  const retired = assay.deletedAt !== null;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="label">{`Well ${assay.well}`}</p>
          <h1 className="display mt-2 text-2xl text-ink sm:text-3xl">
            {assay.geneSymbol} <span className="text-mutation">{assay.hgvsP}</span>
          </h1>
          <p className="data mt-1.5 text-[0.8rem] text-ink-dim">
            {assay.hgvsC} on {assay.uniprotAccession} / {assay.refseqMrna}, {assay.consequence}
          </p>
        </div>

        <div className="flex items-center gap-4">
          <VerdictPill verdict={assay.verdict} />
          <ScoreDial score={assay.score} verdict={assay.verdict} size={116} />
        </div>
      </div>

      {retired ? (
        <p
          role="status"
          className="rounded-lg border px-4 py-3 text-[0.78rem]"
          style={{
            borderColor: 'color-mix(in oklab, var(--color-caution) 45%, transparent)',
            background: 'color-mix(in oklab, var(--color-caution) 8%, transparent)',
            color: 'var(--color-ink-dim)',
          }}
        >
          This record was retired on {assay.deletedAt}. The row and its {integrity.length}-event chain are
          retained as a tombstone, so the replay below still verifies.
        </p>
      ) : null}

      {error ? (
        <p role="alert" className="rounded-lg border border-refused/40 bg-refused/8 px-4 py-3 text-[0.78rem] text-ink-dim">
          {error}
        </p>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
        <div className="space-y-5">
          <Panel>
            <PanelHeading
              title="Factor ledger"
              detail={`Stored with engine ${result.engine}. The score was recomputed from this snapshot at commit time and is not recalculated on read.`}
            />
            <FactorLedger result={result} />
          </Panel>

          <Panel>
            <PanelHeading title="Gates" />
            <GateList gates={result.gates} />
          </Panel>

          <Panel>
            <PanelHeading title="Probe and detector" />
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <Stat label="Probe dTm" value={result.thermo.deltaTmC.toFixed(2)} unit="C" color="var(--color-caution)" />
              <Stat label="Wild type Tm" value={result.thermo.wtTmC.toFixed(2)} unit="C" />
              <Stat label="SNR" value={result.signal.snr.toFixed(1)} color="var(--color-signal)" />
              <Stat label="Fold separation" value={result.signal.discriminationMargin.toFixed(2)} unit="x" />
            </div>
            <div className="mt-4 grid gap-2">
              {[
                ['Wild-type probe', result.thermo.wtProbe],
                ['Mutant probe', result.thermo.probe],
              ].map(([label, value]) => (
                <div key={label}>
                  <p className="label text-[0.58rem]">{label}</p>
                  <p className="data mt-1 break-all rounded-md border border-rim bg-[#0a0e13] px-2.5 py-2 text-[0.72rem] tracking-[0.08em] text-ink-dim">
                    {value}
                  </p>
                </div>
              ))}
            </div>
          </Panel>

          <Panel>
            <PanelHeading title="Radiation budget" />
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <Stat label="Total dose" value={result.flight.totalDoseKrad.toFixed(4)} unit="krad" />
              <Stat label="GCR rate" value={result.flight.gcrDoseRateRadDay} unit="rad/day" />
              <Stat label="Upsets" value={result.flight.expectedUpsets} />
              <Stat
                label="Required reads"
                value={Number.isFinite(result.flight.requiredVoting) ? result.flight.requiredVoting : 'unbounded'}
                color="var(--color-ink-dim)"
              />
            </div>
          </Panel>
        </div>

        <div className="space-y-5">
          <Panel>
            <PanelHeading title="Configuration" detail="Applied when this record was scored." />
            <dl className="grid gap-2 text-[0.72rem]">
              {[
                ['Instrument', instrument.name],
                ['Emitter', `${instrument.emitterNm} nm at ${instrument.emitterMw} mW`],
                ['Detector', `${instrument.detectorResponsivityAw} A/W, ${instrument.darkCurrentPa} pA dark`],
                ['ADC', `${instrument.adcBits} bit over ${instrument.adcFullScaleV} V, gain ${instrument.gain}`],
                ['Integration', `${instrument.integrationMs} ms per sample`],
                ['Flight', flight.name],
                ['Shielding', `${flight.shieldingMgPerCm2} mg/cm2`],
                ['Mission', `${flight.missionDays} days at ${flight.altitudeKm} km, ${flight.inclinationDeg} deg`],
                ['Redundancy', `${flight.readoutVoting} readouts over ${flight.sramBitsMb} Mb`],
              ].map(([label, value]) => (
                <div key={label} className="flex flex-wrap justify-between gap-2 border-b border-rim/60 pb-1.5">
                  <dt className="label text-[0.58rem]">{label}</dt>
                  <dd className="data min-w-0 text-right text-ink-dim">{value}</dd>
                </div>
              ))}
            </dl>
          </Panel>

          {!retired ? (
            <>
              <Panel>
                <PanelHeading title="Status and notes" detail="Writing here appends a sealed event." />
                <div className="grid gap-3">
                  <label className="grid gap-1.5">
                    <span className="label">Status</span>
                    <select
                      value={assay.status}
                      onChange={(e) =>
                        void call(`/api/assays/${assay.id}`, { status: e.target.value }, 'status update', 'PATCH')
                      }
                      disabled={busy !== null}
                      className="data rounded-md border border-rim bg-[#0a0e13] px-3 py-2 text-sm capitalize text-ink"
                    >
                      {STATUSES.map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="grid gap-1.5">
                    <span className="label">Notes</span>
                    <div className="flex gap-2">
                      <input
                        value={note}
                        onChange={(e) => setNote(e.target.value)}
                        maxLength={200}
                        placeholder="Add a note to this record"
                        className="data flex-1 rounded-md border border-rim bg-[#0a0e13] px-3 py-2 text-sm text-ink"
                      />
                      <button
                        type="button"
                        onClick={() => {
                          void call(`/api/assays/${assay.id}`, { notes: note }, 'note save', 'PATCH').then(() =>
                            setNote(''),
                          );
                        }}
                        disabled={busy !== null || note.trim().length === 0}
                        className="rounded-md border border-rim px-3 py-2 text-[0.78rem] text-ink-dim hover:border-signal/60 hover:text-signal disabled:opacity-50"
                      >
                        Save
                      </button>
                    </div>
                  </label>
                </div>
              </Panel>

              <Panel>
                <PanelHeading title="Seal a decision" detail="Appends a decided event and its seal." />
                <div className="flex flex-wrap gap-2">
                  {VERDICTS.map((v) => (
                    <button
                      key={v}
                      type="button"
                      disabled={busy !== null}
                      onClick={() => {
                        void call(
                          `/api/assays/${assay.id}/decision`,
                          { verdict: v, rationale: rationale || `Signed off as ${v} from the plate view.` },
                          `decision ${v}`,
                        ).then(() => setRationale(''));
                      }}
                      className="rounded-md border border-rim px-3 py-1.5 text-[0.72rem] text-ink-dim transition-colors hover:border-signal/60 hover:text-signal disabled:opacity-50"
                    >
                      {v}
                    </button>
                  ))}
                </div>
                <label className="mt-3 grid gap-1.5">
                  <span className="label">Rationale</span>
                  <input
                    value={rationale}
                    onChange={(e) => setRationale(e.target.value)}
                    maxLength={300}
                    placeholder="Why this call, in one line"
                    className="data rounded-md border border-rim bg-[#0a0e13] px-3 py-2 text-sm text-ink"
                  />
                </label>
                {assay.decision ? (
                  <p className="mt-3 rounded-md border border-rim px-3 py-2 text-[0.74rem] text-ink-dim">
                    <span className="label text-[0.58rem]">Sealed</span> {assay.decision.verdict}:{' '}
                    {assay.decision.rationale} <span className="text-ink-faint">({assay.decision.decidedAt})</span>
                  </p>
                ) : null}
              </Panel>

              <Panel>
                <PanelHeading title="Share" detail="A 128-bit token opens a public, read-only view with its own replay." />
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => void call('/api/share', { assayId: assay.id }, 'share')}
                    disabled={busy !== null}
                    className="inline-flex items-center gap-2 rounded-md border border-rim px-3 py-2 text-[0.78rem] text-ink-dim hover:border-signal/60 hover:text-signal disabled:opacity-50"
                  >
                    <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                    Mint a share link
                  </button>
                  {sharePath ? (
                    <>
                      <a href={sharePath} className="text-[0.78rem] text-signal hover:underline">
                        {sharePath}
                      </a>
                      <button
                        type="button"
                        onClick={() => {
                          void navigator.clipboard?.writeText(`${window.location.origin}${sharePath}`);
                          setCopied(true);
                          window.setTimeout(() => setCopied(false), 1800);
                        }}
                        className="inline-flex items-center gap-1.5 rounded-md border border-rim px-2.5 py-1.5 text-[0.72rem] text-ink-dim hover:border-signal/60 hover:text-signal"
                      >
                        <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                        {copied ? 'Copied' : 'Copy'}
                      </button>
                    </>
                  ) : null}
                </div>
              </Panel>

              <Panel>
                <PanelHeading
                  title="Retire"
                  detail="Demands the record's own terminal seal, so nothing can be deleted without having read it. The row stays as a replayable tombstone."
                />
                {!confirming ? (
                  <button
                    type="button"
                    onClick={() => setConfirming(true)}
                    className="inline-flex items-center gap-2 rounded-md border border-refused/50 px-3 py-2 text-[0.78rem] text-refused hover:bg-refused/10"
                  >
                    <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                    Retire this record
                  </button>
                ) : (
                  <div className="grid gap-2">
                    <p className="data break-all text-[0.68rem] text-ink-faint">
                      Confirm by sending seal <span className="text-ink-dim">{assay.seal.slice(0, 32)}</span>
                    </p>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          void call(
                            `/api/assays/${assay.id}`,
                            { seal: assay.seal, confirm: true },
                            'retire',
                            'DELETE',
                          );
                          setConfirming(false);
                        }}
                        className="rounded-md border border-refused/50 px-3 py-2 text-[0.78rem] text-refused hover:bg-refused/10"
                      >
                        Yes, retire it
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirming(false)}
                        className="rounded-md border border-rim px-3 py-2 text-[0.78rem] text-ink-dim"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </Panel>
            </>
          ) : null}

          <Panel>
            <PanelHeading title="Seal" />
            <div className="grid gap-2">
              <div className="flex items-center gap-2 text-[0.76rem]">
                <ShieldCheck
                  className="h-4 w-4"
                  aria-hidden="true"
                  style={{ color: integrity.ok ? 'var(--color-cleared)' : 'var(--color-refused)' }}
                />
                <span style={{ color: integrity.ok ? 'var(--color-cleared)' : 'var(--color-refused)' }}>
                  {integrity.ok
                    ? `Chain verifies across ${integrity.length} event${integrity.length === 1 ? '' : 's'}`
                    : `Chain broken at event ${integrity.brokenAt}`}
                </span>
              </div>
              {integrity.brokenReason ? (
                <p className="text-[0.72rem] text-refused">{integrity.brokenReason}</p>
              ) : null}
              <p className="data break-all rounded-md border border-rim bg-[#0a0e13] px-2.5 py-2 text-[0.66rem] text-ink-faint">
                {assay.seal}
              </p>
              <p className="data text-[0.64rem] text-ink-faint">input digest {result.inputDigest}</p>
              <Link href="/verify" className="text-[0.78rem] text-signal hover:underline">
                Open the replay centre
              </Link>
            </div>
          </Panel>
        </div>
      </div>
    </div>
  );
}