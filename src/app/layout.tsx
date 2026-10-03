import type { Metadata, Viewport } from 'next';
import { Oxanium, Spline_Sans_Mono } from 'next/font/google';
import Link from 'next/link';
import { site, nav } from '@/lib/site';
import { SiteFooter } from '@/components/site-footer';
import { SiteHeader } from '@/components/site-header';
import './globals.css';

const oxanium = Oxanium({
  variable: '--font-oxanium',
  subsets: ['latin'],
  weight: ['500', '600', '700', '800'],
  display: 'swap',
});

const splineMono = Spline_Sans_Mono({
  variable: '--font-spline-mono',
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  display: 'swap',
});

export const metadata: Metadata = {
  metadataBase: new URL(site.liveUrl),
  title: {
    default: `${site.name} — ${site.tagline}`,
    template: `%s · ${site.name}`,
  },
  description: site.description,
  applicationName: site.name,
  authors: [{ name: site.author, url: `https://github.com/${site.author}` }],
  creator: site.author,
  publisher: site.author,
  keywords: [
    'DNA assay',
    'protein substitution',
    'codon',
    'nearest-neighbour thermodynamics',
    'space radiation',
    'single-event upset',
    'CubeSat payload',
    'MCP server',
    'tamper-evident audit log',
  ],
  alternates: { canonical: '/' },
  openGraph: {
    type: 'website',
    url: site.liveUrl,
    siteName: site.name,
    title: `${site.name} — ${site.tagline}`,
    description: site.description,
    images: [{ url: '/opengraph-image', width: 1200, height: 630, alt: `${site.name} plate map` }],
  },
  twitter: {
    card: 'summary_large_image',
    title: `${site.name} — ${site.tagline}`,
    description: site.description,
    images: ['/opengraph-image'],
  },
  robots: { index: true, follow: true },
  icons: {
    icon: [{ url: '/icon.svg', type: 'image/svg+xml' }],
  },
};

export const viewport: Viewport = {
  themeColor: '#07090c',
  colorScheme: 'dark',
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang={site.language} className={`${oxanium.variable} ${splineMono.variable} h-full`}>
      <body className="flex min-h-full flex-col">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded focus:bg-signal focus:px-4 focus:py-2 focus:text-substrate"
        >
          Skip to content
        </a>
        <SiteHeader nav={nav} repoUrl={site.repoUrl} productName={site.name} />
        <main id="main" className="flex-1">
          {children}
        </main>
        <SiteFooter repoUrl={site.repoUrl} liveUrl={site.liveUrl} productName={site.name} />
      </body>
    </html>
  );
}

/** Exported for the sitemap generator. */
export function routeList() {
  return ['/', '/variants', '/bench', '/flight', '/agent', '/export', '/settings', '/verify'];
}

export { Link };