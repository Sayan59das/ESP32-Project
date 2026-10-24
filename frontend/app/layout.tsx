import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';

import { THEME_INIT_SCRIPT } from '@/lib/theme';

import { fontVariables } from './fonts';

import '@/styles/tokens.css';
import '@/styles/global.css';

export const metadata: Metadata = {
  title: 'EcoSort Edge',
  description: 'Operator console for a camera-based waste classifier.',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f2f0ea' },
    { media: '(prefers-color-scheme: dark)', color: '#0e1311' },
  ],
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    // The theme script sets data-theme before React hydrates, so the attribute may differ
    // from the server render on purpose.
    <html lang="en-GB" className={fontVariables} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
