// The testing story: the product in the middle, and around it a ring of places where it is tested.
//
//   0  Tested, and shown      the Sorter, with the ring of tests in the yard around it
//   1  What is checked        a tower for each set of automated checks
//   2  When the camera goes   a screen for each way the camera can stop showing a picture
//      dark
//   3  What it learned        the frames the model was taught with, and the ones held back
//   4  The real rig           empty frames, for photographs and video of the rig
//   5  Run it again           back to the product
//
// The sets stand on a circle, each facing the middle, and the camera travels inside the circle:
// every chapter looks outward at one set, with the yard and the plant behind it.

import {
  DirectionalLight,
  FogExp2,
  Group,
  HemisphereLight,
  type Object3D,
  PerspectiveCamera,
  Scene,
  Vector3,
} from 'three';

import { centreOf } from '@/lib/scene/chapters';
import { smoothstep, type V3, window01 } from '@/lib/scene/math';
import { type Key, poseAt } from '@/lib/scene/rig';

import { createDust } from '../engine/dust';
import { createPalette, paletteAt } from '../engine/palette';
import { createScraps } from '../engine/scraps';
import type { BuildContext, FrameState, Quality, SceneModule } from '../engine/types';
import { createField, type FieldSpec } from './field';
import { createMedia, type MediaSpec } from './media';
import { createPylons, type PylonSpec } from './pylons';
import { createSky } from './sky';
import { createSorter } from './sorter';
import { createStations, type StationSpec } from './stations';
import { createTerrain } from './terrain';

export const TESTING_CHAPTERS = 6;

const RING = 46;
/** Where each set stands on the ring, in degrees from the +x axis: checks, screens, field, rig. */
const ANGLES = [-150, -78, -6, 66].map((deg) => (deg * Math.PI) / 180);
const [PYLONS, STATIONS, FIELD, MEDIA] = [0, 1, 2, 3] as const;

function rotationOf(set: number): number {
  const a = ANGLES[set] ?? 0;
  // Turned so that the set's own +z points at the middle of the ring.
  return Math.atan2(-Math.cos(a), -Math.sin(a));
}

function positionOf(set: number): V3 {
  const a = ANGLES[set] ?? 0;
  return [RING * Math.cos(a), 0, RING * Math.sin(a)];
}

/** A point in a set's own space (x across, y up, z toward the middle), in the world. */
function inSet(set: number, local: V3): V3 {
  const [px, , pz] = positionOf(set);
  const r = rotationOf(set);
  const c = Math.cos(r);
  const s = Math.sin(r);
  return [px + local[0] * c + local[2] * s, local[1], pz - local[0] * s + local[2] * c];
}

function view(at: number, set: number, camera: V3, look: V3, fov: number, shift: number): Key {
  return { at, pos: inSet(set, camera), look: inSet(set, look), fov, shift };
}

const KEYS: Key[] = [
  { at: centreOf(0), pos: [7.9, 3.1, 13.8], look: [0, 3.9, 0], fov: 40, shift: 0.17 },
  view(centreOf(1), PYLONS, [0, 6.9, 30.5], [0, 5.2, 0], 42, 0.12),
  // The row of screens along the top of the picture, its words along the bottom.
  view(centreOf(2), STATIONS, [0, 7, 28], [0, -0.6, 0], 44, 0),
  view(centreOf(3), FIELD, [0, 14.5, 25], [0, 0, -2.5], 44, -0.17),
  view(centreOf(4), MEDIA, [0, 4.6, 21], [0, 3.7, 0], 42, 0.165),
  { at: centreOf(5), pos: [-8.8, 3.4, 14.8], look: [0, 3.9, 0], fov: 40, shift: -0.17 },
];

/** What the page tells the scene: counts and outcomes, nothing it could embellish. */
export interface TestingWorldData {
  suites: PylonSpec[];
  stations: StationSpec[];
  field: FieldSpec | null;
  media: MediaSpec[];
}

type Json = Record<string, unknown>;
const isObject = (v: unknown): v is Json => typeof v === 'object' && v !== null;
const whole = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0;

function classCounts(v: unknown): FieldSpec['recyclable'] | null {
  if (!isObject(v)) return null;
  const { training, validation, correct } = v;
  return whole(training) && whole(validation) && whole(correct)
    ? { training, validation, correct }
    : null;
}

export function worldFrom(data: unknown): TestingWorldData {
  const out: TestingWorldData = { suites: [], stations: [], field: null, media: [] };
  if (!isObject(data)) return out;
  if (Array.isArray(data.suites)) {
    for (const s of data.suites) {
      if (isObject(s) && typeof s.label === 'string' && whole(s.passed) && whole(s.failed)) {
        out.suites.push({ label: s.label, passed: s.passed, failed: s.failed });
      }
    }
  }
  if (Array.isArray(data.scenarios)) {
    for (const s of data.scenarios) {
      if (isObject(s) && typeof s.id === 'string' && typeof s.passed === 'boolean') {
        out.stations.push({
          id: s.id,
          passed: s.passed,
          counted: whole(s.counted) ? s.counted : 0,
        });
      }
    }
  }
  if (isObject(data.dataset)) {
    const recyclable = classCounts(data.dataset.recyclable);
    const trash = classCounts(data.dataset.trash);
    if (recyclable && trash) out.field = { recyclable, trash };
  }
  if (Array.isArray(data.media)) {
    for (const m of data.media) {
      if (isObject(m) && (m.kind === 'image' || m.kind === 'video')) {
        out.media.push({ kind: m.kind, file: typeof m.file === 'string' ? m.file : null });
      }
    }
  }
  // Nothing recorded: two empty frames, one for a photograph and one for a video.
  if (out.media.length === 0) {
    out.media.push({ kind: 'image', file: null }, { kind: 'video', file: null });
  }
  out.suites = out.suites.slice(0, 4);
  out.stations = out.stations.slice(0, 7);
  out.media = out.media.slice(0, 3);
  return out;
}

export function buildTestingScene(context: BuildContext, data?: unknown): SceneModule {
  const world = worldFrom(data);
  const scene = new Scene();
  const camera = new PerspectiveCamera(36, 1, 0.1, 700);
  const palette = createPalette();
  const anchors = new Map<string, Object3D>();

  scene.fog = new FogExp2(0xd7e3de, 0.0105);
  scene.environment = context.environment;

  const sky = createSky();
  scene.add(sky.group);
  // Nothing is left lying in a set's footprint or at the Sorter.
  const keepClear = (x: number, z: number) =>
    Math.hypot(x, z) < 6 ||
    [PYLONS, STATIONS, FIELD, MEDIA].some((set) => {
      const [px, , pz] = positionOf(set);
      return Math.hypot(x - px, z - pz) < 24;
    });
  const terrain = createTerrain({ segments: context.quality === 'low' ? 48 : 96, keepClear });
  scene.add(terrain.group);

  // The product, in the middle of the ring.
  const sorter = createSorter();
  scene.add(sorter.group);
  anchors.set('top', sorter.anchors.top);
  anchors.set('lens', sorter.anchors.lens);

  const place = (set: number, group: Group) => {
    const [x, , z] = positionOf(set);
    group.position.set(x, 0, z);
    group.rotation.y = rotationOf(set);
    scene.add(group);
  };

  const pylons = createPylons(world.suites, 5.2);
  place(PYLONS, pylons.group);
  pylons.anchors.forEach((a, i) => anchors.set(`pylon-${i}`, a));

  const stations = createStations(world.stations);
  place(STATIONS, stations.group);
  stations.anchors.forEach((a, i) => anchors.set(`station-${i}`, a));

  const field = world.field ? createField(world.field) : null;
  if (field) {
    place(FIELD, field.group);
    anchors.set('field-recyclable', field.anchors.recyclable);
    anchors.set('field-trash', field.anchors.trash);
    anchors.set('field-held', field.anchors.held);
  }

  const media = createMedia(world.media, context.invalidate);
  place(MEDIA, media.group);
  media.anchors.forEach((a, i) => anchors.set(`media-${i}`, a));

  const hemi = new HemisphereLight(0xffffff, 0x9fb0b8, 1.2);
  scene.add(hemi);
  const sun = new DirectionalLight(0xfff1dc, 2.4);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -30;
  sun.shadow.camera.right = 30;
  sun.shadow.camera.top = 26;
  sun.shadow.camera.bottom = -26;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 110;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.04;
  scene.add(sun, sun.target);

  const dust = createDust(1400, new Vector3(70, 36, 70));
  scene.add(dust.points);
  const scraps = createScraps(150, 64);
  scene.add(scraps.mesh);

  let lastFov = 0;
  let quality: Quality = context.quality;
  const focus = new Vector3();

  const built: SceneModule = {
    scene,
    camera,
    anchors,
    viewShift: 0.17,
    bloom: { strength: 0.4, radius: 0.7, threshold: 0.86 },
    exposure: 1,
    update(state: FrameState) {
      paletteAt(state.dark, palette);
      (scene.fog as FogExp2).color.copy(palette.fog);
      (scene.fog as FogExp2).density = palette.fogDensity;
      hemi.color.copy(palette.hemiSky);
      hemi.groundColor.copy(palette.hemiGround);
      hemi.intensity = palette.hemiIntensity;
      sun.color.copy(palette.sun);
      sun.intensity = palette.sunIntensity;
      scene.environmentIntensity = palette.envIntensity;
      built.exposure = palette.exposure;
      built.bloom.strength = quality === 'low' ? 0 : palette.bloomStrength;
      sky.update(palette, state.dark);
      terrain.update(palette);

      sorter.update({
        time: state.time,
        intro: state.intro,
        explode: 0,
        flash: 0,
        motion: state.motion,
        palette,
        quality,
      });
      pylons.update({
        progress: smoothstep(0.75, 1.5, state.chapter),
        time: state.time,
        motion: state.motion,
        palette,
      });
      stations.update({
        progress: smoothstep(1.75, 2.45, state.chapter),
        time: state.time,
        motion: state.motion,
        palette,
      });
      field?.update({
        progress: smoothstep(2.7, 3.5, state.chapter),
        time: state.time,
        motion: state.motion,
        palette,
      });
      media.update({
        progress: smoothstep(3.75, 4.45, state.chapter),
        time: state.time,
        motion: state.motion,
        palette,
      });

      // A narrow screen cannot hold the whole row of screens, so there the camera runs along it.
      const along =
        state.aspect < 0.85
          ? window01(state.chapter, 2.4, 2.9, 0.25) *
            (smoothstep(2.4, 2.9, state.chapter) - 0.5) *
            8
          : 0;
      const slide = inSet(STATIONS, [along, 0, 0]);
      const origin = inSet(STATIONS, [0, 0, 0]);
      const dx = slide[0] - origin[0];
      const dz = slide[2] - origin[2];

      const pose = poseAt(KEYS, state.chapter);
      const sway = state.motion ? 1 : 0;
      camera.position.set(
        pose.pos[0] + dx + Math.sin(state.time * 0.17) * 0.28 * sway + state.pointer.x * 0.55,
        pose.pos[1] + Math.sin(state.time * 0.13 + 1) * 0.16 * sway + state.pointer.y * 0.32,
        pose.pos[2] + dz + Math.cos(state.time * 0.11) * 0.2 * sway,
      );
      // The picture opens a little while the camera is travelling fast: a sense of speed.
      const fov = pose.fov + Math.min(3, Math.abs(state.speed) * 1.6);
      if (Math.abs(fov - lastFov) > 0.001) {
        camera.fov = fov;
        camera.updateProjectionMatrix();
        lastFov = fov;
      }
      camera.lookAt(pose.look[0] + dx, pose.look[1], pose.look[2] + dz);
      built.viewShift = pose.shift;

      // The sun and its shadow follow what the camera is looking at.
      focus.set(pose.look[0] + dx, 0, pose.look[2] + dz);
      sun.target.position.copy(focus);
      sun.position.set(focus.x + 18, 26, focus.z + 15);

      dust.update(camera, state.time, palette.dust, palette.dustOpacity, state.dark > 0.5);
      scraps.update(camera, state.time);
    },
    setQuality(next) {
      quality = next;
      sorter.setQuality(next);
      sun.castShadow = next === 'high';
      dust.setCount(next === 'high' ? 1400 : next === 'medium' ? 900 : 450);
      scraps.setCount(next === 'high' ? 150 : next === 'medium' ? 100 : 60);
    },
    dispose() {
      sky.dispose();
      terrain.dispose();
      sorter.dispose();
      pylons.dispose();
      stations.dispose();
      field?.dispose();
      media.dispose();
      dust.dispose();
      scraps.dispose();
      sun.shadow.map?.dispose();
    },
  };
  built.setQuality(context.quality);
  return built;
}
