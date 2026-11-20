import { describe, expect, it } from 'vitest';
import type { DocNode } from '../project/doc';
import { emptyProfile, learned, recordAccepted, recordDismissed, cleanProfile } from '../assist/profile';
import { suggestBreaks } from '../assist/rules';
import { buildMicrochapterRequest, parseMicrochapterAnswer } from './microchapters';

const p = (text: string): DocNode => ({ type: 'paragraph', content: [{ type: 'text', text }] });
const words = (n: number) => Array.from({ length: n }, (_, i) => `w${i}`).join(' ') + '.';
const chapter: DocNode = { type: 'doc', content: [p(words(600)), p('She opened the door.'), p(words(700)), { type: 'horizontalRule' }, p(words(800))] };
const target = { min: 1000, max: 2000 };

describe('AI microchapter requests', () => {
  it('numbers paragraphs and includes the author’s rules and kept endings', () => {
    const profile = { ...emptyProfile(), houseRules: 'Never split a flashback.', endings: ['Then it isn’t decaying at all.'] };
    const req = buildMicrochapterRequest(chapter, { target, label: 'Chapter 27', profile, unitName: 'Microchapter' });
    expect(req.prompt).toContain('[2] She opened the door.');
    expect(req.prompt).toContain('[4] * * * (scene break)');
    expect(req.system).toContain('Never split a flashback.');
    expect(req.system).toContain('Then it isn’t decaying at all.');
    expect(req.paragraphs).toBe(5);
  });

  it('reads a fenced JSON answer into suggestions with titles and endings', () => {
    const answer = 'Here you go:\n```json\n{"microchapters":[{"start":1,"title":"The Door","endsOn":"She opened the door.","why":"Opening","strength":"strong"},{"start":3,"title":"Inside","endsOn":"end","why":"Door opens on a reveal","strength":"strong"},{"start":99},{"start":3}]}\n```';
    const plan = parseMicrochapterAnswer(answer, chapter);
    expect(plan.suggestions.map((s) => s.at)).toEqual([2]);
    expect(plan.suggestions[0].title).toBe('Inside');
    expect(plan.suggestions[0].source).toBe('ai');
    expect(plan.firstTitle).toBe('The Door');
    expect(plan.endings).toEqual(['She opened the door.', 'end']);
    expect(plan.lengths).toEqual([604, 1500]);
  });

  it('explains garbled answers instead of guessing', () => {
    expect(() => parseMicrochapterAnswer('Sorry, I can’t help with that.', chapter)).toThrow();
    expect(() => parseMicrochapterAnswer('{"microchapters": [', chapter)).toThrow();
  });
});

describe('learning profile', () => {
  it('learns which signals the author keeps and the lengths they like', () => {
    let prof = emptyProfile();
    const s = suggestBreaks(chapter, target).suggestions;
    const time = { ...(s[0] ?? { at: 1, strength: 'possible', reasons: [], source: 'rules', wordsBefore: 0, closing: 'x', opening: 'y' }), kinds: ['short' as const] };
    for (let i = 0; i < 4; i++) prof = recordDismissed(prof, time as never);
    prof = recordAccepted(prof, [{ ...time, kinds: ['scene'] } as never], [1200, 1300, 1250, 1400, 1350, 1300, 1280, 1320]);
    const l = learned(prof);
    expect(l.weights?.short).toBeLessThan(1);
    expect(l.preferredLength).toBe(1300);
  });

  it('cleans damaged profile files', () => {
    expect(cleanProfile({ houseRules: 5, lengths: ['x', -1, 1200], accepted: { scene: 'many' } })).toEqual({ ...emptyProfile(), lengths: [1200] });
  });
});
