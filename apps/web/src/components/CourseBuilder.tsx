"use client";

import React, { useEffect, useState } from "react";
import {
  X,
  Plus,
  Trash2,
  FileText,
  Video,
  Code,
  Package,
  Sparkles,
  Save,
  CheckCircle,
  Layers,
  ArrowRight,
  Sliders,
  Shield,
  Eye,
} from "lucide-react";
import { AiCurriculumGenerator } from "@enterprise-lms/security";

export interface BuilderLesson {
  id: string;
  title: string;
  type: string;
  duration: string;
}

export interface BuilderModule {
  id: string;
  title: string;
  lessons: BuilderLesson[];
}

export interface CourseDraft {
  title: string;
  code: string;
  status: "DRAFT" | "PUBLISHED" | "ARCHIVED";
  passingGradePercent: number;
  allowSelfEnroll: boolean;
  enableProctoring: boolean;
  modules: BuilderModule[];
}

interface CourseBuilderProps {
  onClose: () => void;
  /** Resolves once the course is saved; rejects with the reason it was not. The builder stays open on rejection. */
  onSave: (course: CourseDraft) => Promise<void>;
}

export const CourseBuilder: React.FC<CourseBuilderProps> = ({ onClose, onSave }) => {
  const [courseTitle, setCourseTitle] = useState("");
  const [courseCode, setCourseCode] = useState("");
  const [courseStatus, setCourseStatus] = useState<CourseDraft["status"]>("DRAFT");
  const [passingGradePercent, setPassingGradePercent] = useState(70);
  const [allowSelfEnroll, setAllowSelfEnroll] = useState(true);
  const [enableProctoring, setEnableProctoring] = useState(true);

  const [modules, setModules] = useState<BuilderModule[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [aiNotice, setAiNotice] = useState<string | null>(null);
  const [aiTopic, setAiTopic] = useState("");
  const [isGeneratingAi, setIsGeneratingAi] = useState(false);
  const [aiGeneratedItems, setAiGeneratedItems] = useState<any | null>(null);

  const handleGenerateAiCurriculum = () => {
    if (!aiTopic) return;
    setIsGeneratingAi(true);
    setTimeout(() => {
      const summary = AiCurriculumGenerator.generateAssessmentFromTopic(aiTopic);
      setAiGeneratedItems(summary);
      setIsGeneratingAi(false);
    }, 800);
  };

  const handleApplyAiToModules = () => {
    if (!aiGeneratedItems) return;

    const newLessons = [
      {
        id: `les_ai_video_${Date.now()}`,
        title: `${aiTopic}: Theoretical Foundations`,
        type: "VIDEO",
        duration: "30 min",
      },
      ...aiGeneratedItems.keyTakeaways.slice(0, 2).map((takeaway: string, idx: number) => ({
        id: `les_ai_doc_${Date.now()}_${idx}`,
        title: `Deep Dive: ${takeaway.slice(0, 45)}...`,
        type: "RICHTEXT",
        duration: "20 min",
      })),
      {
        id: `les_ai_lab_${Date.now()}`,
        title: `Hands-on Lab: ${aiTopic} Verification`,
        type: "CODE",
        duration: "45 min",
      },
    ];

    const newModule = {
      id: `mod_ai_${Date.now()}`,
      title: `Module ${modules.length + 1}: ${aiTopic}`,
      lessons: newLessons,
    };

    setModules([...modules, newModule]);
    setAiNotice(`Added Module ${modules.length + 1} with ${newLessons.length} lessons.`);
  };

  const addModule = () => {
    const newMod = {
      id: `mod_${Date.now()}`,
      title: `Module ${modules.length + 1}: Advanced Topics`,
      lessons: [
        { id: `les_${Date.now()}`, title: "New Lesson Item", type: "RICHTEXT", duration: "20 min" },
      ],
    };
    setModules([...modules, newMod]);
  };

  const deleteModule = (modId: string) => {
    setModules(modules.filter((m) => m.id !== modId));
  };

  const addLesson = (modId: string) => {
    setModules(
      modules.map((m) =>
        m.id === modId
          ? {
              ...m,
              lessons: [
                ...m.lessons,
                {
                  id: `les_${Date.now()}`,
                  title: `Lesson ${m.lessons.length + 1}: New Topic`,
                  type: "RICHTEXT",
                  duration: "15 min",
                },
              ],
            }
          : m
      )
    );
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !isSaving && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose, isSaving]);

  const canSave = courseTitle.trim().length >= 3 && courseCode.trim().length >= 2 && !isSaving;

  const save = async () => {
    setIsSaving(true);
    setSaveError(null);
    try {
      await onSave({
        title: courseTitle.trim(),
        code: courseCode.trim(),
        status: courseStatus,
        passingGradePercent,
        allowSelfEnroll,
        enableProctoring,
        modules,
      });
      onClose();
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "Could not save the course.");
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-canvas/85 backdrop-blur-md flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby="course-builder-h">
      <div className="bg-surface border border-line rounded-3xl w-full max-w-5xl h-[88vh] flex flex-col overflow-hidden shadow-2xl">
        {/* Header */}
        <div className="bg-canvas border-b border-line px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="h-9 w-9 rounded-2xl bg-brand/20 border border-brand/40 flex items-center justify-center text-brand-fg">
              <Layers className="h-5 w-5" />
            </div>
            <div>
              <h3 id="course-builder-h" className="font-bold text-sm text-ink">Course & Curriculum Designer</h3>
              <p className="text-[11px] text-ink-muted">
                Full Lifecycle Management • SCORM / LTI / AI Bloom's Taxonomy
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={save}
              disabled={!canSave}
              className="px-5 py-2 bg-brand hover:bg-brand-hover text-on-brand rounded-xl text-xs font-bold flex items-center gap-1.5 shadow-lg shadow-brand/20 transition-all disabled:opacity-50"
            >
              <Save className="h-4 w-4" />
              <span>{isSaving ? "Saving…" : "Create Course"}</span>
            </button>
            <button
              onClick={onClose}
              disabled={isSaving}
              aria-label="Close"
              className="p-1 rounded-xl hover:bg-raised text-ink-muted hover:text-ink transition-colors"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {saveError && (
          <div role="alert" className="border-b border-danger/30 bg-danger/10 px-6 py-2.5 text-xs font-semibold text-danger">
            {saveError}
          </div>
        )}

        {/* Content Area */}
        <div className="flex-1 p-6 overflow-y-auto grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* Main Course Modules Column */}
          <div className="md:col-span-2 space-y-6">
            {/* Title, Code & Status */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="sm:col-span-2 space-y-1.5">
                <label className="text-xs font-semibold text-ink-muted">Course Title</label>
                <input
                  type="text"
                  value={courseTitle}
                  placeholder="e.g. Introduction to Computer Science"
                  onChange={(e) => setCourseTitle(e.target.value)}
                  className="w-full bg-canvas border border-line rounded-xl px-3.5 py-2 text-xs text-ink focus:outline-none focus:border-brand"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-ink-muted">Course Code</label>
                <input
                  type="text"
                  value={courseCode}
                  placeholder="e.g. CS-101"
                  onChange={(e) => setCourseCode(e.target.value)}
                  className="w-full bg-canvas border border-line rounded-xl px-3.5 py-2 text-xs text-ink focus:outline-none focus:border-brand font-mono"
                />
              </div>
            </div>

            {/* Course Settings Bar */}
            <div className="bg-canvas border border-line rounded-2xl p-4 grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs">
              <div>
                <label className="text-ink-muted font-semibold block mb-1">Publication Status</label>
                <select
                  value={courseStatus}
                  onChange={(e) => setCourseStatus(e.target.value as any)}
                  className="w-full bg-surface border border-line rounded-xl px-3 py-1.5 text-xs text-ink focus:outline-none focus:border-brand font-medium"
                >
                  <option value="DRAFT">DRAFT (Unpublished)</option>
                  <option value="PUBLISHED">PUBLISHED (Active)</option>
                  <option value="ARCHIVED">ARCHIVED (Read-Only)</option>
                </select>
              </div>

              <div>
                <div className="flex justify-between text-ink-muted font-semibold mb-1">
                  <span>Passing Score</span>
                  <span className="text-brand-fg">{passingGradePercent}%</span>
                </div>
                <input
                  type="range"
                  min="50"
                  max="100"
                  value={passingGradePercent}
                  onChange={(e) => setPassingGradePercent(Number(e.target.value))}
                  className="w-full accent-brand mt-1"
                />
              </div>

              <div className="space-y-1.5 pt-1">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={allowSelfEnroll}
                    onChange={(e) => setAllowSelfEnroll(e.target.checked)}
                    className="rounded bg-surface border-line text-brand-fg"
                  />
                  <span className="text-ink">Allow Self-Enrollment</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={enableProctoring}
                    onChange={(e) => setEnableProctoring(e.target.checked)}
                    className="rounded bg-surface border-line text-brand-fg"
                  />
                  <span className="text-ink">Mandate AI Proctoring</span>
                </label>
              </div>
            </div>

            {/* Modules List */}
            <div className="space-y-4">
              <div className="flex items-center justify-between border-b border-line pb-2">
                <h4 className="text-xs font-bold uppercase tracking-wider text-ink-muted">
                  Curriculum Modules ({modules.length})
                </h4>
                <button
                  onClick={addModule}
                  className="text-xs font-semibold text-brand-fg hover:text-brand-fg flex items-center gap-1"
                >
                  <Plus className="h-3.5 w-3.5" />
                  <span>Add Module</span>
                </button>
              </div>

              {modules.length === 0 && (
                <p className="rounded-2xl border border-dashed border-line px-4 py-8 text-center text-xs text-ink-muted">
                  No modules yet. Add one, or generate a module from a topic with the AI synthesizer.
                </p>
              )}

              {modules.map((mod, modIdx) => (
                <div key={mod.id} className="bg-canvas border border-line rounded-2xl p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-xs text-ink">
                      Module {modIdx + 1}: {mod.title.replace(/^Module \d+: /, "")}
                    </span>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => addLesson(mod.id)}
                        className="text-[11px] text-brand-fg hover:text-brand-fg font-semibold"
                      >
                        + Add Lesson
                      </button>
                      <button
                        onClick={() => deleteModule(mod.id)}
                        aria-label={`Delete module ${modIdx + 1}`}
                        className="text-ink-subtle hover:text-danger transition-colors"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>

                  <div className="space-y-2">
                    {mod.lessons.map((les) => (
                      <div
                        key={les.id}
                        className="bg-surface border border-line/80 p-2.5 rounded-xl flex items-center justify-between text-xs"
                      >
                        <div className="flex items-center gap-2 text-ink">
                          {les.type === "VIDEO" && <Video className="h-3.5 w-3.5 text-danger" />}
                          {les.type === "CODE" && <Code className="h-3.5 w-3.5 text-success" />}
                          {les.type === "SCORM" && <Package className="h-3.5 w-3.5 text-accent" />}
                          {les.type === "RICHTEXT" && <FileText className="h-3.5 w-3.5 text-brand-fg" />}
                          <span>{les.title}</span>
                        </div>
                        <span className="text-[10px] text-ink-subtle font-mono">{les.duration}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* AI Curriculum Assistant Sidebar */}
          <div className="border-t md:border-t-0 md:border-l border-line pt-6 md:pt-0 md:pl-6 space-y-4">
            <div className="flex items-center gap-2 text-xs font-bold text-brand-fg uppercase tracking-wider">
              <Sparkles className="h-4 w-4" />
              <span>AI Curriculum Synthesizer</span>
            </div>

            <p className="text-xs text-ink-muted">
              Enter any lecture topic to automatically synthesize Bloom's Taxonomy-aligned quiz items and key takeaways.
            </p>

            <div className="space-y-2">
              <input
                type="text"
                placeholder="e.g. Raft Consensus & Byzantine Faults"
                value={aiTopic}
                onChange={(e) => setAiTopic(e.target.value)}
                className="w-full bg-canvas border border-line rounded-xl p-2.5 text-xs text-ink placeholder:text-ink-subtle focus:outline-none focus:border-brand"
              />
              <button
                disabled={!aiTopic || isGeneratingAi}
                onClick={handleGenerateAiCurriculum}
                className="w-full py-2 bg-gradient-to-r from-brand to-brand-hover hover:from-brand-hover hover:to-brand disabled:opacity-50 text-on-brand rounded-xl text-xs font-semibold shadow-md shadow-brand/20 transition-all"
              >
                {isGeneratingAi ? "Synthesizing with AI..." : "Generate Syllabus & Quizzes"}
              </button>
            </div>

            {aiNotice && (
              <p role="status" className="text-[11px] font-semibold text-success">
                {aiNotice}
              </p>
            )}

            {aiGeneratedItems && (
              <div className="bg-canvas border border-line rounded-xl p-3.5 text-xs space-y-3 max-h-80 overflow-y-auto">
                <div className="flex items-center justify-between">
                  <div className="font-semibold text-ink">Generated Takeaways</div>
                  <button
                    onClick={handleApplyAiToModules}
                    className="px-2.5 py-1 bg-brand hover:bg-brand-hover text-on-brand rounded-lg text-[10px] font-bold transition-all shadow-md"
                  >
                    + Inject as Module
                  </button>
                </div>

                <ul className="space-y-1 text-[11px] text-ink-muted list-disc list-inside">
                  {aiGeneratedItems.keyTakeaways.map((k: string, idx: number) => (
                    <li key={idx}>{k}</li>
                  ))}
                </ul>

                <div className="font-semibold text-ink pt-2 border-t border-line">
                  Synthesized Quiz Questions ({aiGeneratedItems.recommendedQuiz.length})
                </div>
                {aiGeneratedItems.recommendedQuiz.map((q: any, idx: number) => (
                  <div key={idx} className="bg-surface p-2 rounded border border-line/80 text-[11px] space-y-1">
                    <span className="text-accent font-bold uppercase text-[9px]">{q.taxonomyLevel}</span>
                    <p className="text-ink font-medium">{q.questionText}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
