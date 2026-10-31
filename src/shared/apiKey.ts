/**
 * The user's Anthropic API key lives only in chrome.storage.local: it never syncs
 * to other devices, and the background worker restricts that storage area to
 * extension pages (content scripts running inside web pages can't read it).
 */
const STORAGE_KEY = 'anthropicApiKey';

export async function getApiKey(): Promise<string> {
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  const key = stored[STORAGE_KEY];
  return typeof key === 'string' ? key : '';
}

export async function setApiKey(key: string): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEY]: key.trim() });
}

export async function clearApiKey(): Promise<void> {
  await chrome.storage.local.remove(STORAGE_KEY);
}

/** Anthropic API keys start with this prefix; used only for a friendly warning. */
export function looksLikeApiKey(key: string): boolean {
  return key.trim().startsWith('sk-ant-');
}
