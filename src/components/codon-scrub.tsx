'use client';

import { useState } from 'react';
import type { CodonChange } from '@/lib/genetics';

const BASES = ['A', 'C', 'G', 'T'] as const;

/**
 * The mutation scrub: ORBITGENE's signature control.
 *
 * A codon is three positions, each with a wild-type base that can be changed to
 * any of the other three. Changing a base re-runs the real engine and redraws
 * the real factor ledger; nothing here is a local approximation.
 *
 * Combinations that cannot reach the requested residue in one nucleotide change
 * are rendered dimmed and inert, so a visitor sees that Ala cannot become Phe in
 * a single base change instead of pressing a button and watching the score fail
 * to move.
 */
export function CodonScrub({
  refCodon,
  proteinPosition,
  dial,
  active,
  onPick,
  disabled = false,
  busy = false,
}: {
  refCodon: string;
  proteinPosition: number;
  dial: Array<{ altBase: string; change: CodonChange }>;
  active: { baseOffset: number; altBase: string } | null;
  onPick: (baseOffset: number, altBase: string) => void;
  disabled?: boolean;
  busy?: boolean;
}) {
  const [hovered, setHovered] = useState<string | null>(null);

  // Which (position, base) pairs actually encode the requested residue.
  const reachable = new Set(
    dial.filter((d) => d.change.valid).map((d) => `${d.change.baseOffset}:${d.altBase}`),
  );
  const anyReachable = reachable.size > 0;

  return (
    <div>
      <div className="flex flex-wrap items-end gap-x-4 gap-y-3">
        {refCodon.split('').map((base, index) => {
          const chosen = active?.baseOffset === index ? active.altBase : null;
          return (
            <div key={index} className="flex flex-col items-center gap-2">
              <span className="label text-[0.56rem]">c.{proteinPosition * 3 + index}</span>

              <div className="relative">
                <span
                  className="data grid h-11 w-11 place-items-center rounded-md border border-rim bg-[#0a0e13] text-lg font-semibold text-ink-faint"
                  aria-label={`Wild-type base ${base} at codon position ${index + 1}`}
                >
                  {base}
                </span>
                {chosen ? (
                  <span className="data absolute inset-x-0 -bottom-6 text-center text-sm font-semibold text-mutation">
                    {chosen}
                  </span>
                ) : null}
              </div>

              <div className="flex gap-1" role="group" aria-label={`Substitute codon position ${index + 1}`}>
                {BASES.filter((b) => b !== base).map((alt) => {
                  const usable = reachable.has(`${index}:${alt}`);
                  const isTarget = chosen === alt;
                  return (
                    <button
                      key={alt}
                      type="button"
                      disabled={disabled || busy || !usable}
                      onMouseEnter={() => setHovered(`${index}:${alt}`)}
                      onMouseLeave={() => setHovered(null)}
                      onFocus={() => setHovered(`${index}:${alt}`)}
                      onBlur={() => setHovered(null)}
                      onClick={() => onPick(index, alt)}
                      aria-pressed={isTarget}
                      aria-label={
                        usable
                          ? `Change codon position ${index + 1} from ${base} to ${alt}`
                          : `Position ${index + 1} cannot become ${alt} in one nucleotide change`
                      }
                      className="codon-slot data h-7 w-7 text-[0.72rem]"
                      data-active={hovered === `${index}:${alt}` && !disabled ? 'true' : 'false'}
                      data-mutated={isTarget ? 'true' : 'false'}
                      style={usable ? undefined : { opacity: 0.28, cursor: 'not-allowed' }}
                    >
                      {alt}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      <p className="mt-9 max-w-prose text-[0.7rem] leading-relaxed text-ink-faint">
        {anyReachable
          ? 'Dimmed bases are combinations that cannot reach the requested residue in a single nucleotide change. The engine says so rather than quietly substituting a neighbour.'
          : 'No single nucleotide change at this codon reaches the requested residue. Pick a different residue, or let the engine choose the cheapest reachable substitution.'}
      </p>
    </div>
  );
}