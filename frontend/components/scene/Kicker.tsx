import styles from './Story.module.css';

/** The small numbered label over a chapter's title. */
export function Kicker({ n, children }: { n: number; children: string }) {
  return (
    <p className={styles.kicker}>
      <span>{String(n).padStart(2, '0')}</span> {children}
    </p>
  );
}
