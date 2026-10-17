"use client";

import React, { useEffect, useState } from "react";
import { X, ArrowUp, ArrowDown, Trash2, Plus, Save, CheckCircle2, AlertTriangle } from "lucide-react";
import { api } from "@/lib/api";
import { useEscapeKey } from "@/hooks/useEscapeKey";
import { errorMessage, useApiData } from "@/hooks/useApiData";
import { useStaffCourses, type StaffCourse } from "@/hooks/useStaffCourses";
import { LessonFields, blankLesson, lessonProblem, type LessonDraft, type LessonType } from "./LessonFields";

interface ApiLesson {
  id: string;
  title: string;
  orderIndex: number;
  contentType: LessonType;
  bodyContent: string | null;
  mediaUrl: string | null;
  ltiToolLaunchUrl: string | null;
  estimatedMinutes: number;
  updatedAt: string;
}

interface ApiModule {
  id: string;
  title: string;
  orderIndex: number;
  updatedAt: string;
  lessons: ApiLesson[];
}

type Notice = { kind: "ok" | "error"; text: string };

const STATUS_LABEL: Record<StaffCourse["status"], string> = { DRAFT: "Draft", PUBLISHED: "Published", ARCHIVED: "Archived" };
const STATUS_DONE: Record<StaffCourse["status"], string> = {
  DRAFT: "Course set to draft. Learners can no longer see it.",
  PUBLISHED: "Course published. Enrolled learners can open it now.",
  ARCHIVED: "Course archived.",
};

const toDraft = (l: ApiLesson): LessonDraft => ({
  id: l.id,
  title: l.title,
  type: l.contentType,
  minutes: l.estimatedMinutes,
  body: l.bodyContent ?? "",
  url: (l.contentType === "EXTERNAL_LTI_TOOL" ? l.ltiToolLaunchUrl : l.mediaUrl) ?? "",
});

/** The fields to send for a lesson. A SCORM lesson's type and package are never touched here. */
const toPayload = (d: LessonDraft) => {
  const url = d.url.trim();
  const isTool = d.type === "EXTERNAL_LTI_TOOL";
  const scorm = d.type === "SCORM_PACKAGE";
  return {
    title: d.title.trim(),
    estimatedMinutes: d.minutes,
    bodyContent: d.body.trim() || null,
    ...(scorm ? {} : { contentType: d.type, mediaUrl: isTool ? null : url || null, ltiToolLaunchUrl: isTool ? url || null : null }),
  };
};

const sameDraft = (a: LessonDraft, b: LessonDraft) =>
  a.title === b.title && a.type === b.type && a.minutes === b.minutes && a.body === b.body && a.url === b.url;

const iconBtn = "rounded-lg p-1 text-ink-muted transition-colors hover:bg-raised hover:text-ink disabled:opacity-40";
const smallBtn = "rounded-lg border border-line bg-surface px-2.5 py-1 text-[11px] font-semibold text-ink transition-colors hover:bg-raised disabled:opacity-50";
const primaryBtn = "flex items-center gap-1.5 rounded-lg bg-brand px-3 py-1.5 text-[11px] font-bold text-on-brand transition-colors hover:bg-brand-hover disabled:opacity-50";

/** Delete with a confirmation step in place of a browser dialog. */
const ConfirmDelete: React.FC<{ label: string; warning: string; busy: boolean; onConfirm: () => void }> = ({ label, warning, busy, onConfirm }) => {
  const [asking, setAsking] = useState(false);
  if (!asking) {
    return (
      <button onClick={() => setAsking(true)} disabled={busy} aria-label={label} className={`${iconBtn} hover:text-danger`}>
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    );
  }
  return (
    <span className="flex items-center gap-1.5 text-[11px]">
      <span className="text-danger">{warning}</span>
      <button onClick={onConfirm} disabled={busy} className="rounded-lg bg-danger px-2 py-1 font-bold text-on-brand disabled:opacity-50">
        Delete
      </button>
      <button onClick={() => setAsking(false)} className={smallBtn}>
        Keep
      </button>
    </span>
  );
};

interface LessonRowProps {
  lesson: ApiLesson;
  label: string;
  busy: boolean;
  canUp: boolean;
  canDown: boolean;
  onSave: (draft: LessonDraft) => void;
  onMove: (delta: number) => void;
  onDelete: () => void;
  courseId: string;
}

const LessonRow: React.FC<LessonRowProps> = ({ lesson, label, busy, canUp, canDown, onSave, onMove, onDelete, courseId }) => {
  const saved = toDraft(lesson);
  const [draft, setDraft] = useState(saved);
  const dirty = !sameDraft(draft, saved);
  const problem = lessonProblem(draft);

  return (
    <div className="space-y-1.5">
      <LessonFields lesson={draft} label={label} disabled={busy} courseId={courseId} onChange={(patch) => setDraft((d) => ({ ...d, ...patch }))} onDelete={() => undefined} hideDelete />
      <div className="flex items-center justify-between gap-2 px-1">
        <div className="flex items-center gap-1">
          <button onClick={() => onMove(-1)} disabled={busy || !canUp || dirty} aria-label={`Move ${label} up`} className={iconBtn}>
            <ArrowUp className="h-3.5 w-3.5" />
          </button>
          <button onClick={() => onMove(1)} disabled={busy || !canDown || dirty} aria-label={`Move ${label} down`} className={iconBtn}>
            <ArrowDown className="h-3.5 w-3.5" />
          </button>
          <ConfirmDelete label={`Delete ${label}`} warning="Removes this lesson and learners' completion of it." busy={busy} onConfirm={onDelete} />
        </div>
        <div className="flex items-center gap-2">
          {problem && dirty && <span className="text-[11px] font-semibold text-accent">{problem}</span>}
          {dirty && !problem && <span className="text-[11px] text-ink-muted">Unsaved changes</span>}
          <button onClick={() => onSave(draft)} disabled={busy || !dirty || !!problem} aria-label={`Save ${label}`} className={primaryBtn}>
            <Save className="h-3 w-3" />
            <span>Save</span>
          </button>
        </div>
      </div>
    </div>
  );
};

interface ModuleCardProps {
  module: ApiModule;
  index: number;
  count: number;
  busy: boolean;
  act: (work: () => Promise<unknown>, okText: string) => Promise<boolean>;
  courseId: string;
  onMoveModule: (delta: number) => void;
}

const ModuleCard: React.FC<ModuleCardProps> = ({ module, index, count, busy, act, courseId, onMoveModule }) => {
  const [title, setTitle] = useState(module.title);
  const [adding, setAdding] = useState<LessonDraft | null>(null);
  const base = `/api/v1/courses/${courseId}`;
  const name = `module ${index + 1}`;
  const titleDirty = title.trim() !== module.title && title.trim().length > 0;

  const moveLesson = (from: number, delta: number) => {
    const order = module.lessons.map((l) => l);
    const [moved] = order.splice(from, 1);
    order.splice(from + delta, 0, moved);
    return act(async () => {
      for (const [i, l] of order.entries()) {
        if (l.orderIndex !== i) await api.patch(`${base}/lessons/${l.id}`, { orderIndex: i });
      }
    }, "Lesson moved.");
  };

  return (
    <div className="space-y-3 rounded-2xl border border-line bg-canvas p-4">
      <div className="flex items-center gap-2">
        <span className="shrink-0 text-xs font-bold text-ink-muted">Module {index + 1}</span>
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Module title"
          aria-label={`Title of ${name}`}
          maxLength={255}
          disabled={busy}
          className="min-w-0 flex-1 rounded-xl border border-line bg-surface px-3 py-1.5 text-xs font-bold text-ink focus:border-brand focus:outline-none"
        />
        {titleDirty && (
          <button onClick={() => act(() => api.patch(`${base}/modules/${module.id}`, { title: title.trim() }), "Module renamed.")} disabled={busy} aria-label={`Save title of ${name}`} className={primaryBtn}>
            <Save className="h-3 w-3" />
            <span>Save</span>
          </button>
        )}
        <button onClick={() => onMoveModule(-1)} disabled={busy || index === 0} aria-label={`Move ${name} up`} className={iconBtn}>
          <ArrowUp className="h-3.5 w-3.5" />
        </button>
        <button onClick={() => onMoveModule(1)} disabled={busy || index === count - 1} aria-label={`Move ${name} down`} className={iconBtn}>
          <ArrowDown className="h-3.5 w-3.5" />
        </button>
        <ConfirmDelete
          label={`Delete ${name}`}
          warning={`Removes this module and its ${module.lessons.length} lesson${module.lessons.length === 1 ? "" : "s"}.`}
          busy={busy}
          onConfirm={() => act(() => api.delete(`${base}/modules/${module.id}`), "Module deleted.")}
        />
      </div>

      {module.lessons.length === 0 && !adding && <p className="text-[11px] text-ink-subtle">No lessons in this module yet.</p>}

      <div className="space-y-4">
        {module.lessons.map((lesson, i) => (
          <LessonRow
            courseId={courseId}
            key={`${lesson.id}:${lesson.updatedAt}`}
            lesson={lesson}
            label={`lesson ${i + 1} in ${name}`}
            busy={busy}
            canUp={i > 0}
            canDown={i < module.lessons.length - 1}
            onSave={(d) => act(() => api.patch(`${base}/lessons/${lesson.id}`, toPayload(d)), "Lesson saved.")}
            onMove={(delta) => moveLesson(i, delta)}
            onDelete={() => act(() => api.delete(`${base}/lessons/${lesson.id}`), "Lesson deleted.")}
          />
        ))}
      </div>

      {adding ? (
        <div className="space-y-2 rounded-xl border border-dashed border-brand/50 p-2">
          <p className="px-1 text-[11px] font-bold text-brand-fg">New lesson</p>
          <LessonFields lesson={adding} label={`new lesson in ${name}`} disabled={busy} courseId={courseId} onChange={(patch) => setAdding((d) => (d ? { ...d, ...patch } : d))} onDelete={() => setAdding(null)} />
          <div className="flex items-center justify-end gap-2">
            {lessonProblem(adding) && adding.title.length > 0 && <span className="text-[11px] font-semibold text-accent">{lessonProblem(adding)}</span>}
            <button onClick={() => setAdding(null)} className={smallBtn}>
              Cancel
            </button>
            <button
              onClick={async () => {
                const d = adding;
                const ok = await act(() => api.post(`${base}/modules/${module.id}/lessons`, toPayload(d)), "Lesson added.");
                if (ok) setAdding(null);
              }}
              disabled={busy || !!lessonProblem(adding)}
              aria-label={`Add lesson to ${name}`}
              className={primaryBtn}
            >
              <Plus className="h-3 w-3" />
              <span>Add lesson</span>
            </button>
          </div>
        </div>
      ) : (
        <button onClick={() => setAdding(blankLesson())} disabled={busy} className="text-[11px] font-semibold text-brand-fg hover:underline disabled:opacity-50">
          + New lesson
        </button>
      )}
    </div>
  );
};

export const CourseContentEditor: React.FC<{ onClose: () => void; /** Open on this course when the person may edit it. */ initialCourseId?: string | null }> = ({ onClose, initialCourseId }) => {
  useEscapeKey(onClose);
  const { courses, isLoading: coursesLoading, reload: reloadCourses } = useStaffCourses({ editableOnly: true });
  const [pendingStatus, setPendingStatus] = useState<StaffCourse["status"] | null>(null);
  const [courseId, setCourseId] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [newModule, setNewModule] = useState("");

  useEffect(() => {
    if (!courseId && courses.length > 0) setCourseId((courses.find((c) => c.id === initialCourseId) ?? courses[0]).id);
  }, [courses, courseId, initialCourseId]);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 5000);
    return () => clearTimeout(t);
  }, [notice]);

  const content = useApiData<{ data: ApiModule[] }>(courseId ? `/api/v1/courses/${courseId}/modules` : null);
  const modules = content.data?.data ?? [];
  const base = `/api/v1/courses/${courseId}`;

  /** Runs one change, reloads the content, and reports the result. Resolves true on success. */
  const act = async (work: () => Promise<unknown>, okText: string) => {
    setBusy(true);
    try {
      await work();
      await content.reload();
      setNotice({ kind: "ok", text: okText });
      return true;
    } catch (e) {
      setNotice({ kind: "error", text: errorMessage(e, "That change could not be saved.") });
      await content.reload();
      return false;
    } finally {
      setBusy(false);
    }
  };

  const moveModule = (from: number, delta: number) => {
    const ids = modules.map((m) => m.id);
    const [moved] = ids.splice(from, 1);
    ids.splice(from + delta, 0, moved);
    return act(() => api.put(`${base}/modules-order`, { moduleIds: ids }), "Module moved.");
  };

  const course = courses.find((c) => c.id === courseId);
  const detail = useApiData<{ data: { publishNeedsApproval: boolean } }>(courseId ? `/api/v1/courses/${courseId}` : null);
  const needsApproval = !!detail.data?.data.publishNeedsApproval && course?.status !== "PUBLISHED";
  const [reviewMessage, setReviewMessage] = useState("");

  const submitForReview = () =>
    act(async () => {
      await api.post(`${base}/review/submit`, reviewMessage.trim() ? { message: reviewMessage.trim() } : {});
      setReviewMessage("");
      await reloadCourses();
    }, "Submitted for review. An administrator will publish it or send it back.");

  const changeStatus = async (status: StaffCourse["status"]) => {
    setPendingStatus(null);
    await act(async () => {
      await api.put(base, { status });
      await reloadCourses();
    }, STATUS_DONE[status]);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-canvas/85 p-4 backdrop-blur-md" role="dialog" aria-modal="true" aria-label="Course content">
      <div className="relative flex h-[88vh] w-full max-w-4xl flex-col overflow-hidden rounded-3xl border border-line bg-surface shadow-2xl">
        <div className="flex items-center justify-between gap-4 border-b border-line bg-canvas px-6 py-4">
          <div>
            <h3 className="text-base font-bold text-ink">Course content</h3>
            <p className="text-xs text-ink-muted">Edit the modules and lessons of a course you teach. Changes are visible to learners as soon as you save them.</p>
            {course && (
              <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                <label htmlFor="course-status" className="font-semibold text-ink-muted">
                  Status
                </label>
                <select
                  id="course-status"
                  value={course.status}
                  onChange={(e) => {
                    const next = e.target.value as StaffCourse["status"];
                    if (next === "ARCHIVED") setPendingStatus(next);
                    else changeStatus(next);
                  }}
                  disabled={busy}
                  className="rounded-lg border border-line bg-surface px-2 py-1 text-xs text-ink focus:border-brand focus:outline-none"
                >
                  {(Object.keys(STATUS_LABEL) as StaffCourse["status"][])
                    .filter((s) => !(needsApproval && s === "PUBLISHED"))
                    .map((s) => (
                      <option key={s} value={s}>
                        {STATUS_LABEL[s]}
                      </option>
                    ))}
                </select>
                {course.status !== "PUBLISHED" && <span className="text-ink-subtle">Learners cannot see this course.</span>}
                {needsApproval && course.status === "DRAFT" && (
                  course.reviewStatus === "PENDING" ? (
                    <span className="rounded-full border border-accent/30 bg-accent/10 px-2 py-0.5 font-semibold text-accent">Waiting for review</span>
                  ) : (
                    <span className="flex flex-wrap items-center gap-1.5">
                      {course.reviewStatus === "CHANGES_REQUESTED" && (
                        <span className="text-danger">Changes requested{course.reviewNote ? `: ${course.reviewNote}` : ""}</span>
                      )}
                      <input
                        value={reviewMessage}
                        onChange={(e) => setReviewMessage(e.target.value)}
                        maxLength={2000}
                        placeholder="Note for the reviewer (optional)"
                        aria-label="Note for the reviewer"
                        className="w-52 rounded-lg border border-line bg-surface px-2 py-1 text-xs text-ink focus:border-brand focus:outline-none"
                      />
                      <button onClick={submitForReview} disabled={busy} className="rounded-lg bg-brand px-2 py-1 font-bold text-on-brand disabled:opacity-50">
                        {course.reviewStatus === "CHANGES_REQUESTED" ? "Submit again" : "Submit for review"}
                      </button>
                    </span>
                  )
                )}
                {pendingStatus === "ARCHIVED" && (
                  <span className="flex items-center gap-1.5">
                    <span className="text-danger">Archive it? Learners lose access.</span>
                    <button onClick={() => changeStatus("ARCHIVED")} disabled={busy} className="rounded-lg bg-danger px-2 py-1 font-bold text-on-brand disabled:opacity-50">
                      Archive
                    </button>
                    <button onClick={() => setPendingStatus(null)} className={smallBtn}>
                      Keep
                    </button>
                  </span>
                )}
              </div>
            )}
          </div>
          <div className="flex items-center gap-3">
            <select
              value={courseId}
              onChange={(e) => setCourseId(e.target.value)}
              aria-label="Course"
              disabled={busy}
              className="rounded-xl border border-line bg-surface px-3 py-1.5 text-xs text-ink focus:border-brand focus:outline-none"
            >
              {courses.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.code} · {c.title}
                </option>
              ))}
            </select>
            <button onClick={onClose} aria-label="Close" className="rounded-xl p-1 text-ink-muted transition-colors hover:bg-raised hover:text-ink">
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto p-6">
          {coursesLoading || (courseId && content.isLoading && !content.data) ? (
            <p role="status" className="py-16 text-center text-xs text-ink-muted">
              Loading…
            </p>
          ) : courses.length === 0 ? (
            <p className="rounded-2xl border border-dashed border-line px-6 py-12 text-center text-xs text-ink-muted">There are no courses you can edit. Only administrators and the assigned instructor can change course content.</p>
          ) : content.error ? (
            <div role="alert" className="mx-auto max-w-md rounded-2xl border border-danger/30 bg-danger/10 p-6 text-center">
              <p className="text-sm font-bold text-danger">Could not load the content of {course?.code}</p>
              <p className="mt-1.5 text-xs text-ink-muted">{content.error}</p>
              <button onClick={content.reload} className={`${smallBtn} mt-4`}>
                Try again
              </button>
            </div>
          ) : (
            <>
              {modules.length === 0 && <p className="rounded-2xl border border-dashed border-line px-6 py-10 text-center text-xs text-ink-muted">This course has no modules yet. Add the first one below.</p>}

              {modules.map((m, i) => (
                <ModuleCard key={`${m.id}:${m.updatedAt}`} module={m} index={i} count={modules.length} busy={busy} act={act} courseId={courseId} onMoveModule={(d) => moveModule(i, d)} />
              ))}

              <form
                className="flex items-center gap-2"
                onSubmit={async (e) => {
                  e.preventDefault();
                  const title = newModule.trim();
                  if (!title) return;
                  if (await act(() => api.post(`${base}/modules`, { title }), "Module added.")) setNewModule("");
                }}
              >
                <input
                  type="text"
                  value={newModule}
                  onChange={(e) => setNewModule(e.target.value)}
                  placeholder="New module title"
                  aria-label="New module title"
                  maxLength={255}
                  disabled={busy}
                  className="min-w-0 flex-1 rounded-xl border border-line bg-canvas px-3 py-2 text-xs text-ink focus:border-brand focus:outline-none"
                />
                <button type="submit" disabled={busy || !newModule.trim()} className={primaryBtn}>
                  <Plus className="h-3 w-3" />
                  <span>Add module</span>
                </button>
              </form>
            </>
          )}
        </div>

        {notice && (
          <div
            role={notice.kind === "error" ? "alert" : "status"}
            className={`absolute bottom-6 left-1/2 z-10 flex max-w-[90%] -translate-x-1/2 items-center gap-2 rounded-xl border bg-surface px-4 py-2.5 text-xs shadow-xl ${
              notice.kind === "ok" ? "border-success/40 text-success" : "border-danger/40 text-danger"
            }`}
          >
            {notice.kind === "ok" ? <CheckCircle2 className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}
            <span className="font-semibold">{notice.text}</span>
          </div>
        )}
      </div>
    </div>
  );
};
