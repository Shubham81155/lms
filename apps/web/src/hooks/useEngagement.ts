"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { api, ApiError } from "@/lib/api";
import { timeAgo } from "@/hooks/useNotifications";

const messageOf = (e: unknown, fallback: string) =>
  e instanceof ApiError ? e.message : (e as any)?.message || fallback;

// ---------------------------------------------------------------------------
// Course lookup
// ---------------------------------------------------------------------------

export interface CourseRef {
  id: string;
  code: string;
  title: string;
}

/**
 * Resolves a course for screens that were written around a course code. Prefers the exact code,
 * otherwise the first course the caller can see. `null` when there is none (or while loading).
 */
export function useCourseByCode(code?: string) {
  const [course, setCourse] = useState<CourseRef | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await api.get<any>("/api/v1/courses", { params: { limit: 100 } });
        const list: CourseRef[] = Array.isArray(res) ? res : res.data ?? res.courses ?? [];
        if (alive) setCourse(list.find((c) => c.code === code) ?? list[0] ?? null);
      } catch {
        if (alive) setCourse(null);
      } finally {
        if (alive) setIsLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [code]);

  return { course, isLoading };
}

// ---------------------------------------------------------------------------
// Gamification
// ---------------------------------------------------------------------------

export interface GamificationState {
  xp: number;
  level: number;
  xpIntoLevel: number;
  xpPerLevel: number;
  streakDays: number;
  longestStreak: number;
  lastActiveDate: string | null;
}

export interface LeaderboardRow {
  rank: number;
  userId: string;
  name: string;
  xp: number;
  level: number;
  streakDays: number;
  isMe: boolean;
}

export function useGamification(courseId?: string | null) {
  const [state, setState] = useState<GamificationState | null>(null);
  const [mastery, setMastery] = useState<{ level: string; score: number }[]>([]);
  const [board, setBoard] = useState<LeaderboardRow[]>([]);
  const [alreadyClaimed, setAlreadyClaimed] = useState(false);
  const [claiming, setClaiming] = useState(false);
  const [lastAward, setLastAward] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [me, m] = await Promise.all([
          api.get<{ data: GamificationState }>("/api/v1/gamification/me"),
          api.get<{ data: { level: string; score: number }[] }>("/api/v1/gamification/mastery"),
        ]);
        if (!alive) return;
        setState(me.data);
        setMastery(m.data);
        // Already checked in today when the last active day is today (UTC, like the server).
        setAlreadyClaimed(me.data.lastActiveDate?.slice(0, 10) === new Date().toISOString().slice(0, 10));
        setError(null);
      } catch (e) {
        if (alive) setError(messageOf(e, "Could not load your progress"));
      } finally {
        if (alive) setIsLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!courseId) {
      setBoard([]);
      return;
    }
    let alive = true;
    api
      .get<{ data: LeaderboardRow[] }>("/api/v1/gamification/leaderboard", { params: { courseId } })
      .then((r) => alive && setBoard(r.data))
      .catch(() => alive && setBoard([]));
    return () => {
      alive = false;
    };
  }, [courseId]);

  const claim = useCallback(async () => {
    setClaiming(true);
    try {
      const r = await api.post<{ data: GamificationState & { awarded: number; alreadyClaimed: boolean } }>("/api/v1/gamification/checkin");
      setState(r.data);
      setAlreadyClaimed(true);
      setLastAward(r.data.awarded);
      setError(null);
    } catch (e) {
      setError(messageOf(e, "Could not claim the daily bonus"));
    } finally {
      setClaiming(false);
    }
  }, []);

  return { state, mastery, board, alreadyClaimed, claiming, lastAward, isLoading, error, claim };
}

// ---------------------------------------------------------------------------
// Calendar
// ---------------------------------------------------------------------------

export interface ServerEvent {
  id: string;
  title: string;
  description: string | null;
  category: "EXAM" | "LAB" | "LECTURE" | "OFFICE_HOURS" | "DEADLINE";
  startsAt: string;
  endsAt: string;
  timezone: string;
  courseId: string | null;
}

export function useCalendarEvents() {
  const [events, setEvents] = useState<ServerEvent[]>([]);
  const [next, setNext] = useState<ServerEvent | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const from = new Date(Date.now() - 86_400_000).toISOString();
        const r = await api.get<{ data: ServerEvent[]; nextDeadline: ServerEvent | null }>("/api/v1/calendar/events", { params: { from } });
        if (!alive) return;
        setEvents(r.data);
        setNext(r.nextDeadline);
        setError(null);
      } catch (e) {
        if (alive) setError(messageOf(e, "Could not load the calendar"));
      } finally {
        if (alive) setIsLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  /** Downloads the iCalendar feed (the endpoint needs the session cookie, so it goes through fetch). */
  const downloadIcs = useCallback(async () => {
    const res = await fetch("/api/v1/calendar/export.ics", { credentials: "include" });
    if (!res.ok) throw new Error("Could not export the calendar");
    const url = URL.createObjectURL(await res.blob());
    const a = document.createElement("a");
    a.href = url;
    a.download = "lms-calendar.ics";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }, []);

  return { events, next, isLoading, error, downloadIcs };
}

/** "in 3 days", "in 5 h", "started" ... for the countdown label. */
export function countdown(startsAt: string, now: number = Date.now()): string {
  const ms = new Date(startsAt).getTime() - now;
  if (ms <= 0) return "In progress or past";
  const h = Math.floor(ms / 3_600_000);
  if (h < 1) return `In ${Math.max(1, Math.floor(ms / 60_000))} min`;
  if (h < 48) return `In ${h} h`;
  return `In ${Math.floor(h / 24)} days`;
}

// ---------------------------------------------------------------------------
// Forum
// ---------------------------------------------------------------------------

export interface ForumReplyView {
  id: string;
  author: string;
  role: "STUDENT" | "INSTRUCTOR" | "TA";
  content: string;
  timestamp: string;
  upvotes: number;
  votedByMe: boolean;
  isVerifiedAnswer: boolean;
  hidden: boolean;
}

export interface ForumThreadView {
  id: string;
  title: string;
  author: string;
  category: string;
  content: string;
  timestamp: string;
  upvotes: number;
  votedByMe: boolean;
  replyCount: number;
  pinned: boolean;
  locked: boolean;
  hasVerifiedAnswer: boolean;
  replies: ForumReplyView[];
}

const roleOf = (r: string): ForumReplyView["role"] => (r === "INSTRUCTOR" ? "INSTRUCTOR" : r === "TEACHING_ASSISTANT" ? "TA" : "STUDENT");

const toReply = (p: any): ForumReplyView => ({
  id: p.id,
  author: p.author.name,
  role: roleOf(p.author.role),
  content: p.body,
  timestamp: timeAgo(p.createdAt),
  upvotes: p.upvotes ?? 0,
  votedByMe: !!p.votedByMe,
  isVerifiedAnswer: !!p.endorsed,
  hidden: !!p.hidden,
});

const toThread = (t: any, replies: ForumReplyView[] = []): ForumThreadView => ({
  id: t.id,
  title: t.title,
  author: t.author?.name ?? "Unknown",
  category: t.category,
  content: t.body,
  timestamp: timeAgo(t.createdAt),
  upvotes: t.upvotes ?? 0,
  votedByMe: !!t.votedByMe,
  replyCount: t.replyCount ?? replies.length,
  pinned: !!t.pinned,
  locked: !!t.locked,
  hasVerifiedAnswer: replies.some((r) => r.isVerifiedAnswer),
  replies,
});

/** Threads of one course, with the active thread's replies loaded on demand. */
export function useForum(courseId?: string | null) {
  const [threads, setThreads] = useState<ForumThreadView[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [replies, setReplies] = useState<Record<string, ForumReplyView[]>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const loadThreads = useCallback(async () => {
    if (!courseId) {
      setThreads([]);
      setIsLoading(false);
      return;
    }
    try {
      const r = await api.get<{ data: any[] }>(`/api/v1/courses/${courseId}/threads`, { params: { limit: 50 } });
      if (!alive.current) return;
      setThreads(r.data.map((t) => toThread(t)));
      setActiveId((cur) => cur ?? r.data[0]?.id ?? null);
      setError(null);
    } catch (e) {
      if (alive.current) setError(messageOf(e, "Could not load discussions"));
    } finally {
      if (alive.current) setIsLoading(false);
    }
  }, [courseId]);

  useEffect(() => {
    setIsLoading(true);
    setActiveId(null);
    loadThreads();
  }, [loadThreads]);

  const loadReplies = useCallback(async (threadId: string) => {
    try {
      // The API returns replies a page at a time; fetch them all (bounded) so the thread shows in full.
      let r = await api.get<{ data: any }>(`/api/v1/threads/${threadId}`);
      const head = r.data;
      const posts: any[] = [...head.posts];
      for (let page = 0; r.data.nextCursor && page < 25; page++) {
        r = await api.get<{ data: any }>(`/api/v1/threads/${threadId}?cursor=${encodeURIComponent(r.data.nextCursor)}`);
        posts.push(...r.data.posts);
      }
      r = { data: { ...head, posts } };
      if (!alive.current) return;
      const list = r.data.posts.map(toReply);
      setReplies((prev) => ({ ...prev, [threadId]: list }));
      setThreads((prev) => prev.map((t) => (t.id === threadId ? { ...t, upvotes: r.data.upvotes ?? t.upvotes, votedByMe: !!r.data.votedByMe, replyCount: list.filter((x: ForumReplyView) => !x.hidden).length } : t)));
    } catch (e) {
      if (alive.current) setError(messageOf(e, "Could not load replies"));
    }
  }, []);

  useEffect(() => {
    if (activeId) loadReplies(activeId);
  }, [activeId, loadReplies]);

  const act = useCallback(async (fn: () => Promise<void>, fallback: string) => {
    setBusy(true);
    try {
      await fn();
      if (alive.current) setError(null);
    } catch (e) {
      if (alive.current) setError(messageOf(e, fallback));
    } finally {
      if (alive.current) setBusy(false);
    }
  }, []);

  const createThread = useCallback(
    (input: { title: string; body: string; category: string }) =>
      act(async () => {
        if (!courseId) throw new Error("No course selected");
        const r = await api.post<{ data: any }>(`/api/v1/courses/${courseId}/threads`, input);
        await loadThreads();
        setActiveId(r.data.id);
      }, "Could not post your question"),
    [act, courseId, loadThreads]
  );

  const postReply = useCallback(
    (threadId: string, body: string) =>
      act(async () => {
        await api.post(`/api/v1/threads/${threadId}/posts`, { body });
        await loadReplies(threadId);
      }, "Could not post your reply"),
    [act, loadReplies]
  );

  const vote = useCallback(
    (targetType: "THREAD" | "POST", targetId: string, threadId: string) =>
      act(async () => {
        const r = await api.post<{ data: { voted: boolean; upvotes: number } }>("/api/v1/votes", { targetType, targetId });
        if (targetType === "THREAD") {
          setThreads((prev) => prev.map((t) => (t.id === targetId ? { ...t, upvotes: r.data.upvotes, votedByMe: r.data.voted } : t)));
        } else {
          setReplies((prev) => ({
            ...prev,
            [threadId]: (prev[threadId] ?? []).map((p) => (p.id === targetId ? { ...p, upvotes: r.data.upvotes, votedByMe: r.data.voted } : p)),
          }));
        }
      }, "Could not record your vote"),
    [act]
  );

  /** Course staff only; the API answers 403 to anyone else. */
  const endorse = useCallback(
    (postId: string, threadId: string) =>
      act(async () => {
        await api.post(`/api/v1/posts/${postId}/endorse`);
        await loadReplies(threadId);
      }, "Could not verify this answer"),
    [act, loadReplies]
  );

  const report = useCallback(
    (targetType: "THREAD" | "POST", targetId: string, reason: string) =>
      act(async () => {
        await api.post("/api/v1/flags", { targetType, targetId, reason });
      }, "Could not send your report"),
    [act]
  );

  const withReplies = threads.map((t) => {
    const list = replies[t.id];
    return list ? { ...t, replies: list, hasVerifiedAnswer: list.some((r) => r.isVerifiedAnswer) } : t;
  });

  return { threads: withReplies, activeId, setActiveId, isLoading, busy, error, createThread, postReply, vote, endorse, report, refresh: loadThreads };
}
