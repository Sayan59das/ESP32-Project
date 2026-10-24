// Drifting specks in the air: the sense of depth and weather in the scene. All the motion is in
// the vertex shader, so this costs one draw call and no JavaScript per frame beyond a uniform.

import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  NormalBlending,
  type PerspectiveCamera,
  Points,
  ShaderMaterial,
  Vector3,
} from 'three';

import { mulberry32 } from '@/lib/scene/math';

const VERTEX = /* glsl */ `
  uniform float uTime;
  uniform float uSize;
  uniform vec3 uBox;
  uniform vec3 uWind;
  attribute vec3 aSeed;
  varying float vFade;
  void main() {
    vec3 p = aSeed * uBox;
    p += uWind * uTime * (0.5 + aSeed.x);
    p.y -= uTime * (0.25 + aSeed.y * 0.5);
    p.x += sin(uTime * 0.3 + aSeed.z * 31.0) * 0.6;
    p = mod(p, uBox) - 0.5 * uBox;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    float depth = max(-mv.z, 0.1);
    gl_PointSize = clamp(uSize * (0.35 + aSeed.y) * (60.0 / depth), 1.0, 14.0);
    // Fade in from the camera and out towards the edge of the box.
    vFade = smoothstep(0.4, 4.0, depth) * (1.0 - smoothstep(0.35 * uBox.x, 0.5 * uBox.x, length(p.xz)));
  }
`;

const FRAGMENT = /* glsl */ `
  uniform vec3 uColor;
  uniform float uOpacity;
  varying float vFade;
  void main() {
    float d = length(gl_PointCoord - 0.5);
    float a = smoothstep(0.5, 0.05, d);
    gl_FragColor = vec4(uColor, a * uOpacity * vFade);
  }
`;

export interface Dust {
  points: Points;
  /** Move the box of specks to wrap around the camera, and advance their drift. */
  update(
    camera: PerspectiveCamera,
    time: number,
    colour: Color,
    opacity: number,
    glowing: boolean,
  ): void;
  setCount(count: number): void;
  dispose(): void;
}

export function createDust(count: number, box: Vector3, seed = 7): Dust {
  const rand = mulberry32(seed);
  const seeds = new Float32Array(count * 3);
  for (let i = 0; i < seeds.length; i++) seeds[i] = rand();
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(count * 3), 3));
  geometry.setAttribute('aSeed', new BufferAttribute(seeds, 3));

  const material = new ShaderMaterial({
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    uniforms: {
      uTime: { value: 0 },
      uSize: { value: 2.2 },
      uBox: { value: box.clone() },
      uWind: { value: new Vector3(0.35, 0, 0.1) },
      uColor: { value: new Color(0xffffff) },
      uOpacity: { value: 0.6 },
    },
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
  });
  const points = new Points(geometry, material);
  points.frustumCulled = false;

  return {
    points,
    update(camera, time, colour, opacity, glowing) {
      points.position.copy(camera.position);
      material.uniforms.uTime!.value = time;
      (material.uniforms.uColor!.value as Color).copy(colour);
      material.uniforms.uOpacity!.value = opacity;
      // Light specks glow against a dark night; against pale mist they are grey flecks.
      const blending = glowing ? AdditiveBlending : NormalBlending;
      if (material.blending !== blending) {
        material.blending = blending;
        material.needsUpdate = true;
      }
    },
    setCount(next) {
      geometry.setDrawRange(0, Math.min(next, count));
    },
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}
