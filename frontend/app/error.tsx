'use client';

import { ErrorScreen } from '@/components/ErrorScreen';
import { Button } from '@/components/ui/Button';
import { copy } from '@/lib/copy';

/** Any page that throws lands here, inside the root layout. React has already logged the
 *  error to the browser console. */
export default function PageError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <ErrorScreen
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
  );
}
