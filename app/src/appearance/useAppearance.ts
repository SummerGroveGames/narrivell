import { useEffect, useState } from 'react';
import { type Appearance, cleanAppearance, cleanThemes, type NamedTheme } from './appearance';

const KEY = 'narrivell.appearance';
const THEMES_KEY = 'narrivell.themes';

function load<T>(key: string, clean: (raw: unknown) => T): T {
  try {
    return clean(JSON.parse(localStorage.getItem(key) ?? 'null'));
  } catch {
    return clean(null);
  }
}

function save(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Appearance is a nicety; failing to remember it is harmless.
  }
}

/** Appearance settings and saved themes for this computer, plus the system light/dark setting. */
export function useAppearance() {
  const [appearance, setAppearance] = useState<Appearance>(() => load(KEY, cleanAppearance));
  const [themes, setThemes] = useState<NamedTheme[]>(() => load(THEMES_KEY, cleanThemes));
  const [systemDark, setSystemDark] = useState(() => window.matchMedia('(prefers-color-scheme: dark)').matches);

  useEffect(() => {
    const query = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => setSystemDark(query.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);

  const update = (change: Partial<Appearance>) =>
    setAppearance((a) => {
      const next = cleanAppearance({ ...a, ...change });
      save(KEY, next);
      return next;
    });

  const saveTheme = (name: string) =>
    setThemes((t) => {
      const next = cleanThemes([...t.filter((x) => x.name !== name), { name, settings: appearance }]);
      save(THEMES_KEY, next);
      return next;
    });

  const removeTheme = (name: string) =>
    setThemes((t) => {
      const next = t.filter((x) => x.name !== name);
      save(THEMES_KEY, next);
      return next;
    });

  return { appearance, update, themes, saveTheme, removeTheme, systemDark };
}

export type AppearanceControls = ReturnType<typeof useAppearance>;
