// The engine under every 3D page: one renderer, one loop, and the rules that keep it kind to
// the person watching.
//
//  - It draws only while the page is visible, and only every frame while motion is on. With
//    reduced motion (or the pause button) it draws on demand, once per change, and shows
//    the chapter nearest to where the reader is instead of flying the camera.
//  - It picks a quality tier for the machine (shadows and multisampling only on a graphics
//    card with room for them, bloom on all but the lowest), watches its own frame time, and
//    when it cannot keep up it gives up shadows and multisampling first, then draws fewer
//    pixels, a little at a time, and last gives up bloom.
//  - It compiles every shader and uploads every generated texture before the first frame, so
//    nothing stalls the picture the first time a chapter's objects come into view.
//  - The story's position is a critically damped spring: a wheel's steps, a dragged scrollbar
//    and a jump from the chapter dots all come out as one continuous camera move.
//  - Everything is generated here: no image, model or font is downloaded.

import {
  ACESFilmicToneMapping,
  CanvasTexture,
  DataTexture,
  HalfFloatType,
  type Material,
  type Mesh,
  type Texture,
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
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { FXAAShader } from 'three/examples/jsm/shaders/FXAAShader.js';

import { chapterPosition, currentChapter, type Span } from '@/lib/scene/chapters';
import { type Box, chooseLean, labelBox } from '@/lib/scene/labels';
import { clamp01, damp, type Spring, smoothDamp, window01 } from '@/lib/scene/math';

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
/** A frame slower than this, about 45 per second, is a slow one. */
const SLOW_FRAME = 1 / 45;
/** The slow frames, out of the last WINDOW, that make the picture cheaper. */
const WINDOW = 90;
const TOO_MANY_SLOW = 8;
/** Bloom is a blur, so it is drawn on a smaller picture than the scene. */
const BLOOM_SCALE = 0.5;
/** The least share of its pixels the picture is drawn with before a quality tier is given up. */
const LOWEST_SCALE = 0.62;
/** How long the camera takes to settle on where the reader is, and its top speed. */
const SETTLE_SECONDS = 0.32;
const TOP_SPEED = 3.6;
/** The longest the first compile may hold the picture back before it is drawn anyway. */
const WARM_LIMIT_MS = 5000;

function gpuName(gl: WebGLRenderingContext | WebGL2RenderingContext): string {
  const info = gl.getExtension('WEBGL_debug_renderer_info');
  return info ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : '';
}

function softwareRenderer(name: string): boolean {
  return /swiftshader|llvmpipe|softpipe|software/i.test(name);
}

/**
 * Graphics that share the processor's memory (most laptops) or sit in a phone. Multisampling a
 * floating-point picture and a shadow map both cost them more than a frame has to give, so they
 * start on the middle tier.
 */
function sharedGraphics(name: string): boolean {
  return (/intel/i.test(name) && !/arc/i.test(name)) || /mali|adreno|powervr|videocore/i.test(name);
}

function firstQuality(
  forced: Quality | null | undefined,
  software: boolean,
  name: string,
): Quality {
  if (forced) return forced;
  if (software) return 'low';
  const nav = navigator as Navigator & { deviceMemory?: number };
  if ((nav.hardwareConcurrency ?? 8) <= 4 || (nav.deviceMemory ?? 8) <= 4) return 'medium';
  return sharedGraphics(name) ? 'medium' : 'high';
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
  /** Whether the label is on the page now, so a hidden one is not written to every frame. */
  shown: boolean;
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
  const name = gpuName(gl);
  const software = softwareRenderer(name);
  let quality = firstQuality(options.quality, software, name);

  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.shadowMap.type = PCFSoftShadowMap;

  // Reflections for the glass and metal, from a room built in code.
  const pmrem = new PMREMGenerator(renderer);
  const environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  pmrem.dispose();

  let dirty = true;
  const invalidate = (loaded?: Texture) => {
    if (loaded) renderer.initTexture(loaded);
    dirty = true;
  };

  const mod = options.build({ quality, environment, invalidate });

  let motion = options.motion && options.frame == null;
  let width = 1;
  let height = 1;
  let pixelRatio = 1;
  let composer: EffectComposer | null = null;
  let bloomPass: UnrealBloomPass | null = null;
  let edgePass: ShaderPass | null = null;

  /** Share of the full resolution in use. It only ever goes down, a step at a time. */
  let scale = 1;

  function chooseRatio(): number {
    const device = window.devicePixelRatio || 1;
    if (software) return 0.6;
    const cap = quality === 'high' ? 2 : quality === 'medium' ? 1.5 : 1;
    // A 4K screen at ratio 2 is far more pixels than the scene needs.
    const budget = quality === 'high' ? 3.2e6 : 1.8e6;
    return scale * Math.min(device, cap, Math.sqrt(budget / Math.max(1, width * height)));
  }

  function buildComposer() {
    composer?.dispose();
    composer = null;
    bloomPass = null;
    edgePass = null;
    if (quality === 'low') return;
    // Only the top tier multisamples the picture (and with fewer samples when there are already
    // many pixels). The middle tier smooths the edges with one cheap pass at the end instead.
    const samples = quality === 'high' ? (pixelRatio >= 1.4 ? 2 : 4) : 0;
    const target = new WebGLRenderTarget(width * pixelRatio, height * pixelRatio, {
      type: HalfFloatType,
      samples,
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
    if (samples === 0) {
      edgePass = new ShaderPass(FXAAShader);
      composer.addPass(edgePass);
    }
    sizeComposer();
  }

  /** The off-screen buffer the picture is drawn into, or null when it goes straight to the screen. */
  function drawTarget(): WebGLRenderTarget | null {
    return composer ? composer.readBuffer : null;
  }

  function sizeComposer() {
    if (!composer) return;
    composer.setPixelRatio(pixelRatio);
    composer.setSize(width, height);
    bloomPass?.setSize(width * pixelRatio * BLOOM_SCALE, height * pixelRatio * BLOOM_SCALE);
    edgePass?.material.uniforms.resolution?.value.set(
      1 / (width * pixelRatio),
      1 / (height * pixelRatio),
    );
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
    sizeComposer();
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
      shown: true,
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
    // Reading where the words are forces the page to lay itself out, so it is only done on a
    // frame where some label is going to be drawn.
    let showing = false;
    for (const tag of tags) {
      if (window01(chapter, tag.from, tag.to, 0.28) >= 0.02) {
        showing = true;
        break;
      }
    }
    if (showing) {
      document.querySelectorAll<HTMLElement>('[data-avoid]').forEach((el) => {
        const box = el.getBoundingClientRect();
        if (box.width > 0 && box.bottom > 0 && box.top < height) avoid.push(box);
      });
    }
    for (const tag of tags) {
      const target = mod.anchors.get(tag.anchor);
      const show = window01(chapter, tag.from, tag.to, 0.28);
      if (!target || show < 0.02) {
        if (tag.shown) {
          tag.el.style.opacity = '0';
          tag.el.style.visibility = 'hidden';
          tag.shown = false;
        }
        continue;
      }
      target.getWorldPosition(projected).project(mod.camera);
      if (projected.z > 1) {
        tag.el.style.visibility = 'hidden';
        tag.shown = false;
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
        tag.shown = false;
        continue;
      }
      // A label that is clearly showing keeps its place from the labels after it.
      if (show > 0.5) avoid.push(labelBox(x, y, tag.width, tag.height, lean));
      const side = `${lean[0] === 1 ? 'right' : 'left'}-${lean[1] === 1 ? 'up' : 'down'}`;
      if (tag.el.dataset.side !== side) tag.el.dataset.side = side;

      tag.el.style.visibility = 'visible';
      tag.shown = true;
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
  const spring: Spring = { value: chapter, velocity: 0 };
  /** False until every shader is compiled and every generated texture is on the GPU. */
  let warm = false;
  let intro = motion ? 0 : 1;
  let introChecked = false;
  let shiftApplied = Number.NaN;
  const recent = new Uint8Array(WINDOW);
  let cursor = 0;
  let slowCount = 0;
  let cooldown = 0;
  let framesSeen = 0;
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
    speed: 0,
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
    if (!seen || !warm) return;
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
      // Arriving part-way down the page (a reload) skips the opening, and starts the camera
      // there instead of flying it in from the top.
      if (target > 0.6) {
        animTime = Math.max(animTime, INTRO_SECONDS);
        spring.value = target;
        spring.velocity = 0;
      }
    }
    intro = motion || options.time != null ? clamp01(animTime / INTRO_SECONDS) : 1;
    if (options.time != null && options.time < INTRO_SECONDS)
      intro = clamp01(options.time / INTRO_SECONDS);

    if (options.frame != null) {
      chapter = options.frame;
      state.speed = 0;
    } else if (animate) {
      chapter = smoothDamp(spring, wanted, SETTLE_SECONDS, dt, TOP_SPEED);
      state.speed = spring.velocity;
    } else {
      // Keep the spring where the picture is, so animation can pick up from here.
      chapter = wanted;
      spring.value = wanted;
      spring.velocity = 0;
      state.speed = 0;
    }
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
      // Drawn at half size the same radius reaches twice as far across the picture.
      bloomPass.radius = mod.bloom.radius * BLOOM_SCALE;
      bloomPass.threshold = mod.bloom.threshold;
    }
    const started = performance.now();
    if (composer) composer.render(dt || 0.016);
    else renderer.render(mod.scene, mod.camera);
    placeLabels(chapter);

    if (container.dataset.ready !== 'true') container.dataset.ready = 'true';

    // When the machine cannot keep up, make the picture cheaper: first give up shadows and
    // multisampling (the largest costs, and hardly missed), then draw fewer pixels, a step at
    // a time, and last give up bloom. A few slow frames are no reason; a tenth of them is.
    // Never back up: no flapping.
    if (animate && options.quality == null) {
      framesSeen++;
      if (framesSeen > 40) {
        const slow = elapsed > SLOW_FRAME || performance.now() - started > 20 ? 1 : 0;
        slowCount += slow - (recent[cursor] as number);
        recent[cursor] = slow;
        cursor = (cursor + 1) % WINDOW;
        if (cooldown > 0) {
          cooldown--;
        } else if (slowCount >= TOO_MANY_SLOW) {
          recent.fill(0);
          slowCount = 0;
          cooldown = WINDOW;
          if (quality === 'high') {
            applyQuality('medium');
          } else if (!software && scale > LOWEST_SCALE) {
            scale = Math.max(LOWEST_SCALE, scale * 0.85);
            resize();
          } else if (quality !== 'low') {
            applyQuality('low');
          }
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

  // Compile every shader and upload every generated texture now, with the page still saying
  // "loading", so nothing stalls the picture when a chapter's objects first come into view.
  const uploadTextures = () => {
    const seen = new Set<Texture>();
    mod.scene.traverse((object) => {
      const material = (object as Mesh).material as Material | Material[] | undefined;
      for (const m of Array.isArray(material) ? material : material ? [material] : []) {
        for (const value of Object.values(m)) {
          if (
            (value instanceof DataTexture || value instanceof CanvasTexture) &&
            !seen.has(value)
          ) {
            seen.add(value);
            renderer.initTexture(value);
          }
        }
      }
    });
  };
  const begin = () => {
    if (warm || disposed) return;
    warm = true;
    last = performance.now();
    invalidate();
  };
  const timeout = window.setTimeout(begin, WARM_LIMIT_MS);
  // A shader is built for where it draws: the tone mapping and the colour space differ between
  // the screen and the off-screen buffer the bloom works on. Compile against the one in use, or
  // every object is compiled again the first time it is drawn, a hitch each time a chapter's
  // objects come into view. The compile starts at once; only waiting for it is asynchronous.
  renderer.setRenderTarget(drawTarget());
  const compiling = renderer.compileAsync(mod.scene, mod.camera);
  renderer.setRenderTarget(null);
  void compiling
    .then(uploadTextures)
    .catch(() => undefined)
    .finally(() => {
      window.clearTimeout(timeout);
      begin();
    });

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
      window.clearTimeout(timeout);
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
