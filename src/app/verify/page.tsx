import type { Metadata } from 'next';
import { ReplayCentre } from '@/components/replay-centre';

export const metadata: Metadata = {
  title: 'Seal replay',
  description:
    'Recompute every audit chain from its genesis value with SHA-384 and report the first broken link, including for retired records.',
  alternates: { canonical: '/verify' },
};

export default function VerifyPage() {
  return <ReplayCentre />;
}