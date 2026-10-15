// Pure helpers for the live-class screens (no DOM, so they can be unit tested).

export type SessionStatus = "SCHEDULED" | "LIVE" | "ENDED" | "CANCELLED";

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

/** "in 5 min", "in 3 h", "in 2 days", "now", "5 min ago" ... relative to `now`. */
export function startsIn(scheduledAt: string, now: number = Date.now()): string {
  const ms = new Date(scheduledAt).getTime() - now;
  const abs = Math.abs(ms);
  const min = Math.round(abs / 60_000);
  if (min < 1) return "now";
  const text = min < 60 ? `${min} min` : min < 48 * 60 ? `${Math.round(min / 60)} h` : `${Math.round(min / 1440)} days`;
  return ms > 0 ? `in ${text}` : `${text} ago`;
}

/** Value for <input type="datetime-local"> in the user's own time zone, e.g. "2026-10-20T14:30". */
export function toLocalInput(date: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}T${p(date.getHours())}:${p(date.getMinutes())}`;
}

/** The ISO instant for a datetime-local string, or null when it is empty or not a real date. */
export function fromLocalInput(value: string): string | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** Whether a schedule form can be submitted, with the reason when it cannot. */
/** `allowPast` is for changing other details of a class whose start time is left as it was. */
export function scheduleProblem(f: { title: string; when: string; durationMins: number }, now: number = Date.now(), allowPast = false): string | null {
  if (f.title.trim().length < 2) return "Give the class a title.";
  const iso = fromLocalInput(f.when);
  if (!iso) return "Choose a date and time.";
  if (!allowPast && new Date(iso).getTime() < now - 5 * 60_000) return "That time is in the past.";
  if (!Number.isInteger(f.durationMins) || f.durationMins < 5 || f.durationMins > 480) return "Duration must be between 5 and 480 minutes.";
  return null;
}

/** A chat message is sent as JSON over the data channel; this is the only shape we accept back. */
export interface ChatMessage {
  from: string;
  text: string;
  at: number;
}

export const MAX_CHAT_LENGTH = 500;

export function encodeChat(text: string): ReturnType<TextEncoder["encode"]> | null {
  const t = text.trim().slice(0, MAX_CHAT_LENGTH);
  return t ? new TextEncoder().encode(JSON.stringify({ t: "chat", text: t })) : null;
}

/** Parses an incoming data packet defensively: anything unexpected is dropped, nothing is trusted. */
export function decodeChat(payload: Uint8Array, from: string, at: number = Date.now()): ChatMessage | null {
  try {
    const data = JSON.parse(new TextDecoder().decode(payload));
    if (data && data.t === "chat" && typeof data.text === "string") {
      const text = data.text.trim().slice(0, MAX_CHAT_LENGTH);
      return text ? { from: from.slice(0, 100), text, at } : null;
    }
  } catch {
    /* not ours */
  }
  return null;
}
