/**
 * Single source of truth for product identity, navigation and outbound links.
 * The shared header, mobile menu, landing CTA, footer, OG metadata, sitemap,
 * README propagation step and `public/mcp.json` all read from here so the
 * repository URL is never duplicated across components.
 */
export const site = {
  name: 'ORBITGENE',
  /** One-line outcome used in metadata and the landing hero. */
  tagline: 'Flight-readiness triage for DNA assay hardware.',
  description:
    'Import a real protein substitution from UniProt, RefSeq and ClinVar, score it against your own assay optics, probe thermodynamics and the live NOAA space weather, then seal the decision into a hash-chained, exportable assay record.',
  /** Verified production alias. Propagated by the ship step. */
  liveUrl: 'https://orbitgene.vercel.app',
  repoUrl: 'https://github.com/aniruddhaadak80/orbitgene',
  repoSlug: 'aniruddhaadak80/orbitgene',
  repoNoun: 'View source',
  license: 'MIT',
  author: 'aniruddhaadak80',
  language: 'en',
} as const;

export const nav = [
  { href: '/bench', label: 'Plate map' },
  { href: '/variants', label: 'Variants' },
  { href: '/flight', label: 'Flight' },
  { href: '/export', label: 'Export' },
  { href: '/agent', label: 'Agent' },
  { href: '/settings', label: 'Settings' },
] as const;

export const mcpEndpoint = `${site.liveUrl}/api/mcp`;

/** Absolute URL for a site-relative path. */
export function absolute(path: string): string {
  if (path.startsWith('http')) return path;
  return `${site.liveUrl}${path.startsWith('/') ? path : `/${path}`}`;
}