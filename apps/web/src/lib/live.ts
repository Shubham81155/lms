// Pure helpers for the live-class screens (no DOM, so they can be unit tested).

import type { ProblemText } from '@/lib/forms';

export type SessionStatus = 'SCHEDULED' | 'LIVE' | 'ENDED' | 'CANCELLED';

export interface LiveSessionView {
  id: string;
  courseId: string;
  title: string;
  description: string | null;
  scheduledAt: string;
  durationMins: number;
  status: SessionStatus;
  allowStudentVideo: boolean;
  startedAt: string | null;
  endedAt: string | null;
  attendeeCount?: number;
  attended?: boolean;
  course?: { id: string; code: string; title: string };
}

/** The relative-time phrases: translation key and English template (`{count}` is filled in). */
export const RELATIVE_TIMES = {
  now: { key: 'teach.live.rel.now', en: 'now' },
  inMin: { key: 'teach.live.rel.inMin', en: 'in {count} min' },
  inHours: { key: 'teach.live.rel.inHours', en: 'in {count} h' },
  inDays: { key: 'teach.live.rel.inDays', en: 'in {count} days' },
  agoMin: { key: 'teach.live.rel.agoMin', en: '{count} min ago' },
  agoHours: { key: 'teach.live.rel.agoHours', en: '{count} h ago' },
  agoDays: { key: 'teach.live.rel.agoDays', en: '{count} days ago' },
} as const satisfies Record<string, ProblemText>;

/** Which phrase describes a start time, and the number in it (absent for "now"). */
export function startsInParts(scheduledAt: string, now: number = Date.now()): { key: string; en: string; count?: number } {
  const ms = new Date(scheduledAt).getTime() - now;
  const min = Math.round(Math.abs(ms) / 60_000);
  if (min < 1) return RELATIVE_TIMES.now;
  const [unit, count] =
    min < 60
      ? (['Min', min] as const)
      : min < 48 * 60
        ? (['Hours', Math.round(min / 60)] as const)
        : (['Days', Math.round(min / 1440)] as const);
  return { ...RELATIVE_TIMES[`${ms > 0 ? 'in' : 'ago'}${unit}` as 'inMin'], count };
}

/** "in 5 min", "in 3 h", "in 2 days", "now", "5 min ago" ... relative to `now`. */
export function startsIn(scheduledAt: string, now: number = Date.now()): string {
  const p = startsInParts(scheduledAt, now);
  return p.en.replace('{count}', String(p.count));
}

/** Value for <input type="datetime-local"> in the user's own time zone, e.g. "2026-10-20T14:30". */
export function toLocalInput(date: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}T${p(date.getHours())}:${p(date.getMinutes())}`;
}

/** The ISO instant for a datetime-local string, or null when it is empty or not a real date. */
export function fromLocalInput(value: string): string | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** Schedule-form messages: translation key and English text from one place. */
export const SCHEDULE_PROBLEMS = {
  title: { key: 'teach.live.problem.title', en: 'Give the class a title.' },
  when: { key: 'teach.live.problem.when', en: 'Choose a date and time.' },
  past: { key: 'teach.live.problem.past', en: 'That time is in the past.' },
  duration: { key: 'teach.live.problem.duration', en: 'Duration must be between 5 and 480 minutes.' },
} as const satisfies Record<string, ProblemText>;

/** The translation key of a message scheduleProblem returned, or undefined. */
export const scheduleProblemKey = (msg: string | null): string | undefined =>
  msg ? Object.values(SCHEDULE_PROBLEMS).find((p) => p.en === msg)?.key : undefined;

/** Whether a schedule form can be submitted, with the reason when it cannot. */
/** `allowPast` is for changing other details of a class whose start time is left as it was. */
export function scheduleProblem(
  f: { title: string; when: string; durationMins: number },
  now: number = Date.now(),
  allowPast = false
): string | null {
  if (f.title.trim().length < 2) return SCHEDULE_PROBLEMS.title.en;
  const iso = fromLocalInput(f.when);
  if (!iso) return SCHEDULE_PROBLEMS.when.en;
  if (!allowPast && new Date(iso).getTime() < now - 5 * 60_000) return SCHEDULE_PROBLEMS.past.en;
  if (!Number.isInteger(f.durationMins) || f.durationMins < 5 || f.durationMins > 480) return SCHEDULE_PROBLEMS.duration.en;
  return null;
}

/** A chat message is sent as JSON over the data channel; this is the only shape we accept back. */
export interface ChatMessage {
  from: string;
  text: string;
  at: number;
}

export const MAX_CHAT_LENGTH = 500;

export function encodeChat(text: string): ReturnType<TextEncoder['encode']> | null {
  const t = text.trim().slice(0, MAX_CHAT_LENGTH);
  return t ? new TextEncoder().encode(JSON.stringify({ t: 'chat', text: t })) : null;
}

/** Parses an incoming data packet defensively: anything unexpected is dropped, nothing is trusted. */
export function decodeChat(payload: Uint8Array, from: string, at: number = Date.now()): ChatMessage | null {
  try {
    const data = JSON.parse(new TextDecoder().decode(payload));
    if (data && data.t === 'chat' && typeof data.text === 'string') {
      const text = data.text.trim().slice(0, MAX_CHAT_LENGTH);
      return text ? { from: from.slice(0, 100), text, at } : null;
    }
  } catch {
    /* not ours */
  }
  return null;
}
