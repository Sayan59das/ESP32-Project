import type { Event, Link, State } from './types';

export interface StreamHandlers {
  onOpen(): void;
  onDown(): void;
  onState(state: State): void;
  onEvent(event: Event): void;
  onLink(link: Link): void;
}

const REOPEN_AFTER_MS = 1000;

/**
 * Subscribe to /api/stream. The browser's EventSource reconnects by itself and resends
 * Last-Event-ID, so the bridge replays exactly what was missed. If the browser gives up
 * (readyState CLOSED), a fresh EventSource is opened; the bridge then starts it with a full
 * `state`, and the caller refetches the log on `onOpen`. Returns a function that closes it.
 */
export function openStream(url: string, handlers: StreamHandlers): () => void {
  let source: EventSource | null = null;
  let reopen: ReturnType<typeof setTimeout> | null = null;
  let closed = false;

  const connect = () => {
    const es = new EventSource(url);
    source = es;
    es.addEventListener('open', () => handlers.onOpen());
    es.addEventListener('state', (e) => handlers.onState(JSON.parse(e.data) as State));
    es.addEventListener('event', (e) => handlers.onEvent(JSON.parse(e.data) as Event));
    es.addEventListener('link', (e) => handlers.onLink(JSON.parse(e.data) as Link));
    es.addEventListener('error', () => {
      handlers.onDown();
      if (es.readyState === EventSource.CLOSED && !closed) {
        es.close();
        reopen = setTimeout(connect, REOPEN_AFTER_MS);
      }
    });
  };

  connect();
  return () => {
    closed = true;
    if (reopen !== null) clearTimeout(reopen);
    source?.close();
  };
}
