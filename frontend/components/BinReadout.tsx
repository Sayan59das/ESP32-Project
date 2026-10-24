'use client';

import type { CSSProperties } from 'react';

import { binShare } from '@/lib/format';
import type { Counts } from '@/lib/types';

import styles from './BinReadout.module.css';
import { OUTCOMES } from './outcome';
import { Icon } from './ui/Icon';
import { Skeleton } from './ui/Skeleton';

/** A server count, as it arrived. Never computed, rolled or estimated here. The key makes
 *  each new value a new element, which is what the count-change highlight keys off. */
function Numeral({
  value,
  className,
  testId,
}: {
  value: number;
  className?: string;
  testId: string;
}) {
  // The numeral shrinks with its digit count, so 1000 fits the tile as well as 7 does.
  const style = { '--digits': Math.max(String(value).length, 2) } as CSSProperties;
  return (
    <p className={`${styles.numeral} ${className ?? ''}`} style={style}>
      <span key={value} className={styles.digits} data-testid={testId}>
        {value}
      </span>
    </p>
  );
}

function BinTile({
  bin,
  value,
  rate,
}: {
  bin: 'recyclable' | 'trash';
  value: number | null;
  rate: number | null;
}) {
  const outcome = OUTCOMES[bin];
  return (
    <section className={`${styles.tile} ${styles[bin]}`} aria-labelledby={`bin-${bin}`}>
      <h2 id={`bin-${bin}`} className={styles.title}>
        <Icon name={outcome.icon} size={22} />
        {outcome.word}
      </h2>
      {value === null ? (
        <Skeleton className={styles.numeralSkeleton} width="60%" height="1em" />
      ) : (
        <Numeral value={value} testId={`count-${bin}`} />
      )}
      <p className={styles.share}>{value === null ? 'Connecting' : binShare(rate, bin)}</p>
    </section>
  );
}

export function BinReadout({ counts, stale }: { counts: Counts | null; stale: boolean }) {
  const rate = counts?.recycle_rate ?? null;
  return (
    <div className={styles.readout} aria-busy={counts === null || undefined}>
      <div
        className={stale ? `${styles.bins} ${styles.binsStale}` : styles.bins}
        data-testid="bin-readout"
      >
        <BinTile bin="recyclable" value={counts?.recyclable ?? null} rate={rate} />
        <BinTile bin="trash" value={counts?.trash ?? null} rate={rate} />
        <section className={styles.unsure} aria-labelledby="bin-unsure">
          <h2 id="bin-unsure" className={styles.unsureTitle}>
            <Icon name="unsure" size={20} />
            {OUTCOMES.unsure.word}
          </h2>
          <p className={styles.unsureNote}>{OUTCOMES.unsure.counted}</p>
          {counts === null ? (
            <Skeleton width="2ch" height="1em" className={styles.unsureSkeleton} />
          ) : (
            <p className={styles.unsureCount}>
              <span key={counts.unsure} className={styles.digits} data-testid="count-unsure">
                {counts.unsure}
              </span>
            </p>
          )}
        </section>
      </div>
      {stale ? (
        <p className={styles.footer}>
          <strong>Last known counts.</strong> Live updates are paused; these may be behind.
        </p>
      ) : null}
    </div>
  );
}
