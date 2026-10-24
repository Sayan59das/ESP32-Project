// Link health in words. Derived from what the bridge reports; nothing here is guessed.
import { API_BASE } from './api';
import { copy } from './copy';
import { age, duration } from './format';
import { heartbeatAge, isPaused, linkLabel, portBusy, type ConsoleState } from './reducer';

export type LinkKind =
  'linked' | 'reconnecting' | 'connecting' | 'not-linked' | 'not-responding' | 'unreachable';

export interface LinkView {
  kind: LinkKind;
  /** Badge text. */
  label: string;
  /** One plain sentence: what is happening and, for a fault, what to do. */
  sentence: string;
  /** Restarts of the camera board seen in this run. */
  resets: number;
}

const LABELS: Record<LinkKind, string> = {
  linked: copy.linkOpen,
  reconnecting: copy.linkReconnecting,
  connecting: copy.chip.connecting,
  'not-linked': copy.linkClosed,
  'not-responding': copy.heartbeatStale,
  unreachable: copy.linkUnreachable,
};

function linkedSentence(
  fps: number | null,
  active: boolean,
  heartbeat: number | null,
  previewPaused: boolean,
): string {
  const frames = previewPaused
    ? copy.linkPreviewPaused
    : active && fps !== null && fps > 0
      ? `Frames arriving at ${fps} per second.`
      : 'Waiting for preview frames.';
  return `${frames} Last heartbeat ${age(heartbeat)}.`;
}

/** `previewPaused`: the viewer paused the picture on this screen, so no preview frames
 *  arriving is expected rather than something to wait for. */
export function linkView(state: ConsoleState, now: number, previewPaused = false): LinkView {
  const link = state.server?.link ?? null;
  const resets = link?.nano_resets_seen ?? 0;
  const make = (kind: LinkKind, sentence: string): LinkView => ({
    kind,
    label: LABELS[kind],
    sentence,
    resets,
  });

  if (state.backendUnreachable) return make('unreachable', copy.backendUnreachable(API_BASE));
  if (isPaused(state, now)) return make('reconnecting', copy.streamPaused);
  if (link === null) return make('connecting', 'Connecting to the classifier service.');
  if (!link.source_open)
    return make('not-linked', portBusy(link) ? copy.portBusy : copy.nanoNotLinked);
  const heartbeat = heartbeatAge(state, now);
  if (linkLabel(state, now) === 'stale' && heartbeat !== null) {
    return make(
      'not-responding',
      `No heartbeat for ${duration(heartbeat)}. ${copy.cameraNotResponding}`,
    );
  }
  return make(
    'linked',
    linkedSentence(link.preview_fps, link.preview_active, heartbeat, previewPaused),
  );
}

/** Faults get the alert tone; waiting states stay neutral. */
export function linkTone(kind: LinkKind): 'signal' | 'neutral' | 'alert' {
  if (kind === 'linked') return 'signal';
  if (kind === 'reconnecting' || kind === 'connecting') return 'neutral';
  return 'alert';
}
