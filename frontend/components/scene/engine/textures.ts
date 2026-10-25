// Textures made in code, so the 3D world needs no downloads. A tiling grain gives the moulded
// plastic and the concrete a surface; the real camera frames are the only image files, and they are the
// project's own training photos, served from this site.

import {
  DataTexture,
  LinearFilter,
  LinearMipmapLinearFilter,
  NearestFilter,
  NoColorSpace,
  RGBAFormat,
  RepeatWrapping,
  SRGBColorSpace,
  type Texture,
  TextureLoader,
  UnsignedByteType,
} from 'three';

import { hash2, mix } from '@/lib/scene/math';

/** Value noise that repeats every `period` cells, so the texture tiles without a seam. */
function tileNoise(x: number, y: number, period: number, seed: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const fx = x - xi;
  const fy = y - yi;
  const u = fx * fx * (3 - 2 * fx);
  const v = fy * fy * (3 - 2 * fy);
  const wrap = (n: number) => ((n % period) + period) % period;
  const a = hash2(wrap(xi), wrap(yi), seed);
  const b = hash2(wrap(xi + 1), wrap(yi), seed);
  const c = hash2(wrap(xi), wrap(yi + 1), seed);
  const d = hash2(wrap(xi + 1), wrap(yi + 1), seed);
  return mix(mix(a, b, u), mix(c, d, u), v);
}

/** Height values in [0, 1] that tile. `cells` is the size of the biggest features. */
function heights(size: number, cells: number, octaves: number, seed: number): Float32Array {
  const out = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let sum = 0;
      let amp = 0.5;
      let norm = 0;
      let period = cells;
      for (let o = 0; o < octaves; o++) {
        sum += amp * tileNoise((x / size) * period, (y / size) * period, period, seed + o * 17);
        norm += amp;
        amp *= 0.55;
        period *= 2;
      }
      out[y * size + x] = sum / norm;
    }
  }
  return out;
}

function finish(data: Uint8Array, size: number, colour: boolean): DataTexture {
  const texture = new DataTexture(data, size, size, RGBAFormat, UnsignedByteType);
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  texture.magFilter = LinearFilter;
  texture.minFilter = LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.anisotropy = 4;
  texture.colorSpace = colour ? SRGBColorSpace : NoColorSpace;
  texture.needsUpdate = true;
  return texture;
}

/** A tiling normal map: fine grain with a few larger dents, like worn stone. */
export function grainNormalMap(size = 256, strength = 2.4, seed = 3): DataTexture {
  const h = heights(size, 6, 5, seed);
  const data = new Uint8Array(size * size * 4);
  const at = (x: number, y: number) =>
    h[((y + size) % size) * size + ((x + size) % size)] as number;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (at(x + 1, y) - at(x - 1, y)) * strength * size * 0.05;
      const dy = (at(x, y + 1) - at(x, y - 1)) * strength * size * 0.05;
      const len = Math.hypot(dx, dy, 1);
      const i = (y * size + x) * 4;
      data[i] = Math.round(((-dx / len) * 0.5 + 0.5) * 255);
      data[i + 1] = Math.round(((-dy / len) * 0.5 + 0.5) * 255);
      data[i + 2] = Math.round(((1 / len) * 0.5 + 0.5) * 255);
      data[i + 3] = 255;
    }
  }
  return finish(data, size, false);
}

/** A tiling roughness map between `low` and `high`, for a surface that is not uniformly matt. */
export function grainRoughnessMap(size = 256, low = 0.7, high = 1, seed = 11): DataTexture {
  const h = heights(size, 4, 4, seed);
  const data = new Uint8Array(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    const v = Math.round(mix(low, high, h[i] as number) * 255);
    data[i * 4] = v;
    data[i * 4 + 1] = v;
    data[i * 4 + 2] = v;
    data[i * 4 + 3] = 255;
  }
  return finish(data, size, false);
}

/** A tiling grey grain for colour variation: multiply it into a base colour. */
export function grainColourMap(size = 256, spread = 0.18, seed = 5): DataTexture {
  const h = heights(size, 5, 5, seed);
  const data = new Uint8Array(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    const v = Math.round(mix(1 - spread, 1, h[i] as number) * 255);
    data[i * 4] = v;
    data[i * 4 + 1] = v;
    data[i * 4 + 2] = v;
    data[i * 4 + 3] = 255;
  }
  return finish(data, size, true);
}

/**
 * One of the project's own 160 by 120 training frames, drawn with hard pixel edges: this is
 * what the classifier sees, not a smoothed picture of it.
 */
export function loadFrame(url: string, onLoad: () => void): Texture {
  const texture = new TextureLoader().load(url, onLoad);
  texture.magFilter = NearestFilter;
  texture.minFilter = NearestFilter;
  texture.generateMipmaps = false;
  texture.colorSpace = SRGBColorSpace;
  return texture;
}
