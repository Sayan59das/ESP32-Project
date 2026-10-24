import type { Metadata, Viewport } from 'next';
import localFont from 'next/font/local';
import type { ReactNode } from 'react';

import { THEME_INIT_SCRIPT } from '@/lib/theme';

import '@/styles/tokens.css';
import '@/styles/global.css';

// Both faces are vendored so the console works with no network.
// Archivo, variable in weight and width: numbers and headings.
const archivo = localFont({
  src: './fonts/archivo-latin-wdth-normal.woff2',
  variable: '--font-archivo',
  weight: '100 900',
  display: 'swap',
  declarations: [{ prop: 'font-stretch', value: '62% 125%' }],
});

// Atkinson Hyperlegible Next, variable in weight: running text.
const atkinson = localFont({
  src: './fonts/atkinson-hyperlegible-next-latin-wght-normal.woff2',
  variable: '--font-atkinson',
  weight: '200 800',
  display: 'swap',
});

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
    <html
      lang="en-GB"
      className={`${archivo.variable} ${atkinson.variable}`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
