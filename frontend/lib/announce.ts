// What the polite live region says when a verdict arrives. The counts are the server's,
// from the state that followed the event; nothing here adds to them.
import { binWord, percent } from './format';
import type { Counts, Event } from './types';

export function verdictAnnouncement(event: Event, name: string, counts: Counts): string {
  const confidence = `${percent(event.confidence)} confidence`;
  if (event.bin === 'unsure') {
    return `Unsure, not counted, ${confidence}. Unsure items: ${counts.unsure}.`;
  }
  const word = binWord(event.bin);
  const what = name === word ? word : `${name}, ${word.toLowerCase()}`;
  return `${what}, ${confidence}. Recyclable ${counts.recyclable}, trash ${counts.trash}.`;
}
