import type { Metadata } from 'next';
import { FlightBudget } from '@/components/flight-budget';

export const metadata: Metadata = {
  title: 'Flight budget',
  description:
    'Live NOAA space weather feeding a radiation budget: total dose behind a given shield, expected single-event upsets in the sample buffer, and the readout redundancy actually required.',
  alternates: { canonical: '/flight' },
};

export default function FlightPage() {
  return <FlightBudget />;
}