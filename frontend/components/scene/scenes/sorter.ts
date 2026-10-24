// The Sorter: the hero of the story. A tower of rounded bricks laid in rings, with light leaking
// through the seams, a camera lens set into the front, and a beacon on top. It assembles itself
// when the page opens, and as the story goes on it opens up ring by ring.
//
// It is a picture of the machine, not a model of it: there is one brick per cell of a ring, and
// the camera really does sit at the front.

import {
  AdditiveBlending,
  CircleGeometry,
  Color,
  CylinderGeometry,
  DoubleSide,
  Euler,
  Group,
  InstancedMesh,
  Mesh,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  Object3D,
  OctahedronGeometry,
  PointLight,
  ShaderMaterial,
  SphereGeometry,
  TorusGeometry,
  Vector3,
} from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

import { at, clamp01, easeOutCubic, mulberry32 } from '@/lib/scene/math';

import type { Palette } from '../engine/palette';
import { OUTCOME } from '../engine/palette';
import { grainNormalMap, grainRoughnessMap } from '../engine/textures';
import type { Quality } from '../engine/types';

const RING_COUNT = 8;
const RADIUS = [3.15, 3.05, 2.9, 2.75, 2.75, 2.6, 2.35, 1.95];
const BRICK_H = 0.72;
const BRICK_D = 0.95;
const RING_PITCH = 0.8;
const LENS_RING = 3;
const FRONT = Math.PI / 2; // the lens faces +z

const ringY = (i: number) => 0.55 + i * RING_PITCH;

const HALO_VERTEX = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const HALO_FRAGMENT = /* glsl */ `
  uniform vec3 uColor;
  uniform float uOpacity;
  varying vec2 vUv;
  void main() {
    float d = length(vUv - 0.5) * 2.0;
    float a = pow(1.0 - smoothstep(0.0, 1.0, d), 2.4);
    gl_FragColor = vec4(uColor, a * uOpacity);
  }
`;

interface Brick {
  ring: number;
  angle: number;
  width: number;
  /** Where it starts, far away, for the opening. */
  scatter: Vector3;
  tumble: Vector3;
  /** 0 to 0.55: when it sets off during the opening. */
  delay: number;
  push: number;
  lift: number;
  twist: Vector3;
}

export interface Sorter {
  group: Group;
  anchors: { lens: Object3D; top: Object3D; frame: Object3D };
  /** `explode` is 0 for the closed tower and 1 for the fully opened one. */
  update(args: {
    time: number;
    intro: number;
    explode: number;
    flash: number;
    motion: boolean;
    palette: Palette;
    quality: Quality;
  }): void;
  setQuality(quality: Quality): void;
  dispose(): void;
}

export function createSorter(): Sorter {
  const group = new Group();
  const rand = mulberry32(2026);

  // -- bricks ------------------------------------------------------------------------------
  const bricks: Brick[] = [];
  for (let ring = 0; ring < RING_COUNT; ring++) {
    const r = at(RADIUS, ring);
    const count = Math.round((Math.PI * 2 * r) / 1.12);
    const offset = ring % 2 === 0 ? 0 : Math.PI / count; // masonry: every other ring is shifted
    for (let n = 0; n < count; n++) {
      const angle = offset + (n / count) * Math.PI * 2;
      // The lens is set into the front: leave a gap there.
      const gap =
        ring === LENS_RING ? 0.36 : ring === LENS_RING - 1 || ring === LENS_RING + 1 ? 0.2 : 0;
      if (gap > 0 && Math.abs(Math.atan2(Math.sin(angle - FRONT), Math.cos(angle - FRONT))) < gap)
        continue;
      const shell = 16 + rand() * 30;
      const theta = rand() * Math.PI * 2;
      const phi = Math.acos(2 * rand() - 1);
      bricks.push({
        ring,
        angle,
        width: (Math.PI * 2 * r) / count - 0.075,
        scatter: new Vector3(
          shell * Math.sin(phi) * Math.cos(theta),
          6 + Math.abs(shell * Math.cos(phi)) * 0.8,
          shell * Math.sin(phi) * Math.sin(theta),
        ),
        tumble: new Vector3((rand() - 0.5) * 9, (rand() - 0.5) * 9, (rand() - 0.5) * 9),
        delay: rand() * 0.5 + ring * 0.015,
        push: rand(),
        lift: rand() * 2 - 1,
        twist: new Vector3(rand() - 0.5, rand() - 0.5, rand() - 0.5),
      });
    }
  }

  const brickGeometry = new RoundedBoxGeometry(1, 1, 1, 3, 0.14);
  const normalMap = grainNormalMap(256, 1.3, 3);
  const roughnessMap = grainRoughnessMap(256, 0.7, 0.95, 11);
  const brickMaterial = new MeshStandardMaterial({
    color: new Color(0xc9d3d8),
    roughness: 0.9,
    metalness: 0.02,
    normalMap,
    roughnessMap,
  });
  brickMaterial.normalScale.set(0.55, 0.55);
  const mesh = new InstancedMesh(brickGeometry, brickMaterial, bricks.length);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.frustumCulled = false; // the bricks move far from where the mesh was built
  const tint = new Color();
  bricks.forEach((_, i) => {
    const v = 0.84 + rand() * 0.24;
    tint.setRGB(v * (0.97 + rand() * 0.06), v, v * (1.0 + rand() * 0.05));
    mesh.setColorAt(i, tint);
  });
  group.add(mesh);

  // -- the light inside: one disc per ring, which shows through the seams ------------------------
  const coreGeometry = new CylinderGeometry(1, 1, 1, 48, 1);
  const coreMaterial = new MeshBasicMaterial({ color: new Color(0xbfeaff), toneMapped: false });
  const core = new InstancedMesh(coreGeometry, coreMaterial, RING_COUNT);
  core.frustumCulled = false;
  group.add(core);

  const glowLight = new PointLight(0xbfeaff, 30, 22, 2);
  glowLight.position.set(0, 3.2, 0);
  group.add(glowLight);

  // -- the base plate ----------------------------------------------------------------------
  const plateMaterial = new MeshStandardMaterial({ color: 0xc9d3d8, roughness: 0.85, normalMap });
  const plate = new Mesh(new CylinderGeometry(3.95, 4.2, 0.34, 72), plateMaterial);
  plate.position.y = 0.17;
  plate.receiveShadow = true;
  plate.castShadow = true;
  group.add(plate);
  const plateRing = new Mesh(
    new TorusGeometry(4.0, 0.035, 8, 120),
    new MeshBasicMaterial({ color: new Color(0xbfeaff), toneMapped: false }),
  );
  plateRing.rotation.x = Math.PI / 2;
  plateRing.position.y = 0.36;
  group.add(plateRing);

  // -- the lens ----------------------------------------------------------------------------
  const lens = new Group();
  const lensY = ringY(LENS_RING);
  lens.position.set(0, lensY, at(RADIUS, LENS_RING) + 0.1);
  const housing = new Mesh(
    new TorusGeometry(1.08, 0.11, 24, 80),
    new MeshStandardMaterial({ color: 0x1b252b, metalness: 0.95, roughness: 0.28 }),
  );
  const rim = new Mesh(
    new TorusGeometry(0.93, 0.035, 12, 80),
    new MeshBasicMaterial({ color: new Color(0xbfeaff), toneMapped: false }),
  );
  rim.position.z = 0.06;
  const glass = new Mesh(
    new SphereGeometry(0.86, 56, 40),
    new MeshPhysicalMaterial({
      color: 0x060b0e,
      metalness: 0.2,
      roughness: 0.03,
      clearcoat: 1,
      clearcoatRoughness: 0.02,
      envMapIntensity: 2,
    }),
  );
  glass.scale.z = 0.5;
  glass.position.z = -0.04;
  const pupil = new Mesh(
    new SphereGeometry(0.2, 24, 16),
    new MeshBasicMaterial({
      color: OUTCOME.recyclable.clone().multiplyScalar(2.2),
      toneMapped: false,
    }),
  );
  pupil.position.set(-0.18, 0.2, 0.34);
  pupil.scale.z = 0.3;
  lens.add(housing, rim, glass, pupil);
  group.add(lens);

  // -- the beacon --------------------------------------------------------------------------
  const topY = ringY(RING_COUNT - 1) + 1.15;
  const beaconMaterial = new MeshBasicMaterial({ color: new Color(0xbfeaff), toneMapped: false });
  const beacon = new Mesh(new OctahedronGeometry(0.34, 0), beaconMaterial);
  beacon.position.y = topY;
  group.add(beacon);

  // A beam of light rising from the beacon, and a pool of it on the ground.
  const beamMaterial = new MeshBasicMaterial({
    color: new Color(0xbfeaff),
    transparent: true,
    opacity: 0.08,
    blending: AdditiveBlending,
    depthWrite: false,
    side: DoubleSide,
    toneMapped: false,
  });
  const beam = new Mesh(new CylinderGeometry(0.08, 0.5, 48, 28, 1, true), beamMaterial);
  group.add(beam);
  const haloMaterial = new ShaderMaterial({
    vertexShader: HALO_VERTEX,
    fragmentShader: HALO_FRAGMENT,
    uniforms: { uColor: { value: new Color(0xbfeaff) }, uOpacity: { value: 0.2 } },
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
  });
  const halo = new Mesh(new CircleGeometry(12, 64), haloMaterial);
  halo.rotation.x = -Math.PI / 2;
  halo.position.y = 0.06;
  group.add(halo);

  // Where the labels attach.
  const anchorLens = new Object3D();
  anchorLens.position.set(0.9, 0.55, 0.3);
  lens.add(anchorLens);
  const anchorTop = new Object3D();
  anchorTop.position.set(0, 0.5, 0);
  beacon.add(anchorTop);
  const anchorFrame = new Object3D();
  anchorFrame.position.set(0, lensY, at(RADIUS, LENS_RING) + 3.2);
  group.add(anchorFrame);

  const dummy = new Object3D();
  const euler = new Euler(0, 0, 0, 'YXZ');
  const glowColour = new Color();

  return {
    group,
    anchors: { lens: anchorLens, top: anchorTop, frame: anchorFrame },
    update({ time, intro, explode, flash, motion, palette, quality }) {
      const e = explode;
      brickMaterial.color.copy(palette.stone);
      plateMaterial.color.copy(palette.stone);

      // How bright the light inside is: steady, breathing a little, and flashing on a count.
      const breathe = motion ? 0.92 + 0.08 * Math.sin(time * 1.3) : 1;
      const level = palette.glowIntensity * breathe * (1 + flash * 1.6);
      // Without bloom the colour must stay within 0 to 1 or it clips to white.
      const k = quality === 'low' ? Math.min(level, 1) : level;
      glowColour.copy(palette.glow).multiplyScalar(k);
      coreMaterial.color.copy(glowColour);
      beaconMaterial.color.copy(glowColour);
      (plateRing.material as MeshBasicMaterial).color.copy(glowColour);
      (rim.material as MeshBasicMaterial).color.copy(glowColour);
      glowLight.color.copy(palette.glow);
      glowLight.intensity = 26 * (0.6 + palette.glowIntensity * 0.25) * breathe * (1 + flash);
      beamMaterial.color.copy(palette.glow);
      beamMaterial.opacity = (0.02 + 0.03 * palette.glowIntensity) * (1 + flash * 1.5);
      (haloMaterial.uniforms.uColor!.value as Color).copy(palette.glow);
      haloMaterial.uniforms.uOpacity!.value =
        Math.max(0.03, 0.09 * (palette.glowIntensity - 1.2)) * breathe * (1 + flash * 1.2);

      // Bricks.
      for (let i = 0; i < bricks.length; i++) {
        const b = at(bricks, i);
        const r = at(RADIUS, b.ring);
        const idle =
          motion && b.ring !== LENS_RING - 1 && b.ring !== LENS_RING && b.ring !== LENS_RING + 1
            ? time * (b.ring % 2 === 0 ? 0.035 : -0.028)
            : 0;
        const spin = e * (b.ring % 2 === 0 ? 1 : -1) * 0.5 + idle * (1 - e);
        const angle = b.angle + spin;
        const radial = r + e * (0.5 + b.push * 2.1);
        const y = ringY(b.ring) + e * (b.ring - 3.5) * 1.15 + e * e * b.lift * 1.4;

        const flight = easeOutCubic(clamp01(intro * 1.5 - b.delay));
        const wobble = 1 - flight;
        dummy.position.set(
          Math.cos(angle) * radial * flight + b.scatter.x * wobble,
          y * flight + b.scatter.y * wobble,
          Math.sin(angle) * radial * flight + b.scatter.z * wobble,
        );
        euler.set(
          e * e * b.twist.x * 1.6 + b.tumble.x * wobble * wobble,
          Math.PI / 2 - angle + b.tumble.y * wobble * wobble,
          e * e * b.twist.z * 1.6 + b.tumble.z * wobble * wobble,
        );
        dummy.rotation.copy(euler);
        dummy.scale.set(b.width, BRICK_H, BRICK_D);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
      }
      mesh.instanceMatrix.needsUpdate = true;

      // The discs of light follow their rings up as the tower opens.
      const open = easeOutCubic(clamp01(intro * 1.2 - 0.25));
      for (let ring = 0; ring < RING_COUNT; ring++) {
        const r = at(RADIUS, ring) - 0.5;
        dummy.position.set(0, (ringY(ring) + e * (ring - 3.5) * 1.15) * open + (1 - open) * -2, 0);
        dummy.rotation.set(0, 0, 0);
        dummy.scale.set(r * open, 0.74, r * open);
        dummy.updateMatrix();
        core.setMatrixAt(ring, dummy.matrix);
      }
      core.instanceMatrix.needsUpdate = true;

      // The lens stays with its ring, and looks round at you as the tower opens.
      lens.position.y = lensY + e * (LENS_RING - 3.5) * 1.15;
      lens.position.z = at(RADIUS, LENS_RING) + 0.1 + e * 0.5;
      lens.scale.setScalar(open);
      const lampPulse = motion ? 0.7 + 0.3 * Math.sin(time * 3.1) : 1;
      pupil.scale.setScalar(0.3 + 0.12 * lampPulse);
      beacon.position.y = (topY + e * 4.2 * 1.15) * open + (1 - open) * 12;
      beacon.rotation.y = motion ? time * 0.8 : 0;
      beacon.rotation.x = 0.4;
      beam.position.y = beacon.position.y + 24;
      beam.visible = open > 0.6;
      halo.scale.setScalar(0.4 + 0.6 * open);
      anchorFrame.position.y = lens.position.y;
      plate.scale.setScalar(open);
      plateRing.scale.setScalar(open);
    },
    setQuality(quality) {
      mesh.castShadow = quality === 'high';
      glowLight.visible = quality !== 'low';
    },
    dispose() {
      brickGeometry.dispose();
      brickMaterial.dispose();
      coreGeometry.dispose();
      coreMaterial.dispose();
      normalMap.dispose();
      roughnessMap.dispose();
      plateMaterial.dispose();
      plate.geometry.dispose();
      plateRing.geometry.dispose();
      (plateRing.material as MeshBasicMaterial).dispose();
      for (const part of [housing, rim, glass, pupil, beacon, beam, halo]) {
        part.geometry.dispose();
        (part.material as MeshBasicMaterial).dispose();
      }
    },
  };
}
