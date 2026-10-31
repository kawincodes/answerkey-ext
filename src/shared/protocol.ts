/**
 * Messages exchanged between the background worker, the content script and the
 * extension pages. Answers stream over a long-lived Port; everything else uses
 * one-shot runtime/tab messages.
 */

export const ASK_PORT = 'answerkey-ask';

/** Selections longer than this are refused instead of being silently cut. */
export const MAX_QUESTION_CHARS = 100_000;

export interface PageInfo {
  title: string;
  url: string;
}

/**
 * selection: text highlighted on a page (first turn of a conversation)
 * typed:     a question typed into the popup or the answer window
 * followup:  a follow-up typed into an open answer panel
 */
export type AskKind = 'selection' | 'typed' | 'followup';

export interface AskRequest {
  type: 'ask';
  conversationId: string;
  kind: AskKind;
  text: string;
  page?: PageInfo;
}

export type PortClientMessage = AskRequest | { type: 'stop' };

export type ErrorCode =
  | 'no_api_key'
  | 'auth'
  | 'permission'
  | 'not_found'
  | 'rate_limit'
  | 'overloaded'
  | 'billing'
  | 'bad_request'
  | 'network'
  | 'server'
  | 'too_long'
  | 'unknown';

export interface RefusalInfo {
  category: string | null;
  explanation: string | null;
}

export type PortServerMessage =
  | { type: 'start'; model: string }
  | { type: 'thinking'; text: string }
  | { type: 'text'; text: string }
  | { type: 'fallback'; from: string; to: string }
  | {
      type: 'done';
      model: string;
      stopReason: string | null;
      /** Set when the user pressed Stop. */
      stopped?: boolean;
      refusal?: RefusalInfo;
    }
  | { type: 'error'; code: ErrorCode; message: string };

/** One-shot messages sent to the background worker with chrome.runtime.sendMessage. */
export type RuntimeMessage =
  | { type: 'open-options' }
  | { type: 'end-conversation'; conversationId: string }
  | { type: 'test-api-key'; apiKey: string; model: string }
  | { type: 'open-answer-window'; text?: string; page?: PageInfo };

export type TestKeyResult = { ok: true; modelName: string } | { ok: false; message: string };

/** Messages the background worker sends to content scripts with chrome.tabs.sendMessage. */
export type TabMessage =
  | { type: 'ping' }
  | {
      type: 'ask-selection';
      source: 'context-menu' | 'shortcut';
      /** Selection text reported by the context menu. */
      text?: string;
      /** Open the panel even if this frame doesn't have focus. */
      force?: boolean;
    };

export interface TabMessageResponse {
  handled: boolean;
}

/** Data handed to the stand-alone answer window through chrome.storage.session. */
export interface PendingWindowQuestion {
  text?: string;
  page?: PageInfo;
}

export function newConversationId(): string {
  return crypto.randomUUID();
}
