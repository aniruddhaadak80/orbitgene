import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getDb } from '@/lib/db';
import { currentOwnerId, readSettings } from '@/lib/session';
import { getAssay, listAudit } from '@/lib/repo/assays';
import { findFlight, findInstrument } from '@/lib/profiles';
import { replay } from '@/lib/integrity';
import { AssayDetail } from '@/components/assay-detail';
import { Panel, PanelHeading } from '@/components/ui';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Assay record',
  description: 'Itemised factors, gates, decision controls and the sealed audit chain for one record.',
};

type Params = { params: Promise<{ id: string }> };

export default async function AssayPage({ params }: Params) {
  const { id } = await params;
  const ownerId = await currentOwnerId();

  if (!ownerId) notFound();

  let assay = null;
  try {
    const db = await getDb();
    assay = await getAssay(db, ownerId, id);
  } catch {
    // A store failure must not render a broken page; the 404 below is honest.
    assay = null;
  }

  if (!assay) notFound();

  const db = await getDb();
  const events = await listAudit(db, id);
  const report = replay(id, events);
  const settings = await readSettings(ownerId);

  return (
    <div className="mx-auto max-w-[1240px] space-y-5 px-4 py-10 sm:px-6">
      <AssayDetail
        assay={assay}
        integrity={{
          ok: report.ok,
          length: report.length,
          genesis: report.genesis,
          head: report.head,
          brokenAt: report.brokenAt,
          brokenReason: report.brokenReason,
        }}
        instrument={findInstrument(assay.instrumentId)}
        flight={findFlight(assay.flightProfileId)}
        defaults={settings}
      />

      <Panel>
        <PanelHeading
          title="Audit chain"
          detail={`Each event seals the previous seal, so any edit breaks every later link. Genesis is ${report.genesis}.`}
          action={
            <Link href="/verify" className="text-[0.78rem] text-signal hover:underline">
              Replay centre
            </Link>
          }
        />
        <ol className="grid gap-1.5">
          {events.map((event) => (
            <li
              key={event.seq}
              className="flex flex-wrap items-baseline gap-3 rounded-md border border-rim px-3 py-2"
            >
              <span className="data text-[0.7rem] text-ink-faint">#{event.seq}</span>
              <span className="label text-[0.58rem]">{event.action}</span>
              <span className="data text-[0.68rem] text-ink-faint">{event.at}</span>
              <span className="label text-[0.52rem] text-ink-faint">{event.actor}</span>
              <span className="data ml-auto text-[0.62rem] text-ink-dim" title={event.seal}>
                {event.seal.slice(0, 20)}
              </span>
            </li>
          ))}
        </ol>
      </Panel>
    </div>
  );
}