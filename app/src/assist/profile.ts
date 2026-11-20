/**
 * What Narrivell learns about how this author likes microchapters, from the
 * breaks they accept and dismiss, the lengths they keep, the endings they
 * choose and the rules they write down. Stored in the project folder
 * (assist-profile.json) so it travels with the book between computers.
 * It tunes the built-in rules and is shared with the AI as guidance.
 */
import type { StorageProvider } from '../storage/types';
import type { Learned, ReasonKey, Suggestion } from './rules';

export const PROFILE_FILE = 'assist-profile.json';
const KEYS: ReasonKey[] = ['scene', 'time', 'place', 'question', 'cutoff', 'short', 'length', 'ai'];

export interface Profile {
  format: 1;
  /** The author's own rules, in their words. */
  houseRules: string;
  accepted: Partial<Record<ReasonKey, number>>;
  dismissed: Partial<Record<ReasonKey, number>>;
  /** Lengths of microchapters the author kept (most recent last). */
  lengths: number[];
  /** Closing lines of microchapters the author kept (most recent last). */
  endings: string[];
}

export const emptyProfile = (): Profile => ({ format: 1, houseRules: '', accepted: {}, dismissed: {}, lengths: [], endings: [] });

const counts = (v: unknown): Partial<Record<ReasonKey, number>> => {
  const out: Partial<Record<ReasonKey, number>> = {};
  if (typeof v !== 'object' || v === null) return out;
  for (const k of KEYS) {
    const n = (v as Record<string, unknown>)[k];
    if (typeof n === 'number' && Number.isFinite(n) && n >= 0) out[k] = Math.min(100_000, Math.floor(n));
  }
  return out;
};

export function cleanProfile(raw: unknown): Profile {
  const r = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  return {
    format: 1,
    houseRules: typeof r.houseRules === 'string' ? r.houseRules.slice(0, 4000) : '',
    accepted: counts(r.accepted),
    dismissed: counts(r.dismissed),
    lengths: Array.isArray(r.lengths) ? r.lengths.filter((n): n is number => typeof n === 'number' && n > 0 && n < 100_000).slice(-200) : [],
    endings: Array.isArray(r.endings) ? r.endings.filter((s): s is string => typeof s === 'string').map((s) => s.slice(0, 200)).slice(-30) : [],
  };
}

export async function loadProfile(storage: StorageProvider): Promise<Profile> {
  try {
    const text = await storage.readText(PROFILE_FILE);
    return text ? cleanProfile(JSON.parse(text)) : emptyProfile();
  } catch {
    return emptyProfile();
  }
}

export function saveProfile(storage: StorageProvider, profile: Profile): Promise<void> {
  return storage.writeText(PROFILE_FILE, `${JSON.stringify(cleanProfile(profile), null, 2)}\n`);
}

/** Records accepted breaks: which signals they had, the lengths kept and the closing lines. */
export function recordAccepted(p: Profile, accepted: Suggestion[], lengths: number[]): Profile {
  const next = cleanProfile(p);
  for (const s of accepted) {
    for (const k of new Set(s.kinds)) next.accepted[k] = (next.accepted[k] ?? 0) + 1;
    if (s.closing.trim()) next.endings.push(s.closing.trim());
  }
  next.lengths.push(...lengths.filter((n) => n > 0));
  return cleanProfile(next);
}

export function recordDismissed(p: Profile, s: Suggestion): Profile {
  const next = cleanProfile(p);
  for (const k of new Set(s.kinds)) next.dismissed[k] = (next.dismissed[k] ?? 0) + 1;
  return next;
}

/** Turns the profile into adjustments for the built-in rules. */
export function learned(p: Profile): Learned {
  const weights: Partial<Record<ReasonKey, number>> = {};
  for (const k of KEYS) {
    const a = p.accepted[k] ?? 0;
    const d = p.dismissed[k] ?? 0;
    if (a + d >= 3) weights[k] = Math.max(0.1, Math.min(2, ((a + 1) / (a + d + 2)) * 2));
  }
  let preferredLength: number | undefined;
  if (p.lengths.length >= 8) {
    const sorted = [...p.lengths].sort((x, y) => x - y);
    preferredLength = sorted[Math.floor(sorted.length / 2)];
  }
  return { weights, preferredLength };
}

/** A one-line, plain-English summary of what's been learned so far. */
export function describeProfile(p: Profile): string {
  const kept = Object.values(p.accepted).reduce((s, n) => s + (n ?? 0), 0);
  const dropped = Object.values(p.dismissed).reduce((s, n) => s + (n ?? 0), 0);
  if (!kept && !dropped) return 'Nothing learned yet – it learns from the breaks you accept and dismiss.';
  const l = learned(p);
  const parts = [`Learned from ${kept + dropped} of your choices`];
  if (l.preferredLength) parts.push(`you tend to keep microchapters around ${l.preferredLength.toLocaleString()} words`);
  return `${parts.join('; ')}.`;
}
