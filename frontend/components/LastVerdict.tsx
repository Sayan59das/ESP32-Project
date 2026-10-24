import { urls } from '@/lib/api';
import { copy } from '@/lib/copy';
import { binWord, itemName, percent } from '@/lib/format';
import type { Event, ItemCount, StoredBin } from '@/lib/types';

import styles from './LastVerdict.module.css';
import panel from './Panel.module.css';
import { Pictogram } from './Pictogram';

export const bandClass: Record<StoredBin, string> = {
  recyclable: panel.bandRecyclable ?? '',
  trash: panel.bandTrash ?? '',
  unsure: panel.bandUnsure ?? '',
};

export function LastVerdict({
  event,
  items,
  className,
}: {
  event: Event | null;
  items: ItemCount[];
  className?: string;
}) {
  const name = event ? itemName(event, items) : '';
  return (
    <section className={`${panel.panel} ${className ?? ''}`} aria-labelledby="last-title">
      <h2 id="last-title" className={panel.title}>
        Last item
      </h2>
      {event === null ? (
        <p className={panel.empty}>{copy.emptyLastItem}</p>
      ) : (
        <div className={styles.verdict}>
          {event.has_frame ? (
            // eslint-disable-next-line @next/next/no-img-element -- a stored PNG, drawn pixelated
            <img
              className={panel.frame}
              src={urls.frame(event.id)}
              width={96}
              height={96}
              alt={`The frame the model classified as ${name.toLowerCase()}`}
            />
          ) : (
            <span
              className={`${panel.frameSlot} ${styles.slot}`}
              role="img"
              aria-label="No frame stored"
            />
          )}
          <div className={styles.details}>
            <p className={styles.name}>
              <Pictogram label={event.label} />
              {name}
            </p>
            <p className={`${styles.band} ${bandClass[event.bin]}`}>
              {event.bin === 'unsure' ? 'Unsure, not counted' : binWord(event.bin)}
            </p>
            <p className={styles.meta}>
              {percent(event.confidence)} confidence, inference {event.latency_ms} ms
            </p>
          </div>
        </div>
      )}
    </section>
  );
}
