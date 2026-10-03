'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Check, Loader2, RefreshCw, Save } from 'lucide-react';
import type { CodonChange } from '@/lib/genetics';
import type { AnnotatedSite, ClinicalContext, EngineResult, SourceMeta } from '@/lib/types';
import { CodonScrub } from './codon-scrub';
import { FactorLedger, GateList } from './factor-ledger';
import { ErrorNote, Panel, PanelHeading, ScoreDial, SourceStrip, Stat, VerdictPill, scoreColor } from './ui';
import { VerdictExplainer } from './verdict-explainer';

interface CatalogEntry {
  accession: string;
  symbol: string;
  name: string;
  blurb: string;
  featured: { proteinPosition: number; refAa: string; altAa: string };
}

interface Annotated {
  position: number;
  refAa: string;
  altAas: string[];
  kind: 'mutagenesis' | 'natural-variant';
  description: string;
  publications: string[];
}

interface GeneResponse {
  gene: {
    accession: string;
    entryName: string;
    symbol: string;
    name: string;
    organism: string;
    reviewStatus: string;
    proteinLength: number;
    refseqMrna: string;
    cdsLength: number;
    sequenceChecksum: string;
    fetchedAt: string;
  };
  sites: AnnotatedSite[];
  annotated: Annotated[];
  sources: SourceMeta[];
}

interface ScoreResponse {
  result: EngineResult;
  dial: Array<{ altBase: string; change: CodonChange }>;
  sources: SourceMeta[];
  clinical: ClinicalContext;
  weather: { kpIndex: number; kpLabel: string; protonFluxPfu: number; observationTime: string };
}

interface ApiError {
  error: { code: string; message: string };
}

const RESIDUES = 'ACDEFGHIKLMNPQRSTVWY';

/**
 * The ClinVar line.
 *
 * It reports three different things on purpose. A reported classification is
 * quoted with its review status, because "Pathogenic, reviewed by expert panel"
 * and "Pathogenic, criteria provided, conflicting" are not the same claim. A
 * variant ClinVar has never seen is stated as absence, never as reassurance. And
 * an upstream failure is labelled as a failure, because showing "no record found"
 * after ClinVar timed out would be a lie.
 */
function ClinicalNote({ clinical }: { clinical: ClinicalContext }) {
  const hit = clinical.hit;

  const tone =
    clinical.status === 'unavailable'
      ? 'var(--color-caution)'
      : hit && /pathogenic/i.test(hit.significance)
        ? 'var(--color-mutation)'
        : hit
          ? 'var(--color-signal)'
          : 'var(--color-dim)';

  const border =
    clinical.status === 'unavailable'
      ? 'var(--color-caution)'
      : hit && /pathogenic/i.test(hit.significance)
        ? 'var(--color-mutation)'
        : 'var(--color-rim)';

  return (
    <div
      className="rounded border-l-2 bg-panel-raised px-3 py-2 text-xs"
      style={{ borderLeftColor: border }}
    >
      <p className="font-semibold" style={{ color: tone }}>
        {clinical.status === 'unavailable'
          ? 'ClinVar lookup did not run'
          : hit
            ? `ClinVar: ${hit.significance}`
            : 'ClinVar: no record for this substitution'}
      </p>

      {hit ? (
        <>
          <p className="mt-1 text-dim">
            {hit.accession} &middot; {hit.reviewStatus}
            {hit.lastEvaluated ? ` · last evaluated ${hit.lastEvaluated.slice(0, 10)}` : ''}
          </p>
          {hit.title ? <p className="mt-1 font-mono text-[11px] text-dim">{hit.title}</p> : null}
          {hit.trait ? <p className="mt-1 text-dim">Condition: {hit.trait}</p> : null}
        </>
      ) : (
        <p className="mt-1 text-dim">
          {clinical.status === 'unavailable'
            ? 'This is an upstream failure, not a statement about the variant.'
            : `ClinVar has no classification for "${clinical.query}". Absence of a record is not evidence that a variant is benign.`}
        </p>
      )}

      {hit ? (
        <a
          href={hit.url}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-1 inline-block text-signal underline underline-offset-2"
        >
          Open in ClinVar
        </a>
      ) : null}
    </div>
  );
}

export function VariantWorkbench() {
  const router = useRouter();
  const params = useSearchParams();

  const [catalog, setCatalog] = useState<CatalogEntry[]>([]);
  const [accession, setAccession] = useState(params.get('accession') ?? '');
  const [gene, setGene] = useState<GeneResponse | null>(null);
  /**
   * The position and alternate residue hold only what the visitor has actually
   * chosen. Anything left empty falls back to the catalogue's featured variant
   * for the selected gene, which is derived during render rather than written
   * into state by an effect: seeding it from an effect would both cascade
   * renders and leave a deep link like `/variants?accession=P38398` with nothing
   * to score, quietly turning every shared link into a dead end.
   */
  const [positionOverride, setPositionOverride] = useState<string>(params.get('position') ?? '');

  const [altAaOverride, setAltAaOverride] = useState('');
  const [baseOffset, setBaseOffset] = useState<number | undefined>(undefined);
  const [altBase, setAltBase] = useState<string | undefined>(undefined);

  const [score, setScore] = useState<ScoreResponse | null>(null);
  const [scoring, setScoring] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [well, setWell] = useState('A1');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);

  /* Catalog and gene context ---------------------------------------- */

  useEffect(() => {
    let cancelled = false;
    fetch('/api/catalog')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`catalog responded ${r.status}`))))
      .then((body: { catalog: CatalogEntry[] }) => {
        if (cancelled) return;
        setCatalog(body.catalog);
      })
      .catch((e: Error) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, []);

  /**
   * Seed the form once the catalogue is known.
   *
   * Derived during render rather than set in an effect, so a deep link such as
   * `/variants?accession=P38398` scores its featured variant on arrival.
   */
  const effectiveAccession = accession || catalog[0]?.accession || '';
  const featured = catalog.find((c) => c.accession === effectiveAccession);
  const position = positionOverride || (featured ? String(featured.featured.proteinPosition) : '');
  const altAa = altAaOverride || featured?.featured.altAa || 'V';

  const fetchGene = useCallback(async (next: string, fresh = false): Promise<GeneResponse> => {
    const response = await fetch(`/api/catalog?accession=${encodeURIComponent(next)}${fresh ? '&fresh=true' : ''}`);
    const body = (await response.json()) as GeneResponse | ApiError;
    if (!response.ok || 'error' in body) {
      throw new Error('error' in body ? body.error.message : `gene lookup failed (${response.status})`);
    }
    return body;
  }, []);

  const loadGene = useCallback(
    async (next: string, fresh = false) => {
      if (!next) return;
      setError(null);
      try {
        setGene(await fetchGene(next, fresh));
      } catch (e) {
        setGene(null);
        setError(e instanceof Error ? e.message : 'gene lookup failed');
      }
    },
    [fetchGene],
  );

  // Both lookups run in promise callbacks inside the effect. The refresh control
  // calls `loadGene` directly, so no state is written synchronously in an effect.
  useEffect(() => {
    let cancelled = false;
    if (effectiveAccession) {
      fetchGene(effectiveAccession)
        .then((body) => {
          if (cancelled) return;
          setGene(body);
          setSaved(null);
        })
        .catch((e: Error) => {
          if (cancelled) return;
          setGene(null);
          setError(e.message);
        });
    }
    return () => {
      cancelled = true;
    };
  }, [effectiveAccession, fetchGene]);

  /* Scoring ---------------------------------------------------------- */

  const proteinPosition = Number(position);
  const positionValid = Number.isInteger(proteinPosition) && proteinPosition >= 1;

  const fetchScore = useCallback(async (): Promise<ScoreResponse> => {
    const response = await fetch('/api/score', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        accession: effectiveAccession,
        proteinPosition,
        altAa,
        ...(baseOffset === undefined ? {} : { baseOffset }),
      }),
    });
    const body = (await response.json()) as ScoreResponse | ApiError;
    if (!response.ok || 'error' in body) {
      throw new Error('error' in body ? body.error.message : `scoring failed (${response.status})`);
    }
    return body;
  }, [effectiveAccession, proteinPosition, altAa, baseOffset]);

  const runScore = useCallback(async () => {
    if (!effectiveAccession || !positionValid) return;
    setScoring(true);
    setError(null);
    try {
      setScore(await fetchScore());
    } catch (e) {
      setScore(null);
      setError(e instanceof Error ? e.message : 'scoring failed');
    } finally {
      setScoring(false);
    }
  }, [effectiveAccession, positionValid, fetchScore]);

  // Debounced live re-score so scrubbing feels immediate. The result is applied
  // in the promise callback, never synchronously in the effect body.
  useEffect(() => {
    if (!effectiveAccession || !positionValid) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      setScoring(true);
      fetchScore()
        .then((body) => {
          if (!cancelled) setScore(body);
        })
        .catch((e: Error) => {
          if (cancelled) return;
          setScore(null);
          setError(e.message);
        })
        .finally(() => {
          if (!cancelled) setScoring(false);
        });
    }, 220);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [effectiveAccession, positionValid, proteinPosition, altAa, baseOffset, altBase, fetchScore]);

  /* Persistence ------------------------------------------------------ */

  async function save() {
    if (!score) return;
    setSaving(true);
    setError(null);
    setSaved(null);
    try {
      const response = await fetch('/api/assays', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          accession: effectiveAccession,
          proteinPosition,
          refAa: score.result.codon.refAa,
          altAa: score.result.codon.altAa,
          baseOffset: score.result.codon.baseOffset,
          well,
          notes,
          idempotencyKey: `scrub-${accession}-${proteinPosition}-${score.result.codon.hgvsC}-${well}`,
        }),
      });
      const body = (await response.json()) as { assay?: { id: string }; error?: { message: string } };
      if (!response.ok || !body.assay) {
        throw new Error(body.error?.message ?? `save failed (${response.status})`);
      }
      setSaved(body.assay.id);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'save failed');
    } finally {
      setSaving(false);
    }
  }

  const codonLabel = useMemo(() => {
    if (!score) return null;
    return score.result.codon;
  }, [score]);

  return (
    <div className="mx-auto max-w-[1240px] space-y-5 px-4 py-10 sm:px-6">
      <header>
        <p className="label">Variant workbench</p>
        <h1 className="display mt-2 text-2xl text-ink sm:text-3xl">Score a real substitution</h1>
        <p className="mt-2 max-w-prose text-[0.85rem] leading-relaxed text-ink-dim">
          Pick a gene, choose a residue, then change any base of its codon. Every change re-runs
          the shared engine and redraws the ledger below.
        </p>
      </header>

      {error ? <ErrorNote message={error} onRetry={() => void runScore()} /> : null}

      <div className="grid gap-5 lg:grid-cols-[22rem_minmax(0,1fr)]">
        {/* Input column */}
        <div className="space-y-5">
          <Panel>
            <PanelHeading title="Target" detail="Sequence and context come from UniProt and RefSeq." />

            <div className="grid gap-3">
              <label className="grid gap-1.5">
                <span className="label">Gene</span>
                <select
                  value={effectiveAccession}
                  onChange={(e) => {
                    // Switching gene re-seeds the position and residue from that
                    // gene's featured variant, unless a URL position pins it.
                    setAccession(e.target.value);
                    setPositionOverride(params.get('position') ?? '');
                    setAltAaOverride('');
                    setBaseOffset(undefined);
                    setAltBase(undefined);
                  }}
                  className="data rounded-md border border-rim bg-[#0a0e13] px-3 py-2 text-sm text-ink"
                >
                  {catalog.map((item) => (
                    <option key={item.accession} value={item.accession}>
                      {item.symbol} - {item.accession}
                    </option>
                  ))}
                </select>
              </label>

              <div className="grid grid-cols-2 gap-3">
                <label className="grid gap-1.5">
                  <span className="label">Position</span>
                  <input
                    type="number"
                    min={1}
                    max={gene?.gene.proteinLength ?? 5000}
                    value={position}
                    onChange={(e) => setPositionOverride(e.target.value)}
                    className="data rounded-md border border-rim bg-[#0a0e13] px-3 py-2 text-sm text-ink"
                  />
                </label>
                <label className="grid gap-1.5">
                  <span className="label">Alternate residue</span>
                  <select
                    value={altAa}
                    onChange={(e) => setAltAaOverride(e.target.value)}
                    className="data rounded-md border border-rim bg-[#0a0e13] px-3 py-2 text-sm text-ink"
                  >
                    {[...RESIDUES].map((r) => (
                      <option key={r} value={r}>
                        {r}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            </div>

            {gene ? (
              <dl className="mt-4 grid gap-2 border-t border-rim pt-4 text-[0.7rem]">
                {[
                  ['Entry', gene.gene.entryName],
                  ['Organism', gene.gene.organism],
                  ['Length', `${gene.gene.proteinLength} aa`],
                  ['Transcript', gene.gene.refseqMrna],
                  ['CDS', `${gene.gene.cdsLength} nt`],
                  ['Checksum', gene.gene.sequenceChecksum],
                ].map(([label, value]) => (
                  <div key={label} className="flex justify-between gap-3">
                    <dt className="label text-[0.58rem]">{label}</dt>
                    <dd className="data min-w-0 truncate text-right text-ink-dim">{value}</dd>
                  </div>
                ))}
              </dl>
            ) : null}

            <button
              type="button"
              onClick={() => void loadGene(effectiveAccession, true)}
              disabled={!effectiveAccession}
              className="mt-4 inline-flex items-center gap-2 rounded-md border border-rim px-3 py-2 text-[0.76rem] text-ink-dim transition-colors hover:border-signal/60 hover:text-signal disabled:opacity-50"
            >
              <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
              Re-fetch live entry
            </button>
          </Panel>

          {gene ? (
            <Panel>
              <PanelHeading
                title="Annotated residues"
                detail={`${gene.annotated.length} curated variant or mutagenesis sites in this entry.`}
              />
              {gene.annotated.length === 0 ? (
                <p className="text-[0.76rem] leading-relaxed text-ink-faint">
                  This entry carries no curated annotations in the sealed sample, so any record built
                  from it will land on HOLD-FOR-EVIDENCE until a live fetch supplies them.
                </p>
              ) : (
                <ul className="grid max-h-72 gap-1.5 overflow-y-auto pr-1">
                  {gene.annotated.map((item) => (
                    <li key={`${item.position}-${item.refAa}-${item.altAas.join('')}`}>
                      <button
                        type="button"
                        onClick={() => {
                          setPositionOverride(String(item.position));
                          setAltAaOverride(item.altAas[0]);
                          setBaseOffset(undefined);
                          setAltBase(undefined);
                        }}
                        className="w-full rounded-md border border-rim px-2.5 py-2 text-left transition-colors hover:border-signal/50"
                      >
                        <span className="flex items-baseline justify-between gap-2">
                          <span className="data text-[0.75rem] text-ink">
                            {item.refAa}
                            <span className="text-ink-faint">{item.position}</span>
                            <span className="text-mutation">{item.altAas.join('')}</span>
                          </span>
                          <span className="label text-[0.52rem]">{item.kind}</span>
                        </span>
                        <span className="mt-1 block truncate text-[0.68rem] text-ink-faint">
                          {item.description || 'no description supplied'}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          ) : null}
        </div>

        {/* Result column */}
        <div className="space-y-5">
          <Panel>
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="min-w-0">
                <p className="label">Mutation scrub</p>
                {codonLabel ? (
                  <h2 className="display mt-1.5 text-lg text-ink">
                    {codonLabel.hgvsP}{' '}
                    <span className="text-mutation">{codonLabel.hgvsC}</span>
                  </h2>
                ) : (
                  <h2 className="display mt-1.5 text-lg text-ink-faint">Choose a codon position</h2>
                )}
                <p className="data mt-1.5 text-[0.72rem] text-ink-faint">
                  {codonLabel
                    ? `${codonLabel.refCodon} to ${codonLabel.altCodon}, ${codonLabel.consequence}, ${codonLabel.transition ? 'transition' : 'transversion'}`
                    : 'Each base re-runs the engine through /api/score.'}
                </p>
              </div>

              {score ? (
                <div className="flex items-center gap-4">
                  <VerdictPill verdict={score.result.verdict} />
                  <ScoreDial score={score.result.score} verdict={score.result.verdict} size={112} />
                </div>
              ) : null}
            </div>

            <div className="mt-5">
              {score ? (
                <CodonScrub
                  refCodon={score.result.codon.refCodon}
                  proteinPosition={proteinPosition}
                  dial={score.dial}
                  active={
                    baseOffset === undefined ? null : { baseOffset, altBase: altBase ?? score.result.codon.altCodon[0] }
                  }
                  busy={scoring}
                  onPick={(offset, base) => {
                    setBaseOffset(offset);
                    setAltBase(base);
                    const next = new URLSearchParams(params.toString());
                    next.set('accession', effectiveAccession);
                    next.set('position', String(proteinPosition));
                    router.replace(`/variants?${next.toString()}`, { scroll: false });
                  }}
                />
              ) : (
                <div className="flex items-center gap-3 py-6 text-[0.78rem] text-ink-faint">
                  {scoring ? (
                    <>
                      <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                      Scoring with the live space weather snapshot.
                    </>
                  ) : (
                    'Enter a valid position to begin.'
                  )}
                </div>
              )}
            </div>

            {score ? (
              <>
                <dl className="mt-6 grid grid-cols-2 gap-4 border-t border-rim pt-5 sm:grid-cols-4">
                  <Stat label="Probe dTm" value={score.result.thermo.deltaTmC.toFixed(2)} unit="C" color="var(--color-caution)" />
                  <Stat label="Probe class" value={score.result.thermo.class} color="var(--color-mutation)" />
                  <Stat label="SNR" value={score.result.signal.snr.toFixed(1)} color="var(--color-signal)" />
                  <Stat label="Readiness" value={score.result.score.toFixed(1)} color={scoreColor(score.result.score)} />
                </dl>

                <div className="mt-4">
                  <ClinicalNote clinical={score.clinical} />
                </div>

                <div className="mt-4">
                  <VerdictExplainer result={score.result} clinical={score.clinical} />
                </div>

                <div className="mt-4">
                  <SourceStrip sources={score.sources} />
                </div>
              </>
            ) : null}
          </Panel>

          {score ? (
            <>
              <Panel>
                <PanelHeading
                  title="Factor ledger"
                  detail={`Engine ${score.result.engine}. Weights sum to 1, so the score is their weighted sum and nothing is redistributed when a factor is unreadable.`}
                />
                <FactorLedger result={score.result} />
              </Panel>

              <Panel>
                <PanelHeading title="Gates" detail="A verdict cannot be reached while any hard gate fails." />
                <GateList gates={score.result.gates} />
              </Panel>

              <Panel>
                <PanelHeading
                  title="Commit to the plate"
                  detail="Persists the record and appends the first sealed audit event. Repeating the same commit returns the original record instead of duplicating it."
                />
                <div className="grid gap-3 sm:grid-cols-[10rem_minmax(0,1fr)]">
                  <label className="grid gap-1.5">
                    <span className="label">Well</span>
                    <input
                      value={well}
                      onChange={(e) => setWell(e.target.value.toUpperCase())}
                      maxLength={3}
                      className="data rounded-md border border-rim bg-[#0a0e13] px-3 py-2 text-sm uppercase text-ink"
                    />
                  </label>
                  <label className="grid gap-1.5">
                    <span className="label">Notes</span>
                    <input
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                      maxLength={200}
                      placeholder="Why this oligo matters to you"
                      className="data rounded-md border border-rim bg-[#0a0e13] px-3 py-2 text-sm text-ink"
                    />
                  </label>
                </div>

                <div className="mt-4 flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    onClick={() => void save()}
                    disabled={saving || saved !== null}
                    className="inline-flex items-center gap-2 rounded-md bg-signal px-4 py-2 text-[0.82rem] font-semibold text-substrate transition-opacity hover:opacity-90 disabled:opacity-50"
                  >
                    {saved ? <Check className="h-4 w-4" aria-hidden="true" /> : <Save className="h-4 w-4" aria-hidden="true" />}
                    {saved ? 'Committed' : saving ? 'Committing' : 'Commit to plate'}
                  </button>

                  {saved ? (
                    <Link href={`/assay/${saved}`} className="text-[0.8rem] text-signal hover:underline">
                      Open the record
                    </Link>
                  ) : null}

                  {saved ? (
                    <span className="data text-[0.68rem] text-ink-faint">
                      seal {score.result.inputDigest.slice(0, 12)}
                    </span>
                  ) : null}
                </div>
              </Panel>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}