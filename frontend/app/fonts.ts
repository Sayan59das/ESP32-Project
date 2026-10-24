import localFont from 'next/font/local';

// Both faces are vendored so the console works with no network. Shared by the root layout
// and the global error page, which replaces it.

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

export const fontVariables = `${archivo.variable} ${atkinson.variable}`;
