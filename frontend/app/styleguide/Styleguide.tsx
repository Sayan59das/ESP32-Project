'use client';

import { useRef, useState } from 'react';

import { ConnectionBanner } from '@/components/ConnectionBanner';
import { SiteHeader } from '@/components/SiteHeader';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Dialog } from '@/components/ui/Dialog';
import { EmptyState } from '@/components/ui/EmptyState';
import { Icon, type IconName } from '@/components/ui/Icon';
import { Skeleton, SkeletonLines } from '@/components/ui/Skeleton';
import { VisuallyHidden } from '@/components/ui/VisuallyHidden';
import { copy } from '@/lib/copy';

import styles from './styleguide.module.css';

const SWATCHES = [
  'ground',
  'surface',
  'surface-sunk',
  'ink',
  'ink-muted',
  'line-strong',
  'recyclable',
  'recyclable-tint',
  'trash',
  'trash-tint',
  'unsure',
  'unsure-tint',
  'signal',
  'alert',
  'video-bed',
];

const ICONS: IconName[] = [
  'recyclable',
  'trash',
  'unsure',
  'camera',
  'ready',
  'inView',
  'counted',
  'waiting',
  'remove',
  'signal',
  'alert',
  'reset',
  'simulated',
  'replay',
  'download',
  'pause',
  'play',
  'plus',
  'close',
  'sun',
  'moon',
  'system',
];

export function Styleguide() {
  const [open, setOpen] = useState(false);
  const keep = useRef<HTMLButtonElement>(null);
  return (
    <div className={styles.page}>
      <SiteHeader current="console" source="sim" />
      <main id="main" className={styles.main}>
        <h1 className={styles.h1}>Tokens and primitives</h1>

        <Card title="Colour" titleId="sg-colour">
          <ul className={styles.swatches}>
            {SWATCHES.map((name) => (
              <li key={name} className={styles.swatch}>
                <span className={styles.chip} style={{ background: `var(--${name})` }} />
                <code>--{name}</code>
              </li>
            ))}
          </ul>
        </Card>

        <Card title="Outcome tiles" titleId="sg-tiles">
          <div className={styles.tiles}>
            <div className={`${styles.tile} ${styles.tileRecyclable}`}>
              <span className={styles.tileLabel}>
                <Icon name="recyclable" /> Recyclable
              </span>
              <span className={styles.counter}>128</span>
            </div>
            <div className={`${styles.tile} ${styles.tileTrash}`}>
              <span className={styles.tileLabel}>
                <Icon name="trash" /> Trash
              </span>
              <span className={styles.counter}>47</span>
            </div>
            <div className={`${styles.tile} ${styles.tileUnsure}`}>
              <span className={styles.tileLabel}>
                <Icon name="unsure" /> Unsure
              </span>
              <span className={styles.counterSmall}>6</span>
            </div>
          </div>
        </Card>

        <Card title="Badges" titleId="sg-badges">
          <div className={styles.row}>
            <Badge tone="recyclable" icon="recyclable">
              Recyclable
            </Badge>
            <Badge tone="trash" icon="trash">
              Trash
            </Badge>
            <Badge tone="unsure" icon="unsure">
              Unsure, not counted
            </Badge>
            <Badge tone="signal" icon="signal">
              Linked
            </Badge>
            <Badge tone="alert" icon="alert">
              Camera not responding
            </Badge>
            <Badge tone="inverse" icon="simulated">
              Simulated data
            </Badge>
            <Badge tone="neutral" icon="waiting">
              Waiting
            </Badge>
          </div>
          <div className={styles.row}>
            <Badge tone="recyclable" icon="recyclable" size="lg">
              Recyclable
            </Badge>
            <Badge tone="unsure" icon="unsure" size="lg">
              Unsure
            </Badge>
          </div>
        </Card>

        <Card title="Buttons" titleId="sg-buttons">
          <div className={styles.row}>
            <Button variant="primary" icon="plus" onClick={() => setOpen(true)}>
              Start new run
            </Button>
            <Button icon="download">Export CSV</Button>
            <Button variant="ghost">Ghost</Button>
            <Button size="sm">Small</Button>
            <Button disabled>Disabled</Button>
          </div>
        </Card>

        <Card title="Loading" titleId="sg-loading" busy>
          <div className={styles.loading}>
            <Skeleton width={96} height={96} />
            <SkeletonLines lines={3} />
          </div>
        </Card>

        <Card title="States" titleId="sg-states">
          <div className={styles.states}>
            <ConnectionBanner
              notice={{
                kind: 'paused',
                title: copy.pausedTitle,
                body: `${copy.pausedBody('12 s')} ${copy.lastKnownCounts}`,
              }}
            />
            <ConnectionBanner
              notice={{
                kind: 'unreachable',
                title: copy.unreachableTitle,
                body: `${copy.backendUnreachable('http://localhost:8000')} ${copy.retrying}`,
              }}
            />
            <EmptyState icon="waiting" title={copy.emptyRecentTitle}>
              <p>{copy.emptyRecent}</p>
            </EmptyState>
            <EmptyState icon="alert" title={copy.linkUnreachable}>
              <p>{copy.unavailable}</p>
            </EmptyState>
          </div>
        </Card>

        <Card title="Icons" titleId="sg-icons">
          <ul className={styles.icons}>
            {ICONS.map((name) => (
              <li key={name}>
                <Icon name={name} size={24} />
                <code>{name}</code>
              </li>
            ))}
          </ul>
        </Card>

        <Card title="Type" titleId="sg-type">
          <p className={styles.display}>Recyclable 0123456789</p>
          <p>
            Body text in Atkinson Hyperlegible Next. Figures are tabular: 1111 and 8888 take the
            same width.
          </p>
          <p className={styles.muted}>Secondary text for notes and captions.</p>
          <VisuallyHidden>Only screen readers hear this.</VisuallyHidden>
        </Card>
      </main>

      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        titleId="sg-dialog-title"
        title="Start a new run?"
        description="This resets the counts on screen. The current run stays saved and in the CSV export."
        initialFocus={keep}
        footer={
          <>
            <Button variant="primary" onClick={() => setOpen(false)}>
              Start new run
            </Button>
            <Button ref={keep} onClick={() => setOpen(false)}>
              Keep current run
            </Button>
          </>
        }
      />
    </div>
  );
}
