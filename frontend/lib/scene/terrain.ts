import { fbm2, smoothstep } from './math';

/** Distance from the middle within which the yard is flat, for the sets to stand on. */
export const YARD = 62;

/**
 * The height of the ground at a point. Level concrete across the yard, then low earth banks
 * that rise a little at a distance, so the edge of the world is not a straight line.
 */
export function terrainHeight(x: number, z: number): number {
  const r = Math.hypot(x, z);
  const banks = (fbm2(x * 0.011 + 40, z * 0.011 + 11, 4, 2) - 0.45) * 2;
  const ridges = Math.pow(1 - Math.abs(fbm2(x * 0.0065, z * 0.0065, 3, 9) * 2 - 1), 3);
  const far = smoothstep(YARD + 38, 190, r);
  return far * (banks * 7 + ridges * 11);
}
