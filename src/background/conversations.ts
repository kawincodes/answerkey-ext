import type Anthropic from '@anthropic-ai/sdk';
import type { Effort } from '../shared/models';

/**
 * One answer panel = one conversation. The model, effort and system prompt are
 * fixed when the conversation starts so follow-ups replay an identical,
 * append-only history: Claude's thinking blocks are only valid in the exact
 * conversation that produced them.
 *
 * Stored in chrome.storage.session: it survives the service worker being
 * suspended, is cleared when the browser closes, and content scripts can't read it.
 */
export interface Conversation {
  id: string;
  model: string;
  effort: Effort;
  system: string;
  messages: Anthropic.Beta.BetaMessageParam[];
  updatedAt: number;
}

const PREFIX = 'conv:';
const INDEX_KEY = 'conv-index';
const MAX_CONVERSATIONS = 30;

type IndexEntry = { id: string; updatedAt: number };

// Serialize index updates so concurrent saves can't drop each other's entries.
let indexLock: Promise<unknown> = Promise.resolve();
function withIndexLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = indexLock.then(fn, fn);
  indexLock = run.catch(() => undefined);
  return run;
}

// Stored as a JSON string: chrome.storage re-sorts object keys, and the history
// should be replayed exactly as it was first sent.
export async function loadConversation(id: string): Promise<Conversation | null> {
  const key = PREFIX + id;
  const stored = await chrome.storage.session.get(key);
  const json = stored[key];
  return typeof json === 'string' ? (JSON.parse(json) as Conversation) : null;
}

export function saveConversation(conversation: Conversation): Promise<void> {
  conversation.updatedAt = Date.now();
  return withIndexLock(async () => {
    const index = await readIndex();
    const next = [
      { id: conversation.id, updatedAt: conversation.updatedAt },
      ...index.filter((entry) => entry.id !== conversation.id),
    ];
    const evicted = next.splice(MAX_CONVERSATIONS);
    await chrome.storage.session.set({ [PREFIX + conversation.id]: JSON.stringify(conversation), [INDEX_KEY]: next });
    if (evicted.length) await chrome.storage.session.remove(evicted.map((entry) => PREFIX + entry.id));
  });
}

export function deleteConversation(id: string): Promise<void> {
  return withIndexLock(async () => {
    const index = await readIndex();
    await chrome.storage.session.set({ [INDEX_KEY]: index.filter((entry) => entry.id !== id) });
    await chrome.storage.session.remove(PREFIX + id);
  });
}

async function readIndex(): Promise<IndexEntry[]> {
  const stored = await chrome.storage.session.get(INDEX_KEY);
  const index = stored[INDEX_KEY];
  return Array.isArray(index) ? (index as IndexEntry[]) : [];
}
