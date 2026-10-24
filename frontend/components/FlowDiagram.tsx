// How one item gets sorted, drawn as the real chain: camera board, camera bridge, website
// bridge, console. Inline SVG in two arrangements from the same data: a row where the page
// is wide enough for its text to stay full size, a column everywhere else. CSS shows one.

import type { ReactNode } from 'react';

import styles from './FlowDiagram.module.css';

interface Node {
  title: string;
  text: string;
}

interface Link {
  title: string;
  detail: string;
  /** Two short lines for the gap between boxes in the row. */
  short: [string, string];
  /** The USB cable is drawn heavier than the connections inside the laptop. */
  cable?: boolean;
}

const NODES: Node[] = [
  {
    title: 'Camera board',
    text: 'An OV7675 camera on an Arduino. Streams 160 by 120 grayscale frames and classifies nothing.',
  },
  {
    title: 'Camera bridge',
    text: 'Runs the trained model. Decides when one item is in view and sends one verdict for it.',
  },
  {
    title: 'Website bridge',
    text: 'FastAPI. Checks every line and frame, picks the bin from its own table and keeps the counts.',
  },
  {
    title: 'Console',
    text: 'This website. Shows the counts and the frame behind every verdict. It never adds to a count.',
  },
];

const LINKS: Link[] = [
  {
    title: 'USB serial, 921600 baud',
    detail: 'FRM0 frame packets',
    short: ['USB serial', 'FRM0 frames'],
    cable: true,
  },
  {
    title: 'TCP port 7777, the wire contract',
    detail: 'EVT lines, each with its frame',
    short: ['TCP :7777', 'EVT + frame'],
  },
  {
    title: 'HTTP on this laptop',
    detail: 'Live counts (SSE) and frames (MJPEG)',
    short: ['HTTP', 'SSE, MJPEG'],
  },
];

const PLACES = { rig: 'On the rig', laptop: 'On the laptop' };

const DESCRIPTION =
  'The camera board streams grayscale frames over USB to the camera bridge on the laptop. ' +
  'The camera bridge runs the trained model and sends one verdict per item, with its frame, ' +
  'to the website bridge over TCP. The website bridge checks it, picks the bin and keeps the ' +
  'counts. The console shows the counts and the frame.';

const BOX_H = 44;
const LINE = 20;

/** Splits text into lines of at most `max` characters, at spaces. */
function wrap(text: string, max: number): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(' ')) {
    const next = line ? `${line} ${word}` : word;
    if (next.length > max && line) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function Box({
  node,
  x,
  y,
  width,
  chars,
}: {
  node: Node;
  x: number;
  y: number;
  width: number;
  chars: number;
}) {
  return (
    <g>
      <rect className={styles.box} x={x} y={y} width={width} height={BOX_H} rx={3} />
      <text className={styles.title} x={x + 12} y={y + 29}>
        {node.title}
      </text>
      {wrap(node.text, chars).map((line, n) => (
        <text key={line} className={styles.text} x={x} y={y + BOX_H + 24 + n * LINE}>
          {line}
        </text>
      ))}
    </g>
  );
}

function arrowRight(x1: number, x2: number, y: number, cable?: boolean): ReactNode {
  return (
    <g>
      <line className={cable ? styles.cable : styles.stroke} x1={x1} y1={y} x2={x2 - 8} y2={y} />
      <path className={styles.head} d={`M${x2 - 9} ${y - 6}l9 6-9 6z`} />
    </g>
  );
}

function arrowDown(x: number, y1: number, y2: number, cable?: boolean): ReactNode {
  return (
    <g>
      <line className={cable ? styles.cable : styles.stroke} x1={x} y1={y1} x2={x} y2={y2 - 8} />
      <path className={styles.head} d={`M${x - 6} ${y2 - 9}h12l-6 9z`} />
    </g>
  );
}

function Labelled({
  id,
  width,
  height,
  children,
}: {
  id: string;
  width: number;
  height: number;
  children: ReactNode;
}) {
  return (
    <svg
      className={`${styles.svg} ${id === 'row' ? styles.row : styles.column}`}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-labelledby={`flow-title-${id} flow-desc-${id}`}
    >
      <title id={`flow-title-${id}`}>How one item gets sorted</title>
      <desc id={`flow-desc-${id}`}>{DESCRIPTION}</desc>
      {children}
    </svg>
  );
}

/** Four boxes in a row: the rig on the left, the laptop on the right. */
function Row() {
  const width = 1000;
  const nodeW = 176;
  const xs = [16, 300, 554, 808];
  const boxY = 44;
  const chars = 22;
  const lines = Math.max(...NODES.map((n) => wrap(n.text, chars).length));
  const height = boxY + BOX_H + 24 + (lines - 1) * LINE + 24;
  const arrowY = boxY + BOX_H / 2;
  return (
    <Labelled id="row" width={width} height={height}>
      <rect className={styles.band} x={0} y={0} width={208} height={height} rx={6} />
      <rect className={styles.band} x={284} y={0} width={width - 284} height={height} rx={6} />
      <text className={styles.place} x={16} y={27}>
        {PLACES.rig}
      </text>
      <text className={styles.place} x={300} y={27}>
        {PLACES.laptop}
      </text>
      {NODES.map((node, i) => (
        <Box key={node.title} node={node} x={xs[i] ?? 0} y={boxY} width={nodeW} chars={chars} />
      ))}
      {LINKS.map((link, i) => {
        const from = (xs[i] ?? 0) + nodeW + 6;
        const to = (xs[i + 1] ?? 0) - 6;
        const mid = (from + to) / 2;
        return (
          <g key={link.title}>
            <text className={styles.linkTitle} x={mid} y={arrowY - 26} textAnchor="middle">
              {link.short[0]}
            </text>
            <text className={styles.linkText} x={mid} y={arrowY - 11} textAnchor="middle">
              {link.short[1]}
            </text>
            {arrowRight(from, to, arrowY, link.cable)}
          </g>
        );
      })}
    </Labelled>
  );
}

/** The same chain as a column, for narrow pages. */
function Column() {
  const width = 360;
  const x = 16;
  const nodeW = width - 32;
  const arrowX = 40;
  const chars = 40;
  const nodeHeight = (node: Node) => BOX_H + 24 + (wrap(node.text, chars).length - 1) * LINE + 16;
  const parts: ReactNode[] = [];

  const link = (key: string, l: Link, top: number, span: number) => {
    parts.push(
      <g key={key}>
        {arrowDown(arrowX, top, top + span, l.cable)}
        <text className={styles.linkTitleLarge} x={arrowX + 20} y={top + span / 2 - 4}>
          {l.title}
        </text>
        <text className={styles.linkTextLarge} x={arrowX + 20} y={top + span / 2 + 15}>
          {l.detail}
        </text>
      </g>,
    );
  };

  // The rig: the camera board alone.
  const [board, ...laptopNodes] = NODES;
  let y = 0;
  const rigTop = y;
  y += 44;
  if (board) {
    parts.push(<Box key={board.title} node={board} x={x} y={y} width={nodeW} chars={chars} />);
    y += nodeHeight(board);
  }
  const rigBottom = y + 4;

  // The cable between the rig and the laptop.
  const usb = LINKS[0];
  const usbSpan = 84;
  if (usb) link('usb', usb, rigBottom, usbSpan);
  const laptopTop = rigBottom + usbSpan;

  // The laptop: camera bridge, website bridge, console.
  y = laptopTop + 44;
  laptopNodes.forEach((node, i) => {
    const l = LINKS[i + 1];
    parts.push(<Box key={node.title} node={node} x={x} y={y} width={nodeW} chars={chars} />);
    y += nodeHeight(node);
    if (l && i < laptopNodes.length - 1) {
      link(`link-${i}`, l, y - 8, 76);
      y += 68;
    }
  });
  const height = y + 4;

  return (
    <Labelled id="column" width={width} height={height}>
      <rect
        className={styles.band}
        x={0}
        y={rigTop}
        width={width}
        height={rigBottom - rigTop}
        rx={6}
      />
      <text className={styles.place} x={x} y={rigTop + 27}>
        {PLACES.rig}
      </text>
      <rect
        className={styles.band}
        x={0}
        y={laptopTop}
        width={width}
        height={height - laptopTop}
        rx={6}
      />
      <text className={styles.place} x={x} y={laptopTop + 27}>
        {PLACES.laptop}
      </text>
      {parts}
    </Labelled>
  );
}

export function FlowDiagram() {
  return (
    <figure className={styles.figure}>
      <Row />
      <Column />
      <figcaption className={styles.caption}>
        The camera bridge sends each verdict together with the frame it was made from, so every
        verdict in the console comes with the exact image the model classified.
      </figcaption>
    </figure>
  );
}
