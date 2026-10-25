// The ground: a concrete recycling yard. Slabs with joints, safety paint round the machine,
// crates, drums, flattened cans and wrappers lying about, and farther out, bales and containers
// and the silos and sheds of the plant, fading into the haze.
//
// Nothing here is data. It is the place the story happens in, and it is the same for every
// reader, so it is made from a fixed seed.

import {
  BoxGeometry,
  BufferAttribute,
  type BufferGeometry,
  CanvasTexture,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  Group,
  InstancedMesh,
  LatheGeometry,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  PlaneGeometry,
  RepeatWrapping,
  SRGBColorSpace,
  Vector2,
} from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

import { at, fbm2, hash2, mulberry32 } from '@/lib/scene/math';
import { terrainHeight } from '@/lib/scene/terrain';

import type { Palette } from '../engine/palette';
import { grainNormalMap } from '../engine/textures';

export interface Terrain {
  group: Group;
  update(palette: Palette): void;
  dispose(): void;
}

export interface TerrainOptions {
  /** How finely the ground is cut. It is flat where the story happens, so this can be coarse. */
  segments: number;
  /** True where nothing may be left lying: it is the camera's way, or something stands there. */
  keepClear: (x: number, z: number) => boolean;
}

/** Side of one tile of the slab texture, in metres: four slabs. */
const TILE = 16;

/** Concrete slabs with joints between them, as a texture that multiplies the ground colour. */
function slabTexture(): CanvasTexture {
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const half = size / 2;
    for (let sy = 0; sy < 2; sy++) {
      for (let sx = 0; sx < 2; sx++) {
        // Each slab is a little lighter or darker than its neighbours.
        const v = 0.93 + hash2(sx, sy, 5) * 0.07;
        ctx.fillStyle = `rgb(${Math.round(v * 255)},${Math.round(v * 255)},${Math.round(v * 255)})`;
        ctx.fillRect(sx * half, sy * half, half, half);
      }
    }
    // A fine speckle, so the surface is not a flat colour up close.
    const data = ctx.getImageData(0, 0, size, size);
    for (let i = 0; i < size * size; i++) {
      const n = 1 - hash2(i % size, (i / size) | 0, 3) * 0.07;
      data.data[i * 4] = data.data[i * 4]! * n;
      data.data[i * 4 + 1] = data.data[i * 4 + 1]! * n;
      data.data[i * 4 + 2] = data.data[i * 4 + 2]! * n;
    }
    ctx.putImageData(data, 0, 0);
    // The joints.
    ctx.fillStyle = 'rgba(30,38,34,0.34)';
    for (const at of [0, half]) {
      ctx.fillRect(at - 2, 0, 4, size);
      ctx.fillRect(0, at - 2, size, 4);
    }
    ctx.fillRect(size - 2, 0, 2, size);
    ctx.fillRect(0, size - 2, size, 2);
  }
  const texture = new CanvasTexture(canvas);
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = 8;
  return texture;
}

const CRATE_COLOURS = [0x4f7fa3, 0x4f9a73, 0xc9a035, 0x7a8a93, 0xa8584c];
const CARDBOARD_COLOURS = [0xb8956a, 0xa8865c, 0xc4a478];
const DRUM_COLOURS = [0x3c6f9a, 0x3d8a63, 0x8a8f94, 0xb9503f];
const CAN_COLOURS = [0xe8eef0, 0xc7d3d9, 0xd9a5a0, 0x9fc4d9, 0xb9d6c3];
const WRAPPER_COLOURS = [0xd9dde0, 0xe0c27a, 0xc79ad0, 0xa9d0c4];
const BALE_COLOURS = [0x8d9aa2, 0x7d94a6, 0xb5a283, 0x7e9a8a, 0xa3a9a6];
const CONTAINER_COLOURS = [0x9c4f45, 0x4b6f94, 0x4f8068, 0xd0d4d2, 0xb08a3c];
const PLANT_COLOURS = [0xaeb8b4, 0x9aa8a8, 0xc3c8c4, 0x8f9d9a];

export function createTerrain(options: TerrainOptions): Terrain {
  const { segments, keepClear } = options;
  const group = new Group();
  const size = 520;
  const geometry = new PlaneGeometry(size, size, segments, segments);
  geometry.rotateX(-Math.PI / 2);
  const position = geometry.getAttribute('position');
  const shade = new Float32Array(position.count * 3);
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i);
    const z = position.getZ(i);
    position.setY(i, terrainHeight(x, z));
    // Stains and wear across the ground, so it is not one flat colour at a distance.
    const v = 0.9 + 0.2 * fbm2(x * 0.05, z * 0.05, 4, 21);
    shade[i * 3] = v;
    shade[i * 3 + 1] = v;
    shade[i * 3 + 2] = v;
  }
  geometry.setAttribute('color', new BufferAttribute(shade, 3));
  geometry.computeVertexNormals();
  const uv = geometry.getAttribute('uv');
  for (let i = 0; i < uv.count; i++) uv.setXY(i, position.getX(i) / TILE, position.getZ(i) / TILE);

  const slabs = slabTexture();
  const grain = grainNormalMap(256, 0.6, 9);
  grain.repeat.set(5, 5);
  const material = new MeshStandardMaterial({
    color: new Color(0xc3cbc6),
    map: slabs,
    vertexColors: true,
    roughness: 0.96,
    metalness: 0,
    normalMap: grain,
  });
  material.normalScale.set(0.18, 0.18);
  const ground = new Mesh(geometry, material);
  ground.receiveShadow = true;
  group.add(ground);

  const rand = mulberry32(12);
  const dummy = new Object3D();
  const tint = new Color();
  const instanced: InstancedMesh[] = [];

  /** An instanced mesh of `count` things, each placed by `place`, which returns false to skip. */
  function scatter(
    shape: BufferGeometry,
    shapeMaterial: MeshStandardMaterial,
    count: number,
    palette: readonly number[],
    place: (index: number) => boolean,
  ): InstancedMesh {
    const mesh = new InstancedMesh(shape, shapeMaterial, count);
    let placed = 0;
    let guard = 0;
    while (placed < count && guard++ < count * 40) {
      dummy.position.set(0, 0, 0);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.set(1, 1, 1);
      if (!place(placed)) continue;
      dummy.updateMatrix();
      mesh.setMatrixAt(placed, dummy.matrix);
      tint.set(at(palette, Math.floor(rand() * palette.length)));
      const v = 0.88 + rand() * 0.2;
      mesh.setColorAt(placed, tint.multiplyScalar(v));
      placed++;
    }
    mesh.count = placed;
    mesh.frustumCulled = false;
    group.add(mesh);
    instanced.push(mesh);
    return mesh;
  }

  const plastic = new MeshStandardMaterial({ color: 0xffffff, roughness: 0.55, metalness: 0.02 });
  const board = new MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, metalness: 0 });
  const metal = new MeshStandardMaterial({ color: 0xffffff, roughness: 0.38, metalness: 0.85 });
  const foilLooks = new MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.34,
    metalness: 0.6,
    side: DoubleSide,
  });
  const bulk = new MeshStandardMaterial({ color: 0xffffff, roughness: 0.88, metalness: 0 });

  /** A random spot on the ground between two distances from the middle, where it is allowed. */
  const spot = (from: number, to: number): [number, number] | null => {
    const angle = rand() * Math.PI * 2;
    const radius = from + Math.pow(rand(), 0.8) * (to - from);
    const x = Math.cos(angle) * radius;
    const z = Math.sin(angle) * radius;
    return keepClear(x, z) ? null : [x, z];
  };

  // -- what is lying about on the near ground ----------------------------------------------
  const blockGeometry = new BoxGeometry(1, 1, 1);
  const crateGeometry = new RoundedBoxGeometry(1, 1, 1, 2, 0.08);
  scatter(crateGeometry, plastic, 16, CRATE_COLOURS, () => {
    const s = spot(9, 58);
    if (!s) return false;
    const w = 0.7 + rand() * 0.5;
    const h = 0.45 + rand() * 0.35;
    dummy.position.set(s[0], terrainHeight(s[0], s[1]) + h / 2, s[1]);
    dummy.rotation.y = rand() * Math.PI * 2;
    dummy.scale.set(w, h, w * (0.8 + rand() * 0.3));
    return true;
  });
  scatter(blockGeometry, board, 12, CARDBOARD_COLOURS, () => {
    const s = spot(8, 58);
    if (!s) return false;
    const w = 0.55 + rand() * 0.5;
    const h = 0.35 + rand() * 0.4;
    dummy.position.set(s[0], terrainHeight(s[0], s[1]) + h / 2, s[1]);
    dummy.rotation.y = rand() * Math.PI * 2;
    dummy.scale.set(w, h, w * (0.7 + rand() * 0.5));
    return true;
  });
  const drumGeometry = new CylinderGeometry(0.4, 0.4, 1, 20);
  scatter(drumGeometry, metal, 9, DRUM_COLOURS, () => {
    const s = spot(10, 58);
    if (!s) return false;
    const h = 0.8 + rand() * 0.25;
    const fallen = rand() < 0.2;
    dummy.position.set(s[0], terrainHeight(s[0], s[1]) + (fallen ? 0.4 : h / 2), s[1]);
    dummy.scale.set(1, h, 1);
    if (fallen) dummy.rotation.set(Math.PI / 2, 0, rand() * Math.PI * 2);
    else dummy.rotation.y = rand() * Math.PI * 2;
    return true;
  });
  // Flattened cans and wrappers.
  const canProfile = [
    [0, 0],
    [0.26, 0],
    [0.3, 0.04],
    [0.31, 0.1],
    [0.31, 0.8],
    [0.3, 0.85],
    [0.26, 0.9],
    [0.24, 0.93],
    [0.24, 0.96],
    [0, 0.96],
  ].map(([x, y]) => new Vector2(x as number, (y as number) - 0.48));
  const canGeometry = new LatheGeometry(canProfile, 14);
  scatter(canGeometry, metal, 46, CAN_COLOURS, () => {
    const s = spot(5.5, 52);
    if (!s) return false;
    const k = 0.5 + rand() * 0.3;
    dummy.position.set(s[0], terrainHeight(s[0], s[1]) + 0.15 * k, s[1]);
    dummy.rotation.set(Math.PI / 2, rand() * 6, rand() * 6);
    dummy.scale.set(k, k * (0.55 + rand() * 0.45), k);
    return true;
  });
  const wrapperGeometry = new PlaneGeometry(0.5, 0.34, 6, 4);
  const wp = wrapperGeometry.getAttribute('position');
  for (let i = 0; i < wp.count; i++) {
    wp.setZ(i, (fbm2(wp.getX(i) * 7 + 2, wp.getY(i) * 7 + 5, 3, 6) - 0.5) * 0.12);
  }
  wrapperGeometry.computeVertexNormals();
  scatter(wrapperGeometry, foilLooks, 44, WRAPPER_COLOURS, () => {
    const s = spot(5.5, 52);
    if (!s) return false;
    const k = 0.7 + rand() * 0.7;
    dummy.position.set(s[0], terrainHeight(s[0], s[1]) + 0.04, s[1]);
    dummy.rotation.set(-Math.PI / 2 + (rand() - 0.5) * 0.3, 0, rand() * Math.PI * 2);
    dummy.scale.setScalar(k);
    return true;
  });

  // -- the yard, farther out -----------------------------------------------------------------
  // Compressed bales, in stacks of one to three: each bale after the first sits on the last.
  const stack = { left: 0, x: 0, z: 0, yaw: 0, level: 0 };
  scatter(blockGeometry, bulk, 66, BALE_COLOURS, () => {
    const w = 2.2 + rand() * 0.4;
    const h = 1.2;
    if (stack.left === 0) {
      const s = spot(72, 112);
      if (!s) return false;
      stack.x = s[0];
      stack.z = s[1];
      stack.yaw = rand() * Math.PI;
      stack.level = 0;
      stack.left = 1 + Math.floor(rand() * 3);
    }
    dummy.position.set(
      stack.x + (rand() - 0.5) * 0.2,
      terrainHeight(stack.x, stack.z) + h / 2 + stack.level * h,
      stack.z + (rand() - 0.5) * 0.2,
    );
    dummy.rotation.y = stack.yaw + (rand() - 0.5) * 0.12;
    dummy.scale.set(w, h, w * 0.7);
    stack.level++;
    stack.left--;
    return true;
  });
  scatter(blockGeometry, bulk, 22, CONTAINER_COLOURS, () => {
    const s = spot(80, 130);
    if (!s) return false;
    const yaw = rand() * Math.PI;
    dummy.position.set(s[0], terrainHeight(s[0], s[1]) + 1.3 + (rand() < 0.35 ? 2.6 : 0), s[1]);
    dummy.rotation.y = yaw;
    dummy.scale.set(6.1, 2.6, 2.45);
    return true;
  });
  scatter(blockGeometry, bulk, 9, PLANT_COLOURS, () => {
    const s = spot(105, 175);
    if (!s) return false;
    const w = 22 + rand() * 20;
    const h = 8 + rand() * 6;
    dummy.position.set(s[0], terrainHeight(s[0], s[1]) + h / 2 - 0.5, s[1]);
    dummy.rotation.y = rand() * Math.PI;
    dummy.scale.set(w, h, 12 + rand() * 10);
    return true;
  });
  const siloGeometry = new CylinderGeometry(1, 1, 1, 28);
  const silos = scatter(siloGeometry, bulk, 9, PLANT_COLOURS, () => {
    const s = spot(100, 170);
    if (!s) return false;
    const r = 4.5 + rand() * 3.5;
    const h = 22 + rand() * 22;
    dummy.position.set(s[0], terrainHeight(s[0], s[1]) + h / 2 - 0.5, s[1]);
    dummy.scale.set(r, h, r);
    return true;
  });
  // A roof on each silo.
  const roofGeometry = new ConeGeometry(1, 0.45, 28);
  const roofs = new InstancedMesh(roofGeometry, bulk, silos.count);
  const m = new Matrix4();
  for (let i = 0; i < silos.count; i++) {
    silos.getMatrixAt(i, m);
    dummy.matrix.copy(m);
    dummy.matrix.decompose(dummy.position, dummy.quaternion, dummy.scale);
    const r = dummy.scale.x;
    const h = dummy.scale.y;
    dummy.position.y += h / 2 + 0.1 * r;
    dummy.scale.set(r, r, r);
    dummy.updateMatrix();
    roofs.setMatrixAt(i, dummy.matrix);
    silos.getColorAt(i, tint);
    roofs.setColorAt(i, tint.multiplyScalar(0.85));
  }
  roofs.frustumCulled = false;
  group.add(roofs);
  instanced.push(roofs);
  // Tall thin chimneys, so the skyline has something to rise above the sheds.
  scatter(siloGeometry, bulk, 4, PLANT_COLOURS, () => {
    const s = spot(130, 185);
    if (!s) return false;
    const h = 58 + rand() * 24;
    dummy.position.set(s[0], terrainHeight(s[0], s[1]) + h / 2 - 0.5, s[1]);
    dummy.scale.set(1.5, h, 1.5);
    return true;
  });

  // -- safety paint round the machine -------------------------------------------------------
  const paint = new MeshBasicMaterial({
    color: new Color(0xd9a91a),
    transparent: true,
    opacity: 0.9,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  const dashGeometry = new PlaneGeometry(0.7, 0.22);
  dashGeometry.rotateX(-Math.PI / 2);
  const DASHES = 60;
  const dashes = new InstancedMesh(dashGeometry, paint, DASHES);
  for (let i = 0; i < DASHES; i++) {
    const angle = (i / DASHES) * Math.PI * 2;
    dummy.position.set(Math.cos(angle) * 7, 0.03, Math.sin(angle) * 7);
    dummy.rotation.set(0, -angle + Math.PI / 2, 0);
    dummy.scale.set(1, 1, 1);
    dummy.updateMatrix();
    dashes.setMatrixAt(i, dummy.matrix);
  }
  group.add(dashes);
  instanced.push(dashes);

  return {
    group,
    update(palette) {
      material.color.copy(palette.ground);
      paint.color.copy(palette.paint);
    },
    dispose() {
      geometry.dispose();
      material.dispose();
      slabs.dispose();
      grain.dispose();
      for (const g of [
        crateGeometry,
        drumGeometry,
        canGeometry,
        wrapperGeometry,
        blockGeometry,
        siloGeometry,
        roofGeometry,
        dashGeometry,
      ]) {
        g.dispose();
      }
      for (const mat of [plastic, board, metal, foilLooks, bulk, paint]) mat.dispose();
      for (const mesh of instanced) mesh.dispose();
    },
  };
}
