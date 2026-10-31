// Runs in every page. Kept small on purpose: it watches for selections and shows
// the "Ask Claude" button, and loads the React answer panel (panel.js) only the
// first time you ask something on the page.
import { createElement, Sparkles } from 'lucide';
import type { PanelController } from '../panel/mount';
import type { PageInfo, RuntimeMessage, TabMessage, TabMessageResponse } from '../shared/protocol';
import { getSettings, onSettingsChanged, type Settings, siteKey } from '../shared/settings';

type Global = typeof globalThis & { __answerKeyCleanup?: () => void };
type PanelModule = typeof import('../panel/mount');

// This script can run twice in a page: once from the manifest and again when the
// background worker injects it (for example into a tab that was open before an
// update). Tear down the older copy first.
(globalThis as Global).__answerKeyCleanup?.();

const lifetime = new AbortController();
const { signal } = lifetime;
const MIN_SELECTION_CHARS = 2;

// The floating button, styled like a shadcn/ui default button.
const FAB_CSS = `
.ak-fab {
  position: fixed;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 32px;
  padding: 0 12px 0 10px;
  border: 1px solid transparent;
  border-radius: 8px;
  background: oklch(0.205 0 0);
  color: oklch(0.985 0 0);
  box-shadow: 0 10px 15px -3px rgb(0 0 0 / 0.15), 0 4px 6px -4px rgb(0 0 0 / 0.15);
  font: 500 13px/1 ui-sans-serif, system-ui, sans-serif, "Apple Color Emoji", "Segoe UI Emoji";
  letter-spacing: normal;
  white-space: nowrap;
  cursor: pointer;
  user-select: none;
  animation: ak-fab-in 120ms ease-out;
}
.ak-fab:hover { background: oklch(0.269 0 0); }
.ak-fab:focus-visible { outline: none; box-shadow: 0 0 0 3px oklch(0.708 0 0 / 0.5); }
.ak-fab[hidden] { display: none; }
.ak-fab svg { width: 16px; height: 16px; flex: none; }
@media (prefers-color-scheme: dark) {
  .ak-fab { background: oklch(0.922 0 0); color: oklch(0.205 0 0); }
  .ak-fab:hover { background: oklch(0.87 0 0); }
}
@keyframes ak-fab-in { from { opacity: 0; transform: translateY(2px) scale(0.96); } }
@media (prefers-reduced-motion: reduce) { .ak-fab { animation: none; } }
`;

let settings: Settings | null = null;
let ui: { host: HTMLElement; shadow: ShadowRoot; fab: HTMLButtonElement } | null = null;
let fabTarget: { text: string; rect: DOMRect | null } | null = null;
let panel: PanelController | null = null;
let panelModule: Promise<PanelModule> | null = null;

void getSettings().then((loaded) => (settings = loaded));
onSettingsChanged((updated) => {
  settings = updated;
  if (!fabAllowed()) hideFab();
});

const onTabMessage = (
  message: TabMessage,
  _sender: chrome.runtime.MessageSender,
  sendResponse: (response: TabMessageResponse) => void,
): boolean => {
  if (!extensionAlive()) return false;
  if (message.type === 'ping') {
    sendResponse({ handled: true });
    return false;
  }
  if (message.type === 'ask-selection') {
    // The shortcut is sent to every frame; only the focused one should react.
    if (message.source === 'shortcut' && !message.force && !frameHasFocus()) return false;
    const selection = readSelection();
    const text = selection.text.trim() ? selection.text : (message.text ?? '');
    void openPanel(text, selection.rect);
    sendResponse({ handled: true });
  }
  return false;
};
chrome.runtime.onMessage.addListener(onTabMessage);

document.addEventListener('mouseup', onMouseUp, { capture: true, signal });
document.addEventListener('keyup', onKeyUp, { capture: true, signal });
document.addEventListener('mousedown', onMouseDown, { capture: true, signal });
document.addEventListener('selectionchange', onSelectionChange, { signal });
document.addEventListener('keydown', onKeyDown, { capture: true, signal });
window.addEventListener('scroll', hideFab, { capture: true, passive: true, signal });
window.addEventListener('resize', hideFab, { passive: true, signal });

(globalThis as Global).__answerKeyCleanup = () => {
  lifetime.abort();
  try {
    chrome.runtime.onMessage.removeListener(onTabMessage);
  } catch {
    // The old copy's extension context is already gone.
  }
  ui?.host.remove();
  ui = null;
  panel = null;
};

function onMouseUp(event: MouseEvent): void {
  if (event.button !== 0 || isFromOurUi(event)) return;
  // Let the browser finish updating the selection (double/triple clicks).
  setTimeout(() => maybeShowFab({ x: event.clientX, y: event.clientY }), 0);
}

function onKeyUp(event: KeyboardEvent): void {
  if (isFromOurUi(event)) return;
  if (event.shiftKey || event.key === 'Shift' || ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a')) {
    maybeShowFab(null);
  }
}

function onMouseDown(event: MouseEvent): void {
  if (!isFromOurUi(event)) hideFab();
}

function onSelectionChange(): void {
  if (ui && !ui.fab.hidden && !readSelection().text.trim()) hideFab();
}

function onKeyDown(event: KeyboardEvent): void {
  if (event.key === 'Escape') hideFab();
}

function maybeShowFab(pointer: { x: number; y: number } | null): void {
  if (!fabAllowed()) return;
  const selection = readSelection();
  if (selection.text.trim().length < MIN_SELECTION_CHARS) {
    hideFab();
    return;
  }
  const { fab } = ensureUi();
  fabTarget = selection;
  const rect = selection.rect;
  const x = pointer?.x ?? rect?.right ?? 0;
  const y = pointer?.y ?? rect?.bottom ?? 0;
  fab.hidden = false;
  const width = fab.offsetWidth || 110;
  const height = fab.offsetHeight || 32;
  let left = x + 8;
  let top = y + 14;
  if (left + width > window.innerWidth - 8) left = x - width - 8;
  if (top + height > window.innerHeight - 8) top = y - height - 14;
  // A huge selection (select-all) can end far off screen; keep the button visible.
  left = Math.max(8, Math.min(left, window.innerWidth - width - 8));
  top = Math.max(8, Math.min(top, window.innerHeight - height - 8));
  fab.style.left = `${Math.round(left)}px`;
  fab.style.top = `${Math.round(top)}px`;
}

function hideFab(): void {
  if (ui) ui.fab.hidden = true;
  fabTarget = null;
}

function fabAllowed(): boolean {
  if (!settings?.showFloatingButton || !extensionAlive()) return false;
  return !settings.disabledSites.includes(siteKey(topLevelUrl()));
}

async function openPanel(text: string, anchor: DOMRect | null): Promise<void> {
  hideFab();
  const page = pageInfo();
  try {
    const controller = await getPanel();
    controller.start(text.trim() ? 'selection' : 'typed', text, page);
    controller.placeNear(anchor);
  } catch (err) {
    // Couldn't load the panel into this page; show the answer in its own window.
    console.warn('AnswerKey: could not open the answer panel on this page.', err);
    sendRuntimeMessage({ type: 'open-answer-window', text, page });
  }
}

async function getPanel(): Promise<PanelController> {
  if (panel) return panel;
  const { mountPanel } = await loadPanelModule();
  const { shadow } = ensureUi();
  panel ??= mountPanel(shadow, { onClose: () => undefined, copyText });
  return panel;
}

function loadPanelModule(): Promise<PanelModule> {
  if (!panelModule) {
    panelModule = import(chrome.runtime.getURL('panel.js')) as Promise<PanelModule>;
    panelModule.catch(() => (panelModule = null)); // allow another try later
  }
  return panelModule;
}

function ensureUi(): NonNullable<typeof ui> {
  if (ui) return ui;

  const host = document.createElement('answerkey-ui');
  host.style.cssText =
    'all: initial; position: fixed; top: 0; left: 0; width: 0; height: 0; z-index: 2147483647;';
  const shadow = host.attachShadow({ mode: 'closed' });
  const style = document.createElement('style');
  style.textContent = FAB_CSS;

  const fab = document.createElement('button');
  fab.type = 'button';
  fab.className = 'ak-fab';
  fab.dataset.ak = 'fab';
  fab.hidden = true;
  fab.title = 'Ask Claude about the selected text';
  fab.append(createElement(Sparkles, { 'aria-hidden': 'true' }), 'Ask Claude');
  // Keep the page's selection (and focus) when the button is pressed.
  fab.addEventListener('mousedown', (event) => {
    event.preventDefault();
    event.stopPropagation();
  });
  fab.addEventListener('click', (event) => {
    event.stopPropagation();
    const target = fabTarget ?? readSelection();
    if (target.text.trim()) void openPanel(target.text, target.rect);
  });
  // Start loading the panel while the pointer approaches the button.
  fab.addEventListener('pointerenter', () => void loadPanelModule().catch(() => undefined));

  shadow.append(style, fab);
  document.documentElement.append(host);
  ui = { host, shadow, fab };
  return ui;
}

/** Selected text plus where it is on screen (inputs and text areas included). */
function readSelection(): { text: string; rect: DOMRect | null } {
  const active = document.activeElement;
  if (
    active instanceof HTMLTextAreaElement ||
    (active instanceof HTMLInputElement && /^(text|search|url|email|tel)$/i.test(active.type))
  ) {
    const { selectionStart, selectionEnd, value } = active;
    if (selectionStart !== null && selectionEnd !== null && selectionEnd > selectionStart) {
      return { text: value.slice(selectionStart, selectionEnd), rect: active.getBoundingClientRect() };
    }
  }
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return { text: '', rect: null };
  if (ui && selection.anchorNode && ui.host.contains(selection.anchorNode)) return { text: '', rect: null };
  const range = selection.getRangeAt(0);
  const rect = range.getBoundingClientRect();
  return { text: selection.toString(), rect: rect.width || rect.height ? rect : null };
}

/**
 * True only for the frame that holds the keyboard focus. A parent frame's
 * document also reports hasFocus() while focus is inside one of its iframes.
 */
function frameHasFocus(): boolean {
  if (!document.hasFocus()) return false;
  const active = document.activeElement;
  return !(active instanceof HTMLIFrameElement || active instanceof HTMLFrameElement);
}

function isFromOurUi(event: Event): boolean {
  return ui !== null && event.composedPath().includes(ui.host);
}

function pageInfo(): PageInfo {
  return { title: document.title, url: topLevelUrl() };
}

/** In a cross-origin frame, the top page's origin is the best "site" we can see. */
function topLevelUrl(): string {
  const origins = location.ancestorOrigins;
  if (window !== window.top && origins && origins.length > 0) return origins[origins.length - 1];
  return location.href;
}

function extensionAlive(): boolean {
  try {
    return Boolean(chrome.runtime?.id);
  } catch {
    return false;
  }
}

function sendRuntimeMessage(message: RuntimeMessage): void {
  try {
    chrome.runtime.sendMessage(message).catch(() => undefined);
  } catch {
    // Extension was reloaded; this page's copy of AnswerKey is orphaned.
  }
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // http: pages have no async clipboard API; fall back to a temporary text area.
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.cssText = 'position: fixed; top: -1000px; left: -1000px; opacity: 0;';
    document.body.append(area);
    area.select();
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch {
      ok = false;
    }
    area.remove();
    return ok;
  }
}
