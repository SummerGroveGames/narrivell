/** The AI services Narrivell can connect to. Calls go through the desktop app's Rust side (src-tauri/src/ai.rs). */
export type ProviderId = 'anthropic' | 'openai' | 'gemini' | 'xai' | 'venice' | 'ollama';

export interface ProviderInfo {
  id: ProviderId;
  name: string;
  company: string;
  needsKey: boolean;
  /** Where the author gets a key (shown as text; the app never opens web pages). */
  keyHelp: string;
  note: string;
}

export const PROVIDERS: ProviderInfo[] = [
  { id: 'anthropic', name: 'Claude', company: 'Anthropic', needsKey: true, keyHelp: 'console.anthropic.com → API keys', note: 'Strong at reading long fiction and judging pacing and hooks.' },
  { id: 'openai', name: 'ChatGPT', company: 'OpenAI', needsKey: true, keyHelp: 'platform.openai.com → API keys', note: 'Uses your OpenAI API account (separate from a ChatGPT subscription).' },
  { id: 'gemini', name: 'Gemini', company: 'Google', needsKey: true, keyHelp: 'aistudio.google.com → Get API key', note: 'Handles very long chapters easily.' },
  { id: 'xai', name: 'Grok', company: 'xAI', needsKey: true, keyHelp: 'console.x.ai → API keys', note: 'Uses your xAI API account.' },
  { id: 'venice', name: 'Venice', company: 'Venice.ai', needsKey: true, keyHelp: 'venice.ai → Settings → API', note: 'Privacy-focused; offers open models.' },
  { id: 'ollama', name: 'On this computer', company: 'Ollama', needsKey: false, keyHelp: 'Install Ollama from ollama.com and download a model with it', note: 'Free and private – your text never leaves this computer. Needs a capable PC, and results are usually weaker.' },
];

export const providerInfo = (id: ProviderId) => PROVIDERS.find((p) => p.id === id)!;

/** Drops models that can't write text (images, speech, embeddings…). */
export function chatModels(ids: string[]): string[] {
  const skip = /(embed|tts|whisper|dall-e|image|audio|moderation|realtime|transcribe|search|vision-preview|video|speech|rerank|upscale)/i;
  return [...new Set(ids.filter((id) => !skip.test(id)))].sort((a, b) => a.localeCompare(b));
}
