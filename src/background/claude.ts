import Anthropic from '@anthropic-ai/sdk';
import type { ErrorCode, TestKeyResult } from '../shared/protocol';
import type { Conversation } from './conversations';

/** Room for Claude's thinking plus the answer; thinking counts toward this cap. */
const MAX_TOKENS = 64_000;

/**
 * If a model's safety classifier declines a request, the API re-runs it on the
 * fallback model Anthropic recommends for that case instead of returning a refusal.
 */
const FALLBACK_BETA = 'server-side-fallback-2026-07-01';

export function createClient(apiKey: string): Anthropic {
  return new Anthropic({
    apiKey,
    // The SDK refuses to run in browsers by default because a key shipped inside a
    // web page is exposed to every visitor. Here the key is the user's own, typed
    // into this extension, stored only in this browser profile, and only ever sent
    // to api.anthropic.com from the background worker. The flag also makes the SDK
    // send the `anthropic-dangerous-direct-browser-access` header that the API
    // requires for requests coming from a browser origin.
    dangerouslyAllowBrowser: true,
  });
}

export interface StreamHandlers {
  onStart(model: string): void;
  onThinking(delta: string): void;
  onText(delta: string): void;
  onFallback(fromModel: string, toModel: string): void;
}

export async function streamReply(
  client: Anthropic,
  conversation: Conversation,
  messages: Anthropic.Beta.BetaMessageParam[],
  signal: AbortSignal,
  handlers: StreamHandlers,
): Promise<Anthropic.Beta.BetaMessage> {
  const stream = client.beta.messages.stream(
    {
      model: conversation.model,
      max_tokens: MAX_TOKENS,
      system: conversation.system,
      messages,
      // Thinking is always on for current models; "summarized" returns a readable
      // summary of it so the panel can show progress instead of a silent pause.
      thinking: { type: 'adaptive', display: 'summarized' },
      output_config: { effort: conversation.effort },
      betas: [FALLBACK_BETA],
      fallbacks: 'default',
    },
    { signal },
  );

  for await (const event of stream) {
    switch (event.type) {
      case 'message_start':
        handlers.onStart(event.message.model);
        break;
      case 'content_block_start':
        if (event.content_block.type === 'fallback') {
          handlers.onFallback(event.content_block.from.model, event.content_block.to.model);
        }
        break;
      case 'content_block_delta':
        if (event.delta.type === 'thinking_delta') handlers.onThinking(event.delta.thinking);
        else if (event.delta.type === 'text_delta') handlers.onText(event.delta.text);
        break;
    }
  }
  return stream.finalMessage();
}

/**
 * Turns a finished reply into the assistant turn to replay on follow-ups.
 * Thinking blocks are passed back unchanged. After a fallback switched models
 * mid-answer, only the text written before the switch is kept from the earlier
 * attempt, as the API requires; the `fallback` marker itself is dropped.
 */
export function toHistoryContent(message: Anthropic.Beta.BetaMessage): Anthropic.Beta.BetaContentBlockParam[] {
  const blocks = message.content;
  let lastFallback = -1;
  blocks.forEach((block, i) => {
    if (block.type === 'fallback') lastFallback = i;
  });
  // A reply cut off by max_tokens may end inside a thinking block; keep just its text.
  const textOnly = message.stop_reason === 'max_tokens';

  const out: Anthropic.Beta.BetaContentBlockParam[] = [];
  blocks.forEach((block, i) => {
    const beforeSwitch = i < lastFallback;
    if (block.type === 'text') {
      if (block.text) out.push({ type: 'text', text: block.text });
    } else if (block.type === 'thinking' && !beforeSwitch && !textOnly) {
      out.push({ type: 'thinking', thinking: block.thinking, signature: block.signature });
    } else if (block.type === 'redacted_thinking' && !beforeSwitch && !textOnly) {
      out.push({ type: 'redacted_thinking', data: block.data });
    }
  });
  return out.some((block) => block.type === 'text') ? out : [];
}

export async function testApiKey(apiKey: string, model: string): Promise<TestKeyResult> {
  try {
    // Free call: checks the key and that it can use the chosen model, no tokens spent.
    const info = await createClient(apiKey).models.retrieve(model);
    return { ok: true, modelName: info.display_name };
  } catch (err) {
    return { ok: false, message: describeError(err, model).message };
  }
}

export function describeError(err: unknown, model: string): { code: ErrorCode; message: string } {
  if (err instanceof Anthropic.AuthenticationError) {
    return { code: 'auth', message: 'Anthropic rejected your API key. Check it in AnswerKey settings.' };
  }
  if (err instanceof Anthropic.PermissionDeniedError) {
    return { code: 'permission', message: `Your API key isn't allowed to do this: ${apiMessage(err)}` };
  }
  if (err instanceof Anthropic.NotFoundError) {
    return {
      code: 'not_found',
      message: `The model ${model} isn't available to your API key. Pick another model in AnswerKey settings.`,
    };
  }
  if (err instanceof Anthropic.RateLimitError) {
    return { code: 'rate_limit', message: 'You hit your API rate limit. Wait a moment, then retry.' };
  }
  if (err instanceof Anthropic.BadRequestError) {
    return { code: 'bad_request', message: apiMessage(err) };
  }
  if (err instanceof Anthropic.InternalServerError) {
    return err.type === 'overloaded_error' || err.status === 529
      ? { code: 'overloaded', message: 'Claude is overloaded right now. Retry in a moment.' }
      : { code: 'server', message: `The Anthropic API had a problem (${err.status}). Retry in a moment.` };
  }
  // A subclass of APIError in this SDK, so it must be checked before APIError.
  if (err instanceof Anthropic.APIConnectionError) {
    return { code: 'network', message: "Couldn't reach api.anthropic.com. Check your connection, then retry." };
  }
  if (err instanceof Anthropic.APIError) {
    // Errors sent inside an open stream arrive without an HTTP status.
    if (err.type === 'overloaded_error') {
      return { code: 'overloaded', message: 'Claude is overloaded right now. Retry in a moment.' };
    }
    if (err.status === 402 || err.type === 'billing_error') {
      return { code: 'billing', message: apiMessage(err) };
    }
    return { code: 'unknown', message: apiMessage(err) };
  }
  return { code: 'unknown', message: err instanceof Error ? err.message : String(err) };
}

/** The API's own error text, without the SDK's status-code prefix and JSON wrapper. */
function apiMessage(err: InstanceType<typeof Anthropic.APIError>): string {
  const body = err.error as { error?: { message?: unknown } } | undefined;
  const message = body?.error?.message;
  return typeof message === 'string' && message ? message : err.message;
}
