import type { CSSProperties } from 'react';

import { copy } from '@/lib/copy';
import { percent } from '@/lib/format';
import type { Counts, ItemCount } from '@/lib/types';

import styles from './ItemBreakdown.module.css';
import { itemIcon, OUTCOMES } from './outcome';
import { Card } from './ui/Card';
import { Icon } from './ui/Icon';
import { Skeleton } from './ui/Skeleton';

interface Row {
  key: string;
  name: string;
  tone: 'recyclable' | 'trash' | 'unsure';
  count: number;
  /** Share of sorted items; unsure items are in neither bin, so they have none. */
  share: string;
}

/** Every item the server knows, zeros included, plus the unsure tally. A table first: the
 *  bars are drawn inside it and hidden from assistive tech, which reads the numbers. */
export function ItemBreakdown({
  items,
  counts,
  unavailable,
  className,
}: {
  items: ItemCount[];
  counts: Counts | null;
  unavailable: boolean;
  className?: string;
}) {
  const total = counts?.total_sorted ?? 0;
  const rows: Row[] = [
    ...items.map((item) => ({
      key: item.label,
      name: item.display_name,
      tone: item.bin,
      count: item.count,
      share: total === 0 ? '' : percent(item.count / total),
    })),
    ...(counts
      ? [
          {
            key: 'unsure',
            name: OUTCOMES.unsure.word,
            tone: 'unsure' as const,
            count: counts.unsure,
            share: 'not counted',
          },
        ]
      : []),
  ];
  // Bars compare the rows with each other: the longest row fills the track.
  const longest = Math.max(1, ...rows.map((row) => row.count));

  return (
    <Card
      title="By item"
      titleId="by-item-title"
      className={className}
      busy={counts === null && !unavailable}
      note={counts !== null && total === 0 ? copy.sharesLater : undefined}
    >
      {counts === null && unavailable ? (
        <p className={styles.unavailable}>{copy.unavailable}</p>
      ) : counts === null ? (
        <div className={styles.loading} aria-hidden="true">
          <Skeleton height="1.5rem" />
          <Skeleton height="1.5rem" />
          <Skeleton height="1.5rem" width="70%" />
        </div>
      ) : (
        <table className={styles.table}>
          <caption className="visually-hidden">
            Items sorted this run, by item, with each item&apos;s share of the sorted items.
          </caption>
          <thead>
            <tr>
              <th scope="col" className={styles.head}>
                Item
              </th>
              <th scope="col" className={styles.headNumber}>
                Count
              </th>
              <th scope="col" className={styles.headNumber}>
                Share
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const icon = row.tone === 'unsure' ? 'unsure' : itemIcon(row.key);
              const bar = { '--share': `${(row.count / longest) * 100}%` } as CSSProperties;
              return (
                <tr key={row.key} className={styles.row}>
                  <th scope="row" className={styles.item}>
                    <span className={`${styles.itemInner} ${styles[`mark-${row.tone}`] ?? ''}`}>
                      {icon ? <Icon name={icon} size={18} /> : null}
                      {row.name}
                    </span>
                    <span
                      className={`${styles.track} ${styles[`bar-${row.tone}`] ?? ''}`}
                      style={bar}
                      aria-hidden="true"
                    />
                  </th>
                  <td className={styles.number}>{row.count}</td>
                  <td className={styles.number}>{row.share}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </Card>
  );
}
