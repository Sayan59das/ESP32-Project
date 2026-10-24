// Where a label pinned to a point in the scene goes. A label leans away from its point toward
// one of four corners; it takes the first of its choices that stays on the screen and does not
// land on the words of the page, and is hidden if none does.

export interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** 1 is right or up, -1 is left or down. */
export type Lean = 1 | -1;
export type Corner = readonly [Lean, Lean];

/** Distance from the point to the label's box, sideways and up or down. */
const OFFSET_X = 50;
const OFFSET_Y = 29;

/** The space a label of width `w` and height `h` takes at point (x, y) for a lean. */
export function labelBox(x: number, y: number, w: number, h: number, lean: Corner): Box {
  const [sx, sy] = lean;
  const left = sx === 1 ? x + OFFSET_X : x - OFFSET_X - w;
  const bottom = sy === 1 ? y - OFFSET_Y : y + OFFSET_Y + h;
  return { left, right: left + w, top: bottom - h, bottom };
}

const overlaps = (a: Box, b: Box, pad: number): boolean =>
  a.left < b.right + pad &&
  a.right > b.left - pad &&
  a.top < b.bottom + pad &&
  a.bottom > b.top - pad;

/**
 * The first lean, starting with the preferred one, whose box is inside `view` (with a margin)
 * and clear of every box in `avoid`; null when there is none.
 */
export function chooseLean(
  x: number,
  y: number,
  w: number,
  h: number,
  preferred: Corner,
  view: Box,
  avoid: readonly Box[],
): Corner | null {
  const [a, b] = preferred;
  const choices: Corner[] = [
    [a, b],
    [a === 1 ? -1 : 1, b],
    [a, b === 1 ? -1 : 1],
    [a === 1 ? -1 : 1, b === 1 ? -1 : 1],
  ];
  for (const lean of choices) {
    const box = labelBox(x, y, w, h, lean);
    const inside =
      box.left >= view.left &&
      box.right <= view.right &&
      box.top >= view.top &&
      box.bottom <= view.bottom;
    if (inside && !avoid.some((other) => overlaps(box, other, 8))) return lean;
  }
  return null;
}
