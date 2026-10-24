// A row of screens, one for each way the camera can stop showing a picture: switched off, covered,
// the lights out, a flat grey, a frozen frame, the board unplugged, and back on again. Under each
// screen is what the counter counted while it lasted, and over it a lamp that says whether the
// recorded run did what it should.

import {
  BoxGeometry,
  CanvasTexture,
  Color,
  EdgesGeometry,
  Group,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  PlaneGeometry,
  SphereGeometry,
  SRGBColorSpace,
} from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

import { easeOutCubic, mix, mulberry32, smoothstep } from '@/lib/scene/math';

import type { Palette } from '../engine/palette';
import { OUTCOME } from '../engine/palette';

export interface StationSpec {
  id: string;
  passed: boolean;
  counted: number;
}

export interface Stations {
  group: Group;
  anchors: Object3D[];
  /** Half the width of the row, for framing it. */
  halfWidth: number;
  update(args: { progress: number; time: number; motion: boolean; palette: Palette }): void;
  dispose(): void;
}

const PITCH = 4.6;
const FAIL = new Color(0xe5736a);

type Look = 'black' | 'covered' | 'dim' | 'flat' | 'frozen' | 'unplugged' | 'back';

const LOOKS: Record<string, Look> = {
  off: 'black',
  covered: 'covered',
  lights: 'dim',
  flat: 'flat',
  frozen: 'frozen',
  unplugged: 'unplugged',
  comeback: 'back',
};

/** The room as the camera sees it: a slope from dark to light, with some shapes in it. */
function paintRoom(g: CanvasRenderingContext2D, w: number, h: number, withItem: boolean) {
  const slope = g.createLinearGradient(0, 0, w, 0);
  slope.addColorStop(0, '#3f4a47');
  slope.addColorStop(1, '#a7b3ae');
  g.fillStyle = slope;
  g.fillRect(0, 0, w, h);
  const rand = mulberry32(5);
  for (let i = 0; i < 26; i++) {
    g.fillStyle = `rgba(${rand() > 0.5 ? '255,255,255' : '0,0,0'},${0.05 + rand() * 0.1})`;
    g.fillRect(rand() * w, rand() * h, 6 + rand() * 22, 3 + rand() * 12);
  }
  if (withItem) {
    g.fillStyle = '#d9dfdc';
    g.beginPath();
    g.roundRect(w * 0.38, h * 0.2, w * 0.24, h * 0.62, 8);
    g.fill();
    g.fillStyle = '#7e8a86';
    g.fillRect(w * 0.38, h * 0.38, w * 0.24, h * 0.07);
  }
}

function screenTexture(look: Look): CanvasTexture {
  const w = 128;
  const h = 96;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const g = canvas.getContext('2d');
  if (g) {
    if (look === 'black') {
      g.fillStyle = '#020303';
      g.fillRect(0, 0, w, h);
    } else if (look === 'covered') {
      const hole = g.createRadialGradient(w / 2, h / 2, 4, w / 2, h / 2, w * 0.7);
      hole.addColorStop(0, '#171a1a');
      hole.addColorStop(1, '#040505');
      g.fillStyle = hole;
      g.fillRect(0, 0, w, h);
    } else if (look === 'flat') {
      g.fillStyle = '#8a8e8c';
      g.fillRect(0, 0, w, h);
    } else if (look === 'unplugged') {
      g.fillStyle = '#0b0f0e';
      g.fillRect(0, 0, w, h);
      g.strokeStyle = '#9fb3aa';
      g.lineWidth = 3;
      g.setLineDash([10, 8]);
      g.strokeRect(10, 10, w - 20, h - 20);
    } else {
      paintRoom(g, w, h, look === 'back');
      if (look === 'dim') {
        g.fillStyle = 'rgba(2,4,3,0.86)';
        g.fillRect(0, 0, w, h);
      }
      if (look === 'frozen') {
        g.fillStyle = 'rgba(8,12,11,0.7)';
        g.fillRect(w - 38, 8, 30, 30);
        g.fillStyle = '#e8f3ee';
        g.fillRect(w - 30, 14, 6, 18);
        g.fillRect(w - 20, 14, 6, 18);
      }
    }
    if (look !== 'flat') {
      // The sensor's own noise, so a dark picture is not a perfectly black one.
      const rand = mulberry32(11);
      for (let i = 0; i < 260; i++) {
        g.fillStyle = `rgba(255,255,255,${0.03 + rand() * 0.05})`;
        g.fillRect(rand() * w, rand() * h, 1, 1);
      }
    }
  }
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

function counterTexture(counted: number): CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 64;
  const g = canvas.getContext('2d');
  if (g) {
    g.fillStyle = '#0b1210';
    g.fillRect(0, 0, 128, 64);
    g.fillStyle = '#e9f3ee';
    g.font = 'bold 46px ui-monospace, Consolas, monospace';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(String(Math.min(counted, 99)), 64, 34);
  }
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

export function createStations(specs: StationSpec[]): Stations {
  const group = new Group();
  const disposables: { dispose(): void }[] = [];
  const track = <T extends { dispose(): void }>(thing: T): T => {
    disposables.push(thing);
    return thing;
  };

  const pedestalGeometry = track(new RoundedBoxGeometry(2.2, 0.9, 1.5, 3, 0.1));
  const pedestalMaterial = track(new MeshStandardMaterial({ color: 0x9aaca4, roughness: 0.8 }));
  const frameGeometry = track(new RoundedBoxGeometry(2.7, 2.05, 0.16, 3, 0.07));
  const frameMaterial = track(
    new MeshStandardMaterial({ color: 0x0c1210, metalness: 0.6, roughness: 0.3 }),
  );
  const faceGeometry = track(new PlaneGeometry(2.4, 1.8));
  const edgeGeometry = track(new EdgesGeometry(frameGeometry, 20));
  const edgeMaterial = track(new LineBasicMaterial({ color: 0x9ff0cb, toneMapped: false }));
  const lampGeometry = track(new SphereGeometry(0.17, 16, 12));
  const plaqueGeometry = track(new PlaneGeometry(0.9, 0.45));
  const standGeometry = track(new BoxGeometry(0.2, 0.5, 0.2));

  const anchors: Object3D[] = [];
  const parts = specs.map((spec, i) => {
    const holder = new Group();
    holder.position.x = (i - (specs.length - 1) / 2) * PITCH;
    const pedestal = new Mesh(pedestalGeometry, pedestalMaterial);
    pedestal.position.y = 0.45;
    pedestal.receiveShadow = true;
    pedestal.castShadow = true;

    const screen = new Group();
    screen.position.set(0, 2.2, 0);
    screen.rotation.x = -0.1;
    const frame = new Mesh(frameGeometry, frameMaterial);
    frame.castShadow = true;
    const picture = track(screenTexture(LOOKS[spec.id] ?? 'black'));
    const face = new Mesh(
      faceGeometry,
      track(new MeshBasicMaterial({ map: picture, toneMapped: false })),
    );
    face.position.z = 0.09;
    // A black sheet that switches the picture off and on, for the station that comes back.
    const coverMaterial = track(
      new MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0, toneMapped: false }),
    );
    const cover = new Mesh(faceGeometry, coverMaterial);
    cover.position.z = 0.1;
    screen.add(frame, new LineSegments(edgeGeometry, edgeMaterial), face, cover);

    const stand = new Mesh(standGeometry, frameMaterial);
    stand.position.y = 1.15;

    const lampMaterial = track(
      new MeshBasicMaterial({
        color: spec.passed ? OUTCOME.recyclable : FAIL,
        toneMapped: false,
      }),
    );
    const lamp = new Mesh(lampGeometry, lampMaterial);
    lamp.position.set(0, 3.75, 0);

    const plaque = new Mesh(
      plaqueGeometry,
      track(new MeshBasicMaterial({ map: track(counterTexture(spec.counted)), toneMapped: false })),
    );
    plaque.position.set(0, 0.55, 0.76);

    const anchor = new Object3D();
    anchor.position.set(0, 4.3, 0);
    holder.add(pedestal, stand, screen, lamp, plaque, anchor);
    group.add(holder);
    anchors.push(anchor);
    return {
      holder,
      lamp,
      lampMaterial,
      coverMaterial,
      flickers: spec.id === 'comeback',
      passed: spec.passed,
    };
  });

  return {
    group,
    anchors,
    halfWidth: ((specs.length - 1) / 2) * PITCH + 1.4,
    update({ progress, time, motion, palette }) {
      const level = Math.min(palette.glowIntensity, 2.2);
      edgeMaterial.color.copy(palette.glow).multiplyScalar(level);
      pedestalMaterial.color.copy(palette.stone);
      parts.forEach((p, i) => {
        const delay = i * 0.07;
        const k = easeOutCubic(smoothstep(delay, delay + 0.55, progress));
        p.holder.position.y = mix(-3.2, 0, k);
        p.holder.visible = k > 0.001;
        p.lampMaterial.color.copy(p.passed ? OUTCOME.recyclable : FAIL).multiplyScalar(level * 0.9);
        p.lamp.scale.setScalar(motion ? 1 + Math.sin(time * 2.1 + i) * 0.1 : 1);
        // On for a few seconds, off for a few: the one that comes back.
        p.coverMaterial.opacity =
          p.flickers && motion ? 1 - smoothstep(-0.2, 0.2, Math.sin(time * 0.8)) : 0;
      });
    },
    dispose() {
      for (const d of disposables) d.dispose();
    },
  };
}
