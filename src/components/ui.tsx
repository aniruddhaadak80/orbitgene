import type { ReactNode } from 'react';
import type { SourceMeta, Verdict } from '@/lib/types';

/** Score to signal colour. One scale, used everywhere a score is drawn. */
export function scoreColor(score: number): string {
  if (score >= 70) return 'var(--color-cleared)';
  if (score >= 50) return 'var(--color-caution)';
  return 'var(--color-refused)';
}

const VERDICT_STYLE: Record<Verdict, { color: string; note: string }> = {
  'FLIGHT-GO': { color: 'var(--color-cleared)', note: 'every gate passes and annotation supports it' },
  'GROUND-ONLY': { color: 'var(--color-caution)', note: 'physics keeps it off this flight' },
  'REDESIGN-PROBE': { color: 'var(--color-mutation)', note: 'the oligo cannot discriminate this change' },
  'HOLD-FOR-EVIDENCE': { color: 'var(--color-engine)', note: 'nothing published covers this residue yet' },
};

export function verdictColor(verdict: Verdict): string {
  return VERDICT_STYLE[verdict]?.color ?? 'var(--color-ink-dim)';
}

export function VerdictPill({ verdict, className = '' }: { verdict: Verdict; className?: string }) {
  const style = VERDICT_STYLE[verdict];
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[0.68rem] tracking-[0.12em] ${className}`}
      style={{
        color: style.color,
        borderColor: `color-mix(in oklab, ${style.color} 45%, transparent)`,
        background: `color-mix(in oklab, ${style.color} 10%, transparent)`,
      }}
      title={style.note}
    >
      <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full" style={{ background: style.color }} />
      {verdict}
    </span>
  );
}

export function Panel({
  children,
  className = '',
  as: Tag = 'section',
}: {
  children: ReactNode;
  className?: string;
  as?: 'section' | 'div' | 'article' | 'aside';
}) {
  return <Tag className={`plate p-5 ${className}`}>{children}</Tag>;
}

export function PanelHeading({
  title,
  detail,
  action,
}: {
  title: string;
  detail?: string;
  action?: ReactNode;
}) {
  return (
    <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h2 className="display text-[0.8rem] tracking-[0.16em] text-ink">{title}</h2>
        {detail ? <p className="mt-1 max-w-prose text-[0.75rem] leading-relaxed text-ink-faint">{detail}</p> : null}
      </div>
      {action}
    </div>
  );
}

/**
 * Source attribution strip.
 *
 * A fallback is always called out in amber with the reason, because a sealed
 * sample presented as a current observation is the failure mode this exists to
 * prevent.
 */
export function SourceStrip({ sources }: { sources: SourceMeta[] }) {
  if (sources.length === 0) return null;
  return (
    <ul className="flex flex-wrap gap-2">
      {sources.map((source) => {
        const live = source.status === 'live';
        return (
          <li
            key={`${source.id}-${source.url}`}
            className="max-w-full rounded-md border px-2.5 py-1.5 text-[0.68rem]"
            style={{
              borderColor: live
                ? 'color-mix(in oklab, var(--color-signal) 32%, transparent)'
                : 'color-mix(in oklab, var(--color-caution) 45%, transparent)',
              background: live
                ? 'color-mix(in oklab, var(--color-signal) 7%, transparent)'
                : 'color-mix(in oklab, var(--color-caution) 8%, transparent)',
            }}
          >
            <span className="flex items-center gap-1.5">
              <span
                aria-hidden="true"
                className="h-1.5 w-1.5 shrink-0 rounded-full"
                style={{ background: live ? 'var(--color-signal)' : 'var(--color-caution)' }}
              />
              <span
                className="tracking-[0.12em] uppercase"
                style={{ color: live ? 'var(--color-signal)' : 'var(--color-caution)' }}
              >
                {live ? 'Live' : 'Sealed fallback'}
              </span>
            </span>
            <a
              href={source.url}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-0.5 block truncate text-ink-dim hover:text-ink"
              title={source.note}
            >
              {source.label}
            </a>
            <span className="mt-0.5 block text-ink-faint">{source.note}</span>
          </li>
        );
      })}
    </ul>
  );
}

export function Stat({
  label,
  value,
  unit,
  color,
  hint,
}: {
  label: string;
  value: string | number;
  unit?: string;
  color?: string;
  hint?: string;
}) {
  return (
    <div className="min-w-0" title={hint}>
      <p className="label truncate">{label}</p>
      <p className="data mt-1 text-base leading-none" style={color ? { color } : undefined}>
        {value}
        {unit ? <span className="ml-1 text-[0.7rem] text-ink-faint">{unit}</span> : null}
      </p>
    </div>
  );
}

export function EmptyState({
  title,
  body,
  action,
}: {
  title: string;
  body: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-rim-bright px-6 py-12 text-center">
      <p className="display text-[0.8rem] tracking-[0.14em] text-ink-dim">{title}</p>
      <p className="max-w-md text-[0.78rem] leading-relaxed text-ink-faint">{body}</p>
      {action}
    </div>
  );
}

export function ErrorNote({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div
      role="alert"
      className="flex flex-wrap items-center gap-3 rounded-lg border px-4 py-3"
      style={{
        borderColor: 'color-mix(in oklab, var(--color-refused) 45%, transparent)',
        background: 'color-mix(in oklab, var(--color-refused) 8%, transparent)',
      }}
    >
      <span className="label" style={{ color: 'var(--color-refused)' }}>
        Failed
      </span>
      <p className="min-w-0 flex-1 text-[0.78rem] text-ink-dim">{message}</p>
      {onRetry ? (
        <button
          type="button"
          onClick={onRetry}
          className="rounded-md border border-rim px-3 py-1.5 text-[0.75rem] text-ink-dim transition-colors hover:border-signal/60 hover:text-signal"
        >
          Retry
        </button>
      ) : null}
    </div>
  );
}

/** Score dial. Shows the number, not a spinner pretending to be one. */
export function ScoreDial({ score, verdict, size = 132 }: { score: number; verdict: Verdict; size?: number }) {
  const radius = size / 2 - 9;
  const circumference = 2 * Math.PI * radius;
  const filled = (Math.max(0, Math.min(100, score)) / 100) * circumference;
  const color = scoreColor(score);

  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg viewBox={`0 0 ${size} ${size}`} className="h-full w-full -rotate-90" aria-hidden="true">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="var(--color-rim)"
          strokeWidth="7"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth="7"
          strokeLinecap="round"
          strokeDasharray={`${filled} ${circumference - filled}`}
        />
      </svg>
      <div className="absolute inset-0 grid place-items-center">
        <div className="text-center">
          <p className="data text-2xl font-semibold leading-none" style={{ color }}>
            {score.toFixed(1)}
          </p>
          <p className="label mt-1 text-[0.6rem]">Readiness</p>
        </div>
      </div>
      <span className="sr-only">
        Flight readiness {score.toFixed(1)} out of 100. Verdict {verdict}.
      </span>
    </div>
  );
}