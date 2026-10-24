import type { CSSProperties } from 'react';

import styles from './Skeleton.module.css';

/** A still placeholder block while data loads. It does not shimmer: nothing on the console
 *  loops. Hidden from assistive tech; the container says it is busy instead. */
export function Skeleton({
  width = '100%',
  height = '1em',
  className,
}: {
  width?: CSSProperties['width'];
  height?: CSSProperties['height'];
  className?: string;
}) {
  return (
    <span
      className={[styles.skeleton, className].filter(Boolean).join(' ')}
      style={{ width, height }}
      aria-hidden="true"
    />
  );
}

/** A few lines of placeholder text, the last one shorter. */
export function SkeletonLines({ lines = 3 }: { lines?: number }) {
  return (
    <span className={styles.lines} aria-hidden="true">
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} width={i === lines - 1 ? '60%' : '100%'} />
      ))}
    </span>
  );
}
