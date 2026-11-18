import { useEffect, useRef, useState } from 'react';
import {
  type Align,
  type Appearance,
  BUILT_IN_THEMES,
  contrast,
  FONTS,
  type Margin,
  PAGES,
  type Paragraphs,
} from '../appearance/appearance';
import type { AppearanceControls } from '../appearance/useAppearance';

type Tab = 'font' | 'layout' | 'themes' | 'more';
const TABS: { id: Tab; label: string }[] = [
  { id: 'font', label: 'Font' },
  { id: 'layout', label: 'Layout' },
  { id: 'themes', label: 'Themes' },
  { id: 'more', label: 'More' },
];

const hourLabel = (h: number) => new Date(2000, 0, 1, h).toLocaleTimeString([], { hour: 'numeric' });
const HOURS = Array.from({ length: 24 }, (_, h) => h);

/** Night-light settings that applying a theme leaves alone. */
const keepWarmth = (a: Appearance) => ({
  warmth: a.warmth,
  warmthAuto: a.warmthAuto,
  warmthFrom: a.warmthFrom,
  warmthTo: a.warmthTo,
});

function Lines({ inset, ragged }: { inset: number; ragged?: boolean }) {
  return (
    <svg viewBox="0 0 60 30" aria-hidden="true" className="lines">
      {[7, 13, 19, 25].map((y, i) => (
        <line key={y} x1={inset} x2={60 - inset - (ragged && i % 2 ? 8 : 0)} y1={y} y2={y} />
      ))}
    </svg>
  );
}

export function AppearancePanel({ controls, onClose }: { controls: AppearanceControls; onClose: () => void }) {
  const { appearance: a, update, themes, saveTheme, removeTheme } = controls;
  const [tab, setTab] = useState<Tab>('font');
  const [themeName, setThemeName] = useState('');
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    const onDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!ref.current?.contains(target) && !target.closest('[data-appearance-toggle]')) onClose();
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDown);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onDown);
    };
  }, [onClose]);

  const lowContrast = a.page === 'custom' && contrast(a.customBackground, a.customText) < 4.5;

  return (
    <section ref={ref} className="sheet" role="dialog" aria-label="Appearance">
      <div className="sheet__tabs" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            className={`sheet__tab ${tab === t.id ? 'sheet__tab--on' : ''}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="sheet__body" role="tabpanel">
        {tab === 'font' && (
          <>
            <div className="fonts">
              {FONTS.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  className={`font-card ${a.font === f.id ? 'font-card--on' : ''}`}
                  aria-pressed={a.font === f.id}
                  onClick={() => update({ font: f.id })}
                >
                  <span className="font-card__sample" style={{ fontFamily: f.stack }}>
                    Aa
                  </span>
                  <span className="font-card__name">{f.label}</span>
                </button>
              ))}
            </div>
            <label className="slider">
              <span className="slider__small" aria-hidden="true">A</span>
              <input
                type="range"
                min={14}
                max={32}
                step={1}
                value={a.size}
                aria-label="Text size"
                onChange={(e) => update({ size: Number(e.target.value) })}
              />
              <span className="slider__big" aria-hidden="true">A</span>
            </label>
            <div className="sheet__row">
              <div>
                <strong>Spacing</strong>
                <p className="muted small">Space between lines.</p>
              </div>
              <input
                type="range"
                min={1.3}
                max={2.2}
                step={0.05}
                value={a.spacing}
                aria-label="Line spacing"
                onChange={(e) => update({ spacing: Number(e.target.value) })}
              />
            </div>
          </>
        )}

        {tab === 'layout' && (
          <>
            <h3>Page colour</h3>
            <div className="swatches">
              {PAGES.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className={`swatch ${a.page === p.id ? 'swatch--on' : ''}`}
                  style={{ background: p.background, color: p.text }}
                  aria-label={p.label}
                  aria-pressed={a.page === p.id}
                  title={p.label}
                  onClick={() => update({ page: p.id })}
                >
                  a
                </button>
              ))}
              <button
                type="button"
                className={`swatch swatch--custom ${a.page === 'custom' ? 'swatch--on' : ''}`}
                style={{ background: a.customBackground, color: a.customText }}
                aria-label="Your own colours"
                aria-pressed={a.page === 'custom'}
                title="Your own colours"
                onClick={() => update({ page: 'custom' })}
              >
                +
              </button>
            </div>
            {a.page === 'custom' && (
              <div className="custom-colours">
                <label>
                  <input type="color" value={a.customBackground} onChange={(e) => update({ customBackground: e.target.value })} />
                  Background
                </label>
                <label>
                  <input type="color" value={a.customText} onChange={(e) => update({ customText: e.target.value })} />
                  Text
                </label>
                {lowContrast && <p className="warning small">These colours are hard to read. Try a darker text or lighter background.</p>}
              </div>
            )}
            <label className="check">
              <input type="checkbox" checked={a.matchSystem} onChange={(e) => update({ matchSystem: e.target.checked })} />
              Switch to Night when the computer is in dark mode
            </label>

            <h3>Margins</h3>
            <div className="options">
              {(['narrow', 'medium', 'wide'] as Margin[]).map((m, i) => (
                <button
                  key={m}
                  type="button"
                  className={`option ${a.margin === m ? 'option--on' : ''}`}
                  aria-pressed={a.margin === m}
                  aria-label={`${m[0].toUpperCase()}${m.slice(1)} margins`}
                  onClick={() => update({ margin: m })}
                >
                  <Lines inset={4 + i * 9} />
                </button>
              ))}
            </div>

            <h3>Alignment</h3>
            <div className="options">
              {(['justify', 'left'] as Align[]).map((al) => (
                <button
                  key={al}
                  type="button"
                  className={`option ${a.align === al ? 'option--on' : ''}`}
                  aria-pressed={a.align === al}
                  aria-label={al === 'justify' ? 'Justified' : 'Left aligned'}
                  onClick={() => update({ align: al })}
                >
                  <Lines inset={10} ragged={al === 'left'} />
                </button>
              ))}
            </div>

            <h3>Paragraphs</h3>
            <div className="options">
              {(['book', 'spaced'] as Paragraphs[]).map((p) => (
                <button
                  key={p}
                  type="button"
                  className={`option option--text ${a.paragraphs === p ? 'option--on' : ''}`}
                  aria-pressed={a.paragraphs === p}
                  onClick={() => update({ paragraphs: p })}
                >
                  {p === 'book' ? 'Indented, like a book' : 'Space between'}
                </button>
              ))}
            </div>
          </>
        )}

        {tab === 'themes' && (
          <>
            <ul className="themes">
              {[...BUILT_IN_THEMES.map((t) => ({ ...t, own: false })), ...themes.map((t) => ({ ...t, own: true }))].map((t) => (
                <li key={`${t.own}-${t.name}`}>
                  <button
                    type="button"
                    className="theme"
                    onClick={() => update({ ...t.settings, ...keepWarmth(a) })}
                  >
                    <span
                      className="theme__sample"
                      style={{
                        fontFamily: FONTS.find((f) => f.id === t.settings.font)?.stack,
                        background: PAGES.find((p) => p.id === t.settings.page)?.background ?? t.settings.customBackground,
                        color: PAGES.find((p) => p.id === t.settings.page)?.text ?? t.settings.customText,
                      }}
                    >
                      Aa
                    </span>
                    <span>{t.name}</span>
                  </button>
                  {t.own && (
                    <button type="button" className="link-button" onClick={() => removeTheme(t.name)} aria-label={`Delete ${t.name}`}>
                      Delete
                    </button>
                  )}
                </li>
              ))}
            </ul>
            <form
              className="sheet__row"
              onSubmit={(e) => {
                e.preventDefault();
                if (themeName.trim()) saveTheme(themeName.trim());
                setThemeName('');
              }}
            >
              <input
                placeholder="Name this look…"
                value={themeName}
                maxLength={40}
                aria-label="Theme name"
                onChange={(e) => setThemeName(e.target.value)}
              />
              <button type="submit" className="button button--small">
                Save as theme
              </button>
            </form>
          </>
        )}

        {tab === 'more' && (
          <>
            <div className="sheet__row">
              <div>
                <strong>Typewriter scrolling</strong>
                <p className="muted small">Keep the line you’re typing in the middle of the screen.</p>
              </div>
              <input
                type="checkbox"
                className="toggle"
                checked={a.typewriter}
                aria-label="Typewriter scrolling"
                onChange={(e) => update({ typewriter: e.target.checked })}
              />
            </div>
            <div className="sheet__row">
              <div>
                <strong>Paper texture</strong>
                <p className="muted small">A faint grain on the page.</p>
              </div>
              <input
                type="checkbox"
                className="toggle"
                checked={a.grain}
                aria-label="Paper texture"
                onChange={(e) => update({ grain: e.target.checked })}
              />
            </div>
            <div className="sheet__row sheet__row--stack">
              <div>
                <strong>Night light schedule</strong>
                <p className="muted small">
                  With Auto on, warmth fades in over an hour from the start time and out before the end time.
                </p>
              </div>
              <div className="row row--tight">
                <label className="check">
                  From
                  <select value={a.warmthFrom} onChange={(e) => update({ warmthFrom: Number(e.target.value) })}>
                    {HOURS.map((h) => (
                      <option key={h} value={h}>
                        {hourLabel(h)}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="check">
                  until
                  <select value={a.warmthTo} onChange={(e) => update({ warmthTo: Number(e.target.value) })}>
                    {HOURS.map((h) => (
                      <option key={h} value={h}>
                        {hourLabel(h)}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            </div>
          </>
        )}
      </div>

      <div className="sheet__warmth">
        <span aria-hidden="true" className="sun sun--cool">☀</span>
        <input
          type="range"
          min={0}
          max={80}
          value={a.warmth}
          aria-label="Night light warmth"
          title="Night light: warms the screen to cut blue light"
          onChange={(e) => update({ warmth: Number(e.target.value) })}
        />
        <span aria-hidden="true" className="sun sun--warm">☀</span>
        <label className="check check--stack">
          <input type="checkbox" checked={a.warmthAuto} onChange={(e) => update({ warmthAuto: e.target.checked })} />
          Auto
        </label>
      </div>
    </section>
  );
}
