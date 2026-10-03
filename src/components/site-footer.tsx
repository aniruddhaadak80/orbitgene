import Link from 'next/link';
import { GitHubMark } from './github-mark';

const columns = [
  {
    title: 'Instrument',
    links: [
      { href: '/variants', label: 'Variants' },
      { href: '/bench', label: 'Plate map' },
      { href: '/flight', label: 'Flight budget' },
    ],
  },
  {
    title: 'Output',
    links: [
      { href: '/export', label: 'Dossier export' },
      { href: '/verify', label: 'Seal replay' },
      { href: '/agent', label: 'Agent console' },
    ],
  },
  {
    title: 'Config',
    links: [{ href: '/settings', label: 'Assay settings' }],
  },
];

/** Shared footer. Carries the repository link and the live deployment URL. */
export function SiteFooter({
  repoUrl,
  liveUrl,
  productName,
}: {
  repoUrl: string;
  liveUrl: string;
  productName: string;
}) {
  return (
    <footer className="mt-20 border-t border-rim bg-[#05070a]">
      <div className="mx-auto grid max-w-[1240px] gap-8 px-4 py-12 sm:px-6 md:grid-cols-[1.4fr_repeat(3,1fr)]">
        <div>
          <p className="display text-sm tracking-[0.14em] text-ink">{productName}</p>
          <p className="mt-2 max-w-xs text-[0.8rem] leading-relaxed text-ink-faint">
            A bench instrument for deciding which genetic substitutions deserve an oligo, a
            photodiode and a launch slot. Research and teaching use only.
          </p>
          <a
            href={repoUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-4 inline-flex items-center gap-2 rounded-md border border-rim px-3 py-2 text-[0.8rem] text-ink-dim transition-colors hover:border-signal/60 hover:text-signal"
            aria-label={`Star ${productName} on GitHub (opens in a new tab)`}
          >
            <GitHubMark />
            <span>Star on GitHub</span>
          </a>
        </div>

        {columns.map((column) => (
          <div key={column.title}>
            <p className="label">{column.title}</p>
            <ul className="mt-3 grid gap-2">
              {column.links.map((link) => (
                <li key={link.href}>
                  <Link href={link.href} className="text-[0.8rem] text-ink-dim transition-colors hover:text-signal">
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      <div className="border-t border-rim/70">
        <div className="mx-auto flex max-w-[1240px] flex-col gap-2 px-4 py-5 text-[0.72rem] text-ink-faint sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <p>
            Data from UniProt, NCBI RefSeq and NOAA SWPC. Scores are research guidance, not
            clinical advice.
          </p>
          <p className="flex items-center gap-4">
            <a
              href={liveUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="transition-colors hover:text-signal"
            >
              Live deployment
            </a>
            <span>MIT licensed</span>
          </p>
        </div>
      </div>
    </footer>
  );
}