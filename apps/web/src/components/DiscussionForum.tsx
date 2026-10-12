"use client";

import React, { useState } from "react";
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
} from "lucide-react";

interface ForumReply {
  id: string;
  author: string;
  role: "STUDENT" | "INSTRUCTOR" | "TA";
  content: string;
  timestamp: string;
  upvotes: number;
  isVerifiedAnswer?: boolean;
}

interface ForumThread {
  id: string;
  title: string;
  author: string;
  courseCode: string;
  category: "Consensus" | "Cryptography" | "Assignments" | "General";
  content: string;
  timestamp: string;
  upvotes: number;
  replies: ForumReply[];
  hasVerifiedAnswer?: boolean;
}

interface DiscussionForumProps {
  courseCode?: string;
  onClose: () => void;
}

export const DiscussionForum: React.FC<DiscussionForumProps> = ({
  courseCode = "CS-101",
  onClose,
}) => {
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string>("ALL");
  const [activeThreadId, setActiveThreadId] = useState<string>("thread_1");
  const [showNewThreadModal, setShowNewThreadModal] = useState(false);

  // New Thread Form States
  const [newTitle, setNewTitle] = useState("");
  const [newCategory, setNewCategory] = useState<"Consensus" | "Cryptography" | "Assignments" | "General">("Consensus");
  const [newContent, setNewContent] = useState("");

  // Reply Input State
  const [replyText, setReplyText] = useState("");

  const [threads, setThreads] = useState<ForumThread[]>([
    {
      id: "thread_1",
      title: "Why does Raft require randomized election timeouts?",
      author: "Alex Chen",
      courseCode: "CS-101",
      category: "Consensus",
      content:
        "In the Raft paper, section 5.2 mentions randomized election timeouts between 150ms and 300ms. What happens if all nodes use fixed timers?",
      timestamp: "3 hours ago",
      upvotes: 18,
      hasVerifiedAnswer: true,
      replies: [
        {
          id: "rep_1",
          author: "Prof. David Malan",
          role: "INSTRUCTOR",
          content:
            "If timeouts are synchronized with a fixed timer, multiple followers will timeout simultaneously, split the vote equally in candidate state, and enter split-vote deadlocks where no leader can ever achieve quorum.",
          timestamp: "2 hours ago",
          upvotes: 24,
          isVerifiedAnswer: true,
        },
        {
          id: "rep_2",
          author: "Maria Rodriguez",
          role: "STUDENT",
          content:
            "This was also demonstrated in Lab 2 when we tested split-brain partitioning!",
          timestamp: "1 hour ago",
          upvotes: 5,
        },
      ],
    },
    {
      id: "thread_2",
      title: "Field-Level Encryption (AES-256-GCM) authentication tag length",
      author: "Liam Johnson",
      courseCode: "DS-201",
      category: "Cryptography",
      content:
        "When encrypting student PII for FERPA compliance, why is the 16-byte GCM authentication tag mandatory instead of standard CBC mode?",
      timestamp: "5 hours ago",
      upvotes: 12,
      hasVerifiedAnswer: true,
      replies: [
        {
          id: "rep_3",
          author: "Dr. Elena Rostova",
          role: "INSTRUCTOR",
          content:
            "GCM is an Authenticated Encryption with Associated Data (AEAD) scheme. The 16-byte tag prevents ciphertext tampering and bit-flipping attacks that CBC is vulnerable to without an HMAC.",
          timestamp: "4 hours ago",
          upvotes: 19,
          isVerifiedAnswer: true,
        },
      ],
    },
    {
      id: "thread_3",
      title: "Clarification on Lab 3: Zero-Trust Ingress Envoy Gateway",
      author: "Sophia Wang",
      courseCode: "CS-101",
      category: "Assignments",
      content:
        "For step 4 of Lab 3, should our mutual TLS certificate validation include SAN matching for internal cluster service accounts?",
      timestamp: "1 day ago",
      upvotes: 8,
      hasVerifiedAnswer: false,
      replies: [
        {
          id: "rep_4",
          author: "David Chen (TA)",
          role: "TA",
          content:
            "Yes! You should match the SPIFFE ID in the SAN field to ensure only authorized pods can connect to the ingress controller.",
          timestamp: "18 hours ago",
          upvotes: 7,
        },
      ],
    },
  ]);

  const activeThread = threads.find((t) => t.id === activeThreadId) || threads[0];

  const filteredThreads = threads.filter((t) => {
    const matchesSearch =
      t.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      t.content.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesCategory =
      selectedCategory === "ALL" || t.category === selectedCategory;
    return matchesSearch && matchesCategory;
  });

  const handleUpvoteThread = (threadId: string) => {
    setThreads(
      threads.map((t) =>
        t.id === threadId ? { ...t, upvotes: t.upvotes + 1 } : t
      )
    );
  };

  const handleUpvoteReply = (replyId: string) => {
    setThreads(
      threads.map((t) =>
        t.id === activeThread.id
          ? {
              ...t,
              replies: t.replies.map((r) =>
                r.id === replyId ? { ...r, upvotes: r.upvotes + 1 } : r
              ),
            }
          : t
      )
    );
  };

  const handlePostReply = () => {
    if (!replyText.trim()) return;

    const newReply: ForumReply = {
      id: `rep_${Date.now()}`,
      author: "Alex Chen",
      role: "STUDENT",
      content: replyText.trim(),
      timestamp: "Just now",
      upvotes: 1,
    };

    setThreads(
      threads.map((t) =>
        t.id === activeThread.id ? { ...t, replies: [...t.replies, newReply] } : t
      )
    );

    setReplyText("");
  };

  const handleCreateThread = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTitle.trim() || !newContent.trim()) return;

    const created: ForumThread = {
      id: `thread_${Date.now()}`,
      title: newTitle.trim(),
      author: "Alex Chen",
      courseCode,
      category: newCategory,
      content: newContent.trim(),
      timestamp: "Just now",
      upvotes: 1,
      replies: [],
    };

    setThreads([created, ...threads]);
    setActiveThreadId(created.id);
    setShowNewThreadModal(false);
    setNewTitle("");
    setNewContent("");
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/85 backdrop-blur-md flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-slate-800 rounded-3xl w-full max-w-6xl h-[88vh] flex flex-col overflow-hidden shadow-2xl">
        {/* Top Header */}
        <div className="bg-slate-950 border-b border-slate-800 px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-2xl bg-blue-600/20 border border-blue-500/30 flex items-center justify-center text-blue-400">
              <MessageSquare className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-bold text-base text-white">Course Collaboration & Q&A Forum</h3>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-blue-900/50 text-blue-300 border border-blue-700/50">
                  {courseCode} Community
                </span>
              </div>
              <p className="text-xs text-slate-400">
                Peer discussions, algorithm debugging, and instructor-verified answers.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={() => setShowNewThreadModal(true)}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 shadow-md shadow-blue-500/20 transition-all"
            >
              <Plus className="h-4 w-4" />
              <span>Ask Question</span>
            </button>
            <button
              onClick={onClose}
              className="p-1 rounded-xl hover:bg-slate-800 text-slate-400 hover:text-white transition-colors"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Filter Bar */}
        <div className="bg-slate-950/60 border-b border-slate-800 px-6 py-2.5 flex flex-col sm:flex-row items-center justify-between gap-3">
          <div className="relative w-full sm:w-80">
            <Search className="h-3.5 w-3.5 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Search forum topics..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-slate-900 border border-slate-800 rounded-xl pl-9 pr-3 py-1.5 text-xs text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-blue-500"
            />
          </div>

          <div className="flex items-center gap-1.5 overflow-x-auto w-full sm:w-auto">
            {["ALL", "Consensus", "Cryptography", "Assignments", "General"].map((cat) => (
              <button
                key={cat}
                onClick={() => setSelectedCategory(cat)}
                className={`px-3 py-1 rounded-xl text-xs font-semibold whitespace-nowrap transition-colors ${
                  selectedCategory === cat
                    ? "bg-blue-600 text-white"
                    : "text-slate-400 hover:text-slate-200 bg-slate-900/60 border border-slate-800"
                }`}
              >
                {cat}
              </button>
            ))}
          </div>
        </div>

        {/* Body Split */}
        <div className="flex-1 flex overflow-hidden">
          {/* Thread List Left */}
          <div className="w-full md:w-5/12 border-r border-slate-800 overflow-y-auto p-4 space-y-3 bg-slate-950/30">
            {filteredThreads.map((thread) => {
              const isActive = thread.id === activeThread?.id;
              return (
                <div
                  key={thread.id}
                  onClick={() => setActiveThreadId(thread.id)}
                  className={`p-4 rounded-2xl border transition-all cursor-pointer ${
                    isActive
                      ? "bg-blue-950/30 border-blue-600/60 shadow-md"
                      : "bg-slate-950/80 border-slate-800/80 hover:border-slate-700"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-slate-900 text-blue-400 border border-slate-800">
                      {thread.category}
                    </span>
                    <div className="flex items-center gap-2">
                      {thread.hasVerifiedAnswer && (
                        <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-emerald-950 text-emerald-400 border border-emerald-800 flex items-center gap-1">
                          <CheckCircle2 className="h-2.5 w-2.5" />
                          Verified
                        </span>
                      )}
                      <span className="text-[10px] text-slate-500">{thread.timestamp}</span>
                    </div>
                  </div>

                  <h4 className="font-bold text-xs text-white mt-2 line-clamp-2">
                    {thread.title}
                  </h4>
                  <p className="text-[11px] text-slate-400 mt-1 line-clamp-2">
                    {thread.content}
                  </p>

                  <div className="flex items-center justify-between text-[11px] text-slate-500 mt-3 pt-2 border-t border-slate-900">
                    <div className="flex items-center gap-1.5">
                      <div className="h-4 w-4 rounded-full bg-slate-800 flex items-center justify-center text-[9px] text-slate-300">
                        {thread.author[0]}
                      </div>
                      <span>{thread.author}</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="flex items-center gap-1 text-slate-400">
                        <ThumbsUp className="h-3 w-3" />
                        <span>{thread.upvotes}</span>
                      </span>
                      <span className="flex items-center gap-1 text-slate-400">
                        <MessageSquare className="h-3 w-3" />
                        <span>{thread.replies.length}</span>
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Active Thread Details Right */}
          {activeThread && (
            <div className="hidden md:flex flex-1 flex-col overflow-hidden bg-slate-900/60">
              <div className="flex-1 p-6 overflow-y-auto space-y-6">
                {/* Thread Question Box */}
                <div className="bg-slate-950 border border-slate-800 rounded-2xl p-5 space-y-4 shadow-lg">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="h-7 w-7 rounded-xl bg-blue-600/30 flex items-center justify-center text-blue-400 font-bold text-xs">
                        {activeThread.author[0]}
                      </div>
                      <div>
                        <strong className="text-xs text-white block">{activeThread.author}</strong>
                        <span className="text-[10px] text-slate-500">{activeThread.timestamp}</span>
                      </div>
                    </div>

                    <button
                      onClick={() => handleUpvoteThread(activeThread.id)}
                      className="px-3 py-1.5 bg-slate-900 hover:bg-blue-600/20 border border-slate-800 text-slate-300 hover:text-blue-400 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-colors"
                    >
                      <ThumbsUp className="h-3.5 w-3.5" />
                      <span>{activeThread.upvotes}</span>
                    </button>
                  </div>

                  <div>
                    <h3 className="text-base font-extrabold text-white">{activeThread.title}</h3>
                    <p className="text-xs text-slate-300 mt-2 leading-relaxed whitespace-pre-wrap">
                      {activeThread.content}
                    </p>
                  </div>
                </div>

                {/* Replies Stream */}
                <div className="space-y-4">
                  <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                    <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400">
                      Community Replies ({activeThread.replies.length})
                    </h4>
                  </div>

                  {activeThread.replies.map((reply) => (
                    <div
                      key={reply.id}
                      className={`p-4 rounded-2xl border space-y-3 ${
                        reply.isVerifiedAnswer
                          ? "bg-emerald-950/20 border-emerald-800/80 shadow-md shadow-emerald-950/20"
                          : "bg-slate-950 border-slate-800"
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <div className={`h-6 w-6 rounded-lg flex items-center justify-center text-[10px] font-bold ${
                            reply.role === "INSTRUCTOR"
                              ? "bg-purple-600 text-white"
                              : reply.role === "TA"
                              ? "bg-amber-600 text-white"
                              : "bg-slate-800 text-slate-300"
                          }`}>
                            {reply.author[0]}
                          </div>
                          <div>
                            <div className="flex items-center gap-2">
                              <strong className="text-xs text-white">{reply.author}</strong>
                              {reply.isVerifiedAnswer && (
                                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-950 text-emerald-300 border border-emerald-800 flex items-center gap-1">
                                  <ShieldCheck className="h-3 w-3 text-emerald-400" />
                                  Verified by Faculty
                                </span>
                              )}
                            </div>
                            <span className="text-[10px] text-slate-500">{reply.timestamp}</span>
                          </div>
                        </div>

                        <button
                          onClick={() => handleUpvoteReply(reply.id)}
                          className="px-2.5 py-1 bg-slate-900 border border-slate-800 text-slate-400 hover:text-white rounded-lg text-[11px] font-semibold flex items-center gap-1 transition-colors"
                        >
                          <ThumbsUp className="h-3 w-3" />
                          <span>{reply.upvotes}</span>
                        </button>
                      </div>

                      <p className="text-xs text-slate-300 leading-relaxed whitespace-pre-wrap">
                        {reply.content}
                      </p>
                    </div>
                  ))}
                </div>
              </div>

              {/* Bottom Reply Composer */}
              <div className="p-4 bg-slate-950 border-t border-slate-800 flex items-center gap-3">
                <input
                  type="text"
                  placeholder="Write a constructive response or answer..."
                  value={replyText}
                  onChange={(e) => setReplyText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      handlePostReply();
                    }
                  }}
                  className="flex-1 bg-slate-900 border border-slate-800 rounded-xl px-4 py-2 text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-blue-500"
                />
                <button
                  onClick={handlePostReply}
                  disabled={!replyText.trim()}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 shadow-md shadow-blue-500/20 transition-all"
                >
                  <Send className="h-3.5 w-3.5" />
                  <span>Reply</span>
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* New Question Modal */}
      {showNewThreadModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-lg p-6 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h4 className="font-bold text-sm text-white">Ask a New Course Question</h4>
              <button
                onClick={() => setShowNewThreadModal(false)}
                className="text-slate-400 hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleCreateThread} className="space-y-3 text-xs">
              <div>
                <label className="text-slate-400 font-semibold block mb-1">Title</label>
                <input
                  type="text"
                  placeholder="e.g. How does Paxos achieve non-blocking consensus?"
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-xs text-white focus:outline-none focus:border-blue-500"
                />
              </div>

              <div>
                <label className="text-slate-400 font-semibold block mb-1">Category</label>
                <select
                  value={newCategory}
                  onChange={(e) => setNewCategory(e.target.value as any)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-xs text-slate-200 focus:outline-none focus:border-blue-500"
                >
                  <option value="Consensus">Distributed Consensus</option>
                  <option value="Cryptography">Data Security & Cryptography</option>
                  <option value="Assignments">Assignments & Labs</option>
                  <option value="General">General Inquiries</option>
                </select>
              </div>

              <div>
                <label className="text-slate-400 font-semibold block mb-1">Details</label>
                <textarea
                  rows={4}
                  placeholder="Provide context, code snippets, or textbook questions..."
                  value={newContent}
                  onChange={(e) => setNewContent(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-xs text-white focus:outline-none focus:border-blue-500"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowNewThreadModal(false)}
                  className="px-4 py-2 bg-slate-950 border border-slate-800 text-slate-400 rounded-xl text-xs font-semibold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={!newTitle.trim() || !newContent.trim()}
                  className="px-5 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-bold shadow-md shadow-blue-500/20"
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
