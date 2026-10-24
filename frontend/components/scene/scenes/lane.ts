// The sorting lane: a belt, a scan gate, and three places an item can end up. The items are the
// kinds in the project's own training photos (cans, foil packets, phone cases), made in code.
//
// This is an illustration of the process. Every position is a function of where the reader is in
// the story, so scrolling back un-sorts the items, and nothing in here is data.

import {
  BoxGeometry,
  Color,
  DoubleSide,
  Group,
  InstancedMesh,
  LatheGeometry,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  PlaneGeometry,
  ShaderMaterial,
  TorusGeometry,
  TorusKnotGeometry,
  Vector2,
  Vector3,
  AdditiveBlending,
} from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

import { at, clamp01, fbm2, mix, mulberry32, smoothstep } from '@/lib/scene/math';

import type { Palette } from '../engine/palette';
import { OUTCOME } from '../engine/palette';
import { grainNormalMap } from '../engine/textures';

type Kind = 'can' | 'foil' | 'phone' | 'unsure';
type Outcome = 'recyclable' | 'trash' | 'unsure';

interface Item {
  kind: Kind;
  outcome: Outcome;
  /** Index inside its kind's InstancedMesh. */
  slot: number;
  phase: number;
  speed: number;
  /** Position in the sorting order. */
  rank: number;
  rest: Vector3;
  restYaw: number;
  restTilt: number;
  staging: Vector3;
}

const BELT_FROM = 7.2;
const BELT_TO = 19.2;
const GATE_X = 13.4;
const BELT_TOP = 0.5;
const BIN_X = 24.4;
const BIN_Z = { recyclable: -3.7, trash: 3.7, unsure: 0 } as const;
const SORT_START = 3.3;
const SORT_SPAN = 1.5;
const TRANSIT = 0.24;
/** Where on an item's journey it passes under the gate. */
const AT_GATE = 0.3;

const SCAN_VERTEX = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const SCAN_FRAGMENT = /* glsl */ `
  uniform vec3 uColor;
  uniform float uTime;
  uniform float uPulse;
  varying vec2 vUv;
  void main() {
    vec2 p = vUv - 0.5;
    float r = length(p) * 2.0;
    float inside = 1.0 - smoothstep(0.93, 1.0, r);
    // A faint 16 by 12 grid: the picture the model will see is that coarse.
    vec2 g = fract(vUv * vec2(16.0, 12.0));
    float grid = max(1.0 - smoothstep(0.0, 0.05, g.x), 1.0 - smoothstep(0.0, 0.05, g.y));
    float sweep = smoothstep(0.07, 0.0, abs(vUv.y - fract(uTime * 0.32)));
    float ring = smoothstep(0.84, 0.93, r) * (1.0 - smoothstep(0.93, 1.0, r));
    float a = (grid * 0.07 + sweep * 0.42 + ring * 0.45 + uPulse * 0.18) * inside;
    gl_FragColor = vec4(uColor * (1.0 + uPulse * 0.9), a);
  }
`;

export interface Lane {
  group: Group;
  anchors: { gate: Object3D; recyclable: Object3D; trash: Object3D; unsure: Object3D };
  /** Returns how strongly an item is being counted right now, 0 to 1. */
  update(args: { time: number; chapter: number; motion: boolean; palette: Palette }): number;
  dispose(): void;
}

function bin(color: Color, width: number, depth: number, height: number) {
  const group = new Group();
  const wall = new MeshStandardMaterial({
    color,
    roughness: 0.42,
    metalness: 0.25,
    envMapIntensity: 1.3,
    emissive: color,
    emissiveIntensity: 0.12,
  });
  const rimMaterial = new MeshBasicMaterial({
    color: color.clone().multiplyScalar(1.6),
    toneMapped: false,
  });
  const t = 0.14;
  const parts: [number, number, number, number, number, number][] = [
    [0, t / 2, 0, width, t, depth], // floor
    [0, height / 2, -depth / 2 + t / 2, width, height, t],
    [0, height / 2, depth / 2 - t / 2, width, height, t],
    [-width / 2 + t / 2, height / 2, 0, t, height, depth - 2 * t],
    [width / 2 - t / 2, height / 2, 0, t, height, depth - 2 * t],
  ];
  const geometries: BoxGeometry[] = [];
  for (const [x, y, z, w, h, d] of parts) {
    const g = new BoxGeometry(w, h, d);
    geometries.push(g);
    const mesh = new Mesh(g, wall);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  }
  // A glowing lip round the top edge.
  const lips: [number, number, number, number, number, number][] = [
    [0, height + 0.02, -depth / 2 + t / 2, width + 0.02, 0.05, t + 0.02],
    [0, height + 0.02, depth / 2 - t / 2, width + 0.02, 0.05, t + 0.02],
    [-width / 2 + t / 2, height + 0.02, 0, t + 0.02, 0.05, depth - 2 * t],
    [width / 2 - t / 2, height + 0.02, 0, t + 0.02, 0.05, depth - 2 * t],
  ];
  for (const [x, y, z, w, h, d] of lips) {
    const g = new BoxGeometry(w, h, d);
    geometries.push(g);
    const lip = new Mesh(g, rimMaterial);
    lip.position.set(x, y, z);
    group.add(lip);
  }
  return {
    group,
    rim: rimMaterial,
    dispose() {
      for (const g of geometries) g.dispose();
      wall.dispose();
      rimMaterial.dispose();
    },
  };
}

export function createLane(): Lane {
  const group = new Group();
  const rand = mulberry32(31);
  const normalMap = grainNormalMap(256, 1.1, 5);

  // -- belt ---------------------------------------------------------------------------------
  const beltMaterial = new MeshStandardMaterial({
    color: 0x2a3631,
    roughness: 0.8,
    metalness: 0.1,
    normalMap,
  });
  beltMaterial.normalScale.set(0.3, 0.3);
  const belt = new Mesh(new BoxGeometry(BELT_TO - BELT_FROM, 0.4, 2.3), beltMaterial);
  belt.position.set((BELT_FROM + BELT_TO) / 2, BELT_TOP - 0.2, 0);
  belt.castShadow = true;
  belt.receiveShadow = true;
  group.add(belt);

  const railMaterial = new MeshBasicMaterial({ color: 0x9ff0cb, toneMapped: false });
  const railGeometry = new BoxGeometry(BELT_TO - BELT_FROM, 0.06, 0.07);
  for (const z of [-1.16, 1.16]) {
    const rail = new Mesh(railGeometry, railMaterial);
    rail.position.set((BELT_FROM + BELT_TO) / 2, BELT_TOP + 0.01, z);
    group.add(rail);
  }

  // Cross marks on the belt, drifting along it.
  const markGeometry = new BoxGeometry(0.07, 0.02, 1.9);
  const markMaterial = new MeshBasicMaterial({ color: 0x0d1512, transparent: true, opacity: 0.55 });
  const MARKS = 28;
  const marks = new InstancedMesh(markGeometry, markMaterial, MARKS);
  group.add(marks);

  // -- gate ---------------------------------------------------------------------------------
  const gate = new Group();
  gate.position.set(GATE_X, BELT_TOP + 1.85, 0);
  gate.rotation.y = Math.PI / 2;
  const ringGeometry = new TorusGeometry(1.85, 0.1, 20, 96);
  const ringMaterial = new MeshStandardMaterial({
    color: 0x1a2622,
    metalness: 0.9,
    roughness: 0.3,
  });
  const ring = new Mesh(ringGeometry, ringMaterial);
  ring.castShadow = true;
  const glowGeometry = new TorusGeometry(1.7, 0.03, 10, 96);
  const glowMaterial = new MeshBasicMaterial({ color: 0x9ff0cb, toneMapped: false });
  const glowRing = new Mesh(glowGeometry, glowMaterial);
  const sheetGeometry = new PlaneGeometry(3.5, 3.5);
  const sheetMaterial = new ShaderMaterial({
    vertexShader: SCAN_VERTEX,
    fragmentShader: SCAN_FRAGMENT,
    uniforms: {
      uColor: { value: new Color(0x9ff0cb) },
      uTime: { value: 0 },
      uPulse: { value: 0 },
    },
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
    blending: AdditiveBlending,
  });
  const sheet = new Mesh(sheetGeometry, sheetMaterial);
  gate.add(ring, glowRing, sheet);
  group.add(gate);
  const gateAnchor = new Object3D();
  gateAnchor.position.set(GATE_X, BELT_TOP + 3.9, 0);
  group.add(gateAnchor);

  // -- the three places an item can end up --------------------------------------------------
  const recyclableBin = bin(OUTCOME.recyclable.clone().multiplyScalar(0.55), 3.2, 3.2, 1.6);
  recyclableBin.group.position.set(BIN_X, 0, BIN_Z.recyclable);
  const trashBin = bin(OUTCOME.trash.clone().multiplyScalar(0.65), 3.2, 3.2, 1.6);
  trashBin.group.position.set(BIN_X, 0, BIN_Z.trash);
  const unsureTray = bin(OUTCOME.unsure.clone().multiplyScalar(0.7), 2.8, 2.8, 0.55);
  unsureTray.group.position.set(BIN_X, 0, BIN_Z.unsure);
  group.add(recyclableBin.group, trashBin.group, unsureTray.group);
  const anchors = {
    gate: gateAnchor,
    recyclable: new Object3D(),
    trash: new Object3D(),
    unsure: new Object3D(),
  };
  anchors.recyclable.position.set(BIN_X, 2.4, BIN_Z.recyclable);
  anchors.trash.position.set(BIN_X, 2.4, BIN_Z.trash);
  anchors.unsure.position.set(BIN_X, 1.4, BIN_Z.unsure);
  group.add(anchors.recyclable, anchors.trash, anchors.unsure);

  // -- the items ----------------------------------------------------------------------------
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
  ].map(([x, y]) => new Vector2(x, (y as number) - 0.48));
  const canGeometry = new LatheGeometry(canProfile, 32);

  const foilGeometry = new BoxGeometry(0.95, 0.16, 0.64, 16, 3, 12);
  const foil = foilGeometry.getAttribute('position');
  for (let i = 0; i < foil.count; i++) {
    const x = foil.getX(i);
    const y = foil.getY(i);
    const z = foil.getZ(i);
    const u = x / 0.475;
    const w = z / 0.32;
    const sealed = smoothstep(0.78, 0.92, Math.abs(u));
    const belly = (1 - u * u) * (1 - w * w * 0.7);
    const crinkle = (fbm2(x * 9 + 3, z * 9 + 7, 3, 4) - 0.5) * 0.07;
    foil.setY(i, Math.sign(y) * (0.015 + (0.1 * belly + crinkle) * (1 - sealed * 0.9)));
  }
  foilGeometry.computeVertexNormals();

  const phoneGeometry = new RoundedBoxGeometry(0.5, 0.95, 0.09, 3, 0.04);
  const unsureGeometry = new TorusKnotGeometry(0.2, 0.07, 96, 12, 2, 3);

  const canMaterial = new MeshStandardMaterial({
    color: 0xffffff,
    metalness: 0.95,
    roughness: 0.3,
  });
  const foilMaterial = new MeshStandardMaterial({
    color: 0xffffff,
    metalness: 0.85,
    roughness: 0.34,
  });
  const phoneMaterial = new MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.4,
    metalness: 0.1,
  });
  const unsureMaterial = new MeshStandardMaterial({
    color: OUTCOME.unsure,
    roughness: 0.35,
    metalness: 0.2,
    emissive: OUTCOME.unsure,
    emissiveIntensity: 0.2,
  });

  const counts: Record<Kind, number> = { can: 7, foil: 6, phone: 5, unsure: 2 };
  const meshes: Record<Kind, InstancedMesh> = {
    can: new InstancedMesh(canGeometry, canMaterial, counts.can),
    foil: new InstancedMesh(foilGeometry, foilMaterial, counts.foil),
    phone: new InstancedMesh(phoneGeometry, phoneMaterial, counts.phone),
    unsure: new InstancedMesh(unsureGeometry, unsureMaterial, counts.unsure),
  };
  const palettes: Record<Kind, number[]> = {
    can: [0xe8eef0, 0xc7d3d9, 0xd9a5a0, 0x9fc4d9, 0xf1f4f5, 0xb9d6c3, 0xe8eef0],
    foil: [0xd9dde0, 0xe0c27a, 0xc79ad0, 0xd9dde0, 0xa9d0c4, 0xe0c27a],
    phone: [0x161b1e, 0x1d2840, 0x3a1d22, 0x161b1e, 0x24302b],
    unsure: [0xffffff, 0xffffff],
  };
  const tint = new Color();
  const items: Item[] = [];
  const slotOf: Record<Kind, number> = { can: 0, foil: 0, phone: 0, unsure: 0 };
  const outcomeOf: Record<Kind, Outcome> = {
    can: 'recyclable',
    foil: 'trash',
    phone: 'trash',
    unsure: 'unsure',
  };
  for (const kind of Object.keys(counts) as Kind[]) {
    for (let n = 0; n < counts[kind]; n++) {
      const slot = slotOf[kind]++;
      tint.set(at(palettes[kind], slot));
      meshes[kind].setColorAt(slot, tint);
      items.push({
        kind,
        outcome: outcomeOf[kind],
        slot,
        phase: rand(),
        speed: 0.12 + rand() * 0.1,
        rank: 0,
        rest: new Vector3(),
        restYaw: rand() * Math.PI * 2,
        restTilt: (rand() - 0.5) * 0.5,
        staging: new Vector3(2.2 + rand() * 4.8, 1.6 + rand() * 3.2, (rand() - 0.5) * 6.6),
      });
    }
  }
  // A shuffled sorting order, so the three outcomes arrive mixed, as they would at a real bin.
  const order = items.map((_, i) => i).sort(() => rand() - 0.5);
  order.forEach((index, rank) => {
    at(items, index).rank = rank;
  });
  // Where each item lies once it is in its place.
  const filled: Record<Outcome, number> = { recyclable: 0, trash: 0, unsure: 0 };
  for (const item of [...items].sort((a, b) => a.rank - b.rank)) {
    const k = filled[item.outcome]++;
    const cols = 3;
    const floor = item.outcome === 'unsure' ? 0.3 : 0.28;
    item.rest.set(
      BIN_X + ((k % cols) - 1) * 0.78 + (rand() - 0.5) * 0.25,
      floor + Math.floor(k / (cols * cols)) * 0.62 + (item.kind === 'phone' ? 0.1 : 0.4),
      BIN_Z[item.outcome] + ((Math.floor(k / cols) % cols) - 1) * 0.78 + (rand() - 0.5) * 0.25,
    );
  }
  for (const kind of Object.keys(meshes) as Kind[]) {
    const mesh = meshes[kind];
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    group.add(mesh);
  }

  const dummy = new Object3D();
  const halfHeight: Record<Kind, number> = { can: 0.48, foil: 0.09, phone: 0.05, unsure: 0.3 };
  const scaleOf: Record<Kind, number> = { can: 1.3, foil: 1.25, phone: 1.25, unsure: 1.4 };

  const beltPoint = new Vector3();
  const orbit = new Vector3();
  const stage = new Vector3();

  return {
    group,
    anchors,
    update({ time, chapter, motion, palette }) {
      const t = motion ? time : 0;
      beltMaterial.color.copy(palette.stone).multiplyScalar(0.2);
      // Dim enough by day that these thin lines do not bloom over the belt between them.
      railMaterial.color.copy(palette.glow).multiplyScalar(palette.glowIntensity * 0.42);
      glowMaterial.color.copy(palette.glow).multiplyScalar(palette.glowIntensity * 0.5);
      (sheetMaterial.uniforms.uColor!.value as Color).copy(palette.glow);

      const toLane = smoothstep(2.75, 3.4, chapter);
      const run = clamp01((chapter - SORT_START) / SORT_SPAN);
      let pulse = 0;
      const arrive: Record<Outcome, number> = { recyclable: 0, trash: 0, unsure: 0 };

      for (const item of items) {
        const mesh = meshes[item.kind];
        const k = scaleOf[item.kind];

        // Drifting around the Sorter, then waiting in a loose cloud above the start of the belt.
        const angle = item.phase * Math.PI * 2 + t * item.speed;
        // A wide, flat ring round the Sorter: on the camera's side it stays well back, so an
        // item never fills the picture.
        const radiusX = 9.5 + (item.slot % 5) * 1 + (item.kind === 'can' ? 0.8 : 0);
        const radiusZ = 4.8 + (item.slot % 3) * 0.7;
        orbit.set(
          Math.cos(angle) * radiusX,
          1.7 + ((item.phase * 3.1) % 1) * 3.8 + Math.sin(t * 0.6 + item.phase * 9) * 0.3,
          Math.sin(angle) * radiusZ,
        );
        stage.copy(item.staging);
        stage.y += Math.sin(t * 0.7 + item.phase * 13) * 0.22;
        const waiting = orbit.lerp(stage, toLane);

        const start = (item.rank / (items.length - 1)) * (1 - TRANSIT);
        const u = clamp01((run - start) / TRANSIT);

        let yaw = t * (0.4 + item.speed * 3) + item.phase * 6;
        let pitch = t * 0.3 + item.phase * 4;
        let roll = 0;
        let x = waiting.x;
        let y = waiting.y;
        let z = waiting.z;

        if (u > 0) {
          if (u < 0.55) {
            // Along the belt, slowing a little under the gate.
            const s = u / 0.55;
            const eased = s + Math.sin(s * Math.PI * 2) * -0.045;
            beltPoint.set(
              mix(BELT_FROM + 0.4, BELT_TO - 1, eased),
              BELT_TOP + halfHeight[item.kind] * k,
              0,
            );
            const lift = smoothstep(0, 0.1, s);
            x = mix(x, beltPoint.x, lift);
            y = mix(y, beltPoint.y, lift);
            z = mix(z, beltPoint.z, lift);
            yaw = mix(yaw, 0, lift);
            pitch = mix(pitch, 0, lift);
          } else if (u < 1) {
            // Off the end of the belt and into its place, in an arc.
            const s = (u - 0.55) / 0.45;
            const ex = BELT_TO - 1;
            const ey = BELT_TOP + halfHeight[item.kind] * k;
            const hop = item.outcome === 'unsure' ? 0.7 : 2.6;
            const cx = (ex + item.rest.x) / 2 + 0.6;
            const cy = ey + hop;
            const cz = item.rest.z * 0.5;
            const a = (1 - s) * (1 - s);
            const b = 2 * (1 - s) * s;
            const c = s * s;
            x = a * ex + b * cx + c * item.rest.x;
            y = a * ey + b * cy + c * item.rest.y;
            z = a * 0 + b * cz + c * item.rest.z;
            yaw = s * item.restYaw;
            pitch = s * item.restTilt * 3;
            roll = s * 2.4;
          } else {
            x = item.rest.x;
            y = item.rest.y;
            z = item.rest.z;
            yaw = item.restYaw;
            pitch = item.restTilt;
            roll = 0;
          }
          // The moment it is under the gate, and the moment it lands.
          pulse = Math.max(pulse, Math.exp(-(((u - AT_GATE) / 0.035) ** 2)));
          arrive[item.outcome] = Math.max(
            arrive[item.outcome],
            Math.exp(-(((u - 0.97) / 0.05) ** 2)),
          );
        }

        dummy.position.set(x, y, z);
        dummy.rotation.set(pitch, yaw, roll);
        dummy.scale.setScalar(k);
        dummy.updateMatrix();
        mesh.setMatrixAt(item.slot, dummy.matrix);
      }
      for (const mesh of Object.values(meshes)) mesh.instanceMatrix.needsUpdate = true;

      // The belt's cross marks drift with the story.
      const gap = (BELT_TO - BELT_FROM) / MARKS;
      const slide = (((t * 0.5 + chapter * 4.5) % gap) + gap) % gap;
      for (let i = 0; i < MARKS; i++) {
        dummy.position.set(BELT_FROM + i * gap + slide, BELT_TOP + 0.011, 0);
        dummy.rotation.set(0, 0, 0);
        dummy.scale.set(1, 1, 1);
        dummy.updateMatrix();
        marks.setMatrixAt(i, dummy.matrix);
      }
      marks.instanceMatrix.needsUpdate = true;

      sheetMaterial.uniforms.uTime!.value = t;
      sheetMaterial.uniforms.uPulse!.value = pulse;
      const lipBoost = (key: Outcome) => 1.5 + arrive[key] * 3;
      recyclableBin.rim.color.copy(OUTCOME.recyclable).multiplyScalar(lipBoost('recyclable'));
      trashBin.rim.color.copy(OUTCOME.trash).multiplyScalar(lipBoost('trash') * 0.9);
      unsureTray.rim.color.copy(OUTCOME.unsure).multiplyScalar(lipBoost('unsure'));
      return pulse;
    },
    dispose() {
      belt.geometry.dispose();
      beltMaterial.dispose();
      normalMap.dispose();
      railGeometry.dispose();
      railMaterial.dispose();
      markGeometry.dispose();
      markMaterial.dispose();
      ringGeometry.dispose();
      ringMaterial.dispose();
      glowGeometry.dispose();
      glowMaterial.dispose();
      sheetGeometry.dispose();
      sheetMaterial.dispose();
      recyclableBin.dispose();
      trashBin.dispose();
      unsureTray.dispose();
      canGeometry.dispose();
      foilGeometry.dispose();
      phoneGeometry.dispose();
      unsureGeometry.dispose();
      canMaterial.dispose();
      foilMaterial.dispose();
      phoneMaterial.dispose();
      unsureMaterial.dispose();
    },
  };
}
