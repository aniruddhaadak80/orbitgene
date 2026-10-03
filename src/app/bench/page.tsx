import { Suspense } from 'react';
import type { Metadata } from 'next';
import { PlateWorkspace } from '@/components/plate-workspace';

export const metadata: Metadata = {
  title: 'Plate map',
  description:
    'Every scored substitution on a 96-well plate, coloured by its real readiness score, with URL-state filters you can share.',
  alternates: { canonical: '/bench' },
};

export default function BenchPage() {
  return (
    <Suspense
      fallback={
        <div className="mx-auto max-w-[1240px] px-4 py-10 sm:px-6">
          <p className="label">Plate map</p>
          <p className="mt-3 text-[0.85rem] text-ink-faint">Loading the plate.</p>
        </div>
      }
    >
<PlateWorkspace />
    </Suspense>
  );
}