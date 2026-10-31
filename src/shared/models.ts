export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export interface ModelOption {
  id: string;
  label: string;
  short: string;
  note: string;
}

export const DEFAULT_MODEL = 'claude-opus-5-5';

export const MODELS: ModelOption[] = [
  {
    id: 'claude-opus-5-5',
    label: 'Claude Opus 5.5',
    short: 'Opus 5.5',
    note: 'Best accuracy for hard questions (recommended).',
  },
  {
    id: 'claude-sonnet-5-5',
    label: 'Claude Sonnet 5.5',
    short: 'Sonnet 5.5',
    note: 'Fast and capable, about half the price of Opus.',
  },
  {
    id: 'claude-haiku-5-5',
    label: 'Claude Haiku 5.5',
    short: 'Haiku 5.5',
    note: 'Fastest and cheapest; fine for simple look-ups.',
  },
  {
    id: 'claude-fable-5-1',
    label: 'Claude Fable 5.1',
    short: 'Fable 5.1',
    note: "Anthropic's most capable model; slowest and most expensive.",
  },
];

export const DEFAULT_EFFORT: Effort = 'medium';

export const EFFORTS: { id: Effort; label: string; note: string }[] = [
  { id: 'low', label: 'Low', note: 'Quickest answers, least reasoning.' },
  { id: 'medium', label: 'Medium', note: 'Balanced speed and accuracy (recommended).' },
  { id: 'high', label: 'High', note: 'Thinks longer; better on tricky problems.' },
  { id: 'xhigh', label: 'Extra high', note: 'Much longer thinking for very hard problems.' },
  { id: 'max', label: 'Max', note: 'No limit on thinking; slowest and most expensive.' },
];

export function modelLabel(id: string): string {
  return MODELS.find((m) => m.id === id)?.short ?? id;
}

export function isEffort(value: unknown): value is Effort {
  return EFFORTS.some((e) => e.id === value);
}
