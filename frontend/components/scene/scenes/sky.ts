// The sky: a gradient dome from the haze at the horizon to a clearer colour overhead, and, at
// night, a scatter of stars. It never changes with the camera, so it needs no fog of its own.

import {
  BackSide,
  BufferAttribute,
  BufferGeometry,
  Color,
  Group,
  Mesh,
  Points,
  PointsMaterial,
  ShaderMaterial,
  SphereGeometry,
} from 'three';

import { mulberry32 } from '@/lib/scene/math';

import type { Palette } from '../engine/palette';

const VERTEX = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = normalize(position);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const FRAGMENT = /* glsl */ `
  uniform vec3 uHorizon;
  uniform vec3 uZenith;
  varying vec3 vDir;
  void main() {
    float h = clamp(vDir.y, 0.0, 1.0);
    float t = pow(h, 0.55);
    gl_FragColor = vec4(mix(uHorizon, uZenith, t), 1.0);
  }
`;

export interface Sky {
  group: Group;
  update(palette: Palette, dark: number): void;
  dispose(): void;
}

const ZENITH_LIGHT = new Color(0xb9cdd8);
const ZENITH_DARK = new Color(0x0a1a16);

export function createSky(): Sky {
  const group = new Group();
  const material = new ShaderMaterial({
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    uniforms: { uHorizon: { value: new Color() }, uZenith: { value: new Color() } },
    side: BackSide,
    depthWrite: false,
    fog: false,
  });
  const dome = new Mesh(new SphereGeometry(520, 32, 20), material);
  dome.renderOrder = -10;
  dome.frustumCulled = false;
  group.add(dome);

  const rand = mulberry32(99);
  const count = 700;
  const positions = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const theta = rand() * Math.PI * 2;
    const y = 0.12 + rand() * 0.88; // above the horizon
    const r = Math.sqrt(1 - y * y);
    positions[i * 3] = Math.cos(theta) * r * 500;
    positions[i * 3 + 1] = y * 500;
    positions[i * 3 + 2] = Math.sin(theta) * r * 500;
  }
  const starGeometry = new BufferGeometry();
  starGeometry.setAttribute('position', new BufferAttribute(positions, 3));
  const starMaterial = new PointsMaterial({
    color: 0xdbeaff,
    size: 1.8,
    sizeAttenuation: false,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    fog: false,
  });
  const stars = new Points(starGeometry, starMaterial);
  stars.frustumCulled = false;
  group.add(stars);

  return {
    group,
    update(palette, dark) {
      (material.uniforms.uHorizon!.value as Color).copy(palette.fog);
      (material.uniforms.uZenith!.value as Color).lerpColors(ZENITH_LIGHT, ZENITH_DARK, dark);
      starMaterial.opacity = Math.max(0, dark - 0.25) * 1.2;
      stars.visible = starMaterial.opacity > 0.01;
    },
    dispose() {
      dome.geometry.dispose();
      material.dispose();
      starGeometry.dispose();
      starMaterial.dispose();
    },
  };
}
