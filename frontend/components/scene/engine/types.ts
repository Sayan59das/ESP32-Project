import type { Object3D, PerspectiveCamera, Scene, Texture } from 'three';

export type Quality = 'high' | 'medium' | 'low';

/** Everything a scene needs to draw one frame. */
export interface FrameState {
  /** Seconds of animated time. Frozen while motion is off, so a still view is repeatable. */
  time: number;
  /** Seconds since the last frame; 0 while motion is off. */
  dt: number;
  /** Where the reader is in the story: 2.5 is halfway through the third chapter. */
  chapter: number;
  /** 0 for the light theme, 1 for the dark one, smoothed between them. */
  dark: number;
  /** False when the reader prefers reduced motion or paused the animation. */
  motion: boolean;
  /** Pointer position from -1 to 1, smoothed. 0, 0 while motion is off. */
  pointer: { x: number; y: number };
  quality: Quality;
  /** The opening assembly, 0 to 1. Always 1 while motion is off. */
  intro: number;
  aspect: number;
  /** How fast the story is travelling, in chapters per second. 0 while motion is off. */
  speed: number;
}

/** What the engine gives a scene when it builds it. */
export interface BuildContext {
  quality: Quality;
  /** Reflections for glass and metal, made from a generated room: no image is downloaded. */
  environment: Texture | null;
  /** Ask for the next frame to be drawn, for a still view when something finished loading. */
  invalidate: () => void;
}

/** A scene the engine can run. */
export interface SceneModule {
  scene: Scene;
  camera: PerspectiveCamera;
  /** Points in the scene that HTML labels follow, by name. */
  anchors: Map<string, Object3D>;
  /** Sideways shift of the picture as a fraction of its width, to leave room for text. */
  viewShift: number;
  /** The scene sets these each frame; the engine applies them to the bloom pass. */
  bloom: { strength: number; radius: number; threshold: number };
  exposure: number;
  update(state: FrameState): void;
  setQuality(quality: Quality): void;
  dispose(): void;
}

/** Builds a scene. `data` is whatever the page passed to the stage, for scenes that show facts. */
export type SceneBuilder = (context: BuildContext, data: unknown) => SceneModule;

export interface StageHandle {
  setMotion(on: boolean): void;
  readonly motion: boolean;
  dispose(): void;
}
