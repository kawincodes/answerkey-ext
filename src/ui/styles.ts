/**
 * Styles for the floating button and the answer panel. In web pages they live
 * inside a closed shadow root, so page CSS can't reach in and ours can't leak out.
 */
export const PANEL_CSS = `
.ak-root {
  --ak-bg: #ffffff;
  --ak-elev: #f6f6fa;
  --ak-border: #e3e3ec;
  --ak-text: #1b1d2a;
  --ak-muted: #666a80;
  --ak-accent: #5b4cf0;
  --ak-accent-soft: #edebfe;
  --ak-on-accent: #ffffff;
  --ak-danger: #b42633;
  --ak-danger-soft: #fdecee;
  --ak-warn: #7a5600;
  --ak-warn-soft: #fff4d6;
  --ak-shadow: 0 18px 48px rgba(20, 18, 50, 0.22), 0 3px 10px rgba(20, 18, 50, 0.1);
  --ak-shadow-sm: 0 4px 14px rgba(20, 18, 50, 0.18), 0 1px 3px rgba(20, 18, 50, 0.1);
  --ak-mono: ui-monospace, SFMono-Regular, "Cascadia Mono", Menlo, Consolas, monospace;

  font-family: system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  font-size: 14px;
  line-height: 1.5;
  color: var(--ak-text);
  text-align: left;
  -webkit-font-smoothing: antialiased;
}
@media (prefers-color-scheme: dark) {
  .ak-root {
    --ak-bg: #1d1e27;
    --ak-elev: #272834;
    --ak-border: #363849;
    --ak-text: #ececf4;
    --ak-muted: #a3a6bb;
    --ak-accent: #8d82ff;
    --ak-accent-soft: #2f2c56;
    --ak-on-accent: #14131f;
    --ak-danger: #ff8a94;
    --ak-danger-soft: #3b2027;
    --ak-warn: #f2d38a;
    --ak-warn-soft: #3a3121;
    --ak-shadow: 0 18px 48px rgba(0, 0, 0, 0.55), 0 3px 10px rgba(0, 0, 0, 0.35);
    --ak-shadow-sm: 0 4px 14px rgba(0, 0, 0, 0.5), 0 1px 3px rgba(0, 0, 0, 0.3);
  }
}
.ak-root *, .ak-root *::before, .ak-root *::after { box-sizing: border-box; }
.ak-root [hidden] { display: none !important; }
.ak-root button { font-family: inherit; }
.ak-root svg { flex: none; }

/* Floating "Ask Claude" button */
.ak-fab {
  position: fixed;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 30px;
  padding: 0 12px 0 9px;
  border-radius: 999px;
  border: 1px solid var(--ak-border);
  background: var(--ak-bg);
  color: var(--ak-text);
  box-shadow: var(--ak-shadow-sm);
  font-size: 13px;
  font-weight: 600;
  line-height: 1;
  white-space: nowrap;
  cursor: pointer;
  animation: ak-pop 0.14s ease-out;
}
.ak-fab .ak-fab-icon { display: inline-flex; color: var(--ak-accent); }
.ak-fab:hover, .ak-fab:focus-visible { background: var(--ak-accent); border-color: var(--ak-accent); color: var(--ak-on-accent); outline: none; }
.ak-fab:hover .ak-fab-icon, .ak-fab:focus-visible .ak-fab-icon { color: inherit; }

/* Panel */
.ak-panel {
  position: fixed;
  display: flex;
  flex-direction: column;
  width: min(440px, calc(100vw - 24px));
  max-height: min(600px, calc(100vh - 24px));
  background: var(--ak-bg);
  border: 1px solid var(--ak-border);
  border-radius: 14px;
  box-shadow: var(--ak-shadow);
  overflow: hidden;
  animation: ak-pop 0.16s ease-out;
}
.ak-window { height: 100vh; }
.ak-window .ak-panel {
  position: static;
  width: 100%;
  height: 100%;
  max-height: none;
  border: 0;
  border-radius: 0;
  box-shadow: none;
  animation: none;
}

.ak-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 8px 8px 12px;
  border-bottom: 1px solid var(--ak-border);
  cursor: grab;
  user-select: none;
  touch-action: none;
}
.ak-header.ak-dragging { cursor: grabbing; }
.ak-window .ak-header { cursor: default; }
.ak-logo {
  display: grid;
  place-items: center;
  width: 22px;
  height: 22px;
  border-radius: 6px;
  background: linear-gradient(135deg, #6366f1, #7c3aed);
  color: #fff;
}
.ak-logo svg { width: 15px; height: 15px; }
.ak-title { font-size: 13.5px; font-weight: 650; }
.ak-model {
  max-width: 120px;
  overflow: hidden;
  text-overflow: ellipsis;
  padding: 1px 8px;
  border: 1px solid var(--ak-border);
  border-radius: 999px;
  background: var(--ak-elev);
  color: var(--ak-muted);
  font-size: 11.5px;
  white-space: nowrap;
}
.ak-spacer { flex: 1; }
.ak-icon-btn {
  display: grid;
  place-items: center;
  width: 28px;
  height: 28px;
  padding: 0;
  border: 0;
  border-radius: 7px;
  background: transparent;
  color: var(--ak-muted);
  cursor: pointer;
}
.ak-icon-btn:hover { background: var(--ak-elev); color: var(--ak-text); }
.ak-icon-btn:disabled { opacity: 0.4; cursor: default; background: transparent; }
.ak-root :focus-visible { outline: 2px solid var(--ak-accent); outline-offset: 1px; }

.ak-body {
  flex: 1;
  min-height: 60px;
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: 12px 14px 14px;
}
.ak-hint { color: var(--ak-muted); font-size: 13px; }

.ak-turn + .ak-turn { margin-top: 14px; padding-top: 14px; border-top: 1px dashed var(--ak-border); }
.ak-turn.ak-dimmed .ak-question { opacity: 0.65; }

.ak-question {
  margin-bottom: 10px;
  padding: 8px 10px;
  border: 1px solid var(--ak-border);
  border-radius: 10px;
  background: var(--ak-elev);
}
.ak-question.ak-followup { margin-left: 36px; border-color: transparent; background: var(--ak-accent-soft); }
.ak-question-label {
  margin-bottom: 2px;
  color: var(--ak-muted);
  font-size: 11px;
  font-weight: 650;
  letter-spacing: 0.03em;
  text-transform: uppercase;
}
.ak-question-text { font-size: 13px; white-space: pre-wrap; overflow-wrap: anywhere; }
.ak-question-text.ak-clamped {
  display: -webkit-box;
  -webkit-line-clamp: 4;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.ak-link-btn {
  margin-top: 4px;
  padding: 0;
  border: 0;
  background: none;
  color: var(--ak-accent);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
}

.ak-status { display: flex; align-items: center; gap: 8px; color: var(--ak-muted); font-size: 13px; }
.ak-spinner {
  flex: none;
  width: 12px;
  height: 12px;
  border: 2px solid var(--ak-accent-soft);
  border-top-color: var(--ak-accent);
  border-radius: 50%;
  animation: ak-spin 0.8s linear infinite;
}

.ak-reasoning { margin: 0 0 8px; color: var(--ak-muted); font-size: 12.5px; }
.ak-reasoning > summary {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  list-style: none;
  cursor: pointer;
  user-select: none;
}
.ak-reasoning > summary::-webkit-details-marker { display: none; }
.ak-reasoning > summary svg { width: 13px; height: 13px; transition: transform 0.15s; }
.ak-reasoning[open] > summary svg { transform: rotate(90deg); }
.ak-reasoning-text {
  max-height: 180px;
  margin-top: 6px;
  padding: 6px 10px;
  overflow-y: auto;
  border-left: 2px solid var(--ak-border);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

/* Rendered Markdown */
.ak-md { overflow-wrap: anywhere; }
.ak-md > :first-child { margin-top: 0; }
.ak-md > :last-child { margin-bottom: 0; }
.ak-md p, .ak-md ul, .ak-md ol, .ak-md pre, .ak-md blockquote, .ak-md table { margin: 0 0 10px; }
.ak-md ul, .ak-md ol { padding-left: 22px; }
.ak-md li + li { margin-top: 3px; }
.ak-md li > p { margin: 0; }
.ak-md h1, .ak-md h2, .ak-md h3, .ak-md h4, .ak-md h5, .ak-md h6 { margin: 14px 0 6px; font-size: 14.5px; font-weight: 650; }
.ak-md strong, .ak-md b { font-weight: 650; }
.ak-md a { color: var(--ak-accent); }
.ak-md code {
  padding: 1px 4px;
  border: 1px solid var(--ak-border);
  border-radius: 5px;
  background: var(--ak-elev);
  font-family: var(--ak-mono);
  font-size: 12.5px;
}
.ak-md pre {
  padding: 10px 12px;
  overflow-x: auto;
  border: 1px solid var(--ak-border);
  border-radius: 8px;
  background: var(--ak-elev);
  line-height: 1.45;
}
.ak-md pre code { padding: 0; border: 0; background: none; white-space: pre; }
.ak-md blockquote { padding-left: 10px; border-left: 3px solid var(--ak-border); color: var(--ak-muted); }
.ak-md table { display: block; overflow-x: auto; border-collapse: collapse; font-size: 13px; }
.ak-md th, .ak-md td { padding: 5px 8px; border: 1px solid var(--ak-border); text-align: left; }
.ak-md th { background: var(--ak-elev); }
.ak-md hr { margin: 12px 0; border: 0; border-top: 1px solid var(--ak-border); }
.ak-md.ak-streaming > p:last-child::after {
  content: "";
  display: inline-block;
  width: 7px;
  height: 14px;
  margin-left: 2px;
  border-radius: 1px;
  background: var(--ak-accent);
  vertical-align: -2px;
  animation: ak-blink 1s steps(2, start) infinite;
}

.ak-notice {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin-top: 10px;
  padding: 8px 10px;
  border-radius: 8px;
  font-size: 12.5px;
}
.ak-notice.ak-info { background: var(--ak-elev); color: var(--ak-muted); }
.ak-notice.ak-warn { background: var(--ak-warn-soft); color: var(--ak-warn); }
.ak-notice.ak-error { background: var(--ak-danger-soft); color: var(--ak-danger); }
.ak-notice-text { flex: 1 1 220px; }
.ak-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 28px;
  padding: 0 10px;
  border: 1px solid var(--ak-border);
  border-radius: 7px;
  background: var(--ak-bg);
  color: var(--ak-text);
  font-size: 12.5px;
  font-weight: 600;
  cursor: pointer;
}
.ak-btn:hover { border-color: var(--ak-accent); color: var(--ak-accent); }
.ak-btn svg { width: 14px; height: 14px; }

.ak-footer {
  display: flex;
  align-items: flex-end;
  gap: 8px;
  padding: 10px 12px;
  border-top: 1px solid var(--ak-border);
}
.ak-input {
  flex: 1;
  min-height: 36px;
  max-height: 120px;
  padding: 7px 10px;
  resize: none;
  border: 1px solid var(--ak-border);
  border-radius: 9px;
  background: var(--ak-elev);
  color: var(--ak-text);
  font-family: inherit;
  font-size: 14px;
  line-height: 1.4;
  outline: none;
}
.ak-input::placeholder { color: var(--ak-muted); }
.ak-input:focus { border-color: var(--ak-accent); box-shadow: 0 0 0 3px var(--ak-accent-soft); }
.ak-input:disabled { opacity: 0.6; }
.ak-send {
  display: grid;
  place-items: center;
  flex: none;
  width: 36px;
  height: 36px;
  padding: 0;
  border: 0;
  border-radius: 9px;
  background: var(--ak-accent);
  color: var(--ak-on-accent);
  cursor: pointer;
}
.ak-send:disabled { opacity: 0.4; cursor: default; }
.ak-send.ak-stop { background: var(--ak-text); color: var(--ak-bg); }

@keyframes ak-spin { to { transform: rotate(360deg); } }
@keyframes ak-pop { from { opacity: 0; transform: translateY(4px) scale(0.97); } }
@keyframes ak-blink { to { visibility: hidden; } }
@media (prefers-reduced-motion: reduce) {
  .ak-fab, .ak-panel { animation: none; }
  .ak-spinner { animation-duration: 2.4s; }
  .ak-md.ak-streaming > p:last-child::after { animation: none; }
}
`;
