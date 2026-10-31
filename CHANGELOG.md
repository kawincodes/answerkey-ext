# Changelog

The section for a version is added to the top of its GitHub release notes.

## 1.1.0 — 2026-10-31

- New design: the answer panel, settings page, toolbar popup and answer window are rebuilt with
  [shadcn/ui](https://ui.shadcn.com) components and [Lucide](https://lucide.dev) icons, in light and dark
  mode (following your system setting).
- Faster pages: the part of AnswerKey that runs in every page shrank from 107 KB to about 9 KB. The answer
  panel now loads the first time you ask a question on a page.
- If a site won't let the answer panel load, the answer opens in its own window instead.

## 1.0.0 — 2026-10-31

- First release. Select text on any page and ask Claude with your own Anthropic API key: use the
  **Ask Claude** button, the right-click menu, or **Alt+Shift+K**.
- Streaming answers with a summary of Claude's reasoning, follow-up questions, Stop, Retry and Copy.
- Settings for the model, thinking effort, your own instructions, page context, and where the button appears.
