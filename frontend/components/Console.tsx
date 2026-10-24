'use client';

import { useEffect, useRef } from 'react';

import { verdictAnnouncement } from '@/lib/announce';
import { connectionNotice } from '@/lib/connection';
import { copy } from '@/lib/copy';
import { itemName } from '@/lib/format';
import { linkView } from '@/lib/linkView';
import { heartbeatAge, isPaused, lastLineAge, linkLabel } from '@/lib/reducer';
import type { ItemCount } from '@/lib/types';
import { useAnnouncer, useConsole } from '@/lib/useConsole';

import { BinReadout } from './BinReadout';
import { CameraWindow } from './CameraWindow';
import { ConnectionBanner } from './ConnectionBanner';
import styles from './Console.module.css';
import { EventLog } from './EventLog';
import { ItemBreakdown } from './ItemBreakdown';
import { LastVerdict } from './LastVerdict';
import { LinkBadge, LinkPanel } from './LinkStatus';
import { RunControls } from './RunControls';
import { SiteHeader } from './SiteHeader';

export function Console() {
  const { state, dispatch, now, connection } = useConsole();
  const [announcement, announce] = useAnnouncer();
  const server = state.server;
  const items: ItemCount[] = server?.by_item ?? [];
  const paused = isPaused(state, now);
  const runSource = server?.run.source ?? null;
  const link = linkView(state, now);
  const notice = connectionNotice(state, now);
  // Before the first state: loading while the service may still answer, unavailable once
  // it is known not to. Skeletons never stand in for data that is not coming.
  const unavailable = server === null && state.backendUnreachable;
  const loading = server === null && !unavailable;
  const latestId = state.latest?.event.id ?? null;

  // Announce each live verdict once the state that includes it has arrived, so the counts
  // spoken are the server's. Names come from the latest table.
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const announced = useRef<number | null>(null);
  const latestEvent = state.latest?.event;
  const counts = server?.counts;
  const serverLastId = server?.last_event?.id;
  useEffect(() => {
    if (latestEvent === undefined || counts === undefined) return;
    if (serverLastId !== latestEvent.id || announced.current === latestEvent.id) return;
    announced.current = latestEvent.id;
    announce(verdictAnnouncement(latestEvent, itemName(latestEvent, itemsRef.current), counts));
  }, [latestEvent, counts, serverLastId, announce]);

  // A fault in the link is announced once when it starts, not on every tick, and the
  // return of live updates is announced once too.
  const lastKind = useRef(link.kind);
  useEffect(() => {
    const was = lastKind.current;
    if (link.kind === was) return;
    lastKind.current = link.kind;
    if (link.kind !== 'linked' && link.kind !== 'connecting') {
      announce(`${link.label}. ${link.sentence}`);
    } else if (was === 'reconnecting' || was === 'unreachable') {
      announce(copy.liveResumed);
    }
  }, [link.kind, link.label, link.sentence, announce]);

  return (
    <div className={styles.page}>
      <SiteHeader
        current="console"
        source={runSource}
        meta={
          <>
            {server ? (
              <p className={styles.run}>
                Run {server.run.id}, {server.counts.total_sorted} sorted
              </p>
            ) : null}
            <LinkBadge view={link} />
          </>
        }
        notice={notice !== null ? <ConnectionBanner notice={notice} /> : null}
      />
      <main className={styles.main}>
        <h1 className="visually-hidden">EcoSort Edge console</h1>
        <div className={styles.stage}>
          <CameraWindow
            link={server?.link ?? null}
            linkLabel={linkLabel(state, now)}
            paused={paused}
            runSource={runSource}
            backendUnreachable={state.backendUnreachable}
            latest={state.latest}
            items={items}
            connection={connection}
            now={now}
          />
          <BinReadout
            counts={server?.counts ?? null}
            stale={paused || state.backendUnreachable}
            unavailable={unavailable}
          />
        </div>
        <div className={styles.side}>
          <LastVerdict
            className={styles.last}
            event={server?.last_event ?? null}
            items={items}
            loading={loading}
            unavailable={unavailable}
            fresh={latestId !== null && server?.last_event?.id === latestId}
          />
          <ItemBreakdown
            className={styles.items}
            items={items}
            counts={server?.counts ?? null}
            unavailable={unavailable}
          />
          <LinkPanel
            className={styles.link}
            view={link}
            link={server?.link ?? null}
            source={runSource}
            heartbeatAgeS={heartbeatAge(state, now)}
            lineAgeS={lastLineAge(state, now)}
            run={
              <RunControls
                run={server?.run ?? null}
                onStarted={(next) => dispatch({ type: 'state', state: next, at: Date.now() })}
              />
            }
          />
        </div>
        <EventLog
          className={styles.log}
          events={state.events}
          items={items}
          latestId={latestId}
          loading={loading}
          unavailable={unavailable}
        />
      </main>
      <p className="visually-hidden" aria-live="polite">
        {announcement}
      </p>
    </div>
  );
}
