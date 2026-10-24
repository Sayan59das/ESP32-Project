'use client';

import { useRef, useState } from 'react';

import { urls } from '@/lib/api';
import { copy } from '@/lib/copy';
import { clockTime, itemName, percent } from '@/lib/format';
import { MAX_EVENTS } from '@/lib/reducer';
import type { Event, ItemCount } from '@/lib/types';

import styles from './EventLog.module.css';
import { OUTCOMES } from './outcome';
import { Badge } from './ui/Badge';
import { Button } from './ui/Button';
import { Card } from './ui/Card';
import { Dialog } from './ui/Dialog';
import { EmptyState } from './ui/EmptyState';
import { Skeleton } from './ui/Skeleton';

/** The lossless frame the model classified, enlarged, with the verdict's facts. */
function FrameDialog({
  event,
  items,
  onClose,
}: {
  event: Event | null;
  items: ItemCount[];
  onClose: () => void;
}) {
  const close = useRef<HTMLButtonElement>(null);
  const name = event ? itemName(event, items) : '';
  const outcome = event ? OUTCOMES[event.bin] : null;
  return (
    <Dialog
      open={event !== null}
      onClose={onClose}
      titleId="frame-title"
      title={event ? `${name} at ${clockTime(event.ts)}` : ''}
      initialFocus={close}
      showClose={false}
      wide
      footer={
        <Button ref={close} onClick={onClose}>
          Close
        </Button>
      }
    >
      {event !== null && outcome !== null ? (
        <div className={styles.frameView}>
          {/* eslint-disable-next-line @next/next/no-img-element -- a stored PNG, enlarged */}
          <img
            className={styles.bigFrame}
            src={urls.frame(event.id)}
            width={384}
            height={384}
            alt={`The frame the model classified as ${name.toLowerCase()}, enlarged`}
          />
          <dl className={styles.facts}>
            <dt>Verdict</dt>
            <dd>
              <Badge tone={outcome.tone} icon={outcome.icon}>
                {outcome.counted}
              </Badge>
            </dd>
            <dt>Confidence</dt>
            <dd>{percent(event.confidence)}</dd>
            <dt>{copy.inferenceLabel}</dt>
            <dd>{event.latency_ms} ms</dd>
            <dt>Received</dt>
            <dd>{event.ts} (UTC, bridge clock)</dd>
            <dt>Event</dt>
            <dd>
              {event.id}, run {event.run_id}
            </dd>
          </dl>
        </div>
      ) : null}
    </Dialog>
  );
}

export function EventLog({
  events,
  items,
  latestId,
  loading,
  unavailable,
  className,
}: {
  events: Event[];
  items: ItemCount[];
  /** The newest event that arrived live; its row is highlighted once. */
  latestId: number | null;
  loading: boolean;
  unavailable: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState<Event | null>(null);
  return (
    <Card
      title="Recent items"
      titleId="recent-title"
      note={copy.logCap(MAX_EVENTS)}
      className={className}
      bodyClassName={styles.body}
      busy={loading}
    >
      {loading ? (
        <div className={styles.loading} aria-hidden="true">
          {[0, 1, 2].map((row) => (
            <div key={row} className={styles.loadingRow}>
              <Skeleton width={48} height={48} />
              <Skeleton height="1rem" />
            </div>
          ))}
        </div>
      ) : events.length === 0 ? (
        unavailable ? (
          <p className={styles.unavailable}>{copy.unavailable}</p>
        ) : (
          <EmptyState icon="waiting" title={copy.emptyRecentTitle}>
            <p>{copy.emptyRecent}</p>
          </EmptyState>
        )
      ) : (
        // Named by the table's caption, not the card title, so the scrollable region and the
        // card around it do not share a name.
        <div
          className={styles.scroller}
          role="region"
          aria-labelledby="recent-caption"
          tabIndex={0}
        >
          <table className={styles.table}>
            <caption id="recent-caption" className="visually-hidden">
              Recent verdicts, newest first
            </caption>
            <thead>
              <tr>
                <th scope="col" className={styles.head}>
                  Frame
                </th>
                <th scope="col" className={`${styles.head} ${styles.timeColumn}`}>
                  Time
                </th>
                <th scope="col" className={styles.head}>
                  Verdict
                </th>
                <th scope="col" className={styles.headNumber}>
                  Confidence
                </th>
                <th scope="col" className={`${styles.headNumber} ${styles.wide}`}>
                  Inference
                </th>
              </tr>
            </thead>
            <tbody>
              {events.map((event) => {
                const outcome = OUTCOMES[event.bin];
                const name = itemName(event, items);
                const rowClass =
                  event.id === latestId ? `${styles.row} ${styles.rowNew}` : styles.row;
                return (
                  <tr key={event.id} className={rowClass}>
                    <td className={styles.cell}>
                      {event.has_frame ? (
                        <button
                          type="button"
                          className={styles.thumbButton}
                          onClick={() => setOpen(event)}
                          aria-label={`Show the frame for ${name} at ${clockTime(event.ts)}`}
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element -- a stored PNG */}
                          <img
                            className={styles.thumb}
                            src={urls.frame(event.id)}
                            width={48}
                            height={48}
                            alt=""
                            loading="lazy"
                          />
                        </button>
                      ) : (
                        <span className={styles.noThumb} role="img" aria-label="No frame stored" />
                      )}
                    </td>
                    <td className={`${styles.cell} ${styles.timeColumn}`}>
                      <span className={styles.time}>{clockTime(event.ts)}</span>
                    </td>
                    <td className={styles.cell}>
                      <span className={styles.verdict}>
                        <Badge tone={outcome.tone} icon={outcome.icon}>
                          {outcome.word}
                        </Badge>
                        {event.bin === 'unsure' ? (
                          <span className={styles.sub}>not counted</span>
                        ) : name !== outcome.word ? (
                          <span className={styles.sub}>{name}</span>
                        ) : null}
                        {/* On a phone the time moves under the verdict; only one copy shows. */}
                        <span className={`${styles.sub} ${styles.timeInline}`}>
                          {clockTime(event.ts)}
                        </span>
                      </span>
                    </td>
                    <td className={styles.number}>{percent(event.confidence)}</td>
                    <td className={`${styles.number} ${styles.wide}`}>{event.latency_ms} ms</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <FrameDialog event={open} items={items} onClose={() => setOpen(null)} />
    </Card>
  );
}
