'use client';

import { useEffect, useRef, useState } from 'react';

import { urls } from '@/lib/api';
import { copy } from '@/lib/copy';
import { binWord, clockTime, itemName, percent } from '@/lib/format';
import type { Event, ItemCount } from '@/lib/types';

import styles from './EventLog.module.css';
import panel from './Panel.module.css';

function FrameDialog({
  event,
  items,
  onClose,
}: {
  event: Event | null;
  items: ItemCount[];
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const el = dialog.current;
    if (el === null) return;
    if (event !== null && !el.open) el.showModal();
    if (event === null && el.open) el.close();
  }, [event]);

  const name = event ? itemName(event, items) : '';
  return (
    // A native modal dialog: the page behind it is inert and Escape closes it.
    <dialog ref={dialog} className={styles.dialog} aria-labelledby="frame-title" onClose={onClose}>
      {event !== null ? (
        <>
          <h2 id="frame-title" className={panel.title}>
            {name} at {clockTime(event.ts)}
          </h2>
          {/* eslint-disable-next-line @next/next/no-img-element -- a stored 96x96 PNG at 4x */}
          <img
            className={`${panel.frame} ${styles.bigFrame}`}
            src={urls.frame(event.id)}
            width={384}
            height={384}
            alt={`The 96 by 96 frame the model classified as ${name.toLowerCase()}, enlarged four times`}
          />
          <dl className={styles.facts}>
            <dt>Bin</dt>
            <dd>{event.bin === 'unsure' ? 'Unsure, not counted' : binWord(event.bin)}</dd>
            <dt>Confidence</dt>
            <dd>{percent(event.confidence)}</dd>
            <dt>Inference</dt>
            <dd>{event.latency_ms} ms on the Nano</dd>
            <dt>Received</dt>
            <dd>{event.ts} (UTC, bridge clock)</dd>
            <dt>Event</dt>
            <dd>
              {event.id}, run {event.run_id}
            </dd>
          </dl>
          <form method="dialog">
            <button type="submit" className={styles.close} autoFocus>
              Close
            </button>
          </form>
        </>
      ) : null}
    </dialog>
  );
}

export function EventLog({
  events,
  items,
  latestId,
  className,
}: {
  events: Event[];
  items: ItemCount[];
  latestId: number | null;
  className?: string;
}) {
  const [open, setOpen] = useState<Event | null>(null);
  return (
    <section
      className={`${panel.panel} ${styles.log} ${className ?? ''}`}
      aria-labelledby="recent-title"
    >
      <div className={styles.header}>
        <h2 id="recent-title" className={panel.title}>
          Recent items
        </h2>
        <a className={styles.export} href={urls.exportCsv} download>
          Export CSV
        </a>
      </div>
      {events.length === 0 ? (
        <p className={panel.empty}>{copy.emptyRecent}</p>
      ) : (
        <div className={styles.scroller} role="region" aria-labelledby="recent-title" tabIndex={0}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th scope="col" className={styles.head}>
                  Frame
                </th>
                <th scope="col" className={styles.head}>
                  Time
                </th>
                <th scope="col" className={styles.head}>
                  Item and bin
                </th>
                <th scope="col" className={styles.headNumber}>
                  Confidence
                </th>
                <th scope="col" className={styles.headNumber}>
                  Inference
                </th>
              </tr>
            </thead>
            <tbody>
              {events.map((event) => {
                const unsure = event.bin === 'unsure';
                const name = itemName(event, items);
                const rowClass = [
                  styles.row,
                  unsure ? styles.rowUnsure : '',
                  event.id === latestId ? styles.rowNew : '',
                ].join(' ');
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
                          {/* eslint-disable-next-line @next/next/no-img-element -- a stored 96x96 PNG */}
                          <img
                            className={`${panel.frame} ${styles.thumb}`}
                            src={urls.frame(event.id)}
                            width={48}
                            height={48}
                            alt=""
                            loading="lazy"
                          />
                        </button>
                      ) : (
                        <span
                          className={`${panel.frameSlot} ${styles.thumb}`}
                          role="img"
                          aria-label="No frame stored"
                        />
                      )}
                    </td>
                    <td className={styles.cell}>{clockTime(event.ts)}</td>
                    <td className={styles.cell}>
                      <span className={styles.itemName}>{name}</span>
                      <span className={styles.binName}>
                        {unsure ? 'Not counted' : binWord(event.bin)}
                      </span>
                    </td>
                    <td className={styles.number}>{percent(event.confidence)}</td>
                    <td className={styles.number}>{event.latency_ms} ms</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <FrameDialog event={open} items={items} onClose={() => setOpen(null)} />
    </section>
  );
}
