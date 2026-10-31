import { useCallback, useEffect, useReducer, useRef } from 'react';
import { modelLabel } from '@/shared/models';
import {
  ASK_PORT,
  type AskKind,
  type ErrorCode,
  newConversationId,
  type PageInfo,
  type PortClientMessage,
  type PortServerMessage,
  type RefusalInfo,
  type RuntimeMessage,
} from '@/shared/protocol';

export type NoticeKind = 'info' | 'warn' | 'error';

export interface Notice {
  kind: NoticeKind;
  text: string;
  retry?: boolean;
  settings?: boolean;
}

/** connecting → thinking → answering → done | failed */
export type TurnPhase = 'connecting' | 'thinking' | 'answering' | 'done' | 'failed';

/** One question and its answer. */
export interface Turn {
  id: number;
  kind: AskKind;
  question: string;
  phase: TurnPhase;
  thinking: string;
  answer: string;
  notices: Notice[];
  /** Refused or failed: not part of what Claude will see on a follow-up. */
  dimmed: boolean;
}

export interface SessionState {
  turns: Turn[];
  busy: boolean;
  /** After an error only Retry continues, so a follow-up never loses the failed question. */
  blocked: boolean;
  asked: boolean;
  model: string | null;
  modelKnown: boolean;
}

/** Errors the user fixes on the settings page. */
const SETTINGS_ERRORS: ErrorCode[] = ['no_api_key', 'auth', 'not_found', 'permission', 'billing'];

const REFUSAL_LABELS: Record<string, string> = {
  cyber: 'cybersecurity',
  bio: 'biology',
  frontier_llm: 'AI development',
  reasoning_extraction: 'requests for its internal reasoning',
  general_harms: 'potential harm',
};

type Action =
  | { type: 'reset' }
  | { type: 'begin'; turn: Turn }
  | { type: 'remove'; id: number }
  | { type: 'model'; model: string; known: boolean }
  | { type: 'start'; id: number; model: string }
  | { type: 'deltas'; id: number; thinking: string; text: string }
  | { type: 'fallback'; id: number; from: string; to: string }
  | { type: 'done'; id: number; message: Extract<PortServerMessage, { type: 'done' }> }
  | { type: 'fail'; id: number; code: ErrorCode | 'orphaned'; message: string };

const initialState: SessionState = {
  turns: [],
  busy: false,
  blocked: false,
  asked: false,
  model: null,
  modelKnown: false,
};

function updateTurn(state: SessionState, id: number, update: (turn: Turn) => Turn): SessionState {
  return { ...state, turns: state.turns.map((turn) => (turn.id === id ? update(turn) : turn)) };
}

function reducer(state: SessionState, action: Action): SessionState {
  switch (action.type) {
    case 'reset':
      return initialState;
    case 'begin':
      return { ...state, turns: [...state.turns, action.turn], busy: true, blocked: false, asked: true };
    case 'remove':
      return { ...state, turns: state.turns.filter((turn) => turn.id !== action.id) };
    case 'model':
      if (state.modelKnown && !action.known) return state;
      return { ...state, model: action.model, modelKnown: state.modelKnown || action.known };
    case 'start':
      return updateTurn({ ...state, model: action.model, modelKnown: true }, action.id, (turn) => ({
        ...turn,
        phase: turn.phase === 'connecting' ? 'thinking' : turn.phase,
      }));
    case 'deltas':
      return updateTurn(state, action.id, (turn) => {
        const answer = turn.answer + action.text;
        return {
          ...turn,
          thinking: turn.thinking + action.thinking,
          answer,
          phase: answer ? 'answering' : 'thinking',
        };
      });
    case 'fallback':
      return updateTurn({ ...state, model: action.to, modelKnown: true }, action.id, (turn) => ({
        ...turn,
        notices: [
          ...turn.notices,
          { kind: 'info', text: `${modelLabel(action.from)} declined this request, so ${modelLabel(action.to)} answered it instead.` },
        ],
      }));
    case 'done': {
      const { message } = action;
      return updateTurn({ ...state, busy: false, blocked: false }, action.id, (turn) => {
        if (message.refusal) return refusedTurn(turn, message.refusal);
        const notices = [...turn.notices];
        if (message.stopped) {
          notices.push({ kind: 'info', text: turn.answer ? 'Stopped.' : 'Stopped before Claude answered.' });
        } else if (message.stopReason === 'max_tokens') {
          notices.push({ kind: 'warn', text: 'The answer hit the length limit and was cut off.' });
        } else if (!turn.answer) {
          notices.push({ kind: 'info', text: 'Claude finished without writing an answer. Try rephrasing the question.' });
        }
        return { ...turn, phase: 'done', notices };
      });
    }
    case 'fail':
      return updateTurn({ ...state, busy: false, blocked: true }, action.id, (turn) => ({
        ...turn,
        phase: 'failed',
        dimmed: true,
        notices: [
          ...turn.notices,
          {
            kind: 'error',
            text: action.message,
            retry: action.code !== 'too_long' && action.code !== 'orphaned',
            settings: SETTINGS_ERRORS.includes(action.code as ErrorCode),
          },
        ],
      }));
  }
}

function refusedTurn(turn: Turn, refusal: RefusalInfo): Turn {
  const topic = refusal.category ? REFUSAL_LABELS[refusal.category] : undefined;
  let text = topic
    ? `Claude declined to answer this (it was flagged as related to ${topic}).`
    : 'Claude declined to answer this.';
  if (refusal.explanation) text += ` ${refusal.explanation}`;
  // A declined answer may have stopped partway; don't present the fragment as an answer.
  return {
    ...turn,
    phase: 'done',
    answer: '',
    dimmed: true,
    notices: [...turn.notices, { kind: 'warn', text: `${text} You can rephrase it below.` }],
  };
}

export function sendRuntimeMessage(message: RuntimeMessage): void {
  try {
    chrome.runtime.sendMessage(message).catch(() => undefined);
  } catch {
    // The extension was reloaded; this page's copy of AnswerKey is orphaned.
  }
}

let nextTurnId = 1;

/**
 * The conversation behind one answer panel: streams each question over a Port
 * to the background worker and keeps the turns to display.
 */
export function useAnswerSession() {
  const [state, dispatch] = useReducer(reducer, initialState);
  const portRef = useRef<chrome.runtime.Port | null>(null);
  const conversationId = useRef(newConversationId());
  const asked = useRef(false);
  const lastRequest = useRef<{ kind: AskKind; text: string; page?: PageInfo } | null>(null);

  // Streamed text arrives in many small pieces; apply them once per frame.
  const pending = useRef<{ id: number; thinking: string; text: string } | null>(null);
  const frame = useRef<number | null>(null);
  const flush = useCallback(() => {
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null;
    const deltas = pending.current;
    pending.current = null;
    if (deltas) dispatch({ type: 'deltas', ...deltas });
  }, []);
  const queue = useCallback(
    (id: number, field: 'thinking' | 'text', delta: string) => {
      if (pending.current && pending.current.id !== id) flush();
      pending.current ??= { id, thinking: '', text: '' };
      pending.current[field] += delta;
      frame.current ??= requestAnimationFrame(flush);
    },
    [flush],
  );

  const ask = useCallback(
    (kind: AskKind, rawText: string, page?: PageInfo) => {
      // Triple-click selections end with line breaks; don't show or send them.
      const text = rawText.trim();
      if (!text || portRef.current) return;
      lastRequest.current = { kind, text, page };
      const id = nextTurnId++;
      dispatch({
        type: 'begin',
        turn: { id, kind, question: text, phase: 'connecting', thinking: '', answer: '', notices: [], dimmed: false },
      });

      let port: chrome.runtime.Port;
      try {
        port = chrome.runtime.connect({ name: ASK_PORT });
      } catch {
        dispatch({
          type: 'fail',
          id,
          code: 'orphaned',
          message: 'AnswerKey was updated or reloaded. Refresh this page to keep using it.',
        });
        return;
      }
      portRef.current = port;
      asked.current = true;
      let finished = false;

      port.onMessage.addListener((message: PortServerMessage) => {
        if (message.type === 'done' || message.type === 'error') {
          // The answer is finished (and saved); free the panel for the next question now.
          finished = true;
          if (portRef.current === port) portRef.current = null;
          port.disconnect();
          flush();
        }
        switch (message.type) {
          case 'start':
            dispatch({ type: 'start', id, model: message.model });
            break;
          case 'thinking':
            queue(id, 'thinking', message.text);
            break;
          case 'text':
            queue(id, 'text', message.text);
            break;
          case 'fallback':
            flush();
            dispatch({ type: 'fallback', id, from: message.from, to: message.to });
            break;
          case 'done':
            dispatch({ type: 'done', id, message });
            break;
          case 'error':
            dispatch({ type: 'fail', id, code: message.code, message: message.message });
            break;
        }
      });
      port.onDisconnect.addListener(() => {
        void chrome.runtime.lastError; // read it so it isn't reported as unchecked
        if (portRef.current === port) portRef.current = null;
        if (!finished) {
          flush();
          dispatch({ type: 'fail', id, code: 'unknown', message: 'Lost the connection to AnswerKey. Retry to ask again.' });
        }
      });

      const request: PortClientMessage = { type: 'ask', conversationId: conversationId.current, kind, text, page };
      port.postMessage(request);
    },
    [flush, queue],
  );

  const stop = useCallback(() => {
    const message: PortClientMessage = { type: 'stop' };
    portRef.current?.postMessage(message);
  }, []);

  const retry = useCallback(
    (turnId: number) => {
      if (portRef.current || !lastRequest.current) return;
      dispatch({ type: 'remove', id: turnId });
      const { kind, text, page } = lastRequest.current;
      ask(kind, text, page);
    },
    [ask],
  );

  /** Ends the conversation: cancels any answer in progress and frees its history. */
  const reset = useCallback(() => {
    if (portRef.current) {
      portRef.current.disconnect(); // the background worker aborts the request
      portRef.current = null;
    }
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null;
    pending.current = null;
    if (asked.current) sendRuntimeMessage({ type: 'end-conversation', conversationId: conversationId.current });
    conversationId.current = newConversationId();
    asked.current = false;
    lastRequest.current = null;
    dispatch({ type: 'reset' });
  }, []);

  const setModel = useCallback((model: string, known: boolean) => dispatch({ type: 'model', model, known }), []);

  // Free the conversation if the panel goes away while one is open.
  useEffect(() => () => reset(), [reset]);

  return { state, ask, stop, retry, reset, setModel };
}
