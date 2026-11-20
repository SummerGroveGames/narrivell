/** Calls into the desktop app's AI bridge. Keys are only ever passed in, never read back. */
import { isDesktop } from '../pwa';
import type { ProviderId } from './providers';

async function call<T>(command: string, args: Record<string, unknown>): Promise<T> {
  if (!isDesktop) throw new Error('AI features work in the Windows and Linux apps.');
  const { invoke } = await import('@tauri-apps/api/core');
  try {
    return await invoke<T>(command, args);
  } catch (e) {
    throw new Error(typeof e === 'string' ? e : e instanceof Error ? e.message : 'Something went wrong talking to the AI.');
  }
}

export const saveKey = (provider: ProviderId, key: string) => call<void>('ai_save_key', { provider, key });
export const hasKey = (provider: ProviderId) => call<boolean>('ai_has_key', { provider });
export const forgetKey = (provider: ProviderId) => call<void>('ai_forget_key', { provider });
export const listModels = (provider: ProviderId) => call<string[]>('ai_models', { provider });
export const chat = (provider: ProviderId, model: string, system: string, prompt: string, maxTokens = 8000) =>
  call<string>('ai_chat', { provider, model, system, prompt, maxTokens });
