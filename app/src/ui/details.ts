import type { LabelColor, Status } from '../core/structure';

export const STATUS_LABELS: Record<Status, string> = { idea: 'Idea', drafted: 'Drafted', revised: 'Revised', done: 'Done' };
export const LABEL_COLORS: Record<LabelColor, string> = {
  green: '#7a9c84',
  gold: '#c9a96e',
  rose: '#b8796a',
  blue: '#8aa0b8',
  purple: '#9a86b4',
  grey: '#9b958a',
};
export const LABEL_NAMES: Record<LabelColor, string> = { green: 'Green', gold: 'Gold', rose: 'Rose', blue: 'Blue', purple: 'Purple', grey: 'Grey' };

/** A steady colour for any text (used to colour cards by POV). */
export function colorFor(text: string): string {
  const palette = Object.values(LABEL_COLORS);
  let h = 0;
  for (const c of text) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return palette[h % palette.length];
}
