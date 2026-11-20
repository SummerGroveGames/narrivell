/**
 * Built-in microchapter suggestions: no AI, no network. Looks at the
 * boundaries between paragraphs for signals a reader feels as a natural
 * pause – a scene mark, a jump in time or place, a short punchy closing
 * line – and picks a set of breaks that keeps each microchapter within the
 * author's length target. Suggestions only: nothing is changed until the
 * author accepts one.
 */
import type { DocNode } from '../project/doc';
import { countWords } from '../project/doc';

/** The kinds of signal behind a suggestion (used to learn what the author keeps). */
export type ReasonKey = 'scene' | 'time' | 'place' | 'question' | 'cutoff' | 'short' | 'length' | 'ai';

export interface Suggestion {
  /** Split before this top-level block. */
  at: number;
  strength: 'strong' | 'possible';
  reasons: string[];
  kinds: ReasonKey[];
  source: 'rules' | 'ai';
  /** AI only: a suggested title for the microchapter that starts here. */
  title?: string;
  /** Words in the microchapter this break would end. */
  wordsBefore: number;
  /** The closing line before the break and the opening line after it. */
  closing: string;
  opening: string;
}

export interface Plan {
  suggestions: Suggestion[];
  /** AI only: a title for the first microchapter (before the first break). */
  firstTitle?: string;
  /** AI only: the line or moment each microchapter ends on, in order. */
  endings?: string[];
  /** Microchapter lengths if every suggestion is accepted. */
  lengths: number[];
  total: number;
}

const TIME_JUMP =
  /^(by (morning|noon|nightfall|evening|dawn|the time)|later(,| that| on)|hours later|minutes later|days later|weeks later|the next (morning|day|night|evening)|that (night|evening|morning|afternoon)|next morning|morning came|at (dawn|dusk|first light|midnight)|dawn|two days|three days|a week|when (he|she|they|we|i) (woke|returned|got back))/i;
const PLACE_SHIFT = /^(back (at|in|on)|inside the|outside the|across (the|town)|at the|in the [a-z]+ (room|lab|office|hall|module)|meanwhile|elsewhere)/i;

export function textOf(node: DocNode): string {
  if (node.type === 'text') return node.text ?? '';
  if (node.type === 'hardBreak') return '\n';
  return (node.content ?? []).map(textOf).join('');
}

export const firstLine = (s: string) => s.trim().split('\n')[0].slice(0, 160);
export const lastLine = (s: string) => {
  const lines = s.trim().split('\n');
  return lines[lines.length - 1].slice(-160);
};

/** How strongly a paragraph reads as an ending: short, punchy, a question or a cut-off. */
function closingScore(text: string): { score: number; reason: string | null; key: ReasonKey | null } {
  const t = text.trim();
  if (!t) return { score: 0, reason: null, key: null };
  const w = countWords(t);
  const last = lastLine(t);
  if (/[?]["”’]?$/.test(last) && w <= 25) return { score: 2, reason: 'Ends on a question', key: 'question' };
  if (/(—|–|…|\.\.\.)["”’]?$/.test(last)) return { score: 2, reason: 'Ends on a cut-off line', key: 'cutoff' };
  if (w <= 6) return { score: 2, reason: 'Ends on a short, punchy line', key: 'short' };
  if (w <= 14 && /[.!]["”’]?$/.test(last)) return { score: 1, reason: 'Ends on a short line', key: 'short' };
  return { score: 0, reason: null, key: null };
}

const HEADER = /^(from|to|recipient|subject|re|cc|sent|date)\s*:/im;
const SIGN_OFF = /^([—–-]\s*\S.{0,30}|[A-Z][\w.]{0,15}( [A-Z][\w.]{0,15})?\.?)$/;
const OPENS_QUOTE = /^["“‘']/;

/**
 * Stretches that must stay together: a message, email, log or letter, with the
 * lines that introduce it ("A new message.", "He opened it.") and the reaction
 * right after it. A message belongs to the scene that reads it.
 */
export function protectedStretches(texts: string[], isRule: boolean[]): [number, number][] {
  const out: [number, number][] = [];
  for (let h = 0; h < texts.length; h++) {
    if (isRule[h] || !HEADER.test(texts[h])) continue;
    let end = Math.min(texts.length - 1, h + 8);
    for (let j = h + 2; j < Math.min(texts.length, h + 40); j++) {
      if (isRule[j]) {
        end = j - 1;
        break;
      }
      const t = texts[j].trim();
      if (SIGN_OFF.test(t) && t.split(/\s+/).length <= 4) {
        end = j;
        break;
      }
    }
    out.push([Math.max(0, h - 3), Math.min(texts.length - 1, end + 2)]);
    h = end;
  }
  return out;
}

/** Lessons from the author's past choices (see profile.ts). */
export interface Learned {
  /** How much to trust each kind of signal: 1 = as built, 0 = ignore, 2 = double. */
  weights?: Partial<Record<ReasonKey, number>>;
  /** The microchapter length the author tends to keep. */
  preferredLength?: number;
}

interface Boundary {
  at: number;
  signal: number;
  reasons: string[];
  kinds: ReasonKey[];
  wordsUpTo: number;
}

export function suggestBreaks(doc: DocNode, target: { min: number; max: number }, learned: Learned = {}): Plan {
  const w = (k: ReasonKey) => learned.weights?.[k] ?? 1;
  const blocks = doc.content ?? [];
  const texts = blocks.map(textOf);
  const cumulative: number[] = [];
  let sum = 0;
  for (const t of texts) {
    cumulative.push(sum);
    sum += countWords(t);
  }
  const total = sum;

  // Candidate boundaries (before block i) with their signal strength.
  // Closing-line signals are weighted by how rare they are in this chapter:
  // if half the paragraphs are short, a short paragraph says little.
  const closings = texts.map((t, i) => (i < blocks.length - 1 && blocks[i].type !== 'horizontalRule' ? closingScore(t) : { score: 0, reason: null, key: null }));
  const closingCount = closings.filter((c) => c.reason).length;
  const closingWeight = Math.min(1, 0.12 / Math.max(0.01, closingCount / Math.max(1, blocks.length)));

  const isRule = blocks.map((b) => b.type === 'horizontalRule');
  const stretches = protectedStretches(texts, isRule);
  const insideStretch = (i: number) => stretches.some(([a, b]) => i > a && i <= b);

  const candidates: Boundary[] = [];
  for (let i = 1; i < blocks.length; i++) {
    // Keep thoughts whole: never inside a message, in the middle of a
    // conversation, after a line that introduces something (“…:”), or before
    // a paragraph that continues a sentence – unless the author marked a scene break.
    if (!isRule[i]) {
      const prev = texts[i - 1].trim();
      const next = texts[i].trim();
      if (insideStretch(i)) continue;
      if (/:$/.test(prev) || /^[a-z]/.test(next)) continue;
      if (OPENS_QUOTE.test(prev) && OPENS_QUOTE.test(next)) continue;
    }
    const reasons: string[] = [];
    const kinds: ReasonKey[] = [];
    let signal = 0;
    if (blocks[i].type === 'horizontalRule') {
      signal += 4 * w('scene');
      reasons.push('Scene-break mark');
      kinds.push('scene');
    }
    const next = blocks[i].type === 'horizontalRule' ? (texts[i + 1] ?? '') : texts[i];
    if (TIME_JUMP.test(next.trim())) {
      signal += 3 * w('time');
      reasons.push(`Time jump: “${next.trim().split(/[,.]/)[0].slice(0, 40)}…”`);
      kinds.push('time');
    } else if (PLACE_SHIFT.test(next.trim())) {
      signal += 1 * w('place');
      reasons.push('New place or thread begins');
      kinds.push('place');
    }
    const close = blocks[i - 1].type === 'horizontalRule' ? closings[i - 2] : closings[i - 1];
    if (close?.reason && close.key) {
      signal += close.score * closingWeight * w(close.key);
      reasons.push(close.reason);
      kinds.push(close.key);
    }
    // Every paragraph boundary is a candidate, so a long stretch with no signals can still be divided.
    if (!reasons.length) {
      reasons.push('Keeps it within your length target');
      kinds.push('length');
    }
    candidates.push({ at: i, signal, reasons, kinds, wordsUpTo: cumulative[i] });
  }

  // Choose breaks with dynamic programming: each piece should land inside the
  // target range (steep cost outside it), strong signals are rewarded, and
  // every extra piece costs a little so chapters aren't split needlessly.
  const mid = Math.min(target.max, Math.max(target.min, learned.preferredLength ?? (target.min + target.max) / 2));
  const isEdge = (at: number) => at === blocks.length || isRule[at];
  const pieceCost = (words: number, from = -1, to = -1) => {
    // A short interlude set apart by scene breaks on both sides (or the end of
    // the chapter) can stand alone – e.g. a brief, mysterious point-of-view beat.
    if (words < target.min && from > 0 && isRule[from] && isEdge(to)) return 0.6;
    if (words < target.min * 0.5) return 1000;
    if (words < target.min) return 0.5 + ((target.min - words) / target.min) * 20;
    if (words > target.max) return 0.5 + ((words - target.max) / target.max) * 20;
    return (Math.abs(words - mid) / mid) * 1 + 0.3;
  };
  const points: Boundary[] = [{ at: 0, signal: 0, reasons: [], kinds: [], wordsUpTo: 0 }, ...candidates, { at: blocks.length, signal: 0, reasons: [], kinds: [], wordsUpTo: total }];
  const best: number[] = new Array(points.length).fill(Infinity);
  const from: number[] = new Array(points.length).fill(-1);
  best[0] = 0;
  for (let j = 1; j < points.length; j++) {
    for (let i = j - 1; i >= 0; i--) {
      const words = points[j].wordsUpTo - points[i].wordsUpTo;
      if (words > target.max * 3) break; // far too long: earlier starts only get longer
      const reward = j === points.length - 1 ? 0 : points[j].signal * 0.8;
      const cost = best[i] + pieceCost(words, points[i].at, points[j].at) - reward;
      if (cost < best[j]) {
        best[j] = cost;
        from[j] = i;
      }
    }
    if (best[j] === Infinity) {
      // No candidate near enough: fall back to the previous point so a plan always exists.
      best[j] = best[j - 1] + pieceCost(points[j].wordsUpTo - points[j - 1].wordsUpTo);
      from[j] = j - 1;
    }
  }
  const chosen: number[] = [];
  for (let j = from[points.length - 1]; j > 0; j = from[j]) chosen.unshift(j);

  const suggestions: Suggestion[] = [];
  let prevWords = 0;
  for (const k of chosen) {
    const b = points[k];
    suggestions.push({
      at: b.at,
      strength: b.signal >= 3 ? 'strong' : 'possible',
      reasons: b.reasons,
      kinds: b.kinds,
      source: 'rules',
      wordsBefore: b.wordsUpTo - prevWords,
      closing: lastLine(texts[b.at - 1] || texts[b.at - 2] || ''),
      opening: firstLine(blocks[b.at].type === 'horizontalRule' ? (texts[b.at + 1] ?? '') : texts[b.at]),
    });
    prevWords = b.wordsUpTo;
  }
  const lengths = [...suggestions.map((s) => s.wordsBefore), total - prevWords];
  return { suggestions, lengths, total };
}
