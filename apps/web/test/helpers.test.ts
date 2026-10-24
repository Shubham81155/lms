import { describe, it, expect } from 'vitest';
import { appealDaysLeft, draftProblem, rubricDraft } from '../src/lib/forms';
import { timeAgo, toItem } from '../src/hooks/useNotifications';
import { countdown } from '../src/hooks/useEngagement';

const crit = [
  { id: 'a', name: 'Thesis', maxPoints: 10 },
  { id: 'b', name: 'Evidence', maxPoints: 15 },
];

describe('rubricDraft', () => {
  it('totals valid scores', () => {
    expect(rubricDraft(crit, { a: '7.5', b: '15' })).toEqual({ total: 22.5, problem: null });
  });
  it('names the first problem, mirroring the API rules', () => {
    expect(rubricDraft(crit, { a: '7' }).problem).toMatch(/Evidence/);
    expect(rubricDraft(crit, { a: '', b: '1' }).problem).toMatch(/Thesis/);
    expect(rubricDraft(crit, { a: '11', b: '1' }).problem).toMatch(/between 0 and 10/);
    expect(rubricDraft(crit, { a: '-1', b: '1' }).problem).toMatch(/between/);
    expect(rubricDraft(crit, { a: 'abc', b: '1' }).problem).toMatch(/between/);
  });
  it('avoids floating point noise', () => {
    expect(
      rubricDraft(
        [
          { id: 'a', name: 'A', maxPoints: 1 },
          { id: 'b', name: 'B', maxPoints: 1 },
        ],
        { a: '0.1', b: '0.2' }
      ).total
    ).toBe(0.3);
  });
});

describe('appealDaysLeft', () => {
  const now = Date.parse('2026-10-20T12:00:00Z');
  it('counts whole days remaining in the 14-day window', () => {
    expect(appealDaysLeft('2026-10-20T12:00:00Z', now)).toBe(14);
    expect(appealDaysLeft('2026-10-10T12:00:00Z', now)).toBe(4);
    expect(appealDaysLeft('2026-10-06T13:00:00Z', now)).toBe(1);
  });
  it('is zero once the window has closed', () => {
    expect(appealDaysLeft('2026-10-06T12:00:00Z', now)).toBe(0);
    expect(appealDaysLeft('2026-09-01T00:00:00Z', now)).toBe(0);
  });
});

describe('draftProblem (question bank)', () => {
  const mc = (options: { text: string; isCorrect: boolean }[]) => ({ type: 'MULTIPLE_CHOICE', text: 'Q?', options, answer: '' });
  it('requires text, two options and exactly one correct for single-choice', () => {
    expect(draftProblem({ ...mc([]), text: ' ' })).toMatch(/Write the question/);
    expect(draftProblem(mc([{ text: 'a', isCorrect: true }]))).toMatch(/two options/);
    expect(
      draftProblem(
        mc([
          { text: 'a', isCorrect: true },
          { text: 'b', isCorrect: true },
        ])
      )
    ).toMatch(/exactly one/);
    expect(
      draftProblem(
        mc([
          { text: 'a', isCorrect: false },
          { text: 'b', isCorrect: false },
        ])
      )
    ).toMatch(/exactly one/);
    expect(
      draftProblem(
        mc([
          { text: 'a', isCorrect: true },
          { text: 'b', isCorrect: false },
        ])
      )
    ).toBeNull();
  });
  it('ignores blank option rows', () => {
    expect(
      draftProblem(
        mc([
          { text: 'a', isCorrect: true },
          { text: '  ', isCorrect: false },
          { text: 'b', isCorrect: false },
        ])
      )
    ).toBeNull();
  });
  it('allows several correct answers for multi-select but at least one', () => {
    const ms = (c1: boolean, c2: boolean) => ({
      type: 'MULTI_SELECT',
      text: 'Q?',
      answer: '',
      options: [
        { text: 'a', isCorrect: c1 },
        { text: 'b', isCorrect: c2 },
      ],
    });
    expect(draftProblem(ms(true, true))).toBeNull();
    expect(draftProblem(ms(false, false))).toMatch(/at least one/);
  });
  it('needs an answer key for typed answers but not for essays', () => {
    expect(draftProblem({ type: 'SHORT_ANSWER', text: 'Q?', options: [], answer: '' })).toMatch(/correct answer/);
    expect(draftProblem({ type: 'SHORT_ANSWER', text: 'Q?', options: [], answer: 'x' })).toBeNull();
    expect(draftProblem({ type: 'ESSAY', text: 'Q?', options: [], answer: '' })).toBeNull();
  });
});

describe('notification and calendar formatting', () => {
  const now = Date.parse('2026-10-20T12:00:00Z');
  it('timeAgo', () => {
    expect(timeAgo('2026-10-20T11:59:50Z', now)).toBe('just now');
    expect(timeAgo('2026-10-20T11:30:00Z', now)).toBe('30 min ago');
    expect(timeAgo('2026-10-20T07:00:00Z', now)).toBe('5 h ago');
    expect(timeAgo('2026-10-17T12:00:00Z', now)).toBe('3 d ago');
    expect(timeAgo('2026-10-21T12:00:00Z', now)).toBe('just now'); // clock skew never shows a negative
  });
  it('countdown', () => {
    expect(countdown('2026-10-20T11:00:00Z', now)).toBe('In progress or past');
    expect(countdown('2026-10-20T12:30:00Z', now)).toBe('In 30 min');
    expect(countdown('2026-10-20T20:00:00Z', now)).toBe('In 8 h');
    expect(countdown('2026-10-25T12:00:00Z', now)).toBe('In 5 days');
  });
  it('maps server notifications to display items', () => {
    const base = { id: '1', body: null, link: null, readAt: null, createdAt: '2026-10-20T12:00:00Z' };
    expect(toItem({ ...base, category: 'EXAM', title: 't' })).toMatchObject({ type: 'EXAM', isRead: false, message: '' });
    expect(toItem({ ...base, category: 'GRADE', title: 't', readAt: 'x', link: '/a' })).toMatchObject({
      type: 'ACADEMIC',
      isRead: true,
      actionUrl: '/a',
      actionLabel: 'Open',
    });
    expect(toItem({ ...base, category: 'WHO_KNOWS', title: 't' }).type).toBe('ANNOUNCEMENT');
  });
});

import { buildAnswers, choicesFor, formatClock, isAnswered, remainingSeconds, unanswered, SEVERITY } from '../src/lib/quiz';

describe('quiz helpers', () => {
  const qs = [
    {
      id: 'q1',
      questionText: 'A',
      questionType: 'MULTIPLE_CHOICE',
      points: 1,
      options: [
        { id: 'a', text: 'x' },
        { id: 'b', text: 'y' },
      ],
    },
    { id: 'q2', questionText: 'B', questionType: 'TRUE_FALSE', points: 1, options: null },
    { id: 'q3', questionText: 'C', questionType: 'MULTI_SELECT', points: 1, options: [{ id: 'a', text: 'x' }] },
    { id: 'q4', questionText: 'D', questionType: 'SHORT_ANSWER', points: 1 },
  ];

  it('offers True/False when a true/false question has no options', () => {
    expect(choicesFor(qs[1])).toEqual([
      { id: 'true', text: 'True' },
      { id: 'false', text: 'False' },
    ]);
    expect(choicesFor(qs[0]).map((c) => c.id)).toEqual(['a', 'b']);
    expect(choicesFor(qs[3])).toEqual([]);
  });

  it('treats blank text and empty selections as unanswered', () => {
    expect(isAnswered(undefined)).toBe(false);
    expect(isAnswered('  ')).toBe(false);
    expect(isAnswered([])).toBe(false);
    expect(isAnswered('a')).toBe(true);
    expect(isAnswered(['a'])).toBe(true);
  });

  it('sends only answered questions, trimmed', () => {
    expect(buildAnswers(qs, { q1: 'a', q2: '', q3: [], q4: '  42 ', ghost: 'x' })).toEqual({ q1: 'a', q4: '42' });
    expect(unanswered(qs, { q1: 'a', q3: ['a'] }).map((q) => q.id)).toEqual(['q2', 'q4']);
  });

  it('counts down without going negative, and not at all when untimed', () => {
    const now = Date.parse('2026-10-20T12:00:00Z');
    expect(remainingSeconds('2026-10-20T12:01:30Z', now)).toBe(90);
    expect(remainingSeconds('2026-10-20T12:00:00.400Z', now)).toBe(1);
    expect(remainingSeconds('2026-10-20T11:59:00Z', now)).toBe(0);
    expect(remainingSeconds(null, now)).toBeNull();
  });

  it('formats the clock', () => {
    expect(formatClock(0)).toBe('0:00');
    expect(formatClock(75)).toBe('1:15');
    expect(formatClock(3600)).toBe('1:00:00');
    expect(formatClock(3725)).toBe('1:02:05');
  });

  it('rates integrity events as signals, never as the top severity', () => {
    expect(SEVERITY.TAB_SWITCH).toBe('MEDIUM');
    expect(SEVERITY.COPY_PASTE).toBe('LOW');
    expect(Object.values(SEVERITY)).not.toContain('HIGH');
  });
});

import { expandHex, isHexColor, isHttpUrlOrEmpty, isValidCode, normaliseCode } from '../src/lib/forms';

describe('branding and hierarchy form rules', () => {
  it('validates hex colours like the API', () => {
    for (const ok of ['#fff', '#A51C30', ' #a51c30 ']) expect(isHexColor(ok), ok).toBe(true);
    for (const bad of ['fff', '#ffff', '#gggggg', 'red', '', '#12345']) expect(isHexColor(bad), bad).toBe(false);
    expect(expandHex('#abc')).toBe('#aabbcc');
    expect(expandHex('#A51C30')).toBe('#A51C30');
  });
  it('accepts empty or http(s) URLs only', () => {
    expect(isHttpUrlOrEmpty('')).toBe(true);
    expect(isHttpUrlOrEmpty(' https://example.com/logo.png ')).toBe(true);
    for (const bad of ['javascript:alert(1)', 'data:text/html,x', 'ftp://x.example', 'not a url'])
      expect(isHttpUrlOrEmpty(bad), bad).toBe(false);
  });
  it('normalises and validates campus codes', () => {
    expect(normaliseCode(' cam-01 ')).toBe('CAM-01');
    for (const ok of ['CS', 'cam-01', 'A1']) expect(isValidCode(ok), ok).toBe(true);
    for (const bad of ['A', '-AB', 'bad code', 'x'.repeat(21), '']) expect(isValidCode(bad), bad).toBe(false);
  });
});

import { daysUntil } from '../src/lib/forms';

describe('daysUntil', () => {
  const now = Date.parse('2026-10-20T12:00:00Z');
  it('counts whole days to an expiry, negative once past, null when there is none', () => {
    expect(daysUntil('2026-11-19T12:00:00Z', now)).toBe(30);
    expect(daysUntil('2026-10-20T13:00:00Z', now)).toBe(0);
    expect(daysUntil('2026-10-19T12:00:00Z', now)).toBe(-1);
    expect(daysUntil(null, now)).toBeNull();
  });
});

import { decodeChat, encodeChat, fromLocalInput, scheduleProblem, startsIn, toLocalInput, MAX_CHAT_LENGTH } from '../src/lib/live';

describe('live class helpers', () => {
  const now = Date.parse('2026-10-20T12:00:00Z');

  it('describes when a class starts', () => {
    expect(startsIn('2026-10-20T12:00:20Z', now)).toBe('now');
    expect(startsIn('2026-10-20T12:10:00Z', now)).toBe('in 10 min');
    expect(startsIn('2026-10-20T15:00:00Z', now)).toBe('in 3 h');
    expect(startsIn('2026-10-23T12:00:00Z', now)).toBe('in 3 days');
    expect(startsIn('2026-10-20T11:30:00Z', now)).toBe('30 min ago');
  });

  it('round-trips a datetime-local value through the local zone', () => {
    const d = new Date(2026, 9, 20, 14, 5); // local time
    expect(toLocalInput(d)).toBe('2026-10-20T14:05');
    expect(new Date(fromLocalInput('2026-10-20T14:05')!).getTime()).toBe(d.getTime());
    expect(fromLocalInput('')).toBeNull();
    expect(fromLocalInput('not a date')).toBeNull();
  });

  it('validates the schedule form like the API', () => {
    const ok = { title: 'Raft', when: toLocalInput(new Date(now + 3_600_000)), durationMins: 60 };
    expect(scheduleProblem(ok, now)).toBeNull();
    expect(scheduleProblem({ ...ok, title: ' x ' }, now)).toMatch(/title/);
    expect(scheduleProblem({ ...ok, when: '' }, now)).toMatch(/date and time/);
    expect(scheduleProblem({ ...ok, when: toLocalInput(new Date(now - 3_600_000)) }, now)).toMatch(/past/);
    expect(scheduleProblem({ ...ok, durationMins: 4 }, now)).toMatch(/Duration/);
    expect(scheduleProblem({ ...ok, durationMins: 481 }, now)).toMatch(/Duration/);
    expect(scheduleProblem({ ...ok, durationMins: 30.5 }, now)).toMatch(/Duration/);
  });

  it('encodes chat with a length cap and decodes only well-formed messages', () => {
    expect(encodeChat('   ')).toBeNull();
    const bytes = encodeChat('x'.repeat(MAX_CHAT_LENGTH + 50))!;
    expect(JSON.parse(new TextDecoder().decode(bytes)).text).toHaveLength(MAX_CHAT_LENGTH);
    expect(decodeChat(encodeChat(' hello ')!, 'Ada', 5)).toEqual({ from: 'Ada', text: 'hello', at: 5 });
    const raw = (v: unknown) => new TextEncoder().encode(typeof v === 'string' ? v : JSON.stringify(v));
    for (const bad of ['not json', { t: 'other', text: 'x' }, { t: 'chat' }, { t: 'chat', text: 5 }, { t: 'chat', text: '  ' }, null]) {
      expect(decodeChat(raw(bad), 'Ada'), JSON.stringify(bad)).toBeNull();
    }
    expect(decodeChat(raw({ t: 'chat', text: '<script>alert(1)</script>' }), 'x'.repeat(300))!.from).toHaveLength(100);
  });
});
