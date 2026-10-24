import type { Metadata } from 'next';

import { Console } from '@/components/Console';

export const metadata: Metadata = { title: 'Console, EcoSort Edge' };

export default function ConsolePage() {
  return <Console />;
}
