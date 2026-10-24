// A row of towers, one per set of checks. Each tower is lit up to the share of its checks that
// passed: all of it when everything passed, and a red top where something failed. The height of
// a tower says nothing about quality, only the light does, so more tests never look better.

import {
  BoxGeometry,
  Color,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  OctahedronGeometry,
} from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

import { at, easeOutCubic, smoothstep } from '@/lib/scene/math';

import type { Palette } from '../engine/palette';
import { OUTCOME } from '../engine/palette';

export interface PylonSpec {
  label: string;
  passed: number;
  failed: number;
}

const HEIGHT = 7;
const FAIL = new Color(0xe5736a);

export interface Pylons {
  group: Group;
  anchors: Object3D[];
  update(args: { progress: number; time: number; motion: boolean; palette: Palette }): void;
  dispose(): void;
}

export function createPylons(specs: PylonSpec[], spacing = 5.4): Pylons {
  const group = new Group();
  const disposables: { dispose(): void }[] = [];
  const track = <T extends { dispose(): void }>(thing: T): T => {
    disposables.push(thing);
    return thing;
  };
  const shaftGeometry = track(new RoundedBoxGeometry(1.1, HEIGHT, 1.1, 3, 0.12));
  const shaftMaterial = track(
    new MeshStandardMaterial({
      color: 0x16241f,
      metalness: 0.3,
      roughness: 0.1,
      envMapIntensity: 1.8,
      transparent: true,
      opacity: 0.42,
      depthWrite: false,
    }),
  );
  const baseGeometry = track(new RoundedBoxGeometry(2.4, 0.34, 2.4, 3, 0.1));
  const baseMaterial = track(new MeshStandardMaterial({ color: 0x24332e, roughness: 0.75 }));
  const fillGeometry = track(new BoxGeometry(0.62, 1, 0.62));
  const gemGeometry = track(new OctahedronGeometry(0.34, 0));

  const anchors: Object3D[] = [];
  const parts = specs.map((spec, i) => {
    const holder = new Group();
    holder.position.set((i - (specs.length - 1) / 2) * spacing, 0, 0);
    const base = new Mesh(baseGeometry, baseMaterial);
    base.position.y = 0.17;
    base.receiveShadow = true;
    const shaft = new Mesh(shaftGeometry, shaftMaterial);
    shaft.position.y = 0.34 + HEIGHT / 2;
    shaft.castShadow = true;

    const ran = spec.passed + spec.failed;
    const share = ran === 0 ? 0 : spec.passed / ran;
    const lit = new MeshBasicMaterial({ color: OUTCOME.recyclable, toneMapped: false });
    const red = new MeshBasicMaterial({ color: FAIL, toneMapped: false });
    track(lit);
    track(red);
    const fill = new Mesh(fillGeometry, lit);
    const cap = new Mesh(fillGeometry, red);
    const gemMaterial = track(
      new MeshBasicMaterial({
        color: ran === 0 ? 0x8aa097 : spec.failed === 0 ? OUTCOME.recyclable : FAIL,
        toneMapped: false,
      }),
    );
    const gem = new Mesh(gemGeometry, gemMaterial);

    const anchor = new Object3D();
    anchor.position.set(0, HEIGHT + 1.5, 0);
    holder.add(base, shaft, fill, cap, gem, anchor);
    group.add(holder);
    anchors.push(anchor);
    return { fill, cap, gem, share, ran, lit, red, gemMaterial, failed: spec.failed };
  });

  return {
    group,
    anchors,
    update({ progress, time, motion, palette }) {
      const level = Math.min(palette.glowIntensity, 2.2);
      const rise = easeOutCubic(smoothstep(0, 1, progress));
      parts.forEach((p, i) => {
        const delay = i * 0.12;
        const k = easeOutCubic(Math.min(1, Math.max(0, (rise - delay) / (1 - delay + 1e-6))));
        const litHeight = HEIGHT * p.share * k;
        p.fill.visible = litHeight > 0.02;
        p.fill.scale.y = Math.max(0.001, litHeight);
        p.fill.position.y = 0.34 + litHeight / 2;
        // Anything that did not pass is the red part at the top.
        const failHeight = p.ran === 0 ? 0 : HEIGHT * (1 - p.share) * k;
        p.cap.visible = failHeight > 0.02;
        p.cap.scale.y = Math.max(0.001, failHeight);
        p.cap.position.y = 0.34 + litHeight + failHeight / 2;
        p.lit.color.copy(OUTCOME.recyclable).multiplyScalar(level * 0.9);
        p.red.color.copy(FAIL).multiplyScalar(level * 0.9);
        p.gem.position.y = 0.34 + HEIGHT + 0.7 + (motion ? Math.sin(time * 1.4 + i) * 0.12 : 0);
        p.gem.rotation.y = motion ? time * 0.9 + i : 0;
        p.gem.scale.setScalar(0.4 + 0.6 * k);
      });
      void at;
    },
    dispose() {
      for (const d of disposables) d.dispose();
    },
  };
}
