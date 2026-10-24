import { fbm2, smoothstep } from './math';

/** Distance from the middle within which the ground is a calm plateau for the sets to stand on. */
export const PLATEAU = 62;

/**
 * The height of the ground at a point. A nearly flat plateau in the middle, where everything
 * stands, rising into ridges and hills that disappear into the mist at a distance.
 */
export function terrainHeight(x: number, z: number): number {
  const r = Math.hypot(x, z);
  const hills = (fbm2(x * 0.011 + 40, z * 0.011 + 11, 5, 2) - 0.45) * 2;
  const ridges = Math.pow(1 - Math.abs(fbm2(x * 0.0065, z * 0.0065, 4, 9) * 2 - 1), 3);
  const detail = (fbm2(x * 0.08, z * 0.08, 3, 5) - 0.5) * 2;
  const far = smoothstep(PLATEAU, 150, r);
  return far * (hills * 26 + ridges * 52) + (1 - far) * detail * 0.22;
}
