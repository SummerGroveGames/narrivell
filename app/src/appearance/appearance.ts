/**
 * Reading-app-style appearance settings for the writing page, kept on this
 * computer (not in the project, so each machine can look different).
 * Modelled on Kindle's Aa panel: Font, Layout, Themes, More.
 */

export type FontId = 'book' | 'classic' | 'modern' | 'sans' | 'typewriter';
export type PageId = 'white' | 'paper' | 'sepia' | 'mint' | 'grey' | 'night' | 'black' | 'custom';
export type Margin = 'narrow' | 'medium' | 'wide';
export type Align = 'left' | 'justify';
export type Paragraphs = 'book' | 'spaced';

export interface Appearance {
  font: FontId;
  /** Text size in px, 14–32. */
  size: number;
  /** Line height, 1.3–2.2. */
  spacing: number;
  page: PageId;
  /** Follow the computer's light/dark setting (uses `page` by day, Night by night). */
  matchSystem: boolean;
  customBackground: string;
  customText: string;
  margin: Margin;
  align: Align;
  paragraphs: Paragraphs;
  grain: boolean;
  typewriter: boolean;
  /** Night light: 0 (off) – 80, a warm amber tint over the whole window that cuts blue light. */
  warmth: number;
  /** Only apply warmth in the evening and night, between these hours (0–23). */
  warmthAuto: boolean;
  warmthFrom: number;
  warmthTo: number;
}

export interface NamedTheme {
  name: string;
  settings: Appearance;
}

export const FONTS: { id: FontId; label: string; stack: string }[] = [
  { id: 'book', label: 'Book', stack: "'Iowan Old Style', 'Palatino Linotype', Palatino, 'URW Palladio L', 'P052', Georgia, serif" },
  { id: 'classic', label: 'Georgia', stack: "Georgia, 'Gelasio', 'DejaVu Serif', serif" },
  { id: 'modern', label: 'Cambria', stack: "Cambria, 'Caladea', 'Charter', 'Bitstream Charter', 'Noto Serif', serif" },
  { id: 'sans', label: 'Sans', stack: "'Segoe UI', system-ui, 'Ubuntu', 'Cantarell', 'Noto Sans', sans-serif" },
  { id: 'typewriter', label: 'Typewriter', stack: "'Cascadia Mono', Consolas, 'Ubuntu Mono', 'DejaVu Sans Mono', ui-monospace, monospace" },
];

export const PAGES: { id: Exclude<PageId, 'custom'>; label: string; background: string; text: string }[] = [
  { id: 'white', label: 'White', background: '#ffffff', text: '#1d1d1b' },
  { id: 'paper', label: 'Paper', background: '#f7f3ea', text: '#2b2a26' },
  { id: 'sepia', label: 'Sepia', background: '#f4e7cf', text: '#4a3726' },
  { id: 'mint', label: 'Green', background: '#d7e8d6', text: '#1f2e22' },
  { id: 'grey', label: 'Grey', background: '#5a5c5f', text: '#f1f1ef' },
  { id: 'night', label: 'Night', background: '#1b1f1c', text: '#d9d4c8' },
  { id: 'black', label: 'Black', background: '#000000', text: '#d6d6d6' },
];

export const MARGINS: Record<Margin, string> = { narrow: '50rem', medium: '40rem', wide: '32rem' };

export const DEFAULT_APPEARANCE: Appearance = {
  font: 'book',
  size: 19,
  spacing: 1.7,
  page: 'paper',
  matchSystem: true,
  customBackground: '#efe6d4',
  customText: '#2b2a26',
  margin: 'medium',
  align: 'left',
  paragraphs: 'book',
  grain: false,
  typewriter: false,
  warmth: 0,
  warmthAuto: true,
  warmthFrom: 19,
  warmthTo: 7,
};

export const BUILT_IN_THEMES: NamedTheme[] = [
  { name: 'Standard', settings: DEFAULT_APPEARANCE },
  { name: 'Compact', settings: { ...DEFAULT_APPEARANCE, size: 16, spacing: 1.45, margin: 'narrow' } },
  { name: 'Large print', settings: { ...DEFAULT_APPEARANCE, size: 26, spacing: 1.9, font: 'sans', margin: 'medium' } },
  { name: 'Manuscript', settings: { ...DEFAULT_APPEARANCE, page: 'white', matchSystem: false, font: 'typewriter', size: 17, spacing: 2, paragraphs: 'book' } },
  { name: 'Late night', settings: { ...DEFAULT_APPEARANCE, page: 'black', matchSystem: false, size: 20, spacing: 1.8 } },
];

// ---------------------------------------------------------------------------
// Reading saved settings (untrusted: localStorage can hold anything)
// ---------------------------------------------------------------------------

const HEX = /^#[0-9a-f]{6}$/i;
const clamp = (n: unknown, min: number, max: number, fallback: number) =>
  typeof n === 'number' && Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
const pick = <T extends string>(v: unknown, options: readonly T[], fallback: T): T =>
  typeof v === 'string' && (options as readonly string[]).includes(v) ? (v as T) : fallback;

export function cleanAppearance(raw: unknown): Appearance {
  const r = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  const d = DEFAULT_APPEARANCE;
  return {
    font: pick(r.font, FONTS.map((f) => f.id), d.font),
    size: Math.round(clamp(r.size, 14, 32, d.size)),
    spacing: Math.round(clamp(r.spacing, 1.3, 2.2, d.spacing) * 20) / 20,
    page: pick(r.page, [...PAGES.map((p) => p.id), 'custom'] as PageId[], d.page),
    matchSystem: typeof r.matchSystem === 'boolean' ? r.matchSystem : d.matchSystem,
    customBackground: typeof r.customBackground === 'string' && HEX.test(r.customBackground) ? r.customBackground : d.customBackground,
    customText: typeof r.customText === 'string' && HEX.test(r.customText) ? r.customText : d.customText,
    margin: pick(r.margin, ['narrow', 'medium', 'wide'] as const, d.margin),
    align: pick(r.align, ['left', 'justify'] as const, d.align),
    paragraphs: pick(r.paragraphs, ['book', 'spaced'] as const, d.paragraphs),
    grain: typeof r.grain === 'boolean' ? r.grain : d.grain,
    typewriter: typeof r.typewriter === 'boolean' ? r.typewriter : d.typewriter,
    warmth: Math.round(clamp(r.warmth, 0, 80, d.warmth)),
    warmthAuto: typeof r.warmthAuto === 'boolean' ? r.warmthAuto : d.warmthAuto,
    warmthFrom: Math.round(clamp(r.warmthFrom, 0, 23, d.warmthFrom)),
    warmthTo: Math.round(clamp(r.warmthTo, 0, 23, d.warmthTo)),
  };
}

export function cleanThemes(raw: unknown): NamedTheme[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((t): t is { name: string; settings: unknown } => typeof t === 'object' && t !== null && typeof t.name === 'string')
    .slice(0, 20)
    .map((t) => ({ name: t.name.trim().slice(0, 40) || 'My theme', settings: cleanAppearance(t.settings) }));
}

// ---------------------------------------------------------------------------
// Colours
// ---------------------------------------------------------------------------

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio between two #rrggbb colours (1–21). */
export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

export const isDark = (hex: string) => luminance(hex) < 0.2;

/** Mixes two colours; t = 0 gives a, 1 gives b. */
function mix(a: string, b: string, t: number): string {
  const channel = (i: number) =>
    Math.round(parseInt(a.slice(i, i + 2), 16) * (1 - t) + parseInt(b.slice(i, i + 2), 16) * t)
      .toString(16)
      .padStart(2, '0');
  return `#${channel(1)}${channel(3)}${channel(5)}`;
}

export interface Resolved {
  background: string;
  text: string;
  muted: string;
  dark: boolean;
}

/** The page colours actually in use, taking "match system" into account. */
export function resolvePage(a: Appearance, systemDark: boolean): Resolved {
  let background: string;
  let text: string;
  if (a.matchSystem && systemDark && !isDark(pageColours(a).background)) {
    ({ background, text } = PAGES.find((p) => p.id === 'night')!);
  } else {
    ({ background, text } = pageColours(a));
  }
  return { background, text, muted: mix(text, background, 0.45), dark: isDark(background) };
}

function pageColours(a: Appearance): { background: string; text: string } {
  if (a.page === 'custom') return { background: a.customBackground, text: a.customText };
  return PAGES.find((p) => p.id === a.page) ?? PAGES[1];
}

/** CSS custom properties for the writing page. */
export function pageStyle(a: Appearance, systemDark: boolean): Record<string, string> {
  const p = resolvePage(a, systemDark);
  return {
    '--page-bg': p.background,
    '--page-ink': p.text,
    '--page-muted': p.muted,
    '--page-font': FONTS.find((f) => f.id === a.font)!.stack,
    '--page-size': `${a.size}px`,
    '--page-leading': String(a.spacing),
    '--page-width': MARGINS[a.margin],
    '--page-align': a.align,
    '--page-hyphens': a.align === 'justify' ? 'auto' : 'manual',
  };
}

// ---------------------------------------------------------------------------
// Night light (warmth)
// ---------------------------------------------------------------------------

/**
 * How warm the window should be right now, 0–80. With the automatic schedule
 * it eases in over the first hour after `warmthFrom` and out over the last
 * hour before `warmthTo`, so it never jumps while you're writing.
 */
export function effectiveWarmth(a: Appearance, now: Date): number {
  if (a.warmth === 0) return 0;
  if (!a.warmthAuto) return a.warmth;
  const minutes = now.getHours() * 60 + now.getMinutes();
  const from = a.warmthFrom * 60;
  const to = a.warmthTo * 60;
  if (from === to) return a.warmth;
  const day = 24 * 60;
  const span = (to - from + day) % day; // length of the warm period
  const into = (minutes - from + day) % day; // minutes since it started
  if (into >= span) return 0;
  const ease = Math.min(1, into / 60, (span - into) / 60);
  return Math.round(a.warmth * ease);
}

/** Overlay colour for the warmth filter (multiplied over the window). */
export function warmthOverlay(warmth: number): string {
  const alpha = (warmth / 100) * 0.55;
  return `rgba(255, 147, 41, ${alpha.toFixed(3)})`;
}
