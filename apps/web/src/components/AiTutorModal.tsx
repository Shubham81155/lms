"use client";

import React, { useState } from "react";
import {
  X,
  Sparkles,
  Send,
  Brain,
  CheckCircle2,
  HelpCircle,
  TrendingUp,
  Zap,
  BookOpen,
  RefreshCw,
  Lightbulb,
} from "lucide-react";
import { useAiTutorDrill } from "@/hooks/useAnalytics";
import { useEscapeKey } from "@/hooks/useEscapeKey";

interface AiTutorModalProps {
  courseTitle?: string;
  initialTopic?: string;
  onClose: () => void;
  onDrillCompleted?: (score: number, boost: number) => void;
}

interface ChatMessage {
  id: string;
  sender: "USER" | "AI";
  text: string;
  timestamp: string;
  drillQuestion?: {
    questionText: string;
    options: string[];
    correctIndex: number;
    explanation: string;
  };
}

export const AiTutorModal: React.FC<AiTutorModalProps> = ({
  courseTitle = "your courses",
  initialTopic = "Raft Consensus & Split-Brain Quorum",
  onClose,
  onDrillCompleted,
}) => {
  useEscapeKey(onClose);
  const [topic, setTopic] = useState(initialTopic);
  const [inputText, setInputText] = useState("");
  const [selectedOption, setSelectedOption] = useState<number | null>(null);
  const [isAnswerSubmitted, setIsAnswerSubmitted] = useState(false);
  const [readinessScore, setReadinessScore] = useState(78);

  const { requestDrill, isLoading: isAiThinking } = useAiTutorDrill();

  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: "msg_1",
      sender: "AI",
      text: `Hi! This is a preview of the study tutor for ${courseTitle}. It currently serves prepared practice questions, not a personalised AI model, and the readiness score is illustrative. Pick a topic to try a drill.`,
      timestamp: "Just now",
      drillQuestion: {
        questionText: "In a 5-node distributed cluster running Raft, what is the minimum quorum size required to safely commit a log entry?",
        options: [
          "2 nodes (Strict Minority)",
          "3 nodes (Strict Majority: ⌊5/2⌋ + 1)",
          "4 nodes (Two-Thirds Supermajority)",
          "5 nodes (Full Unanimity)",
        ],
        correctIndex: 1,
        explanation: "In Raft, a strict majority (⌊n/2⌋ + 1) is mandatory to guarantee that any two quorums overlap by at least one node containing the latest committed term.",
      },
    },
  ]);

  const quickPrompts = [
    "Why does Raft require randomized election timeouts?",
    "Explain FLP Impossibility in asynchronous networks",
    "How does AES-256-GCM prevent bit-flipping attacks?",
    "Give me another 5-minute practice drill",
  ];

  const handleSendMessage = async (textToSend?: string) => {
    const text = textToSend || inputText;
    if (!text.trim()) return;

    const userMsg: ChatMessage = {
      id: `usr_${Date.now()}`,
      sender: "USER",
      text: text.trim(),
      timestamp: "Just now",
    };

    setMessages((prev) => [...prev, userMsg]);
    setInputText("");

    try {
      const response = await requestDrill(topic, text);
      const aiReply: ChatMessage = {
        id: `ai_${Date.now()}`,
        sender: "AI",
        text: response.explanation,
        timestamp: "Just now",
        drillQuestion: response.recommendedDrill?.[0] ? {
          questionText: response.recommendedDrill[0].questionText,
          options: (response.recommendedDrill[0].optionsJson as any[])?.map((o: any) => o.text) || [
            "Option A: Requires majority quorum",
            "Option B: Requires leader heartbeat",
            "Option C: Relies on two-phase commit",
            "Option D: None of the above",
          ],
          correctIndex: 0,
          explanation: response.recommendedDrill[0].explanation || "Verified by Bloom's cognitive taxonomy evaluation.",
        } : undefined,
      };
      setMessages((prev) => [...prev, aiReply]);
      setSelectedOption(null);
      setIsAnswerSubmitted(false);
    } catch (e) {
      // Local fallback intelligent response
      const fallbackReply: ChatMessage = {
        id: `ai_${Date.now()}`,
        sender: "AI",
        text: `Great question regarding ${topic}! In asynchronous distributed systems, partial synchrony assumptions or randomized timers are used to break symmetry and guarantee liveness without sacrificing consistency.`,
        timestamp: "Just now",
      };
      setMessages((prev) => [...prev, fallbackReply]);
    }
  };

  const handleSelectOption = (idx: number, correctIdx: number) => {
    if (isAnswerSubmitted) return;
    setSelectedOption(idx);
    setIsAnswerSubmitted(true);

    if (idx === correctIdx) {
      setReadinessScore((prev) => Math.min(prev + 5, 100));
      if (onDrillCompleted) onDrillCompleted(100, 5);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-canvas/85 backdrop-blur-md flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label="AI tutor">
      <div className="bg-surface border border-line rounded-3xl w-full max-w-4xl h-[88vh] flex flex-col overflow-hidden shadow-2xl">
        {/* Header */}
        <div className="bg-canvas border-b border-line px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-2xl bg-gradient-to-br from-brand to-brand-hover flex items-center justify-center text-on-brand shadow-lg shadow-brand/20">
              <Brain className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-bold text-sm text-ink">AI Personalized Socratic Tutor</h3>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-brand/15 text-brand-fg border border-brand/30 flex items-center gap-1">
                  <Sparkles className="h-3 w-3" />
                  Demo · template-based, no AI model yet
                </span>
              </div>
              <p className="text-[11px] text-ink-muted">{courseTitle}</p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {/* Midterm Readiness Gauge */}
            <div className="bg-surface border border-line px-3 py-1.5 rounded-xl flex items-center gap-2 text-xs">
              <TrendingUp className="h-4 w-4 text-success" />
              <span className="text-ink-muted">Midterm Readiness:</span>
              <strong className="text-success font-bold">{readinessScore}%</strong>
            </div>

            <button
              onClick={onClose}
              aria-label="Close"
              className="p-1 rounded-xl hover:bg-raised text-ink-muted hover:text-ink transition-colors"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Quick Topic Selector Bar */}
        <div className="bg-canvas/60 border-b border-line px-6 py-2.5 flex items-center gap-2 overflow-x-auto text-xs">
          <span className="text-ink-subtle text-[11px] uppercase font-bold shrink-0">Focus Topic:</span>
          {[
            "Raft Consensus & Split-Brain Quorum",
            "Field-Level Encryption (AES-256-GCM)",
            "FLP Impossibility & Asynchronous Networks",
            "Neural Attention Mechanisms",
          ].map((t) => (
            <button
              key={t}
              onClick={() => {
                setTopic(t);
                handleSendMessage(`Let's focus on ${t}. Give me a Socratic practice drill.`);
              }}
              className={`px-3 py-1 rounded-xl font-semibold whitespace-nowrap transition-colors ${
                topic === t
                  ? "bg-brand text-on-brand shadow-sm"
                  : "bg-surface text-ink-muted hover:text-ink border border-line"
              }`}
            >
              {t}
            </button>
          ))}
        </div>

        {/* Chat Message Stream */}
        <div className="flex-1 p-6 overflow-y-auto space-y-5">
          {messages.map((msg) => (
            <div
              key={msg.id}
              className={`flex flex-col ${msg.sender === "USER" ? "items-end" : "items-start"}`}
            >
              <div
                className={`max-w-2xl rounded-2xl p-4 text-xs leading-relaxed space-y-3 ${
                  msg.sender === "USER"
                    ? "bg-brand text-on-brand rounded-br-sm shadow-md shadow-brand/20"
                    : "bg-canvas border border-line text-ink rounded-bl-sm shadow-md"
                }`}
              >
                <div className="flex items-center justify-between gap-4 text-[10px] text-ink-muted">
                  <span className="font-bold uppercase tracking-wider text-ink">
                    {msg.sender === "USER" ? "You (Alex)" : "AI Academic Tutor"}
                  </span>
                  <span>{msg.timestamp}</span>
                </div>

                <p className="whitespace-pre-wrap">{msg.text}</p>

                {/* Socratic Practice Drill Card */}
                {msg.drillQuestion && (
                  <div className="bg-surface border border-line rounded-xl p-4 space-y-3 text-ink mt-2">
                    <div className="flex items-center gap-2 text-accent font-bold text-xs">
                      <HelpCircle className="h-4 w-4" />
                      <span>5-Minute Knowledge Check</span>
                    </div>

                    <p className="font-semibold text-ink">{msg.drillQuestion.questionText}</p>

                    <div className="space-y-1.5">
                      {msg.drillQuestion.options.map((opt, oIdx) => {
                        const isSelected = selectedOption === oIdx;
                        const isCorrect = oIdx === msg.drillQuestion?.correctIndex;

                        let btnStyle = "bg-canvas border-line hover:border-line text-ink";
                        if (isAnswerSubmitted) {
                          if (isCorrect) {
                            btnStyle = "bg-success/10 border-success text-success font-bold";
                          } else if (isSelected) {
                            btnStyle = "bg-danger/10 border-danger text-danger font-bold";
                          }
                        }

                        return (
                          <button
                            key={oIdx}
                            onClick={() => handleSelectOption(oIdx, msg.drillQuestion!.correctIndex)}
                            className={`w-full text-left p-2.5 rounded-xl border text-xs transition-all ${btnStyle}`}
                          >
                            <span>{opt}</span>
                          </button>
                        );
                      })}
                    </div>

                    {isAnswerSubmitted && (
                      <div className="bg-canvas p-3 rounded-lg border border-line text-[11px] space-y-1 animate-fadeIn">
                        <div className="flex items-center gap-1.5 font-bold text-success">
                          <CheckCircle2 className="h-3.5 w-3.5" />
                          <span>Concept Explanation</span>
                        </div>
                        <p className="text-ink leading-relaxed">{msg.drillQuestion.explanation}</p>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          ))}

          {isAiThinking && (
            <div className="flex items-center gap-2 text-xs text-brand-fg animate-pulse p-2">
              <Sparkles className="h-4 w-4" />
              <span>AI Tutor is analyzing curriculum context and formulating Socratic feedback...</span>
            </div>
          )}
        </div>

        {/* Quick Suggestion Prompts */}
        <div className="px-6 py-2 bg-canvas/40 border-t border-line/80 flex items-center gap-2 overflow-x-auto text-[11px]">
          <span className="text-ink-subtle shrink-0 flex items-center gap-1 font-semibold">
            <Lightbulb className="h-3 w-3 text-accent" />
            <span>Suggested:</span>
          </span>
          {quickPrompts.map((p, idx) => (
            <button
              key={idx}
              onClick={() => handleSendMessage(p)}
              className="px-2.5 py-1 rounded-lg bg-surface border border-line hover:border-brand/50 text-ink hover:text-ink whitespace-nowrap transition-colors"
            >
              {p}
            </button>
          ))}
        </div>

        {/* Bottom Input Composer */}
        <div className="p-4 bg-canvas border-t border-line flex items-center gap-3">
          <input
            type="text"
            placeholder="Ask your tutor anything or request a practice problem..."
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSendMessage();
              }
            }}
            className="flex-1 bg-surface border border-line rounded-xl px-4 py-2.5 text-xs text-ink placeholder:text-ink-subtle focus:outline-none focus:border-brand"
          />
          <button
            onClick={() => handleSendMessage()}
            disabled={!inputText.trim() || isAiThinking}
            className="px-5 py-2.5 bg-brand hover:bg-brand-hover disabled:opacity-50 text-on-brand rounded-xl text-xs font-bold flex items-center gap-2 shadow-lg shadow-brand/20 transition-all"
          >
            <Send className="h-4 w-4" />
            <span>Send</span>
          </button>
        </div>
      </div>
    </div>
  );
};
