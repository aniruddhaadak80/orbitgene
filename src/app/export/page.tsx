import type { Metadata } from 'next';
import { ExportDesk } from '@/components/export-desk';

export const metadata: Metadata = {
  title: 'Dossier export',
  description:
    'Download a plate figure, a Markdown lab report, the raw JSON record or a CSV ledger. Every artefact carries the factor breakdown, source attribution, timestamps and the SHA-384 seal.',
  alternates: { canonical: '/export' },
};

export default function ExportPage() {
  return <ExportDesk />;
}