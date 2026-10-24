// The photographs the model was taught with, as a field of tiles: one tile per frame, in a block
// for each class. The frames held back to test it stand a little apart and are raised, each with a
// small light on top: green where the model got it right, red where it did not.

import {
  BoxGeometry,
  Color,
  Group,
  InstancedMesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
} from 'three';

import { easeOutCubic, mix, smoothstep } from '@/lib/scene/math';

import type { Palette } from '../engine/palette';
import { OUTCOME } from '../engine/palette';

export interface FieldSpec {
  recyclable: { training: number; validation: number; correct: number };
  trash: { training: number; validation: number; correct: number };
}

export interface Field {
  group: Group;
  anchors: { recyclable: Object3D; trash: Object3D; held: Object3D };
  update(args: { progress: number; time: number; motion: boolean; palette: Palette }): void;
  dispose(): void;
}

const PITCH_X = 0.98;
const PITCH_Z = 0.78;
const FAIL = new Color(0xe5736a);

interface Tile {
  x: number;
  z: number;
  held: boolean;
  right: boolean;
  trash: boolean;
}

/** One class's block: training frames from the back, then a gap, then the held-back frames. */
function layout(
  counts: { training: number; validation: number; correct: number },
  trash: boolean,
  centreX: number,
): { tiles: Tile[]; width: number } {
  const total = counts.training + counts.validation;
  const cols = Math.max(1, Math.ceil(Math.sqrt(total * 0.85)));
  const tiles: Tile[] = [];
  const left = centreX - ((cols - 1) * PITCH_X) / 2;
  for (let i = 0; i < counts.training; i++) {
    tiles.push({
      x: left + (i % cols) * PITCH_X,
      z: -Math.floor(i / cols) * PITCH_Z,
      held: false,
      right: true,
      trash,
    });
  }
  const frontZ = PITCH_Z * 1.7;
  for (let i = 0; i < counts.validation; i++) {
    tiles.push({
      x: left + (i % cols) * PITCH_X,
      z: frontZ + Math.floor(i / cols) * PITCH_Z,
      held: true,
      right: i < counts.correct,
      trash,
    });
  }
  return { tiles, width: cols * PITCH_X };
}

export function createField(spec: FieldSpec): Field {
  const group = new Group();
  const disposables: { dispose(): void }[] = [];
  const track = <T extends { dispose(): void }>(thing: T): T => {
    disposables.push(thing);
    return thing;
  };

  const a = layout(spec.recyclable, false, 0);
  const b = layout(spec.trash, true, 0);
  const gap = 2.6;
  const shiftA = -(a.width / 2 + gap / 2);
  const shiftB = b.width / 2 + gap / 2;
  const tiles = [
    ...a.tiles.map((t) => ({ ...t, x: t.x + shiftA })),
    ...b.tiles.map((t) => ({ ...t, x: t.x + shiftB })),
  ];
  const held = tiles.filter((t) => t.held);

  const tileGeometry = track(new BoxGeometry(0.84, 0.07, 0.64));
  const tileMaterial = track(new MeshStandardMaterial({ roughness: 0.55, metalness: 0.05 }));
  const mesh = new InstancedMesh(tileGeometry, tileMaterial, tiles.length);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.frustumCulled = false;
  const tint = new Color();
  tiles.forEach((t, i) => {
    tint.copy(t.trash ? OUTCOME.trash : OUTCOME.recyclable);
    if (t.held) tint.lerp(new Color(0xffffff), 0.35);
    mesh.setColorAt(i, tint);
  });
  group.add(mesh);

  const capGeometry = track(new BoxGeometry(0.34, 0.1, 0.34));
  const capMaterial = track(new MeshBasicMaterial({ toneMapped: false }));
  const caps = new InstancedMesh(capGeometry, capMaterial, Math.max(1, held.length));
  caps.frustumCulled = false;
  held.forEach((t, i) => caps.setColorAt(i, t.right ? OUTCOME.recyclable : FAIL));
  caps.count = held.length;
  group.add(caps);

  const frontOf = (rows: Tile[]): number => rows.reduce((m, t) => Math.max(m, t.z), 0);
  const anchors = {
    recyclable: new Object3D(),
    trash: new Object3D(),
    held: new Object3D(),
  };
  anchors.recyclable.position.set(shiftA, 3.2, -4.5);
  anchors.trash.position.set(shiftB, 3.2, -6);
  anchors.held.position.set(shiftB, 1.9, frontOf(b.tiles) + 0.4);
  group.add(anchors.recyclable, anchors.trash, anchors.held);

  const dummy = new Object3D();
  const total = tiles.length;
  let drawn = -1;

  return {
    group,
    anchors,
    update({ progress, time, motion, palette }) {
      const level = Math.min(palette.glowIntensity, 2.2);
      capMaterial.color.setScalar(level * 0.9);
      // Dealt out from the back to the front. Redrawn only while something is moving.
      const settled = progress >= 1 && !motion;
      if (settled && drawn === 1) return;
      drawn = settled ? 1 : 0;
      let heldIndex = 0;
      tiles.forEach((t, i) => {
        const delay = (i / total) * 0.55;
        const k = easeOutCubic(smoothstep(delay, delay + 0.4, progress));
        const rise = t.held ? 0.5 : 0;
        const bob = t.held && motion ? Math.sin(time * 1.6 + i * 0.7) * 0.05 : 0;
        dummy.position.set(t.x, mix(-1.2, rise + bob, k), t.z);
        dummy.scale.setScalar(Math.max(0.0001, k));
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
        if (t.held) {
          dummy.position.y += 0.2;
          dummy.updateMatrix();
          caps.setMatrixAt(heldIndex++, dummy.matrix);
        }
      });
      mesh.instanceMatrix.needsUpdate = true;
      caps.instanceMatrix.needsUpdate = true;
    },
    dispose() {
      for (const d of disposables) d.dispose();
      mesh.dispose();
      caps.dispose();
    },
  };
}
