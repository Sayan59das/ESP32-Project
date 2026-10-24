// The ground: a calm plateau for the sets, ridges and hills fading into the mist, scattered
// stones for scale, and faint instrument markings around the middle.

import {
  BufferAttribute,
  Color,
  DoubleSide,
  Group,
  IcosahedronGeometry,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  PlaneGeometry,
  Quaternion,
  RingGeometry,
  Vector3,
} from 'three';

import { fbm2, mulberry32 } from '@/lib/scene/math';
import { terrainHeight } from '@/lib/scene/terrain';

import type { Palette } from '../engine/palette';
import { grainNormalMap } from '../engine/textures';

export interface Terrain {
  group: Group;
  update(palette: Palette): void;
  dispose(): void;
}

export function createTerrain(segments: number): Terrain {
  const group = new Group();
  const size = 460;
  const geometry = new PlaneGeometry(size, size, segments, segments);
  geometry.rotateX(-Math.PI / 2);
  const position = geometry.getAttribute('position');
  const shade = new Float32Array(position.count * 3);
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i);
    const z = position.getZ(i);
    position.setY(i, terrainHeight(x, z));
    // Variation across the ground, so it reads as ground and not as a painted plane.
    const v = 0.8 + 0.24 * fbm2(x * 0.05, z * 0.05, 4, 21) + 0.08 * fbm2(x * 0.4, z * 0.4, 2, 4);
    shade[i * 3] = v;
    shade[i * 3 + 1] = v;
    shade[i * 3 + 2] = v;
  }
  geometry.setAttribute('color', new BufferAttribute(shade, 3));
  geometry.computeVertexNormals();
  // Texture coordinates for the surface grain: one tile every 6 metres.
  const uv = geometry.getAttribute('uv');
  for (let i = 0; i < uv.count; i++) uv.setXY(i, position.getX(i) / 6, position.getZ(i) / 6);

  const normalMap = grainNormalMap(256, 1.6, 9);
  const material = new MeshStandardMaterial({
    color: new Color(0xe6ecee),
    vertexColors: true,
    roughness: 0.96,
    metalness: 0,
    normalMap,
  });
  material.normalScale.set(0.7, 0.7);
  const ground = new Mesh(geometry, material);
  ground.receiveShadow = true;
  group.add(ground);

  // Stones, for scale and to catch the light. Kept clear of the lane, the pipeline and the pylons.
  const rand = mulberry32(12);
  const stoneGeometry = new IcosahedronGeometry(1, 1);
  const stonePos = stoneGeometry.getAttribute('position');
  for (let i = 0; i < stonePos.count; i++) {
    const n = 0.78 + 0.45 * fbm2(stonePos.getX(i) * 1.7 + 3, stonePos.getZ(i) * 1.7 + 9, 3, 8);
    stonePos.setXYZ(i, stonePos.getX(i) * n, stonePos.getY(i) * n * 0.7, stonePos.getZ(i) * n);
  }
  stoneGeometry.computeVertexNormals();
  const stoneMaterial = new MeshStandardMaterial({
    color: new Color(0xb8c3c9),
    roughness: 0.9,
    normalMap,
  });
  const stones = new InstancedMesh(stoneGeometry, stoneMaterial, 130);
  stones.castShadow = true;
  stones.receiveShadow = true;
  const dummy = new Object3D();
  const clear = (x: number, z: number) =>
    !(
      (x > 4 && x < 28 && Math.abs(z) < 7) || // the lane and the bins
      (x < -9 && x > -48 && Math.abs(z) < 7) || // the pipeline
      (Math.abs(x) < 9 && z > 24 && z < 42) || // the pylons
      Math.hypot(x, z) < 5.4 // the Sorter
    );
  let placed = 0;
  let guard = 0;
  while (placed < 130 && guard++ < 4000) {
    const angle = rand() * Math.PI * 2;
    const radius = 5 + Math.pow(rand(), 0.7) * 58;
    const x = Math.cos(angle) * radius;
    const z = Math.sin(angle) * radius;
    if (!clear(x, z)) continue;
    const s = 0.12 + Math.pow(rand(), 3) * 0.75;
    dummy.position.set(x, terrainHeight(x, z) + s * 0.25, z);
    dummy.rotation.set(rand() * 3, rand() * 6, rand() * 3);
    dummy.scale.set(s * (0.8 + rand() * 0.6), s, s * (0.8 + rand() * 0.6));
    dummy.updateMatrix();
    stones.setMatrixAt(placed++, dummy.matrix);
  }
  stones.count = placed;
  group.add(stones);

  // Faint measuring rings and ticks around the Sorter: this is an instrument, not a field.
  const marks = new Group();
  const lineMaterial = new MeshBasicMaterial({
    color: new Color(0x26343b),
    transparent: true,
    opacity: 0.28,
    side: DoubleSide,
    depthWrite: false,
  });
  for (const r of [6.2, 9.4, 14.5, 21]) {
    const ring = new Mesh(new RingGeometry(r, r + 0.045, 128), lineMaterial);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.04;
    marks.add(ring);
  }
  const tick = new RingGeometry(6.2, 6.9, 1, 1, 0, 0.012);
  const ticks = new InstancedMesh(tick, lineMaterial, 72);
  const matrix = new Matrix4();
  const q = new Quaternion();
  const up = new Vector3(1, 0, 0);
  for (let i = 0; i < 72; i++) {
    q.setFromAxisAngle(new Vector3(0, 1, 0), (i / 72) * Math.PI * 2);
    matrix.compose(
      new Vector3(0, 0.045, 0),
      q.multiply(new Quaternion().setFromAxisAngle(up, -Math.PI / 2)),
      new Vector3(1, 1, 1),
    );
    ticks.setMatrixAt(i, matrix);
  }
  marks.add(ticks);
  group.add(marks);

  return {
    group,
    update(palette) {
      material.color.copy(palette.ground);
      stoneMaterial.color.copy(palette.stone);
      lineMaterial.color.copy(palette.fog).multiplyScalar(0.18);
    },
    dispose() {
      geometry.dispose();
      material.dispose();
      normalMap.dispose();
      stoneGeometry.dispose();
      stoneMaterial.dispose();
      tick.dispose();
      lineMaterial.dispose();
      for (const child of marks.children) if (child instanceof Mesh) child.geometry.dispose();
    },
  };
}
