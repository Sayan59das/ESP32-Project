// The three outcomes and how each one looks. Every use pairs the colour with an icon and a
// word, so no outcome is told by colour alone.
import type { StoredBin } from '@/lib/types';

import type { BadgeTone } from './ui/Badge';
import type { IconName } from './ui/Icon';

export interface Outcome {
  tone: BadgeTone;
  icon: IconName;
  /** The bin, as a word: "Recyclable", "Trash", "Unsure". */
  word: string;
  /** What happened to the count. */
  counted: string;
}

export const OUTCOMES: Record<StoredBin, Outcome> = {
  recyclable: {
    tone: 'recyclable',
    icon: 'recyclable',
    word: 'Recyclable',
    counted: 'Counted as recyclable',
  },
  trash: { tone: 'trash', icon: 'trash', word: 'Trash', counted: 'Counted as trash' },
  unsure: { tone: 'unsure', icon: 'unsure', word: 'Unsure', counted: 'Not counted in either bin' },
};

/** An icon for an item label from the server's table, when the label is one we draw. */
export function itemIcon(label: string): IconName | null {
  if (label === 'recyclable') return 'recyclable';
  if (label === 'trash') return 'trash';
  return null;
}
