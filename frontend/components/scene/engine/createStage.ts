// The engine under every 3D page: one renderer, one loop, and the rules that keep it kind to
// the person watching.
//
//  - It draws only while the page is visible, and only every frame while motion is on. With
//    reduced motion (or the pause button) it draws on demand, once per change, and shows
//    the chapter nearest to where the reader is instead of flying the camera.
//  - It picks a quality tier for the machine (bloom and shadows only where they are
//    affordable), watches its own frame time, and steps down when it cannot keep up.
//  - Everything is generated here: no image, model or font is downloaded.

import {
  ACESFilmicToneMapping,
  HalfFloatType,
  PCFSoftShadowMap,
  PMREMGenerator,
  SRGBColorSpace,
  Vector2,
  Vector3,
  WebGLRenderTarget,
  WebGLRenderer,
} from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';

import { chapterPosition, currentChapter, type Span } from '@/lib/scene/chapters';
import { type Box, chooseLean, labelBox } from '@/lib/scene/labels';
import { clamp01, damp, window01 } from '@/lib/scene/math';

import type { BuildContext, FrameState, Quality, SceneModule, StageHandle } from './types';

export interface StageOptions {
  canvas: HTMLCanvasElement;
  /** The element the canvas fills; its size is the size of the picture. */
  container: HTMLElement;
  /** Where the HTML labels live. They carry data-anchor, data-from and data-to. */
  labelsRoot: HTMLElement | null;
  /** The chapter sections, in order. */
  chapters: () => HTMLElement[];
  build: (context: BuildContext) => SceneModule;
  motion: boolean;
  /** Review hook: hold the camera at this chapter position. */
  frame?: number | null;
  /** Review hook: hold animated time at this value. */
  time?: number | null;
  /** Review hook: force a quality tier. */
  quality?: Quality | null;
  onFailure?: () => void;
}

const INTRO_SECONDS = 3.6;
/** A frame slower than this, 30 per second, counts against the quality tier. */
const SLOW_FRAME = 1 / 30;

function softwareRenderer(gl: WebGLRenderingContext | WebGL2RenderingContext): boolean {
  const info = gl.getExtension('WEBGL_debug_renderer_info');
  const name = info ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : '';
  return /swiftshader|llvmpipe|softpipe|software/i.test(name);
}

function firstQuality(forced: Quality | null | undefined, software: boolean): Quality {
  if (forced) return forced;
  if (software) return 'low';
  const nav = navigator as Navigator & { deviceMemory?: number };
  if ((nav.hardwareConcurrency ?? 8) <= 4 || (nav.deviceMemory ?? 8) <= 4) return 'medium';
  return 'high';
}

function readDark(): number {
  const attr = document.documentElement.getAttribute('data-theme');
  if (attr === 'dark') return 1;
  if (attr === 'light') return 0;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 1 : 0;
}

interface Tag {
  el: HTMLElement;
  text: HTMLElement | null;
  anchor: string;
  from: number;
  to: number;
  /** The way the label leans by design: 1 is right or up, -1 is left or down. */
  leanX: 1 | -1;
  leanY: 1 | -1;
  /** Size of the text box, measured the first time the label shows. */
  width: number;
  height: number;
}

export function createStage(options: StageOptions): StageHandle | null {
  const { canvas, container } = options;
  let renderer: WebGLRenderer;
  try {
    renderer = new WebGLRenderer({
      canvas,
      antialias: true,
      alpha: false,
      powerPreference: 'high-performance',
    });
  } catch {
    return null;
  }

  const gl = renderer.getContext();
  const software = softwareRenderer(gl);
  let quality = firstQuality(options.quality, software);

  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.shadowMap.type = PCFSoftShadowMap;

  // Reflections for the glass and metal, from a room built in code.
  const pmrem = new PMREMGenerator(renderer);
  const environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  pmrem.dispose();

  let dirty = true;
  const invalidate = () => {
    dirty = true;
  };

  const mod = options.build({ quality, environment, invalidate });

  let motion = options.motion && options.frame == null;
  let width = 1;
  let height = 1;
  let pixelRatio = 1;
  let composer: EffectComposer | null = null;
  let bloomPass: UnrealBloomPass | null = null;

  function chooseRatio(): number {
    const device = window.devicePixelRatio || 1;
    if (software) return 0.6;
    const cap = quality === 'high' ? 2 : quality === 'medium' ? 1.5 : 1;
    // A 4K screen at ratio 2 is far more pixels than the scene needs.
    const budget = quality === 'high' ? 3.2e6 : 1.8e6;
    return Math.min(device, cap, Math.sqrt(budget / Math.max(1, width * height)));
  }

  function buildComposer() {
    composer?.dispose();
    composer = null;
    bloomPass = null;
    if (quality === 'low') return;
    const target = new WebGLRenderTarget(width * pixelRatio, height * pixelRatio, {
      type: HalfFloatType,
      samples: quality === 'high' ? 4 : 0,
    });
    composer = new EffectComposer(renderer, target);
    composer.addPass(new RenderPass(mod.scene, mod.camera));
    bloomPass = new UnrealBloomPass(
      new Vector2(width, height),
      mod.bloom.strength,
      mod.bloom.radius,
      mod.bloom.threshold,
    );
    composer.addPass(bloomPass);
    composer.addPass(new OutputPass());
    composer.setPixelRatio(pixelRatio);
    composer.setSize(width, height);
  }

  function applyQuality(next: Quality) {
    quality = next;
    renderer.shadowMap.enabled = quality === 'high';
    mod.setQuality(quality);
    pixelRatio = chooseRatio();
    renderer.setPixelRatio(pixelRatio);
    renderer.setSize(width, height, false);
    buildComposer();
    container.dataset.quality = quality;
    invalidate();
  }

  function resize() {
    width = Math.max(1, container.clientWidth);
    height = Math.max(1, container.clientHeight);
    pixelRatio = chooseRatio();
    renderer.setPixelRatio(pixelRatio);
    renderer.setSize(width, height, false);
    composer?.setPixelRatio(pixelRatio);
    composer?.setSize(width, height);
    mod.camera.aspect = width / height;
    shiftApplied = Number.NaN; // force the view offset to be set again
    invalidate();
  }

  // -- the reader ------------------------------------------------------------------------

  let spans: Span[] = [];
  function measure() {
    const top = window.scrollY;
    spans = options.chapters().map((el) => {
      const box = el.getBoundingClientRect();
      return { top: box.top + top, height: box.height };
    });
    invalidate();
  }

  const pointerTarget = { x: 0, y: 0 };
  const pointer = { x: 0, y: 0 };
  const onPointer = (event: PointerEvent) => {
    pointerTarget.x = (event.clientX / Math.max(1, window.innerWidth)) * 2 - 1;
    pointerTarget.y = -((event.clientY / Math.max(1, window.innerHeight)) * 2 - 1);
  };

  let darkTarget = readDark();
  let dark = darkTarget;
  const colourScheme = window.matchMedia('(prefers-color-scheme: dark)');
  const onTheme = () => {
    darkTarget = readDark();
    invalidate();
  };
  const themeObserver = new MutationObserver(onTheme);
  themeObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-theme'],
  });
  colourScheme.addEventListener('change', onTheme);

  const onScroll = () => {
    if (!motion) invalidate();
  };
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('pointermove', onPointer, { passive: true });

  const sizeObserver = new ResizeObserver(() => {
    resize();
    measure();
  });
  sizeObserver.observe(container);
  sizeObserver.observe(document.body);
  void document.fonts?.ready.then(measure);

  // -- labels ----------------------------------------------------------------------------

  const tags: Tag[] = [];
  options.labelsRoot?.querySelectorAll<HTMLElement>('[data-anchor]').forEach((el) => {
    const side = el.dataset.side ?? 'right-up';
    tags.push({
      el,
      text: el.querySelector<HTMLElement>('[data-text]'),
      anchor: el.dataset.anchor ?? '',
      from: Number(el.dataset.from ?? 0),
      to: Number(el.dataset.to ?? 99),
      leanX: side.startsWith('left') ? -1 : 1,
      leanY: side.endsWith('down') ? -1 : 1,
      width: 0,
      height: 0,
    });
  });
  const projected = new Vector3();

  // The words and controls of the page that a label must not land on.
  const avoid: Box[] = [];
  const view: Box = { left: 0, top: 0, right: 0, bottom: 0 };

  function placeLabels(chapter: number) {
    view.left = 10;
    view.top = 86; // below the header
    view.right = width - 10;
    view.bottom = height - 10;
    avoid.length = 0;
    if (tags.length > 0) {
      document.querySelectorAll<HTMLElement>('[data-avoid]').forEach((el) => {
        const box = el.getBoundingClientRect();
        if (box.width > 0 && box.bottom > 0 && box.top < height) avoid.push(box);
      });
    }
    for (const tag of tags) {
      const target = mod.anchors.get(tag.anchor);
      const show = window01(chapter, tag.from, tag.to, 0.28);
      if (!target || show < 0.02) {
        tag.el.style.opacity = '0';
        tag.el.style.visibility = 'hidden';
        continue;
      }
      target.getWorldPosition(projected).project(mod.camera);
      if (projected.z > 1) {
        tag.el.style.visibility = 'hidden';
        continue;
      }
      // The picture may be shifted sideways to leave room for text: move the labels with it.
      const x = ((projected.x + 1) / 2) * width;
      const y = ((1 - projected.y) / 2) * height;

      // Lean to a side that has room: on the screen, below the header, and clear of the page's
      // words. With no such side the label is hidden rather than left half-covered.
      if (tag.width === 0) {
        tag.width = tag.text?.offsetWidth ?? 230;
        tag.height = tag.text?.offsetHeight ?? 52;
      }
      const lean = chooseLean(x, y, tag.width, tag.height, [tag.leanX, tag.leanY], view, avoid);
      if (lean === null) {
        tag.el.style.opacity = '0';
        tag.el.style.visibility = 'hidden';
        continue;
      }
      // A label that is clearly showing keeps its place from the labels after it.
      if (show > 0.5) avoid.push(labelBox(x, y, tag.width, tag.height, lean));
      const side = `${lean[0] === 1 ? 'right' : 'left'}-${lean[1] === 1 ? 'up' : 'down'}`;
      if (tag.el.dataset.side !== side) tag.el.dataset.side = side;

      tag.el.style.visibility = 'visible';
      tag.el.style.opacity = String(show);
      tag.el.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`;
    }
  }

  // -- the loop --------------------------------------------------------------------------

  let disposed = false;
  let raf = 0;
  let last = performance.now();
  let animTime = options.time ?? 0;
  let chapter = options.frame ?? 0;
  let intro = motion ? 0 : 1;
  let introChecked = false;
  let shiftApplied = Number.NaN;
  let slowFrames = 0;
  let warm = 0;
  let renderedChapter = Number.NaN;

  const state: FrameState = {
    time: animTime,
    dt: 0,
    chapter,
    dark,
    motion,
    pointer,
    quality,
    intro,
    aspect: 1,
  };

  function applyView() {
    const shift = mod.viewShift;
    if (shift === shiftApplied && mod.camera.aspect === width / height) return;
    shiftApplied = shift;
    mod.camera.aspect = width / height;
    // On a tall, narrow screen the designed field of view is kept across the narrow side, so
    // a set is not cropped to a sliver.
    mod.camera.zoom = mod.camera.aspect < 1 ? Math.max(0.4, mod.camera.aspect) : 1;
    // Beside text on a wide screen, the picture moves sideways. On a narrow one the words sit in
    // the lower half, so the picture moves up into the half that is left.
    if (mod.camera.aspect >= 0.85) {
      mod.camera.setViewOffset(width, height, -shift * width, 0, width, height);
    } else {
      mod.camera.setViewOffset(width, height, 0, 0.2 * height, width, height);
    }
    mod.camera.updateProjectionMatrix();
  }

  /** True while an element marked `data-covers-stage` fills the whole window. */
  function covered(): boolean {
    const cover = document.querySelector('[data-covers-stage]');
    if (cover === null) return false;
    const box = cover.getBoundingClientRect();
    return box.top <= 0 && box.bottom >= window.innerHeight;
  }

  function frame(now: number) {
    raf = requestAnimationFrame(frame);
    if (disposed) return;
    const seen = !document.hidden;
    const elapsed = Math.min(0.1, (now - last) / 1000);
    last = now;
    if (!seen) return;
    // A solid page that fills the screen (the full results) hides the world: draw nothing.
    if (covered()) return;

    const animate = motion;
    const target = options.frame ?? chapterPosition(spans, window.scrollY, window.innerHeight);
    const wanted = animate ? target : currentChapter(target, Math.max(1, spans.length));
    if (!animate && !dirty && renderedChapter === wanted) return;
    dirty = false;

    const dt = animate ? elapsed : 0;
    if (animate) animTime += dt;
    if (options.time != null) animTime = options.time;

    if (!introChecked && spans.length > 0) {
      introChecked = true;
      // Arriving part-way down the page (a reload) skips the opening.
      if (target > 0.6) animTime = Math.max(animTime, INTRO_SECONDS);
    }
    intro = motion || options.time != null ? clamp01(animTime / INTRO_SECONDS) : 1;
    if (options.time != null && options.time < INTRO_SECONDS)
      intro = clamp01(options.time / INTRO_SECONDS);

    chapter =
      options.frame != null ? options.frame : animate ? damp(chapter, wanted, 4.2, dt) : wanted;
    renderedChapter = wanted;
    dark = animate ? damp(dark, darkTarget, 3, dt) : darkTarget;
    pointer.x = animate ? damp(pointer.x, pointerTarget.x, 4, dt) : 0;
    pointer.y = animate ? damp(pointer.y, pointerTarget.y, 4, dt) : 0;

    state.time = animTime;
    state.dt = dt;
    state.chapter = chapter;
    state.dark = dark;
    state.motion = animate;
    state.quality = quality;
    state.intro = intro;
    state.aspect = width / height;
    mod.update(state);
    applyView();

    renderer.toneMappingExposure = mod.exposure;
    if (bloomPass) {
      bloomPass.strength = mod.bloom.strength;
      bloomPass.radius = mod.bloom.radius;
      bloomPass.threshold = mod.bloom.threshold;
    }
    const started = performance.now();
    if (composer) composer.render(dt || 0.016);
    else renderer.render(mod.scene, mod.camera);
    placeLabels(chapter);

    if (container.dataset.ready !== 'true') container.dataset.ready = 'true';

    // Step the quality down when the machine cannot keep up. Never back up: no flapping.
    if (animate && options.quality == null) {
      warm++;
      if (warm > 40) {
        slowFrames =
          elapsed > SLOW_FRAME || performance.now() - started > 24
            ? slowFrames + 1
            : Math.max(0, slowFrames - 2);
        if (slowFrames > 75 && quality !== 'low') {
          slowFrames = 0;
          applyQuality(quality === 'high' ? 'medium' : 'low');
        }
      }
    }
  }

  const onLost = (event: Event) => {
    event.preventDefault();
    cancelAnimationFrame(raf);
    container.dataset.ready = 'false';
    options.onFailure?.();
  };
  canvas.addEventListener('webglcontextlost', onLost);

  container.dataset.renderer = software ? 'software' : 'gpu';
  container.dataset.motion = motion ? 'animated' : 'still';
  resize();
  measure();
  applyQuality(quality);
  raf = requestAnimationFrame(frame);

  return {
    get motion() {
      return motion;
    },
    setMotion(on: boolean) {
      motion = on && options.frame == null;
      container.dataset.motion = motion ? 'animated' : 'still';
      last = performance.now();
      invalidate();
    },
    dispose() {
      disposed = true;
      cancelAnimationFrame(raf);
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('pointermove', onPointer);
      canvas.removeEventListener('webglcontextlost', onLost);
      colourScheme.removeEventListener('change', onTheme);
      themeObserver.disconnect();
      sizeObserver.disconnect();
      mod.dispose();
      composer?.dispose();
      environment.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
    },
  };
}
