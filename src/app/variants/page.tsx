import { Suspense } from 'react';
import type { Metadata } from 'next';
import { VariantWorkbench } from '@/components/variant-workbench';

export const metadata: Metadata = {
  title: 'Variants',
  description:
    'Pick a real UniProt residue and change any base of its codon. Every change re-runs the shared engine and redraws the itemised factor ledger.',
  alternates: { canonical: '/variants' },
};

export default function VariantsPage() {
  return (
    <Suspense
      fallback={
        <div className="mx-auto max-w-[1240px] px-4 py-10 sm:px-6">
          <p className="label">Variant workbench</p>
          <p className="mt-3 text-[0.85rem] text-ink-faint">Loading the workbench.</p>
        </div>
      }
    >
      <VariantWorkbench />
    </Suspense>
  );
}