import type { ConnectionNotice } from '@/lib/connection';

import styles from './ConnectionBanner.module.css';
import { Icon } from './ui/Icon';

/** Full width under the header bar while live data is not flowing: what happened, and that
 *  it is being handled. Screen readers hear it through the console's live region, so this
 *  is not a live region itself. */
export function ConnectionBanner({ notice }: { notice: ConnectionNotice }) {
  const unreachable = notice.kind === 'unreachable';
  return (
    <div className={unreachable ? `${styles.banner} ${styles.alert}` : styles.banner}>
      <p className={styles.inner}>
        <Icon name={unreachable ? 'alert' : 'waiting'} size={20} className={styles.icon} />
        <span>
          <strong>{notice.title}.</strong> {notice.body}
        </span>
      </p>
    </div>
  );
}
