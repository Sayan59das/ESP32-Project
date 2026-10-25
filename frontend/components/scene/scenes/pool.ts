// A soft pool of light on the ground under whatever the story is about. It moves with the
// camera's focus, so every chapter has the same amount of glow: the bin at the start, the gate
// and the bins in the middle, the pipeline, the towers. Without it the glow belongs to the Sorter
// alone, and the world goes flat and grey as soon as the camera looks away from it.

import { AdditiveBlending, CircleGeometry, Color, Mesh, ShaderMaterial } from 'three';

import type { Palette } from '../engine/palette';

const VERTEX = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const FRAGMENT = /* glsl */ `
  uniform vec3 uColor;
  uniform float uOpacity;
  varying vec2 vUv;
  void main() {
    float d = length(vUv - 0.5) * 2.0;
    float a = pow(1.0 - smoothstep(0.0, 1.0, d), 2.2);
    gl_FragColor = vec4(uColor, a * uOpacity);
  }
`;

export interface Pool {
  mesh: Mesh;
  /** Put the pool at (x, z) on the ground, `across` wide by `along` deep, 0 to 1 bright. */
  update(args: {
    x: number;
    z: number;
    across: number;
    along: number;
    strength: number;
    palette: Palette;
  }): void;
  dispose(): void;
}

export function createPool(): Pool {
  const geometry = new CircleGeometry(1, 64);
  geometry.rotateX(-Math.PI / 2);
  const material = new ShaderMaterial({
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    uniforms: { uColor: { value: new Color() }, uOpacity: { value: 0 } },
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
  });
  const mesh = new Mesh(geometry, material);
  mesh.position.y = 0.07;
  mesh.frustumCulled = false;
  mesh.renderOrder = 1;

  return {
    mesh,
    update({ x, z, across, along, strength, palette }) {
      mesh.position.x = x;
      mesh.position.z = z;
      mesh.scale.set(across, 1, along);
      (material.uniforms.uColor!.value as Color).copy(palette.glow);
      // The same brightness in both themes as far as the eye goes: light adds less to a pale
      // ground than to a dark one.
      material.uniforms.uOpacity!.value = strength * palette.poolOpacity;
    },
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}
