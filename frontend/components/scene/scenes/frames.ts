// A floating screen that shows what the classifier is given: one of the project's own 160 by
// 120 training frames, enlarged with hard pixel edges. The frames are real photographs from
// Model/dataset (two cans, a foil packet and a phone case), served from this site.

import {
  AdditiveBlending,
  BoxGeometry,
  Color,
  Group,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  ShaderMaterial,
  type Texture,
} from 'three';

import { at, window01 } from '@/lib/scene/math';

import type { Palette } from '../engine/palette';
import { loadFrame } from '../engine/textures';

const FRAMES = [
  '/scene/frames/recyclable-1.png',
  '/scene/frames/non-recyclable-1.png',
  '/scene/frames/recyclable-2.png',
  '/scene/frames/non-recyclable-2.png',
];

const SWEEP_VERTEX = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const SWEEP_FRAGMENT = /* glsl */ `
  uniform vec3 uColor;
  uniform float uTime;
  uniform float uOpacity;
  varying vec2 vUv;
  void main() {
    float sweep = smoothstep(0.1, 0.0, abs(vUv.y - fract(uTime * 0.28)));
    gl_FragColor = vec4(uColor, sweep * 0.4 * uOpacity);
  }
`;

export interface FrameScreen {
  group: Group;
  update(args: {
    time: number;
    chapter: number;
    motion: boolean;
    palette: Palette;
    /** Height of the screen: it floats level with the lens. */
    y: number;
  }): void;
  dispose(): void;
}

export function createFrameScreen(invalidate: () => void): FrameScreen {
  const group = new Group();
  const textures: Texture[] = FRAMES.map((url) => loadFrame(url, invalidate));
  const width = 3.6;
  const height = 2.7;

  const screenMaterial = new MeshBasicMaterial({
    map: textures[0] ?? null,
    toneMapped: false,
    transparent: true,
  });
  const screenGeometry = new PlaneGeometry(width, height);
  const screen = new Mesh(screenGeometry, screenMaterial);
  group.add(screen);

  // A pixel grid and a sweeping line over it, so the picture reads as being scanned.
  const sweepMaterial = new ShaderMaterial({
    vertexShader: SWEEP_VERTEX,
    fragmentShader: SWEEP_FRAGMENT,
    uniforms: {
      uColor: { value: new Color(0x9ff0cb) },
      uTime: { value: 0 },
      uOpacity: { value: 1 },
    },
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
  });
  const sweep = new Mesh(new PlaneGeometry(width, height), sweepMaterial);
  sweep.position.z = 0.01;
  group.add(sweep);

  // The frame round it.
  const borderMaterial = new MeshBasicMaterial({ color: 0x9ff0cb, toneMapped: false });
  const bars: BoxGeometry[] = [];
  for (const [x, y, w, h] of [
    [0, height / 2 + 0.06, width + 0.24, 0.07],
    [0, -height / 2 - 0.06, width + 0.24, 0.07],
    [-width / 2 - 0.06, 0, 0.07, height + 0.12],
    [width / 2 + 0.06, 0, 0.07, height + 0.12],
  ] as const) {
    const g = new BoxGeometry(w, h, 0.05);
    bars.push(g);
    const bar = new Mesh(g, borderMaterial);
    bar.position.set(x, y, 0);
    group.add(bar);
  }

  let shown = -1;

  return {
    group,
    update({ time, chapter, motion, palette, y }) {
      const appear = window01(chapter, 2.15, 2.85, 0.4);
      group.visible = appear > 0.01;
      if (!group.visible) return;
      group.scale.setScalar(0.55 + appear * 0.45);
      screenMaterial.opacity = appear;
      sweepMaterial.uniforms.uOpacity!.value = appear;
      sweepMaterial.uniforms.uTime!.value = motion ? time : 0.5;
      borderMaterial.color
        .copy(palette.glow)
        .multiplyScalar(Math.min(palette.glowIntensity, 2.2) * appear);
      (sweepMaterial.uniforms.uColor!.value as Color).copy(palette.glow);

      // The frames take turns, a cycle of about three seconds each.
      const index = motion ? Math.floor(time / 3) % FRAMES.length : 0;
      if (index !== shown) {
        shown = index;
        screenMaterial.map = at(textures, index);
        screenMaterial.needsUpdate = true;
      }
      group.position.y = y + (motion ? Math.sin(time * 0.8) * 0.06 : 0);
    },
    dispose() {
      for (const t of textures) t.dispose();
      screenGeometry.dispose();
      screenMaterial.dispose();
      sweep.geometry.dispose();
      sweepMaterial.dispose();
      borderMaterial.dispose();
      for (const g of bars) g.dispose();
    },
  };
}
