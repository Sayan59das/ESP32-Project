import type { ReactNode } from 'react';

import { copy } from '@/lib/copy';

import { Icon } from './Icon';
import styles from './Measured.module.css';

/** The one way a missing measurement is shown: the words "Not measured yet" in a dashed
 *  outline, so it never reads as a value. Never 0, a dash or an estimate. */
export function NotMeasured({ label = copy.notMeasured }: { label?: string }) {
  return (
    <span className={styles.notMeasured}>
      <Icon name="waiting" size={14} />
      <span>{label}</span>
    </span>
  );
}

/** A value from data/metrics.json, formatted, or NotMeasured when it is null. */
export function measured<T>(value: T | null, format: (v: T) => ReactNode): ReactNode {
  return value === null ? <NotMeasured /> : format(value);
}
