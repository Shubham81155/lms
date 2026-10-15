"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, Clock, ShieldAlert, X } from "lucide-react";
import { api } from "@/lib/api";
import { errorMessage, useAction } from "@/hooks/useApiData";
import { Banner } from "@/components/admin/IdentityPanels";
import {
  AnswerValue, IntegrityKind, KIND_LABEL, QuizQuestionView, SEVERITY,
  buildAnswers, choicesFor, formatClock, isAnswered, remainingSeconds, unanswered,
} from "@/lib/quiz";

interface QuizView {
  id: string;
  title: string;
  timeLimitMins: number | null;
  maxAttempts: number;
  passingPercent: number;
  requireProctoring: boolean;
  attemptsRemaining: number;
  course?: { code: string; title: string };
  questions: QuizQuestionView[];
}
interface Attempt { submissionId: string; expiresAt: string | null; resumed: boolean }
interface Result { score: number; maxScore: number; percentage: number; passed: boolean; attemptsRemaining: number; pendingManualGrading: boolean }

const btn = "px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded-xl text-xs font-bold transition-all";
const ghost = "px-3 py-1.5 bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-300 rounded-lg text-[11px] font-semibold transition-colors disabled:opacity-50";
const field = "w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-blue-500";

/**
 * Takes a real quiz from the API: starts an attempt (which starts the clock), keeps the countdown,
 * and submits for grading. For proctored quizzes it reports tab switches, leaving full screen and
 * copy/paste to the proctoring endpoint as the attempt runs. Those are signals for a reviewer.
 */
export const QuizTaker: React.FC<{ quizId: string; onClose: () => void; onFinished?: (r: Result) => void }> = ({ quizId, onClose, onFinished }) => {
  const [quiz, setQuiz] = useState<QuizView | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState<Attempt | null>(null);
  const [values, setValues] = useState<Record<string, AnswerValue>>({});
  const [index, setIndex] = useState(0);
  const [left, setLeft] = useState<number | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [events, setEvents] = useState(0);
  const { busy, error, run, clearError } = useAction();

  // Refs let the long-lived event listeners see current values without being re-registered.
  const attemptRef = useRef<Attempt | null>(null);
  const valuesRef = useRef(values);
  valuesRef.current = values;
  const submittedRef = useRef(false);
  const autoTried = useRef(false);
  const lastEvent = useRef<Record<string, number>>({});

  useEffect(() => {
    let alive = true;
    api
      .get<{ data: QuizView }>(`/api/v1/quizzes/${quizId}`)
      .then((r) => alive && setQuiz(r.data))
      .catch((e) => alive && setLoadError(errorMessage(e, "Could not load this quiz.")));
    return () => {
      alive = false;
    };
  }, [quizId]);

  const submit = useCallback(
    (auto = false) =>
      run(async () => {
        if (!quiz || submittedRef.current) return;
        submittedRef.current = true;
        try {
          const r = await api.post<{ data: Result }>(`/api/v1/quizzes/${quiz.id}/submit`, { answers: buildAnswers(quiz.questions, valuesRef.current) });
          attemptRef.current = null;
          setResult(r.data);
          if (auto) setNotice("Time ran out, so your answers were submitted automatically.");
          onFinished?.(r.data);
          if (document.fullscreenElement) document.exitFullscreen().catch(() => undefined);
        } catch (e) {
          submittedRef.current = false; // allow a retry
          throw e;
        }
      }),
    [quiz, run, onFinished]
  );

  // Countdown. When it reaches zero the attempt is submitted with what has been answered.
  useEffect(() => {
    if (!attempt || result) return;
    const tick = () => {
      const s = remainingSeconds(attempt.expiresAt);
      setLeft(s);
      // Once: if the server refuses (e.g. long past the limit) do not retry every second.
      if (s === 0 && !autoTried.current) {
        autoTried.current = true;
        submit(true);
      }
    };
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [attempt, result, submit]);

  // Integrity events, only while a proctored attempt is open.
  const report = useCallback((kind: IntegrityKind) => {
    const a = attemptRef.current;
    if (!a) return;
    const now = Date.now();
    if (now - (lastEvent.current[kind] ?? 0) < 1500) return; // one physical action can fire several events
    lastEvent.current[kind] = now;
    setEvents((n) => n + 1);
    setNotice(KIND_LABEL[kind] + ". This is recorded for your instructor.");
    api.post("/api/v1/proctoring/events", { submissionId: a.submissionId, eventType: kind, severity: SEVERITY[kind] }).catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!attempt || !quiz?.requireProctoring || result) return;
    const onVisibility = () => document.hidden && report("TAB_SWITCH");
    const onFullscreen = () => !document.fullscreenElement && report("FULLSCREEN_EXIT");
    const onClipboard = () => report("COPY_PASTE");
    document.addEventListener("visibilitychange", onVisibility);
    document.addEventListener("fullscreenchange", onFullscreen);
    document.addEventListener("copy", onClipboard);
    document.addEventListener("paste", onClipboard);
    document.addEventListener("cut", onClipboard);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      document.removeEventListener("fullscreenchange", onFullscreen);
      document.removeEventListener("copy", onClipboard);
      document.removeEventListener("paste", onClipboard);
      document.removeEventListener("cut", onClipboard);
    };
  }, [attempt, quiz?.requireProctoring, result, report]);

  const start = () =>
    run(async () => {
      if (!quiz) return;
      if (quiz.requireProctoring) await document.documentElement.requestFullscreen?.().catch(() => undefined); // needs this click
      const r = await api.post<{ data: Attempt }>(`/api/v1/quizzes/${quiz.id}/start`, {});
      attemptRef.current = r.data;
      setAttempt(r.data);
    });

  const close = () => {
    if (attempt && !result && !window.confirm("Leave this exam? Your attempt stays open and the clock keeps running. You can come back and continue.")) return;
    if (document.fullscreenElement) document.exitFullscreen().catch(() => undefined);
    onClose();
  };

  const q = quiz?.questions[index];
  const missing = quiz ? unanswered(quiz.questions, values) : [];
  const set = (id: string, v: AnswerValue) => {
    clearError();
    setValues((p) => ({ ...p, [id]: v }));
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/90 backdrop-blur-md flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label="Quiz">
      <div className="bg-slate-900 border border-slate-800 rounded-3xl w-full max-w-3xl max-h-[92vh] flex flex-col overflow-hidden shadow-2xl">
        <div className="bg-slate-950 border-b border-slate-800 px-6 py-4 flex items-center justify-between gap-4">
          <div>
            <h3 className="font-bold text-base text-white">{quiz?.title ?? "Quiz"}</h3>
            {quiz?.course && <p className="text-xs text-slate-400">{quiz.course.code} · {quiz.course.title}</p>}
          </div>
          <div className="flex items-center gap-3">
            {attempt && !result && left !== null && (
              <span className={`flex items-center gap-1.5 text-xs font-mono font-bold px-3 py-1 rounded-full border ${left <= 60 ? "text-rose-300 bg-rose-950 border-rose-800" : "text-amber-300 bg-amber-950/60 border-amber-800"}`} aria-live={left <= 60 ? "polite" : "off"}>
                <Clock className="h-3.5 w-3.5" />
                {formatClock(left)}
              </span>
            )}
            <button onClick={close} aria-label="Close" className="p-1 rounded-xl hover:bg-slate-800 text-slate-400 hover:text-white"><X className="h-5 w-5" /></button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          {loadError && <Banner kind="error">{loadError}</Banner>}
          {error && <Banner kind="error">{error}</Banner>}
          {!quiz && !loadError && <div className="text-xs text-slate-500">Loading…</div>}

          {/* Intro */}
          {quiz && !attempt && !result && (
            <div className="space-y-4">
              <ul className="text-xs text-slate-300 space-y-1.5 list-disc pl-5">
                <li>{quiz.questions.length} question{quiz.questions.length === 1 ? "" : "s"}, {quiz.passingPercent}% to pass.</li>
                <li>{quiz.timeLimitMins ? `${quiz.timeLimitMins} minutes. The clock starts when you press Start and does not stop if you leave.` : "No time limit."}</li>
                <li>{quiz.attemptsRemaining} attempt{quiz.attemptsRemaining === 1 ? "" : "s"} remaining out of {quiz.maxAttempts}.</li>
              </ul>
              {quiz.requireProctoring && (
                <div className="p-4 rounded-2xl border border-rose-800/70 bg-rose-950/30 text-xs text-rose-200 space-y-1">
                  <div className="flex items-center gap-2 font-bold"><ShieldAlert className="h-4 w-4" /> This exam is monitored</div>
                  <p>Switching tabs, leaving full-screen mode and copy/paste are recorded and shown to your instructor, who decides whether anything needs review. The exam opens full screen.</p>
                </div>
              )}
              {quiz.attemptsRemaining === 0 ? (
                <Banner kind="error">You have used all your attempts.</Banner>
              ) : (
                <button className={btn} disabled={busy || quiz.questions.length === 0} onClick={start}>{busy ? "Starting…" : "Start"}</button>
              )}
            </div>
          )}

          {/* Taking */}
          {quiz && attempt && !result && q && (
            <div className="space-y-4">
              {notice && <div role="status" className="p-3 rounded-xl border border-amber-800 bg-amber-950/40 text-xs text-amber-200 flex items-start gap-2"><AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />{notice}</div>}
              {quiz.requireProctoring && !document.fullscreenElement && (
                <button className={ghost} onClick={() => document.documentElement.requestFullscreen?.().catch(() => undefined)}>Return to full screen</button>
              )}
              <div className="flex items-center justify-between text-[11px] text-slate-500">
                <span>Question {index + 1} of {quiz.questions.length}</span>
                <span>{q.points} point{q.points === 1 ? "" : "s"}</span>
              </div>
              <p className="text-sm text-white whitespace-pre-wrap">{q.questionText}</p>

              {["MULTIPLE_CHOICE", "TRUE_FALSE"].includes(q.questionType) && (
                <fieldset className="space-y-2">
                  <legend className="sr-only">Choose one</legend>
                  {choicesFor(q).map((c) => (
                    <label key={c.id} className={`flex items-center gap-3 p-3 rounded-xl border text-xs cursor-pointer ${values[q.id] === c.id ? "border-blue-500 bg-blue-950/30 text-white" : "border-slate-800 bg-slate-950 text-slate-300 hover:border-slate-700"}`}>
                      <input type="radio" name={q.id} checked={values[q.id] === c.id} onChange={() => set(q.id, c.id)} />
                      {c.text}
                    </label>
                  ))}
                </fieldset>
              )}
              {q.questionType === "MULTI_SELECT" && (
                <fieldset className="space-y-2">
                  <legend className="text-[11px] text-slate-500 mb-1">Select all that apply</legend>
                  {choicesFor(q).map((c) => {
                    const picked = (Array.isArray(values[q.id]) ? (values[q.id] as string[]) : []).includes(c.id);
                    return (
                      <label key={c.id} className={`flex items-center gap-3 p-3 rounded-xl border text-xs cursor-pointer ${picked ? "border-blue-500 bg-blue-950/30 text-white" : "border-slate-800 bg-slate-950 text-slate-300 hover:border-slate-700"}`}>
                        <input type="checkbox" checked={picked} onChange={(e) => { const cur = Array.isArray(values[q.id]) ? (values[q.id] as string[]) : []; set(q.id, e.target.checked ? [...cur, c.id] : cur.filter((x) => x !== c.id)); }} />
                        {c.text}
                      </label>
                    );
                  })}
                </fieldset>
              )}
              {["SHORT_ANSWER", "FORMULA_CALCULATED"].includes(q.questionType) && (
                <input className={field} aria-label="Your answer" value={(values[q.id] as string) ?? ""} onChange={(e) => set(q.id, e.target.value)} placeholder={q.questionType === "FORMULA_CALCULATED" ? "Enter a number" : "Your answer"} />
              )}
              {["ESSAY", "CODE_SANDBOX"].includes(q.questionType) && (
                <textarea className={`${field} ${q.questionType === "CODE_SANDBOX" ? "font-mono" : ""}`} rows={q.questionType === "CODE_SANDBOX" ? 10 : 7} aria-label="Your answer" value={(values[q.id] as string) ?? ""} onChange={(e) => set(q.id, e.target.value)} />
              )}

              <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
                <div className="flex gap-2">
                  <button className={ghost} disabled={index === 0} onClick={() => setIndex((i) => i - 1)}>Previous</button>
                  <button className={ghost} disabled={index === quiz.questions.length - 1} onClick={() => setIndex((i) => i + 1)}>Next</button>
                </div>
                <div className="flex flex-wrap gap-1" aria-label="Question navigator">
                  {quiz.questions.map((x, i) => (
                    <button key={x.id} onClick={() => setIndex(i)} aria-label={`Question ${i + 1}${isAnswered(values[x.id]) ? ", answered" : ""}`} className={`h-6 w-6 rounded-md text-[10px] font-bold border ${i === index ? "border-blue-500 text-white" : isAnswered(values[x.id]) ? "bg-emerald-950 text-emerald-300 border-emerald-800" : "bg-slate-950 text-slate-500 border-slate-800"}`}>{i + 1}</button>
                  ))}
                </div>
              </div>

              <div className="border-t border-slate-800 pt-4 flex items-center justify-between gap-3">
                <span className="text-[11px] text-slate-500">{missing.length === 0 ? "All questions answered." : `${missing.length} unanswered.`}{quiz.requireProctoring && events > 0 ? ` ${events} activity event${events === 1 ? "" : "s"} recorded.` : ""}</span>
                <button
                  className={btn}
                  disabled={busy}
                  onClick={() => {
                    if (missing.length > 0 && !window.confirm(`${missing.length} question(s) are unanswered. Submit anyway?`)) return;
                    submit();
                  }}
                >
                  {busy ? "Submitting…" : "Submit answers"}
                </button>
              </div>
            </div>
          )}

          {/* Result */}
          {result && (
            <div className="space-y-4 text-center py-6">
              {notice && <Banner kind="ok">{notice}</Banner>}
              <CheckCircle2 className={`h-12 w-12 mx-auto ${result.pendingManualGrading ? "text-amber-400" : result.passed ? "text-emerald-400" : "text-rose-400"}`} />
              <div className="text-3xl font-extrabold text-white">{result.percentage}%</div>
              <p className="text-xs text-slate-400">{result.score} / {result.maxScore} points</p>
              <p className="text-sm text-slate-200">
                {result.pendingManualGrading ? "Submitted. Some answers need a person to grade them, so the final result will follow." : result.passed ? "You passed." : "You did not reach the passing mark."}
              </p>
              {result.attemptsRemaining > 0 && !result.passed && <p className="text-[11px] text-slate-500">{result.attemptsRemaining} attempt{result.attemptsRemaining === 1 ? "" : "s"} remaining.</p>}
              <button className={btn} onClick={onClose}>Done</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
