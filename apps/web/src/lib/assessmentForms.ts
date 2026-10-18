// Pure validation for the staff assessment and calendar screens. It mirrors the limits the API
// enforces so people see the problem before the round trip; the API stays authoritative.

export interface QuizSettings {
  title: string;
  timed: boolean;
  minutes: string;
  attempts: string;
  passing: string;
  randomize: boolean;
  proctoring: boolean;
  /** With proctoring: watch the camera / microphone in the learner's browser. */
  camera: boolean;
  microphone: boolean;
  /** datetime-local values; empty means no limit. */
  opens: string;
  closes: string;
  review: "SCORE_ONLY" | "RESPONSES" | "ANSWERS";
}

/** Why a quiz's settings cannot be saved yet, or null. */
export function quizSettingsProblem(s: QuizSettings): string | null {
  if (!s.title.trim()) return "Give the quiz a title.";
  const attempts = Number(s.attempts);
  if (!Number.isInteger(attempts) || attempts < 1 || attempts > 100) return "Attempts must be a whole number from 1 to 100.";
  const passing = Number(s.passing);
  if (!Number.isFinite(passing) || passing < 0 || passing > 100) return "Passing score must be between 0 and 100.";
  if (s.timed) {
    const mins = Number(s.minutes);
    if (!Number.isInteger(mins) || mins < 1 || mins > 1440) return "Time limit must be a whole number of minutes from 1 to 1440.";
  }
  if (s.opens && s.closes && new Date(s.closes) <= new Date(s.opens)) return "The quiz must open before it closes.";
  return null;
}

export interface AssignmentDraft {
  title: string;
  instructions: string;
  maxPoints: string;
  due: string;
  /** datetime-local; empty means late work is always accepted. */
  lateUntil: string;
}

/** Why an assignment cannot be saved yet, or null. */
export function assignmentProblem(d: AssignmentDraft): string | null {
  if (!d.title.trim()) return "Give the assignment a title.";
  if (!d.instructions.trim()) return "Write the instructions.";
  const pts = Number(d.maxPoints);
  if (!Number.isFinite(pts) || pts <= 0 || pts > 10000) return "Points must be more than 0 and at most 10,000.";
  if (d.due && Number.isNaN(new Date(d.due).getTime())) return "The due date is not valid.";
  if (d.lateUntil && !d.due) return "Set a due date before a late-work cutoff.";
  if (d.lateUntil && new Date(d.lateUntil) < new Date(d.due)) return "Late work must be accepted until a time after the due date.";
  return null;
}

export interface EventDraft {
  title: string;
  start: string;
  end: string;
}

/** Why a calendar event cannot be saved yet, or null. */
export function eventProblem(d: EventDraft): string | null {
  if (!d.title.trim()) return "Give the event a title.";
  if (!d.start || !d.end) return "Choose when it starts and ends.";
  if (new Date(d.end) < new Date(d.start)) return "It cannot end before it starts.";
  return null;
}

/** An ISO instant as the local "YYYY-MM-DDTHH:mm" a datetime-local input wants. */
export const toLocalInput = (iso: string | null) => {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
