'use client';

import { WELL_COLUMNS, WELL_ROWS } from '@/lib/profiles';
import { scoreColor } from './ui';

export interface PlateWell {
  well: string;
  score: number;
  verdict: string;
  href?: string;
  selected?: boolean;
}

/**
 * The 96-well plate map.
 *
 * The plate is the primary navigation surface: each well is a stored record,
 * coloured by its real readiness score, and carrying its coordinate as both a
 * label and an accessible name. Empty wells are still visible, because a plate
 * with holes in it is information.
 */
export function PlateGrid({
  wells,
  onSelect,
  selected,
  compact = false,
}: {
  wells: PlateWell[];
  onSelect?: (well: string) => void;
  selected?: string;
  compact?: boolean;
}) {
  const byWell = new Map(wells.map((w) => [w.well, w]));
  const size = compact ? 'h-7 w-7 text-[0.5rem]' : 'h-9 w-9 text-[0.58rem] sm:h-11 sm:w-11 sm:text-[0.62rem]';

  return (
    <div className="overflow-x-auto pb-1">
      <div className="min-w-max">
        {/* Column ruler */}
        <div className="mb-1.5 flex items-end gap-1.5 pl-6">
          {WELL_COLUMNS.map((col) => (
            <div
              key={col}
              className={`data flex ${size} shrink-0 justify-center text-[0.55rem] text-ink-faint`}
            >
              {col}
            </div>
          ))}
        </div>

        {WELL_ROWS.map((row) => (
          <div key={row} className="mb-1.5 flex items-center gap-1.5">
            <div className="data w-6 shrink-0 text-right text-[0.6rem] text-ink-faint">{row}</div>
            {WELL_COLUMNS.map((col) => {
              const key = `${row}${col}`;
              const well = byWell.get(key);
              const occupied = Boolean(well);
              const color = well ? scoreColor(well.score) : 'var(--color-rim)';
              const isSelected = selected === key;

              const content = (
                <>
                  <span className="relative z-10">{occupied ? key : ''}</span>
                  {occupied ? (
                    <span className="sr-only">
                      {` well ${key}, ${well?.verdict}, readiness ${well?.score.toFixed(1)} of 100`}
                    </span>
                  ) : (
                    <span className="sr-only">{` well ${key}, empty`}</span>
                  )}
                </>
              );

              if (well?.href && !onSelect) {
                return (
                  <a
                    key={key}
                    href={well.href}
                    className={`well ${size} shrink-0 text-[0.6rem] font-semibold text-ink-dim`}
                    data-state={isSelected ? 'selected' : 'occupied'}
                    style={{ ['--fill' as string]: color }}
                  >
                    {content}
                  </a>
                );
              }

              return (
                <button
                  key={key}
                  type="button"
                  disabled={!onSelect}
                  onClick={() => onSelect?.(key)}
                  className={`well ${size} shrink-0 text-[0.6rem] font-semibold text-ink-faint`}
                  data-state={isSelected ? 'selected' : occupied ? 'occupied' : 'empty'}
                  data-interactive={onSelect ? 'true' : 'false'}
                  style={{ ['--fill' as string]: color, cursor: onSelect ? 'pointer' : 'default' }}
                >
                  {content}
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

/** Plate legend, so the colour scale is named rather than guessed. */
export function PlateLegend() {
  const items = [
    { label: 'Cleared', color: 'var(--color-cleared)' },
    { label: 'Hold', color: 'var(--color-caution)' },
    { label: 'Ground only', color: 'var(--color-refused)' },
    { label: 'Empty', color: 'var(--color-rim)' },
  ];
  return (
    <ul className="flex flex-wrap items-center gap-4">
      {items.map((item) => (
        <li key={item.label} className="flex items-center gap-2">
          <span
            aria-hidden="true"
            className="h-3.5 w-3.5 rounded-full border"
            style={{
              borderColor: item.color,
              background: `color-mix(in oklab, ${item.color} 22%, transparent)`,
            }}
          />
          <span className="label text-[0.6rem]">{item.label}</span>
        </li>
      ))}
    </ul>
  );
}