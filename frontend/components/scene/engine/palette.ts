// The colours of the 3D world in each theme, blended by the theme switch. Light is a pale
// morning mist; dark is a night where the seams of the machine glow and bloom.

import { Color } from 'three';

import { mix } from '@/lib/scene/math';

export interface Palette {
  fog: Color;
  fogDensity: number;
  ground: Color;
  stone: Color;
  hemiSky: Color;
  hemiGround: Color;
  hemiIntensity: number;
  sun: Color;
  sunIntensity: number;
  glow: Color;
  glowIntensity: number;
  dust: Color;
  dustOpacity: number;
  envIntensity: number;
  exposure: number;
  bloomStrength: number;
}

const hex = (c: number): Color => new Color(c);

const LIGHT = {
  fog: hex(0xd7e3de),
  fogDensity: 0.0105,
  ground: hex(0xb6c9bf),
  stone: hex(0x9aaca4),
  hemiSky: hex(0xf0fbf6),
  hemiGround: hex(0x7f948b),
  hemiIntensity: 0.55,
  sun: hex(0xfff0d8),
  sunIntensity: 2.3,
  glow: hex(0x9ff0cb),
  glowIntensity: 1.7,
  dust: hex(0x9db3a9),
  dustOpacity: 0.4,
  envIntensity: 0.42,
  exposure: 0.88,
  bloomStrength: 0.26,
};

const DARK = {
  fog: hex(0x08130f),
  fogDensity: 0.0138,
  ground: hex(0x0f1c17),
  stone: hex(0x4f645b),
  hemiSky: hex(0x5d7f8e),
  hemiGround: hex(0x08100d),
  hemiIntensity: 0.7,
  sun: hex(0xa9c4ff),
  sunIntensity: 1.1,
  glow: hex(0x5cf0b0),
  glowIntensity: 2.7,
  dust: hex(0xcdf5e4),
  dustOpacity: 0.55,
  envIntensity: 0.5,
  exposure: 1.1,
  bloomStrength: 0.62,
};

export function createPalette(): Palette {
  return {
    fog: new Color(),
    fogDensity: 0,
    ground: new Color(),
    stone: new Color(),
    hemiSky: new Color(),
    hemiGround: new Color(),
    hemiIntensity: 0,
    sun: new Color(),
    sunIntensity: 0,
    glow: new Color(),
    glowIntensity: 0,
    dust: new Color(),
    dustOpacity: 0,
    envIntensity: 0,
    exposure: 1,
    bloomStrength: 0,
  };
}

/** Blends the two themes into `out`: 0 is light, 1 is dark. */
export function paletteAt(dark: number, out: Palette): Palette {
  out.fog.lerpColors(LIGHT.fog, DARK.fog, dark);
  out.ground.lerpColors(LIGHT.ground, DARK.ground, dark);
  out.stone.lerpColors(LIGHT.stone, DARK.stone, dark);
  out.hemiSky.lerpColors(LIGHT.hemiSky, DARK.hemiSky, dark);
  out.hemiGround.lerpColors(LIGHT.hemiGround, DARK.hemiGround, dark);
  out.sun.lerpColors(LIGHT.sun, DARK.sun, dark);
  out.glow.lerpColors(LIGHT.glow, DARK.glow, dark);
  out.dust.lerpColors(LIGHT.dust, DARK.dust, dark);
  out.fogDensity = mix(LIGHT.fogDensity, DARK.fogDensity, dark);
  out.hemiIntensity = mix(LIGHT.hemiIntensity, DARK.hemiIntensity, dark);
  out.sunIntensity = mix(LIGHT.sunIntensity, DARK.sunIntensity, dark);
  out.glowIntensity = mix(LIGHT.glowIntensity, DARK.glowIntensity, dark);
  out.dustOpacity = mix(LIGHT.dustOpacity, DARK.dustOpacity, dark);
  out.envIntensity = mix(LIGHT.envIntensity, DARK.envIntensity, dark);
  out.exposure = mix(LIGHT.exposure, DARK.exposure, dark);
  out.bloomStrength = mix(LIGHT.bloomStrength, DARK.bloomStrength, dark);
  return out;
}

/** The three outcome colours, the same in both themes: they carry meaning, not mood. */
export const OUTCOME = {
  recyclable: hex(0x2fae72),
  trash: hex(0x6d7d88),
  unsure: hex(0xe0a019),
} as const;
