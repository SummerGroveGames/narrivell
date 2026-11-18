import { describe, expect, it } from 'vitest';
import { cleanAppearance, cleanThemes, contrast, DEFAULT_APPEARANCE, effectiveWarmth, pageStyle, resolvePage } from './appearance';

describe('appearance', () => {
  it('falls back to defaults for missing or damaged settings', () => {
    expect(cleanAppearance(null)).toEqual(DEFAULT_APPEARANCE);
    expect(cleanAppearance({ font: 'Comic Sans', size: 'huge', page: 'neon' })).toEqual(DEFAULT_APPEARANCE);
  });

  it('keeps valid settings and limits sizes', () => {
    const a = cleanAppearance({ ...DEFAULT_APPEARANCE, size: 99, spacing: 1.01, page: 'black' });
    expect(a.size).toBe(32);
    expect(a.spacing).toBe(1.3);
    expect(a.page).toBe('black');
  });

  it('refuses custom colours that are not plain hex (no CSS injection)', () => {
    const a = cleanAppearance({ ...DEFAULT_APPEARANCE, customBackground: 'red; background:url(x)' });
    expect(a.customBackground).toBe(DEFAULT_APPEARANCE.customBackground);
  });

  it('switches a light page to Night when following a dark system theme', () => {
    expect(resolvePage(DEFAULT_APPEARANCE, true).dark).toBe(true);
    expect(resolvePage(DEFAULT_APPEARANCE, false).background).toBe('#f7f3ea');
    expect(resolvePage({ ...DEFAULT_APPEARANCE, matchSystem: false }, true).dark).toBe(false);
  });

  it('measures contrast like WCAG', () => {
    expect(Math.round(contrast('#000000', '#ffffff'))).toBe(21);
    expect(contrast('#777777', '#808080')).toBeGreaterThan(1);
  });

  it('builds page CSS variables', () => {
    const style = pageStyle({ ...DEFAULT_APPEARANCE, margin: 'wide', align: 'justify' }, false);
    expect(style['--page-width']).toBe('32rem');
    expect(style['--page-align']).toBe('justify');
  });

  it('cleans saved themes', () => {
    expect(cleanThemes('x')).toEqual([]);
    expect(cleanThemes([{ name: '  ', settings: {} }])[0].name).toBe('My theme');
  });

  it('applies night-light warmth on an evening schedule, easing in and out', () => {
    const a = { ...DEFAULT_APPEARANCE, warmth: 40, warmthAuto: true, warmthFrom: 19, warmthTo: 7 };
    const at = (h: number, m = 0) => effectiveWarmth(a, new Date(2026, 10, 18, h, m));
    expect(at(12)).toBe(0);
    expect(at(19, 30)).toBe(20);
    expect(at(23)).toBe(40);
    expect(at(3)).toBe(40);
    expect(at(6, 30)).toBe(20);
    expect(at(7)).toBe(0);
    expect(effectiveWarmth({ ...a, warmthAuto: false }, new Date(2026, 10, 18, 12))).toBe(40);
    expect(effectiveWarmth({ ...a, warmth: 0 }, new Date(2026, 10, 18, 23))).toBe(0);
  });
});
