"use client";

import React from "react";
import { Award, ClipboardCheck, FileCheck, Brain } from "lucide-react";
import { useApiData } from "@/hooks/useApiData";

interface CourseGrades {
  course: { id: string; code: string; title: string; passingGradePercent: number };
  status: string;
  progressPercent: number;
  courseGrade: { letter: string | null; percent: number | null; approvedAt: string | null } | null;
  assignments: {
    id: string;
    title: string;
    maxPoints: number;
    dueDate: string | null;
    submittedAt: string | null;
    late: boolean;
    grade: number | null;
    feedback: string | null;
    gradedAt: string | null;
    appealStatus: string | null;
  }[];
  quizzes: {
    id: string;
    title: string;
    attemptsUsed: number;
    maxAttempts: number;
    passingPercent: number;
    bestPercent: number | null;
    passed: boolean;
    awaitingManualGrading: boolean;
  }[];
}

const BLOOM_ORDER = ["REMEMBER", "UNDERSTAND", "APPLY", "ANALYZE", "EVALUATE", "CREATE"];
const day = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });

/** A learner's own results across their courses (GET /enrollments/grades) and their Bloom's-taxonomy profile. */
export const MyGrades: React.FC<{ onOpenAssignments: (courseId: string) => void }> = ({ onOpenAssignments }) => {
  const grades = useApiData<{ data: CourseGrades[] }>("/api/v1/enrollments/grades");
  const mastery = useApiData<{ data: { level: string; score: number }[] }>("/api/v1/analytics/mastery");
  const courses = grades.data?.data ?? [];
  const levels = [...(mastery.data?.data ?? [])].sort((a, b) => BLOOM_ORDER.indexOf(a.level) - BLOOM_ORDER.indexOf(b.level));

  return (
    <section className="space-y-6" aria-labelledby="grades-h">
      <div>
        <h2 id="grades-h" className="text-2xl font-extrabold text-ink tracking-tight">Grades</h2>
        <p className="text-sm text-ink-muted">Your results in every course. A course grade appears once your instructor has finalised it.</p>
      </div>

      {grades.error && <p role="alert" className="text-xs text-danger">{grades.error}</p>}
      {grades.isLoading && <p className="text-xs text-ink-subtle">Loading your grades…</p>}
      {!grades.isLoading && courses.length === 0 && !grades.error && (
        <p className="rounded-2xl border border-dashed border-line p-8 text-center text-xs text-ink-muted">You are not enrolled in any course yet.</p>
      )}

      {courses.map((c) => (
        <article key={c.course.id} className="bg-surface border border-line rounded-2xl p-5 space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <span className="text-xs font-bold px-2 py-0.5 rounded-lg bg-brand/15 text-brand-fg border border-brand/40">{c.course.code}</span>
              <h3 className="mt-1.5 font-bold text-base text-ink">{c.course.title}</h3>
              <p className="text-[11px] text-ink-muted">
                {c.status.replace(/_/g, " ").toLowerCase()} · {Math.round(c.progressPercent)}% of lessons done · pass mark {c.course.passingGradePercent}%
              </p>
            </div>
            <div className="text-right">
              {c.courseGrade ? (
                <>
                  <div className="flex items-center gap-1.5 justify-end text-2xl font-extrabold text-ink">
                    <Award className="h-5 w-5 text-accent" />
                    {c.courseGrade.letter ?? `${Math.round(c.courseGrade.percent ?? 0)}%`}
                  </div>
                  <div className="text-[11px] text-ink-muted">
                    {c.courseGrade.percent !== null ? `${Math.round(c.courseGrade.percent * 10) / 10}%` : ""}
                    {c.courseGrade.approvedAt ? ` · final since ${day(c.courseGrade.approvedAt)}` : ""}
                  </div>
                </>
              ) : (
                <div className="text-xs text-ink-subtle">Course grade not final yet</div>
              )}
            </div>
          </div>

          {c.assignments.length > 0 && (
            <div className="space-y-1.5">
              <h4 className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-ink-subtle">
                <FileCheck className="h-3.5 w-3.5" /> Assignments
              </h4>
              <ul className="divide-y divide-line rounded-xl border border-line">
                {c.assignments.map((a) => (
                  <li key={a.id} className="px-3 py-2.5 text-xs flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <button onClick={() => onOpenAssignments(c.course.id)} className="font-semibold text-ink hover:text-brand-fg text-left">
                        {a.title}
                      </button>
                      <div className="text-[11px] text-ink-muted">
                        {a.submittedAt ? `Submitted ${day(a.submittedAt)}` : a.dueDate ? `Due ${day(a.dueDate)}` : "Not submitted"}
                        {a.late && <span className="ml-1.5 text-danger font-semibold">late</span>}
                        {a.appealStatus && <span className="ml-1.5">· appeal {a.appealStatus.toLowerCase()}</span>}
                      </div>
                      {a.feedback && <p className="mt-1 text-[11px] text-ink whitespace-pre-line">“{a.feedback}”</p>}
                    </div>
                    <div className="shrink-0 font-bold text-ink">
                      {a.grade !== null ? `${a.grade} / ${a.maxPoints}` : <span className="font-normal text-ink-subtle">{a.submittedAt ? "Awaiting grade" : "–"}</span>}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {c.quizzes.length > 0 && (
            <div className="space-y-1.5">
              <h4 className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-ink-subtle">
                <ClipboardCheck className="h-3.5 w-3.5" /> Quizzes
              </h4>
              <ul className="divide-y divide-line rounded-xl border border-line">
                {c.quizzes.map((q) => (
                  <li key={q.id} className="px-3 py-2.5 text-xs flex items-center justify-between gap-2">
                    <div>
                      <div className="font-semibold text-ink">{q.title}</div>
                      <div className="text-[11px] text-ink-muted">
                        {q.attemptsUsed} of {q.maxAttempts} attempt{q.maxAttempts === 1 ? "" : "s"} used · pass at {q.passingPercent}%
                        {q.awaitingManualGrading && " · some answers awaiting marking"}
                      </div>
                    </div>
                    <div className={`shrink-0 font-bold ${q.passed ? "text-success" : "text-ink"}`}>
                      {q.bestPercent !== null ? `${q.bestPercent}%${q.passed ? " · passed" : ""}` : <span className="font-normal text-ink-subtle">Not taken</span>}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </article>
      ))}

      {levels.length > 0 && (
        <article className="bg-surface border border-line rounded-2xl p-5 space-y-3" aria-labelledby="mastery-h">
          <h3 id="mastery-h" className="flex items-center gap-2 font-bold text-sm text-ink">
            <Brain className="h-4 w-4 text-orchid" /> Thinking skills
          </h3>
          <p className="text-[11px] text-ink-muted">Your average on quiz questions tagged with a level of Bloom's taxonomy.</p>
          <ul className="space-y-2">
            {levels.map((l) => (
              <li key={l.level} className="text-xs">
                <div className="flex justify-between text-ink">
                  <span className="capitalize">{l.level.toLowerCase()}</span>
                  <span className="font-semibold">{Math.round(l.score)}%</span>
                </div>
                <div className="mt-1 h-1.5 rounded-full bg-raised overflow-hidden" role="progressbar" aria-valuenow={Math.round(l.score)} aria-valuemin={0} aria-valuemax={100} aria-label={l.level}>
                  <div className="h-1.5 bg-brand" style={{ width: `${Math.min(100, l.score)}%` }} />
                </div>
              </li>
            ))}
          </ul>
        </article>
      )}
    </section>
  );
};
