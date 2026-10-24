import type { ReactNode } from 'react';

import styles from './Badge.module.css';
import { Icon, type IconName } from './Icon';

export type BadgeTone =
  'recyclable' | 'trash' | 'unsure' | 'signal' | 'alert' | 'neutral' | 'inverse';

/** A short status label. Always text plus an icon, never colour alone. */
export function Badge({
  tone,
  icon,
  size = 'md',
  className,
  children,
}: {
  tone: BadgeTone;
  icon?: IconName;
  size?: 'md' | 'lg';
  className?: string;
  children: ReactNode;
}) {
  const classes = [styles.badge, styles[tone], styles[size], className].filter(Boolean).join(' ');
  return (
    <span className={classes}>
      {icon ? <Icon name={icon} size={size === 'lg' ? 20 : 16} /> : null}
      <span>{children}</span>
    </span>
  );
}
