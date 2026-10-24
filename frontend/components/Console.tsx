'use client';

import { useEffect, useRef } from 'react';

import { copy } from '@/lib/copy';
import { binWord, itemName, percent } from '@/lib/format';
import { linkView } from '@/lib/linkView';
import { heartbeatAge, isPaused, lastLineAge, linkLabel } from '@/lib/reducer';
import type { ItemCount } from '@/lib/types';
import { useAnnouncer, useConsole } from '@/lib/useConsole';

import { BinReadout } from './BinReadout';
import { CameraWindow } from './CameraWindow';
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
  const loading = server === null;

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

  // A fault in the link is announced once when it starts, not on every tick.
  const lastKind = useRef(link.kind);
  useEffect(() => {
    if (link.kind === lastKind.current) return;
    lastKind.current = link.kind;
    if (link.kind !== 'linked' && link.kind !== 'connecting')
      announce(`${link.label}. ${link.sentence}`);
  }, [link.kind, link.label, link.sentence, announce]);

  // Paused wins in the header; the camera window carries the next step for other faults.
  const notice = paused ? copy.streamPaused : state.backendUnreachable ? link.sentence : null;

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
        notice={notice !== null ? <p className={styles.notice}>{notice}</p> : null}
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
          <BinReadout counts={server?.counts ?? null} stale={paused} />
        </div>
        <div className={styles.side}>
          <LastVerdict
            className={styles.last}
            event={server?.last_event ?? null}
            items={items}
            loading={loading}
          />
          <ItemBreakdown className={styles.items} items={items} counts={server?.counts ?? null} />
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
                announce={announce}
                onStarted={(next) => dispatch({ type: 'state', state: next, at: Date.now() })}
              />
            }
          />
        </div>
        <EventLog
          className={styles.log}
          events={state.events}
          items={items}
          latestId={state.latest?.event.id ?? null}
          loading={loading}
        />
      </main>
      <p className="visually-hidden" aria-live="polite">
        {announcement}
      </p>
    </div>
  );
}
