// Stand-alone answer window. Used for questions typed into the toolbar popup and
// for pages where AnswerKey can't show its in-page panel (browser pages, the PDF
// viewer, the add-ons store).
import type { PendingWindowQuestion } from '../shared/protocol';
import { AnswerPanel } from '../ui/panel';
import { PANEL_CSS } from '../ui/styles';

const style = document.createElement('style');
style.textContent = PANEL_CSS;
document.head.append(style);

const root = document.createElement('div');
root.className = 'ak-root ak-window';
document.getElementById('app')?.append(root);

const panel = new AnswerPanel({ mode: 'window', onClose: () => window.close() });
root.append(panel.element);

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
  const text = pending.text ?? '';
  panel.start(pending.page ? 'selection' : 'typed', text, pending.page);
}
