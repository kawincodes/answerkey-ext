// Stand-alone answer window. Used for questions typed into the toolbar popup and
// for pages where AnswerKey can't show its in-page panel (browser pages, the PDF
// viewer, the add-ons store).
import { createRef } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { AnswerPanel, type AnswerPanelHandle } from '@/panel/AnswerPanel';
import type { PendingWindowQuestion } from '@/shared/protocol';

const panel = createRef<AnswerPanelHandle>();
const root = createRoot(document.getElementById('app')!);
flushSync(() => {
  root.render(<AnswerPanel ref={panel} mode="window" onClose={() => window.close()} />);
});

void start();

async function start(): Promise<void> {
  let pending: PendingWindowQuestion = {};
  const id = location.hash.slice(1);
  if (id) {
    const key = `pending:${id}`;
    const stored = await chrome.storage.session.get(key);
    pending = (stored[key] as PendingWindowQuestion | undefined) ?? {};
    await chrome.storage.session.remove(key);
    history.replaceState(null, '', location.pathname);
  }
  panel.current?.start(pending.page ? 'selection' : 'typed', pending.text ?? '', pending.page);
}
