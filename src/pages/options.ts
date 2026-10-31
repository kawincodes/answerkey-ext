import { clearApiKey, getApiKey, looksLikeApiKey, setApiKey } from '../shared/apiKey';
import { EFFORTS, type Effort, MODELS } from '../shared/models';
import type { RuntimeMessage, TestKeyResult } from '../shared/protocol';
import { getSettings, MAX_CUSTOM_INSTRUCTIONS, onSettingsChanged, type Settings, updateSettings } from '../shared/settings';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const keyForm = $<HTMLFormElement>('key-form');
const keyInput = $<HTMLInputElement>('api-key');
const toggleKey = $<HTMLButtonElement>('toggle-key');
const testKey = $<HTMLButtonElement>('test-key');
const removeKey = $<HTMLButtonElement>('remove-key');
const keyStatus = $<HTMLParagraphElement>('key-status');
const modelSelect = $<HTMLSelectElement>('model');
const modelNote = $<HTMLParagraphElement>('model-note');
const effortSelect = $<HTMLSelectElement>('effort');
const effortNote = $<HTMLParagraphElement>('effort-note');
const instructions = $<HTMLTextAreaElement>('instructions');
const instructionsCount = $<HTMLSpanElement>('instructions-count');
const answersSaved = $<HTMLParagraphElement>('answers-saved');
const showButton = $<HTMLInputElement>('show-button');
const pageContext = $<HTMLInputElement>('page-context');
const sitesList = $<HTMLUListElement>('sites');
const sitesEmpty = $<HTMLParagraphElement>('sites-empty');
const shortcut = $<HTMLSpanElement>('shortcut');
const changeShortcut = $<HTMLButtonElement>('change-shortcut');

let settings: Settings;

void init();

async function init(): Promise<void> {
  for (const model of MODELS) modelSelect.add(new Option(model.label, model.id));
  for (const effort of EFFORTS) effortSelect.add(new Option(effort.label, effort.id));
  instructions.maxLength = MAX_CUSTOM_INSTRUCTIONS;

  $('welcome').hidden = location.hash !== '#welcome';

  settings = await getSettings();
  renderSettings();
  await renderKeyState();
  await renderShortcut();
  onSettingsChanged((updated) => {
    settings = updated;
    renderSettings();
  });
}

// ---------------------------------------------------------------------------
// API key

keyForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const key = keyInput.value.trim();
  if (!key) {
    showKeyStatus('error', 'Paste your API key first.');
    keyInput.focus();
    return;
  }
  await setApiKey(key);
  keyInput.value = '';
  setKeyVisible(false);
  await renderKeyState();
  await runKeyTest(key, 'Saved. Checking the key…');
});

testKey.addEventListener('click', async () => {
  const key = keyInput.value.trim() || (await getApiKey());
  if (!key) {
    showKeyStatus('error', 'There is no key to test. Paste your API key first.');
    return;
  }
  await runKeyTest(key, 'Checking the key…');
});

removeKey.addEventListener('click', async () => {
  await clearApiKey();
  keyInput.value = '';
  await renderKeyState();
  showKeyStatus('info', 'Key removed. AnswerKey can’t answer questions until you add one again.');
});

toggleKey.addEventListener('click', () => setKeyVisible(keyInput.type === 'password'));

function setKeyVisible(visible: boolean): void {
  keyInput.type = visible ? 'text' : 'password';
  toggleKey.textContent = visible ? 'Hide' : 'Show';
  toggleKey.setAttribute('aria-pressed', String(visible));
}

async function runKeyTest(key: string, pendingText: string): Promise<void> {
  showKeyStatus('info', pendingText);
  testKey.disabled = true;
  try {
    const message: RuntimeMessage = { type: 'test-api-key', apiKey: key, model: settings.model };
    const result = (await chrome.runtime.sendMessage(message)) as TestKeyResult | undefined;
    if (result?.ok) {
      showKeyStatus('ok', `Connected. This key can use ${result.modelName}.`);
    } else {
      const hint = looksLikeApiKey(key) ? '' : ' (Anthropic API keys start with “sk-ant-”.)';
      showKeyStatus('error', `${result?.message ?? 'The key could not be checked.'}${hint}`);
    }
  } catch (err) {
    showKeyStatus('error', `The key could not be checked: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    testKey.disabled = false;
  }
}

async function renderKeyState(): Promise<void> {
  const saved = await getApiKey();
  removeKey.disabled = !saved;
  keyInput.placeholder = saved ? `Saved key ending in …${saved.slice(-4)} — paste a new key to replace it` : 'sk-ant-…';
}

function showKeyStatus(kind: 'ok' | 'error' | 'warn' | 'info', text: string): void {
  keyStatus.className = `status ${kind}`;
  keyStatus.textContent = text;
  keyStatus.hidden = false;
}

// ---------------------------------------------------------------------------
// Preferences (saved as they change)

modelSelect.addEventListener('change', () => save({ model: modelSelect.value }));
effortSelect.addEventListener('change', () => save({ effort: effortSelect.value as Effort }));
showButton.addEventListener('change', () => save({ showFloatingButton: showButton.checked }));
pageContext.addEventListener('change', () => save({ includePageContext: pageContext.checked }));

let instructionsTimer: ReturnType<typeof setTimeout> | undefined;
instructions.addEventListener('input', () => {
  instructionsCount.textContent = String(instructions.value.length);
  clearTimeout(instructionsTimer);
  instructionsTimer = setTimeout(() => save({ customInstructions: instructions.value }), 500);
});

let savedTimer: ReturnType<typeof setTimeout> | undefined;
async function save(patch: Partial<Settings>): Promise<void> {
  settings = { ...settings, ...patch };
  renderNotes();
  try {
    await updateSettings(patch);
    answersSaved.textContent = 'Saved.';
  } catch (err) {
    answersSaved.textContent = `Couldn't save: ${err instanceof Error ? err.message : String(err)}`;
  }
  clearTimeout(savedTimer);
  savedTimer = setTimeout(() => (answersSaved.textContent = ''), 2000);
}

function renderSettings(): void {
  modelSelect.value = settings.model;
  effortSelect.value = settings.effort;
  if (document.activeElement !== instructions) instructions.value = settings.customInstructions;
  instructionsCount.textContent = String(instructions.value.length);
  showButton.checked = settings.showFloatingButton;
  pageContext.checked = settings.includePageContext;
  renderNotes();
  renderSites();
}

function renderNotes(): void {
  modelNote.textContent = MODELS.find((m) => m.id === settings.model)?.note ?? '';
  effortNote.textContent = EFFORTS.find((e) => e.id === settings.effort)?.note ?? '';
}

function renderSites(): void {
  sitesList.replaceChildren();
  for (const site of settings.disabledSites) {
    const item = document.createElement('li');
    const name = document.createElement('span');
    name.textContent = site;
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.textContent = 'Show again';
    remove.addEventListener('click', () =>
      save({ disabledSites: settings.disabledSites.filter((s) => s !== site) }).then(renderSites),
    );
    item.append(name, remove);
    sitesList.append(item);
  }
  sitesEmpty.hidden = settings.disabledSites.length > 0;
}

// ---------------------------------------------------------------------------
// Keyboard shortcut

const isEdge = navigator.userAgent.includes('Edg/');

async function renderShortcut(): Promise<void> {
  const commands = await chrome.commands.getAll();
  const keys = commands.find((c) => c.name === 'ask-selection')?.shortcut;
  shortcut.replaceChildren();
  if (keys) {
    const kbd = document.createElement('kbd');
    kbd.textContent = keys;
    shortcut.append(kbd, ' asks Claude about the selected text.');
  } else {
    shortcut.textContent = 'Not set. Choose one on the browser’s shortcuts page.';
  }
}

changeShortcut.addEventListener('click', () => {
  void chrome.tabs.create({ url: isEdge ? 'edge://extensions/shortcuts' : 'chrome://extensions/shortcuts' });
});
window.addEventListener('focus', () => void renderShortcut());
