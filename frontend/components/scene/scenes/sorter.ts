// The Sorter: the hero of the story, drawn as the thing it is, a bin. A drum of moulded ribs that
// widens toward the top, light leaking through the seams, a camera lens set into the front, the
// recycling mark below it, and a lid in three parts, one for each place an item can end up.
// It assembles itself when the page opens, and as the story goes on it opens up ring by ring
// and its lid parts open like petals.
//
// It is a picture of the machine, not a model of it: the camera really does sit at the front.

import {
  AdditiveBlending,
  CircleGeometry,
  Color,
  CylinderGeometry,
  DoubleSide,
  Euler,
  ExtrudeGeometry,
  Group,
  InstancedMesh,
  Mesh,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  Object3D,
  OctahedronGeometry,
  PlaneGeometry,
  PointLight,
  Shape,
  ShaderMaterial,
  SphereGeometry,
  TorusGeometry,
  Vector3,
} from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

import { at, clamp01, easeOutCubic, mulberry32 } from '@/lib/scene/math';

import { glyphTexture } from '../engine/glyphs';
import type { Palette } from '../engine/palette';
import { OUTCOME } from '../engine/palette';
import { grainNormalMap, grainRoughnessMap } from '../engine/textures';
import type { Quality } from '../engine/types';

const RING_COUNT = 7;
/** The drum widens toward the top, the way a bin does. */
const RADIUS = [2.55, 2.65, 2.75, 2.85, 2.95, 3.05, 3.15];
const STAVE_H = 0.8;
const STAVE_D = 0.4;
/** How wide one rib is, round the drum. */
const RIB = 0.44;
const RING_PITCH = 0.86;
const LENS_RING = 3;
const EMBLEM_RING = 1;
const FRONT = Math.PI / 2; // the lens faces +z

const ringY = (i: number) => 0.62 + i * RING_PITCH;
/** How far a ring rises (or sinks) when the bin is fully opened. */
const lift = (ring: number) => (ring - LENS_RING) * 1.15;

const CROWN_Y = ringY(RING_COUNT - 1) + STAVE_H / 2 + 0.02;
const CROWN_RADIUS = 3.4;
const CROWN_THICK = 0.5;

/** Where each part of the lid sits, in degrees round the bin, and what it stands for. */
const LID = [
  { outcome: 'recyclable', from: 30, to: 150 },
  { outcome: 'trash', from: 150, to: 270 },
  { outcome: 'unsure', from: 270, to: 390 },
] as const;
const LID_GAP = 0.05;

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

interface Stave {
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
  /** `explode` is 0 for the closed bin and 1 for the fully opened one. */
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

/** A flat, bevelled slice of the lid between two angles round the bin (as atan2(z, x)). */
function lidPart(from: number, to: number): ExtrudeGeometry {
  const shape = new Shape();
  shape.moveTo(0, 0);
  // Laid flat below, the shape's y becomes the world's -z, so the angles are mirrored.
  shape.absarc(0, 0, CROWN_RADIUS, -to, -from, false);
  shape.lineTo(0, 0);
  const geometry = new ExtrudeGeometry(shape, {
    depth: CROWN_THICK - 0.16,
    bevelEnabled: true,
    bevelThickness: 0.08,
    bevelSize: 0.08,
    bevelSegments: 3,
    curveSegments: 28,
  });
  geometry.rotateX(-Math.PI / 2);
  geometry.translate(0, 0.08, 0);
  return geometry;
}

export function createSorter(): Sorter {
  const group = new Group();
  const rand = mulberry32(2026);

  // -- the ribs ----------------------------------------------------------------------------
  const staves: Stave[] = [];
  for (let ring = 0; ring < RING_COUNT; ring++) {
    const r = at(RADIUS, ring);
    const count = Math.round((Math.PI * 2 * r) / RIB);
    for (let n = 0; n < count; n++) {
      const angle = (n / count) * Math.PI * 2;
      // The lens and the mark are set into the front: leave a gap there.
      const gap =
        ring === LENS_RING
          ? 0.42
          : ring === LENS_RING - 1 || ring === LENS_RING + 1
            ? 0.27
            : ring === EMBLEM_RING
              ? 0.24
              : 0;
      if (gap > 0 && Math.abs(Math.atan2(Math.sin(angle - FRONT), Math.cos(angle - FRONT))) < gap)
        continue;
      const shell = 16 + rand() * 30;
      const theta = rand() * Math.PI * 2;
      const phi = Math.acos(2 * rand() - 1);
      staves.push({
        ring,
        angle,
        width: (Math.PI * 2 * r) / count - 0.05,
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

  const staveGeometry = new RoundedBoxGeometry(1, 1, 1, 3, 0.14);
  const normalMap = grainNormalMap(256, 0.5, 3);
  const roughnessMap = grainRoughnessMap(256, 0.5, 0.74, 11);
  const staveMaterial = new MeshStandardMaterial({
    color: new Color(0x3d4c46),
    roughness: 0.62,
    metalness: 0.03,
    normalMap,
    roughnessMap,
    envMapIntensity: 1.0,
  });
  staveMaterial.normalScale.set(0.1, 0.1);
  const mesh = new InstancedMesh(staveGeometry, staveMaterial, staves.length);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.frustumCulled = false; // the ribs move far from where the mesh was built
  const tint = new Color();
  staves.forEach((_, i) => {
    const v = 0.95 + rand() * 0.1;
    tint.setRGB(v, v * (1 + (rand() - 0.5) * 0.03), v * (1 + (rand() - 0.5) * 0.03));
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

  // -- the pad it stands on ----------------------------------------------------------------
  const padMaterial = new MeshStandardMaterial({ color: 0xc9d3d8, roughness: 0.85, normalMap });
  const pad = new Mesh(new CylinderGeometry(4.0, 4.25, 0.34, 72), padMaterial);
  pad.position.y = 0.17;
  pad.receiveShadow = true;
  pad.castShadow = true;
  group.add(pad);
  const padRing = new Mesh(
    new TorusGeometry(4.05, 0.035, 8, 120),
    new MeshBasicMaterial({ color: new Color(0xbfeaff), toneMapped: false }),
  );
  padRing.rotation.x = Math.PI / 2;
  padRing.position.y = 0.36;
  group.add(padRing);

  // -- the lid, in three parts -------------------------------------------------------------
  const crown = new Group();
  group.add(crown);
  const lidGeometries: ExtrudeGeometry[] = [];
  const lidMaterials: MeshStandardMaterial[] = [];
  const lidParts = LID.map((part) => {
    const from = (part.from * Math.PI) / 180 + LID_GAP;
    const to = (part.to * Math.PI) / 180 - LID_GAP;
    const geometry = lidPart(from, to);
    const material = new MeshStandardMaterial({
      color: OUTCOME[part.outcome].clone().multiplyScalar(0.82),
      roughness: 0.46,
      metalness: 0.04,
      envMapIntensity: 1.25,
      emissive: OUTCOME[part.outcome],
      emissiveIntensity: 0.08,
    });
    const lidMesh = new Mesh(geometry, material);
    lidMesh.castShadow = true;
    lidMesh.receiveShadow = true;
    crown.add(lidMesh);
    lidGeometries.push(geometry);
    lidMaterials.push(material);
    return { mesh: lidMesh, middle: (from + to) / 2 };
  });
  const hubMaterial = new MeshStandardMaterial({ color: 0x1b252b, metalness: 0.9, roughness: 0.3 });
  const hub = new Mesh(new CylinderGeometry(0.75, 0.9, CROWN_THICK + 0.1, 40), hubMaterial);
  hub.position.y = CROWN_THICK / 2 + 0.05;
  hub.castShadow = true;
  crown.add(hub);

  // -- the lens ----------------------------------------------------------------------------
  const lens = new Group();
  const lensY = ringY(LENS_RING);
  const lensZ = at(RADIUS, LENS_RING) + 0.1;
  lens.position.set(0, lensY, lensZ);
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

  // -- the recycling mark, glowing, below the lens -------------------------------------------
  const markTexture = glyphTexture('recyclable', 256);
  const markMaterial = new MeshBasicMaterial({
    map: markTexture,
    transparent: true,
    toneMapped: false,
    depthWrite: false,
  });
  const markY = ringY(EMBLEM_RING);
  const markZ = at(RADIUS, EMBLEM_RING) + 0.12;
  const mark = new Mesh(new PlaneGeometry(1.0, 1.0), markMaterial);
  mark.position.set(0, markY, markZ);
  // On a dark plate, so the light behind the seams does not wash it out.
  const markPlate = new Mesh(new RoundedBoxGeometry(1.3, 1.3, 0.14, 3, 0.1), hubMaterial);
  markPlate.position.set(0, markY, markZ - 0.07);
  markPlate.castShadow = true;
  group.add(markPlate, mark);

  // -- the beacon --------------------------------------------------------------------------
  const topY = CROWN_Y + CROWN_THICK + 1.25;
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
      staveMaterial.color.copy(palette.body);
      padMaterial.color.copy(palette.stone);

      // How bright the light inside is: steady, breathing a little, and flashing on a count.
      const breathe = motion ? 0.92 + 0.08 * Math.sin(time * 1.3) : 1;
      const level = palette.glowIntensity * breathe * (1 + flash * 1.6);
      // Without bloom the colour must stay within 0 to 1 or it clips to white.
      const k = quality === 'low' ? Math.min(level, 1) : level;
      glowColour.copy(palette.glow).multiplyScalar(k);
      coreMaterial.color.copy(glowColour);
      beaconMaterial.color.copy(glowColour);
      markMaterial.color.copy(palette.glow).multiplyScalar(Math.min(k, 1.6));
      (padRing.material as MeshBasicMaterial).color.copy(glowColour);
      (rim.material as MeshBasicMaterial).color.copy(glowColour);
      glowLight.color.copy(palette.glow);
      glowLight.intensity = 26 * (0.6 + palette.glowIntensity * 0.25) * breathe * (1 + flash);
      beamMaterial.color.copy(palette.glow);
      beamMaterial.opacity = (0.02 + 0.03 * palette.glowIntensity) * (1 + flash * 1.5);
      (haloMaterial.uniforms.uColor!.value as Color).copy(palette.glow);
      haloMaterial.uniforms.uOpacity!.value =
        Math.max(0.03, 0.09 * (palette.glowIntensity - 1.2)) * breathe * (1 + flash * 1.2);

      // The ribs.
      for (let i = 0; i < staves.length; i++) {
        const b = at(staves, i);
        const r = at(RADIUS, b.ring);
        const idle =
          motion && b.ring !== LENS_RING - 1 && b.ring !== LENS_RING && b.ring !== LENS_RING + 1
            ? time * (b.ring % 2 === 0 ? 0.035 : -0.028)
            : 0;
        const spin = e * (b.ring % 2 === 0 ? 1 : -1) * 0.5 + idle * (1 - e);
        const angle = b.angle + spin;
        const radial = r + e * (0.5 + b.push * 2.1);
        const y = ringY(b.ring) + e * lift(b.ring) + e * e * b.lift * 1.4;

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
        dummy.scale.set(b.width, STAVE_H, STAVE_D);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
      }
      mesh.instanceMatrix.needsUpdate = true;

      // The discs of light follow their rings up as the bin opens.
      const open = easeOutCubic(clamp01(intro * 1.2 - 0.25));
      for (let ring = 0; ring < RING_COUNT; ring++) {
        const r = at(RADIUS, ring) - 0.3;
        dummy.position.set(0, (ringY(ring) + e * lift(ring)) * open + (1 - open) * -2, 0);
        dummy.rotation.set(0, 0, 0);
        dummy.scale.set(r * open, STAVE_H + 0.04, r * open);
        dummy.updateMatrix();
        core.setMatrixAt(ring, dummy.matrix);
      }
      core.instanceMatrix.needsUpdate = true;

      // The lens and the mark stay with their rings, and look round at you as the bin opens.
      lens.position.y = lensY + e * lift(LENS_RING);
      lens.position.z = lensZ + e * 0.5;
      lens.scale.setScalar(open);
      const lampPulse = motion ? 0.7 + 0.3 * Math.sin(time * 3.1) : 1;
      pupil.scale.setScalar(0.3 + 0.12 * lampPulse);
      mark.position.y = markY + e * lift(EMBLEM_RING);
      mark.position.z = markZ + e * 0.5;
      mark.scale.setScalar(open);
      markPlate.position.set(0, mark.position.y, mark.position.z - 0.07);
      markPlate.scale.setScalar(open);

      // The lid arrives last, then its three parts open like petals as the story goes on.
      const settle = easeOutCubic(clamp01((intro - 0.45) / 0.5));
      const rise = e * (lift(RING_COUNT - 1) + 0.9);
      crown.position.y = CROWN_Y + rise + (1 - settle) * 14;
      lidParts.forEach((part, i) => {
        const breath = motion ? 0.035 * Math.sin(time * 1.2 + i * 2.1) : 0;
        const away = e * 1.5;
        part.mesh.position.set(
          Math.cos(part.middle) * away,
          breath + e * (i - 1) * 0.35,
          Math.sin(part.middle) * away,
        );
        part.mesh.rotation.y = (1 - settle) * (i + 1) * 1.1 + e * (i - 1) * 0.12;
        const material = lidMaterials[i];
        if (material) material.emissiveIntensity = 0.08 + flash * 0.9;
      });
      hub.scale.setScalar(Math.max(0.001, settle));

      beacon.position.y = (topY + rise) * open + (1 - open) * 12;
      beacon.rotation.y = motion ? time * 0.8 : 0;
      beacon.rotation.x = 0.4;
      beam.position.y = beacon.position.y + 24;
      beam.visible = open > 0.6;
      halo.scale.setScalar(0.4 + 0.6 * open);
      anchorFrame.position.y = lens.position.y;
      pad.scale.setScalar(open);
      padRing.scale.setScalar(open);
    },
    setQuality(quality) {
      mesh.castShadow = quality === 'high';
      glowLight.visible = quality !== 'low';
    },
    dispose() {
      staveGeometry.dispose();
      staveMaterial.dispose();
      coreGeometry.dispose();
      coreMaterial.dispose();
      normalMap.dispose();
      roughnessMap.dispose();
      padMaterial.dispose();
      pad.geometry.dispose();
      padRing.geometry.dispose();
      (padRing.material as MeshBasicMaterial).dispose();
      for (const g of lidGeometries) g.dispose();
      for (const m of lidMaterials) m.dispose();
      hub.geometry.dispose();
      hubMaterial.dispose();
      mark.geometry.dispose();
      markPlate.geometry.dispose();
      markMaterial.dispose();
      markTexture.dispose();
      for (const part of [housing, rim, glass, pupil, beacon, beam, halo]) {
        part.geometry.dispose();
        (part.material as MeshBasicMaterial).dispose();
      }
    },
  };
}
