/**
 * Starting templates. Fiction and Non-fiction are simply Custom with
 * sensible choices filled in; everything stays editable afterwards.
 */
import type { Level, NumberStyle } from './structure';

export type TemplateKind = 'fiction' | 'nonfiction' | 'custom';
export type NoteStyle = 'footnotes' | 'endnotes' | 'off';

export interface Features {
  notes: NoteStyle;
  bibliography: boolean;
  figures: boolean;
  /** Tagged comments / author notes in the margin. */
  comments: boolean;
}

export interface FrontBackMatter {
  front: string[];
  back: string[];
}

export interface WordTarget {
  min: number;
  max: number;
}

export interface ProjectSettings {
  template: TemplateKind;
  /** Which structure preset was used (for display only). */
  preset: string;
  levels: Level[];
  features: Features;
  matter: FrontBackMatter;
  /** Optional length target for each text unit. */
  unitTarget: WordTarget | null;
}

const level = (
  id: string,
  name: string,
  numberStyle: NumberStyle,
  opts: Partial<Pick<Level, 'continuous' | 'compound' | 'showName'>> = {},
): Level => ({
  id,
  name,
  numberStyle,
  continuous: opts.continuous ?? false,
  compound: opts.compound ?? false,
  showName: opts.showName ?? true,
});

export interface StructurePreset {
  id: string;
  label: string;
  description: string;
  levels: Level[];
}

/** Structure choices offered for Fiction. */
export const FICTION_PRESETS: StructurePreset[] = [
  {
    id: 'chapters',
    label: 'Chapters',
    description: 'Chapter 1, Chapter 2, …',
    levels: [level('chapter', 'Chapter', 'arabic', { continuous: true })],
  },
  {
    id: 'parts-chapters',
    label: 'Parts and chapters',
    description: 'Part One › Chapters numbered through the book',
    levels: [
      level('part', 'Part', 'words', { continuous: true }),
      level('chapter', 'Chapter', 'arabic', { continuous: true }),
    ],
  },
  {
    id: 'sections-microchapters',
    label: 'Sections and microchapters',
    description: 'Section I, II, III › short microchapters numbered through the book',
    levels: [
      level('section', 'Section', 'upper-roman', { continuous: true }),
      level('chapter', 'Chapter', 'arabic', { continuous: true }),
      level('microchapter', 'Microchapter', 'arabic', { continuous: true, showName: false }),
    ],
  },
  {
    id: 'chapters-sections',
    label: 'Chapters with sections',
    description: 'Chapter 27 › 27.i, 27.ii, 27.iii',
    levels: [
      level('chapter', 'Chapter', 'arabic', { continuous: true }),
      level('section', 'Section', 'lower-roman', { compound: true, showName: false }),
    ],
  },
];

export const NONFICTION_PRESET: StructurePreset = {
  id: 'parts-chapters-sections',
  label: 'Parts, chapters and sections',
  description: 'Part I › Chapter 1 › sections',
  levels: [
    level('part', 'Part', 'upper-roman', { continuous: true }),
    level('chapter', 'Chapter', 'arabic', { continuous: true }),
    level('section', 'Section', 'none', { showName: false }),
  ],
};

const FICTION_MATTER: FrontBackMatter = {
  front: ['title', 'copyright', 'dedication', 'contents'],
  back: ['acknowledgements', 'about-the-author'],
};

const NONFICTION_MATTER: FrontBackMatter = {
  front: ['title', 'copyright', 'dedication', 'contents', 'preface'],
  back: ['notes', 'bibliography', 'acknowledgements', 'about-the-author'],
};

export function fictionSettings(presetId = 'chapters'): ProjectSettings {
  const preset = FICTION_PRESETS.find((p) => p.id === presetId);
  if (!preset) throw new Error(`Unknown fiction preset "${presetId}".`);
  return {
    template: 'fiction',
    preset: preset.id,
    levels: structuredClone(preset.levels),
    features: { notes: 'off', bibliography: false, figures: false, comments: true },
    matter: structuredClone(FICTION_MATTER),
    unitTarget: presetId === 'sections-microchapters' ? { min: 1000, max: 2000 } : null,
  };
}

export function nonfictionSettings(): ProjectSettings {
  return {
    template: 'nonfiction',
    preset: NONFICTION_PRESET.id,
    levels: structuredClone(NONFICTION_PRESET.levels),
    features: { notes: 'footnotes', bibliography: true, figures: true, comments: true },
    matter: structuredClone(NONFICTION_MATTER),
    unitTarget: null,
  };
}

/** Custom starts blank: one unnamed level, nothing switched on. */
export function customSettings(): ProjectSettings {
  return {
    template: 'custom',
    preset: 'custom',
    levels: [level('unit', 'Section', 'arabic', { continuous: true })],
    features: { notes: 'off', bibliography: false, figures: false, comments: false },
    matter: { front: [], back: [] },
    unitTarget: null,
  };
}

/** Choices offered in the Custom template's dropdowns. */
export const CHOICES = {
  numberStyles: [
    { value: 'arabic', label: '1, 2, 3' },
    { value: 'upper-roman', label: 'I, II, III' },
    { value: 'lower-roman', label: 'i, ii, iii' },
    { value: 'words', label: 'One, Two, Three' },
    { value: 'none', label: 'No numbers' },
  ] satisfies { value: NumberStyle; label: string }[],
  levelNames: ['Book', 'Part', 'Sequence', 'Act', 'Chapter', 'Section', 'Microchapter', 'Scene'],
  frontMatter: ['title', 'copyright', 'dedication', 'epigraph', 'contents', 'foreword', 'preface', 'prologue'],
  backMatter: ['epilogue', 'afterword', 'notes', 'bibliography', 'acknowledgements', 'about-the-author', 'also-by'],
  notes: [
    { value: 'off', label: 'No notes' },
    { value: 'footnotes', label: 'Footnotes' },
    { value: 'endnotes', label: 'Endnotes' },
  ] satisfies { value: NoteStyle; label: string }[],
} as const;
