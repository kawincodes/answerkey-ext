import {
  CircleAlert,
  CircleCheck,
  Cpu,
  ExternalLink,
  Eye,
  EyeOff,
  Gauge,
  Globe,
  Info,
  Keyboard,
  KeyRound,
  LoaderCircle,
  MessageSquareText,
  MousePointerClick,
  PlugZap,
  Save,
  ShieldCheck,
  Sparkles,
  Trash2,
} from 'lucide-react';
import { cn } from 'cn';
import { useCallback, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Logo } from '@/components/logo';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Kbd } from '@/components/ui/kbd';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { clearApiKey, getApiKey, looksLikeApiKey, setApiKey } from '@/shared/apiKey';
import { EFFORTS, type Effort, MODELS } from '@/shared/models';
import type { RuntimeMessage, TestKeyResult } from '@/shared/protocol';
import { getSettings, MAX_CUSTOM_INSTRUCTIONS, onSettingsChanged, type Settings, updateSettings } from '@/shared/settings';

type KeyStatus = { kind: 'pending' | 'ok' | 'error' | 'info'; text: string } | null;

const isEdge = navigator.userAgent.includes('Edg/');

function OptionsApp() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [saved, setSaved] = useState('');
  const savedTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    void getSettings().then(setSettings);
    onSettingsChanged(setSettings);
  }, []);

  const save = useCallback(async (patch: Partial<Settings>) => {
    setSettings((current) => (current ? { ...current, ...patch } : current));
    try {
      await updateSettings(patch);
      setSaved('Saved.');
    } catch (err) {
      setSaved(`Couldn't save: ${err instanceof Error ? err.message : String(err)}`);
    }
    clearTimeout(savedTimer.current);
    savedTimer.current = setTimeout(() => setSaved(''), 2000);
  }, []);

  if (!settings) return null;

  return (
    <main className="mx-auto max-w-2xl space-y-6 px-4 py-10">
      <header className="flex items-center gap-3">
        <Logo className="size-10 rounded-lg" iconClassName="size-5" />
        <div>
          <h1 className="text-xl font-semibold tracking-tight">AnswerKey settings</h1>
          <p className="text-muted-foreground">Select text on any page and get an answer from Claude.</p>
        </div>
      </header>

      {location.hash === '#welcome' && (
        <Alert id="welcome" className="border-brand/30 bg-brand/5 [&>svg]:text-brand">
          <Sparkles />
          <AlertTitle>Welcome to AnswerKey</AlertTitle>
          <AlertDescription className="text-foreground">
            <ol className="list-decimal space-y-1 pl-4">
              <li>
                Paste your Anthropic API key below and click <strong>Save key</strong>.
              </li>
              <li>Reload any tabs that were already open, so the “Ask Claude” button can appear there.</li>
              <li>
                Select text on a page and click <strong>Ask Claude</strong>, or right-click it and choose{' '}
                <strong>Ask Claude</strong>.
              </li>
            </ol>
          </AlertDescription>
        </Alert>
      )}

      <ApiKeyCard model={settings.model} />
      <AnswersCard settings={settings} save={save} saved={saved} />
      <PagesCard settings={settings} save={save} />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldCheck className="size-4 text-muted-foreground" />
            What gets sent
          </CardTitle>
          <CardDescription className="leading-relaxed">
            Only when you ask a question, AnswerKey sends the selected text (plus the page title and site name, if
            enabled above) and your follow-up messages to Anthropic's API using your key. Nothing is sent anywhere
            else, and nothing is collected by the extension's author.
          </CardDescription>
        </CardHeader>
      </Card>
    </main>
  );
}

function ApiKeyCard({ model }: { model: string }) {
  const [value, setValue] = useState('');
  const [visible, setVisible] = useState(false);
  const [savedKey, setSavedKey] = useState('');
  const [status, setStatus] = useState<KeyStatus>(null);
  const [testing, setTesting] = useState(false);

  const refresh = useCallback(async () => setSavedKey(await getApiKey()), []);
  useEffect(() => void refresh(), [refresh]);

  const runTest = async (key: string, pendingText: string) => {
    setStatus({ kind: 'pending', text: pendingText });
    setTesting(true);
    try {
      const message: RuntimeMessage = { type: 'test-api-key', apiKey: key, model };
      const result = (await chrome.runtime.sendMessage(message)) as TestKeyResult | undefined;
      if (result?.ok) {
        setStatus({ kind: 'ok', text: `Connected. This key can use ${result.modelName}.` });
      } else {
        const hint = looksLikeApiKey(key) ? '' : ' (Anthropic API keys start with “sk-ant-”.)';
        setStatus({ kind: 'error', text: `${result?.message ?? 'The key could not be checked.'}${hint}` });
      }
    } catch (err) {
      setStatus({ kind: 'error', text: `The key could not be checked: ${err instanceof Error ? err.message : String(err)}` });
    } finally {
      setTesting(false);
    }
  };

  const onSave = async (event: React.FormEvent) => {
    event.preventDefault();
    const key = value.trim();
    if (!key) {
      setStatus({ kind: 'error', text: 'Paste your API key first.' });
      return;
    }
    await setApiKey(key);
    setValue('');
    setVisible(false);
    await refresh();
    await runTest(key, 'Saved. Checking the key…');
  };

  const onTest = async () => {
    const key = value.trim() || (await getApiKey());
    if (!key) {
      setStatus({ kind: 'error', text: 'There is no key to test. Paste your API key first.' });
      return;
    }
    await runTest(key, 'Checking the key…');
  };

  const onRemove = async () => {
    await clearApiKey();
    setValue('');
    await refresh();
    setStatus({ kind: 'info', text: 'Key removed. AnswerKey can’t answer questions until you add one again.' });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <KeyRound className="size-4 text-muted-foreground" />
          Anthropic API key
        </CardTitle>
        <CardDescription>
          AnswerKey talks to Claude with your own API key, so usage is billed to your Anthropic account. Create a key
          in the{' '}
          <a
            className="inline-flex items-center gap-0.5 font-medium text-foreground underline underline-offset-4"
            href="https://platform.claude.com/settings/keys"
            target="_blank"
            rel="noopener"
          >
            Claude Console
            <ExternalLink className="size-3" />
          </a>
          .
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form className="space-y-3" autoComplete="off" onSubmit={(event) => void onSave(event)}>
          <div className="space-y-2">
            <Label htmlFor="api-key">API key</Label>
            <div className="flex gap-2">
              <Input
                id="api-key"
                type={visible ? 'text' : 'password'}
                spellCheck={false}
                autoComplete="off"
                value={value}
                onChange={(event) => setValue(event.target.value)}
                placeholder={savedKey ? `Saved key ending in …${savedKey.slice(-4)} — paste a new key to replace it` : 'sk-ant-…'}
                className="font-mono text-sm placeholder:font-sans md:text-sm"
              />
              <Button
                id="toggle-key"
                type="button"
                variant="outline"
                size="icon"
                aria-label={visible ? 'Hide key' : 'Show key'}
                aria-pressed={visible}
                onClick={() => setVisible(!visible)}
              >
                {visible ? <EyeOff /> : <Eye />}
              </Button>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button id="save-key" type="submit">
              <Save />
              Save key
            </Button>
            <Button id="test-key" type="button" variant="outline" disabled={testing} onClick={() => void onTest()}>
              <PlugZap />
              Test connection
            </Button>
            <Button
              id="remove-key"
              type="button"
              variant="ghost"
              className="text-destructive hover:text-destructive"
              disabled={!savedKey}
              onClick={() => void onRemove()}
            >
              <Trash2 />
              Remove key
            </Button>
          </div>
          {status && <KeyStatusAlert status={status} />}
          <p className="flex items-start gap-2 text-xs text-muted-foreground">
            <ShieldCheck className="mt-0.5 size-3.5 shrink-0" />
            The key is stored only in this browser profile (it doesn't sync to other devices), can't be read by web
            pages, and is sent only to api.anthropic.com.
          </p>
        </form>
      </CardContent>
    </Card>
  );
}

function KeyStatusAlert({ status }: { status: NonNullable<KeyStatus> }) {
  const Icon = { pending: LoaderCircle, ok: CircleCheck, error: CircleAlert, info: Info }[status.kind];
  return (
    <Alert
      id="key-status"
      role="status"
      variant={status.kind === 'error' ? 'destructive' : 'default'}
      className={cn(
        status.kind === 'ok' && 'border-success/30 [&>svg]:text-success',
        status.kind === 'error' && 'border-destructive/30',
        (status.kind === 'pending' || status.kind === 'info') && 'bg-muted/40 [&>svg]:text-muted-foreground',
      )}
    >
      <Icon className={cn(status.kind === 'pending' && 'animate-spin')} />
      <AlertDescription className={cn(status.kind === 'ok' && 'text-foreground')}>{status.text}</AlertDescription>
    </Alert>
  );
}

function AnswersCard({
  settings,
  save,
  saved,
}: {
  settings: Settings;
  save: (patch: Partial<Settings>) => Promise<void>;
  saved: string;
}) {
  const [instructions, setInstructions] = useState(settings.customInstructions);
  const editing = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    if (!editing.current) setInstructions(settings.customInstructions);
  }, [settings.customInstructions]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Sparkles className="size-4 text-muted-foreground" />
          Answers
        </CardTitle>
        <CardDescription>Changes are saved automatically and apply to the next question you ask.</CardDescription>
        <CardAction>
          <p className="flex h-5 items-center gap-1.5 text-xs text-muted-foreground" aria-live="polite">
            {saved && <CircleCheck className="size-3.5 text-success" />}
            <span id="answers-saved">{saved}</span>
          </p>
        </CardAction>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="space-y-2">
          <Label htmlFor="model">
            <Cpu className="size-3.5 text-muted-foreground" />
            Model
          </Label>
          <Select value={settings.model} onValueChange={(model) => void save({ model })}>
            <SelectTrigger id="model" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {MODELS.map((model) => (
                <SelectItem key={model.id} value={model.id}>
                  {model.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p id="model-note" className="text-xs text-muted-foreground">
            {MODELS.find((m) => m.id === settings.model)?.note}
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="effort">
            <Gauge className="size-3.5 text-muted-foreground" />
            Thinking effort
          </Label>
          <Select value={settings.effort} onValueChange={(effort) => void save({ effort: effort as Effort })}>
            <SelectTrigger id="effort" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {EFFORTS.map((effort) => (
                <SelectItem key={effort.id} value={effort.id}>
                  {effort.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p id="effort-note" className="text-xs text-muted-foreground">
            {EFFORTS.find((e) => e.id === settings.effort)?.note}
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="instructions">
            <MessageSquareText className="size-3.5 text-muted-foreground" />
            Your instructions <span className="font-normal text-muted-foreground">(optional)</span>
          </Label>
          <Textarea
            id="instructions"
            maxLength={MAX_CUSTOM_INSTRUCTIONS}
            value={instructions}
            placeholder="For example: “Answer with just the option letter.” · “Explain it like I'm 12.” · “Always reply in Hindi.”"
            className="min-h-24 text-sm md:text-sm"
            onFocus={() => (editing.current = true)}
            onBlur={() => (editing.current = false)}
            onChange={(event) => {
              const next = event.target.value;
              setInstructions(next);
              clearTimeout(timer.current);
              timer.current = setTimeout(() => void save({ customInstructions: next }), 500);
            }}
          />
          <p className="text-xs text-muted-foreground">
            <span id="instructions-count">{instructions.length}</span> / {MAX_CUSTOM_INSTRUCTIONS} characters. Added to
            every new question.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

function PagesCard({ settings, save }: { settings: Settings; save: (patch: Partial<Settings>) => Promise<void> }) {
  const [shortcut, setShortcut] = useState<string | null>(null);

  useEffect(() => {
    const load = () =>
      void chrome.commands.getAll().then((commands) => {
        setShortcut(commands.find((c) => c.name === 'ask-selection')?.shortcut ?? '');
      });
    load();
    window.addEventListener('focus', load);
    return () => window.removeEventListener('focus', load);
  }, []);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <MousePointerClick className="size-4 text-muted-foreground" />
          On web pages
        </CardTitle>
        <CardDescription>How AnswerKey shows up when you select text.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <SwitchRow
          id="show-button"
          checked={settings.showFloatingButton}
          onChange={(showFloatingButton) => void save({ showFloatingButton })}
          title="Show the “Ask Claude” button when I select text"
          description="You can always right-click a selection and choose “Ask Claude”, or use the keyboard shortcut."
        />
        <SwitchRow
          id="page-context"
          checked={settings.includePageContext}
          onChange={(includePageContext) => void save({ includePageContext })}
          title="Send the page title and website name with the selection"
          description="Gives Claude context such as the course or quiz name. The full address is never sent."
        />

        <Separator />

        <div className="space-y-2">
          <div className="text-sm font-medium">Button hidden on these sites</div>
          {settings.disabledSites.length > 0 ? (
            <ul id="sites" className="divide-y rounded-md border">
              {settings.disabledSites.map((site) => (
                <li key={site} className="flex items-center justify-between gap-2 py-1.5 pr-1.5 pl-3 text-sm">
                  <span className="flex min-w-0 items-center gap-2">
                    <Globe className="size-4 shrink-0 text-muted-foreground" />
                    <span className="truncate">{site}</span>
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => void save({ disabledSites: settings.disabledSites.filter((s) => s !== site) })}
                  >
                    Show again
                  </Button>
                </li>
              ))}
            </ul>
          ) : (
            <p id="sites-empty" className="text-sm text-muted-foreground">
              None. Use the toolbar button on a site to hide the “Ask Claude” button there.
            </p>
          )}
        </div>

        <Separator />

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-sm font-medium">
              <Keyboard className="size-4 text-muted-foreground" />
              Keyboard shortcut
            </div>
            <p id="shortcut" className="text-sm text-muted-foreground">
              {shortcut ? (
                <>
                  <Kbd className="mr-1 text-foreground">{shortcut}</Kbd> asks Claude about the selected text.
                </>
              ) : shortcut === '' ? (
                'Not set. Choose one on the browser’s shortcuts page.'
              ) : null}
            </p>
          </div>
          <Button
            id="change-shortcut"
            variant="outline"
            onClick={() =>
              void chrome.tabs.create({ url: isEdge ? 'edge://extensions/shortcuts' : 'chrome://extensions/shortcuts' })
            }
          >
            <ExternalLink />
            Change shortcut
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function SwitchRow({
  id,
  checked,
  onChange,
  title,
  description,
}: {
  id: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  title: string;
  description: string;
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="space-y-1">
        <Label htmlFor={id} className="leading-snug">
          {title}
        </Label>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
      <Switch id={id} checked={checked} onCheckedChange={onChange} className="mt-0.5" />
    </div>
  );
}

createRoot(document.getElementById('app')!).render(<OptionsApp />);
