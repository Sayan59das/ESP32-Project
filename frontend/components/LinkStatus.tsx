'use client';

import { useId, useState } from 'react';

import { copy } from '@/lib/copy';
import { age } from '@/lib/format';
import type { LinkLabel } from '@/lib/reducer';
import type { Link, SourceName } from '@/lib/types';

import styles from './LinkStatus.module.css';

const sourceNames: Record<SourceName, string> = {
  serial: 'Nano over USB serial',
  sim: 'Simulator',
  replay: 'Replay of a recording',
};

const labels: Record<LinkLabel, string> = {
  open: copy.linkOpen,
  closed: copy.linkClosed,
  stale: copy.heartbeatStale,
};

export function LinkStatus({
  link,
  label,
  source,
  heartbeatAgeS,
  lineAgeS,
}: {
  link: Link | null;
  label: LinkLabel;
  source: SourceName | null;
  heartbeatAgeS: number | null;
  lineAgeS: number | null;
}) {
  const [open, setOpen] = useState(false);
  const detailsId = useId();
  const lit = link?.source_open ?? false;

  return (
    <div
      className={styles.status}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) setOpen(false);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') setOpen(false);
      }}
    >
      <button
        type="button"
        className={styles.button}
        aria-expanded={open}
        aria-controls={detailsId}
        onClick={() => setOpen((v) => !v)}
      >
        <span className={lit ? styles.lampOn : styles.lampOff} aria-hidden="true" />
        {labels[label]}
      </button>
      <div id={detailsId} className={styles.details} hidden={!open}>
        <dl className={styles.list}>
          <dt>Source</dt>
          <dd>{source ? sourceNames[source] : 'Unknown'}</dd>
          <dt>Port</dt>
          <dd>{link?.port ?? 'None'}</dd>
          <dt>Last line</dt>
          <dd>{age(lineAgeS)}</dd>
          <dt>Last heartbeat</dt>
          <dd>{age(heartbeatAgeS)}</dd>
          <dt>Nano resets this run</dt>
          <dd>{link?.nano_resets_seen ?? 0}</dd>
          <dt>Dropped lines</dt>
          <dd>{link?.dropped_lines ?? 0}</dd>
          <dt>Frames received</dt>
          <dd>{link?.frames_received ?? 0}</dd>
          <dt>Frame errors</dt>
          <dd>{link?.frame_crc_errors ?? 0}</dd>
          <dt>Preview</dt>
          <dd>
            {link?.preview_active ? `${link.preview_fps ?? 0} frames per second` : 'Off, no viewer'}
          </dd>
        </dl>
      </div>
    </div>
  );
}
