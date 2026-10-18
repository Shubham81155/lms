// Pure quiz-taking logic: answer handling, the countdown, and how integrity events are rated.
// The API grades; this only prepares what is sent and what is shown while the attempt is open.

export interface QuizOption {
  id?: string;
  text: string;
}

export interface QuizQuestionView {
  id: string;
  questionText: string;
  questionType: string;
  points: number;
  options?: QuizOption[] | null;
}

export type AnswerValue = string | string[];

/** True/false questions may arrive without options; the API accepts "true" / "false" as the answer. */
export function choicesFor(q: QuizQuestionView): { id: string; text: string }[] {
  if (Array.isArray(q.options) && q.options.length > 0) {
    return q.options.map((o, i) => ({ id: String(o.id ?? i), text: o.text }));
  }
  return q.questionType === "TRUE_FALSE"
    ? [
        { id: "true", text: "True" },
        { id: "false", text: "False" },
      ]
    : [];
}

export const isAnswered = (v: AnswerValue | undefined): boolean =>
  Array.isArray(v) ? v.length > 0 : typeof v === "string" && v.trim() !== "";

/** Only answered questions are sent; a blank one is simply absent, which the API grades as wrong. */
export function buildAnswers(questions: QuizQuestionView[], values: Record<string, AnswerValue>): Record<string, AnswerValue> {
  const out: Record<string, AnswerValue> = {};
  for (const q of questions) {
    const v = values[q.id];
    if (isAnswered(v)) out[q.id] = Array.isArray(v) ? v : (v as string).trim();
  }
  return out;
}

export const unanswered = (questions: QuizQuestionView[], values: Record<string, AnswerValue>) =>
  questions.filter((q) => !isAnswered(values[q.id]));

/** Whole seconds left, never negative; null for an untimed attempt. */
export function remainingSeconds(expiresAt: string | null, now: number = Date.now()): number | null {
  if (!expiresAt) return null;
  return Math.max(0, Math.ceil((new Date(expiresAt).getTime() - now) / 1000));
}

export function formatClock(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  const mm = String(m).padStart(h > 0 ? 2 : 1, "0");
  return `${h > 0 ? `${h}:` : ""}${mm}:${String(s).padStart(2, "0")}`;
}

export type IntegrityKind =
  | "TAB_SWITCH" | "FULLSCREEN_EXIT" | "COPY_PASTE"
  // From the camera and microphone (hooks/useMediaProctor.ts).
  | "FACE_NOT_DETECTED" | "MULTIPLE_FACES" | "AUDIO_SPIKE" | "CAMERA_STOPPED" | "MICROPHONE_STOPPED";

/**
 * How serious each kind of event is. They are signals for a human reviewer, not verdicts: the server
 * only flags an attempt after several of them, and nothing here penalises the learner.
 */
export const SEVERITY: Record<IntegrityKind, "LOW" | "MEDIUM" | "HIGH"> = {
  TAB_SWITCH: "MEDIUM",
  FULLSCREEN_EXIT: "MEDIUM",
  COPY_PASTE: "LOW",
  FACE_NOT_DETECTED: "MEDIUM",
  MULTIPLE_FACES: "MEDIUM",
  AUDIO_SPIKE: "LOW",
  CAMERA_STOPPED: "MEDIUM",
  MICROPHONE_STOPPED: "MEDIUM",
};

export const KIND_LABEL: Record<IntegrityKind, string> = {
  TAB_SWITCH: "You left the exam tab",
  FULLSCREEN_EXIT: "You left full-screen mode",
  COPY_PASTE: "Copy and paste is recorded",
  FACE_NOT_DETECTED: "Your face is not visible to the camera",
  MULTIPLE_FACES: "More than one person is visible to the camera",
  AUDIO_SPIKE: "Talking or other sound was picked up",
  CAMERA_STOPPED: "Your camera was turned off",
  MICROPHONE_STOPPED: "Your microphone was turned off",
};
