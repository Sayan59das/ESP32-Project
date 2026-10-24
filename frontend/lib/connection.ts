// The header notice while live data is not flowing. Derived from the stream and the health
// probe only; a healthy console has no notice at all.
import { API_BASE } from './api';
import { copy } from './copy';
import { duration } from './format';
import { isPaused, type ConsoleState } from './reducer';

export interface ConnectionNotice {
  kind: 'unreachable' | 'paused';
  title: string;
  body: string;
}

export function connectionNotice(state: ConsoleState, now: number): ConnectionNotice | null {
  // Counts on screen while the stream is down are the last ones received, and say so.
  const kept = state.server !== null ? ` ${copy.lastKnownCounts}` : '';
  if (state.backendUnreachable) {
    return {
      kind: 'unreachable',
      title: copy.unreachableTitle,
      body: `${copy.backendUnreachable(API_BASE)} ${copy.retrying}${kept}`,
    };
  }
  if (state.downSince !== null && isPaused(state, now)) {
    return {
      kind: 'paused',
      title: copy.pausedTitle,
      body: `${copy.pausedBody(duration((now - state.downSince) / 1000))}${kept}`,
    };
  }
  return null;
}
