import { copy } from '@/lib/copy';
import { binWord, percent } from '@/lib/format';
import type { Counts, ItemCount } from '@/lib/types';

import styles from './ItemBreakdown.module.css';
import panel from './Panel.module.css';
import { Pictogram } from './Pictogram';

const BINS = ['recyclable', 'trash'] as const;

/** All four items, zeros included, grouped under the bin each one goes in. The share is of
 *  everything sorted, not of the largest item; the bin readout stays the page's only
 *  drawing of proportion. */
export function ItemBreakdown({
  items,
  counts,
  className,
}: {
  items: ItemCount[];
  counts: Counts | null;
  className?: string;
}) {
  const total = counts?.total_sorted ?? 0;
  return (
    <section className={`${panel.panel} ${className ?? ''}`} aria-labelledby="by-item-title">
      <h2 id="by-item-title" className={panel.title}>
        By item
      </h2>
      <table className={styles.table}>
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
        {BINS.map((bin) => (
          <tbody key={bin}>
            <tr>
              <th scope="rowgroup" colSpan={3} className={styles.group}>
                {binWord(bin)}
              </th>
            </tr>
            {items
              .filter((item) => item.bin === bin)
              .map((item) => (
                <tr key={item.label} className={styles.row}>
                  <th scope="row" className={styles.item}>
                    <span className={styles.itemInner}>
                      <Pictogram label={item.label} />
                      {item.display_name}
                    </span>
                  </th>
                  <td className={styles.number}>{item.count}</td>
                  <td className={styles.number}>
                    {total === 0 ? copy.noRate : percent(item.count / total)}
                  </td>
                </tr>
              ))}
          </tbody>
        ))}
      </table>
    </section>
  );
}
