import { type FormEvent, useState } from 'react';
import { newId } from '../core/projectFile';
import type { Level, NumberStyle } from '../core/structure';
import { formatNumber } from '../core/structure';
import {
  CHOICES,
  customSettings,
  FICTION_PRESETS,
  fictionSettings,
  NONFICTION_PRESET,
  nonfictionSettings,
  type ProjectSettings,
  type TemplateKind,
} from '../core/templates';
import { isDesktop } from '../pwa';
import { pickFolder } from '../storage/native';
import { projectFolderName } from '../storage/paths';

export interface NewProjectRequest {
  title: string;
  author: string;
  settings: ProjectSettings;
  /** Desktop: the folder the project folder will be created in. */
  parent: string | null;
}

interface Props {
  onCancel: () => void;
  onCreate: (request: NewProjectRequest) => Promise<void>;
}

const TEMPLATES: { kind: TemplateKind; label: string; description: string }[] = [
  { kind: 'fiction', label: 'Fiction', description: 'Novels and stories, with chapters, parts or microchapters.' },
  { kind: 'nonfiction', label: 'Non-fiction', description: `${NONFICTION_PRESET.description}, notes, bibliography and figures.` },
  { kind: 'custom', label: 'Custom', description: 'Start blank and build your own structure.' },
];

function preview(levels: Level[]): string {
  return levels
    .map((l) => [l.showName ? l.name : '', formatNumber(1, l.numberStyle)].filter(Boolean).join(' ') || l.name)
    .join(' › ');
}

export function NewProject({ onCancel, onCreate }: Props) {
  const [template, setTemplate] = useState<TemplateKind>('fiction');
  const [preset, setPreset] = useState('chapters');
  const [custom, setCustom] = useState<ProjectSettings>(customSettings);
  const [title, setTitle] = useState('');
  const [author, setAuthor] = useState('');
  const [parent, setParent] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const settings =
    template === 'fiction' ? fictionSettings(preset) : template === 'nonfiction' ? nonfictionSettings() : custom;

  const updateLevel = (i: number, change: Partial<Level>) =>
    setCustom((s) => ({ ...s, levels: s.levels.map((l, j) => (j === i ? { ...l, ...change } : l)) }));
  const addLevel = () =>
    setCustom((s) => ({
      ...s,
      levels: [
        { id: newId(), name: 'Part', numberStyle: 'upper-roman', continuous: true, compound: false, showName: true },
        ...s.levels,
      ],
    }));
  const removeLevel = (i: number) => setCustom((s) => ({ ...s, levels: s.levels.filter((_, j) => j !== i) }));

  const chooseParent = async () => {
    try {
      const picked = await pickFolder('Choose where to keep your project');
      if (picked) setParent(picked);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    if (!title.trim()) return setError('Give your project a title.');
    if (isDesktop && !parent) return setError('Choose where to keep your project.');
    setBusy(true);
    try {
      await onCreate({ title: title.trim(), author: author.trim(), settings, parent });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  };

  return (
    <main className="shell">
      <form className="card" onSubmit={submit}>
        <h2>New project</h2>

        <fieldset className="choices">
          <legend>What are you writing?</legend>
          {TEMPLATES.map((t) => (
            <label key={t.kind} className={`choice ${template === t.kind ? 'choice--on' : ''}`}>
              <input type="radio" name="template" checked={template === t.kind} onChange={() => setTemplate(t.kind)} />
              <strong>{t.label}</strong>
              <span className="muted small">{t.description}</span>
            </label>
          ))}
        </fieldset>

        {template === 'fiction' && (
          <label className="field">
            <span>Structure</span>
            <select value={preset} onChange={(e) => setPreset(e.target.value)}>
              {FICTION_PRESETS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label} – {p.description}
                </option>
              ))}
            </select>
          </label>
        )}

        {template === 'custom' && (
          <fieldset className="levels">
            <legend>Structure, outermost first</legend>
            {custom.levels.map((l, i) => {
              const isText = i === custom.levels.length - 1;
              const names: string[] = CHOICES.levelNames.includes(l.name as never)
                ? [...CHOICES.levelNames]
                : [l.name, ...CHOICES.levelNames];
              return (
                <div key={l.id} className="level">
                  <select aria-label="Level name" value={l.name} onChange={(e) => updateLevel(i, { name: e.target.value })}>
                    {names.map((n) => (
                      <option key={n}>{n}</option>
                    ))}
                  </select>
                  <select
                    aria-label="Numbering"
                    value={l.numberStyle}
                    onChange={(e) => updateLevel(i, { numberStyle: e.target.value as NumberStyle })}
                  >
                    {CHOICES.numberStyles.map((s) => (
                      <option key={s.value} value={s.value}>
                        {s.label}
                      </option>
                    ))}
                  </select>
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={l.continuous}
                      onChange={(e) => updateLevel(i, { continuous: e.target.checked })}
                    />
                    Number through the whole book
                  </label>
                  {isText ? (
                    <span className="muted small">holds the text</span>
                  ) : (
                    <button type="button" className="link-button" onClick={() => removeLevel(i)}>
                      Remove
                    </button>
                  )}
                </div>
              );
            })}
            {custom.levels.length < 6 && (
              <button type="button" className="link-button" onClick={addLevel}>
                + Add an outer level
              </button>
            )}
          </fieldset>
        )}

        <p className="muted small">Looks like: {preview(settings.levels)}. You can change all of this later.</p>

        <label className="field">
          <span>Title</span>
          <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} autoFocus />
        </label>
        <label className="field">
          <span>Author</span>
          <input value={author} onChange={(e) => setAuthor(e.target.value)} maxLength={200} />
        </label>

        {isDesktop && (
          <div className="field">
            <span>Save in</span>
            <div className="row row--tight">
              <button type="button" className="button button--quiet" onClick={chooseParent}>
                Choose folder…
              </button>
              <span className="muted small path">
                {parent ? `${parent} › ${projectFolderName(title || 'Untitled')}` : 'No folder chosen'}
              </span>
            </div>
          </div>
        )}

        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}

        <div className="row">
          <button type="submit" className="button" disabled={busy}>
            Create project
          </button>
          <button type="button" className="button button--quiet" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
        </div>
      </form>
    </main>
  );
}
