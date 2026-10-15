"use client";

import React, { useMemo, useState } from "react";
import {
  X,
  Flame,
  Award,
  Trophy,
  Download,
  Zap,
  TrendingUp,
} from "lucide-react";
import { OpenBadgesEngine } from "@enterprise-lms/standards";
import { useAuth } from "@/context/AuthContext";
import { useMyEnrollments } from "@/hooks/useEnrollments";
import { useGamification } from "@/hooks/useEngagement";

interface GamificationHubProps {
  onClose: () => void;
  /** Course whose cohort the leaderboard shows; defaults to the learner's first course. */
  courseId?: string;
}

const tierFor = (grade?: number | null) =>
  grade == null ? "BRONZE" : grade >= 90 ? "GOLD" : grade >= 75 ? "SILVER" : "BRONZE";

const levelLabel = (score: number) =>
  score >= 90 ? "Expert" : score >= 80 ? "Advanced" : score >= 65 ? "Proficient" : score >= 50 ? "Intermediate" : "Developing";

const titleCase = (s: string) => s.charAt(0) + s.slice(1).toLowerCase();

export const GamificationHub: React.FC<GamificationHubProps> = ({ onClose, courseId }) => {
  const { user } = useAuth();
  const { enrollments } = useMyEnrollments();
  const [activeTab, setActiveTab] = useState<"BADGES" | "SKILLS" | "LEADERBOARD">("BADGES");

  const boardCourseId = courseId ?? enrollments.find((e) => e.status !== "DROPPED")?.courseId ?? null;
  const { state, mastery, board, alreadyClaimed, claiming, lastAward, isLoading, error, claim } = useGamification(boardCourseId);

  // A credential is earned by completing a course; it is issued from the learner's real record.
  const badges = useMemo(
    () =>
      enrollments
        .filter((e) => e.status === "COMPLETED")
        .map((e) => ({
          id: e.id,
          title: `${e.course?.title ?? "Course"} Completion`,
          course: e.course?.code ?? "",
          dateEarned: e.completedAt
            ? new Date(e.completedAt).toLocaleDateString(undefined, { month: "long", year: "numeric" })
            : "",
          criteria:
            e.finalGrade != null
              ? `Completed all course requirements with a final grade of ${Math.round(e.finalGrade)}%.`
              : "Completed all course requirements.",
          tier: tierFor(e.finalGrade),
        })),
    [enrollments]
  );

  const handleExportOpenBadge = (badgeTitle: string) => {
    if (!user) return;
    const credential = OpenBadgesEngine.issueBadge(
      user.name,
      user.email,
      badgeTitle,
      user.tenantName || "Issuing institution",
      window.location.origin
    );

    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(credential, null, 2));
    const downloadAnchor = document.createElement("a");
    downloadAnchor.setAttribute("href", dataStr);
    downloadAnchor.setAttribute("download", `${badgeTitle.toLowerCase().replace(/\s+/g, "_")}_badge.json`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
  };

  const xp = state?.xp ?? 0;
  const streak = state?.streakDays ?? 0;

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
                {state && (
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-950 text-amber-400 border border-amber-800">
                    Level {state.level}
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-400">
                Study streaks, Bloom's mastery progress, and 1EdTech Open Badges 3.0.
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            aria-label="Close"
            className="p-1 rounded-xl hover:bg-slate-800 text-slate-400 hover:text-white transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {error && (
          <div role="alert" className="bg-rose-950/60 border-b border-rose-900 px-6 py-2 text-xs text-rose-300">
            {error}
          </div>
        )}

        {/* Top XP & Daily Streak Banner */}
        <div className="bg-gradient-to-r from-amber-950/30 via-slate-950 to-indigo-950/30 border-b border-slate-800 p-6 flex flex-col sm:flex-row items-center justify-between gap-6">
          <div className="flex items-center gap-4">
            <div className="h-14 w-14 rounded-2xl bg-amber-500/20 text-amber-400 border border-amber-500/40 flex items-center justify-center">
              <Flame className="h-8 w-8" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h4 className="text-2xl font-extrabold text-white">
                  {isLoading ? "…" : `${streak} Day Streak${streak === 1 ? "" : "!"}`}
                </h4>
                {!isLoading &&
                  (alreadyClaimed ? (
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-950 text-emerald-400 border border-emerald-800">
                      {lastAward > 0 ? `+${lastAward} XP Claimed` : "Daily Bonus Claimed"}
                    </span>
                  ) : (
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-950 text-amber-400 border border-amber-800 animate-pulse">
                      Daily Bonus Ready
                    </span>
                  ))}
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                {state && state.longestStreak > streak
                  ? `Your longest streak is ${state.longestStreak} days. `
                  : ""}
                Come back every day to keep your streak going.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {!isLoading && !alreadyClaimed && (
              <button
                onClick={claim}
                disabled={claiming}
                className="px-4 py-2 bg-gradient-to-r from-amber-600 to-amber-500 hover:from-amber-500 hover:to-amber-400 disabled:opacity-60 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 shadow-lg shadow-amber-500/20 transition-all"
              >
                <Zap className="h-3.5 w-3.5" />
                <span>{claiming ? "Claiming…" : "Claim Daily Bonus"}</span>
              </button>
            )}
            <div className="bg-slate-900 border border-slate-800 px-4 py-2 rounded-xl text-center min-w-28">
              <div className="text-[10px] text-slate-400">Total XP</div>
              <div className="text-sm font-bold text-white">{xp} XP</div>
              {state && (
                <div className="mt-1 h-1 w-full bg-slate-800 rounded-full overflow-hidden" aria-hidden>
                  <div
                    className="h-1 bg-amber-500"
                    style={{ width: `${Math.round((state.xpIntoLevel / state.xpPerLevel) * 100)}%` }}
                  />
                </div>
              )}
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
                    Earned by completing a course. Exported as portable Open Badges JSON-LD.
                  </p>
                </div>
              </div>

              {badges.length === 0 ? (
                <div className="p-10 text-center text-xs text-slate-500 bg-slate-950 border border-slate-800 rounded-2xl">
                  No credentials yet. Complete a course to earn your first badge.
                </div>
              ) : (
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
                          <p className="text-[11px] text-slate-400 mt-1 leading-relaxed">{b.criteria}</p>
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
              )}
            </div>
          )}

          {activeTab === "SKILLS" && (
            <div className="space-y-4 max-w-2xl mx-auto">
              <div>
                <h4 className="text-xs font-bold uppercase tracking-wider text-slate-300">
                  Bloom's Taxonomy Competency Profile
                </h4>
                <p className="text-[11px] text-slate-400">
                  Calculated from your graded answers to quiz questions tagged by cognitive level.
                </p>
              </div>

              {mastery.length === 0 ? (
                <div className="p-10 text-center text-xs text-slate-500 bg-slate-950 border border-slate-800 rounded-2xl">
                  Nothing to show yet. Your profile appears once quizzes with tagged questions are graded.
                </div>
              ) : (
                <div className="space-y-4">
                  {mastery.map((s) => (
                    <div key={s.level} className="bg-slate-950 border border-slate-800 p-4 rounded-2xl space-y-2">
                      <div className="flex items-center justify-between text-xs font-semibold">
                        <span className="text-slate-200">{titleCase(s.level)}</span>
                        <span className="text-blue-400">
                          {s.score}% ({levelLabel(s.score)})
                        </span>
                      </div>
                      <div className="w-full bg-slate-900 rounded-full h-2.5 overflow-hidden border border-slate-800">
                        <div
                          className="bg-gradient-to-r from-blue-500 to-indigo-500 h-2.5 rounded-full transition-all duration-700"
                          style={{ width: `${s.score}%` }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {activeTab === "LEADERBOARD" && (
            <div className="space-y-4 max-w-2xl mx-auto">
              <div>
                <h4 className="text-xs font-bold uppercase tracking-wider text-slate-300">Cohort Standings</h4>
                <p className="text-[11px] text-slate-400">
                  Learners in your course ranked by XP. Names are abbreviated for privacy.
                </p>
              </div>

              {board.length === 0 ? (
                <div className="p-10 text-center text-xs text-slate-500 bg-slate-950 border border-slate-800 rounded-2xl">
                  {boardCourseId ? "No standings yet." : "Enrol in a course to see cohort standings."}
                </div>
              ) : (
                <div className="space-y-2">
                  {board.map((item) => (
                    <div
                      key={item.userId}
                      className={`p-3.5 rounded-2xl border flex items-center justify-between text-xs ${
                        item.isMe ? "bg-blue-950/40 border-blue-600/60 shadow-md" : "bg-slate-950 border-slate-800/80"
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <div
                          className={`h-7 w-7 rounded-xl flex items-center justify-center font-bold text-xs ${
                            item.rank === 1
                              ? "bg-amber-500/20 text-amber-400 border border-amber-500/40"
                              : item.rank === 2
                              ? "bg-blue-500/20 text-blue-400 border border-blue-500/40"
                              : "bg-slate-800 text-slate-400"
                          }`}
                        >
                          #{item.rank}
                        </div>
                        <div>
                          <strong className="text-slate-200 block">{item.isMe ? `${item.name} (You)` : item.name}</strong>
                          <span className="text-[10px] text-slate-500">Level {item.level}</span>
                        </div>
                      </div>

                      <div className="flex items-center gap-4 text-right">
                        <div>
                          <div className="font-bold text-white">{item.xp} XP</div>
                          <div className="text-[10px] text-amber-400 font-medium">🔥 {item.streakDays}d streak</div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
