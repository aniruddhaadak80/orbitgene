'use client';

import { useCallback, useRef, useState } from 'react';

import type { ClinicalContext, EngineResult } from '@/lib/types';

/**
 * A locally-run open-weight model reads the factor ledger and says which
 * diagnosis the evidence best supports.
 *
 * Why this exists: the engine in `src/lib/engine.ts` is deterministic on
 * purpose, which makes it trustworthy and reviewable but bad at one job, namely
 * explaining itself in prose. This component hands the ledger to a small
 * zero-shot NLI model, `Xenova/nli-deberta-v3-xsmall`, which runs entirely in the
 * browser through ONNX Runtime.
 *
 * What it is not: it is not a second opinion on the verdict. The gates are
 * thresholds and they are the authority. The model is explicitly framed as an
 * interpretation of evidence, it is loaded only when asked for, and if it fails
 * to load the panel says so and the rest of the app carries on unaffected.
 */

const MODEL_ID = 'Xenova/nli-deberta-v3-xsmall';

/** Quantised weights: about 70 MB, small enough to fetch once and cache. */
const MODEL_BYTES_APPROX = 70 * 1024 * 1024;

const HYPOTHESIS_TEMPLATE = 'This assay record shows {}.';

/**
 * Mutually exclusive enough to be a real choice, and each one is a claim the
 * ledger can actually support or contradict.
 */
const DIAGNOSES = [
  'a probe that no longer discriminates this variant and must be redesigned',
  'a detector with too little signal-to-noise to resolve the result at all',
  'a radiation budget that dominates the risk rather than the substitution',
  'a variant the assay handles comfortably and is cleared to fly',
  'too little retrieved evidence to justify any flight decision yet',
] as const;

type Ranked = { label: string; score: number };

type State =
  | { status: 'idle' }
  | { status: 'loading'; progress: number; file: string }
  | { status: 'ready'; ranked: Ranked[]; device: string; ms: number; premise: string }
  | { status: 'failed'; message: string };

/**
 * Turns the ledger into one premise sentence set.
 *
 * Every clause comes from a computed number. Nothing here is invented, because
 * the model is only as honest as its input.
 */
function buildPremise(result: EngineResult, clinical: ClinicalContext | null): string {
  const failedGates = result.gates.filter((g) => !g.passed);
  const weakest = [...result.factors].sort((a, b) => a.support - b.support).slice(0, 2);

  const clauses: string[] = [
    `The readiness score is ${result.score.toFixed(1)} out of 100 and the verdict is ${result.verdict}.`,
  ];

  if (failedGates.length > 0) {
    clauses.push(
      `${failedGates.length} of ${result.gates.length} hard gates failed: ${failedGates
        .map((g) => `${g.id} (${g.detail})`)
        .join('; ')}.`,
    );
  } else {
    clauses.push(`All ${result.gates.length} hard gates passed.`);
  }

  for (const factor of weakest) {
    clauses.push(
      `The weakest factor is ${factor.label} at support ${(factor.support * 100).toFixed(0)} percent of a ${factor.weight} weight: ${factor.summary}`,
    );
  }

  clauses.push(
    `Probe thermodynamics shifted the melting temperature by ${result.thermo.deltaTmC.toFixed(2)} degrees Celsius, classed ${result.thermo.class}, and the detector reaches a signal-to-noise ratio of ${result.signal.snr.toFixed(1)}.`,
  );
  clauses.push(
    `The shielding budget gives ${result.flight.totalDoseKrad.toFixed(1)} kilorad over the mission with ${result.flight.requiredVoting}-fold voting, classed ${result.flight.class}.`,
  );

  if (clinical) {
    if (clinical.status === 'reported' && clinical.hit) {
      clauses.push(
        `ClinVar classifies this exact substitution as ${clinical.hit.significance}, ${clinical.hit.reviewStatus}.`,
      );
    } else if (clinical.status === 'not-reported') {
      clauses.push('ClinVar holds no classification for this substitution.');
    } else {
      clauses.push('The ClinVar lookup did not complete, so clinical evidence is missing.');
    }
  }

  return clauses.join(' ');
}

export function VerdictExplainer({
  result,
  clinical,
}: {
  result: EngineResult;
  clinical: ClinicalContext | null;
}) {
  const [state, setState] = useState<State>({ status: 'idle' });
  // The pipeline is heavy and reusable, so it is held outside React state:
  // re-running the explanation must not pay the model load twice.
  const pipelineRef = useRef<unknown>(null);

  const run = useCallback(async () => {
    const premise = buildPremise(result, clinical);
    setState({ status: 'loading', progress: 0, file: 'starting' });

    try {
      if (!pipelineRef.current) {
        const { pipeline } = await import('@huggingface/transformers');
        const created = await pipeline('zero-shot-classification', MODEL_ID, {
          dtype: 'q8',
          device: 'auto',
          progress_callback: (item: unknown) => {
            const update = item as { status?: string; progress?: number; file?: string };
            if (update.status === 'progress' && typeof update.progress === 'number') {
              setState({
                status: 'loading',
                progress: Math.round(update.progress),
                file: update.file ?? '',
              });
            }
          },
        });
        pipelineRef.current = created;
      }

      const classifier = pipelineRef.current as (
        text: string,
        labels: readonly string[],
        options?: { hypothesis_template?: string },
      ) => Promise<{ labels: string[]; scores: number[] }>;

      const started = performance.now();
      const output = await classifier(premise, DIAGNOSES, {
        hypothesis_template: HYPOTHESIS_TEMPLATE,
      });
      const ms = Math.round(performance.now() - started);

      const device =
        typeof navigator !== 'undefined' && 'gpu' in navigator
          ? ((navigator as { gpu?: unknown }).gpu ? 'webgpu' : 'wasm')
          : 'wasm';

      const ranked: Ranked[] = output.labels.map((label, index) => ({
        label,
        score: output.scores[index],
      }));

      setState({ status: 'ready', ranked, device, ms, premise });
    } catch (error) {
      setState({
        status: 'failed',
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }, [result, clinical]);

  return (
    <div className="rounded border border-rim bg-panel-raised p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-semibold">Read the ledger with a local model</h3>
        <span className="font-mono text-[11px] text-dim">{MODEL_ID}</span>
      </div>

      <p className="mt-2 text-sm text-dim">
        The engine decides by threshold and does not explain itself in prose. This runs a small
        open-weight NLI model on your own machine, over WebGPU or WebAssembly, and reports which
        diagnosis the ledger best supports. It is an interpretation of the evidence above, not a
        second verdict: the gates remain the authority.
      </p>

      {state.status === 'idle' ? (
        <button
          type="button"
          onClick={run}
          className="mt-3 rounded border border-signal px-3 py-1.5 text-sm text-signal transition hover:bg-signal hover:text-panel"
        >
          Run locally ({(MODEL_BYTES_APPROX / (1024 * 1024)).toFixed(0)} MB, once)
        </button>
      ) : null}

      {state.status === 'loading' ? (
        <div className="mt-3">
          <div className="h-1.5 w-full overflow-hidden rounded bg-rim">
            <div className="h-full bg-signal transition-all" style={{ width: `${state.progress}%` }} />
          </div>
          <p className="mt-1 font-mono text-[11px] text-dim">
            {state.progress}% {state.file}
          </p>
          <p className="mt-1 text-xs text-dim">
            The weights are fetched from the Hugging Face CDN and then cached by the browser. Nothing
            about this assay is sent anywhere.
          </p>
        </div>
      ) : null}

      {state.status === 'ready' ? (
        <div className="mt-3">
          <ol className="space-y-2">
            {state.ranked.map((row, index) => (
              <li key={row.label}>
                <div className="flex items-baseline justify-between gap-3 text-sm">
                  <span className={index === 0 ? 'font-semibold text-signal' : 'text-dim'}>
                    {row.label}
                  </span>
                  <span className="font-mono text-xs text-dim">{(row.score * 100).toFixed(1)}%</span>
                </div>
                <div className="mt-1 h-1 w-full overflow-hidden rounded bg-rim">
                  <div
                    className={index === 0 ? 'h-full bg-signal' : 'h-full bg-dim'}
                    style={{ width: `${Math.max(row.score * 100, 0.5)}%` }}
                  />
                </div>
              </li>
            ))}
          </ol>
          <p className="mt-3 font-mono text-[11px] text-dim">
            {state.device} &middot; {state.ms} ms &middot; ran on this device, not a server
          </p>
          <details className="mt-2">
            <summary className="cursor-pointer text-xs text-dim">Show the premise sent to the model</summary>
            <p className="mt-1 font-mono text-[11px] leading-relaxed text-dim">{state.premise}</p>
          </details>
          <button
            type="button"
            onClick={run}
            className="mt-3 rounded border border-rim px-3 py-1.5 text-sm text-dim transition hover:border-signal hover:text-signal"
          >
            Re-read a changed ledger
          </button>
        </div>
      ) : null}

      {state.status === 'failed' ? (
        <div className="mt-3">
          <p className="text-sm text-caution">The local model could not run: {state.message}</p>
          <p className="mt-1 text-xs text-dim">
            This does not affect the score, the gates, or anything else in ORBITGENE. Only this
            optional explanation is unavailable, which is the point of running it in your browser
            rather than behind an API key.
          </p>
          <button
            type="button"
            onClick={run}
            className="mt-2 rounded border border-rim px-3 py-1.5 text-sm text-dim transition hover:border-signal hover:text-signal"
          >
            Try again
          </button>
        </div>
      ) : null}
    </div>
  );
}