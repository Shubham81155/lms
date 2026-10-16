import { z } from 'zod';
import type { ResponseTable } from './types';

// Responses of the AI routes (routes/ai.routes.ts). Checked against the real API by test/ai.integration.test.ts.

export const AiStatus = z.object({
  enabled: z.boolean(),
  /** Why it is off: not on the plan, switched off by an administrator, or no provider key anywhere. */
  reason: z.enum(['NOT_ON_PLAN', 'TURNED_OFF', 'NOT_CONFIGURED']).nullable(),
});
export const TutorTurn = z.object({
  /** Markdown. */
  reply: z.string(),
  practice: z
    .object({ question: z.string(), options: z.array(z.string()), correctIndex: z.number(), explanation: z.string() })
    .nullable(),
  groundedInCourse: z.boolean(),
});
export const CourseOutline = z.object({
  title: z.string(),
  description: z.string(),
  modules: z.array(z.object({ title: z.string(), lessons: z.array(z.object({ title: z.string(), minutes: z.number(), body: z.string() })) })),
});

const Provider = z.enum(['ANTHROPIC', 'GEMINI', 'XAI']);
export const AiSettingsView = z.object({
  provider: Provider.nullable(),
  model: z.string().nullable(),
  enabled: z.boolean(),
  hasKey: z.boolean(),
  /** The last four characters, e.g. "…wXyZ". The key itself is never returned. */
  keyHint: z.string().nullable(),
  updatedAt: z.string().nullable(),
  onPlan: z.boolean(),
  effectiveSource: z.enum(['TENANT', 'PLATFORM']).nullable(),
  platformDefault: z.object({ provider: Provider, model: z.string() }).nullable(),
  providers: z.array(z.object({ id: Provider, label: z.string(), defaultModel: z.string(), suggestedModels: z.array(z.string()), keyHelp: z.string() })),
});
export const AiTestResult = z.object({ ok: z.boolean(), error: z.string().nullable(), provider: Provider.nullable(), model: z.string().nullable(), ms: z.number() });

export const RESPONSES: ResponseTable = {
  'GET /api/v1/ai/settings': { response: { status: 200, schema: z.object({ data: AiSettingsView }) } },
  'PUT /api/v1/ai/settings': { response: { status: 200, schema: z.object({ data: AiSettingsView }) }, errors: [400] },
  'POST /api/v1/ai/settings/test': { response: { status: 200, schema: z.object({ data: AiTestResult }) }, errors: [429] },
  'GET /api/v1/ai/status': { response: { status: 200, schema: z.object({ data: AiStatus }) } },
  'POST /api/v1/ai/tutor': { response: { status: 200, schema: z.object({ data: TutorTurn }) }, errors: [400, 403, 404, 422, 429, 502, 503] },
  'POST /api/v1/ai/course-outline': { response: { status: 200, schema: z.object({ data: CourseOutline }) }, errors: [400, 403, 422, 429, 502, 503] },
};
