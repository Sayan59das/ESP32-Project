import type { Metadata } from 'next';

import { TestingStory } from '@/components/testing/TestingStory';
import { loadTesting } from '@/lib/testingFile';

export const metadata: Metadata = {
  title: 'Testing, EcoSort Edge',
  description:
    'What was tested, what came out: automated checks, the camera-off scenarios, and how the model did on frames it never trained on.',
};

// Read on every request, so re-recording the tests only needs a reload.
export const dynamic = 'force-dynamic';

export default async function TestingPage() {
  const { data } = await loadTesting();
  return <TestingStory testing={data} />;
}
