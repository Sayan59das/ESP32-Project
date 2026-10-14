'use client';

import { useEffect, useRef } from 'react';

import { API_BASE } from '@/lib/api';
import { copy } from '@/lib/copy';
import { binWord, itemName, percent, shortTime } from '@/lib/format';
import { heartbeatAge, isPaused, lastLineAge, linkLabel } from '@/lib/reducer';
import type { ItemCount } from '@/lib/types';
import { useAnnouncer, useConsole } from '@/lib/useConsole';

import { BinReadout } from './BinReadout';
import { CameraWindow } from './CameraWindow';
import styles from './Console.module.css';
import { EventLog } from './EventLog';
import { ItemBreakdown } from './ItemBreakdown';
import { LastVerdict } from './LastVerdict';
import { LinkStatus } from './LinkStatus';
import { RunControls } from './RunControls';
import { SiteHeader } from './SiteHeader';

export function Console() {
  const { state, dispatch, now, connection } = useConsole();
  const [announcement, announce] = useAnnouncer();
  const server = state.server;
  const items: ItemCount[] = server?.by_item ?? [];
  const paused = isPaused(state, now);
  const runSource = server?.run.source ?? null;

  // Announce each new item, throttled by the announcer. Names come from the latest table.
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const latestEvent = state.latest?.event;
  useEffect(() => {
    if (latestEvent === undefined) return;
    const name = itemName(latestEvent, itemsRef.current);
    announce(
      latestEvent.bin === 'unsure'
        ? `Unsure item, not counted, ${percent(latestEvent.confidence)} confidence.`
        : `${name}, ${binWord(latestEvent.bin).toLowerCase()}, ${percent(latestEvent.confidence)} confidence.`,
    );
  }, [latestEvent, announce]);

  const banner =
    runSource === 'sim' ? copy.simulatedBanner : runSource === 'replay' ? copy.replayBanner : null;

  // Paused wins in the header; the camera window carries the "start it with make dev" hint.
  let streamNote: string | null = null;
  if (paused) streamNote = copy.streamPaused;
  else if (state.backendUnreachable) streamNote = copy.backendUnreachable(API_BASE);

  return (
    <div className={styles.page}>
      <SiteHeader current="console" banner={banner}>
        {server ? (
          <p className={styles.run}>
            Run {server.run.id}, started {shortTime(server.run.started_at)}
          </p>
        ) : null}
        {streamNote !== null ? <p className={styles.streamNote}>{streamNote}</p> : null}
        <LinkStatus
          link={server?.link ?? null}
          label={linkLabel(state, now)}
          source={runSource}
          heartbeatAgeS={heartbeatAge(state, now)}
          lineAgeS={lastLineAge(state, now)}
        />
        <RunControls
          announce={announce}
          onStarted={(next) => dispatch({ type: 'state', state: next, at: Date.now() })}
        />
      </SiteHeader>
      <main className={styles.main}>
        <h1 className="visually-hidden">EcoSort Edge console</h1>
        <div className={styles.stage}>
          <CameraWindow
            link={server?.link ?? null}
            runSource={runSource}
            backendUnreachable={state.backendUnreachable}
            latest={state.latest}
            items={items}
            connection={connection}
            now={now}
          />
          <BinReadout counts={server?.counts ?? null} stale={paused} />
        </div>
        <LastVerdict className={styles.last} event={server?.last_event ?? null} items={items} />
        <ItemBreakdown className={styles.items} items={items} counts={server?.counts ?? null} />
        <EventLog
          className={styles.recent}
          events={state.events}
          items={items}
          latestId={state.latest?.event.id ?? null}
        />
      </main>
      <p className="visually-hidden" aria-live="polite">
        {announcement}
      </p>
    </div>
  );
}
