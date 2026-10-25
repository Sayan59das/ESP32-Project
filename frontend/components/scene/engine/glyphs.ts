// The three marks of the three outcomes, drawn in white on a clear ground so a material can
// tint them: the chasing arrows for Recyclable, a bin for Trash, a question mark for Unsure.
// The console carries the same three marks next to the same three words, so a colour is never
// the only thing that tells them apart.

import { CanvasTexture, LinearFilter, LinearMipmapLinearFilter, SRGBColorSpace } from 'three';

export type Glyph = 'recyclable' | 'trash' | 'unsure';

function arrows(ctx: CanvasRenderingContext2D, size: number) {
  ctx.translate(size / 2, size / 2);
  ctx.lineWidth = size * 0.105;
  ctx.lineCap = 'butt';
  const radius = size * 0.31;
  const head = size * 0.125;
  for (let i = 0; i < 3; i++) {
    ctx.save();
    ctx.rotate((i * 2 * Math.PI) / 3);
    const from = (-104 * Math.PI) / 180;
    const to = (-14 * Math.PI) / 180;
    ctx.beginPath();
    ctx.arc(0, 0, radius, from, to);
    ctx.stroke();
    // The head of the arrow, pointing the way round.
    const hx = Math.cos(to) * radius;
    const hy = Math.sin(to) * radius;
    ctx.beginPath();
    ctx.moveTo(hx + Math.cos(to) * head, hy + Math.sin(to) * head);
    ctx.lineTo(hx - Math.cos(to) * head, hy - Math.sin(to) * head);
    ctx.lineTo(hx - Math.sin(to) * head * 1.5, hy + Math.cos(to) * head * 1.5);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
}

function bin(ctx: CanvasRenderingContext2D, size: number) {
  ctx.lineWidth = size * 0.075;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  const left = size * 0.27;
  const right = size * 0.73;
  // The lid, with its handle.
  ctx.beginPath();
  ctx.moveTo(size * 0.2, size * 0.28);
  ctx.lineTo(size * 0.8, size * 0.28);
  ctx.moveTo(size * 0.4, size * 0.28);
  ctx.lineTo(size * 0.4, size * 0.2);
  ctx.lineTo(size * 0.6, size * 0.2);
  ctx.lineTo(size * 0.6, size * 0.28);
  ctx.stroke();
  // The body, a little narrower at the bottom, with its two ribs.
  ctx.beginPath();
  ctx.moveTo(left, size * 0.36);
  ctx.lineTo(size * 0.31, size * 0.8);
  ctx.lineTo(size * 0.69, size * 0.8);
  ctx.lineTo(right, size * 0.36);
  ctx.closePath();
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(size * 0.43, size * 0.46);
  ctx.lineTo(size * 0.44, size * 0.7);
  ctx.moveTo(size * 0.57, size * 0.46);
  ctx.lineTo(size * 0.56, size * 0.7);
  ctx.stroke();
}

function question(ctx: CanvasRenderingContext2D, size: number) {
  ctx.lineWidth = size * 0.11;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.arc(size / 2, size * 0.38, size * 0.17, Math.PI * 1.05, Math.PI * 2.45);
  ctx.bezierCurveTo(size * 0.7, size * 0.58, size / 2, size * 0.58, size / 2, size * 0.68);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(size / 2, size * 0.82, size * 0.055, 0, Math.PI * 2);
  ctx.fill();
}

/** A square white-on-clear texture of one of the marks. */
export function glyphTexture(glyph: Glyph, size = 256): CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.clearRect(0, 0, size, size);
    ctx.strokeStyle = '#ffffff';
    ctx.fillStyle = '#ffffff';
    if (glyph === 'recyclable') arrows(ctx, size);
    else if (glyph === 'trash') bin(ctx, size);
    else question(ctx, size);
  }
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.magFilter = LinearFilter;
  texture.minFilter = LinearMipmapLinearFilter;
  texture.anisotropy = 4;
  return texture;
}
