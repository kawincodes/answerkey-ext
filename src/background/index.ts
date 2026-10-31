import Anthropic from '@anthropic-ai/sdk';
import { getApiKey } from '../shared/apiKey';
import {
  ASK_PORT,
  type AskRequest,
  MAX_QUESTION_CHARS,
  type PendingWindowQuestion,
  type PortClientMessage,
  type PortServerMessage,
  type RuntimeMessage,
  type TabMessage,
  type TabMessageResponse,
} from '../shared/protocol';
import { getSettings } from '../shared/settings';
import { createClient, describeError, streamReply, testApiKey, toHistoryContent } from './claude';
import { type Conversation, deleteConversation, loadConversation, saveConversation } from './conversations';
import { buildSystemPrompt, buildUserMessage } from './prompt';

const MENU_ID = 'answerkey-ask-selection';
const EXTENSION_ORIGIN = chrome.runtime.getURL('');

// Keep the stored API key away from content scripts (which run inside web pages):
// only extension pages and this worker may read chrome.storage.local.
chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' }).catch((err: unknown) => {
  console.warn('AnswerKey: could not restrict chrome.storage.local to extension pages.', err);
});
// Listening for startup makes the browser start this worker (and run the line
// above) as soon as it launches, before any page loads.
chrome.runtime.onStartup.addListener(() => undefined);

chrome.runtime.onInstalled.addListener((details) => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: MENU_ID,
      title: 'Ask Claude about “%s”',
      contexts: ['selection'],
    });
  });
  if (details.reason === chrome.runtime.OnInstalledReason.INSTALL) {
    void chrome.tabs.create({ url: chrome.runtime.getURL('options.html#welcome') });
  }
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== MENU_ID || !info.selectionText) return;
  void askFromContextMenu(info.selectionText, tab, info.frameId ?? 0);
});

chrome.commands.onCommand.addListener((command, tab) => {
  if (command === 'ask-selection') void askFromShortcut(tab);
});

chrome.runtime.onMessage.addListener((message: RuntimeMessage, sender, sendResponse) => {
  const fromExtensionPage = sender.id === chrome.runtime.id && sender.url?.startsWith(EXTENSION_ORIGIN);
  switch (message?.type) {
    case 'open-options':
      void chrome.runtime.openOptionsPage();
      return false;
    case 'end-conversation':
      void deleteConversation(message.conversationId);
      return false;
    case 'test-api-key':
      if (!fromExtensionPage) return false;
      void testApiKey(message.apiKey, message.model).then(sendResponse);
      return true; // async response
    case 'open-answer-window':
      // From the popup, or from a page where the in-page panel couldn't load.
      if (sender.id === chrome.runtime.id) void openAnswerWindow({ text: message.text, page: message.page });
      return false;
  }
  return false;
});

// ---------------------------------------------------------------------------
// Streaming answers over a Port: one Port per question.

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== ASK_PORT || port.sender?.id !== chrome.runtime.id) return;

  let controller: AbortController | null = null;
  let stopRequested = false;

  port.onMessage.addListener((message: PortClientMessage) => {
    if (message.type === 'ask' && !controller) {
      controller = new AbortController();
      void handleAsk(port, message, controller.signal, () => stopRequested);
    } else if (message.type === 'stop') {
      stopRequested = true;
      controller?.abort();
    }
  });
  // The panel was closed or the page navigated away: stop paying for tokens.
  port.onDisconnect.addListener(() => controller?.abort());
});

async function handleAsk(
  port: chrome.runtime.Port,
  request: AskRequest,
  signal: AbortSignal,
  wasStoppedByUser: () => boolean,
): Promise<void> {
  const post = (message: PortServerMessage) => {
    try {
      port.postMessage(message);
    } catch {
      // The panel went away; nothing left to tell it.
    }
  };
  const releaseKeepAlive = holdKeepAlive();

  try {
    const text = typeof request.text === 'string' ? request.text.trim() : '';
    if (!text) {
      post({ type: 'error', code: 'bad_request', message: 'There is no text to ask about.' });
      return;
    }
    if (text.length > MAX_QUESTION_CHARS) {
      post({
        type: 'error',
        code: 'too_long',
        message: `That selection is ${text.length.toLocaleString()} characters. Select at most ${MAX_QUESTION_CHARS.toLocaleString()} characters and try again.`,
      });
      return;
    }

    const apiKey = await getApiKey();
    if (!apiKey) {
      post({ type: 'error', code: 'no_api_key', message: 'Add your Anthropic API key in AnswerKey settings to get answers.' });
      return;
    }

    const settings = await getSettings();
    const conversation: Conversation = (await loadConversation(request.conversationId)) ?? {
      id: request.conversationId,
      model: settings.model,
      effort: settings.effort,
      system: buildSystemPrompt(settings.customInstructions),
      messages: [],
      updatedAt: Date.now(),
    };

    const userTurn: Anthropic.Beta.BetaMessageParam = {
      role: 'user',
      content: buildUserMessage({ ...request, text }, settings.includePageContext),
    };
    const messages = [...conversation.messages, userTurn];
    let answerSoFar = '';

    try {
      const reply = await streamReply(createClient(apiKey), conversation, messages, signal, {
        onStart: (model) => post({ type: 'start', model }),
        onThinking: (delta) => post({ type: 'thinking', text: delta }),
        onText: (delta) => {
          answerSoFar += delta;
          post({ type: 'text', text: delta });
        },
        onFallback: (from, to) => post({ type: 'fallback', from, to }),
      });

      if (reply.stop_reason === 'refusal') {
        // Declined even after any fallback. Don't keep the turn: follow-ups
        // continue from the conversation as it was before this question.
        post({
          type: 'done',
          model: reply.model,
          stopReason: reply.stop_reason,
          refusal: {
            category: reply.stop_details?.category ?? null,
            explanation: reply.stop_details?.explanation ?? null,
          },
        });
        return;
      }

      const assistantContent = toHistoryContent(reply);
      conversation.messages = assistantContent.length
        ? [...messages, { role: 'assistant', content: assistantContent }]
        : messages;
      await saveConversation(conversation);
      post({ type: 'done', model: reply.model, stopReason: reply.stop_reason });
    } catch (err) {
      if (err instanceof Anthropic.APIUserAbortError || signal.aborted) {
        if (wasStoppedByUser()) {
          // Keep what was shown so a follow-up has the context of the question.
          conversation.messages = answerSoFar.trim()
            ? [...messages, { role: 'assistant', content: [{ type: 'text', text: answerSoFar }] }]
            : messages;
          await saveConversation(conversation);
          post({ type: 'done', model: conversation.model, stopReason: null, stopped: true });
        }
        return;
      }
      const { code, message } = describeError(err, conversation.model);
      post({ type: 'error', code, message });
    }
  } catch (err) {
    console.error('AnswerKey: unexpected error', err);
    post({ type: 'error', code: 'unknown', message: err instanceof Error ? err.message : String(err) });
  } finally {
    releaseKeepAlive();
    try {
      port.disconnect();
    } catch {
      // Already disconnected.
    }
  }
}

/**
 * Edge suspends an idle extension service worker after ~30 seconds. Calling an
 * extension API resets that timer, so ping one while an answer is streaming.
 */
let activeStreams = 0;
let keepAliveTimer: ReturnType<typeof setInterval> | undefined;
function holdKeepAlive(): () => void {
  if (activeStreams++ === 0) {
    keepAliveTimer = setInterval(() => void chrome.runtime.getPlatformInfo(), 20_000);
  }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    if (--activeStreams === 0) clearInterval(keepAliveTimer);
  };
}

// ---------------------------------------------------------------------------
// Context menu and keyboard shortcut.

async function askFromContextMenu(selectionText: string, tab: chrome.tabs.Tab | undefined, frameId: number) {
  const message: TabMessage = { type: 'ask-selection', source: 'context-menu', text: selectionText };
  if (tab?.id !== undefined && tab.id >= 0) {
    if ((await sendToTab(tab.id, message, frameId))?.handled) return;
    // Tabs opened before AnswerKey was installed (or updated) have no content
    // script yet; the menu click grants temporary access to inject one.
    if (await injectContentScript(tab.id, frameId)) {
      if ((await sendToTab(tab.id, message, frameId))?.handled) return;
    }
  }
  // Pages that extensions can't script (browser pages, the PDF viewer, the store).
  await openAnswerWindow({
    text: selectionText,
    page: tab?.url ? { title: tab.title ?? '', url: tab.url } : undefined,
  });
}

async function askFromShortcut(tab: chrome.tabs.Tab | undefined) {
  const tabId = tab?.id;
  if (tabId === undefined || tabId < 0) {
    await openAnswerWindow({});
    return;
  }
  if (!(await sendToTab(tabId, { type: 'ping' }, 0)) && !(await injectContentScript(tabId, 0))) {
    await openAnswerWindow({});
    return;
  }
  // Every frame gets the message; only the focused one responds.
  if ((await sendToTab(tabId, { type: 'ask-selection', source: 'shortcut' }))?.handled) return;
  // No frame had focus (for example the address bar did): use the top frame.
  if ((await sendToTab(tabId, { type: 'ask-selection', source: 'shortcut', force: true }, 0))?.handled) return;
  await openAnswerWindow({});
}

async function sendToTab(tabId: number, message: TabMessage, frameId?: number): Promise<TabMessageResponse | null> {
  try {
    const response = (await chrome.tabs.sendMessage(
      tabId,
      message,
      frameId === undefined ? undefined : { frameId },
    )) as TabMessageResponse | undefined;
    return response ?? null;
  } catch {
    // No content script there, or no frame answered.
    return null;
  }
}

async function injectContentScript(tabId: number, frameId: number): Promise<boolean> {
  try {
    await chrome.scripting.executeScript({ target: { tabId, frameIds: [frameId] }, files: ['content.js'] });
    return true;
  } catch {
    return false;
  }
}

async function openAnswerWindow(pending: PendingWindowQuestion): Promise<void> {
  const id = crypto.randomUUID();
  await chrome.storage.session.set({ [`pending:${id}`]: pending });
  await chrome.windows.create({
    url: chrome.runtime.getURL(`answer.html#${id}`),
    type: 'popup',
    width: 480,
    height: 680,
  });
}
