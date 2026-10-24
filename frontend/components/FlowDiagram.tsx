// How one item gets sorted: the real chain, drawn once, one column so it reads on a phone.

import type { ReactNode } from 'react';

import styles from './FlowDiagram.module.css';

interface Step {
  title: string;
  lines: string[];
}

const RIG: Step[] = [
  {
    title: 'OV7675 camera',
    lines: ['Looks at the item and captures a 160 by 120', 'grayscale frame, over and over.'],
  },
  {
    title: 'Arduino board',
    lines: ['Does no classifying. It streams every', 'frame over USB as fast as the cable allows.'],
  },
];

const LAPTOP: Step[] = [
  {
    title: 'Camera bridge (the trained model)',
    lines: [
      'A small neural network labels each frame.',
      'When an item arrives it counts it once:',
      'recyclable, non-recyclable or unsure.',
    ],
  },
  {
    title: 'Bridge (FastAPI)',
    lines: [
      'Checks every line and frame, recomputes',
      'the bin from its own table, stores the',
      'event with the frame the model saw.',
    ],
  },
  { title: 'Console', lines: ['Counts by bin, and every verdict�s frame.'] },
];

const WIDTH = 360;
const PAD = 16;
const BOX_W = 240;
const BOX_H = 40;
const LINE = 18;
const ARROW = 26;
const BOX_X = PAD;
const ARROW_X = PAD + 24;

function arrow(key: string, y1: number, y2: number): ReactNode {
  return (
    <g key={key}>
      <line className={styles.stroke} x1={ARROW_X} y1={y1} x2={ARROW_X} y2={y2 - 6} />
      <path className={styles.head} d={`M${ARROW_X - 5} ${y2 - 8}h10l-5 8z`} />
    </g>
  );
}

/** Lays out one group of steps from `top`; returns its elements and where it ends. */
function group(label: string, steps: Step[], top: number, keyPrefix: string) {
  const parts: ReactNode[] = [];
  let y = top + 44;
  steps.forEach((step, i) => {
    if (i > 0) {
      parts.push(arrow(`${keyPrefix}-a${i}`, y, y + ARROW));
      y += ARROW + 4;
    }
    parts.push(
      <g key={`${keyPrefix}-s${i}`}>
        <rect className={styles.box} x={BOX_X} y={y} width={BOX_W} height={BOX_H} />
        <text className={styles.title} x={BOX_X + 12} y={y + 26}>
          {step.title}
        </text>
        {step.lines.map((line, n) => (
          <text key={n} className={styles.text} x={BOX_X} y={y + BOX_H + 20 + n * LINE}>
            {line}
          </text>
        ))}
      </g>,
    );
    y += BOX_H + 20 + (step.lines.length - 1) * LINE + 14;
  });
  const bottom = y + 6;
  return {
    bottom,
    node: (
      <g key={keyPrefix}>
        <rect className={styles.group} x={0} y={top} width={WIDTH} height={bottom - top} />
        <text className={styles.groupLabel} x={PAD} y={top + 28}>
          {label}
        </text>
        {parts}
      </g>
    ),
  };
}

export function FlowDiagram() {
  const rig = group('On the rig: Arduino and camera', RIG, 0, 'rig');
  const usbTop = rig.bottom;
  const usbBottom = usbTop + 112;
  const laptop = group('On the laptop', LAPTOP, usbBottom, 'laptop');
  const height = laptop.bottom;

  return (
    <figure className={styles.figure}>
      <svg
        className={styles.svg}
        viewBox={`0 0 ${WIDTH} ${height}`}
        role="img"
        aria-labelledby="flow-title flow-desc"
      >
        <title id="flow-title">How one item gets sorted</title>
        <desc id="flow-desc">
          The OV7675 camera and the Arduino stream grayscale frames over USB; the camera bridge on
          the laptop runs the trained model, counts each item once and passes the verdict frame and
          an EVT line to the bridge; the bridge checks and stores them; the console shows the counts
          and the frame.
        </desc>
        {rig.node}
        <line className={styles.cable} x1={ARROW_X} y1={usbTop} x2={ARROW_X} y2={usbBottom} />
        <text className={styles.title} x={ARROW_X + 20} y={usbTop + 24}>
          USB serial, camera frames
        </text>
        <text className={styles.text} x={ARROW_X + 20} y={usbTop + 46}>
          FRM0 packets, 160 by 120,
        </text>
        <text className={styles.text} x={ARROW_X + 20} y={usbTop + 64}>
          19200 grayscale pixels each
        </text>
        <text className={styles.code} x={ARROW_X + 20} y={usbTop + 90}>
          EVT,recyclable,0.97,RECYCLABLE,70
        </text>
        {laptop.node}
      </svg>
      <figcaption className={styles.caption}>
        The camera bridge sends the frame just before its EVT line, so every verdict in the console
        comes with the exact image the model classified.
      </figcaption>
    </figure>
  );
}
