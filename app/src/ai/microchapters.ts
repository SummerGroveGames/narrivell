/**
 * Asking an AI model where a chapter should be divided into microchapters.
 * The model sees numbered paragraphs and answers with JSON; nothing it
 * returns can change the author's words – only suggest where to split.
 */
import { countWords, type DocNode } from '../project/doc';
import { firstLine, lastLine, type Plan, type Suggestion, textOf } from '../assist/rules';
import type { Profile } from '../assist/profile';

export interface AiRequest {
  system: string;
  prompt: string;
  /** Words and paragraphs being sent (for the preview). */
  words: number;
  paragraphs: number;
}

export function buildMicrochapterRequest(doc: DocNode, opts: { target: { min: number; max: number }; label: string; profile: Profile; unitName: string }): AiRequest {
  const { target, profile, unitName } = opts;
  const blocks = doc.content ?? [];
  const lines = blocks.map((b, i) => (b.type === 'horizontalRule' ? `[${i + 1}] * * * (scene break)` : `[${i + 1}] ${textOf(b).replace(/\n/g, ' / ')}`));
  const words = blocks.reduce((s, b) => s + countWords(textOf(b)), 0);
  const name = unitName.toLowerCase();
  const rules = profile.houseRules.trim();
  const endings = profile.endings.slice(-8);

  const system = [
    `You are an experienced fiction editor helping an author divide a long chapter into short ${name}s for a fast-paced, hook-driven novel.`,
    `Never rewrite, add or remove any of the author's words. You only choose where each ${name} starts.`,
    '',
    'How to choose:',
    `- Each ${name} should be roughly ${target.min.toLocaleString()}–${target.max.toLocaleString()} words, but story beats matter more than exact length.`,
    `- End each ${name} on a hook: a reveal, an unanswered question, a decision, a threat, a turn, or a strong emotional beat that makes the reader turn the page.`,
    `- Each ${name} must read as a complete thought: it has a beginning and an ending of its own.`,
    '- Never break in the middle of a conversation, an action sequence or a continuous beat.',
    '- Messages, emails, letters, logs and transmissions belong to the scene that introduces or reads them. Never make one its own section and never split around one.',
    `- The exception is a short interlude the author has set apart with scene breaks – for example a brief point-of-view beat from someone unnamed, often at the end of a run of scenes. That may stand alone as a small ${name} even though it is short.`,
    '- Good places to start a new one: a scene change, a jump in time or place, a change of point of view, or right after a hook lands.',
    rules ? `\nThe author's own rules (follow these first):\n${rules}` : '',
    endings.length ? `\nEndings this author has kept before (match this feel):\n${endings.map((e) => `- “${e}”`).join('\n')}` : '',
    '',
    'Answer with JSON only, no other text, in exactly this shape:',
    `{"${name}s":[{"start":1,"title":"short evocative title","endsOn":"the line or moment it ends on, under 15 words","why":"why it starts here, one sentence","strength":"strong"}]}`,
    `"start" is the number of the paragraph where that ${name} begins. The first one starts at 1. "strength" is "strong" or "possible".`,
  ]
    .filter((l) => l !== '')
    .join('\n');

  const prompt = `${opts.label} – ${words.toLocaleString()} words in ${blocks.length} numbered paragraphs.\n\n${lines.join('\n')}`;
  return { system, prompt, words, paragraphs: blocks.length };
}

const clip = (v: unknown, n: number) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, n) : '');

/** Reads the model's answer into a plan. Anything malformed is ignored rather than trusted. */
export function parseMicrochapterAnswer(answer: string, doc: DocNode): Plan {
  const blocks = doc.content ?? [];
  const texts = blocks.map(textOf);
  const cumulative: number[] = [];
  let sum = 0;
  for (const t of texts) {
    cumulative.push(sum);
    sum += countWords(t);
  }
  const total = sum;

  // Find the JSON object, even if the model wrapped it in a code fence or added a sentence.
  const start = answer.indexOf('{');
  const end = answer.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('The AI didn’t answer in the expected format. Try again, or try another model.');
  let data: unknown;
  try {
    data = JSON.parse(answer.slice(start, end + 1));
  } catch {
    throw new Error('The AI’s answer was cut off or garbled. Try again, or try another model.');
  }
  const list = Object.values((data ?? {}) as Record<string, unknown>).find(Array.isArray) as unknown[] | undefined;
  if (!list) throw new Error('The AI didn’t suggest any breaks.');

  const seen = new Set<number>();
  const segments = list
    .map((x) => (typeof x === 'object' && x ? (x as Record<string, unknown>) : {}))
    .map((x) => ({ start: Number(x.start), title: clip(x.title, 120), endsOn: clip(x.endsOn, 200), why: clip(x.why, 300), strength: x.strength === 'strong' ? 'strong' : 'possible' }))
    .filter((x) => Number.isInteger(x.start) && x.start >= 1 && x.start <= blocks.length && !seen.has(x.start) && seen.add(x.start))
    .sort((a, b) => a.start - b.start);

  const firstTitle = segments.find((s) => s.start === 1)?.title || undefined;
  const breaks = segments.filter((s) => s.start > 1);
  const suggestions: Suggestion[] = [];
  let prev = 0;
  for (const s of breaks) {
    const at = s.start - 1; // split before this block (0-based)
    suggestions.push({
      at,
      strength: s.strength as 'strong' | 'possible',
      reasons: [s.why || 'Suggested by AI'],
      kinds: ['ai'],
      source: 'ai',
      title: s.title || undefined,
      wordsBefore: cumulative[at] - prev,
      closing: lastLine(texts[at - 1] || texts[at - 2] || ''),
      opening: firstLine(blocks[at].type === 'horizontalRule' ? (texts[at + 1] ?? '') : texts[at]),
    });
    prev = cumulative[at];
  }
  const lengths = [...suggestions.map((s) => s.wordsBefore), total - prev];
  const endings = [...(segments.length && segments[0].start === 1 ? segments : [{ endsOn: '' }, ...segments])].map((s) => s.endsOn);
  return { suggestions, lengths, total, firstTitle, endings };
}
