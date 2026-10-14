'use client';

import { useCallback, useEffect, useReducer, useRef, useState } from 'react';

import { ApiError, api, urls } from './api';
import { initialState, reducer } from './reducer';
import { openStream } from './sse';

const TICK_MS = 1000;
export const ANNOUNCE_GAP_MS = 2000;

/** Live console state: the SSE stream folded through the reducer, a one-second clock for
 *  ages and the paused flag, and a counter that bumps each time the stream (re)opens. */
export function useConsole() {
  const [state, dispatch] = useReducer(reducer, initialState);
  const [now, setNow] = useState(() => Date.now());
  const [connection, setConnection] = useState(0);

  useEffect(() => {
    let disposed = false;

    const loadEvents = async () => {
      try {
        const events = await api.events();
        const first = events[0];
        if (!disposed && first !== undefined) {
          dispatch({ type: 'events-loaded', runId: first.run_id, events });
        }
      } catch (error) {
        if (!(error instanceof ApiError && error.status === null)) throw error;
        // A network error here means the stream is about to report itself down too.
      }
    };

    const probe = async () => {
      try {
        await api.health();
      } catch (error) {
        if (!(error instanceof ApiError)) throw error;
        if (!disposed) dispatch({ type: 'backend-unreachable' });
      }
    };

    const close = openStream(urls.stream, {
      onOpen: () => {
        dispatch({ type: 'stream-open', at: Date.now() });
        setConnection((n) => n + 1);
        void loadEvents();
      },
      onDown: () => {
        dispatch({ type: 'stream-down', at: Date.now() });
        void probe();
      },
      onState: (s) => dispatch({ type: 'state', state: s, at: Date.now() }),
      onEvent: (event) => dispatch({ type: 'event', event, at: Date.now() }),
      onLink: (link) => dispatch({ type: 'link', link, at: Date.now() }),
    });
    const tick = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => {
      disposed = true;
      close();
      clearInterval(tick);
    };
  }, []);

  return { state, dispatch, now, connection };
}

/** One polite announcement at a time, at most one every two seconds; the newest wins. */
export function useAnnouncer(): [string, (message: string) => void] {
  const [text, setText] = useState('');
  const lastAt = useRef(0);
  const pending = useRef<ReturnType<typeof setTimeout> | null>(null);

  const announce = useCallback((message: string) => {
    if (pending.current !== null) clearTimeout(pending.current);
    const wait = Math.max(0, lastAt.current + ANNOUNCE_GAP_MS - Date.now());
    pending.current = setTimeout(() => {
      pending.current = null;
      lastAt.current = Date.now();
      setText(message);
    }, wait);
  }, []);

  useEffect(
    () => () => {
      if (pending.current !== null) clearTimeout(pending.current);
    },
    [],
  );

  return [text, announce];
}
