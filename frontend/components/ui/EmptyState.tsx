import type { ReactNode } from 'react';

import styles from './EmptyState.module.css';
import { Icon, type IconName } from './Icon';

/** What a panel shows when it has nothing to show yet: an icon, one line in bold, then
 *  what happens next. Calm on purpose; an empty run is not a fault. */
export function EmptyState({
  icon,
  title,
  children,
}: {
  icon: IconName;
  title: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className={styles.empty}>
      <Icon name={icon} size={24} className={styles.icon} />
      <div className={styles.text}>
        <p className={styles.title}>{title}</p>
        {children}
      </div>
    </div>
  );
}
