'use client';

import { ErrorScreen } from '@/components/ErrorScreen';
import { Button } from '@/components/ui/Button';
import { copy } from '@/lib/copy';
import { THEME_INIT_SCRIPT } from '@/lib/theme';

import { fontVariables } from './fonts';

import '@/styles/tokens.css';
import '@/styles/global.css';

/** The last resort, for an error in the root layout itself. It replaces the layout, so it
 *  brings its own document, fonts and theme, and leaves out the site header. */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en-GB" className={fontVariables} suppressHydrationWarning>
      <head>
        <title>{`${copy.errorTitle}, EcoSort Edge`}</title>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body>
        <ErrorScreen
          bare
          title={copy.errorTitle}
          icon="alert"
          reference={error.digest}
          actions={
            <>
              <Button variant="primary" icon="replay" onClick={reset}>
                {copy.errorRetry}
              </Button>
              <Button onClick={() => window.location.assign('/')}>{copy.errorReload}</Button>
            </>
          }
        >
          <p>{copy.errorBody}</p>
          <p>{copy.errorCountsSafe}</p>
        </ErrorScreen>
      </body>
    </html>
  );
}
