import type { ReactNode } from 'react';

import styles from './Card.module.css';

/** A flat, bordered panel with a titled header. The title is an h2 unless told otherwise. */
export function Card({
  title,
  titleId,
  headingLevel = 2,
  actions,
  note,
  className,
  bodyClassName,
  busy,
  children,
}: {
  title: ReactNode;
  titleId: string;
  headingLevel?: 2 | 3;
  actions?: ReactNode;
  note?: ReactNode;
  className?: string;
  bodyClassName?: string;
  busy?: boolean;
  children: ReactNode;
}) {
  const Heading = headingLevel === 2 ? 'h2' : 'h3';
  return (
    <section
      className={[styles.card, className].filter(Boolean).join(' ')}
      aria-labelledby={titleId}
      aria-busy={busy || undefined}
    >
      <header className={styles.header}>
        <Heading id={titleId} className={styles.title}>
          {title}
        </Heading>
        {actions ? <div className={styles.actions}>{actions}</div> : null}
      </header>
      {note ? <p className={styles.note}>{note}</p> : null}
      <div className={[styles.body, bodyClassName].filter(Boolean).join(' ')}>{children}</div>
    </section>
  );
}
