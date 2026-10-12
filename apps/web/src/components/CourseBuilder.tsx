"use client";

import React, { useState } from "react";
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

interface CourseBuilderProps {
  onClose: () => void;
  onSave: (courseData: any) => void;
}

export const CourseBuilder: React.FC<CourseBuilderProps> = ({ onClose, onSave }) => {
  const [courseTitle, setCourseTitle] = useState("CS-401: Cloud Native Microservices & Kubernetes");
  const [courseCode, setCourseCode] = useState("CS-401");
  const [courseStatus, setCourseStatus] = useState<"DRAFT" | "PUBLISHED" | "ARCHIVED">("PUBLISHED");
  const [passingGradePercent, setPassingGradePercent] = useState(70);
  const [allowSelfEnroll, setAllowSelfEnroll] = useState(true);
  const [enableProctoring, setEnableProctoring] = useState(true);

  const [modules, setModules] = useState([
    {
      id: "mod_1",
      title: "Module 1: Distributed Architectures & Service Mesh",
      lessons: [
        { id: "les_1", title: "1.1 Introduction to Envoy & Istio mTLS", type: "VIDEO", duration: "25 min" },
        { id: "les_2", title: "1.2 Interactive Lab: Configuring Zero-Trust Ingress", type: "CODE", duration: "45 min" },
        { id: "les_3", title: "1.3 SCORM 2004 Module: Microservices Resiliency", type: "SCORM", duration: "30 min" },
      ],
    },
  ]);
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
    alert(`Successfully generated and attached Module ${modules.length + 1} with ${newLessons.length} lessons!`);
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
    if (modules.length <= 1) return;
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

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/85 backdrop-blur-md flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-slate-800 rounded-3xl w-full max-w-5xl h-[88vh] flex flex-col overflow-hidden shadow-2xl">
        {/* Header */}
        <div className="bg-slate-950 border-b border-slate-800 px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="h-9 w-9 rounded-2xl bg-blue-600/20 border border-blue-500/40 flex items-center justify-center text-blue-400">
              <Layers className="h-5 w-5" />
            </div>
            <div>
              <h3 className="font-bold text-sm text-white">Course & Curriculum Designer</h3>
              <p className="text-[11px] text-slate-400">
                Full Lifecycle Management • SCORM / LTI / AI Bloom's Taxonomy
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={() => {
                onSave({
                  title: courseTitle,
                  code: courseCode,
                  status: courseStatus,
                  passingGradePercent,
                  allowSelfEnroll,
                  enableProctoring,
                  modules,
                });
                onClose();
              }}
              className="px-5 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 shadow-lg shadow-blue-500/20 transition-all"
            >
              <Save className="h-4 w-4" />
              <span>Save & Publish</span>
            </button>
            <button
              onClick={onClose}
              className="p-1 rounded-xl hover:bg-slate-800 text-slate-400 hover:text-white transition-colors"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Content Area */}
        <div className="flex-1 p-6 overflow-y-auto grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* Main Course Modules Column */}
          <div className="md:col-span-2 space-y-6">
            {/* Title, Code & Status */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="sm:col-span-2 space-y-1.5">
                <label className="text-xs font-semibold text-slate-400">Course Title</label>
                <input
                  type="text"
                  value={courseTitle}
                  onChange={(e) => setCourseTitle(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2 text-xs text-white focus:outline-none focus:border-blue-500"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-400">Course Code</label>
                <input
                  type="text"
                  value={courseCode}
                  onChange={(e) => setCourseCode(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2 text-xs text-white focus:outline-none focus:border-blue-500 font-mono"
                />
              </div>
            </div>

            {/* Course Settings Bar */}
            <div className="bg-slate-950 border border-slate-800 rounded-2xl p-4 grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs">
              <div>
                <label className="text-slate-400 font-semibold block mb-1">Publication Status</label>
                <select
                  value={courseStatus}
                  onChange={(e) => setCourseStatus(e.target.value as any)}
                  className="w-full bg-slate-900 border border-slate-800 rounded-xl px-3 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-blue-500 font-medium"
                >
                  <option value="DRAFT">DRAFT (Unpublished)</option>
                  <option value="PUBLISHED">PUBLISHED (Active)</option>
                  <option value="ARCHIVED">ARCHIVED (Read-Only)</option>
                </select>
              </div>

              <div>
                <div className="flex justify-between text-slate-400 font-semibold mb-1">
                  <span>Passing Score</span>
                  <span className="text-blue-400">{passingGradePercent}%</span>
                </div>
                <input
                  type="range"
                  min="50"
                  max="100"
                  value={passingGradePercent}
                  onChange={(e) => setPassingGradePercent(Number(e.target.value))}
                  className="w-full accent-blue-600 mt-1"
                />
              </div>

              <div className="space-y-1.5 pt-1">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={allowSelfEnroll}
                    onChange={(e) => setAllowSelfEnroll(e.target.checked)}
                    className="rounded bg-slate-900 border-slate-700 text-blue-600"
                  />
                  <span className="text-slate-300">Allow Self-Enrollment</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={enableProctoring}
                    onChange={(e) => setEnableProctoring(e.target.checked)}
                    className="rounded bg-slate-900 border-slate-700 text-blue-600"
                  />
                  <span className="text-slate-300">Mandate AI Proctoring</span>
                </label>
              </div>
            </div>

            {/* Modules List */}
            <div className="space-y-4">
              <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400">
                  Curriculum Modules ({modules.length})
                </h4>
                <button
                  onClick={addModule}
                  className="text-xs font-semibold text-blue-400 hover:text-blue-300 flex items-center gap-1"
                >
                  <Plus className="h-3.5 w-3.5" />
                  <span>Add Module</span>
                </button>
              </div>

              {modules.map((mod, modIdx) => (
                <div key={mod.id} className="bg-slate-950 border border-slate-800 rounded-2xl p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-xs text-slate-200">
                      Module {modIdx + 1}: {mod.title.replace(/^Module \d+: /, "")}
                    </span>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => addLesson(mod.id)}
                        className="text-[11px] text-blue-400 hover:text-blue-300 font-semibold"
                      >
                        + Add Lesson
                      </button>
                      {modules.length > 1 && (
                        <button
                          onClick={() => deleteModule(mod.id)}
                          className="text-slate-500 hover:text-rose-400 transition-colors"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  </div>

                  <div className="space-y-2">
                    {mod.lessons.map((les) => (
                      <div
                        key={les.id}
                        className="bg-slate-900 border border-slate-800/80 p-2.5 rounded-xl flex items-center justify-between text-xs"
                      >
                        <div className="flex items-center gap-2 text-slate-300">
                          {les.type === "VIDEO" && <Video className="h-3.5 w-3.5 text-rose-400" />}
                          {les.type === "CODE" && <Code className="h-3.5 w-3.5 text-emerald-400" />}
                          {les.type === "SCORM" && <Package className="h-3.5 w-3.5 text-amber-400" />}
                          {les.type === "RICHTEXT" && <FileText className="h-3.5 w-3.5 text-blue-400" />}
                          <span>{les.title}</span>
                        </div>
                        <span className="text-[10px] text-slate-500 font-mono">{les.duration}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* AI Curriculum Assistant Sidebar */}
          <div className="border-t md:border-t-0 md:border-l border-slate-800 pt-6 md:pt-0 md:pl-6 space-y-4">
            <div className="flex items-center gap-2 text-xs font-bold text-blue-400 uppercase tracking-wider">
              <Sparkles className="h-4 w-4" />
              <span>AI Curriculum Synthesizer</span>
            </div>

            <p className="text-xs text-slate-400">
              Enter any lecture topic to automatically synthesize Bloom's Taxonomy-aligned quiz items and key takeaways.
            </p>

            <div className="space-y-2">
              <input
                type="text"
                placeholder="e.g. Raft Consensus & Byzantine Faults"
                value={aiTopic}
                onChange={(e) => setAiTopic(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-xs text-white placeholder:text-slate-600 focus:outline-none focus:border-blue-500"
              />
              <button
                disabled={!aiTopic || isGeneratingAi}
                onClick={handleGenerateAiCurriculum}
                className="w-full py-2 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 disabled:opacity-50 text-white rounded-xl text-xs font-semibold shadow-md shadow-blue-500/20 transition-all"
              >
                {isGeneratingAi ? "Synthesizing with AI..." : "Generate Syllabus & Quizzes"}
              </button>
            </div>

            {aiGeneratedItems && (
              <div className="bg-slate-950 border border-slate-800 rounded-xl p-3.5 text-xs space-y-3 max-h-80 overflow-y-auto">
                <div className="flex items-center justify-between">
                  <div className="font-semibold text-slate-200">Generated Takeaways</div>
                  <button
                    onClick={handleApplyAiToModules}
                    className="px-2.5 py-1 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-[10px] font-bold transition-all shadow-md"
                  >
                    + Inject as Module
                  </button>
                </div>

                <ul className="space-y-1 text-[11px] text-slate-400 list-disc list-inside">
                  {aiGeneratedItems.keyTakeaways.map((k: string, idx: number) => (
                    <li key={idx}>{k}</li>
                  ))}
                </ul>

                <div className="font-semibold text-slate-200 pt-2 border-t border-slate-800">
                  Synthesized Quiz Questions ({aiGeneratedItems.recommendedQuiz.length})
                </div>
                {aiGeneratedItems.recommendedQuiz.map((q: any, idx: number) => (
                  <div key={idx} className="bg-slate-900 p-2 rounded border border-slate-800/80 text-[11px] space-y-1">
                    <span className="text-amber-400 font-bold uppercase text-[9px]">{q.taxonomyLevel}</span>
                    <p className="text-slate-300 font-medium">{q.questionText}</p>
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
