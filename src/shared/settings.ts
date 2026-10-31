import { DEFAULT_EFFORT, DEFAULT_MODEL, type Effort, isEffort, MODELS } from './models';

/**
 * Non-secret preferences. Kept in chrome.storage.sync so they follow the user's
 * Edge profile. The API key is NOT stored here (see apiKey.ts).
 */
export interface Settings {
  model: string;
  effort: Effort;
  showFloatingButton: boolean;
  includePageContext: boolean;
  customInstructions: string;
  disabledSites: string[];
}

export const DEFAULT_SETTINGS: Settings = {
  model: DEFAULT_MODEL,
  effort: DEFAULT_EFFORT,
  showFloatingButton: true,
  includePageContext: true,
  customInstructions: '',
  disabledSites: [],
};

/** chrome.storage.sync allows 8 KB per item; stay well under it. */
export const MAX_CUSTOM_INSTRUCTIONS = 2000;

export async function getSettings(): Promise<Settings> {
  const raw = await chrome.storage.sync.get(Object.keys(DEFAULT_SETTINGS));
  return normalize(raw);
}

export async function updateSettings(patch: Partial<Settings>): Promise<void> {
  await chrome.storage.sync.set(patch);
}

export function onSettingsChanged(callback: (settings: Settings) => void): void {
  chrome.storage.onChanged.addListener((_changes, area) => {
    if (area === 'sync') void getSettings().then(callback);
  });
}

/** The key used for per-site disabling; empty for pages without a host (file:, data:). */
export function siteKey(url: string | undefined): string {
  if (!url) return '';
  try {
    const { protocol, hostname } = new URL(url);
    return protocol === 'http:' || protocol === 'https:' ? hostname : '';
  } catch {
    return '';
  }
}

function normalize(raw: Record<string, unknown>): Settings {
  const d = DEFAULT_SETTINGS;
  return {
    model: typeof raw.model === 'string' && MODELS.some((m) => m.id === raw.model) ? raw.model : d.model,
    effort: isEffort(raw.effort) ? raw.effort : d.effort,
    showFloatingButton:
      typeof raw.showFloatingButton === 'boolean' ? raw.showFloatingButton : d.showFloatingButton,
    includePageContext:
      typeof raw.includePageContext === 'boolean' ? raw.includePageContext : d.includePageContext,
    customInstructions:
      typeof raw.customInstructions === 'string'
        ? raw.customInstructions.slice(0, MAX_CUSTOM_INSTRUCTIONS)
        : d.customInstructions,
    disabledSites: Array.isArray(raw.disabledSites)
      ? raw.disabledSites.filter((s): s is string => typeof s === 'string')
      : d.disabledSites,
  };
}
