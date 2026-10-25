// Scraps of paper and wrapper drifting through the air round the camera: the weather of a
// recycling yard. They wrap around a box that follows the camera, so there are always some in
// view, and they shrink to nothing at the edge of the box and close to the lens, so none
// pops in or fills the picture.

import {
  Color,
  DoubleSide,
  InstancedMesh,
  MeshStandardMaterial,
  Object3D,
  PlaneGeometry,
  type PerspectiveCamera,
} from 'three';

import { at, mulberry32, smoothstep } from '@/lib/scene/math';

const COLOURS = [0xf1f3f0, 0xe3d9c3, 0xcfd8d2, 0xa8c9b6, 0xf1f3f0, 0xd9c9a0, 0xe4e8e6, 0x9fb7c9];

export interface Scraps {
  mesh: InstancedMesh;
  update(camera: PerspectiveCamera, time: number): void;
  setCount(count: number): void;
  dispose(): void;
}

export function createScraps(count: number, box: number, seed = 41): Scraps {
  const rand = mulberry32(seed);
  const geometry = new PlaneGeometry(0.34, 0.24);
  const material = new MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.85,
    metalness: 0,
    side: DoubleSide,
  });
  const mesh = new InstancedMesh(geometry, material, count);
  mesh.frustumCulled = false;
  mesh.castShadow = false;
  mesh.receiveShadow = false;

  const tint = new Color();
  // Where each starts inside the box (0 to 1), how it drifts, spins and how big it is.
  const seeds = new Float32Array(count * 8);
  for (let i = 0; i < count; i++) {
    for (let k = 0; k < 8; k++) seeds[i * 8 + k] = rand();
    tint.set(at(COLOURS, Math.floor(rand() * COLOURS.length)));
    mesh.setColorAt(i, tint);
  }

  const dummy = new Object3D();
  const wrap = (v: number) => v - Math.floor(v);

  return {
    mesh,
    update(camera, time) {
      const cx = camera.position.x;
      const cy = camera.position.y;
      const cz = camera.position.z;
      const height = box * 0.45;
      const live = mesh.count;
      for (let i = 0; i < live; i++) {
        const o = i * 8;
        const s0 = seeds[o] as number;
        const s1 = seeds[o + 1] as number;
        const s2 = seeds[o + 2] as number;
        const s3 = seeds[o + 3] as number;
        const s4 = seeds[o + 4] as number;
        const s5 = seeds[o + 5] as number;
        const s6 = seeds[o + 6] as number;
        const s7 = seeds[o + 7] as number;

        // A slow fall on a breeze, and a lazy sway, wrapped round the box.
        const ux = wrap(s0 + time * (0.004 + s3 * 0.006) + Math.sin(time * 0.31 + s2 * 40) * 0.004);
        const uy = wrap(s1 - time * (0.006 + s4 * 0.008));
        const uz = wrap(s2 + time * (0.002 + s5 * 0.004));
        const x = (ux - 0.5) * box;
        const y = (uy - 0.5) * height + height * 0.12;
        const z = (uz - 0.5) * box;
        const distance = Math.hypot(x, y, z);

        // Small at the edge of the box and very close to the lens; full size in between.
        const edge = 1 - smoothstep(0.34 * box, 0.5 * box, Math.hypot(x, z));
        const vertical = 1 - smoothstep(0.38 * height, 0.5 * height, Math.abs(y));
        const near = smoothstep(2.5, 6, distance);
        const size = (0.7 + s6 * 0.9) * edge * vertical * near;

        dummy.position.set(cx + x, cy + y, cz + z);
        dummy.rotation.set(
          time * (0.4 + s3) + s7 * 6.28,
          time * (0.3 + s4 * 0.8) + s6 * 6.28,
          time * (0.2 + s5 * 0.6),
        );
        dummy.scale.setScalar(Math.max(0.0001, size));
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
      }
      mesh.instanceMatrix.needsUpdate = true;
    },
    setCount(next) {
      mesh.count = Math.min(next, count);
    },
    dispose() {
      geometry.dispose();
      material.dispose();
      mesh.dispose();
    },
  };
}
