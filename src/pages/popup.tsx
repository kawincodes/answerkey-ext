import { KeyRound, SendHorizontal, Settings as SettingsIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Logo } from '@/components/logo';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Kbd } from '@/components/ui/kbd';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { getApiKey } from '@/shared/apiKey';
import { EFFORTS, modelLabel } from '@/shared/models';
import type { RuntimeMessage } from '@/shared/protocol';
import { getSettings, type Settings, siteKey, updateSettings } from '@/shared/settings';

interface PopupData {
  hasKey: boolean;
  settings: Settings;
  site: string;
  shortcut: string;
}

function PopupApp() {
  const [data, setData] = useState<PopupData | null>(null);
  const [question, setQuestion] = useState('');

  useEffect(() => {
    void Promise.all([
      getApiKey(),
      getSettings(),
      chrome.tabs.query({ active: true, currentWindow: true }),
      chrome.commands.getAll(),
    ]).then(([apiKey, settings, [tab], commands]) =>
      setData({
        hasKey: Boolean(apiKey),
        settings,
        site: siteKey(tab?.url),
        shortcut: commands.find((c) => c.name === 'ask-selection')?.shortcut ?? '',
      }),
    );
  }, []);

  if (!data) return null;
  const { settings, site } = data;

  const openSettings = () => {
    void chrome.runtime.openOptionsPage();
    window.close();
  };

  const ask = async (event?: React.FormEvent) => {
    event?.preventDefault();
    const text = question.trim();
    if (!text) return;
    const message: RuntimeMessage = { type: 'open-answer-window', text };
    await chrome.runtime.sendMessage(message);
    window.close();
  };

  const update = (patch: Partial<Settings>) => {
    setData({ ...data, settings: { ...settings, ...patch } });
    void updateSettings(patch);
  };

  const effort = EFFORTS.find((e) => e.id === settings.effort)?.label ?? settings.effort;
  const siteEnabled = !settings.disabledSites.includes(site);

  return (
    <main className="space-y-3 p-3">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Logo />
          <span className="text-[15px] font-semibold tracking-tight">AnswerKey</span>
        </div>
        <Button id="open-settings" variant="ghost" size="icon-sm" aria-label="Settings" title="Settings" onClick={openSettings}>
          <SettingsIcon />
        </Button>
      </header>

      {!data.hasKey ? (
        <Card id="setup" className="gap-3 py-4">
          <CardContent className="space-y-3 px-4">
            <div className="space-y-1">
              <p className="font-medium">Add your Anthropic API key to start.</p>
              <p className="text-sm text-muted-foreground">
                AnswerKey uses your own key, so answers are billed to your Anthropic account.
              </p>
            </div>
            <Button id="setup-key" onClick={openSettings}>
              <KeyRound />
              Set up API key
            </Button>
          </CardContent>
        </Card>
      ) : (
        <section id="ready" className="space-y-3">
          <form id="ask-form" className="space-y-2" onSubmit={(event) => void ask(event)}>
            <Label htmlFor="question" className="sr-only">
              Question
            </Label>
            <Textarea
              id="question"
              autoFocus
              rows={3}
              value={question}
              placeholder="Ask Claude anything…"
              className="max-h-40 min-h-20 resize-none text-sm md:text-sm"
              onChange={(event) => setQuestion(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                  event.preventDefault();
                  void ask();
                }
              }}
            />
            <div className="flex items-center justify-between gap-2">
              <span id="model-line" className="text-xs text-muted-foreground">
                {`${modelLabel(settings.model)} · ${effort} effort`}
              </span>
              <Button id="ask" type="submit" size="sm" disabled={!question.trim()}>
                <SendHorizontal />
                Ask
              </Button>
            </div>
          </form>

          <Card className="gap-0 py-0">
            <div className="flex items-center justify-between gap-3 px-4 py-3">
              <Label htmlFor="show-button" className="leading-snug">
                “Ask Claude” button on selection
              </Label>
              <Switch
                id="show-button"
                checked={settings.showFloatingButton}
                onCheckedChange={(showFloatingButton) => update({ showFloatingButton })}
              />
            </div>
            {site && (
              <>
                <Separator />
                <div id="site-row" className="flex items-center justify-between gap-3 px-4 py-3">
                  <Label htmlFor="site-enabled" className="min-w-0 leading-snug">
                    <span className="truncate">
                      Show it on <span className="font-semibold">{site}</span>
                    </span>
                  </Label>
                  <Switch
                    id="site-enabled"
                    checked={siteEnabled}
                    disabled={!settings.showFloatingButton}
                    onCheckedChange={(enabled) => {
                      const others = settings.disabledSites.filter((s) => s !== site);
                      update({ disabledSites: enabled ? others : [...others, site] });
                    }}
                  />
                </div>
              </>
            )}
          </Card>

          <p className="text-xs leading-relaxed text-muted-foreground">
            Select text on a page, then click <strong className="text-foreground">Ask Claude</strong>, right-click and
            choose <strong className="text-foreground">Ask Claude</strong>, or press{' '}
            {data.shortcut ? <Kbd>{data.shortcut}</Kbd> : 'your keyboard shortcut (set one in Settings)'}.
          </p>
        </section>
      )}
    </main>
  );
}

createRoot(document.getElementById('app')!).render(<PopupApp />);
