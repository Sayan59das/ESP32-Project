// Which chapter of the story the reader is in, as a continuous number, from where the
// chapter sections sit on the page. 2.5 means halfway through the third chapter.

export interface Span {
  top: number;
  height: number;
}

/**
 * `spans` are the chapters' positions in document coordinates, in order. The reading line is
 * the middle of the viewport: the chapter under it is the current one.
 */
export function chapterPosition(spans: readonly Span[], scrollY: number, viewport: number): number {
  const first = spans[0];
  const last = spans[spans.length - 1];
  if (first === undefined || last === undefined) return 0;
  const line = scrollY + viewport / 2;
  if (line <= first.top) return 0;
  if (line >= last.top + last.height) return spans.length - 1;
  for (let i = 0; i < spans.length; i++) {
    const span = spans[i] as Span;
    if (line < span.top + span.height) {
      return i + Math.max(0, (line - span.top) / Math.max(1, span.height));
    }
  }
  return spans.length - 1;
}

/**
 * The chapter whose words are on screen: what to show when motion is off. A chapter's text is
 * pinned for the middle of its section, so the section being read is the one `position` is in.
 */
export function currentChapter(position: number, count: number): number {
  return Math.min(count - 1, Math.max(0, Math.floor(position)));
}

/**
 * Where the camera belongs for chapter `index`: the middle of its section, which is where its
 * words are pinned. Poses are keyed here so the camera rests while a chapter is read and moves
 * while one chapter's words leave and the next arrive.
 */
export const centreOf = (index: number): number => index + 0.5;
