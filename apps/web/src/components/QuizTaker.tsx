'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AttemptReview } from './AttemptReview';
import { AlertTriangle, Camera, CheckCircle2, Clock, Mic, ShieldAlert, X } from 'lucide-react';
import { api } from '@/lib/api';
import { errorMessage, useAction } from '@/hooks/useApiData';
import { useMediaProctor } from '@/hooks/useMediaProctor';
import { Banner } from '@/components/admin/IdentityPanels';
import {
  AnswerValue,
  IntegrityKind,
  KIND_LABEL,
  QuizQuestionView,
  SEVERITY,
  buildAnswers,
  choicesFor,
  formatClock,
  isAnswered,
  remainingSeconds,
  unanswered,
} from '@/lib/quiz';

interface QuizView {
  id: string;
  title: string;
  timeLimitMins: number | null;
  maxAttempts: number;
  passingPercent: number;
  requireProctoring: boolean;
  /** With requireProctoring: watched in this browser; only events are sent. */
  proctorCamera?: boolean;
  proctorMicrophone?: boolean;
  attemptsRemaining: number;
  course?: { code: string; title: string };
  questions: QuizQuestionView[];
}
interface Attempt {
  submissionId: string;
  expiresAt: string | null;
  resumed: boolean;
}
interface Result {
  submissionId: string;
  score: number;
  maxScore: number;
  percentage: number;
  passed: boolean;
  attemptsRemaining: number;
  pendingManualGrading: boolean;
}

const btn = 'px-4 py-2 bg-brand hover:bg-brand-hover disabled:opacity-50 text-on-brand rounded-xl text-xs font-bold transition-all';
const ghost =
  'px-3 py-1.5 bg-surface hover:bg-raised border border-line text-ink rounded-lg text-[11px] font-semibold transition-colors disabled:opacity-50';
const field = 'w-full bg-canvas border border-line rounded-xl px-3 py-2 text-xs text-ink focus:outline-none focus:border-brand';

/**
 * Takes a real quiz from the API: starts an attempt (which starts the clock), keeps the countdown,
 * and submits for grading. For proctored quizzes it reports tab switches, leaving full screen and
 * copy/paste to the proctoring endpoint as the attempt runs, and, when the quiz asks for them, what the
 * camera and microphone pick up (a missing face, a second face, sustained sound). Those are signals for a
 * reviewer; no image or sound leaves the browser.
 */
export const QuizTaker: React.FC<{ quizId: string; onClose: () => void; onFinished?: (r: Result) => void }> = ({
  quizId,
  onClose,
  onFinished,
}) => {
  const [quiz, setQuiz] = useState<QuizView | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState<Attempt | null>(null);
  const [values, setValues] = useState<Record<string, AnswerValue>>({});
  const [index, setIndex] = useState(0);
  const [left, setLeft] = useState<number | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [events, setEvents] = useState(0);
  const [showReview, setShowReview] = useState(false);
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
      .catch((e) => alive && setLoadError(errorMessage(e, 'Could not load this quiz.')));
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
          const r = await api.post<{ data: Result }>(`/api/v1/quizzes/${quiz.id}/submit`, {
            answers: buildAnswers(quiz.questions, valuesRef.current),
          });
          attemptRef.current = null;
          setResult(r.data);
          if (auto) setNotice('Time ran out, so your answers were submitted automatically.');
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
    setNotice(KIND_LABEL[kind] + '. This is recorded for your instructor.');
    api
      .post('/api/v1/proctoring/events', { submissionId: a.submissionId, eventType: kind, severity: SEVERITY[kind] })
      .catch(() => undefined);
  }, []);

  const media = useMediaProctor({
    camera: !!quiz?.requireProctoring && !!quiz.proctorCamera,
    microphone: !!quiz?.requireProctoring && !!quiz.proctorMicrophone,
    active: !!attempt && !result,
    onEvent: report,
  });
  const stopMedia = media.stop;
  useEffect(() => {
    if (result) stopMedia();
  }, [result, stopMedia]);

  useEffect(() => {
    if (!attempt || !quiz?.requireProctoring || result) return;
    const onVisibility = () => document.hidden && report('TAB_SWITCH');
    const onFullscreen = () => !document.fullscreenElement && report('FULLSCREEN_EXIT');
    const onClipboard = () => report('COPY_PASTE');
    document.addEventListener('visibilitychange', onVisibility);
    document.addEventListener('fullscreenchange', onFullscreen);
    document.addEventListener('copy', onClipboard);
    document.addEventListener('paste', onClipboard);
    document.addEventListener('cut', onClipboard);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      document.removeEventListener('fullscreenchange', onFullscreen);
      document.removeEventListener('copy', onClipboard);
      document.removeEventListener('paste', onClipboard);
      document.removeEventListener('cut', onClipboard);
    };
  }, [attempt, quiz?.requireProctoring, result, report]);

  const start = () =>
    run(async () => {
      if (!quiz) return;
      if (quiz.requireProctoring) await document.documentElement.requestFullscreen?.().catch(() => undefined); // needs this click
      // The camera and microphone must be on before the clock starts.
      try {
        await media.start();
      } catch (e) {
        if (document.fullscreenElement) document.exitFullscreen().catch(() => undefined);
        throw e;
      }
      const r = await api.post<{ data: Attempt }>(`/api/v1/quizzes/${quiz.id}/start`, {});
      attemptRef.current = r.data;
      setAttempt(r.data);
    });

  const close = () => {
    if (
      attempt &&
      !result &&
      !window.confirm('Leave this exam? Your attempt stays open and the clock keeps running. You can come back and continue.')
    )
      return;
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
    <div
      className="fixed inset-0 z-50 bg-canvas/90 backdrop-blur-md flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Quiz"
    >
      <div className="bg-surface border border-line rounded-3xl w-full max-w-3xl max-h-[92vh] flex flex-col overflow-hidden shadow-2xl">
        <div className="bg-canvas border-b border-line px-6 py-4 flex items-center justify-between gap-4">
          <div>
            <h3 className="font-bold text-base text-ink">{quiz?.title ?? 'Quiz'}</h3>
            {quiz?.course && (
              <p className="text-xs text-ink-muted">
                {quiz.course.code} · {quiz.course.title}
              </p>
            )}
          </div>
          <div className="flex items-center gap-3">
            {attempt && !result && left !== null && (
              <span
                className={`flex items-center gap-1.5 text-xs font-mono font-bold px-3 py-1 rounded-full border ${left <= 60 ? 'text-danger bg-danger/10 border-danger/30' : 'text-accent bg-accent/10 border-accent/30'}`}
                aria-live={left <= 60 ? 'polite' : 'off'}
              >
                <Clock className="h-3.5 w-3.5" />
                {formatClock(left)}
              </span>
            )}
            <button onClick={close} aria-label="Close" className="p-1 rounded-xl hover:bg-raised text-ink-muted hover:text-ink">
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          {loadError && <Banner kind="error">{loadError}</Banner>}
          {error && <Banner kind="error">{error}</Banner>}
          {!quiz && !loadError && <div className="text-xs text-ink-subtle">Loading…</div>}

          {/* Intro */}
          {quiz && !attempt && !result && (
            <div className="space-y-4">
              <ul className="text-xs text-ink space-y-1.5 list-disc pl-5">
                <li>
                  {quiz.questions.length} question{quiz.questions.length === 1 ? '' : 's'}, {quiz.passingPercent}% to pass.
                </li>
                <li>
                  {quiz.timeLimitMins
                    ? `${quiz.timeLimitMins} minutes. The clock starts when you press Start and does not stop if you leave.`
                    : 'No time limit.'}
                </li>
                <li>
                  {quiz.attemptsRemaining} attempt{quiz.attemptsRemaining === 1 ? '' : 's'} remaining out of {quiz.maxAttempts}.
                </li>
              </ul>
              {quiz.requireProctoring && (
                <div className="p-4 rounded-2xl border border-danger/30 bg-danger/10 text-xs text-danger space-y-1">
                  <div className="flex items-center gap-2 font-bold">
                    <ShieldAlert className="h-4 w-4" /> This exam is monitored
                  </div>
                  <p>
                    Switching tabs, leaving full-screen mode and copy/paste are recorded and shown to your instructor, who decides whether
                    anything needs review. The exam opens full screen.
                  </p>
                  {media.needed && (
                    <p>
                      This exam also uses your{' '}
                      {quiz.proctorCamera && quiz.proctorMicrophone
                        ? 'camera and microphone'
                        : quiz.proctorCamera
                          ? 'camera'
                          : 'microphone'}
                      .{quiz.proctorCamera ? ' It notes when your face is out of view or more than one person is visible.' : ''}
                      {quiz.proctorMicrophone ? ' It notes sustained talking or other sound.' : ''}{' '}
                      <strong>This is checked on your own device: no picture, video or sound is recorded or sent</strong>, only a note of
                      what was noticed and when. Your browser will ask for permission when you press Start.
                    </p>
                  )}
                </div>
              )}
              {quiz.attemptsRemaining === 0 ? (
                <Banner kind="error">You have used all your attempts.</Banner>
              ) : (
                <button className={btn} disabled={busy || quiz.questions.length === 0} onClick={start}>
                  {busy ? 'Starting…' : 'Start'}
                </button>
              )}
            </div>
          )}

          {/* Taking */}
          {quiz && attempt && !result && q && (
            <div className="space-y-4">
              {notice && (
                <div
                  role="status"
                  className="p-3 rounded-xl border border-accent/30 bg-accent/10 text-xs text-accent flex items-start gap-2"
                >
                  <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                  {notice}
                </div>
              )}
              {quiz.requireProctoring && !document.fullscreenElement && (
                <button className={ghost} onClick={() => document.documentElement.requestFullscreen?.().catch(() => undefined)}>
                  Return to full screen
                </button>
              )}
              {media.needed && (
                <div className="flex items-center gap-3 p-2 rounded-2xl border border-line bg-canvas">
                  {quiz.proctorCamera && (
                    // Shown to the learner only (mirrored, like a mirror); it is never uploaded.
                    <video
                      ref={media.videoRef}
                      muted
                      playsInline
                      aria-label="Your camera"
                      className="h-16 w-24 rounded-xl object-cover bg-black -scale-x-100"
                    />
                  )}
                  <div className="text-[11px] text-ink-muted space-y-0.5">
                    <div className="flex items-center gap-3 font-semibold text-ink">
                      {quiz.proctorCamera && (
                        <span className="flex items-center gap-1">
                          <Camera className="h-3.5 w-3.5" /> Camera on
                        </span>
                      )}
                      {quiz.proctorMicrophone && (
                        <span className="flex items-center gap-1">
                          <Mic className="h-3.5 w-3.5" /> Microphone on
                        </span>
                      )}
                    </div>
                    <div>Checked on this device only. Nothing is recorded or sent.</div>
                    {media.detectorProblem && <div className="text-accent">{media.detectorProblem}</div>}
                  </div>
                </div>
              )}
              <div className="flex items-center justify-between text-[11px] text-ink-subtle">
                <span>
                  Question {index + 1} of {quiz.questions.length}
                </span>
                <span>
                  {q.points} point{q.points === 1 ? '' : 's'}
                </span>
              </div>
              <p className="text-sm text-ink whitespace-pre-wrap">{q.questionText}</p>

              {['MULTIPLE_CHOICE', 'TRUE_FALSE'].includes(q.questionType) && (
                <fieldset className="space-y-2">
                  <legend className="sr-only">Choose one</legend>
                  {choicesFor(q).map((c) => (
                    <label
                      key={c.id}
                      className={`flex items-center gap-3 p-3 rounded-xl border text-xs cursor-pointer ${values[q.id] === c.id ? 'border-brand bg-brand/15 text-ink' : 'border-line bg-canvas text-ink hover:border-line'}`}
                    >
                      <input type="radio" name={q.id} checked={values[q.id] === c.id} onChange={() => set(q.id, c.id)} />
                      {c.text}
                    </label>
                  ))}
                </fieldset>
              )}
              {q.questionType === 'MULTI_SELECT' && (
                <fieldset className="space-y-2">
                  <legend className="text-[11px] text-ink-subtle mb-1">Select all that apply</legend>
                  {choicesFor(q).map((c) => {
                    const picked = (Array.isArray(values[q.id]) ? (values[q.id] as string[]) : []).includes(c.id);
                    return (
                      <label
                        key={c.id}
                        className={`flex items-center gap-3 p-3 rounded-xl border text-xs cursor-pointer ${picked ? 'border-brand bg-brand/15 text-ink' : 'border-line bg-canvas text-ink hover:border-line'}`}
                      >
                        <input
                          type="checkbox"
                          checked={picked}
                          onChange={(e) => {
                            const cur = Array.isArray(values[q.id]) ? (values[q.id] as string[]) : [];
                            set(q.id, e.target.checked ? [...cur, c.id] : cur.filter((x) => x !== c.id));
                          }}
                        />
                        {c.text}
                      </label>
                    );
                  })}
                </fieldset>
              )}
              {['SHORT_ANSWER', 'FORMULA_CALCULATED'].includes(q.questionType) && (
                <input
                  className={field}
                  aria-label="Your answer"
                  value={(values[q.id] as string) ?? ''}
                  onChange={(e) => set(q.id, e.target.value)}
                  placeholder={q.questionType === 'FORMULA_CALCULATED' ? 'Enter a number' : 'Your answer'}
                />
              )}
              {['ESSAY', 'CODE_SANDBOX'].includes(q.questionType) && (
                <textarea
                  className={`${field} ${q.questionType === 'CODE_SANDBOX' ? 'font-mono' : ''}`}
                  rows={q.questionType === 'CODE_SANDBOX' ? 10 : 7}
                  aria-label="Your answer"
                  value={(values[q.id] as string) ?? ''}
                  onChange={(e) => set(q.id, e.target.value)}
                />
              )}

              <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
                <div className="flex gap-2">
                  <button className={ghost} disabled={index === 0} onClick={() => setIndex((i) => i - 1)}>
                    Previous
                  </button>
                  <button className={ghost} disabled={index === quiz.questions.length - 1} onClick={() => setIndex((i) => i + 1)}>
                    Next
                  </button>
                </div>
                <div className="flex flex-wrap gap-1" aria-label="Question navigator">
                  {quiz.questions.map((x, i) => (
                    <button
                      key={x.id}
                      onClick={() => setIndex(i)}
                      aria-label={`Question ${i + 1}${isAnswered(values[x.id]) ? ', answered' : ''}`}
                      className={`h-6 w-6 rounded-md text-[10px] font-bold border ${i === index ? 'border-brand text-ink' : isAnswered(values[x.id]) ? 'bg-success/10 text-success border-success/30' : 'bg-canvas text-ink-subtle border-line'}`}
                    >
                      {i + 1}
                    </button>
                  ))}
                </div>
              </div>

              <div className="border-t border-line pt-4 flex items-center justify-between gap-3">
                <span className="text-[11px] text-ink-subtle">
                  {missing.length === 0 ? 'All questions answered.' : `${missing.length} unanswered.`}
                  {quiz.requireProctoring && events > 0 ? ` ${events} activity event${events === 1 ? '' : 's'} recorded.` : ''}
                </span>
                <button
                  className={btn}
                  disabled={busy}
                  onClick={() => {
                    if (missing.length > 0 && !window.confirm(`${missing.length} question(s) are unanswered. Submit anyway?`)) return;
                    submit();
                  }}
                >
                  {busy ? 'Submitting…' : 'Submit answers'}
                </button>
              </div>
            </div>
          )}

          {/* Result */}
          {result && (
            <div className="space-y-4 text-center py-6">
              {notice && <Banner kind="ok">{notice}</Banner>}
              <CheckCircle2
                className={`h-12 w-12 mx-auto ${result.pendingManualGrading ? 'text-accent' : result.passed ? 'text-success' : 'text-danger'}`}
              />
              <div className="text-3xl font-extrabold text-ink">{result.percentage}%</div>
              <p className="text-xs text-ink-muted">
                {result.score} / {result.maxScore} points
              </p>
              <p className="text-sm text-ink">
                {result.pendingManualGrading
                  ? 'Submitted. Some answers need a person to grade them, so the final result will follow.'
                  : result.passed
                    ? 'You passed.'
                    : 'You did not reach the passing mark.'}
              </p>
              {result.attemptsRemaining > 0 && !result.passed && (
                <p className="text-[11px] text-ink-subtle">
                  {result.attemptsRemaining} attempt{result.attemptsRemaining === 1 ? '' : 's'} remaining.
                </p>
              )}
              <div className="flex justify-center gap-2">
                <button
                  className="px-4 py-2 rounded-xl border border-line bg-surface hover:bg-raised text-xs font-semibold text-ink"
                  onClick={() => setShowReview((v) => !v)}
                  aria-expanded={showReview}
                >
                  {showReview ? 'Hide my answers' : 'Review my answers'}
                </button>
                <button className={btn} onClick={onClose}>
                  Done
                </button>
              </div>
              {showReview && quiz && <AttemptReview quizId={quiz.id} submissionId={result.submissionId} />}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
