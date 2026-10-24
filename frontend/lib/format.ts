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

/** A bin's share of the sorted items, from the server's recycle rate. Says so in words when
 *  nothing is sorted yet: never 0%, a dash or NaN. */
export function binShare(rate: number | null, bin: 'recyclable' | 'trash'): string {
  if (rate === null) return copy.nothingSorted;
  return `${percent(bin === 'recyclable' ? rate : 1 - rate)} of sorted items`;
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

/** Seconds as a short duration: "3 s", "2 min". */
export function duration(seconds: number): string {
  if (seconds < 60) return `${Math.floor(seconds)} s`;
  return `${Math.floor(seconds / 60)} min`;
}

/** Seconds as a short age: "3 s ago", "2 min ago". */
export function age(seconds: number | null): string {
  return seconds === null ? 'never' : `${duration(seconds)} ago`;
}
