'use client';

import { useState, type CSSProperties } from 'react';

import { copy } from '@/lib/copy';
import { binShare } from '@/lib/format';
import type { Counts } from '@/lib/types';

import styles from './BinReadout.module.css';
import { OUTCOMES } from './outcome';
import { Icon } from './ui/Icon';
import { Skeleton } from './ui/Skeleton';

/** True once the value has changed since it was first shown, so the count-change highlight
 *  never plays for the counts a page loads with. */
function useHasChanged(value: number): boolean {
  const [seen, setSeen] = useState({ value, changed: false });
  if (seen.value !== value) {
    setSeen({ value, changed: true });
    return true;
  }
  return seen.changed;
}

/** A server count, as it arrived. Never computed, rolled or estimated here. Each new value
 *  is a new element (the key), so the highlight plays once per change, behind the digits. */
function Count({
  value,
  className,
  testId,
}: {
  value: number;
  className?: string;
  testId: string;
}) {
  const changed = useHasChanged(value);
  return (
    <>
      {changed ? (
        <span
          key={`flash-${value}`}
          className={styles.flash}
          data-testid="count-highlight"
          aria-hidden="true"
        />
      ) : null}
      <p className={className}>
        <span
          key={value}
          className={changed ? `${styles.digits} ${styles.digitsChanged}` : styles.digits}
          data-testid={testId}
        >
          {value}
        </span>
      </p>
    </>
  );
}

function BinTile({
  bin,
  value,
  rate,
  unavailable,
}: {
  bin: 'recyclable' | 'trash';
  value: number | null;
  rate: number | null;
  unavailable: boolean;
}) {
  const outcome = OUTCOMES[bin];
  // The numeral shrinks with its digit count, so 1000 fits the tile as well as 7 does.
  const digits = { '--digits': Math.max(String(value ?? 0).length, 2) } as CSSProperties;
  return (
    <section
      className={`${styles.tile} ${styles[bin]}`}
      aria-labelledby={`bin-${bin}`}
      style={digits}
    >
      <h2 id={`bin-${bin}`} className={styles.title}>
        <Icon name={outcome.icon} size={22} />
        {outcome.word}
      </h2>
      {value !== null ? (
        <Count value={value} className={styles.numeral} testId={`count-${bin}`} />
      ) : unavailable ? (
        <p className={styles.unavailable}>{copy.noCounts}</p>
      ) : (
        <Skeleton className={styles.numeralSkeleton} width="60%" height="1em" />
      )}
      <p className={styles.share}>
        {value !== null
          ? binShare(rate, bin)
          : unavailable
            ? copy.linkUnreachable
            : copy.chip.connecting}
      </p>
    </section>
  );
}

export function BinReadout({
  counts,
  stale,
  unavailable,
}: {
  counts: Counts | null;
  /** Live updates are paused: the counts are the last ones received. */
  stale: boolean;
  /** The service is unreachable and no counts ever arrived. */
  unavailable: boolean;
}) {
  const rate = counts?.recycle_rate ?? null;
  const loading = counts === null && !unavailable;
  return (
    <div className={styles.readout} aria-busy={loading || undefined}>
      <div
        className={stale && counts !== null ? `${styles.bins} ${styles.binsStale}` : styles.bins}
        data-testid="bin-readout"
      >
        <BinTile
          bin="recyclable"
          value={counts?.recyclable ?? null}
          rate={rate}
          unavailable={unavailable}
        />
        <BinTile bin="trash" value={counts?.trash ?? null} rate={rate} unavailable={unavailable} />
        <section className={styles.unsure} aria-labelledby="bin-unsure">
          <h2 id="bin-unsure" className={styles.unsureTitle}>
            <Icon name="unsure" size={20} />
            {OUTCOMES.unsure.word}
          </h2>
          <p className={styles.unsureNote}>{OUTCOMES.unsure.counted}</p>
          {counts !== null ? (
            <Count value={counts.unsure} className={styles.unsureCount} testId="count-unsure" />
          ) : unavailable ? null : (
            <Skeleton width="2ch" height="1em" className={styles.unsureSkeleton} />
          )}
        </section>
      </div>
      {stale && counts !== null ? (
        <p className={styles.footer}>
          <strong>Last known counts.</strong> Live updates are paused; these may be behind.
        </p>
      ) : null}
    </div>
  );
}
