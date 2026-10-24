import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { FieldEncryption } from '@enterprise-lms/security';
import { config } from '../config';
import { prisma } from './prisma';
import { HttpError } from './http';
import { logger } from './logger';

/**
 * The one place the API talks to a language model. Three providers sit behind one call:
 *   ANTHROPIC (Claude, official SDK), GEMINI (Google, generateContent) and XAI (Grok, chat completions).
 * Each organisation can bring its own provider, model and key (TenantAiConfig, set by its administrators);
 * otherwise the platform default from the environment (AI_PROVIDER / AI_API_KEY) applies, if any.
 *
 * Callers get JSON checked against a Zod schema, or an HttpError: 503 when nothing is configured, 502 when
 * the provider fails, times out or answers off-schema, 422 when it declines. Nothing about the person
 * (name, e-mail, id) is ever sent; callers pass only course content and the question being asked.
 */

export const AI_PROVIDERS = ['ANTHROPIC', 'GEMINI', 'XAI'] as const;
export type AiProvider = (typeof AI_PROVIDERS)[number];

/** Shown in the admin screen. Any model id the provider accepts can be typed in; these are suggestions. */
export const PROVIDER_INFO: Record<AiProvider, { label: string; defaultModel: string; suggestedModels: string[]; keyHelp: string }> = {
  ANTHROPIC: {
    label: 'Claude (Anthropic)',
    defaultModel: 'claude-opus-5-5',
    suggestedModels: ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5'],
    keyHelp: 'Create a key at platform.claude.com (starts with sk-ant-).',
  },
  GEMINI: {
    label: 'Gemini (Google)',
    defaultModel: 'gemini-3.5-flash-lite',
    suggestedModels: ['gemini-3.8-flash', 'gemini-3.5-flash-lite'],
    keyHelp: 'Create a key in Google AI Studio.',
  },
  XAI: {
    label: 'Grok (xAI)',
    defaultModel: 'grok-4.7',
    suggestedModels: ['grok-4.7', 'grok-4.20-0309-non-reasoning'],
    keyHelp: 'Create a key at console.x.ai.',
  },
};

export interface AiSettings {
  provider: AiProvider;
  model: string;
  apiKey: string;
  /** Whose key pays for the call. */
  source: 'TENANT' | 'PLATFORM';
}

// --------------------------------------------------------------------------- settings

let cipher: FieldEncryption | null = null;
const crypt = () => (cipher ??= new FieldEncryption(config.PII_ENCRYPTION_KEY));
export const encryptKey = (key: string) => crypt().encrypt(key);
const decryptKey = (stored: string) => crypt().decrypt(stored);

/** "…wXyZ": enough to recognise a key, not enough to use it. */
export const keyHint = (key: string) => `…${key.slice(-4)}`;

export function platformAiSettings(): AiSettings | null {
  if (!config.AI_PROVIDER || !config.AI_API_KEY) return null;
  return {
    provider: config.AI_PROVIDER,
    model: config.AI_MODEL || PROVIDER_INFO[config.AI_PROVIDER].defaultModel,
    apiKey: config.AI_API_KEY,
    source: 'PLATFORM',
  };
}

/**
 * The settings that apply to an organisation: its own when it has saved a key and switched AI on; none when
 * it switched AI off; the platform default otherwise.
 */
export async function resolveAiSettings(tenantId: string): Promise<AiSettings | null> {
  const own = await prisma.tenantAiConfig.findUnique({ where: { tenantId } });
  if (own && !own.enabled) return null;
  if (own?.apiKeyEnc) {
    try {
      return { provider: own.provider as AiProvider, model: own.model, apiKey: decryptKey(own.apiKeyEnc), source: 'TENANT' };
    } catch (err) {
      logger.error({ err, tenantId }, 'stored AI key could not be decrypted (was PII_ENCRYPTION_KEY rotated?)');
      throw new HttpError(503, 'The AI key saved for this organisation cannot be read. An administrator needs to enter it again.');
    }
  }
  return platformAiSettings();
}

// --------------------------------------------------------------------------- generation

export interface AiTurn {
  role: 'user' | 'model';
  text: string;
}

export interface GenerateJsonOptions<T extends z.ZodTypeAny> {
  settings: AiSettings;
  /** Standing instructions: who the model is and what it must not do. */
  system: string;
  /** The conversation, oldest first, starting and ending with a user turn. */
  turns: AiTurn[];
  /** Validates the reply (and enforces lengths and ranges the providers' schema dialects cannot). */
  schema: T;
  /**
   * The reply's shape as plain JSON Schema: every object lists all its properties as required and sets
   * additionalProperties: false; an optional value is `anyOf: [X, { type: 'null' }]`. No numeric or length
   * keywords: not every provider accepts them, and the Zod schema checks them anyway.
   */
  jsonSchema: Record<string, unknown>;
  maxOutputTokens?: number;
  /** Shown in logs, e.g. "tutor". */
  purpose: string;
}

/** What a provider adapter returns: the model's text, plus what the logs need. */
interface RawAnswer {
  text: string;
  /** The provider declined on policy grounds. */
  declined: boolean;
  /** The answer was cut off by the output limit. */
  truncated: boolean;
  inputTokens?: number;
  outputTokens?: number;
}

const unreachable = () => new HttpError(502, 'The AI service did not respond. Try again in a moment.');
const rejected = (status: number) =>
  new HttpError(
    502,
    status === 401 || status === 403
      ? 'The AI service rejected the API key. An administrator should check the AI settings.'
      : status === 429
        ? 'The AI service is busy or out of quota. Try again in a minute.'
        : status === 404
          ? 'The AI service does not know the configured model. An administrator should check the AI settings.'
          : 'The AI service could not answer. Try again in a moment.'
  );

export async function generateJson<T extends z.ZodTypeAny>(opts: GenerateJsonOptions<T>): Promise<z.infer<T>> {
  const started = Date.now();
  const { provider, model } = opts.settings;
  const raw = await ADAPTERS[provider](opts);
  logger.info(
    {
      purpose: opts.purpose,
      provider,
      model,
      source: opts.settings.source,
      ms: Date.now() - started,
      inputTokens: raw.inputTokens,
      outputTokens: raw.outputTokens,
      declined: raw.declined,
      truncated: raw.truncated,
    },
    'AI request'
  );
  if (raw.declined) throw new HttpError(422, 'The AI service declined this request. Rephrase it and try again.');

  let json: unknown;
  try {
    json = JSON.parse(raw.text);
  } catch {
    throw new HttpError(
      502,
      raw.truncated ? 'The AI answer was too long. Ask a narrower question.' : 'The AI service sent an unreadable answer. Try again.'
    );
  }
  const checked = opts.schema.safeParse(json);
  if (!checked.success) {
    logger.warn({ purpose: opts.purpose, provider, issues: checked.error.issues.slice(0, 5) }, 'AI answer did not match the schema');
    throw new HttpError(502, 'The AI service sent an incomplete answer. Try again.');
  }
  return checked.data;
}

// --------------------------------------------------------------------------- Claude

async function anthropic(opts: GenerateJsonOptions<z.ZodTypeAny>): Promise<RawAnswer> {
  const client = new Anthropic({
    apiKey: opts.settings.apiKey,
    baseURL: config.ANTHROPIC_API_URL,
    timeout: config.AI_TIMEOUT_MS,
    maxRetries: 1,
  });
  let message: Anthropic.Beta.BetaMessage;
  try {
    message = await client.beta.messages.create({
      model: opts.settings.model,
      max_tokens: opts.maxOutputTokens ?? 4096,
      system: opts.system,
      messages: opts.turns.map((t) => ({ role: t.role === 'model' ? ('assistant' as const) : ('user' as const), content: t.text })),
      output_config: { format: { type: 'json_schema', schema: opts.jsonSchema } },
      // On a policy decline, let the API re-run the request on the model's default fallback.
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
    });
  } catch (err) {
    if (err instanceof Anthropic.APIConnectionError) throw unreachable();
    if (err instanceof Anthropic.APIError) {
      logger.warn({ status: err.status, provider: 'ANTHROPIC' }, 'AI request rejected');
      throw rejected(err.status ?? 502);
    }
    throw err;
  }
  const text = message.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('');
  return {
    text,
    declined: message.stop_reason === 'refusal',
    truncated: message.stop_reason === 'max_tokens',
    inputTokens: message.usage.input_tokens,
    outputTokens: message.usage.output_tokens,
  };
}

// --------------------------------------------------------------------------- Gemini

/** Gemini's responseSchema is an OpenAPI subset: upper-case types, `nullable` instead of a null branch. */
export function toGeminiSchema(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(toGeminiSchema);
  if (!schema || typeof schema !== 'object') return schema;
  const s = schema as Record<string, unknown>;
  if (Array.isArray(s.anyOf)) {
    const branches = s.anyOf as Record<string, unknown>[];
    const nonNull = branches.filter((b) => b.type !== 'null');
    if (nonNull.length === 1 && nonNull.length < branches.length) {
      return { ...(toGeminiSchema(nonNull[0]) as object), nullable: true };
    }
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(s)) {
    if (k === 'additionalProperties') continue;
    if (k === 'type' && typeof v === 'string') out.type = v.toUpperCase();
    else if (k === 'properties' && v && typeof v === 'object')
      out.properties = Object.fromEntries(Object.entries(v).map(([p, ps]) => [p, toGeminiSchema(ps)]));
    else if (k === 'items' || k === 'anyOf') out[k] = toGeminiSchema(v);
    else out[k] = v;
  }
  return out;
}

const geminiReply = z.object({
  candidates: z
    .array(
      z.object({
        content: z.object({ parts: z.array(z.object({ text: z.string().optional() })).optional() }).optional(),
        finishReason: z.string().optional(),
      })
    )
    .optional(),
  promptFeedback: z.object({ blockReason: z.string().optional() }).optional(),
  usageMetadata: z.object({ promptTokenCount: z.number().optional(), candidatesTokenCount: z.number().optional() }).optional(),
});

async function gemini(opts: GenerateJsonOptions<z.ZodTypeAny>): Promise<RawAnswer> {
  const url = `${config.GEMINI_API_URL.replace(/\/+$/, '')}/models/${encodeURIComponent(opts.settings.model)}:generateContent`;
  const res = await post(
    url,
    { 'x-goog-api-key': opts.settings.apiKey },
    {
      systemInstruction: { parts: [{ text: opts.system }] },
      contents: opts.turns.map((t) => ({ role: t.role, parts: [{ text: t.text }] })),
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: toGeminiSchema(opts.jsonSchema),
        maxOutputTokens: opts.maxOutputTokens ?? 4096,
      },
    }
  );
  const parsed = geminiReply.safeParse(res);
  if (!parsed.success) throw new HttpError(502, 'The AI service sent an unexpected reply');
  const candidate = parsed.data.candidates?.[0];
  return {
    text: candidate?.content?.parts?.map((p) => p.text ?? '').join('') ?? '',
    declined:
      !!parsed.data.promptFeedback?.blockReason || candidate?.finishReason === 'SAFETY' || candidate?.finishReason === 'PROHIBITED_CONTENT',
    truncated: candidate?.finishReason === 'MAX_TOKENS',
    inputTokens: parsed.data.usageMetadata?.promptTokenCount,
    outputTokens: parsed.data.usageMetadata?.candidatesTokenCount,
  };
}

// --------------------------------------------------------------------------- Grok

const chatReply = z.object({
  choices: z.array(
    z.object({
      message: z.object({ content: z.string().nullable().optional(), refusal: z.string().nullable().optional() }),
      finish_reason: z.string().nullable().optional(),
    })
  ),
  usage: z.object({ prompt_tokens: z.number().optional(), completion_tokens: z.number().optional() }).optional(),
});

async function xai(opts: GenerateJsonOptions<z.ZodTypeAny>): Promise<RawAnswer> {
  const res = await post(
    `${config.XAI_API_URL.replace(/\/+$/, '')}/chat/completions`,
    { authorization: `Bearer ${opts.settings.apiKey}` },
    {
      model: opts.settings.model,
      max_tokens: opts.maxOutputTokens ?? 4096,
      messages: [
        { role: 'system', content: opts.system },
        ...opts.turns.map((t) => ({ role: t.role === 'model' ? 'assistant' : 'user', content: t.text })),
      ],
      response_format: { type: 'json_schema', json_schema: { name: 'answer', schema: opts.jsonSchema, strict: true } },
    }
  );
  const parsed = chatReply.safeParse(res);
  if (!parsed.success || parsed.data.choices.length === 0) throw new HttpError(502, 'The AI service sent an unexpected reply');
  const choice = parsed.data.choices[0];
  return {
    text: choice.message.content ?? '',
    declined: !!choice.message.refusal || choice.finish_reason === 'content_filter',
    truncated: choice.finish_reason === 'length',
    inputTokens: parsed.data.usage?.prompt_tokens,
    outputTokens: parsed.data.usage?.completion_tokens,
  };
}

/** JSON POST with the configured timeout. The provider's error body can echo the request, so only the status is logged. */
async function post(url: string, headers: Record<string, string>, body: unknown): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(config.AI_TIMEOUT_MS),
    });
  } catch (err) {
    logger.warn({ err: (err as Error)?.name }, 'AI request failed');
    throw unreachable();
  }
  if (!res.ok) {
    logger.warn({ status: res.status }, 'AI request rejected');
    throw rejected(res.status);
  }
  return res.json().catch(() => null);
}

const ADAPTERS: Record<AiProvider, (opts: GenerateJsonOptions<z.ZodTypeAny>) => Promise<RawAnswer>> = {
  ANTHROPIC: anthropic,
  GEMINI: gemini,
  XAI: xai,
};

// --------------------------------------------------------------------------- helpers

/** Trims text to a character budget, keeping whole lines where it can. */
export function clip(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const nl = cut.lastIndexOf('\n');
  return `${nl > max * 0.8 ? cut.slice(0, nl) : cut}\n[…]`;
}
