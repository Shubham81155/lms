"use client";

import React, { useState } from "react";
import {
  X,
  Mic,
  MicOff,
  Video,
  VideoOff,
  Users,
  Grid,
  BarChart2,
  Hand,
  MessageSquare,
  Share2,
  Sparkles,
} from "lucide-react";
import { useEscapeKey } from "@/hooks/useEscapeKey";

interface LiveClassroomProps {
  courseTitle: string;
  onClose: () => void;
}

export const LiveClassroom: React.FC<LiveClassroomProps> = ({ courseTitle, onClose }) => {
  useEscapeKey(onClose);
  const [isMuted, setIsMuted] = useState(false);
  const [isVideoOn, setIsVideoOn] = useState(true);
  const [isHandRaised, setIsHandRaised] = useState(false);
  const [activeBreakout, setActiveBreakout] = useState<string | null>(null);
  const [pollVotes, setPollVotes] = useState({ optA: 18, optB: 6, voted: false });

  const participants = [
    { name: "Prof. David Malan", role: "HOST", initials: "DM", color: "bg-blue-600" },
    { name: "Alex Chen (You)", role: "LEARNER", initials: "AC", color: "bg-emerald-600" },
    { name: "Maria Rodriguez", role: "LEARNER", initials: "MR", color: "bg-purple-600" },
    { name: "Liam Johnson", role: "LEARNER", initials: "LJ", color: "bg-amber-600" },
    { name: "Sophia Wang", role: "LEARNER", initials: "SW", color: "bg-rose-600" },
    { name: "Marcus Brody", role: "TEACHING_ASSISTANT", initials: "MB", color: "bg-indigo-600" },
  ];

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/90 backdrop-blur-md flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label="Live lecture">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-5xl h-[85vh] flex flex-col overflow-hidden shadow-2xl">
        {/* Top Live Bar */}
        <div className="bg-slate-950 border-b border-slate-800 px-6 py-3.5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="flex h-3 w-3 relative">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-3 w-3 bg-rose-500" />
            </span>
            <div>
              <h3 className="font-bold text-sm text-slate-100">{courseTitle} - Live Interactive Lecture</h3>
              <p className="text-[11px] text-slate-400">
                WebRTC Mesh Room • {activeBreakout ? `Active: ${activeBreakout}` : "Main Auditorium (128 Students)"}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {/* Breakout room selector */}
            <div className="flex items-center gap-1.5 bg-slate-900 px-3 py-1.5 rounded-lg border border-slate-800 text-xs text-slate-300">
              <Grid className="h-3.5 w-3.5 text-blue-400" />
              <button
                onClick={() => setActiveBreakout(activeBreakout ? null : "Breakout Room 2 (System Architecture)")}
                className="hover:text-white font-medium"
              >
                {activeBreakout ? "Leave Breakout" : "Join Breakout Room"}
              </button>
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

        {/* Center Grid: Video Tiles & Sidepanel */}
        <div className="flex-1 flex overflow-hidden">
          {/* Main Video Tile Canvas */}
          <div className="flex-1 p-5 grid grid-cols-2 md:grid-cols-3 gap-4 bg-slate-950/60 overflow-y-auto">
            {participants.map((p, idx) => (
              <div
                key={idx}
                className={`relative rounded-xl border flex flex-col items-center justify-center p-4 aspect-video overflow-hidden transition-all ${
                  p.role === "HOST"
                    ? "border-blue-500/50 bg-slate-900/90 ring-2 ring-blue-500/20"
                    : "border-slate-800 bg-slate-900/50"
                }`}
              >
                <div className={`h-12 w-12 rounded-full ${p.color} flex items-center justify-center text-white font-bold text-sm shadow-lg`}>
                  {p.initials}
                </div>

                <div className="absolute bottom-2 left-2 right-2 flex items-center justify-between text-[11px] bg-black/60 backdrop-blur-sm px-2 py-1 rounded-md">
                  <span className="truncate text-slate-200 font-medium">{p.name}</span>
                  <span className="text-[10px] text-slate-400 uppercase font-semibold">{p.role === "HOST" ? "Instructor" : "Learner"}</span>
                </div>
              </div>
            ))}
          </div>

          {/* Right Live Interaction Panel: Live Poll & AI Copilot */}
          <div className="w-80 border-l border-slate-800 bg-slate-900/80 p-5 flex flex-col justify-between overflow-y-auto space-y-6">
            {/* Live Poll Widget */}
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-400">
                <BarChart2 className="h-4 w-4 text-blue-400" />
                <span>Active In-Class Poll</span>
              </div>
              <div className="bg-slate-950 border border-slate-800 rounded-xl p-3.5 space-y-3">
                <p className="text-xs font-medium text-slate-200">
                  Should Raft leader heartbeats trigger an immediate write quorum?
                </p>
                <div className="space-y-2">
                  <button
                    onClick={() => setPollVotes((p) => ({ ...p, optA: p.optA + 1, voted: true }))}
                    className={`w-full text-left p-2 rounded-lg text-xs border transition-all ${
                      pollVotes.voted
                        ? "bg-blue-600/20 border-blue-500 text-blue-200"
                        : "bg-slate-900 border-slate-800 hover:border-slate-700 text-slate-300"
                    }`}
                  >
                    <div className="flex justify-between mb-1">
                      <span>A. No, only during log replication</span>
                      <span className="font-bold">{pollVotes.optA} votes</span>
                    </div>
                    <div className="w-full bg-slate-800 h-1.5 rounded-full overflow-hidden">
                      <div className="bg-blue-500 h-1.5" style={{ width: `${(pollVotes.optA / (pollVotes.optA + pollVotes.optB)) * 100}%` }} />
                    </div>
                  </button>

                  <button
                    onClick={() => setPollVotes((p) => ({ ...p, optB: p.optB + 1, voted: true }))}
                    className="w-full text-left p-2 rounded-lg text-xs bg-slate-900 border border-slate-800 hover:border-slate-700 text-slate-300"
                  >
                    <div className="flex justify-between mb-1">
                      <span>B. Yes, always on heartbeat</span>
                      <span className="font-bold">{pollVotes.optB} votes</span>
                    </div>
                    <div className="w-full bg-slate-800 h-1.5 rounded-full overflow-hidden">
                      <div className="bg-slate-600 h-1.5" style={{ width: `${(pollVotes.optB / (pollVotes.optA + pollVotes.optB)) * 100}%` }} />
                    </div>
                  </button>
                </div>
              </div>
            </div>

            {/* AI Lecture Transcript & Key Takeaways */}
            <div className="bg-gradient-to-br from-blue-950/40 to-slate-900 border border-blue-800/30 rounded-xl p-3.5 space-y-2">
              <div className="flex items-center gap-1.5 text-blue-300 text-xs font-semibold">
                <Sparkles className="h-3.5 w-3.5 text-blue-400" />
                <span>AI Live Lecture Summary</span>
              </div>
              <p className="text-[11px] text-slate-300 leading-relaxed">
                "Discussion focused on distributed consensus algorithms, network partitioning, and leader election timeouts."
              </p>
            </div>
          </div>
        </div>

        {/* Bottom Media Controls Bar */}
        <div className="bg-slate-950 border-t border-slate-800 px-6 py-3.5 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setIsMuted(!isMuted)}
              className={`p-2.5 rounded-xl border text-xs font-medium flex items-center gap-2 transition-all ${
                isMuted
                  ? "bg-rose-950/80 border-rose-700 text-rose-300"
                  : "bg-slate-900 border-slate-800 text-slate-200 hover:bg-slate-800"
              }`}
            >
              {isMuted ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
              <span>{isMuted ? "Unmute" : "Mute"}</span>
            </button>

            <button
              onClick={() => setIsVideoOn(!isVideoOn)}
              className={`p-2.5 rounded-xl border text-xs font-medium flex items-center gap-2 transition-all ${
                !isVideoOn
                  ? "bg-rose-950/80 border-rose-700 text-rose-300"
                  : "bg-slate-900 border-slate-800 text-slate-200 hover:bg-slate-800"
              }`}
            >
              {!isVideoOn ? <VideoOff className="h-4 w-4" /> : <Video className="h-4 w-4" />}
              <span>{isVideoOn ? "Stop Video" : "Start Video"}</span>
            </button>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setIsHandRaised(!isHandRaised)}
              className={`p-2.5 rounded-xl border text-xs font-medium flex items-center gap-2 transition-all ${
                isHandRaised
                  ? "bg-amber-950/80 border-amber-600 text-amber-300"
                  : "bg-slate-900 border-slate-800 text-slate-200 hover:bg-slate-800"
              }`}
            >
              <Hand className="h-4 w-4" />
              <span>{isHandRaised ? "Hand Raised" : "Raise Hand"}</span>
            </button>

            <button className="p-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold flex items-center gap-2 shadow-lg shadow-blue-500/20 transition-all">
              <Share2 className="h-4 w-4" />
              <span>Share Screen</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
