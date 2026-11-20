/** AI preferences for this computer. Keys are not here: they live in the system keychain. */
import type { ProviderId } from './providers';
import { PROVIDERS } from './providers';

export interface AiSettings {
  /** AI features are off until the author turns them on. */
  enabled: boolean;
  provider: ProviderId | null;
  models: Partial<Record<ProviderId, string>>;
  /** Show what will be sent, and ask, every time. */
  askBeforeSending: boolean;
  /** The author has read the notice about AI-generated text and disclosure. */
  acknowledged: boolean;
  /** Tag AI-suggested or AI-generated content in the book (the author's choice). */
  trackAiContent: boolean;
}

const KEY = 'narrivell.ai';
const IDS = PROVIDERS.map((p) => p.id);

export function cleanAiSettings(raw: unknown): AiSettings {
  const r = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  const models: Partial<Record<ProviderId, string>> = {};
  if (typeof r.models === 'object' && r.models) {
    for (const id of IDS) {
      const m = (r.models as Record<string, unknown>)[id];
      if (typeof m === 'string' && /^[A-Za-z0-9._:/@-]{1,150}$/.test(m)) models[id] = m;
    }
  }
  return {
    enabled: r.enabled === true,
    provider: IDS.includes(r.provider as ProviderId) ? (r.provider as ProviderId) : null,
    models,
    askBeforeSending: r.askBeforeSending !== false,
    acknowledged: r.acknowledged === true,
    trackAiContent: r.trackAiContent !== false,
  };
}

export function readAiSettings(): AiSettings {
  try {
    return cleanAiSettings(JSON.parse(localStorage.getItem(KEY) ?? 'null'));
  } catch {
    return cleanAiSettings(null);
  }
}

export function writeAiSettings(s: AiSettings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(cleanAiSettings(s)));
  } catch {
    // Not remembering a preference is harmless.
  }
  window.dispatchEvent(new Event('narrivell:ai-settings-changed'));
}

/** Asks the app to open Settings › AI connections. */
export const openAiSettings = () => window.dispatchEvent(new Event('narrivell:open-ai-settings'));
