'use client';

import { useState } from 'react';

import { copy } from '@/lib/copy';
import { rateText, splitFor, trashRateText } from '@/lib/format';
import type { Counts } from '@/lib/types';

import styles from './BinReadout.module.css';

/** A count that crossfades to its new value. The first render does not animate. */
function Numeral({
  value,
  className,
  testId,
}: {
  value: number | null;
  className?: string;
  testId: string;
}) {
  const [pair, setPair] = useState({ now: value, before: null as number | null });
  if (pair.now !== value) setPair({ now: value, before: pair.now });
  const changed = pair.before !== null;
  return (
    <p className={`${styles.numeral} ${className}`}>
      {changed ? (
        <span
          key={`out-${pair.before}-${pair.now}`}
          className={`${styles.digits} ${styles.outgoing}`}
          aria-hidden="true"
        >
          {pair.before}
        </span>
      ) : null}
      <span
        key={`in-${pair.now}`}
        className={`${styles.digits} ${changed ? styles.incoming : ''}`}
        data-testid={testId}
      >
        {pair.now ?? copy.noRate}
      </span>
    </p>
  );
}

function share(rate: number | null, text: string): string {
  return rate === null ? text : `${text} of items`;
}

export function BinReadout({ counts, stale }: { counts: Counts | null; stale: boolean }) {
  const rate = counts?.recycle_rate ?? null;
  const { split, clamped } = splitFor(rate);
  return (
    <div className={styles.readout}>
      <div
        className={stale ? `${styles.bins} ${styles.binsStale}` : styles.bins}
        data-testid="bin-readout"
      >
        <section
          className={styles.recyclable}
          style={{ flexBasis: `${split * 100}%` }}
          aria-labelledby="bin-recyclable"
        >
          <h2 id="bin-recyclable" className={styles.title}>
            Recyclable
          </h2>
          <Numeral
            value={counts?.recyclable ?? null}
            className={styles.recyclableNumeral}
            testId="count-recyclable"
          />
          <p className={styles.share}>{share(rate, rateText(rate))}</p>
        </section>
        <section className={styles.trash} aria-labelledby="bin-trash">
          <h2 id="bin-trash" className={styles.title}>
            Trash
          </h2>
          <Numeral
            value={counts?.trash ?? null}
            className={styles.trashNumeral}
            testId="count-trash"
          />
          <p className={styles.share}>{share(rate, trashRateText(rate))}</p>
        </section>
        {clamped && rate !== null ? (
          // The boundary stops at 30% and 70% so both numerals fit; this mark shows the
          // true ratio when it does.
          <span
            className={styles.trueRatio}
            style={{ left: `${rate * 100}%` }}
            aria-hidden="true"
          />
        ) : null}
      </div>
      <p className={styles.footer}>
        {stale ? 'Last known counts. ' : ''}
        {counts === null
          ? 'Connecting to the classifier service.'
          : `${counts.total_sorted} sorted. ${counts.unsure} unsure, not counted in either bin.`}
      </p>
    </div>
  );
}
