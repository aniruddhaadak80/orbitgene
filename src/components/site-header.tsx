'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useId, useState } from 'react';
import { Menu, X } from 'lucide-react';
import { GitHubMark } from './github-mark';

interface NavItem {
  href: string;
  label: string;
}

/**
 * Shared navigation.
 *
 * The repository link is present in the desktop bar, in the mobile menu and on
 * every route, and always carries visible text so it never depends on an icon
 * being recognised.
 */
export function SiteHeader({
  nav,
  repoUrl,
  productName,
}: {
  nav: readonly NavItem[];
  repoUrl: string;
  productName: string;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const menuId = useId();

  // The panel closes through the links themselves rather than a route-change
  // effect: the only way to navigate while it is open is to click one of them.

  return (
    <header className="sticky top-0 z-40 border-b border-rim bg-substrate/85 backdrop-blur">
      <div className="mx-auto flex max-w-[1240px] items-center gap-4 px-4 py-3 sm:px-6">
        <Link href="/" className="group flex items-center gap-2.5" aria-label={`${productName} home`}>
          <span
            aria-hidden="true"
            className="relative grid h-7 w-7 place-items-center rounded-full border border-signal/60 bg-signal/10"
          >
            <span className="h-2 w-2 rounded-full bg-signal shadow-[0_0_10px_2px] shadow-signal/60" />
          </span>
          <span className="display text-[0.95rem] tracking-[0.14em] text-ink">{productName}</span>
        </Link>

        <nav aria-label="Primary" className="ml-auto hidden items-center gap-1 lg:flex">
          {nav.map((item) => {
            const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className={[
                  'rounded-md px-3 py-1.5 text-[0.8rem] transition-colors',
                  active
                    ? 'bg-signal/12 text-signal'
                    : 'text-ink-dim hover:bg-rim hover:text-ink',
                ].join(' ')}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>

        <a
          href={repoUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="ml-auto hidden items-center gap-2 rounded-md border border-rim px-3 py-1.5 text-[0.8rem] text-ink-dim transition-colors hover:border-signal/60 hover:text-signal lg:ml-2 lg:inline-flex"
          aria-label="Star ORBITGENE on GitHub (opens in a new tab)"
        >
          <GitHubMark />
          <span>View source</span>
        </a>

        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-controls={menuId}
          className="ml-auto inline-flex items-center gap-2 rounded-md border border-rim px-3 py-1.5 text-[0.8rem] text-ink-dim lg:hidden"
        >
          {open ? <X className="h-4 w-4" aria-hidden="true" /> : <Menu className="h-4 w-4" aria-hidden="true" />}
          <span>{open ? 'Close' : 'Menu'}</span>
        </button>
      </div>

      {open ? (
        <div id={menuId} className="border-t border-rim bg-substrate lg:hidden">
          <nav aria-label="Mobile" className="mx-auto grid max-w-[1240px] gap-1 px-4 py-3 sm:px-6">
            {nav.map((item) => {
              const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setOpen(false)}
                  aria-current={active ? 'page' : undefined}
                  className={[
                    'rounded-md px-3 py-2.5 text-sm',
                    active ? 'bg-signal/12 text-signal' : 'text-ink-dim hover:bg-rim hover:text-ink',
                  ].join(' ')}
                >
                  {item.label}
                </Link>
              );
            })}
            <a
              href={repoUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-1 inline-flex items-center gap-2 rounded-md border border-rim px-3 py-2.5 text-sm text-ink-dim"
              aria-label="Star ORBITGENE on GitHub (opens in a new tab)"
            >
              <GitHubMark />
              <span>Star on GitHub</span>
            </a>
          </nav>
        </div>
      ) : null}
    </header>
  );
}