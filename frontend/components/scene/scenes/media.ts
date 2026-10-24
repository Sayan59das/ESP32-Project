// Frames for the photographs and videos of the real rig. They stand empty, and say so, until a
// file is listed in data/testing.json: nothing is ever shown in them that was not put there.
// A listed photo is loaded from this site; a video gets a frame with a play mark, because the
// player itself is in the page.

import {
  CanvasTexture,
  EdgesGeometry,
  Group,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  PlaneGeometry,
  SRGBColorSpace,
  type Texture,
  TextureLoader,
} from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

import { easeOutCubic, mix, smoothstep } from '@/lib/scene/math';

import type { Palette } from '../engine/palette';

export interface MediaSpec {
  kind: 'image' | 'video';
  /** A plain file name under /testing/, or null for an empty slot. */
  file: string | null;
}

export interface MediaFrames {
  group: Group;
  anchors: Object3D[];
  update(args: { progress: number; time: number; motion: boolean; palette: Palette }): void;
  dispose(): void;
}

const PITCH = 6.4;
const WIDTH = 4.8;
const HEIGHT = 3.4;

function slotTexture(kind: 'image' | 'video', filled: boolean): CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 768;
  canvas.height = 544;
  const g = canvas.getContext('2d');
  if (g) {
    g.scale(2, 2); // drawn on a 384 by 272 grid, at twice the pixels
    g.fillStyle = '#0c1210';
    g.fillRect(0, 0, 384, 272);
    g.strokeStyle = 'rgba(159,240,203,0.7)';
    g.lineWidth = 3;
    g.setLineDash([14, 10]);
    g.strokeRect(14, 14, 356, 244);
    g.setLineDash([]);
    g.fillStyle = 'rgba(233,243,238,0.9)';
    if (kind === 'video') {
      g.beginPath();
      g.moveTo(158, 92);
      g.lineTo(158, 172);
      g.lineTo(228, 132);
      g.closePath();
      g.fill();
    } else {
      g.lineWidth = 6;
      g.strokeStyle = 'rgba(233,243,238,0.9)';
      g.strokeRect(122, 100, 140, 88);
      g.beginPath();
      g.arc(192, 144, 24, 0, Math.PI * 2);
      g.stroke();
      g.fillRect(150, 90, 32, 10);
    }
    g.font = '600 26px system-ui, sans-serif';
    g.textAlign = 'center';
    g.fillText(filled ? 'Video' : 'Not added yet', 192, 226);
  }
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

export function createMedia(specs: MediaSpec[], invalidate: () => void): MediaFrames {
  const group = new Group();
  const disposables: { dispose(): void }[] = [];
  const track = <T extends { dispose(): void }>(thing: T): T => {
    disposables.push(thing);
    return thing;
  };

  const frameGeometry = track(new RoundedBoxGeometry(WIDTH + 0.5, HEIGHT + 0.5, 0.18, 3, 0.08));
  const frameMaterial = track(
    new MeshStandardMaterial({ color: 0x0c1210, metalness: 0.6, roughness: 0.3 }),
  );
  const edgeGeometry = track(new EdgesGeometry(frameGeometry, 20));
  const edgeMaterial = track(new LineBasicMaterial({ color: 0x9ff0cb, toneMapped: false }));
  const faceGeometry = track(new PlaneGeometry(WIDTH, HEIGHT));
  const loader = new TextureLoader();

  const anchors: Object3D[] = [];
  const holders = specs.map((spec, i) => {
    const holder = new Group();
    holder.position.x = (i - (specs.length - 1) / 2) * PITCH;
    const frame = new Mesh(frameGeometry, frameMaterial);
    frame.castShadow = true;

    let map: Texture;
    if (spec.kind === 'image' && spec.file !== null) {
      map = loader.load(`/testing/${spec.file}`, invalidate);
      map.colorSpace = SRGBColorSpace;
      track(map);
    } else {
      map = track(slotTexture(spec.kind, spec.file !== null));
    }
    const face = new Mesh(faceGeometry, track(new MeshBasicMaterial({ map, toneMapped: false })));
    face.position.z = 0.1;

    const anchor = new Object3D();
    anchor.position.set(0, HEIGHT / 2 + 0.9, 0);
    holder.add(frame, new LineSegments(edgeGeometry, edgeMaterial), face, anchor);
    holder.position.y = HEIGHT / 2 + 1.2;
    group.add(holder);
    anchors.push(anchor);
    return holder;
  });

  return {
    group,
    anchors,
    update({ progress, time, motion, palette }) {
      const level = Math.min(palette.glowIntensity, 2.2);
      edgeMaterial.color.copy(palette.glow).multiplyScalar(level);
      holders.forEach((holder, i) => {
        const delay = i * 0.12;
        const k = easeOutCubic(smoothstep(delay, delay + 0.6, progress));
        holder.position.y =
          HEIGHT / 2 + 1.2 + mix(-4, 0, k) + (motion ? Math.sin(time * 0.9 + i * 1.7) * 0.12 : 0);
        holder.rotation.y = motion ? Math.sin(time * 0.35 + i) * 0.05 : 0;
        holder.visible = k > 0.001;
      });
    },
    dispose() {
      for (const d of disposables) d.dispose();
    },
  };
}
