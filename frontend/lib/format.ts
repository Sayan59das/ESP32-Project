import { copy } from './copy';
import type { Event, ItemCount, StoredBin } from './types';

const pad = (n: number) => String(n).padStart(2, '0');

/** Local wall-clock time, HH:MM:SS. */
export function clockTime(iso: string): string {
  const d = new Date(iso);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/** Local wall-clock time, HH:MM. */
export function shortTime(iso: string): string {
  const d = new Date(iso);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** 0.94 -> "94%". */
export function percent(fraction: number): string {
  return `${Math.round(fraction * 100)}%`;
}

/** The recycle rate as a percentage, or a dash when nothing is sorted yet. */
export function rateText(rate: number | null): string {
  return rate === null ? copy.noRate : percent(rate);
}

/** The other bin's share, or a dash when nothing is sorted yet. */
export function trashRateText(rate: number | null): string {
  return rate === null ? copy.noRate : percent(1 - rate);
}

export const SPLIT_MIN = 0.3;
export const SPLIT_MAX = 0.7;
/** Below this the clamp is too small to see, and a true-ratio mark would read as a glitch. */
const VISIBLE_CLAMP = 0.03;

/** Where the boundary between the bins sits: the recycle rate, clamped so both numerals
 *  fit, resting at the middle when nothing is sorted. `clamped` is true when the boundary
 *  visibly misstates the ratio, so the readout can mark the true one. */
export function splitFor(rate: number | null): { split: number; clamped: boolean } {
  if (rate === null) return { split: 0.5, clamped: false };
  const split = Math.min(SPLIT_MAX, Math.max(SPLIT_MIN, rate));
  return { split, clamped: Math.abs(split - rate) >= VISIBLE_CLAMP };
}

export function binWord(bin: StoredBin): string {
  switch (bin) {
    case 'recyclable':
      return 'Recyclable';
    case 'trash':
      return 'Trash';
    case 'unsure':
      return 'Unsure';
  }
}

/** Display name for an event's label. Names come from the server's by_item table, so the
 *  item list is never duplicated here. */
export function itemName(event: Pick<Event, 'label' | 'bin'>, items: ItemCount[]): string {
  if (event.bin === 'unsure') return 'Unsure';
  return items.find((item) => item.label === event.label)?.display_name ?? event.label;
}

/** Seconds as a short age: "3 s ago", "2 min ago". */
export function age(seconds: number | null): string {
  if (seconds === null) return 'never';
  if (seconds < 60) return `${Math.floor(seconds)} s ago`;
  return `${Math.floor(seconds / 60)} min ago`;
}
