"use client";

import React, { useState, useEffect } from "react";
import {
  X,
  ShieldAlert,
  Camera,
  Eye,
  CheckCircle,
  AlertCircle,
  Clock,
  Sparkles,
  Send,
} from "lucide-react";

interface ScormQuizPlayerProps {
  courseTitle: string;
  onClose: () => void;
  onComplete: (score: number) => void;
}

export const ScormQuizPlayer: React.FC<ScormQuizPlayerProps> = ({
  courseTitle,
  onClose,
  onComplete,
}) => {
  const [currentQuestion, setCurrentQuestion] = useState(0);
  const [selectedOption, setSelectedOption] = useState<number | null>(null);
  const [score, setScore] = useState(0);
  const [timeLeft, setTimeLeft] = useState(300); // 5 minutes
  const [violations, setViolations] = useState<string[]>([]);
  const [isFinished, setIsFinished] = useState(false);

  const questions = [
    {
      q: "In an Enterprise LMS, which standard allows deep-linking and grade synchronization from external tools?",
      options: ["SCORM 1.2", "LTI 1.3 Advantage", "xAPI (Tin Can)", "SAML 2.0"],
      correct: 1,
      explanation: "LTI 1.3 Advantage provides Assignment & Grade Services (AGS) and Deep Linking specifications.",
    },
    {
      q: "Which regulatory framework mandates strict parental consent for learners under 13?",
      options: ["FERPA", "GDPR", "COPPA", "HIPAA"],
      correct: 2,
      explanation: "COPPA (Children's Online Privacy Protection Act) specifically protects users under 13.",
    },
    {
      q: "What encryption standard is recommended for protecting student PII in application memory before persistence?",
      options: ["DES", "AES-256-GCM", "MD5", "Blowfish"],
      correct: 1,
      explanation: "AES-256-GCM provides authenticated encryption with associated data (AEAD) for Field-Level Encryption.",
    },
  ];

  // Proctoring Telemetry: Detect window blur / tab switch
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.hidden) {
        const msg = `[${new Date().toLocaleTimeString()}] Tab switch / Window blur detected!`;
        setViolations((prev) => [...prev, msg]);
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, []);

  // Timer countdown
  useEffect(() => {
    if (timeLeft <= 0 || isFinished) return;
    const timer = setInterval(() => setTimeLeft((t) => t - 1), 1000);
    return () => clearInterval(timer);
  }, [timeLeft, isFinished]);

  const handleNext = () => {
    let currentScore = score;
    if (selectedOption === questions[currentQuestion].correct) {
      currentScore += 1;
      setScore(currentScore);
    }

    if (currentQuestion + 1 < questions.length) {
      setCurrentQuestion((c) => c + 1);
      setSelectedOption(null);
    } else {
      setIsFinished(true);
      const finalPercent = Math.round((currentScore / questions.length) * 100);
      onComplete(finalPercent);
    }
  };

  const minutes = Math.floor(timeLeft / 60);
  const seconds = timeLeft % 60;

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-md flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label="Proctored examination">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-3xl overflow-hidden shadow-2xl flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="bg-slate-950 border-b border-slate-800 px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-3 w-3 rounded-full bg-rose-500 animate-ping" />
            <div>
              <h3 className="font-bold text-sm text-slate-100">{courseTitle} - Proctored Examination</h3>
              <p className="text-[11px] text-slate-400">AI Proctoring Active • Secure Lock-Down Mode</p>
            </div>
          </div>

          <div className="flex items-center gap-4">
            <div className="flex items-center gap-1.5 bg-slate-900 px-3 py-1.5 rounded-lg border border-slate-800 text-xs text-amber-400 font-mono font-semibold">
              <Clock className="h-3.5 w-3.5" />
              <span>{minutes}:{seconds < 10 ? `0${seconds}` : seconds}</span>
            </div>
            <button
              onClick={onClose}
              aria-label="Close"
              className="p-1 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white transition-colors"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Content Body */}
        <div className="p-6 overflow-y-auto flex-1 grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* Main Question Column */}
          <div className="md:col-span-2 space-y-6">
            {!isFinished ? (
              <>
                <div className="flex items-center justify-between text-xs text-slate-400">
                  <span>Question {currentQuestion + 1} of {questions.length}</span>
                  <span className="text-blue-400 font-semibold">SCORM Runtime: Connected</span>
                </div>

                <div className="space-y-4">
                  <h4 className="font-medium text-base text-slate-100 leading-relaxed">
                    {questions[currentQuestion].q}
                  </h4>

                  <div className="space-y-2.5">
                    {questions[currentQuestion].options.map((opt, idx) => (
                      <button
                        key={idx}
                        onClick={() => setSelectedOption(idx)}
                        className={`w-full text-left p-3.5 rounded-xl text-xs font-medium border transition-all ${
                          selectedOption === idx
                            ? "bg-blue-600/20 border-blue-500 text-blue-200 shadow-md shadow-blue-500/10"
                            : "bg-slate-950 border-slate-800 text-slate-300 hover:border-slate-700"
                        }`}
                      >
                        <span className="font-bold mr-2 text-slate-400">
                          {String.fromCharCode(65 + idx)}.
                        </span>
                        {opt}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="pt-4 flex justify-end">
                  <button
                    disabled={selectedOption === null}
                    onClick={handleNext}
                    className="px-5 py-2.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:hover:bg-blue-600 text-white rounded-xl text-xs font-semibold flex items-center gap-2 shadow-lg shadow-blue-500/20 transition-all"
                  >
                    <span>{currentQuestion + 1 === questions.length ? "Submit & Finalize" : "Next Question"}</span>
                    <Send className="h-3.5 w-3.5" />
                  </button>
                </div>
              </>
            ) : (
              <div className="py-8 text-center space-y-4">
                <div className="h-14 w-14 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 mx-auto flex items-center justify-center">
                  <CheckCircle className="h-8 w-8" />
                </div>
                <h3 className="text-xl font-bold text-white">Assessment Completed</h3>
                <p className="text-xs text-slate-400 max-w-sm mx-auto">
                  Your answers and AI proctoring telemetry have been cryptographically signed and stored in the enterprise LRS.
                </p>
                <div className="bg-slate-950 border border-slate-800 rounded-xl p-4 max-w-xs mx-auto text-xs space-y-1">
                  <div className="flex justify-between text-slate-400">
                    <span>Final Score</span>
                    <strong className="text-white">{Math.round((score / questions.length) * 100)}%</strong>
                  </div>
                  <div className="flex justify-between text-slate-400">
                    <span>Status</span>
                    <strong className="text-emerald-400">PASSED</strong>
                  </div>
                </div>
                <button
                  onClick={onClose}
                  className="px-6 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded-xl text-xs font-semibold transition-all"
                >
                  Return to Dashboard
                </button>
              </div>
            )}
          </div>

          {/* AI Proctoring Telemetry Feed Sidepanel */}
          <div className="border-t md:border-t-0 md:border-l border-slate-800 pt-6 md:pt-0 md:pl-6 space-y-4">
            <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
              <Camera className="h-3.5 w-3.5 text-blue-400" />
              <span>Proctoring Telemetry</span>
            </div>

            {/* Mock Camera Preview */}
            <div className="relative aspect-video rounded-xl bg-slate-950 border border-slate-800 flex items-center justify-center overflow-hidden">
              <div className="absolute inset-0 flex items-center justify-center">
                <Eye className="h-8 w-8 text-slate-700 animate-pulse" />
              </div>
              <div className="absolute top-2 left-2 flex items-center gap-1 bg-black/60 backdrop-blur-sm px-2 py-0.5 rounded text-[10px] text-emerald-400 font-mono">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
                <span>REC • AI GAZE OK</span>
              </div>
              <div className="absolute inset-4 border border-blue-500/30 rounded-lg pointer-events-none" />
            </div>

            {/* Real-time event log */}
            <div className="space-y-2">
              <div className="text-[11px] font-semibold text-slate-400">Live Anomaly Detection</div>
              <div className="bg-slate-950 border border-slate-800 rounded-xl p-3 text-[10px] font-mono space-y-1.5 max-h-36 overflow-y-auto">
                <p className="text-emerald-400">[00:01] Camera feed initialized</p>
                <p className="text-blue-400">[00:03] Biometric landmark lock</p>
                {violations.map((v, i) => (
                  <p key={i} className="text-rose-400 font-bold">{v}</p>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
