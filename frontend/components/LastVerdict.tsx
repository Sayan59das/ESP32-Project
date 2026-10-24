import type { CSSProperties } from 'react';

import { urls } from '@/lib/api';
import { copy } from '@/lib/copy';
import { clockTime, itemName, percent } from '@/lib/format';
import type { Event, ItemCount } from '@/lib/types';

import styles from './LastVerdict.module.css';
import { OUTCOMES } from './outcome';
import { Badge } from './ui/Badge';
import { Card } from './ui/Card';
import { EmptyState } from './ui/EmptyState';
import { Icon, type IconName } from './ui/Icon';
import { SkeletonLines } from './ui/Skeleton';

const RHYTHM_ICONS: IconName[] = ['ready', 'inView', 'counted', 'remove'];

/** The newest verdict, large enough to read from the bin: what it was, how sure, the frame
 *  it was made from, and how long the model took. On an empty run, the counting rhythm. */
export function LastVerdict({
  event,
  items,
  loading,
  unavailable,
  fresh,
  className,
}: {
  event: Event | null;
  items: ItemCount[];
  loading: boolean;
  unavailable: boolean;
  /** The verdict arrived live just now, rather than with the page. */
  fresh: boolean;
  className?: string;
}) {
  return (
    <Card title="Last item" titleId="last-title" className={className} busy={loading}>
      {loading ? (
        <div className={styles.verdict}>
          <span className={styles.slot} aria-hidden="true" />
          <SkeletonLines lines={3} />
        </div>
      ) : unavailable ? (
        // The banner and the link panel carry the fault; the cards just say why they are empty.
        <p className={styles.unavailable}>{copy.unavailable}</p>
      ) : event === null ? (
        <EmptyState icon="ready" title={copy.emptyLastItem}>
          <div className={styles.rhythmBox}>
            <ol className={styles.rhythm}>
              {copy.rhythm.map((step, i) => (
                <li key={step} className={styles.step}>
                  <Icon name={RHYTHM_ICONS[i] ?? 'ready'} size={20} />
                  <span>{step}</span>
                </li>
              ))}
            </ol>
          </div>
        </EmptyState>
      ) : (
        <Verdict key={event.id} event={event} items={items} fresh={fresh} />
      )}
    </Card>
  );
}

function Verdict({ event, items, fresh }: { event: Event; items: ItemCount[]; fresh: boolean }) {
  const outcome = OUTCOMES[event.bin];
  const name = itemName(event, items);
  const unsure = event.bin === 'unsure';
  const bar = { '--confidence': `${Math.round(event.confidence * 100)}%` } as CSSProperties;
  return (
    <div className={fresh ? `${styles.verdict} ${styles.fresh}` : styles.verdict}>
      {event.has_frame ? (
        // eslint-disable-next-line @next/next/no-img-element -- a stored PNG, drawn pixelated
        <img
          className={styles.frame}
          src={urls.frame(event.id)}
          width={128}
          height={128}
          alt={`The frame the model classified as ${name.toLowerCase()}`}
        />
      ) : (
        <span className={styles.slot} role="img" aria-label="No frame stored" />
      )}
      <div className={styles.details}>
        <p className={`${styles.word} ${styles[`word-${event.bin}`] ?? ''}`}>
          <Icon name={outcome.icon} size={36} />
          {outcome.word}
        </p>
        <p className={styles.meta}>
          <Badge tone={outcome.tone} icon={outcome.icon}>
            {outcome.counted}
          </Badge>
          {/* The item's own name, when it says more than the bin word does. */}
          {unsure || name === outcome.word ? null : <span className={styles.item}>{name}</span>}
          <span className={styles.time}>at {clockTime(event.ts)}</span>
        </p>
        {unsure ? <p className={styles.unsureNote}>{copy.unsureNote}</p> : null}
        <div className={styles.confidence}>
          <p className={styles.confidenceLabel}>
            <span>Confidence</span>
            <strong>{percent(event.confidence)}</strong>
          </p>
          <span
            className={`${styles.track} ${styles[`track-${event.bin}`] ?? ''}`}
            style={bar}
            aria-hidden="true"
          />
        </div>
        <p className={styles.latency}>
          {copy.inferenceLabel}: <strong>{event.latency_ms} ms</strong>
        </p>
      </div>
    </div>
  );
}
