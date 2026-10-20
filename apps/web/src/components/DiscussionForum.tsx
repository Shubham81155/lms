"use client";

import React, { useEffect, useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { useCourseByCode, useForum, useModerationQueue } from "@/hooks/useEngagement";
import { ReportControl, ReportsPanel, ThreadModerationBar } from "@/components/forum/Moderation";
import { activateOnKey } from "@/lib/a11y";
import {
  X,
  MessageSquare,
  ThumbsUp,
  CheckCircle2,
  Search,
  Plus,
  Send,
  Sparkles,
  ShieldCheck,
  User,
  Filter,
  Flag,
  Eye,
  EyeOff,
} from "lucide-react";

interface DiscussionForumProps {
  /** Used to find the course; falls back to the first course the user can see. */
  courseCode?: string;
  /** Open on this course (from a link); falls back to the usual choice if it is not available. */
  courseId?: string | null;
  onClose: () => void;
}

// Categories every course can use. Older threads may carry others (the API still accepts them),
// and those show up as filters only while a thread in them is loaded.
const CATEGORIES = ["General", "Assignments", "Exams", "Logistics"] as const;
const CATEGORY_LABELS: Record<(typeof CATEGORIES)[number], string> = {
  General: "General",
  Assignments: "Assignments & labs",
  Exams: "Exams",
  Logistics: "Logistics",
};

const STAFF_ROLES = ["INSTRUCTOR", "TEACHING_ASSISTANT", "TENANT_ADMIN", "SUPER_ADMIN"];

export const DiscussionForum: React.FC<DiscussionForumProps> = ({
  courseCode,
  courseId,
  onClose,
}) => {
  const { user } = useAuth();
  const { course, courses, selectCourse, isLoading: courseLoading } = useCourseByCode(courseCode, user, courseId);
  const isStaff = !!user && STAFF_ROLES.includes(user.role);
  const forum = useForum(course?.id, isStaff);
  const queue = useModerationQueue(isStaff ? course?.id : null);
  const [showReports, setShowReports] = useState(false);
  const { threads, activeId, setActiveId } = forum;
  const readOnly = user?.role === "AUDITOR";

  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string>("ALL");
  const [showNewThreadModal, setShowNewThreadModal] = useState(false);

  // New Thread Form States
  const [newTitle, setNewTitle] = useState("");
  const [newCategory, setNewCategory] = useState<(typeof CATEGORIES)[number]>("General");
  const [newContent, setNewContent] = useState("");

  // Reply Input State
  const [replyText, setReplyText] = useState("");

  const activeThread = threads.find((t) => t.id === activeId) || threads[0];

  const filterCategories = [
    "ALL",
    ...CATEGORIES,
    ...Array.from(new Set([...threads.map((t) => t.category), selectedCategory])).filter(
      (c) => c !== "ALL" && !(CATEGORIES as readonly string[]).includes(c)
    ),
  ];

  const filteredThreads = threads.filter((t) => {
    const matchesSearch =
      t.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      t.content.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesCategory = selectedCategory === "ALL" || t.category === selectedCategory;
    return matchesSearch && matchesCategory;
  });

  const handlePostReply = async () => {
    if (!replyText.trim() || !activeThread) return;
    await forum.postReply(activeThread.id, replyText.trim());
    setReplyText("");
  };

  const handleCreateThread = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTitle.trim() || !newContent.trim()) return;
    await forum.createThread({ title: newTitle.trim(), body: newContent.trim(), category: newCategory });
    setShowNewThreadModal(false);
    setNewTitle("");
    setNewContent("");
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (showNewThreadModal) setShowNewThreadModal(false);
      else onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose, showNewThreadModal]);

  return (
    <div className="fixed inset-0 z-50 bg-canvas/85 backdrop-blur-md flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby="forum-h">
      <div className="relative bg-surface border border-line rounded-3xl w-full max-w-6xl h-[88vh] flex flex-col overflow-hidden shadow-2xl">
        {/* Top Header */}
        <div className="bg-canvas border-b border-line px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-2xl bg-brand/20 border border-brand/30 flex items-center justify-center text-brand-fg">
              <MessageSquare className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 id="forum-h" className="font-bold text-base text-ink">Course Collaboration & Q&A Forum</h3>
                {courses.length > 1 ? (
                  <select
                    aria-label="Course"
                    value={course?.id ?? ""}
                    onChange={(e) => selectCourse(e.target.value)}
                    className="rounded-full border border-brand/50 bg-brand/15 px-2 py-0.5 text-[10px] font-bold text-brand-fg focus:outline-none"
                  >
                    {courses.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.code} Community
                      </option>
                    ))}
                  </select>
                ) : (
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-brand/15 text-brand-fg border border-brand/50">
                    {course ? `${course.code} Community` : "Community"}
                  </span>
                )}
              </div>
              <p className="text-xs text-ink-muted">
                Peer discussions, algorithm debugging, and instructor-verified answers.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {isStaff && (
              <button
                onClick={() => {
                  queue.reload();
                  setShowReports(true);
                }}
                className="px-3 py-2 bg-surface hover:bg-raised border border-line text-ink rounded-xl text-xs font-bold flex items-center gap-1.5 transition-colors"
              >
                <Flag className="h-3.5 w-3.5 text-danger" />
                <span>Reports ({queue.flags.length})</span>
              </button>
            )}
            {!readOnly && (
            <button
              onClick={() => setShowNewThreadModal(true)}
              className="px-4 py-2 bg-brand hover:bg-brand-hover text-on-brand rounded-xl text-xs font-bold flex items-center gap-1.5 shadow-md shadow-brand/20 transition-all"
            >
              <Plus className="h-4 w-4" />
              <span>Ask Question</span>
            </button>
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

        {/* Filter Bar */}
        <div className="bg-canvas/60 border-b border-line px-6 py-2.5 flex flex-col sm:flex-row items-center justify-between gap-3">
          <div role="search" className="relative w-full sm:w-80">
            <Search className="h-3.5 w-3.5 text-ink-subtle absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Search forum topics..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-surface border border-line rounded-xl pl-9 pr-3 py-1.5 text-xs text-ink placeholder:text-ink-subtle focus:outline-none focus:border-brand"
            />
          </div>

          <div className="flex items-center gap-1.5 overflow-x-auto w-full sm:w-auto">
            {filterCategories.map((cat) => (
              <button
                key={cat}
                onClick={() => setSelectedCategory(cat)}
                className={`px-3 py-1 rounded-xl text-xs font-semibold whitespace-nowrap transition-colors ${
                  selectedCategory === cat
                    ? "bg-brand text-on-brand"
                    : "text-ink-muted hover:text-ink bg-surface/60 border border-line"
                }`}
              >
                {cat}
              </button>
            ))}
          </div>
        </div>

        {forum.error && (
          <div role="alert" className="bg-danger/10 border-b border-danger/30 px-6 py-2 text-xs text-danger">
            {forum.error}
          </div>
        )}

        {/* Body Split */}
        <div className="flex-1 flex overflow-hidden">
          {/* Thread List Left */}
          <div className="w-full md:w-5/12 border-r border-line overflow-y-auto p-4 space-y-3 bg-canvas/30">
            {(courseLoading || forum.isLoading) && (
              <div className="text-xs text-ink-subtle p-6 text-center">Loading discussions...</div>
            )}
            {!courseLoading && !forum.isLoading && !course && (
              <div className="text-xs text-ink-subtle p-6 text-center">You are not part of any course yet.</div>
            )}
            {!courseLoading && !forum.isLoading && course && filteredThreads.length === 0 && (
              <div className="text-xs text-ink-subtle p-6 text-center">
                {threads.length === 0 ? "No questions yet. Be the first to ask one." : "No topics match your search."}
              </div>
            )}
            {filteredThreads.map((thread) => {
              const isActive = thread.id === activeThread?.id;
              return (
                <div
                  key={thread.id}
                  role="button"
                  tabIndex={0}
                  aria-pressed={isActive}
                  onClick={() => setActiveId(thread.id)}
                  onKeyDown={activateOnKey(() => setActiveId(thread.id))}
                  className={`p-4 rounded-2xl border transition-all cursor-pointer ${
                    isActive
                      ? "bg-brand/15 border-brand/60 shadow-md"
                      : "bg-canvas/80 border-line/80 hover:border-line"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-surface text-brand-fg border border-line">
                      {thread.category}
                    </span>
                    <div className="flex items-center gap-2">
                      {thread.pinned && (
                        <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-accent/10 text-accent border border-accent/30">
                          Pinned
                        </span>
                      )}
                      {thread.hidden && (
                        <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-danger/10 text-danger border border-danger/30">
                          Hidden
                        </span>
                      )}
                      {thread.hasVerifiedAnswer && (
                        <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-success/10 text-success border border-success/30 flex items-center gap-1">
                          <CheckCircle2 className="h-2.5 w-2.5" />
                          Verified
                        </span>
                      )}
                      <span className="text-[10px] text-ink-subtle">{thread.timestamp}</span>
                    </div>
                  </div>

                  <h4 className="font-bold text-xs text-ink mt-2 line-clamp-2">
                    {thread.title}
                  </h4>
                  <p className="text-[11px] text-ink-muted mt-1 line-clamp-2">
                    {thread.content}
                  </p>

                  <div className="flex items-center justify-between text-[11px] text-ink-subtle mt-3 pt-2 border-t border-line">
                    <div className="flex items-center gap-1.5">
                      <div className="h-4 w-4 rounded-full bg-raised flex items-center justify-center text-[9px] text-ink">
                        {thread.author[0]}
                      </div>
                      <span>{thread.author}</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="flex items-center gap-1 text-ink-muted">
                        <ThumbsUp className="h-3 w-3" />
                        <span>{thread.upvotes}</span>
                      </span>
                      <span className="flex items-center gap-1 text-ink-muted">
                        <MessageSquare className="h-3 w-3" />
                        <span>{thread.replyCount}</span>
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Active Thread Details Right */}
          {activeThread && (
            <div className="hidden md:flex flex-1 flex-col overflow-hidden bg-surface/60">
              <div className="flex-1 p-6 overflow-y-auto space-y-6">
                {/* Thread Question Box */}
                <div className="bg-canvas border border-line rounded-2xl p-5 space-y-4 shadow-lg">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="h-7 w-7 rounded-xl bg-brand/30 flex items-center justify-center text-brand-fg font-bold text-xs">
                        {activeThread.author[0]}
                      </div>
                      <div>
                        <strong className="text-xs text-ink block">{activeThread.author}</strong>
                        <span className="text-[10px] text-ink-subtle">{activeThread.timestamp}</span>
                      </div>
                    </div>

                    <button
                      onClick={() => forum.vote("THREAD", activeThread.id, activeThread.id)}
                      disabled={forum.busy || readOnly}
                      className={`px-3 py-1.5 bg-surface hover:bg-brand/20 border text-ink hover:text-brand-fg rounded-xl text-xs font-bold flex items-center gap-1.5 transition-colors disabled:opacity-60 ${activeThread.votedByMe ? "border-brand text-brand-fg" : "border-line"}`}
                    >
                      <ThumbsUp className="h-3.5 w-3.5" />
                      <span>{activeThread.upvotes}</span>
                    </button>
                  </div>

                  <div>
                    <h3 className="text-base font-extrabold text-ink">{activeThread.title}</h3>
                    <p className="text-xs text-ink mt-2 leading-relaxed whitespace-pre-wrap">
                      {activeThread.content}
                    </p>
                  </div>

                  <div className="space-y-2">
                    {isStaff && <ThreadModerationBar thread={activeThread} busy={forum.busy} onModerate={(patch) => forum.moderateThread(activeThread.id, patch)} />}
                    {!readOnly && <ReportControl targetType="THREAD" targetId={activeThread.id} subject="this thread" />}
                  </div>
                </div>

                {/* Replies Stream */}
                <div className="space-y-4">
                  <div className="flex items-center justify-between border-b border-line pb-2">
                    <h4 className="text-xs font-bold uppercase tracking-wider text-ink-muted">
                      Community Replies ({activeThread.replies.filter((r) => !r.hidden).length}){activeThread.locked ? " · Locked" : ""}
                    </h4>
                  </div>

                  {activeThread.replies.filter((r) => !r.hidden || isStaff).map((reply) => (
                    <div
                      key={reply.id}
                      className={`p-4 rounded-2xl border space-y-3 ${
                        reply.isVerifiedAnswer
                          ? "bg-success/10 border-success/30 shadow-md shadow-success/10"
                          : "bg-canvas border-line"
                      } ${reply.hidden ? "opacity-60" : ""}`}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <div className={`h-6 w-6 rounded-lg flex items-center justify-center text-[10px] font-bold ${
                            reply.role === "INSTRUCTOR"
                              ? "bg-purple-600 text-on-brand"
                              : reply.role === "TA"
                              ? "bg-amber-600 text-on-brand"
                              : "bg-raised text-ink"
                          }`}>
                            {reply.author[0]}
                          </div>
                          <div>
                            <div className="flex items-center gap-2">
                              <strong className="text-xs text-ink">{reply.author}</strong>
                              {reply.isVerifiedAnswer && (
                                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-success/10 text-success border border-success/30 flex items-center gap-1">
                                  <ShieldCheck className="h-3 w-3 text-success" />
                                  Verified by Faculty
                                </span>
                              )}
                            </div>
                            <span className="text-[10px] text-ink-subtle">{reply.timestamp}</span>
                          </div>
                        </div>

                        <div className="flex items-center gap-2">
                          {reply.hidden && <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-danger/10 text-danger border border-danger/30">Hidden</span>}
                          {isStaff && (
                            <button
                              onClick={() => forum.moderatePost(reply.id, !reply.hidden, activeThread.id)}
                              disabled={forum.busy}
                              className="px-2.5 py-1 bg-surface border border-line text-ink-muted hover:text-ink rounded-lg text-[11px] font-semibold flex items-center gap-1 transition-colors disabled:opacity-60"
                            >
                              {reply.hidden ? <Eye className="h-3 w-3" /> : <EyeOff className="h-3 w-3" />}
                              <span>{reply.hidden ? "Restore" : "Hide"}</span>
                            </button>
                          )}
                          {isStaff && (
                            <button
                              onClick={() => forum.endorse(reply.id, activeThread.id)}
                              disabled={forum.busy}
                              className="px-2.5 py-1 bg-surface border border-line text-ink-muted hover:text-success rounded-lg text-[11px] font-semibold flex items-center gap-1 transition-colors disabled:opacity-60"
                            >
                              <ShieldCheck className="h-3 w-3" />
                              <span>{reply.isVerifiedAnswer ? "Unverify" : "Verify"}</span>
                            </button>
                          )}
                          <button
                            onClick={() => forum.vote("POST", reply.id, activeThread.id)}
                            disabled={forum.busy || readOnly}
                            className={`px-2.5 py-1 bg-surface border text-ink-muted hover:text-ink rounded-lg text-[11px] font-semibold flex items-center gap-1 transition-colors disabled:opacity-60 ${reply.votedByMe ? "border-brand text-brand-fg" : "border-line"}`}
                          >
                            <ThumbsUp className="h-3 w-3" />
                            <span>{reply.upvotes}</span>
                          </button>
                        </div>
                      </div>

                      <p className="text-xs text-ink leading-relaxed whitespace-pre-wrap">
                        {reply.content}
                      </p>
                      {!readOnly && !reply.hidden && <ReportControl targetType="POST" targetId={reply.id} subject={`the reply by ${reply.author}`} />}
                    </div>
                  ))}
                </div>
              </div>

              {/* Bottom Reply Composer */}
              <div className="p-4 bg-canvas border-t border-line flex items-center gap-3">
                <input
                  type="text"
                  placeholder={activeThread.locked && !isStaff ? "This thread is locked" : "Write a constructive response or answer..."}
                  disabled={readOnly || (activeThread.locked && !isStaff)}
                  value={replyText}
                  onChange={(e) => setReplyText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      handlePostReply();
                    }
                  }}
                  className="flex-1 bg-surface border border-line rounded-xl px-4 py-2 text-xs text-ink placeholder:text-ink-subtle focus:outline-none focus:border-brand"
                />
                <button
                  onClick={handlePostReply}
                  disabled={!replyText.trim() || forum.busy || readOnly || (activeThread.locked && !isStaff)}
                  className="px-4 py-2 bg-brand hover:bg-brand-hover disabled:opacity-50 text-on-brand rounded-xl text-xs font-bold flex items-center gap-1.5 shadow-md shadow-brand/20 transition-all"
                >
                  <Send className="h-3.5 w-3.5" />
                  <span>Reply</span>
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {showReports && (
        <div className="fixed inset-0 z-[55] flex items-center justify-center p-4">
          <div className="relative h-[88vh] w-full max-w-3xl overflow-hidden rounded-3xl border border-line shadow-2xl">
            <ReportsPanel
              flags={queue.flags}
              error={queue.error}
              onClose={() => setShowReports(false)}
              onOpenThread={(id) => {
                setActiveId(id);
                setShowReports(false);
              }}
              onChanged={() => {
                queue.reload();
                forum.refresh();
                if (activeThread) forum.refreshReplies(activeThread.id);
              }}
            />
          </div>
        </div>
      )}

      {/* New Question Modal */}
      {showNewThreadModal && (
        <div className="fixed inset-0 z-50 bg-canvas/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-surface border border-line rounded-2xl w-full max-w-lg p-6 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between border-b border-line pb-3">
              <h4 className="font-bold text-sm text-ink">Ask a New Course Question</h4>
              <button
                onClick={() => setShowNewThreadModal(false)}
                className="text-ink-muted hover:text-ink"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleCreateThread} className="space-y-3 text-xs">
              <div>
                <label htmlFor="thread-title" className="text-ink-muted font-semibold block mb-1">Title</label>
                <input
                  id="thread-title"
                  type="text"
                  placeholder="e.g. How does Paxos achieve non-blocking consensus?"
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  className="w-full bg-canvas border border-line rounded-xl p-2.5 text-xs text-ink focus:outline-none focus:border-brand"
                />
              </div>

              <div>
                <label htmlFor="thread-category" className="text-ink-muted font-semibold block mb-1">Category</label>
                <select
                  id="thread-category"
                  value={newCategory}
                  onChange={(e) => setNewCategory(e.target.value as any)}
                  className="w-full bg-canvas border border-line rounded-xl p-2.5 text-xs text-ink focus:outline-none focus:border-brand"
                >
                  {CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {CATEGORY_LABELS[c]}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label htmlFor="thread-details" className="text-ink-muted font-semibold block mb-1">Details</label>
                <textarea
                  id="thread-details"
                  rows={4}
                  placeholder="Provide context, code snippets, or textbook questions..."
                  value={newContent}
                  onChange={(e) => setNewContent(e.target.value)}
                  className="w-full bg-canvas border border-line rounded-xl p-2.5 text-xs text-ink focus:outline-none focus:border-brand"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowNewThreadModal(false)}
                  className="px-4 py-2 bg-canvas border border-line text-ink-muted rounded-xl text-xs font-semibold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={!newTitle.trim() || !newContent.trim() || forum.busy}
                  className="px-5 py-2 bg-brand hover:bg-brand-hover text-on-brand rounded-xl text-xs font-bold shadow-md shadow-brand/20"
                >
                  Post Topic
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
