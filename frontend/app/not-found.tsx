import Link from 'next/link';

import { ErrorScreen } from '@/components/ErrorScreen';
import { buttonClass } from '@/components/ui/Button';
import { copy } from '@/lib/copy';

export default function NotFound() {
  return (
    <ErrorScreen
      title={copy.notFoundTitle}
      actions={
        <>
          <Link href="/" className={buttonClass('primary')}>
            Open the console
          </Link>
          <Link href="/project" className={buttonClass('secondary')}>
            About the project
          </Link>
        </>
      }
    >
      <p>{copy.notFoundBody}</p>
    </ErrorScreen>
  );
}
