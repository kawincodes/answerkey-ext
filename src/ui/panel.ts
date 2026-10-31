import { modelLabel } from '../shared/models';
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
} from '../shared/protocol';
import { getSettings } from '../shared/settings';
import { ICONS } from './icons';
import { renderMarkdown } from './markdown';

export interface PanelOptions {
  /** 'floating' sits over a web page; 'window' fills the stand-alone answer window. */
  mode: 'floating' | 'window';
  onClose: () => void;
  /** Clipboard writer; content scripts pass one with a fallback for http pages. */
  copyText?: (text: string) => Promise<boolean>;
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

/**
 * The answer panel: shows the selected text, streams Claude's reasoning and
 * answer, and takes follow-up questions. Shared by the in-page panel (content
 * script) and the stand-alone answer window.
 */
export class AnswerPanel {
  readonly element: HTMLElement;
  private readonly header: HTMLElement;
  private readonly body: HTMLElement;
  private readonly thread: HTMLElement;
  private readonly hint: HTMLElement;
  private readonly modelChip: HTMLElement;
  private readonly copyButton: HTMLButtonElement;
  private readonly input: HTMLTextAreaElement;
  private readonly sendButton: HTMLButtonElement;

  private conversationId = newConversationId();
  private asked = false;
  private port: chrome.runtime.Port | null = null;
  private current: Turn | null = null;
  /** After an error only Retry continues, so a follow-up never loses the failed question. */
  private blocked = false;
  private lastRequest: { kind: AskKind; text: string; page?: PageInfo } | null = null;
  private followOutput = true;
  private modelKnown = false;

  constructor(private readonly options: PanelOptions) {
    const panel = el('section', 'ak-panel');
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', 'AnswerKey');
    panel.hidden = true;

    this.header = el('header', 'ak-header');
    const logo = el('span', 'ak-logo');
    logo.innerHTML = ICONS.key;
    this.modelChip = el('span', 'ak-model');
    this.modelChip.hidden = true;
    this.copyButton = iconButton(ICONS.copy, 'Copy answer');
    this.copyButton.disabled = true;
    const settingsButton = iconButton(ICONS.settings, 'AnswerKey settings');
    const closeButton = iconButton(ICONS.close, options.mode === 'window' ? 'Close window' : 'Close (Esc)');
    this.header.append(logo, el('span', 'ak-title', 'AnswerKey'), this.modelChip, el('span', 'ak-spacer'));
    this.header.append(this.copyButton, settingsButton, closeButton);

    this.body = el('div', 'ak-body');
    this.thread = el('div', 'ak-thread');
    this.hint = el('p', 'ak-hint', 'Type a question below, or select text on a page and click “Ask Claude”.');
    this.hint.hidden = true;
    this.body.append(this.hint, this.thread);

    const footer = el('footer', 'ak-footer');
    this.input = el('textarea', 'ak-input');
    this.input.rows = 1;
    this.input.setAttribute('aria-label', 'Message to Claude');
    this.sendButton = iconButton(ICONS.send, 'Send', 'ak-send');
    footer.append(this.input, this.sendButton);

    panel.append(this.header, this.body, footer);
    this.element = panel;

    closeButton.addEventListener('click', () => this.close());
    settingsButton.addEventListener('click', () => sendRuntimeMessage({ type: 'open-options' }));
    this.copyButton.addEventListener('click', () => void this.copyAnswer());
    this.sendButton.addEventListener('click', () => (this.port ? this.stop() : this.submitInput()));
    this.input.addEventListener('input', () => this.updateFooter());
    this.input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
        event.preventDefault();
        this.submitInput();
      }
    });
    this.body.addEventListener('scroll', () => {
      this.followOutput = this.body.scrollHeight - this.body.scrollTop - this.body.clientHeight < 48;
    });
    panel.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        this.close();
      }
    });
    if (options.mode === 'floating') {
      // Keep keystrokes and clicks inside the panel from reaching the page's own shortcuts.
      for (const type of ['keydown', 'keyup', 'keypress', 'mousedown', 'mouseup', 'click', 'pointerdown', 'wheel']) {
        panel.addEventListener(type, (event) => event.stopPropagation());
      }
      this.enableDragging();
    }
    this.updateFooter();
  }

  get isOpen(): boolean {
    return !this.element.hidden;
  }

  /** Opens the panel on a new conversation, asking about `text` right away if given. */
  start(kind: 'selection' | 'typed', text: string, page?: PageInfo): void {
    this.reset();
    this.element.hidden = false;
    void getSettings()
      .then((settings) => {
        if (!this.modelKnown) this.setModel(settings.model, false);
      })
      .catch(() => undefined);
    if (text.trim()) {
      this.ask(kind, text, page);
    } else {
      this.hint.hidden = false;
      this.updateFooter();
      this.input.focus();
    }
  }

  close(): void {
    this.reset();
    this.element.hidden = true;
    this.options.onClose();
  }

  /** Places the floating panel next to `anchor` (viewport coordinates), or centered. */
  placeNear(anchor: DOMRect | null): void {
    const style = this.element.style;
    const margin = 12;
    const gap = 10;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const width = Math.min(440, vw - margin * 2);
    const tallest = Math.min(600, vh - margin * 2);

    if (!anchor) {
      const top = Math.max(margin, Math.round(vh * 0.1));
      Object.assign(style, {
        left: `${Math.round((vw - width) / 2)}px`,
        top: `${top}px`,
        bottom: '',
        maxHeight: `${Math.min(tallest, vh - top - margin)}px`,
      });
      return;
    }

    const left = clamp(anchor.left, margin, vw - width - margin);
    const spaceBelow = vh - anchor.bottom - gap - margin;
    const spaceAbove = anchor.top - gap - margin;
    if (spaceBelow >= Math.min(320, tallest) || spaceBelow >= spaceAbove) {
      const top = clamp(anchor.bottom + gap, margin, vh - margin - Math.min(220, tallest));
      Object.assign(style, {
        left: `${left}px`,
        top: `${top}px`,
        bottom: '',
        maxHeight: `${Math.min(tallest, vh - top - margin)}px`,
      });
    } else {
      // Anchored by its bottom edge, so it grows upward as the answer streams in.
      Object.assign(style, {
        left: `${left}px`,
        top: '',
        bottom: `${Math.round(vh - anchor.top + gap)}px`,
        maxHeight: `${Math.min(tallest, spaceAbove)}px`,
      });
    }
  }

  private reset(): void {
    if (this.port) {
      this.port.disconnect(); // the background worker aborts the request
      this.port = null;
    }
    if (this.asked) sendRuntimeMessage({ type: 'end-conversation', conversationId: this.conversationId });
    this.conversationId = newConversationId();
    this.asked = false;
    this.blocked = false;
    this.current = null;
    this.lastRequest = null;
    this.modelKnown = false;
    this.followOutput = true;
    this.thread.replaceChildren();
    this.hint.hidden = true;
    this.input.value = '';
    this.copyButton.disabled = true;
    this.updateFooter();
  }

  private ask(kind: AskKind, rawText: string, page?: PageInfo): void {
    if (this.port) return;
    // Triple-click selections end with line breaks; don't show or send them.
    const text = rawText.trim();
    if (!text) return;
    this.hint.hidden = true;
    this.blocked = false;
    this.lastRequest = { kind, text, page };

    const turn = new Turn(kind, text, () => this.onTurnRendered());
    this.thread.append(turn.element);
    turn.measureQuestion();
    this.current = turn;
    this.followOutput = true;
    this.scrollToBottom();

    let port: chrome.runtime.Port;
    try {
      port = chrome.runtime.connect({ name: ASK_PORT });
    } catch {
      turn.fail('AnswerKey was updated or reloaded. Refresh this page to keep using it.', {});
      this.blocked = true;
      this.updateFooter();
      return;
    }
    this.port = port;
    this.asked = true;
    let finished = false;

    port.onMessage.addListener((message: PortServerMessage) => {
      if (message.type === 'done' || message.type === 'error') {
        // The answer is finished (and saved); free the panel for the next question now.
        finished = true;
        if (this.port === port) this.port = null;
        port.disconnect();
      }
      switch (message.type) {
        case 'start':
          this.setModel(message.model, true);
          turn.onStart();
          break;
        case 'thinking':
          turn.onThinking(message.text);
          break;
        case 'text':
          turn.onText(message.text);
          this.copyButton.disabled = false;
          break;
        case 'fallback':
          turn.onFallback(message.from, message.to);
          this.setModel(message.to, true);
          break;
        case 'done':
          this.onDone(turn, message);
          break;
        case 'error':
          this.onError(turn, message.code, message.message);
          break;
      }
    });
    port.onDisconnect.addListener(() => {
      void chrome.runtime.lastError; // read it so it isn't reported as unchecked
      if (this.port === port) this.port = null;
      if (!finished && this.current === turn) {
        this.onError(turn, 'unknown', 'Lost the connection to AnswerKey. Retry to ask again.');
      }
      this.updateFooter();
    });

    const request: PortClientMessage = { type: 'ask', conversationId: this.conversationId, kind, text, page };
    port.postMessage(request);
    this.updateFooter();
  }

  private onDone(turn: Turn, message: Extract<PortServerMessage, { type: 'done' }>): void {
    if (message.refusal) turn.finishRefused(message.refusal);
    else if (message.stopped) turn.finishStopped();
    else turn.finish(message.stopReason);
    this.copyButton.disabled = !turn.answer;
    this.updateFooter();
    if (this.options.mode === 'window' || document.activeElement === this.input) this.input.focus();
  }

  private onError(turn: Turn, code: ErrorCode, message: string): void {
    turn.fail(message, {
      onRetry: code === 'too_long' ? undefined : () => this.retry(turn),
      onSettings: SETTINGS_ERRORS.includes(code) ? () => sendRuntimeMessage({ type: 'open-options' }) : undefined,
    });
    this.blocked = true;
    this.updateFooter();
  }

  private retry(turn: Turn): void {
    if (this.port || !this.lastRequest) return;
    turn.element.remove();
    const { kind, text, page } = this.lastRequest;
    this.ask(kind, text, page);
  }

  private stop(): void {
    const stop: PortClientMessage = { type: 'stop' };
    this.port?.postMessage(stop);
  }

  private submitInput(): void {
    const text = this.input.value.trim();
    if (!text || this.port || this.blocked) return;
    this.input.value = '';
    this.ask(this.asked ? 'followup' : 'typed', text);
  }

  private updateFooter(): void {
    const busy = this.port !== null;
    this.input.disabled = this.blocked;
    this.input.placeholder = this.blocked
      ? 'Retry the question above to continue'
      : this.asked
        ? 'Ask a follow-up…'
        : 'Ask Claude anything…';
    this.input.style.height = 'auto';
    this.input.style.height = `${Math.min(this.input.scrollHeight + 2, 120)}px`;

    this.sendButton.classList.toggle('ak-stop', busy);
    this.sendButton.innerHTML = busy ? ICONS.stop : ICONS.send;
    const label = busy ? 'Stop' : 'Send';
    this.sendButton.title = label;
    this.sendButton.setAttribute('aria-label', label);
    this.sendButton.disabled = !busy && (this.blocked || !this.input.value.trim());
  }

  private setModel(model: string, known: boolean): void {
    this.modelChip.textContent = modelLabel(model);
    this.modelChip.title = model;
    this.modelChip.hidden = false;
    if (known) this.modelKnown = true;
  }

  private async copyAnswer(): Promise<void> {
    const answer = this.current?.answer ?? '';
    if (!answer) return;
    const copy = this.options.copyText ?? defaultCopyText;
    const ok = await copy(answer);
    this.copyButton.innerHTML = ok ? ICONS.check : ICONS.copy;
    this.copyButton.title = ok ? 'Copied' : 'Copy failed';
    setTimeout(() => {
      this.copyButton.innerHTML = ICONS.copy;
      this.copyButton.title = 'Copy answer';
    }, 1400);
  }

  private onTurnRendered(): void {
    if (this.followOutput) this.scrollToBottom();
  }

  private scrollToBottom(): void {
    this.body.scrollTop = this.body.scrollHeight;
  }

  private enableDragging(): void {
    let start: { x: number; y: number; left: number; top: number } | null = null;
    this.header.addEventListener('pointerdown', (event) => {
      if (event.button !== 0 || (event.target as Element).closest('button')) return;
      const rect = this.element.getBoundingClientRect();
      start = { x: event.clientX, y: event.clientY, left: rect.left, top: rect.top };
      Object.assign(this.element.style, { left: `${rect.left}px`, top: `${rect.top}px`, bottom: '' });
      this.header.setPointerCapture(event.pointerId);
      this.header.classList.add('ak-dragging');
      event.preventDefault();
    });
    this.header.addEventListener('pointermove', (event) => {
      if (!start) return;
      const rect = this.element.getBoundingClientRect();
      const left = clamp(start.left + event.clientX - start.x, 4 - rect.width + 60, window.innerWidth - 60);
      const top = clamp(start.top + event.clientY - start.y, 0, window.innerHeight - 40);
      Object.assign(this.element.style, { left: `${left}px`, top: `${top}px` });
    });
    const end = () => {
      if (!start) return;
      start = null;
      this.header.classList.remove('ak-dragging');
      const rect = this.element.getBoundingClientRect();
      this.element.style.maxHeight = `${Math.max(200, Math.min(600, window.innerHeight - rect.top - 12))}px`;
    };
    this.header.addEventListener('pointerup', end);
    this.header.addEventListener('pointercancel', end);
  }
}

/** One question and its answer within the panel. */
class Turn {
  readonly element: HTMLElement;
  answer = '';
  private thinking = '';
  private readonly questionText: HTMLElement;
  private readonly moreButton: HTMLButtonElement;
  private readonly status: HTMLElement;
  private readonly statusText: HTMLElement;
  private readonly reasoning: HTMLDetailsElement;
  private readonly reasoningLabel: HTMLElement;
  private readonly reasoningSpinner: HTMLElement;
  private readonly reasoningText: HTMLElement;
  private readonly markdown: HTMLElement;
  private readonly notices: HTMLElement;
  private renderPending = false;
  private closed = false;

  constructor(kind: AskKind, question: string, private readonly onRendered: () => void) {
    this.element = el('div', 'ak-turn');

    const questionBox = el('div', kind === 'followup' ? 'ak-question ak-followup' : 'ak-question');
    if (kind !== 'followup') {
      questionBox.append(el('div', 'ak-question-label', kind === 'selection' ? 'Selected text' : 'Your question'));
    }
    this.questionText = el('div', 'ak-question-text ak-clamped', question);
    this.moreButton = el('button', 'ak-link-btn', 'Show more');
    this.moreButton.type = 'button';
    this.moreButton.hidden = true;
    this.moreButton.addEventListener('click', () => {
      const clamped = this.questionText.classList.toggle('ak-clamped');
      this.moreButton.textContent = clamped ? 'Show more' : 'Show less';
    });
    questionBox.append(this.questionText, this.moreButton);

    const answer = el('div', 'ak-answer');
    this.status = el('div', 'ak-status');
    this.status.setAttribute('role', 'status');
    this.statusText = el('span', '', 'Connecting to Claude…');
    this.status.append(el('span', 'ak-spinner'), this.statusText);

    this.reasoning = el('details', 'ak-reasoning');
    this.reasoning.hidden = true;
    const summary = el('summary');
    summary.innerHTML = ICONS.chevron;
    this.reasoningSpinner = el('span', 'ak-spinner');
    this.reasoningLabel = el('span', '', 'Thinking…');
    summary.append(this.reasoningSpinner, this.reasoningLabel);
    this.reasoningText = el('div', 'ak-reasoning-text');
    this.reasoning.append(summary, this.reasoningText);

    this.markdown = el('div', 'ak-md ak-streaming');
    this.notices = el('div', 'ak-notices');
    answer.append(this.status, this.reasoning, this.markdown, this.notices);
    this.element.append(questionBox, answer);
  }

  /** Shows "Show more" when the question is longer than the clamped preview. */
  measureQuestion(): void {
    requestAnimationFrame(() => {
      this.moreButton.hidden = this.questionText.scrollHeight <= this.questionText.clientHeight + 1;
    });
  }

  onStart(): void {
    this.statusText.textContent = 'Thinking…';
  }

  onThinking(delta: string): void {
    if (this.closed) return;
    this.thinking += delta;
    this.status.hidden = true;
    this.reasoning.hidden = false;
    this.reasoningText.textContent = this.thinking;
    this.reasoningText.scrollTop = this.reasoningText.scrollHeight;
    this.onRendered();
  }

  onText(delta: string): void {
    if (this.closed) return;
    if (!this.answer) {
      this.status.hidden = true;
      this.settleReasoning();
    }
    this.answer += delta;
    this.scheduleRender();
  }

  onFallback(from: string, to: string): void {
    this.addNotice(
      'info',
      `${modelLabel(from)} declined this request, so ${modelLabel(to)} answered it instead.`,
    );
  }

  finish(stopReason: string | null): void {
    this.close();
    if (stopReason === 'max_tokens') {
      this.addNotice('warn', 'The answer hit the length limit and was cut off.');
    } else if (!this.answer) {
      this.addNotice('info', 'Claude finished without writing an answer. Try rephrasing the question.');
    }
  }

  finishStopped(): void {
    this.close();
    this.addNotice('info', this.answer ? 'Stopped.' : 'Stopped before Claude answered.');
  }

  finishRefused(refusal: RefusalInfo): void {
    // A declined answer may have stopped partway; don't present the fragment as an answer.
    this.answer = '';
    this.markdown.replaceChildren();
    this.close();
    this.element.classList.add('ak-dimmed');
    const topic = refusal.category ? REFUSAL_LABELS[refusal.category] : undefined;
    let text = topic
      ? `Claude declined to answer this (it was flagged as related to ${topic}).`
      : 'Claude declined to answer this.';
    if (refusal.explanation) text += ` ${refusal.explanation}`;
    this.addNotice('warn', `${text} You can rephrase it below.`);
  }

  fail(message: string, actions: { onRetry?: () => void; onSettings?: () => void }): void {
    this.close();
    this.element.classList.add('ak-dimmed');
    const notice = this.addNotice('error', message);
    if (actions.onSettings) notice.append(actionButton(ICONS.settings, 'Open settings', actions.onSettings));
    if (actions.onRetry) notice.append(actionButton(ICONS.retry, 'Retry', actions.onRetry));
  }

  private close(): void {
    this.closed = true;
    this.status.hidden = true;
    this.settleReasoning();
    this.render();
    this.markdown.classList.remove('ak-streaming');
  }

  private settleReasoning(): void {
    this.reasoningSpinner.hidden = true;
    this.reasoningLabel.textContent = 'Reasoning';
  }

  private addNotice(kind: 'info' | 'warn' | 'error', text: string): HTMLElement {
    const notice = el('div', `ak-notice ak-${kind}`);
    notice.setAttribute('role', kind === 'error' ? 'alert' : 'status');
    notice.append(el('span', 'ak-notice-text', text));
    this.notices.append(notice);
    this.onRendered();
    return notice;
  }

  private scheduleRender(): void {
    if (this.renderPending) return;
    this.renderPending = true;
    requestAnimationFrame(() => {
      if (this.renderPending) this.render();
    });
  }

  private render(): void {
    this.renderPending = false;
    this.markdown.innerHTML = this.answer ? renderMarkdown(this.answer) : '';
    this.onRendered();
  }
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function iconButton(icon: string, label: string, className = 'ak-icon-btn'): HTMLButtonElement {
  const button = el('button', className);
  button.type = 'button';
  button.innerHTML = icon;
  button.title = label;
  button.setAttribute('aria-label', label);
  return button;
}

function actionButton(icon: string, label: string, onClick: () => void): HTMLButtonElement {
  const button = el('button', 'ak-btn');
  button.type = 'button';
  button.innerHTML = icon;
  button.append(label);
  button.addEventListener('click', onClick);
  return button;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function sendRuntimeMessage(message: RuntimeMessage): void {
  try {
    chrome.runtime.sendMessage(message).catch(() => undefined);
  } catch {
    // Extension was reloaded; this page's copy of AnswerKey is orphaned.
  }
}

async function defaultCopyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
