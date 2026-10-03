import type { Metadata } from 'next';
import { SettingsDesk } from '@/components/settings-desk';

export const metadata: Metadata = {
  title: 'Assay settings',
  description:
    'The emitter, detector, ADC, hybridisation chemistry, shielding and orbit that the engine actually reads. Changing these changes the next score.',
  alternates: { canonical: '/settings' },
};

export default function SettingsPage() {
  return <SettingsDesk />;
}