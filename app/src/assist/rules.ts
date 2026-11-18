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

export interface Suggestion {
  /** Split before this top-level block. */
  at: number;
  strength: 'strong' | 'possible';
  reasons: string[];
  /** Words in the microchapter this break would end. */
  wordsBefore: number;
  /** The closing line before the break and the opening line after it. */
  closing: string;
  opening: string;
}

export interface Plan {
  suggestions: Suggestion[];
  /** Microchapter lengths if every suggestion is accepted. */
  lengths: number[];
  total: number;
}

const TIME_JUMP =
  /^(by (morning|noon|nightfall|evening|dawn|the time)|later(,| that| on)|hours later|minutes later|days later|weeks later|the next (morning|day|night|evening)|that (night|evening|morning|afternoon)|next morning|morning came|at (dawn|dusk|first light|midnight)|dawn|two days|three days|a week|when (he|she|they|we|i) (woke|returned|got back))/i;
const PLACE_SHIFT = /^(back (at|in|on)|inside the|outside the|across (the|town)|at the|in the [a-z]+ (room|lab|office|hall|module)|meanwhile|elsewhere)/i;

function textOf(node: DocNode): string {
  if (node.type === 'text') return node.text ?? '';
  if (node.type === 'hardBreak') return '\n';
  return (node.content ?? []).map(textOf).join('');
}

const firstLine = (s: string) => s.trim().split('\n')[0].slice(0, 160);
const lastLine = (s: string) => {
  const lines = s.trim().split('\n');
  return lines[lines.length - 1].slice(-160);
};

/** How strongly a paragraph reads as an ending: short, punchy, a question or a cut-off. */
function closingScore(text: string): { score: number; reason: string | null } {
  const t = text.trim();
  if (!t) return { score: 0, reason: null };
  const w = countWords(t);
  const last = lastLine(t);
  if (/[?]["”’]?$/.test(last) && w <= 25) return { score: 2, reason: 'Ends on a question' };
  if (/(—|–|…|\.\.\.)["”’]?$/.test(last)) return { score: 2, reason: 'Ends on a cut-off line' };
  if (w <= 6) return { score: 2, reason: 'Ends on a short, punchy line' };
  if (w <= 14 && /[.!]["”’]?$/.test(last)) return { score: 1, reason: 'Ends on a short line' };
  return { score: 0, reason: null };
}

interface Boundary {
  at: number;
  signal: number;
  reasons: string[];
  wordsUpTo: number;
}

export function suggestBreaks(doc: DocNode, target: { min: number; max: number }): Plan {
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
  const closings = texts.map((t, i) => (i < blocks.length - 1 && blocks[i].type !== 'horizontalRule' ? closingScore(t) : { score: 0, reason: null }));
  const closingCount = closings.filter((c) => c.reason).length;
  const closingWeight = Math.min(1, 0.12 / Math.max(0.01, closingCount / Math.max(1, blocks.length)));

  const candidates: Boundary[] = [];
  for (let i = 1; i < blocks.length; i++) {
    const reasons: string[] = [];
    let signal = 0;
    if (blocks[i].type === 'horizontalRule') {
      signal += 4;
      reasons.push('Scene-break mark');
    }
    const next = blocks[i].type === 'horizontalRule' ? (texts[i + 1] ?? '') : texts[i];
    if (TIME_JUMP.test(next.trim())) {
      signal += 3;
      reasons.push(`Time jump: “${next.trim().split(/[,.]/)[0].slice(0, 40)}…”`);
    } else if (PLACE_SHIFT.test(next.trim())) {
      signal += 1;
      reasons.push('New place or thread begins');
    }
    const close = blocks[i - 1].type === 'horizontalRule' ? closings[i - 2] : closings[i - 1];
    if (close?.reason) {
      signal += close.score * closingWeight;
      reasons.push(close.reason);
    }
    // Every paragraph boundary is a candidate, so a long stretch with no signals can still be divided.
    if (!reasons.length) reasons.push('Keeps it within your length target');
    candidates.push({ at: i, signal, reasons, wordsUpTo: cumulative[i] });
  }

  // Choose breaks with dynamic programming: each piece should land inside the
  // target range (steep cost outside it), strong signals are rewarded, and
  // every extra piece costs a little so chapters aren't split needlessly.
  const mid = (target.min + target.max) / 2;
  const pieceCost = (words: number) => {
    if (words < target.min) return 0.5 + ((target.min - words) / target.min) * 20;
    if (words > target.max) return 0.5 + ((words - target.max) / target.max) * 20;
    return (Math.abs(words - mid) / mid) * 1 + 0.3;
  };
  const points = [{ at: 0, signal: 0, reasons: [] as string[], wordsUpTo: 0 }, ...candidates, { at: blocks.length, signal: 0, reasons: [], wordsUpTo: total }];
  const best: number[] = new Array(points.length).fill(Infinity);
  const from: number[] = new Array(points.length).fill(-1);
  best[0] = 0;
  for (let j = 1; j < points.length; j++) {
    for (let i = j - 1; i >= 0; i--) {
      const words = points[j].wordsUpTo - points[i].wordsUpTo;
      if (words > target.max * 3) break; // far too long: earlier starts only get longer
      const reward = j === points.length - 1 ? 0 : points[j].signal * 0.8;
      const cost = best[i] + pieceCost(words) - reward;
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
      wordsBefore: b.wordsUpTo - prevWords,
      closing: lastLine(texts[b.at - 1] || texts[b.at - 2] || ''),
      opening: firstLine(blocks[b.at].type === 'horizontalRule' ? (texts[b.at + 1] ?? '') : texts[b.at]),
    });
    prevWords = b.wordsUpTo;
  }
  const lengths = [...suggestions.map((s) => s.wordsBefore), total - prevWords];
  return { suggestions, lengths, total };
}
