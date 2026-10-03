import Link from 'next/link';
import { ArrowRight, Dna, Microscope, Orbit, ShieldCheck } from 'lucide-react';
import { LandingDemo } from '@/components/landing-demo';
import { GitHubMark } from '@/components/github-mark';
import { PlateGrid, PlateLegend } from '@/components/plate-grid';
import { site } from '@/lib/site';

const jobs = [
  {
    title: 'A lab lead can price a substitution before ordering an oligo',
    body: 'Enter a real UniProt residue and the engine computes the codon change, the nearest-neighbour melting shift for the probe you would actually buy, and the photon budget of your own detector. You order fewer dead probes.',
  },
  {
    title: 'A payload engineer can see whether the readout survives the flight',
    body: 'Move shielding, orbit and mission length and the radiation budget re-derives the dose, the expected single-event upsets in the sample buffer and the number of redundant readouts you actually need.',
  },
  {
    title: 'A collaborator can check a decision without an account',
    body: 'Every create, update, decision and retirement appends to a SHA-384 chain. Share a record with a token and your colleague replays the chain from its genesis value and sees the same verdict.',
  },
];

/**
 * Landing.
 *
 * The layout is an instrument readout rather than a marketing hero: a working
 * primary action on the left, the empty plate and its coordinate rulers on the
 * right, and no centred copy stack or gradient wash.
 */
export default function HomePage() {
  return (
    <>
      <section className="mx-auto max-w-[1240px] px-4 pb-10 pt-12 sm:px-6 sm:pt-16">
        <div className="grid items-end gap-8 lg:grid-cols-[1.05fr_auto]">
          <div className="max-w-2xl">
            <p className="label flex items-center gap-2">
              <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-signal" />
              Flight-readiness triage for DNA assay hardware
            </p>
            <h1 className="display mt-4 text-[2.1rem] leading-[1.05] text-ink sm:text-[3rem]">
              Should this mutation
              <br />
              get an oligo, a
              <span className="text-signal"> photodiode</span> and a launch slot?
            </h1>
            <p className="mt-5 max-w-xl text-[0.92rem] leading-relaxed text-ink-dim">
              ORBITGENE pulls a real protein substitution from UniProt and its coding sequence from
              RefSeq, scores it against your own assay optics and probe thermodynamics, prices the
              radiation your sample buffer will absorb in orbit, and seals the decision into a
              hash-chained record. Every number on screen is shown with the evidence behind it.
            </p>

            <div className="mt-7 flex flex-wrap items-center gap-3">
              <Link
                href="/variants"
                className="inline-flex items-center gap-2 rounded-md bg-signal px-4 py-2.5 text-[0.85rem] font-semibold text-substrate transition-opacity hover:opacity-90"
              >
                Score a variant
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Link>
              <Link
                href="/bench"
                className="inline-flex items-center gap-2 rounded-md border border-rim px-4 py-2.5 text-[0.85rem] text-ink-dim transition-colors hover:border-signal/60 hover:text-signal"
              >
                Open the plate
              </Link>
              <a
                href={site.repoUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 rounded-md border border-rim px-4 py-2.5 text-[0.85rem] text-ink-dim transition-colors hover:border-signal/60 hover:text-signal"
                aria-label={`Star ${site.name} on GitHub (opens in a new tab)`}
              >
                <GitHubMark />
                Star on GitHub
              </a>
            </div>
          </div>

          <dl className="grid grid-cols-2 gap-x-6 gap-y-4 lg:w-64">
            {[
              { label: 'Factors', value: '6', hint: 'weighted and itemised' },
              { label: 'Seal', value: 'SHA-384', hint: 'per-record hash chain' },
              { label: 'Sources', value: '4', hint: 'UniProt, RefSeq, ClinVar, NOAA' },
              { label: 'Agent tools', value: '9', hint: 'MCP JSON-RPC 2.0' },
            ].map((stat) => (
              <div key={stat.label}>
                <dt className="label">{stat.label}</dt>
                <dd className="data mt-1 text-xl text-ink">
                  {stat.value}
                  <span className="ml-1.5 text-[0.65rem] text-ink-faint">{stat.hint}</span>
                </dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      <section className="mx-auto max-w-[1240px] px-4 pb-12 sm:px-6">
        <LandingDemo />
      </section>

      <section className="mx-auto max-w-[1240px] px-4 pb-12 sm:px-6">
        <div className="grid gap-4 lg:grid-cols-[1.35fr_1fr]">
          <div className="plate p-5 sm:p-6">
            <div className="flex flex-wrap items-baseline justify-between gap-3">
              <h2 className="display text-[0.8rem] tracking-[0.16em] text-ink">The plate</h2>
              <p className="text-[0.72rem] text-ink-faint">
                One well is one scored record. Yours is empty until you add to it.
              </p>
            </div>

            <div className="mt-4">
              <PlateGrid wells={[]} compact />
            </div>

            <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
              <PlateLegend />
              <Link href="/bench" className="text-[0.78rem] text-signal hover:underline">
                Load your records
              </Link>
            </div>
          </div>

          <ul className="grid gap-4">
            {jobs.map((job, index) => (
              <li key={job.title} className="plate p-5">
                <p className="label text-[0.6rem]">{`Job ${index + 1}`}</p>
                <h3 className="mt-2 text-[0.92rem] leading-snug text-ink">{job.title}</h3>
                <p className="mt-2 text-[0.78rem] leading-relaxed text-ink-dim">{job.body}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="mx-auto max-w-[1240px] px-4 pb-14 sm:px-6">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[
            { icon: Dna, title: 'Real sequences', body: 'Protein from UniProt, coding DNA sliced from the annotated CDS in the RefSeq GenBank record.' },
            { icon: Microscope, title: 'Real optics', body: 'Photon transfer from your emitter, responsivity, dark current, gain and ADC resolution.' },
            { icon: Orbit, title: 'Real sky', body: 'Planetary K index, GOES X-ray class and proton flux read live, with a labelled sealed fallback.' },
            { icon: ShieldCheck, title: 'Real audit', body: 'Every mutation appends a SHA-384 sealed event. Deletions leave a replayable tombstone.' },
          ].map((item) => (
            <div key={item.title} className="plate p-5">
              <item.icon className="h-4 w-4 text-signal" aria-hidden="true" />
              <h3 className="mt-3 text-[0.85rem] text-ink">{item.title}</h3>
              <p className="mt-1.5 text-[0.76rem] leading-relaxed text-ink-dim">{item.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-[1240px] px-4 pb-16 sm:px-6">
        <div className="plate border-l-2 border-l-caution/60 p-5 sm:p-6">
          <h2 className="display text-[0.8rem] tracking-[0.16em] text-ink">Safety and scope</h2>
          <div className="mt-3 grid gap-4 text-[0.78rem] leading-relaxed text-ink-dim md:grid-cols-2">
            <p>
              ORBITGENE is a research and teaching instrument. It is not a diagnostic device and
              nothing here is clinical advice. A score describes whether a substitution is worth an
              assay and a flight slot, not whether a person has a condition.
            </p>
            <p>
              Variant annotations are read from public databases and inherit their curation. Verify
              anything that matters against ClinVar, the primary literature and a clinical geneticist
              before acting on it.
            </p>
          </div>
        </div>
      </section>
    </>
  );
}