// Small, pure helpers shared by the 3D scenes. No three.js and no DOM in here, so they can be
// tested in plain node.

export type V3 = readonly [number, number, number];

export const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);

export const mix = (a: number, b: number, t: number): number => a + (b - a) * t;

export const mixV3 = (a: V3, b: V3, t: number): V3 => [
  mix(a[0], b[0], t),
  mix(a[1], b[1], t),
  mix(a[2], b[2], t),
];

/** 0 below `a`, 1 above `b`, smooth in between. */
export function smoothstep(a: number, b: number, x: number): number {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
}

/** Like smoothstep with zero first and second derivatives at both ends: calmer camera moves. */
export function smootherstep(a: number, b: number, x: number): number {
  const t = clamp01((x - a) / (b - a));
  return t * t * t * (t * (t * 6 - 15) + 10);
}

export const easeOutCubic = (t: number): number => 1 - Math.pow(1 - clamp01(t), 3);

export const easeInOutCubic = (t: number): number => {
  const x = clamp01(t);
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
};

/** 1 inside [a, b], rising over `fade` before it and falling over `fade` after it. */
export function window01(x: number, a: number, b: number, fade: number): number {
  return smoothstep(a - fade, a, x) * (1 - smoothstep(b, b + fade, x));
}

/**
 * Frame-rate independent smoothing: moves `current` toward `target`, covering a fraction of
 * the remaining distance per second set by `rate` (higher is snappier).
 */
export function damp(current: number, target: number, rate: number, dt: number): number {
  return mix(current, target, 1 - Math.exp(-rate * dt));
}

/** An element of an array that is known to be there. */
export function at<T>(items: readonly T[], index: number): T {
  const item = items[index];
  if (item === undefined) throw new Error(`no item at ${index}`);
  return item;
}

/**
 * A value that moves through `points` ([x, y], sorted by x) with an ease between each pair:
 * flat at the first and last, smooth in between. Used to schedule things along the story.
 */
export function curve01(points: readonly (readonly [number, number])[], x: number): number {
  const first = points[0];
  const last = points[points.length - 1];
  if (first === undefined || last === undefined) return 0;
  if (x <= first[0]) return first[1];
  if (x >= last[0]) return last[1];
  for (let i = 0; i < points.length - 1; i++) {
    const a = at(points, i);
    const b = at(points, i + 1);
    if (x < b[0]) return mix(a[1], b[1], smoothstep(a[0], b[0], x));
  }
  return last[1];
}

/** Deterministic pseudo-random numbers: the same seed always gives the same scene. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A repeatable pseudo-random number in [0, 1) for a pair of integers. */
export function hash2(x: number, y: number, seed: number): number {
  let h =
    Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1) ^ Math.imul(seed | 0, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Smooth value noise in [0, 1]. */
export function noise2(x: number, y: number, seed = 0): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const fx = x - xi;
  const fy = y - yi;
  const u = fx * fx * (3 - 2 * fx);
  const v = fy * fy * (3 - 2 * fy);
  const a = hash2(xi, yi, seed);
  const b = hash2(xi + 1, yi, seed);
  const c = hash2(xi, yi + 1, seed);
  const d = hash2(xi + 1, yi + 1, seed);
  return mix(mix(a, b, u), mix(c, d, u), v);
}

/** Fractal noise in [0, 1): several octaves of noise2. */
export function fbm2(x: number, y: number, octaves = 5, seed = 0): number {
  let sum = 0;
  let amp = 0.5;
  let freq = 1;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += amp * noise2(x * freq, y * freq, seed + i * 31);
    norm += amp;
    amp *= 0.5;
    freq *= 2.03;
  }
  return sum / norm;
}
