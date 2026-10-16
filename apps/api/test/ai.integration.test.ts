import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import http from 'http';
import { AddressInfo } from 'net';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';
import { startTestDatabase, TestDatabase } from '../../../packages/database/test-utils/embedded';

// AI assistance against a real PostgreSQL and one local stand-in that answers like each provider:
// Claude (/v1/messages), Gemini (/v1beta/models/...:generateContent) and Grok (/xai/chat/completions).

const PASSWORD = 'CorrectHorse1!';
const PLATFORM_KEY = 'platform-gemini-key-0123456789';
const CLAUDE_KEY = 'sk-ant-tenant-key-0123456789abcdefWXYZ';
const GROK_KEY = 'xai-tenant-key-0123456789abcdef';
let db: TestDatabase;
let admin: PrismaClient;
let app: import('express').Express;
let config: typeof import('../src/config.js').config;
let R: typeof import('../src/openapi/responses/ai.js').RESPONSES;
let stub: http.Server;

type Provider = 'claude' | 'gemini' | 'grok';
let calls: { provider: Provider; url: string; headers: http.IncomingHttpHeaders; body: any }[] = [];
/** The JSON the "model" answers with, how it finished, or a raw HTTP failure. */
let next: { json?: unknown; finish?: 'stop' | 'refusal' | 'length'; status?: number; raw?: unknown } = {};
const answer = (json: unknown, finish: 'stop' | 'refusal' | 'length' = 'stop') => (next = { json, finish });

function reply(provider: Provider): unknown {
  if (next.raw !== undefined) return next.raw;
  const text = JSON.stringify(next.json);
  const finish = next.finish ?? 'stop';
  if (provider === 'claude') {
    return {
      id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-test',
      content: [{ type: 'text', text }],
      stop_reason: finish === 'refusal' ? 'refusal' : finish === 'length' ? 'max_tokens' : 'end_turn',
      stop_sequence: null, usage: { input_tokens: 10, output_tokens: 5 },
    };
  }
  if (provider === 'gemini') {
    return { candidates: [{ content: { parts: [{ text }] }, finishReason: finish === 'refusal' ? 'SAFETY' : finish === 'length' ? 'MAX_TOKENS' : 'STOP' }], usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 } };
  }
  return { choices: [{ message: { content: text, refusal: finish === 'refusal' ? 'no' : null }, finish_reason: finish === 'length' ? 'length' : 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 5 } };
}

beforeAll(async () => {
  stub = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      const url = req.url ?? '';
      const provider: Provider = url.startsWith('/v1/messages') ? 'claude' : url.startsWith('/v1beta/') ? 'gemini' : 'grok';
      calls.push({ provider, url, headers: req.headers, body: JSON.parse(raw) });
      res.statusCode = next.status ?? 200;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify(next.status && next.status >= 400 ? { error: { message: 'nope' } } : reply(provider)));
    });
  });
  await new Promise<void>((r) => stub.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${(stub.address() as AddressInfo).port}`;
  process.env.AI_PROVIDER = 'GEMINI';
  process.env.AI_API_KEY = PLATFORM_KEY;
  process.env.AI_MODEL = 'gemini-test';
  process.env.ANTHROPIC_API_URL = base;
  process.env.GEMINI_API_URL = `${base}/v1beta`;
  process.env.XAI_API_URL = `${base}/xai`;

  db = await startTestDatabase();
  admin = new PrismaClient({ datasourceUrl: db.adminUrl });
  await admin.tenant.create({ data: { id: 't-h', slug: 'harvard', name: 'harvard', tier: 'ENTERPRISE' } });
  await admin.tenant.create({ data: { id: 't-s', slug: 'small', name: 'small', tier: 'STARTER' } });
  const user = (id: string, tenantId: string, slug: string, role: any) =>
    admin.user.create({ data: { id, tenantId, email: `${id}@x.edu`, firstName: id, lastName: 'Lovelace', role, passwordHash: bcrypt.hashSync(`${PASSWORD}-${slug}`, 4), emailVerified: true } });
  await user('admin', 't-h', 'harvard', 'TENANT_ADMIN');
  await user('teacher', 't-h', 'harvard', 'INSTRUCTOR');
  for (const s of ['s1', 's2', 's3']) await user(s, 't-h', 'harvard', 'STUDENT');
  await user('small-student', 't-s', 'small', 'STUDENT');
  await admin.course.create({ data: { id: 'c1', tenantId: 't-h', code: 'BIO-101', title: 'Cell Biology', description: 'Cells and how they work.', status: 'PUBLISHED' } });
  await admin.courseInstructor.create({ data: { courseId: 'c1', userId: 'teacher', isPrimary: true } });
  await admin.module.create({ data: { id: 'm1', courseId: 'c1', title: 'Membranes', lessons: { create: [{ title: 'Osmosis', bodyContent: 'Water moves across a semi-permeable membrane toward higher solute concentration.' }] } } });
  await admin.enrollment.create({ data: { tenantId: 't-h', courseId: 'c1', userId: 's1', status: 'IN_PROGRESS' } });

  process.env.DATABASE_URL = db.appUrl;
  app = (await import('../src/server.js')).app;
  ({ config } = await import('../src/config.js'));
  ({ RESPONSES: R } = await import('../src/openapi/responses/ai.js'));
}, 240_000);

afterAll(async () => {
  stub?.close();
  await admin?.$disconnect();
  await db?.stop();
}, 60_000);

beforeEach(() => {
  calls = [];
  next = {};
  config.AI_API_KEY = PLATFORM_KEY;
});

async function as(who: string, tenant = 'harvard') {
  const agent = request.agent(app);
  const res = await agent.post('/api/v1/auth/login').set('x-tenant-id', tenant).send({ email: `${who}@x.edu`, password: `${PASSWORD}-${tenant}` });
  expect(res.status, `login as ${who}`).toBe(200);
  return agent;
}

const covered = new Set<string>();
const check = (key: string, res: { status: number; body: any }) => {
  expect(res.status, `${key}: ${JSON.stringify(res.body)}`).toBe(200);
  const parsed = R[key].response!.schema!.safeParse(res.body);
  expect(parsed.success, `${key}: ${JSON.stringify(parsed.success ? null : parsed.error)}`).toBe(true);
  covered.add(key);
  return res.body.data;
};

const tutorReply = { reply: 'Osmosis is the movement of water (lesson "Osmosis").', practice: { question: 'Water moves toward…', options: ['lower solute', 'higher solute', 'neither'], correctIndex: 1, explanation: 'Toward higher solute concentration.' } };
const ask = async (who = 's1', body: Record<string, unknown> = { message: 'hi' }) => (await as(who)).post('/api/v1/ai/tutor').send(body);

describe('status', () => {
  it('says whether AI can be used, and why not', async () => {
    expect(check('GET /api/v1/ai/status', await (await as('s1')).get('/api/v1/ai/status'))).toEqual({ enabled: true, reason: null });
    expect(check('GET /api/v1/ai/status', await (await as('small-student', 'small')).get('/api/v1/ai/status'))).toEqual({ enabled: false, reason: 'NOT_ON_PLAN' });
    config.AI_API_KEY = undefined;
    expect(check('GET /api/v1/ai/status', await (await as('s1')).get('/api/v1/ai/status'))).toEqual({ enabled: false, reason: 'NOT_CONFIGURED' });
    expect((await request(app).get('/api/v1/ai/status')).status).toBe(401);
  });
});

describe('tutor on the platform default (Gemini)', () => {
  it('answers from the course material and never sends who is asking', async () => {
    answer(tutorReply);
    const data = check('POST /api/v1/ai/tutor', await ask('s1', { courseId: 'c1', message: 'What is osmosis?', wantPractice: true }));
    expect(data).toMatchObject({ reply: tutorReply.reply, practice: tutorReply.practice, groundedInCourse: true });

    expect(calls).toHaveLength(1);
    const call = calls[0];
    expect(call.url).toBe('/v1beta/models/gemini-test:generateContent');
    expect(call.headers['x-goog-api-key']).toBe(PLATFORM_KEY);
    expect(call.body.systemInstruction.parts[0].text).toContain('Academic integrity');
    // The provider-neutral schema is translated into Gemini's dialect.
    expect(call.body.generationConfig.responseSchema.type).toBe('OBJECT');
    expect(call.body.generationConfig.responseSchema.properties.practice).toMatchObject({ type: 'OBJECT', nullable: true });
    expect(JSON.stringify(call.body.generationConfig.responseSchema)).not.toContain('additionalProperties');
    const prompt = call.body.contents[0].parts[0].text as string;
    expect(prompt).toContain('<course_material>');
    expect(prompt).toContain('semi-permeable membrane');
    expect(prompt).toContain('What is osmosis?');
    expect(JSON.stringify(call.body)).not.toMatch(/s1@x\.edu|Lovelace/);
  });

  it('carries the conversation, dropping a leading tutor greeting', async () => {
    answer({ reply: 'Yes.', practice: null });
    const res = await ask('s1', {
      message: 'And diffusion?',
      history: [
        { role: 'tutor', text: 'Hi, what are we studying?' },
        { role: 'user', text: 'Osmosis' },
        { role: 'tutor', text: 'Osmosis is…' },
      ],
    });
    expect(check('POST /api/v1/ai/tutor', res)).toMatchObject({ practice: null, groundedInCourse: false });
    expect(calls[0].body.contents.map((c: any) => c.role)).toEqual(['user', 'model', 'user']);
    expect(calls[0].body.contents[2].parts[0].text).toContain('And diffusion?');
  });

  it('only reads courses the person can open', async () => {
    answer(tutorReply);
    expect((await ask('s2', { courseId: 'c1', message: 'hi' })).status).toBe(403);
    expect((await ask('s1', { courseId: 'nope', message: 'hi' })).status).toBe(404);
    expect(calls).toHaveLength(0);
  });

  it('validates the request', async () => {
    expect((await ask('s1', { message: '' })).status).toBe(400);
    expect((await ask('s1', { message: 'x'.repeat(2001) })).status).toBe(400);
    expect((await ask('s1', { message: 'hi', history: Array(21).fill({ role: 'user', text: 'a' }) })).status).toBe(400);
  });

  it('drops a practice question whose answer index is out of range', async () => {
    answer({ reply: 'ok', practice: { ...tutorReply.practice, correctIndex: 4 } });
    expect(check('POST /api/v1/ai/tutor', await ask()).practice).toBeNull();
  });

  it('turns provider failures into clear errors', async () => {
    next = { status: 429 };
    const res = await ask();
    expect(res.status).toBe(502);
    expect(res.body.error).toContain('busy');

    next = { status: 401 };
    expect((await ask()).body.error).toContain('rejected the API key');

    answer({ wrong: 'shape' });
    expect((await ask()).status).toBe(502);

    next = { raw: { candidates: [{ content: { parts: [{ text: 'not json' }] }, finishReason: 'STOP' }] } };
    expect((await ask()).status).toBe(502);

    next = { raw: { promptFeedback: { blockReason: 'SAFETY' } } };
    expect((await ask()).status).toBe(422);

    answer(tutorReply, 'refusal');
    expect((await ask()).status).toBe(422);
  });

  it('is off without any key, and off for organisations without the feature', async () => {
    config.AI_API_KEY = undefined;
    expect((await ask()).status).toBe(503);
    config.AI_API_KEY = PLATFORM_KEY;
    expect((await (await as('small-student', 'small')).post('/api/v1/ai/tutor').send({ message: 'hi' })).status).toBe(403);
    expect(calls).toHaveLength(0);
  });

  it('limits how many requests a person can make per hour', async () => {
    answer({ reply: 'ok', practice: null });
    const before = config.AI_REQUESTS_PER_HOUR;
    config.AI_REQUESTS_PER_HOUR = 2;
    try {
      const s3 = await as('s3');
      expect((await s3.post('/api/v1/ai/tutor').send({ message: 'a' })).status).toBe(200);
      expect((await s3.post('/api/v1/ai/tutor').send({ message: 'b' })).status).toBe(200);
      const third = await s3.post('/api/v1/ai/tutor').send({ message: 'c' });
      expect(third.status).toBe(429);
      expect(third.body.error).toContain('hourly limit');
    } finally {
      config.AI_REQUESTS_PER_HOUR = before;
    }
  });
});

describe("the organisation's own provider", () => {
  it('is managed by administrators only', async () => {
    expect((await (await as('teacher')).get('/api/v1/ai/settings')).status).toBe(403);
    expect((await (await as('s1')).put('/api/v1/ai/settings').send({ provider: 'GEMINI' })).status).toBe(403);
    const view = check('GET /api/v1/ai/settings', await (await as('admin')).get('/api/v1/ai/settings'));
    expect(view).toMatchObject({ provider: null, hasKey: false, onPlan: true, effectiveSource: 'PLATFORM', platformDefault: { provider: 'GEMINI', model: 'gemini-test' } });
    expect(view.providers.map((p: any) => p.id)).toEqual(['ANTHROPIC', 'GEMINI', 'XAI']);
  });

  it('saves a Claude key encrypted, never shows it again, and uses it', async () => {
    const a = await as('admin');
    const put = check('PUT /api/v1/ai/settings', await a.put('/api/v1/ai/settings').send({ provider: 'ANTHROPIC', apiKey: CLAUDE_KEY }));
    expect(put).toMatchObject({ provider: 'ANTHROPIC', model: 'claude-opus-5-5', hasKey: true, keyHint: '…WXYZ', effectiveSource: 'TENANT' });
    expect(JSON.stringify(put)).not.toContain(CLAUDE_KEY);
    expect(JSON.stringify((await a.get('/api/v1/ai/settings')).body)).not.toContain(CLAUDE_KEY);

    const row = await admin.tenantAiConfig.findUniqueOrThrow({ where: { tenantId: 't-h' } });
    expect(row.apiKeyEnc).toBeTruthy();
    expect(row.apiKeyEnc).not.toContain(CLAUDE_KEY);
    const audit = await admin.auditLog.findFirstOrThrow({ where: { action: 'AI_SETTINGS_UPDATED' }, orderBy: { createdAt: 'desc' } });
    expect(JSON.stringify(audit)).not.toContain(CLAUDE_KEY);
    expect((audit.diffJson as any).key).toBe('replaced');

    answer(tutorReply);
    check('POST /api/v1/ai/tutor', await ask('s1', { courseId: 'c1', message: 'What is osmosis?' }));
    const call = calls[0];
    expect(call.provider).toBe('claude');
    expect(call.headers['x-api-key']).toBe(CLAUDE_KEY);
    expect(String(call.headers['anthropic-beta'])).toContain('server-side-fallback-2026-07-01');
    expect(call.body).toMatchObject({ model: 'claude-opus-5-5', fallbacks: 'default', output_config: { format: { type: 'json_schema' } } });
    expect(call.body.output_config.format.schema.properties.practice.anyOf).toHaveLength(2);
    expect(call.body.system).toContain('Academic integrity');
    expect(call.body.messages[0]).toMatchObject({ role: 'user' });
    expect(call.body.messages[0].content).toContain('semi-permeable membrane');

    answer(tutorReply, 'refusal');
    expect((await ask()).status).toBe(422);
  });

  it('needs the new provider’s key when switching, then uses Grok', async () => {
    const a = await as('admin');
    expect((await a.put('/api/v1/ai/settings').send({ provider: 'XAI' })).status).toBe(400);
    expect((await a.put('/api/v1/ai/settings').send({ provider: 'XAI', model: 'grok 4; drop', apiKey: GROK_KEY })).status).toBe(400);
    expect((await a.put('/api/v1/ai/settings').send({ provider: 'XAI', apiKey: 'short' })).status).toBe(400);
    const put = check('PUT /api/v1/ai/settings', await a.put('/api/v1/ai/settings').send({ provider: 'XAI', model: 'grok-4.7', apiKey: GROK_KEY }));
    expect(put).toMatchObject({ provider: 'XAI', model: 'grok-4.7', effectiveSource: 'TENANT' });

    answer({ reply: 'ok', practice: null });
    check('POST /api/v1/ai/tutor', await ask());
    const call = calls[0];
    expect(call.url).toBe('/xai/chat/completions');
    expect(call.headers.authorization).toBe(`Bearer ${GROK_KEY}`);
    expect(call.body.response_format).toMatchObject({ type: 'json_schema', json_schema: { strict: true } });
    expect(call.body.messages[0]).toMatchObject({ role: 'system' });
  });

  it('tests the settings that apply', async () => {
    const a = await as('admin');
    answer({ ok: true });
    expect(check('POST /api/v1/ai/settings/test', await a.post('/api/v1/ai/settings/test'))).toMatchObject({ ok: true, error: null, provider: 'XAI', model: 'grok-4.7' });
    next = { status: 401 };
    const bad = check('POST /api/v1/ai/settings/test', await a.post('/api/v1/ai/settings/test'));
    expect(bad).toMatchObject({ ok: false, provider: 'XAI' });
    expect(bad.error).toContain('rejected the API key');
  });

  it('can be switched off, and removing the key falls back to the platform default', async () => {
    const a = await as('admin');
    check('PUT /api/v1/ai/settings', await a.put('/api/v1/ai/settings').send({ provider: 'XAI', enabled: false }));
    expect(check('GET /api/v1/ai/status', await (await as('s1')).get('/api/v1/ai/status'))).toEqual({ enabled: false, reason: 'TURNED_OFF' });
    expect((await ask()).status).toBe(503);

    const back = check('PUT /api/v1/ai/settings', await a.put('/api/v1/ai/settings').send({ provider: 'XAI', apiKey: null, enabled: true }));
    expect(back).toMatchObject({ hasKey: false, keyHint: null, effectiveSource: 'PLATFORM' });
    answer({ reply: 'ok', practice: null });
    check('POST /api/v1/ai/tutor', await ask());
    expect(calls[0].provider).toBe('gemini');
  });

});

describe('course outline', () => {
  const outline = {
    title: 'Introduction to Cell Biology',
    description: 'A first course on cells.',
    modules: [{ title: 'Membranes', lessons: [{ title: 'Osmosis', minutes: 30, body: '- Explain osmosis' }] }],
  };

  it('drafts an outline for instructors', async () => {
    answer(outline);
    const res = await (await as('teacher')).post('/api/v1/ai/course-outline').send({ topic: 'Cell biology', audience: 'first-year undergraduates', moduleCount: 1 });
    expect(check('POST /api/v1/ai/course-outline', res)).toEqual(outline);
    const prompt = calls[0].body.contents[0].parts[0].text as string;
    expect(prompt).toContain('Topic: Cell biology');
    expect(prompt).toContain('Audience: first-year undergraduates');
    expect(await admin.course.count()).toBe(1); // nothing saved
  });

  it('rejects an outline outside the allowed ranges', async () => {
    answer({ ...outline, modules: [{ title: 'M', lessons: [{ title: 'L', minutes: 9999, body: '' }] }] });
    expect((await (await as('teacher')).post('/api/v1/ai/course-outline').send({ topic: 'Cell biology' })).status).toBe(502);
  });

  it('is for course leads only, and validates input', async () => {
    expect((await (await as('s1')).post('/api/v1/ai/course-outline').send({ topic: 'Cell biology' })).status).toBe(403);
    expect((await (await as('teacher')).post('/api/v1/ai/course-outline').send({ topic: 'x' })).status).toBe(400);
    expect((await (await as('teacher')).post('/api/v1/ai/course-outline').send({ topic: 'Cells', moduleCount: 13 })).status).toBe(400);
  });
});

describe('API description', () => {
  it('every described AI response was checked', () => {
    expect(Object.keys(R).filter((k) => !covered.has(k))).toEqual([]);
  });
});
