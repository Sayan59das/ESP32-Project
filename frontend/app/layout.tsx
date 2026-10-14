import type { Metadata, Viewport } from 'next';
import localFont from 'next/font/local';
import type { ReactNode } from 'react';

import '@/styles/tokens.css';
import '@/styles/global.css';

// Vendored so the console works with no network: Archivo, variable in weight and width.
const archivo = localFont({
  src: './fonts/archivo-latin-wdth-normal.woff2',
  variable: '--font-archivo',
  weight: '100 900',
  display: 'swap',
  declarations: [{ prop: 'font-stretch', value: '62% 125%' }],
});

export const metadata: Metadata = {
  title: 'EcoSort Edge',
  description: 'Operator console for an on-device waste classifier.',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en-GB" className={archivo.variable}>
      <body>{children}</body>
    </html>
  );
}
