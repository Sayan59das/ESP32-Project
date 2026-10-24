import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { Styleguide } from './Styleguide';

export const metadata: Metadata = { title: 'Styleguide · EcoSort Edge' };

// A review page for the tokens and primitives. Development builds only.
export default function StyleguidePage() {
  if (process.env.NODE_ENV === 'production') notFound();
  return <Styleguide />;
}
