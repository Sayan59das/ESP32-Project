// The home story: eight chapters flown through in one continuous world.
//
//   0  EcoSort Edge          the Sorter, a bin, assembles in the haze
//   1  Why we built it       its parts begin to separate
//   2  How it sees           the lens, and the 160 by 120 frame the model reads
//   3  Three outcomes        a lane, a scan gate, and three places an item can end up
//   4  Counted once          one item at the gate
//   5  The server owns it    the pipeline, from camera to console
//   6  Built to be tested    the checks, as towers of light
//   7  See it work           everything, together

import {
  DirectionalLight,
  FogExp2,
  HemisphereLight,
  type Object3D,
  PerspectiveCamera,
  Scene,
  Vector3,
} from 'three';

import { centreOf } from '@/lib/scene/chapters';
import { curve01, smoothstep, window01 } from '@/lib/scene/math';
import { type Key, poseAt } from '@/lib/scene/rig';

import { createDust } from '../engine/dust';
import { createPalette, paletteAt } from '../engine/palette';
import { createScraps } from '../engine/scraps';
import type { BuildContext, FrameState, Quality, SceneModule } from '../engine/types';
import { createFrameScreen } from './frames';
import { createLane } from './lane';
import { createPipeline } from './pipeline';
import { createPylons, type PylonSpec } from './pylons';
import { createSky } from './sky';
import { createSorter } from './sorter';
import { createTerrain } from './terrain';

export const HOME_CHAPTERS = 8;

// A chapter's words are pinned for the middle of its section, so each pose is keyed to the
// chapter's centre and the camera rests while it is read. It moves as one chapter's words leave
// and the next arrive. The extra keys are moves made on the way: a pull back to see the whole
// lane (5.0), and a slide along the pipeline (5.4 to 5.75).
const KEYS: Key[] = [
  { at: centreOf(0), pos: [7.9, 3.1, 13.8], look: [0, 3.9, 0], fov: 40, shift: 0.17 },
  { at: centreOf(1), pos: [8.4, 2.6, 10.6], look: [-0.6, 3.7, 0.4], fov: 40, shift: -0.15 },
  { at: centreOf(2), pos: [2.8, 3.7, 13.4], look: [0.2, 3.45, 3.4], fov: 38, shift: 0.16 },
  { at: centreOf(3), pos: [13.6, 9.2, 11.6], look: [20.2, 0.6, 0], fov: 44, shift: 0.09 },
  { at: centreOf(4), pos: [9.4, 2.3, 6.6], look: [14.4, 1.6, 0], fov: 36, shift: -0.14 },
  { at: 5.0, pos: [2, 9.8, 23], look: [2, 2.4, 0], fov: 48, shift: 0 },
  // The whole pipeline in one wide shot, high in the picture: its words run along the bottom.
  { at: centreOf(5), pos: [-47.5, 7.4, 32], look: [-47.5, -0.4, 0], fov: 38, shift: 0 },
  // The towers stand in the left of the picture, clear of the words on the right.
  { at: centreOf(6), pos: [0, 5.8, 60], look: [0, 5, 34], fov: 42, shift: -0.2 },
  { at: centreOf(7), pos: [8.8, 3.4, 14.8], look: [0, 3.9, 0], fov: 40, shift: 0.17 },
];

/** How far the Sorter has opened at each chapter: 0 is closed, 1 is fully apart. */
const EXPLODE: readonly (readonly [number, number])[] = [
  [centreOf(0), 0],
  [centreOf(1), 0.12],
  [centreOf(2), 0.4],
  [centreOf(3), 0.8],
  [centreOf(4), 0.95],
  [centreOf(5), 1],
  [centreOf(6), 0.25],
  [centreOf(7), 0],
];

/** What the page tells the scene about the checks: only counts, nothing it could embellish. */
function suitesFrom(data: unknown): PylonSpec[] {
  if (typeof data !== 'object' || data === null) return [];
  const suites = (data as { suites?: unknown }).suites;
  if (!Array.isArray(suites)) return [];
  const out: PylonSpec[] = [];
  for (const s of suites) {
    if (typeof s !== 'object' || s === null) continue;
    const { label, passed, failed } = s as Record<string, unknown>;
    if (typeof label === 'string' && typeof passed === 'number' && typeof failed === 'number') {
      out.push({ label, passed, failed });
    }
  }
  return out.slice(0, 3);
}

export function buildHomeScene(context: BuildContext, data?: unknown): SceneModule {
  const scene = new Scene();
  const camera = new PerspectiveCamera(36, 1, 0.1, 700);
  const palette = createPalette();
  const anchors = new Map<string, Object3D>();

  scene.fog = new FogExp2(0xd7e3de, 0.0125);
  scene.environment = context.environment;

  const sky = createSky();
  scene.add(sky.group);

  // Where nothing is left lying: the lane and its bins, the pipeline, the way to the towers,
  // and the Sorter.
  const keepClear = (x: number, z: number) =>
    (x > 3 && x < 30 && Math.abs(z) < 8) ||
    (x < -8 && x > -66 && Math.abs(z) < 8) ||
    (Math.abs(x) < 16 && z > 18 && z < 80) ||
    Math.hypot(x, z) < 6;
  const terrain = createTerrain({ segments: context.quality === 'low' ? 48 : 96, keepClear });
  scene.add(terrain.group);

  const sorter = createSorter();
  scene.add(sorter.group);
  anchors.set('lens', sorter.anchors.lens);
  anchors.set('top', sorter.anchors.top);
  anchors.set('frame', sorter.anchors.frame);

  const frame = createFrameScreen(context.invalidate);
  frame.group.position.set(0, 3.4, sorter.anchors.frame.position.z);
  scene.add(frame.group);

  const lane = createLane();
  scene.add(lane.group);
  anchors.set('gate', lane.anchors.gate);
  anchors.set('bin-recyclable', lane.anchors.recyclable);
  anchors.set('bin-trash', lane.anchors.trash);
  anchors.set('bin-unsure', lane.anchors.unsure);

  const pipeline = createPipeline();
  scene.add(pipeline.group);
  anchors.set('node-camera', pipeline.anchors.camera);
  anchors.set('node-model', pipeline.anchors.model);
  anchors.set('node-server', pipeline.anchors.server);
  anchors.set('node-console', pipeline.anchors.console);

  const pylons = createPylons(suitesFrom(data));
  pylons.group.position.set(0, 0, 34);
  scene.add(pylons.group);
  pylons.anchors.forEach((a, i) => anchors.set(`pylon-${i}`, a));

  const hemi = new HemisphereLight(0xffffff, 0x9fb0b8, 1.2);
  scene.add(hemi);
  const sun = new DirectionalLight(0xfff1dc, 2.4);
  sun.position.set(18, 26, 15);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -30;
  sun.shadow.camera.right = 30;
  sun.shadow.camera.top = 26;
  sun.shadow.camera.bottom = -26;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 100;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.04;
  scene.add(sun);
  scene.add(sun.target);
  sun.target.position.set(8, 0, 0);

  const dust = createDust(1400, new Vector3(70, 36, 70));
  scene.add(dust.points);
  const scraps = createScraps(150, 64);
  scene.add(scraps.mesh);

  let lastFov = 0;
  let quality: Quality = context.quality;

  const world: SceneModule = {
    scene,
    camera,
    anchors,
    viewShift: 0.17,
    bloom: { strength: 0.4, radius: 0.7, threshold: 0.86 },
    exposure: 1,
    update(state: FrameState) {
      paletteAt(state.dark, palette);

      // The world, in the colours of the theme.
      (scene.fog as FogExp2).color.copy(palette.fog);
      (scene.fog as FogExp2).density = palette.fogDensity;
      hemi.color.copy(palette.hemiSky);
      hemi.groundColor.copy(palette.hemiGround);
      hemi.intensity = palette.hemiIntensity;
      sun.color.copy(palette.sun);
      sun.intensity = palette.sunIntensity;
      scene.environmentIntensity = palette.envIntensity;
      world.exposure = palette.exposure;
      // Glow spreads over a picture it sits in front of, which would tint the frame the model
      // reads. Hold it back while that frame is on screen.
      const framing = window01(state.chapter, 2.15, 2.85, 0.4);
      world.bloom.strength = quality === 'low' ? 0 : palette.bloomStrength * (1 - 0.8 * framing);
      sky.update(palette, state.dark);
      terrain.update(palette);

      // The lane runs first: when an item is under the gate the Sorter's light flares.
      const counted = lane.update({
        time: state.time,
        chapter: state.chapter,
        motion: state.motion,
        palette,
      });

      sorter.update({
        time: state.time,
        intro: state.intro,
        explode: curve01(EXPLODE, state.chapter),
        flash: counted * 0.55,
        motion: state.motion,
        palette,
        quality,
      });
      frame.update({
        time: state.time,
        chapter: state.chapter,
        motion: state.motion,
        palette,
        y: sorter.anchors.frame.position.y,
      });
      pipeline.update({ time: state.time, motion: state.motion, palette });
      pylons.update({
        progress: smoothstep(5.95, 6.45, state.chapter),
        time: state.time,
        motion: state.motion,
        palette,
      });

      // The camera.
      const pose = poseAt(KEYS, state.chapter);
      // A narrow screen cannot hold the whole pipeline, so there the camera arrives at the
      // camera board and then follows the data on to the console.
      const follow =
        state.aspect < 0.85
          ? window01(state.chapter, 5.45, 5.95, 0.25) *
            (smoothstep(5.45, 5.95, state.chapter) - 0.5) *
            21
          : 0;
      const sway = state.motion ? 1 : 0;
      camera.position.set(
        pose.pos[0] + follow + Math.sin(state.time * 0.17) * 0.28 * sway + state.pointer.x * 0.55,
        pose.pos[1] + Math.sin(state.time * 0.13 + 1) * 0.16 * sway + state.pointer.y * 0.32,
        pose.pos[2] + Math.cos(state.time * 0.11) * 0.2 * sway,
      );
      // The picture opens a little while the camera is travelling fast: a sense of speed.
      const fov = pose.fov + Math.min(3, Math.abs(state.speed) * 1.6);
      if (Math.abs(fov - lastFov) > 0.001) {
        camera.fov = fov;
        camera.updateProjectionMatrix();
        lastFov = fov;
      }
      camera.lookAt(pose.look[0] + follow, pose.look[1], pose.look[2]);
      world.viewShift = pose.shift;

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
      frame.dispose();
      lane.dispose();
      pipeline.dispose();
      pylons.dispose();
      dust.dispose();
      scraps.dispose();
      sun.shadow.map?.dispose();
    },
  };
  world.setQuality(context.quality);
  return world;
}
