'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Download, FileJson, FileText, Table } from 'lucide-react';
import type { AssayRecord, ReplayReport } from '@/lib/types';
import { EmptyState, ErrorNote, Panel, PanelHeading, VerdictPill, scoreColor } from './ui';

interface ListResponse {
  items: AssayRecord[];
  total: number;
}

/**
 * Dossier export.
 *
 * Three real downloads, all generated in the browser from the record's stored
 * snapshot: a self-contained SVG plate figure, a Markdown report a lab can paste
 * into a notebook, and the raw JSON including the seal chain. Every one carries
 * the source attribution and the timestamps.
 */
export function ExportDesk() {
  const [data, setData] = useState<ListResponse | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [replay, setReplay] = useState<ReplayReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

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
      const body = await fetchRecords();
      setData(body);
      setSelected((current) => current ?? body.items[0]?.id ?? null);
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
        if (cancelled) return;
        setData(body);
        setSelected(body.items[0]?.id ?? null);
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

  useEffect(() => {
    if (!selected) return;
    let cancelled = false;
    fetch(`/api/integrity/${selected}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`replay failed (${r.status})`))))
      .then((body: { report: ReplayReport }) => {
        if (!cancelled) setReplay(body.report);
      })
      .catch(() => {
        // A record whose replay cannot be read is left unset rather than faked.
        if (!cancelled) setReplay(null);
      });
    return () => {
      cancelled = true;
    };
  }, [selected]);

  const assay = data?.items.find((a) => a.id === selected) ?? null;

  function download(filename: string, content: string, type: string) {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="mx-auto max-w-[1240px] space-y-5 px-4 py-10 sm:px-6">
      <header>
        <p className="label">Dossier export</p>
        <h1 className="display mt-2 text-2xl text-ink sm:text-3xl">Take the result with you</h1>
        <p className="mt-2 max-w-prose text-[0.85rem] leading-relaxed text-ink-dim">
          A plate figure for a slide, a Markdown report for a lab notebook, and the raw record with
          its seal chain. All three are generated from the stored snapshot, so they say exactly what
          the database holds.
        </p>
      </header>

      {error ? <ErrorNote message={error} onRetry={() => void load()} /> : null}

      {loading ? (
        <Panel>
          <p className="text-[0.8rem] text-ink-faint">Loading records.</p>
        </Panel>
      ) : (data?.items.length ?? 0) === 0 ? (
        <Panel>
          <EmptyState
            title="Nothing to export yet"
            body="Commit a record to the plate first, then come back to download the dossier."
            action={
              <Link href="/variants" className="mt-1 rounded-md bg-signal px-4 py-2 text-[0.8rem] font-semibold text-substrate">
                Score a variant
              </Link>
            }
          />
        </Panel>
      ) : (
        <div className="grid gap-5 lg:grid-cols-[18rem_minmax(0,1fr)]">
          <Panel>
            <PanelHeading title="Records" detail={`${data?.total ?? 0} on this plate.`} />
            <ul className="grid gap-1.5">
              {data?.items.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    onClick={() => setSelected(item.id)}
                    aria-pressed={selected === item.id}
                    className={[
                      'flex w-full items-center gap-2.5 rounded-md border px-2.5 py-2 text-left transition-colors',
                      selected === item.id
                        ? 'border-signal/60 bg-signal/10'
                        : 'border-rim hover:border-signal/40',
                    ].join(' ')}
                  >
                    <span className="data text-[0.7rem] text-ink-faint">{item.well}</span>
                    <span className="data min-w-0 flex-1 truncate text-[0.75rem] text-ink">
                      {item.geneSymbol} {item.hgvsP}
                    </span>
                    <span className="data text-[0.72rem]" style={{ color: scoreColor(item.score) }}>
                      {item.score.toFixed(0)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </Panel>

          {assay ? (
            <div className="space-y-5">
              <Panel>
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="min-w-0">
                    <p className="label">{`Well ${assay.well}`}</p>
                    <h2 className="display mt-1.5 text-lg text-ink">
                      {assay.geneSymbol} <span className="text-mutation">{assay.hgvsP}</span>
                    </h2>
                    <p className="data mt-1 text-[0.74rem] text-ink-dim">
                      {assay.hgvsC} on {assay.uniprotAccession} / {assay.refseqMrna}
                    </p>
                  </div>
                  <VerdictPill verdict={assay.verdict} />
                </div>

                <div className="mt-5 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => download(`${assay.geneSymbol}-${assay.hgvsP}.svg`, buildSvg(assay), 'image/svg+xml')}
                    className="inline-flex items-center gap-2 rounded-md bg-signal px-4 py-2 text-[0.8rem] font-semibold text-substrate hover:opacity-90"
                  >
                    <Download className="h-4 w-4" aria-hidden="true" />
                    Plate figure (SVG)
                  </button>
                  <button
                    type="button"
                    onClick={() => download(`${assay.geneSymbol}-${assay.hgvsP}.md`, buildMarkdown(assay, replay), 'text/markdown')}
                    className="inline-flex items-center gap-2 rounded-md border border-rim px-4 py-2 text-[0.8rem] text-ink-dim hover:border-signal/60 hover:text-signal"
                  >
                    <FileText className="h-4 w-4" aria-hidden="true" />
                    Markdown report
                  </button>
                  <button
                    type="button"
                    onClick={() => download(`${assay.geneSymbol}-${assay.hgvsP}.json`, JSON.stringify({ assay, replay }, null, 2), 'application/json')}
                    className="inline-flex items-center gap-2 rounded-md border border-rim px-4 py-2 text-[0.8rem] text-ink-dim hover:border-signal/60 hover:text-signal"
                  >
                    <FileJson className="h-4 w-4" aria-hidden="true" />
                    JSON record
                  </button>
                  <button
                    type="button"
                    onClick={() => download(`${assay.geneSymbol}-${assay.hgvsP}.csv`, buildCsv(assay), 'text/csv')}
                    className="inline-flex items-center gap-2 rounded-md border border-rim px-4 py-2 text-[0.8rem] text-ink-dim hover:border-signal/60 hover:text-signal"
                  >
                    <Table className="h-4 w-4" aria-hidden="true" />
                    CSV ledger
                  </button>
                </div>
              </Panel>

              <Panel>
                <PanelHeading title="Preview" detail="The Markdown report as it will download." />
                <pre className="data max-h-[28rem] overflow-auto rounded-md border border-rim bg-[#0a0e13] p-4 text-[0.7rem] leading-relaxed text-ink-dim">
                  {buildMarkdown(assay, replay)}
                </pre>
              </Panel>

              <Panel>
                <PanelHeading title="Attribution" />
                <p className="text-[0.74rem] leading-relaxed text-ink-dim">
                  Protein annotation from UniProtKB. Coding sequence from the annotated CDS of the
                  RefSeq transcript. Radiation environment from NOAA Space Weather Prediction Center.
                  Published per-residue scales: Kyte and Doolittle 1982, Zamyatnin 1972, Chou and
                  Fasman 1978, SantaLucia 1998. Research and teaching use only; not a diagnostic
                  device.
                </p>
              </Panel>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}

function buildMarkdown(assay: AssayRecord, replay: ReplayReport | null): string {
  const r = assay.result;
  const lines: string[] = [
    `# ORBITGENE assay dossier: ${assay.geneSymbol} ${assay.hgvsP}`,
    '',
    `**Verdict:** ${assay.verdict} &nbsp;|&nbsp; **Flight readiness:** ${assay.score.toFixed(2)} / 100`,
    '',
    `- Well: ${assay.well}`,
    `- Change: ${assay.hgvsC} (${assay.consequence}, ${r.codon.transition ? 'transition' : 'transversion'})`,
    `- Codon: ${r.codon.refCodon} to ${r.codon.altCodon}`,
    `- Accession: ${assay.uniprotAccession} / ${assay.refseqMrna}`,
    `- Instrument: ${assay.instrumentId}`,
    `- Flight profile: ${assay.flightProfileId}`,
    `- Engine: ${r.engine}`,
    `- Input digest: ${r.inputDigest}`,
    `- Terminal seal: ${assay.seal}`,
    `- Committed: ${assay.createdAt}`,
    `- Updated: ${assay.updatedAt}`,
    '',
    '## Factor ledger',
    '',
    '| Factor | Weight | Support | Contribution |',
    '| --- | --- | --- | --- |',
    ...r.factors.map(
      (f) => `| ${f.label} | ${f.weight.toFixed(2)} | ${f.support.toFixed(3)} | ${f.contribution.toFixed(4)} |`,
    ),
    '',
    `Weighted total ${r.factors.reduce((a, f) => a + f.contribution, 0).toFixed(4)} x 100 = ${assay.score.toFixed(2)}`,
    '',
    '## Gates',
    '',
    ...r.gates.map((g) => `- ${g.passed ? 'passed' : 'FAILED'} \`${g.id}\`: ${g.detail}`),
    '',
    '## Probe thermodynamics',
    '',
    `- Wild-type probe: ${r.thermo.wtProbe}`,
    `- Mutant probe: ${r.thermo.probe}`,
    `- Tm ${r.thermo.wtTmC} C to ${r.thermo.mutTmC} C (dTm ${r.thermo.deltaTmC} C, ${r.thermo.class})`,
    '',
    '## Detector',
    '',
    `- Signal counts ${r.signal.signalCounts}, dark counts ${r.signal.darkCounts}`,
    `- Shot SNR ${r.signal.shotSnr}, ADC SNR ${r.signal.adcSnr}, effective ${r.signal.snr}`,
    `- Fold separation ${r.signal.discriminationMargin}x (${r.signal.class})`,
    '',
    '## Radiation',
    '',
    `- GCR ${r.flight.gcrDoseRateRadDay} rad(Si)/day, SPE ${r.flight.speDoseRateRadDay} rad(Si)/day`,
    `- Total ${r.flight.totalDoseKrad} krad(Si) behind ${r.flight.shielding} attenuation`,
    `- Expected upsets ${r.flight.expectedUpsets}, redundancy required ${r.flight.requiredVoting} (${r.flight.class})`,
    '',
  ];

  if (assay.decision) {
    lines.push(
      '## Sealed decision',
      '',
      `${assay.decision.verdict} on ${assay.decision.decidedAt}: ${assay.decision.rationale}`,
      '',
    );
  }

  if (replay) {
    lines.push(
      '## Integrity',
      '',
      `- Chain ${replay.ok ? 'verifies' : `BROKEN at event ${replay.brokenAt}`} across ${replay.length} events`,
      `- Genesis ${replay.genesis}`,
      `- Head ${replay.head ?? 'none'}`,
      '',
    );
  }

  lines.push(
    '---',
    '',
    'Data from UniProt, NCBI RefSeq and NOAA SWPC. Research and teaching use only; not a',
    'diagnostic device and not clinical advice.',
  );

  return lines.join('\n');
}

function buildCsv(assay: AssayRecord): string {
  const rows: string[][] = [
    ['field', 'value'],
    ['gene', assay.geneSymbol],
    ['accession', assay.uniprotAccession],
    ['transcript', assay.refseqMrna],
    ['position', String(assay.proteinPosition)],
    ['hgvs_p', assay.hgvsP],
    ['hgvs_c', assay.hgvsC],
    ['consequence', assay.consequence],
    ['verdict', assay.verdict],
    ['score', String(assay.score)],
    ['engine', assay.result.engine],
    ['input_digest', assay.result.inputDigest],
    ['seal', assay.seal],
    ['created_at', assay.createdAt],
  ];
  for (const factor of assay.result.factors) {
    rows.push([`factor.${factor.key}.support`, String(factor.support)]);
    rows.push([`factor.${factor.key}.contribution`, String(factor.contribution)]);
  }
  const escape = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  return rows.map((r) => r.map(escape).join(',')).join('\n');
}

/** A self-contained plate figure, safe to drop into a slide. */
function buildSvg(assay: AssayRecord): string {
  const wells = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];
  const cols = Array.from({ length: 12 }, (_, i) => i + 1);
  const target = `${assay.well[0]}${Number(assay.well.slice(1))}`;
  const color = assay.score >= 70 ? '#a3e635' : assay.score >= 50 ? '#fbbf24' : '#fb7185';

  const body = wells
    .flatMap((row, r) =>
      cols.map((col) => {
        const key = `${row}${col}`;
        const occupied = key === target;
        const x = 90 + (col - 1) * 52;
        const y = 120 + r * 52;
        return `<circle cx="${x}" cy="${y}" r="16" fill="${occupied ? color : '#0d1117'}" fill-opacity="${occupied ? 0.75 : 1}" stroke="${occupied ? color : '#1c2430'}" stroke-width="1.5"/>`;
      }),
    )
    .join('\n  ');

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 760 600" width="760" height="600" role="img" aria-label="96-well plate showing ${assay.geneSymbol} ${assay.hgvsP} in well ${assay.well}">
  <rect width="760" height="600" fill="#07090c"/>
  <text x="40" y="52" fill="#e6edf3" font-family="monospace" font-size="22" font-weight="700">ORBITGENE assay plate</text>
  <text x="40" y="80" fill="#9aa7b4" font-family="monospace" font-size="14">${assay.geneSymbol} ${assay.hgvsP} (${assay.hgvsC})</text>
  <text x="40" y="102" fill="${color}" font-family="monospace" font-size="14">${assay.verdict} - readiness ${assay.score.toFixed(2)}/100</text>
  ${body}
  <text x="720" y="140" fill="#6b7885" font-family="monospace" font-size="11">12</text>
  <text x="72" y="500" fill="#6b7885" font-family="monospace" font-size="11">H</text>
  <text x="40" y="560" fill="#6b7885" font-family="monospace" font-size="10">seal ${assay.seal.slice(0, 32)}</text>
  <text x="40" y="578" fill="#6b7885" font-family="monospace" font-size="10">committed ${assay.createdAt}</text>
</svg>`;
}