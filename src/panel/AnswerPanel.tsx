import {
  ArrowUp,
  Brain,
  Check,
  ChevronRight,
  CircleAlert,
  Copy,
  Info,
  LoaderCircle,
  RotateCcw,
  Settings,
  Square,
  TriangleAlert,
  X,
} from 'lucide-react';
import { cn } from 'cn';
import { useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Logo } from '@/components/logo';
import { Textarea } from '@/components/ui/textarea';
import { modelLabel } from '@/shared/models';
import type { PageInfo } from '@/shared/protocol';
import { getSettings } from '@/shared/settings';
import { renderMarkdown } from './markdown';
import { type Notice, sendRuntimeMessage, type Turn, useAnswerSession } from './session';

export interface AnswerPanelHandle {
  /** Opens the panel on a new conversation, asking about `text` right away if given. */
  start(kind: 'selection' | 'typed', text: string, page?: PageInfo): void;
  /** Places the floating panel next to `anchor` (viewport coordinates), or centered. */
  placeNear(anchor: DOMRect | null): void;
  close(): void;
  isOpen(): boolean;
}

interface AnswerPanelProps {
  /** 'floating' sits over a web page; 'window' fills the stand-alone answer window. */
  mode: 'floating' | 'window';
  onClose: () => void;
  /** Clipboard writer; content scripts pass one with a fallback for http pages. */
  copyText?: (text: string) => Promise<boolean>;
  ref?: React.Ref<AnswerPanelHandle>;
}

export function AnswerPanel({ mode, onClose, copyText = defaultCopyText, ref }: AnswerPanelProps) {
  const { state, ask, stop, retry, reset, setModel } = useAnswerSession();
  const [open, setOpen] = useState(mode === 'window');
  const [input, setInput] = useState('');
  const [copied, setCopied] = useState<boolean | null>(null);
  const panelRef = useRef<HTMLElement>(null);
  const headerRef = useRef<HTMLElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const followOutput = useRef(true);
  const floating = mode === 'floating';

  const lastTurn = state.turns.at(-1);
  const answerToCopy = lastTurn?.answer ?? '';

  const close = () => {
    reset();
    setInput('');
    if (floating) setOpen(false);
    onClose();
  };

  useImperativeHandle(ref, () => ({
    start(kind, text, page) {
      reset();
      setInput('');
      setOpen(true);
      followOutput.current = true;
      void getSettings()
        .then((settings) => setModel(settings.model, false))
        .catch(() => undefined);
      if (text.trim()) ask(kind, text, page);
      else requestAnimationFrame(() => inputRef.current?.focus());
    },
    placeNear(anchor) {
      if (panelRef.current) placePanel(panelRef.current, anchor);
    },
    close,
    isOpen: () => open,
  }));

  // Keep the newest output in view unless the reader scrolled up.
  useLayoutEffect(() => {
    if (followOutput.current && bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
  }, [state.turns]);

  // After an answer, put the cursor back in the box if it was there (always, in the window).
  const wasBusy = useRef(false);
  useEffect(() => {
    if (wasBusy.current && !state.busy) {
      const root = inputRef.current?.getRootNode() as Document | ShadowRoot | undefined;
      if (!floating || root?.activeElement === inputRef.current) inputRef.current?.focus();
    }
    wasBusy.current = state.busy;
  }, [state.busy, floating]);

  useDragging(floating, panelRef, headerRef);

  const submit = () => {
    const text = input.trim();
    if (!text || state.busy || state.blocked) return;
    setInput('');
    followOutput.current = true;
    ask(state.asked ? 'followup' : 'typed', text);
  };

  const copyAnswer = async () => {
    if (!answerToCopy) return;
    setCopied(await copyText(answerToCopy));
    setTimeout(() => setCopied(null), 1400);
  };

  const placeholder = state.blocked
    ? 'Retry the question above to continue'
    : state.asked
      ? 'Ask a follow-up…'
      : 'Ask Claude anything…';

  return (
    <section
      ref={panelRef}
      data-ak="panel"
      role="dialog"
      aria-label="AnswerKey"
      hidden={!open}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          close();
        }
      }}
      className={cn(
        'flex flex-col overflow-hidden bg-card text-card-foreground',
        floating
          ? 'fixed w-[min(440px,calc(100vw-24px))] max-h-[min(600px,calc(100vh-24px))] rounded-xl border shadow-2xl animate-in fade-in-0 zoom-in-95 duration-150'
          : 'h-screen w-full',
      )}
    >
      <header
        ref={headerRef}
        className={cn('flex items-center gap-2 border-b py-2 pr-2 pl-3 select-none', floating && 'cursor-grab touch-none')}
      >
        <Logo />
        <span className="text-sm font-semibold tracking-tight">AnswerKey</span>
        {state.model && (
          <Badge data-ak="model" variant="secondary" title={state.model}>
            {modelLabel(state.model)}
          </Badge>
        )}
        <span className="flex-1" />
        <Button
          data-ak="copy"
          variant="ghost"
          size="icon-sm"
          aria-label="Copy answer"
          title={copied === false ? 'Copy failed' : copied ? 'Copied' : 'Copy answer'}
          disabled={!answerToCopy}
          onClick={() => void copyAnswer()}
        >
          {copied ? <Check /> : <Copy />}
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="AnswerKey settings"
          title="Settings"
          onClick={() => sendRuntimeMessage({ type: 'open-options' })}
        >
          <Settings />
        </Button>
        <Button
          data-ak="close"
          variant="ghost"
          size="icon-sm"
          aria-label={floating ? 'Close (Esc)' : 'Close window'}
          title={floating ? 'Close (Esc)' : 'Close window'}
          onClick={close}
        >
          <X />
        </Button>
      </header>

      <div
        ref={bodyRef}
        data-ak="body"
        className="min-h-16 flex-1 overflow-y-auto overscroll-contain px-4 py-3"
        onScroll={(event) => {
          const el = event.currentTarget;
          followOutput.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
        }}
      >
        {state.turns.length === 0 && (
          <p data-ak="hint" className="text-sm text-muted-foreground">
            Type a question below, or select text on a page and click “Ask Claude”.
          </p>
        )}
        {state.turns.map((turn, index) => (
          <TurnView
            key={turn.id}
            turn={turn}
            className={index > 0 ? 'mt-4 border-t border-dashed pt-4' : undefined}
            onRetry={() => retry(turn.id)}
          />
        ))}
      </div>

      <footer className="flex items-end gap-2 border-t p-3">
        <Textarea
          ref={inputRef}
          data-ak="input"
          aria-label="Message to Claude"
          rows={1}
          value={input}
          placeholder={placeholder}
          disabled={state.blocked}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              submit();
            }
          }}
          className="max-h-32 min-h-9 resize-none py-2 text-sm md:text-sm"
        />
        {state.busy ? (
          <Button data-ak="stop" variant="secondary" size="icon" aria-label="Stop" title="Stop" onClick={stop}>
            <Square className="fill-current" />
          </Button>
        ) : (
          <Button
            data-ak="send"
            size="icon"
            aria-label="Send"
            title="Send"
            disabled={state.blocked || !input.trim()}
            onClick={submit}
          >
            <ArrowUp />
          </Button>
        )}
      </footer>
    </section>
  );
}

function TurnView({ turn, className, onRetry }: { turn: Turn; className?: string; onRetry: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const [overflowing, setOverflowing] = useState(false);
  const questionRef = useRef<HTMLDivElement>(null);
  const html = useMemo(() => (turn.answer ? renderMarkdown(turn.answer) : ''), [turn.answer]);
  const streaming = turn.phase === 'connecting' || turn.phase === 'thinking' || turn.phase === 'answering';

  useLayoutEffect(() => {
    const el = questionRef.current;
    if (el) setOverflowing(el.scrollHeight > el.clientHeight + 1);
  }, [turn.question]);

  return (
    <div data-ak="turn" className={cn(turn.dimmed && '[&_[data-ak=question]]:opacity-60', className)}>
      {turn.kind === 'followup' ? (
        <div data-ak="question" className="mb-3 ml-10 rounded-lg bg-secondary px-3 py-2 text-sm text-secondary-foreground">
          <div data-ak="question-text" className="break-words whitespace-pre-wrap">
            {turn.question}
          </div>
        </div>
      ) : (
        <div data-ak="question" className="mb-3 rounded-lg border bg-muted/40 px-3 py-2">
          <div data-ak="question-label" className="mb-0.5 text-xs font-medium text-muted-foreground">
            {turn.kind === 'selection' ? 'Selected text' : 'Your question'}
          </div>
          <div
            ref={questionRef}
            data-ak="question-text"
            className={cn('text-sm break-words whitespace-pre-wrap', !expanded && 'line-clamp-4')}
          >
            {turn.question}
          </div>
          {(overflowing || expanded) && (
            <Button variant="link" size="xs" className="mt-1 h-auto px-0" onClick={() => setExpanded(!expanded)}>
              {expanded ? 'Show less' : 'Show more'}
            </Button>
          )}
        </div>
      )}

      {(turn.phase === 'connecting' || (turn.phase === 'thinking' && !turn.thinking)) && (
        <div data-ak="status" role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
          <LoaderCircle className="size-4 animate-spin" />
          {turn.phase === 'connecting' ? 'Connecting to Claude…' : 'Thinking…'}
        </div>
      )}

      {turn.thinking && <Reasoning text={turn.thinking} active={turn.phase === 'thinking'} />}

      {html && (
        <div
          data-ak="answer"
          className={cn('ak-md', streaming && 'ak-streaming')}
          // Sanitized by renderMarkdown (strict allow-list, no images or scripts).
          dangerouslySetInnerHTML={{ __html: html }}
        />
      )}

      {turn.notices.map((notice, index) => (
        <NoticeView key={index} notice={notice} onRetry={onRetry} />
      ))}
    </div>
  );
}

function Reasoning({ text, active }: { text: string; active: boolean }) {
  const [open, setOpen] = useState(false);
  const textRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (open && active && textRef.current) textRef.current.scrollTop = textRef.current.scrollHeight;
  }, [text, open, active]);

  return (
    <Collapsible data-ak="reasoning" open={open} onOpenChange={setOpen} className="mb-2">
      <CollapsibleTrigger
        data-ak="reasoning-trigger"
        className="group inline-flex items-center gap-1.5 rounded-md text-xs font-medium text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
      >
        <ChevronRight className="size-3.5 transition-transform group-data-[state=open]:rotate-90" />
        {active ? <LoaderCircle className="size-3.5 animate-spin" /> : <Brain className="size-3.5" />}
        {active ? 'Thinking…' : 'Reasoning'}
      </CollapsibleTrigger>
      <CollapsibleContent
        ref={textRef}
        forceMount
        data-ak="reasoning-text"
        className="mt-2 max-h-44 overflow-y-auto border-l-2 pl-3 text-xs leading-relaxed whitespace-pre-wrap text-muted-foreground data-[state=closed]:hidden"
      >
        {text}
      </CollapsibleContent>
    </Collapsible>
  );
}

const NOTICE_ICONS = { info: Info, warn: TriangleAlert, error: CircleAlert };

function NoticeView({ notice, onRetry }: { notice: Notice; onRetry: () => void }) {
  const Icon = NOTICE_ICONS[notice.kind];
  return (
    <Alert
      data-ak="notice"
      data-kind={notice.kind}
      variant={notice.kind === 'error' ? 'destructive' : 'default'}
      role={notice.kind === 'error' ? 'alert' : 'status'}
      className={cn(
        'mt-3 py-2.5',
        notice.kind === 'info' && 'bg-muted/40 [&>svg]:text-muted-foreground',
        notice.kind === 'warn' && 'border-warning/40 [&>svg]:text-warning',
        notice.kind === 'error' && 'border-destructive/40',
      )}
    >
      <Icon />
      <AlertDescription className={cn(notice.kind === 'warn' && 'text-foreground')}>
        <p>{notice.text}</p>
        {(notice.retry || notice.settings) && (
          <div className="mt-1 flex flex-wrap gap-2">
            {notice.settings && (
              <Button
                data-ak="open-settings"
                variant="outline"
                size="sm"
                className="text-foreground"
                onClick={() => sendRuntimeMessage({ type: 'open-options' })}
              >
                <Settings />
                Open settings
              </Button>
            )}
            {notice.retry && (
              <Button data-ak="retry" variant="outline" size="sm" className="text-foreground" onClick={onRetry}>
                <RotateCcw />
                Retry
              </Button>
            )}
          </div>
        )}
      </AlertDescription>
    </Alert>
  );
}

/** Lets the floating panel be dragged by its header. */
function useDragging(
  enabled: boolean,
  panelRef: React.RefObject<HTMLElement | null>,
  headerRef: React.RefObject<HTMLElement | null>,
) {
  useEffect(() => {
    const panel = panelRef.current;
    const header = headerRef.current;
    if (!enabled || !panel || !header) return;
    let start: { x: number; y: number; left: number; top: number } | null = null;

    const down = (event: PointerEvent) => {
      if (event.button !== 0 || (event.target as Element).closest('button')) return;
      const rect = panel.getBoundingClientRect();
      start = { x: event.clientX, y: event.clientY, left: rect.left, top: rect.top };
      Object.assign(panel.style, { left: `${rect.left}px`, top: `${rect.top}px`, bottom: '' });
      header.setPointerCapture(event.pointerId);
      header.style.cursor = 'grabbing';
      event.preventDefault();
    };
    const move = (event: PointerEvent) => {
      if (!start) return;
      const rect = panel.getBoundingClientRect();
      const left = clamp(start.left + event.clientX - start.x, 64 - rect.width, window.innerWidth - 64);
      const top = clamp(start.top + event.clientY - start.y, 0, window.innerHeight - 48);
      Object.assign(panel.style, { left: `${left}px`, top: `${top}px` });
    };
    const end = () => {
      if (!start) return;
      start = null;
      header.style.cursor = '';
      const rect = panel.getBoundingClientRect();
      panel.style.maxHeight = `${Math.max(200, Math.min(600, window.innerHeight - rect.top - 12))}px`;
    };
    header.addEventListener('pointerdown', down);
    header.addEventListener('pointermove', move);
    header.addEventListener('pointerup', end);
    header.addEventListener('pointercancel', end);
    return () => {
      header.removeEventListener('pointerdown', down);
      header.removeEventListener('pointermove', move);
      header.removeEventListener('pointerup', end);
      header.removeEventListener('pointercancel', end);
    };
  }, [enabled, panelRef, headerRef]);
}

function placePanel(panel: HTMLElement, anchor: DOMRect | null): void {
  const style = panel.style;
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

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

async function defaultCopyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
