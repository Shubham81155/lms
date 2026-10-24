import type { formsEn } from './h-forms.en';

// हिन्दी संदेश for shared helpers (forms), spread into hi.ts.
export const formsHi: Record<keyof typeof formsEn, string> = {
  'fm.rubric.score': '"{name}" का स्कोर भरें।',
  'fm.rubric.range': '"{name}" का स्कोर 0 से {max} के बीच होना चाहिए।',
};
