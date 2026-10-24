// What the camera window says about the counting rhythm. Only states the console can see
// for itself: the wire contract carries no "calibrating" or "item in view" signal, so the
// chip never claims either.
import type { LinkLabel } from './reducer';
import type { Event, Link } from './types';

export type CameraState =
  | 'unreachable' // the classifier service does not answer
  | 'reconnecting' // the live stream dropped; it reopens by itself
  | 'connecting' // no state from the service yet
  | 'not-linked' // the service is up, the camera link is not
  | 'not-responding' // the link is open but heartbeats stopped
  | 'counted' // a verdict arrived a moment ago
  | 'unsure' // a verdict arrived a moment ago, too unsure to count
  | 'waiting' // linked, no frames yet
  | 'no-frames' // linked, still no frames after a while
  | 'ready'; // linked and frames are flowing: place an item

export interface CameraInputs {
  backendUnreachable: boolean;
  paused: boolean;
  link: Link | null;
  linkLabel: LinkLabel;
  /** The verdict held on screen, if any. */
  verdict: Event | null;
  /** Whether preview frames are reaching the page. */
  framesFlowing: boolean;
  /** Whether frames have been missing long enough to say so. */
  framesOverdue: boolean;
}

export function cameraState(i: CameraInputs): CameraState {
  if (i.backendUnreachable) return 'unreachable';
  if (i.paused) return 'reconnecting';
  if (i.link === null) return 'connecting';
  if (!i.link.source_open) return 'not-linked';
  if (i.linkLabel === 'stale') return 'not-responding';
  if (i.verdict !== null) return i.verdict.bin === 'unsure' ? 'unsure' : 'counted';
  if (!i.framesFlowing) return i.framesOverdue ? 'no-frames' : 'waiting';
  return 'ready';
}

/** Faults stop the counting loop; the camera window shows a message for them. */
export function isFault(state: CameraState): boolean {
  return (
    state === 'unreachable' ||
    state === 'not-linked' ||
    state === 'not-responding' ||
    state === 'no-frames'
  );
}
