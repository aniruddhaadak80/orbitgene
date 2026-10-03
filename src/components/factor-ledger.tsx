'use client';

import { useState } from 'react';
import type { EngineResult, Factor, Gate } from '@/lib/types';

const FACTOR_COLOR: Record<string, string> = {
  physicochemical: 'var(--color-mutation)',
  signal: 'var(--color-signal)',
  structural: 'var(--color-engine)',
  thermo: 'var(--color-caution)',
  flight: 'var(--color-ink-dim)',
  codon: 'var(--color-cleared)',
};

/**
 * The factor ledger.
 *
 * Every factor shows its weight, its support, the number it contributed and the
 * evidence it was computed from. The bars are drawn from the same numbers the
 * score is summed from, so the visual cannot disagree with the arithmetic.
 */
export function FactorLedger({ result }: { result: EngineResult }) {
  const [open, setOpen] = useState<string | null>(result.factors[0]?.key ?? null);

  return (
    <div>
      <ul className="grid gap-2">
        {result.factors.map((factor) => (
          <FactorRow
            key={factor.key}
            factor={factor}
            open={open === factor.key}
            onToggle={() => setOpen((current) => (current === factor.key ? null : factor.key))}
          />
        ))}
      </ul>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-rim pt-3">
        <p className="label">Weighted total</p>
        <p className="data text-sm text-ink">
          {result.factors.reduce((acc, f) => acc + f.contribution, 0).toFixed(4)} x 100 ={' '}
          <span className="font-semibold">{result.score.toFixed(2)}</span>
        </p>
      </div>
    </div>
  );
}

function FactorRow({
  factor,
  open,
  onToggle,
}: {
  factor: Factor;
  open: boolean;
  onToggle: () => void;
}) {
  const color = FACTOR_COLOR[factor.key] ?? 'var(--color-signal)';

  return (
    <li className="rounded-lg border border-rim bg-[#0a0e13]">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full items-center gap-3 px-3 py-2.5 text-left"
      >
        <span
          className="data shrink-0 text-[0.7rem]"
          style={{ color }}
          title={`weight ${factor.weight}`}
        >
          {(factor.weight * 100).toFixed(0)}
        </span>

        <span className="min-w-0 flex-1">
          <span className="flex items-baseline justify-between gap-2">
            <span className="truncate text-[0.78rem] text-ink">{factor.label}</span>
            <span className="data shrink-0 text-[0.7rem] text-ink-dim">
              {factor.support.toFixed(2)} x {factor.weight.toFixed(2)} ={' '}
              <span style={{ color }}>{factor.contribution.toFixed(3)}</span>
            </span>
          </span>
          <span
            aria-hidden="true"
            className="mt-1.5 block h-1 w-full overflow-hidden rounded-full bg-rim"
          >
            <span
              className="block h-full rounded-full transition-[width] duration-300"
              style={{ width: `${Math.max(2, factor.support * 100)}%`, background: color }}
            />
          </span>
        </span>
      </button>

      {open ? (
        <div className="border-t border-rim/70 px-3 py-3">
          <p className="text-[0.76rem] leading-relaxed text-ink-dim">{factor.summary}</p>
          <dl className="mt-2.5 grid gap-1.5">
            {factor.evidence.map((item, index) => (
              <div key={`${item.label}-${index}`} className="flex flex-wrap gap-x-3 gap-y-0.5">
                <dt className="label text-[0.58rem]">{item.label}</dt>
                <dd className="data min-w-0 flex-1 break-all text-[0.72rem] text-ink-dim">{item.value}</dd>
              </div>
            ))}
          </dl>
        </div>
      ) : null}
    </li>
  );
}

export function GateList({ gates }: { gates: Gate[] }) {
  return (
    <ul className="grid gap-2">
      {gates.map((gate) => {
        const color = gate.passed ? 'var(--color-cleared)' : 'var(--color-caution)';
        return (
          <li key={gate.id} className="flex gap-2.5">
            <span
              aria-hidden="true"
              className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full"
              style={{ background: color }}
            />
            <div className="min-w-0">
              <p className="flex flex-wrap items-baseline gap-2">
                <span className="label text-[0.6rem]" style={{ color }}>
                  {gate.id}
                </span>
                <span className="data text-[0.62rem] text-ink-faint">
                  {gate.passed ? 'passed' : 'failed'}
                </span>
              </p>
              <p className="text-[0.74rem] leading-relaxed text-ink-dim">{gate.detail}</p>
            </div>
          </li>
        );
      })}
    </ul>
  );
}