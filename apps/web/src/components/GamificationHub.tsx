"use client";

import React, { useState } from "react";
import {
  X,
  Flame,
  Award,
  Sparkles,
  CheckCircle2,
  Trophy,
  Shield,
  Download,
  Star,
  Zap,
  TrendingUp,
} from "lucide-react";
import { OpenBadgesEngine } from "@enterprise-lms/standards";

interface GamificationHubProps {
  onClose: () => void;
  streakDays?: number;
  userEmail?: string;
  userName?: string;
}

export const GamificationHub: React.FC<GamificationHubProps> = ({
  onClose,
  streakDays = 14,
  userEmail = "alex.chen@harvard.edu",
  userName = "Alex Chen",
}) => {
  const [activeTab, setActiveTab] = useState<"BADGES" | "SKILLS" | "LEADERBOARD">("BADGES");
  const [streak, setStreak] = useState(streakDays);
  const [claimedDailyBonus, setClaimedDailyBonus] = useState(false);
  const [xpPoints, setXpPoints] = useState(3850);

  const handleClaimBonus = () => {
    if (claimedDailyBonus) return;
    setStreak((prev) => prev + 1);
    setXpPoints((prev) => prev + 150);
    setClaimedDailyBonus(true);
  };

  const handleExportOpenBadge = (badgeTitle: string) => {
    const credential = OpenBadgesEngine.issueBadge(
      userName,
      userEmail,
      badgeTitle,
      "ApexLMS Educational Authority",
      "https://learn.university.edu"
    );

    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(credential, null, 2));
    const downloadAnchor = document.createElement("a");
    downloadAnchor.setAttribute("href", dataStr);
    downloadAnchor.setAttribute("download", `${badgeTitle.toLowerCase().replace(/\s+/g, "_")}_badge.json`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
  };

  const badges = [
    {
      id: "badge_1",
      title: "Distributed Consensus Architect",
      course: "CS-101",
      dateEarned: "October 2026",
      criteria: "Completed Raft split-brain lab & proctored midterm with > 90% score.",
      color: "from-blue-600 to-indigo-600",
      tier: "GOLD",
    },
    {
      id: "badge_2",
      title: "FERPA Cryptography Defender",
      course: "DS-201",
      dateEarned: "September 2026",
      criteria: "Implemented AES-256-GCM field-level encryption with authenticated tags.",
      color: "from-purple-600 to-pink-600",
      tier: "PLATINUM",
    },
    {
      id: "badge_3",
      title: "Transformer Attention Pioneer",
      course: "AI-301",
      dateEarned: "September 2026",
      criteria: "Trained multi-head self-attention models on high-performance tensors.",
      color: "from-emerald-600 to-teal-600",
      tier: "SILVER",
    },
  ];

  const skills = [
    { name: "Distributed Consensus (Raft/Paxos)", mastery: 92, level: "Advanced" },
    { name: "Field-Level Encryption (AES-256-GCM)", mastery: 88, level: "Proficient" },
    { name: "Microservices & Zero-Trust Ingress", mastery: 85, level: "Proficient" },
    { name: "Neural Attention Architectures", mastery: 74, level: "Intermediate" },
    { name: "High-Throughput xAPI / LRS Pipelines", mastery: 95, level: "Expert" },
  ];

  const leaderboard = [
    { rank: 1, name: "Maria Rodriguez", xp: 4420, streak: 28, badge: "🏆 Lead Scholar" },
    { rank: 2, name: "Alex Chen (You)", xp: xpPoints, streak: streak, badge: "⭐ Top 3%" },
    { rank: 3, name: "Liam Johnson", xp: 3610, streak: 12, badge: "🔥 Challenger" },
    { rank: 4, name: "Sophia Wang", xp: 3450, streak: 19, badge: "💡 Innovator" },
    { rank: 5, name: "Ethan Brooks", xp: 3120, streak: 9, badge: "📚 Rising Star" },
  ];

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/85 backdrop-blur-md flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-slate-800 rounded-3xl w-full max-w-5xl h-[88vh] flex flex-col overflow-hidden shadow-2xl">
        {/* Header */}
        <div className="bg-slate-950 border-b border-slate-800 px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-2xl bg-amber-500/20 border border-amber-500/40 flex items-center justify-center text-amber-400">
              <Trophy className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-bold text-base text-white">Gamification & Achievement Hub</h3>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-950 text-amber-400 border border-amber-800">
                  Level 7 Scholar
                </span>
              </div>
              <p className="text-xs text-slate-400">
                Study streaks, Bloom's mastery progress, and 1EdTech Open Badges 3.0.
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1 rounded-xl hover:bg-slate-800 text-slate-400 hover:text-white transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Top XP & Daily Streak Banner */}
        <div className="bg-gradient-to-r from-amber-950/30 via-slate-950 to-indigo-950/30 border-b border-slate-800 p-6 flex flex-col sm:flex-row items-center justify-between gap-6">
          <div className="flex items-center gap-4">
            <div className="h-14 w-14 rounded-2xl bg-amber-500/20 text-amber-400 border border-amber-500/40 flex items-center justify-center">
              <Flame className="h-8 w-8" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h4 className="text-2xl font-extrabold text-white">{streak} Day Streak!</h4>
                {claimedDailyBonus ? (
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-950 text-emerald-400 border border-emerald-800">
                    Daily Bonus Claimed
                  </span>
                ) : (
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-950 text-amber-400 border border-amber-800 animate-pulse">
                    +150 XP Ready
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                Keep studying every day to unlock the 30-Day Master Scholar credential.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {!claimedDailyBonus && (
              <button
                onClick={handleClaimBonus}
                className="px-4 py-2 bg-gradient-to-r from-amber-600 to-amber-500 hover:from-amber-500 hover:to-amber-400 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 shadow-lg shadow-amber-500/20 transition-all"
              >
                <Zap className="h-3.5 w-3.5" />
                <span>Claim Daily +150 XP</span>
              </button>
            )}
            <div className="bg-slate-900 border border-slate-800 px-4 py-2 rounded-xl text-center">
              <div className="text-[10px] text-slate-400">Total Mastery XP</div>
              <div className="text-sm font-bold text-white">{xpPoints} XP</div>
            </div>
          </div>
        </div>

        {/* Tab Navigation */}
        <div className="bg-slate-950/60 border-b border-slate-800 px-6 py-2.5 flex items-center gap-2">
          {[
            { id: "BADGES", label: "Open Badges (3.0)", icon: Award },
            { id: "SKILLS", label: "Bloom's Competency Radar", icon: TrendingUp },
            { id: "LEADERBOARD", label: "Cohort Leaderboard", icon: Trophy },
          ].map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as any)}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold flex items-center gap-2 transition-all ${
                  activeTab === tab.id
                    ? "bg-blue-600 text-white shadow-md shadow-blue-500/20"
                    : "text-slate-400 hover:text-slate-200 hover:bg-slate-900"
                }`}
              >
                <Icon className="h-3.5 w-3.5" />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>

        {/* Main Content Area */}
        <div className="flex-1 p-6 overflow-y-auto">
          {activeTab === "BADGES" && (
            <div className="space-y-4">
              <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                <div>
                  <h4 className="text-xs font-bold uppercase tracking-wider text-slate-300">
                    1EdTech & W3C Cryptographic Credentials ({badges.length})
                  </h4>
                  <p className="text-[11px] text-slate-400">
                    Digitally signed with SHA-256 cryptographic proofs and portable across Open Badge backpacks.
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {badges.map((b) => (
                  <div
                    key={b.id}
                    className="bg-slate-950 border border-slate-800 rounded-2xl p-5 flex flex-col justify-between space-y-4 shadow-lg group hover:border-slate-700 transition-all"
                  >
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-blue-900/40 text-blue-300 border border-blue-700/50">
                          {b.course}
                        </span>
                        <span className="text-[9px] font-bold px-2 py-0.5 rounded bg-amber-950 text-amber-400 border border-amber-800">
                          {b.tier}
                        </span>
                      </div>

                      <div className="h-12 w-12 rounded-2xl bg-gradient-to-br from-blue-600 to-indigo-600 flex items-center justify-center text-white shadow-lg shadow-blue-500/30">
                        <Award className="h-6 w-6" />
                      </div>

                      <div>
                        <h4 className="font-bold text-sm text-white group-hover:text-blue-400 transition-colors">
                          {b.title}
                        </h4>
                        <p className="text-[11px] text-slate-400 mt-1 leading-relaxed">
                          {b.criteria}
                        </p>
                      </div>
                    </div>

                    <div className="pt-3 border-t border-slate-900 flex items-center justify-between">
                      <span className="text-[10px] text-slate-500">{b.dateEarned}</span>
                      <button
                        onClick={() => handleExportOpenBadge(b.title)}
                        className="px-2.5 py-1 bg-slate-900 hover:bg-blue-600 text-slate-300 hover:text-white rounded-lg text-[10px] font-bold flex items-center gap-1 border border-slate-800 transition-all"
                      >
                        <Download className="h-3 w-3" />
                        <span>Export JSON-LD</span>
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {activeTab === "SKILLS" && (
            <div className="space-y-4 max-w-2xl mx-auto">
              <div>
                <h4 className="text-xs font-bold uppercase tracking-wider text-slate-300">
                  Bloom's Taxonomy Competency Profile
                </h4>
                <p className="text-[11px] text-slate-400">
                  Calculated from rubric evaluations, in-browser code sandbox labs, and proctored quizzes.
                </p>
              </div>

              <div className="space-y-4">
                {skills.map((s, idx) => (
                  <div key={idx} className="bg-slate-950 border border-slate-800 p-4 rounded-2xl space-y-2">
                    <div className="flex items-center justify-between text-xs font-semibold">
                      <span className="text-slate-200">{s.name}</span>
                      <span className="text-blue-400">{s.mastery}% ({s.level})</span>
                    </div>
                    <div className="w-full bg-slate-900 rounded-full h-2.5 overflow-hidden border border-slate-800">
                      <div
                        className="bg-gradient-to-r from-blue-500 to-indigo-500 h-2.5 rounded-full transition-all duration-700"
                        style={{ width: `${s.mastery}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {activeTab === "LEADERBOARD" && (
            <div className="space-y-4 max-w-2xl mx-auto">
              <div>
                <h4 className="text-xs font-bold uppercase tracking-wider text-slate-300">
                  Fall 2026 Academic Cohort Standings
                </h4>
                <p className="text-[11px] text-slate-400">
                  Based on cumulative weighted scores, laboratory completions, and study streaks.
                </p>
              </div>

              <div className="space-y-2">
                {leaderboard.map((item) => (
                  <div
                    key={item.rank}
                    className={`p-3.5 rounded-2xl border flex items-center justify-between text-xs ${
                      item.name.includes("You")
                        ? "bg-blue-950/40 border-blue-600/60 shadow-md"
                        : "bg-slate-950 border-slate-800/80"
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <div className={`h-7 w-7 rounded-xl flex items-center justify-center font-bold text-xs ${
                        item.rank === 1
                          ? "bg-amber-500/20 text-amber-400 border border-amber-500/40"
                          : item.rank === 2
                          ? "bg-blue-500/20 text-blue-400 border border-blue-500/40"
                          : "bg-slate-800 text-slate-400"
                      }`}>
                        #{item.rank}
                      </div>
                      <div>
                        <strong className="text-slate-200 block">{item.name}</strong>
                        <span className="text-[10px] text-slate-500">{item.badge}</span>
                      </div>
                    </div>

                    <div className="flex items-center gap-4 text-right">
                      <div>
                        <div className="font-bold text-white">{item.xp} XP</div>
                        <div className="text-[10px] text-amber-400 font-medium">🔥 {item.streak}d streak</div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
