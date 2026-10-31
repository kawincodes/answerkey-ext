// The in-page answer panel. The content script imports this module only the
// first time it's needed, so pages where nothing is asked don't load React.
import panelCss from 'virtual:panel-css';
import { createRef } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import type { PageInfo } from '@/shared/protocol';
import { AnswerPanel, type AnswerPanelHandle } from './AnswerPanel';

export interface PanelController {
  start(kind: 'selection' | 'typed', text: string, page?: PageInfo): void;
  placeNear(anchor: DOMRect | null): void;
  isOpen(): boolean;
}

export function mountPanel(
  shadow: ShadowRoot,
  options: { onClose: () => void; copyText?: (text: string) => Promise<boolean> },
): PanelController {
  const style = document.createElement('style');
  style.textContent = panelCss;
  const container = document.createElement('div');
  container.className = 'ak-root';
  shadow.append(style, container);

  const handle = createRef<AnswerPanelHandle>();
  const root = createRoot(container);
  flushSync(() => {
    root.render(<AnswerPanel ref={handle} mode="floating" onClose={options.onClose} copyText={options.copyText} />);
  });

  // React handles events at `container`; stop them there so keystrokes and
  // clicks inside the panel don't trigger the page's own shortcuts.
  for (const type of ['keydown', 'keyup', 'keypress', 'mousedown', 'mouseup', 'click', 'pointerdown', 'wheel']) {
    container.addEventListener(type, (event) => event.stopPropagation());
  }

  return {
    start: (kind, text, page) => handle.current?.start(kind, text, page),
    placeNear: (anchor) => handle.current?.placeNear(anchor),
    isOpen: () => handle.current?.isOpen() ?? false,
  };
}
