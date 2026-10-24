// The camera's path through the story. Keys sit at chapter positions (0, 1, 2 ... with
// fractions in between); between two keys the camera follows a smooth curve through the
// neighbouring keys, and it dwells near each key so the words beside it can be read.

import { type V3, clamp01, mix, smootherstep } from './math';

export interface Key {
  /** Chapter position the key belongs to. */
  at: number;
  pos: V3;
  /** Where the camera looks. */
  look: V3;
  /** Vertical field of view in degrees. */
  fov: number;
  /** Sideways shift of the picture as a fraction of its width, to make room for text. */
  shift: number;
}

export interface Pose {
  pos: V3;
  look: V3;
  fov: number;
  shift: number;
}

/** Uniform Catmull-Rom between p1 and p2 (p0 and p3 are the neighbours). */
function catmull(p0: number, p1: number, p2: number, p3: number, u: number): number {
  const u2 = u * u;
  const u3 = u2 * u;
  return (
    0.5 *
    (2 * p1 +
      (-p0 + p2) * u +
      (2 * p0 - 5 * p1 + 4 * p2 - p3) * u2 +
      (-p0 + 3 * p1 - 3 * p2 + p3) * u3)
  );
}

function spline(a: V3, b: V3, c: V3, d: V3, u: number): V3 {
  return [
    catmull(a[0], b[0], c[0], d[0], u),
    catmull(a[1], b[1], c[1], d[1], u),
    catmull(a[2], b[2], c[2], d[2], u),
  ];
}

/** Share of each segment during which the camera barely moves, at each end. */
export const DWELL = 0.25;

/**
 * The pose at a chapter position. Keys must be sorted by `at`. Before the first key and after
 * the last the camera stays where that key puts it.
 */
export function poseAt(keys: readonly Key[], chapter: number, dwell = DWELL): Pose {
  const first = keys[0];
  const last = keys[keys.length - 1];
  if (first === undefined || last === undefined) throw new Error('a camera rig needs keys');
  if (chapter <= first.at)
    return { pos: first.pos, look: first.look, fov: first.fov, shift: first.shift };
  if (chapter >= last.at)
    return { pos: last.pos, look: last.look, fov: last.fov, shift: last.shift };

  let i = 0;
  while (i < keys.length - 2 && chapter >= (keys[i + 1] as Key).at) i++;
  const k1 = keys[i] as Key;
  const k2 = keys[i + 1] as Key;
  const k0 = keys[i - 1] ?? k1;
  const k3 = keys[i + 2] ?? k2;

  const raw = clamp01((chapter - k1.at) / (k2.at - k1.at));
  // Dwell at both ends, then ease through the middle.
  const u = smootherstep(dwell, 1 - dwell, raw);
  return {
    pos: spline(k0.pos, k1.pos, k2.pos, k3.pos, u),
    look: spline(k0.look, k1.look, k2.look, k3.look, u),
    fov: mix(k1.fov, k2.fov, u),
    shift: mix(k1.shift, k2.shift, u),
  };
}
