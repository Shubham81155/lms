'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { X, Sparkles, Send, CheckCircle2, XCircle, Loader2, ListChecks } from 'lucide-react';
import { api } from '@/lib/api';
import { errorMessage } from '@/hooks/useApiData';
import { useEscapeKey } from '@/hooks/useEscapeKey';

interface TutorCourse {
  id: string;
  code: string;
  title: string;
}

interface Practice {
  question: string;
  options: string[];
  correctIndex: number;
  explanation: string;
}

interface Turn {
  id: number;
  role: 'user' | 'tutor';
  text: string;
  practice?: Practice | null;
  grounded?: boolean;
}

interface AiTutorModalProps {
  /** Courses the learner can study with the tutor; the tutor reads the chosen course's lessons. */
  courses: TutorCourse[];
  initialCourseId?: string;
  onClose: () => void;
}

const SUGGESTIONS = ['Explain the main idea of the last lesson', 'Quiz me on this course', 'What should I review before the exam?'];

/**
 * Study tutor. Each question goes to POST /ai/tutor with the conversation so far; the answer is grounded in
 * the chosen course's lessons. Nothing is stored on the server, so closing the dialog ends the conversation.
 */
export const AiTutorModal: React.FC<AiTutorModalProps> = ({ courses, initialCourseId, onClose }) => {
  useEscapeKey(onClose);
  const [courseId, setCourseId] = useState(initialCourseId ?? courses[0]?.id ?? '');
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState('');
  const [wantPractice, setWantPractice] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [answers, setAnswers] = useState<Record<number, number>>({});
  const endRef = useRef<HTMLDivElement>(null);
  const nextId = useRef(1);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [turns, busy]);

  const switchCourse = (id: string) => {
    setCourseId(id);
    setTurns([]);
    setAnswers({});
    setError(null);
  };

  const send = useCallback(
    async (text: string, practice = wantPractice) => {
      const message = text.trim();
      if (!message || busy) return;
      const history = turns.slice(-20).map((t) => ({ role: t.role, text: t.text.slice(0, 4000) }));
      setTurns((prev) => [...prev, { id: nextId.current++, role: 'user', text: message }]);
      setInput('');
      setBusy(true);
      setError(null);
      try {
        const res = await api.post<{ data: { reply: string; practice: Practice | null; groundedInCourse: boolean } }>('/api/v1/ai/tutor', {
          courseId: courseId || undefined,
          message,
          history,
          wantPractice: practice,
        });
        setTurns((prev) => [
          ...prev,
          { id: nextId.current++, role: 'tutor', text: res.data.reply, practice: res.data.practice, grounded: res.data.groundedInCourse },
        ]);
      } catch (e) {
        setError(errorMessage(e, 'The tutor could not answer. Try again.'));
      } finally {
        setBusy(false);
      }
    },
    [busy, courseId, turns, wantPractice]
  );

  const course = courses.find((c) => c.id === courseId);

  return (
    <div
      className="fixed inset-0 z-50 bg-canvas/85 backdrop-blur-md flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="tutor-h"
    >
      <div className="bg-surface border border-line rounded-3xl w-full max-w-3xl h-[88vh] flex flex-col overflow-hidden shadow-2xl">
        <div className="bg-canvas border-b border-line px-5 py-3.5 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-2xl bg-brand/15 border border-brand/40 flex items-center justify-center text-brand-fg">
              <Sparkles className="h-5 w-5" />
            </div>
            <div>
              <h3 id="tutor-h" className="font-bold text-sm text-ink">
                Study tutor
              </h3>
              <p className="text-[11px] text-ink-muted">Explains topics from your course. It will not do graded work for you.</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {courses.length > 0 && (
              <label className="text-[11px] text-ink-muted flex items-center gap-1.5">
                <span>Course</span>
                <select
                  value={courseId}
                  onChange={(e) => switchCourse(e.target.value)}
                  className="bg-surface border border-line rounded-lg px-2 py-1 text-xs text-ink focus:outline-none focus:border-brand max-w-[14rem]"
                >
                  {courses.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.code} · {c.title}
                    </option>
                  ))}
                  <option value="">General (no course)</option>
                </select>
              </label>
            )}
            <button
              onClick={onClose}
              aria-label="Close"
              className="p-1 rounded-xl hover:bg-raised text-ink-muted hover:text-ink transition-colors"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4" aria-live="polite">
          {turns.length === 0 && (
            <div className="text-center text-xs text-ink-muted py-10 space-y-4">
              <p>
                Ask about anything in {course ? <strong className="text-ink">{course.title}</strong> : 'your studies'}. Answers can be
                wrong; check them against your lessons.
              </p>
              <div className="flex flex-wrap justify-center gap-2">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    onClick={() => send(s, s.startsWith('Quiz'))}
                    className="px-3 py-1.5 rounded-xl border border-line bg-canvas hover:border-brand/50 text-ink text-[11px] font-semibold"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}

          {turns.map((t) =>
            t.role === 'user' ? (
              <div key={t.id} className="flex justify-end">
                <div className="max-w-[80%] rounded-2xl rounded-br-md bg-brand text-on-brand px-3.5 py-2 text-xs whitespace-pre-wrap">
                  {t.text}
                </div>
              </div>
            ) : (
              <div key={t.id} className="space-y-2 max-w-[90%]">
                <div className="rounded-2xl rounded-bl-md bg-canvas border border-line px-3.5 py-2.5 text-xs text-ink whitespace-pre-wrap leading-relaxed">
                  {t.text}
                </div>
                {t.grounded === false && courseId && <p className="text-[10px] text-ink-subtle">Not based on course material.</p>}
                {t.practice && (
                  <PracticeCard practice={t.practice} chosen={answers[t.id]} onChoose={(i) => setAnswers((a) => ({ ...a, [t.id]: i }))} />
                )}
              </div>
            )
          )}

          {busy && (
            <div className="flex items-center gap-2 text-xs text-ink-muted">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              <span>Thinking…</span>
            </div>
          )}
          {error && (
            <p role="alert" className="text-xs text-danger">
              {error}
            </p>
          )}
          <div ref={endRef} />
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            send(input);
          }}
          className="border-t border-line bg-canvas px-4 py-3 space-y-2"
        >
          <div className="flex items-end gap-2">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  send(input);
                }
              }}
              rows={2}
              maxLength={2000}
              placeholder="Ask a question… (Enter to send, Shift+Enter for a new line)"
              aria-label="Your question"
              className="flex-1 resize-none bg-surface border border-line rounded-xl px-3 py-2 text-xs text-ink placeholder:text-ink-subtle focus:outline-none focus:border-brand"
            />
            <button
              type="submit"
              disabled={busy || !input.trim()}
              aria-label="Send"
              className="h-9 w-9 shrink-0 rounded-xl bg-brand hover:bg-brand-hover text-on-brand flex items-center justify-center disabled:opacity-50"
            >
              <Send className="h-4 w-4" />
            </button>
          </div>
          <label className="flex items-center gap-2 text-[11px] text-ink-muted cursor-pointer w-fit">
            <input
              type="checkbox"
              checked={wantPractice}
              onChange={(e) => setWantPractice(e.target.checked)}
              className="rounded border-line"
            />
            <ListChecks className="h-3.5 w-3.5" />
            <span>Add a practice question to the answer</span>
          </label>
        </form>
      </div>
    </div>
  );
};

const PracticeCard: React.FC<{ practice: Practice; chosen: number | undefined; onChoose: (i: number) => void }> = ({
  practice,
  chosen,
  onChoose,
}) => {
  const answered = chosen !== undefined;
  return (
    <div className="rounded-2xl border border-brand/30 bg-brand/5 p-3.5 space-y-2.5 text-xs">
      <p className="font-semibold text-ink">{practice.question}</p>
      <div className="space-y-1.5" role="radiogroup" aria-label="Answer options">
        {practice.options.map((opt, i) => {
          const isRight = i === practice.correctIndex;
          const tone = !answered
            ? 'border-line bg-surface hover:border-brand/50'
            : isRight
              ? 'border-success/50 bg-success/10'
              : i === chosen
                ? 'border-danger/50 bg-danger/10'
                : 'border-line bg-surface opacity-70';
          return (
            <button
              key={i}
              role="radio"
              aria-checked={chosen === i}
              disabled={answered}
              onClick={() => onChoose(i)}
              className={`w-full text-left rounded-xl border px-3 py-2 flex items-center gap-2 transition-colors ${tone}`}
            >
              {answered && isRight && <CheckCircle2 className="h-3.5 w-3.5 text-success shrink-0" />}
              {answered && !isRight && i === chosen && <XCircle className="h-3.5 w-3.5 text-danger shrink-0" />}
              <span className="text-ink">{opt}</span>
            </button>
          );
        })}
      </div>
      {answered && (
        <p className="text-ink-muted">
          <strong className={chosen === practice.correctIndex ? 'text-success' : 'text-danger'}>
            {chosen === practice.correctIndex ? 'Correct. ' : 'Not quite. '}
          </strong>
          {practice.explanation}
        </p>
      )}
    </div>
  );
};
