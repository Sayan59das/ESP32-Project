'use client';

import { useEffect, useRef, useState } from 'react';

import { Button } from '@/components/ui/Button';

import type { SceneBuilder, StageHandle } from './engine/types';
import styles from './Stage.module.css';

/** A label pinned to a point in the 3D scene. The text is also in the page; this is a pointer. */
export interface LabelSpec {
  id: string;
  /** The name of the anchor in the scene. */
  anchor: string;
  /** Visible between these chapter positions. */
  from: number;
  to: number;
  text: string;
  detail?: string;
  /** Which way the label leans off its point. */
  side?: 'right-up' | 'right-down' | 'left-up' | 'left-down';
}

export type SceneName = 'home' | 'testing';

const MOTION_KEY = 'ecosort.scene.motion';

function stored(): string | null {
  try {
    return window.localStorage.getItem(MOTION_KEY);
  } catch {
    return null;
  }
}

async function loadBuilder(scene: SceneName): Promise<SceneBuilder> {
  if (scene === 'testing') return (await import('./scenes/testingScene')).buildTestingScene;
  return (await import('./scenes/homeScene')).buildHomeScene;
}

/**
 * The 3D world behind a page. It is decoration and a second way to read the story: everything
 * it says is also in the text of the page, so the canvas and its labels are hidden from
 * assistive technology. The page's chapters are the elements with `data-chapter`.
 */
export function Stage({
  scene,
  labels,
  data,
}: {
  scene: SceneName;
  labels: LabelSpec[];
  data?: unknown;
}) {
  const container = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const labelsRoot = useRef<HTMLDivElement>(null);
  const handle = useRef<StageHandle | null>(null);
  const dataRef = useRef(data);
  dataRef.current = data;
  const [state, setState] = useState<'loading' | 'ready' | 'unavailable'>('loading');
  const [motion, setMotion] = useState(true);

  useEffect(() => {
    const box = container.current;
    const surface = canvas.current;
    if (box === null || surface === null) return;
    let cancelled = false;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
    const choice = stored();
    const startMoving = choice !== null ? choice === 'on' : !reduced.matches;
    setMotion(startMoving);

    const params = new URLSearchParams(window.location.search);
    const number = (name: string) => {
      const value = params.get(name);
      return value === null || value === '' || Number.isNaN(Number(value)) ? null : Number(value);
    };
    const forced = params.get('quality');

    void (async () => {
      try {
        const [{ createStage }, build] = await Promise.all([
          import('./engine/createStage'),
          loadBuilder(scene),
        ]);
        if (cancelled) return;
        const made = createStage({
          canvas: surface,
          container: box,
          labelsRoot: labelsRoot.current,
          chapters: () => [...document.querySelectorAll<HTMLElement>('[data-chapter]')],
          build: (context) => build(context, dataRef.current),
          motion: startMoving,
          frame: number('frame'),
          time: number('time'),
          quality: forced === 'low' || forced === 'medium' || forced === 'high' ? forced : null,
          onFailure: () => setState('unavailable'),
        });
        if (made === null) {
          setState('unavailable');
          return;
        }
        handle.current = made;
        setState('ready');
      } catch {
        if (!cancelled) setState('unavailable');
      }
    })();

    // With no choice made on this page, follow the system's setting as it changes.
    const onReduced = () => {
      if (stored() !== null) return;
      const next = !reduced.matches;
      setMotion(next);
      handle.current?.setMotion(next);
    };
    reduced.addEventListener('change', onReduced);

    return () => {
      cancelled = true;
      reduced.removeEventListener('change', onReduced);
      handle.current?.dispose();
      handle.current = null;
    };
  }, [scene]);

  const toggle = () => {
    const next = !motion;
    setMotion(next);
    handle.current?.setMotion(next);
    try {
      window.localStorage.setItem(MOTION_KEY, next ? 'on' : 'off');
    } catch {
      // The choice just will not be remembered.
    }
  };

  return (
    <>
      <div ref={container} className={styles.stage} data-state={state} data-scene={scene}>
        <canvas ref={canvas} className={styles.canvas} aria-hidden="true" />
        <div ref={labelsRoot} className={styles.labels} aria-hidden="true">
          {labels.map((label) => (
            <div
              key={label.id}
              className={styles.tag}
              data-side={label.side ?? 'right-up'}
              data-anchor={label.anchor}
              data-from={label.from}
              data-to={label.to}
            >
              <span className={styles.dot} />
              <span className={styles.leader} />
              <span className={styles.text} data-text>
                <strong>{label.text}</strong>
                {label.detail ? <small>{label.detail}</small> : null}
              </span>
            </div>
          ))}
        </div>
      </div>
      {state === 'ready' ? (
        <div data-avoid className={styles.control}>
          <Button
            size="sm"
            variant="secondary"
            icon={motion ? 'pause' : 'play'}
            aria-pressed={!motion}
            onClick={toggle}
          >
            {motion ? 'Pause animation' : 'Play animation'}
          </Button>
        </div>
      ) : null}
    </>
  );
}
