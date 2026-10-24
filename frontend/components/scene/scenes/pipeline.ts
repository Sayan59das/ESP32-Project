// The pipeline, drawn as four glass blocks in a row: the camera board, the camera bridge that
// runs the model, the website bridge that keeps the count, and the console. Packets travel
// along the tubes between them: grey frames first, then verdicts in the three outcome colours.

import {
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,
  CylinderGeometry,
  EdgesGeometry,
  Group,
  InstancedMesh,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  PlaneGeometry,
  SphereGeometry,
  BoxGeometry,
  SRGBColorSpace,
} from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

import { at, mix, mulberry32 } from '@/lib/scene/math';

import type { Palette } from '../engine/palette';
import { OUTCOME } from '../engine/palette';

// Left to right, the way the data flows: camera board, camera bridge, website bridge, console.
export const PIPELINE_X = [-61, -52, -43, -34] as const;
const Y = 2.6;
const NODE = { w: 4, h: 2.8, d: 2.8 };
const PACKETS_PER_TUBE = 6;

export interface Pipeline {
  group: Group;
  anchors: Record<'camera' | 'model' | 'server' | 'console', Object3D>;
  update(args: { time: number; motion: boolean; palette: Palette }): void;
  dispose(): void;
}

function consoleTexture(): CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 160;
  const g = canvas.getContext('2d');
  if (g) {
    g.fillStyle = '#0b1210';
    g.fillRect(0, 0, 256, 160);
    g.fillStyle = '#1f7048';
    g.fillRect(14, 14, 110, 96);
    g.fillStyle = '#4f5a64';
    g.fillRect(132, 14, 110, 96);
    g.fillStyle = '#e0a019';
    g.fillRect(14, 120, 228, 26);
    g.fillStyle = 'rgba(255,255,255,0.9)';
    g.fillRect(34, 40, 18, 52);
    g.fillRect(70, 40, 18, 52);
    g.fillRect(152, 40, 18, 52);
    g.fillRect(188, 40, 18, 52);
  }
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

export function createPipeline(): Pipeline {
  const group = new Group();
  const rand = mulberry32(17);
  const disposables: { dispose(): void }[] = [];
  const track = <T extends { dispose(): void }>(thing: T): T => {
    disposables.push(thing);
    return thing;
  };

  const shellGeometry = track(new RoundedBoxGeometry(NODE.w, NODE.h, NODE.d, 4, 0.18));
  const shellMaterial = track(
    new MeshStandardMaterial({
      color: 0x16241f,
      metalness: 0.3,
      roughness: 0.1,
      envMapIntensity: 1.8,
      transparent: true,
      opacity: 0.5,
      depthWrite: false,
    }),
  );
  const edgeGeometry = track(new EdgesGeometry(shellGeometry, 20));
  const edgeMaterial = track(new LineBasicMaterial({ color: 0x9ff0cb, toneMapped: false }));
  const glyphGlow = track(new MeshBasicMaterial({ color: 0x9ff0cb, toneMapped: false }));
  const dim = track(
    new MeshBasicMaterial({ color: 0x9ff0cb, toneMapped: false, transparent: true, opacity: 0.55 }),
  );

  const anchors = {
    camera: new Object3D(),
    model: new Object3D(),
    server: new Object3D(),
    console: new Object3D(),
  };
  const keys = ['camera', 'model', 'server', 'console'] as const;
  const nodes: Group[] = [];

  PIPELINE_X.forEach((x, i) => {
    const node = new Group();
    node.position.set(x, Y, 0);
    const shell = new Mesh(shellGeometry, shellMaterial);
    shell.castShadow = true;
    node.add(shell, new LineSegments(edgeGeometry, edgeMaterial));
    const anchor = anchors[at(keys, i)];
    anchor.position.set(0, NODE.h / 2 + 0.2, 0);
    node.add(anchor);
    nodes.push(node);
    group.add(node);
  });

  // 1. The camera board: a green board with a lens on it.
  {
    const board = track(new BoxGeometry(2.1, 0.08, 1.5));
    const boardMaterial = track(new MeshStandardMaterial({ color: 0x1f7a52, roughness: 0.5 }));
    const m = new Mesh(board, boardMaterial);
    m.position.y = -0.5;
    const barrel = track(new CylinderGeometry(0.36, 0.4, 0.5, 28));
    const lens = new Mesh(
      barrel,
      track(new MeshStandardMaterial({ color: 0x101517, metalness: 0.9, roughness: 0.2 })),
    );
    lens.position.set(0, -0.2, 0);
    const eye = new Mesh(track(new SphereGeometry(0.22, 18, 12)), glyphGlow);
    eye.position.set(0, 0.05, 0);
    eye.scale.y = 0.5;
    const chip = new Mesh(
      track(new BoxGeometry(0.5, 0.1, 0.4)),
      track(new MeshStandardMaterial({ color: 0x0c1012 })),
    );
    chip.position.set(0.6, -0.42, 0.35);
    at(nodes, 0).add(m, lens, eye, chip);
  }

  // 2. The camera bridge: a small neural network.
  {
    const layers = [3, 4, 2];
    const xs = [-0.95, 0, 0.95];
    const points: [number, number, number][][] = layers.map((count, l) =>
      Array.from({ length: count }, (_, n) => [at(xs, l), (n - (count - 1) / 2) * 0.55, 0]),
    );
    const sphere = track(new SphereGeometry(0.1, 14, 10));
    const lines: number[] = [];
    points.forEach((layer, l) => {
      for (const p of layer) {
        const s = new Mesh(sphere, glyphGlow);
        s.position.set(p[0], p[1], p[2]);
        at(nodes, 1).add(s);
        for (const q of points[l + 1] ?? []) lines.push(p[0], p[1], p[2], q[0], q[1], q[2]);
      }
    });
    const lineGeometry = track(new BufferGeometry());
    lineGeometry.setAttribute('position', new BufferAttribute(new Float32Array(lines), 3));
    at(nodes, 1).add(
      new LineSegments(
        lineGeometry,
        track(
          new LineBasicMaterial({
            color: 0x9ff0cb,
            toneMapped: false,
            transparent: true,
            opacity: 0.5,
          }),
        ),
      ),
    );
  }

  // 3. The website bridge: three stacked discs, a store.
  {
    const disc = track(new CylinderGeometry(0.75, 0.75, 0.22, 40));
    const discMaterial = track(
      new MeshStandardMaterial({ color: 0x1b2a25, metalness: 0.7, roughness: 0.3 }),
    );
    const rim = track(new CylinderGeometry(0.77, 0.77, 0.03, 40));
    for (let k = -1; k <= 1; k++) {
      const d = new Mesh(disc, discMaterial);
      d.position.y = k * 0.5;
      const r = new Mesh(rim, glyphGlow);
      r.position.y = k * 0.5 + 0.08;
      at(nodes, 2).add(d, r);
    }
  }

  // 4. The console: a screen with the three outcome blocks.
  const screenTexture = track(consoleTexture());
  {
    const frame = track(new BoxGeometry(2.3, 1.5, 0.08));
    const f = new Mesh(
      frame,
      track(new MeshStandardMaterial({ color: 0x0c1012, metalness: 0.6, roughness: 0.3 })),
    );
    const face = new Mesh(
      track(new PlaneGeometry(2.1, 1.31)),
      track(new MeshBasicMaterial({ map: screenTexture, toneMapped: false })),
    );
    face.position.z = 0.05;
    at(nodes, 3).add(f, face);
  }

  // -- tubes and packets ---------------------------------------------------------------------
  const tubes: { x0: number; x1: number }[] = [];
  for (let i = 0; i < PIPELINE_X.length - 1; i++) {
    const from = at([...PIPELINE_X], i) + NODE.w / 2;
    const to = at([...PIPELINE_X], i + 1) - NODE.w / 2;
    tubes.push({ x0: from, x1: to });
    const length = to - from;
    const tube = new Mesh(track(new CylinderGeometry(0.05, 0.05, length, 12)), dim);
    tube.rotation.z = Math.PI / 2;
    tube.position.set((from + to) / 2, Y, 0);
    group.add(tube);
  }
  const packetGeometry = track(new SphereGeometry(0.13, 14, 10));
  const packetMaterial = track(new MeshBasicMaterial({ color: 0xffffff, toneMapped: false }));
  const packets = new InstancedMesh(
    packetGeometry,
    packetMaterial,
    tubes.length * PACKETS_PER_TUBE,
  );
  packets.frustumCulled = false;
  const tint = new Color();
  const outcomes = [
    OUTCOME.recyclable,
    OUTCOME.trash,
    OUTCOME.unsure,
    OUTCOME.recyclable,
    OUTCOME.trash,
  ];
  for (let t = 0; t < tubes.length; t++) {
    for (let p = 0; p < PACKETS_PER_TUBE; p++) {
      // Frames on the first tube are plain grey; after the model every packet is a verdict.
      if (t === 0) tint.setRGB(0.85, 0.9, 0.9);
      else tint.copy(at(outcomes, Math.floor(rand() * outcomes.length))).multiplyScalar(1.7);
      packets.setColorAt(t * PACKETS_PER_TUBE + p, tint);
    }
  }
  group.add(packets);

  // A low plinth under the row, tall enough that the ground's small bumps never show through,
  // with a glowing line along its front edge.
  const plinthMaterial = track(new MeshStandardMaterial({ color: 0xcfd8d4, roughness: 0.85 }));
  const plinthX = (at([...PIPELINE_X], 0) + at([...PIPELINE_X], 3)) / 2;
  const plinth = new Mesh(track(new RoundedBoxGeometry(35, 0.7, 4.6, 3, 0.12)), plinthMaterial);
  plinth.position.set(plinthX, -0.05, 0);
  plinth.receiveShadow = true;
  group.add(plinth);
  const edge = new Mesh(track(new BoxGeometry(34, 0.05, 0.05)), glyphGlow);
  edge.position.set(plinthX, 0.3, 2.3);
  group.add(edge);

  const dummy = new Object3D();

  return {
    group,
    anchors,
    update({ time, motion, palette }) {
      const level = Math.min(palette.glowIntensity, 2.4);
      edgeMaterial.color.copy(palette.glow).multiplyScalar(level);
      glyphGlow.color.copy(palette.glow).multiplyScalar(level);
      dim.color.copy(palette.glow).multiplyScalar(level * 0.7);
      plinthMaterial.color.copy(palette.stone);
      const t = motion ? time : 0;
      tubes.forEach((tube, ti) => {
        for (let p = 0; p < PACKETS_PER_TUBE; p++) {
          const along = (((t * 0.16 + p / PACKETS_PER_TUBE + ti * 0.13) % 1) + 1) % 1;
          dummy.position.set(
            mix(tube.x0, tube.x1, along),
            Y + Math.sin(along * Math.PI * 2 + p) * 0.02,
            0,
          );
          dummy.scale.setScalar(ti === 0 ? 0.9 : 1.15);
          dummy.updateMatrix();
          packets.setMatrixAt(ti * PACKETS_PER_TUBE + p, dummy.matrix);
        }
      });
      packets.instanceMatrix.needsUpdate = true;
    },
    dispose() {
      for (const d of disposables) d.dispose();
    },
  };
}
