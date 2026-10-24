import type { ReactNode } from 'react';

import { copy } from '@/lib/copy';
import { age } from '@/lib/format';
import { linkTone, type LinkKind, type LinkView } from '@/lib/linkView';
import type { Link, SourceName } from '@/lib/types';

import styles from './LinkStatus.module.css';
import { Badge } from './ui/Badge';
import { Card } from './ui/Card';
import { Icon, type IconName } from './ui/Icon';

const ICONS: Record<LinkKind, IconName> = {
  linked: 'signal',
  simulated: 'simulated',
  reconnecting: 'waiting',
  connecting: 'waiting',
  'not-linked': 'alert',
  'not-responding': 'alert',
  unreachable: 'alert',
};

const sourceNames: Record<SourceName, string> = {
  serial: 'Camera, through the camera bridge',
  sim: 'Simulator',
  replay: 'Replay of a recording',
};

/** Always in the header, so link health is visible from every scroll position. */
export function LinkBadge({ view }: { view: LinkView }) {
  return (
    <Badge tone={linkTone(view.kind)} icon={ICONS[view.kind]}>
      {view.label}
    </Badge>
  );
}

export function LinkPanel({
  view,
  link,
  source,
  heartbeatAgeS,
  lineAgeS,
  run,
  className,
}: {
  view: LinkView;
  link: Link | null;
  source: SourceName | null;
  heartbeatAgeS: number | null;
  lineAgeS: number | null;
  /** The run line and its controls. */
  run: ReactNode;
  className?: string;
}) {
  return (
    <Card title="Link and run" titleId="link-title" className={className}>
      <div className={styles.status}>
        <Badge tone={linkTone(view.kind)} icon={ICONS[view.kind]} size="lg">
          {view.label}
        </Badge>
        <p className={styles.sentence}>{view.sentence}</p>
      </div>
      {view.resets > 0 ? (
        <p className={styles.reset} role="status">
          <Icon name="reset" size={18} />
          <span>{copy.deviceReset(view.resets)}</span>
        </p>
      ) : null}
      <details className={styles.details}>
        <summary className={styles.summary}>Link details</summary>
        <dl className={styles.list}>
          <dt>Source</dt>
          <dd>{source ? sourceNames[source] : 'Unknown'}</dd>
          <dt>Port</dt>
          <dd>{link?.port ?? 'None'}</dd>
          <dt>Last line</dt>
          <dd>{age(lineAgeS)}</dd>
          <dt>Last heartbeat</dt>
          <dd>{age(heartbeatAgeS)}</dd>
          <dt>Board restarts this run</dt>
          <dd>{link?.nano_resets_seen ?? 0}</dd>
          <dt>Dropped lines</dt>
          <dd>{link?.dropped_lines ?? 0}</dd>
          <dt>Frames received</dt>
          <dd>{link?.frames_received ?? 0}</dd>
          <dt>Frame errors</dt>
          <dd>{link?.frame_crc_errors ?? 0}</dd>
          <dt>Bin disagreements</dt>
          <dd>{link?.bin_mismatch ?? 0}</dd>
          <dt>Preview</dt>
          <dd>
            {link?.preview_active ? `${link.preview_fps ?? 0} frames per second` : 'Off, no viewer'}
          </dd>
        </dl>
      </details>
      <div className={styles.run}>{run}</div>
    </Card>
  );
}
