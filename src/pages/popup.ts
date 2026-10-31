import { getApiKey } from '../shared/apiKey';
import { EFFORTS, modelLabel } from '../shared/models';
import type { RuntimeMessage } from '../shared/protocol';
import { getSettings, type Settings, siteKey, updateSettings } from '../shared/settings';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const setup = $<HTMLElement>('setup');
const ready = $<HTMLElement>('ready');
const askForm = $<HTMLFormElement>('ask-form');
const question = $<HTMLTextAreaElement>('question');
const askButton = $<HTMLButtonElement>('ask');
const modelLine = $<HTMLSpanElement>('model-line');
const showButton = $<HTMLInputElement>('show-button');
const siteRow = $<HTMLLabelElement>('site-row');
const siteEnabled = $<HTMLInputElement>('site-enabled');
const siteName = $<HTMLSpanElement>('site-name');
const shortcutKeys = $<HTMLSpanElement>('shortcut-keys');

let settings: Settings;
let site = '';

void init();

async function init(): Promise<void> {
  const [apiKey, loaded, [tab], commands] = await Promise.all([
    getApiKey(),
    getSettings(),
    chrome.tabs.query({ active: true, currentWindow: true }),
    chrome.commands.getAll(),
  ]);
  settings = loaded;

  if (!apiKey) {
    setup.hidden = false;
    return;
  }
  ready.hidden = false;

  const effort = EFFORTS.find((e) => e.id === settings.effort)?.label ?? settings.effort;
  modelLine.textContent = `${modelLabel(settings.model)} · ${effort} effort`;

  showButton.checked = settings.showFloatingButton;
  site = siteKey(tab?.url);
  siteRow.hidden = !site;
  siteName.textContent = site;
  siteEnabled.checked = !settings.disabledSites.includes(site);
  siteEnabled.disabled = !settings.showFloatingButton;

  const keys = commands.find((c) => c.name === 'ask-selection')?.shortcut;
  if (keys) {
    const kbd = document.createElement('kbd');
    kbd.textContent = keys;
    shortcutKeys.append(kbd);
  } else {
    shortcutKeys.textContent = 'your keyboard shortcut (set one in Settings)';
  }
  question.focus();
}

$('open-settings').addEventListener('click', openSettings);
$('setup-key').addEventListener('click', openSettings);

function openSettings(): void {
  void chrome.runtime.openOptionsPage();
  window.close();
}

question.addEventListener('input', () => (askButton.disabled = !question.value.trim()));
question.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    askForm.requestSubmit();
  }
});

askForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const text = question.value.trim();
  if (!text) return;
  const message: RuntimeMessage = { type: 'open-answer-window', text };
  await chrome.runtime.sendMessage(message);
  window.close();
});

showButton.addEventListener('change', async () => {
  settings.showFloatingButton = showButton.checked;
  siteEnabled.disabled = !showButton.checked;
  await updateSettings({ showFloatingButton: showButton.checked });
});

siteEnabled.addEventListener('change', async () => {
  const others = settings.disabledSites.filter((s) => s !== site);
  settings.disabledSites = siteEnabled.checked ? others : [...others, site];
  await updateSettings({ disabledSites: settings.disabledSites });
});
