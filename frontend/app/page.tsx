import type { Metadata } from 'next';

import { HomeStory } from '@/components/home/HomeStory';
import { loadTesting } from '@/lib/testingFile';

export const metadata: Metadata = {
  title: 'EcoSort Edge',
  description:
    'A camera, a small neural network and one laptop that sort waste and count each item once.',
};

// Read on every request, so re-recording the tests only needs a reload.
export const dynamic = 'force-dynamic';

export default async function HomePage() {
  const { data } = await loadTesting();
  return <HomeStory testing={data} />;
}
