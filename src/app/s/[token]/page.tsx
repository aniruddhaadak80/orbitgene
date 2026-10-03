import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { getDb } from '@/lib/db';
import { listAudit } from '@/lib/repo/assays';
import { readShare } from '@/lib/services/assays';
import { replay } from '@/lib/integrity';
import { scoreColor, VerdictPill } from '@/components/ui';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Shared assay',
  description: 'A public, read-only view of one ORBITGENE record with its own verified audit chain.',
  robots: { index: false, follow: false },
};

type Params = { params: Promise<{ token: string }> };

/**
 * Public share view.
 *
 * The token is the capability, so no session cookie is required. The chain is
 * re-verified on read: a recipient can confirm the record was not edited after it
 * was shared.
 */
export default async function SharePage({ params }: Params) {
  const { token } = await params;
  if (!/^[0-9a-f]{32}$/.test(token)) notFound();

  const db = await getDb();
  const found = await readShare(db, token);
  if (!found) notFound();

  const events = await listAudit(db, found.assay.id);
  const report = replay(found.assay.id, events);
  const assay = found.assay;
  const r = assay.result;

  return (
    <div className="mx-auto max-w-[900px] space-y-5 px-4 py-10 sm:px-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="label">Shared record</p>
          <h1 className="display mt-2 text-2xl text-ink sm:text-3xl">
            {assay.geneSymbol} <span className="text-mutation">{assay.hgvsP}</span>
          </h1>
          <p className="data mt-1.5 text-[0.8rem] text-ink-dim">
            {assay.hgvsC} on {assay.uniprotAccession} / {assay.refseqMrna} &middot; well {assay.well}
          </p>
        </div>
        <div className="text-right">
          <VerdictPill verdict={assay.verdict} />
          <p className="data mt-2 text-3xl" style={{ color: scoreColor(assay.score) }}>
            {assay.score.toFixed(1)}
          </p>
        </div>
      </header>

      <section className="plate p-5">
        <h2 className="display text-[0.78rem] tracking-[0.16em] text-ink">Integrity</h2>
        <p
          className="mt-2 text-[0.82rem]"
          style={{ color: report.ok ? 'var(--color-cleared)' : 'var(--color-refused)' }}
        >
          {report.ok
            ? `Chain verifies across ${report.length} sealed event${report.length === 1 ? '' : 's'}, from genesis to the current head.`
            : `Chain is broken at event ${report.brokenAt}.`}
        </p>
        <p className="data mt-1.5 break-all text-[0.64rem] text-ink-faint">head {report.head ?? 'none'}</p>
      </section>

      <section className="plate p-5">
        <h2 className="display text-[0.78rem] tracking-[0.16em] text-ink">Factor ledger</h2>
        <ul className="mt-3 grid gap-2">
          {r.factors.map((f) => (
            <li key={f.key}>
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-[0.78rem] text-ink">{f.label}</span>
                <span className="data text-[0.7rem] text-ink-dim">
                  {f.support.toFixed(2)} x {f.weight.toFixed(2)} = {f.contribution.toFixed(3)}
                </span>
              </div>
              <span className="mt-1 block h-1 w-full overflow-hidden rounded-full bg-rim">
                <span
                  className="block h-full rounded-full"
                  style={{ width: `${Math.max(2, f.support * 100)}%`, background: 'var(--color-signal)' }}
                />
              </span>
              <span className="mt-1 block text-[0.7rem] leading-relaxed text-ink-faint">{f.summary}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="plate p-5">
        <h2 className="display text-[0.78rem] tracking-[0.16em] text-ink">Audit trail</h2>
        <ol className="mt-3 grid gap-1.5">
          {events.map((event) => (
            <li key={event.seq} className="flex flex-wrap items-baseline gap-3 rounded-md border border-rim px-3 py-2">
              <span className="data text-[0.7rem] text-ink-faint">#{event.seq}</span>
              <span className="label text-[0.58rem]">{event.action}</span>
              <span className="data text-[0.66rem] text-ink-faint">{event.at}</span>
              <span className="data ml-auto text-[0.62rem] text-ink-dim">{event.seal.slice(0, 20)}</span>
            </li>
          ))}
        </ol>
      </section>

      {assay.decision ? (
        <section className="plate p-5">
          <h2 className="display text-[0.78rem] tracking-[0.16em] text-ink">Sealed decision</h2>
          <p className="mt-2 text-[0.82rem] text-ink-dim">
            <span className="label text-[0.58rem]">{assay.decision.verdict}</span> on{' '}
            {assay.decision.decidedAt}: {assay.decision.rationale}
          </p>
        </section>
      ) : null}

      <p className="text-[0.72rem] leading-relaxed text-ink-faint">
        Research and teaching output, not a diagnostic device and not clinical advice. Data from
        UniProt, NCBI RefSeq and NOAA SWPC.{' '}
        <Link href="/" className="text-signal hover:underline">
          Build your own record
        </Link>
        .
      </p>
    </div>
  );
}