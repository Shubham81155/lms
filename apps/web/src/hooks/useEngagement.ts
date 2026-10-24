'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { api, ApiError } from '@/lib/api';
import { timeAgo } from '@/hooks/useNotifications';

const messageOf = (e: unknown, fallback: string) => (e instanceof ApiError ? e.message : (e as any)?.message || fallback);

// ---------------------------------------------------------------------------
// Course lookup
// ---------------------------------------------------------------------------

export interface CourseRef {
  id: string;
  code: string;
  title: string;
  instructors?: Array<{ user?: { id: string } }>;
}

/**
 * Resolves a course for screens that were written around a course code. Prefers the exact code,
 * otherwise the first course the caller can see. `null` when there is none (or while loading).
 */
/**
 * `viewer` is the signed-in user; it decides which courses are offered, so the hook itself needs no
 * access to the auth context.
 */
export function useCourseByCode(code?: string, viewer?: { id: string; role: string } | null, preferredId?: string | null) {
  const user = viewer;
  const [allCourses, setAllCourses] = useState<CourseRef[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(preferredId ?? null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await api.get<any>('/api/v1/courses', { params: { limit: 100 } });
        const list: CourseRef[] = Array.isArray(res) ? res : (res.data ?? res.courses ?? []);
        if (alive) setAllCourses(list);
      } catch {
        if (alive) setAllCourses([]);
      } finally {
        if (alive) setIsLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  // The list covers the whole organisation. Offer only courses the person can use: administrators
  // get all of them, instructors and assistants the ones they teach. Learners keep the single
  // resolved course, since the list does not say which ones they are enrolled in.
  const courses = useMemo(() => {
    if (user?.role === 'TENANT_ADMIN' || user?.role === 'SUPER_ADMIN') return allCourses;
    if (user?.role === 'INSTRUCTOR' || user?.role === 'TEACHING_ASSISTANT') {
      return allCourses.filter((c) => (c.instructors ?? []).some((i) => i.user?.id === user.id));
    }
    const first = allCourses.find((c) => c.code === code) ?? allCourses[0];
    return first ? [first] : [];
  }, [allCourses, user, code]);

  const course = courses.find((c) => c.id === selectedId) ?? courses.find((c) => c.code === code) ?? courses[0] ?? null;
  return { course, courses, selectCourse: setSelectedId, isLoading };
}

// ---------------------------------------------------------------------------
// Calendar
// ---------------------------------------------------------------------------

export interface ServerEvent {
  id: string;
  title: string;
  description: string | null;
  category: 'EXAM' | 'LAB' | 'LECTURE' | 'OFFICE_HOURS' | 'DEADLINE';
  startsAt: string;
  endsAt: string;
  timezone: string;
  courseId: string | null;
  /** EVENT is a stored event; QUIZ and ASSIGNMENT are due dates the API works out (read-only). */
  source: 'EVENT' | 'QUIZ' | 'ASSIGNMENT';
  itemId: string | null;
  /** The viewer has an extension that moves this due date. */
  extended: boolean;
  /** The viewer has submitted the work or used every attempt. */
  completed: boolean;
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
        const r = await api.get<{ data: ServerEvent[]; nextDeadline: ServerEvent | null }>('/api/v1/calendar/events', { params: { from } });
        if (!alive) return;
        setEvents(r.data);
        setNext(r.nextDeadline);
        setError(null);
      } catch (e) {
        if (alive) setError(messageOf(e, 'Could not load the calendar'));
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
    const res = await fetch('/api/v1/calendar/export.ics', { credentials: 'include' });
    if (!res.ok) throw new Error('Could not export the calendar');
    const url = URL.createObjectURL(await res.blob());
    const a = document.createElement('a');
    a.href = url;
    a.download = 'lms-calendar.ics';
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
  if (ms <= 0) return 'In progress or past';
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
  role: 'STUDENT' | 'INSTRUCTOR' | 'TA';
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
  /** Only staff are sent hidden threads. */
  hidden: boolean;
  hasVerifiedAnswer: boolean;
  replies: ForumReplyView[];
}

const roleOf = (r: string): ForumReplyView['role'] => (r === 'INSTRUCTOR' ? 'INSTRUCTOR' : r === 'TEACHING_ASSISTANT' ? 'TA' : 'STUDENT');

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
  author: t.author?.name ?? 'Unknown',
  category: t.category,
  content: t.body,
  timestamp: timeAgo(t.createdAt),
  upvotes: t.upvotes ?? 0,
  votedByMe: !!t.votedByMe,
  replyCount: t.replyCount ?? replies.length,
  pinned: !!t.pinned,
  locked: !!t.locked,
  hidden: !!t.hidden,
  hasVerifiedAnswer: replies.some((r) => r.isVerifiedAnswer),
  replies,
});

/** Threads of one course, with the active thread's replies loaded on demand. */
export function useForum(courseId?: string | null, isStaff = false) {
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
      // Staff also see hidden threads, so they can restore them.
      const r = await api.get<{ data: any[] }>(`/api/v1/courses/${courseId}/threads`, {
        params: { limit: 50, includeHidden: isStaff ? 'true' : 'false' },
      });
      if (!alive.current) return;
      setThreads(r.data.map((t) => toThread(t)));
      setActiveId((cur) => cur ?? r.data[0]?.id ?? null);
      setError(null);
    } catch (e) {
      if (alive.current) setError(messageOf(e, 'Could not load discussions'));
    } finally {
      if (alive.current) setIsLoading(false);
    }
  }, [courseId, isStaff]);

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
      setThreads((prev) =>
        prev.map((t) =>
          t.id === threadId
            ? {
                ...t,
                upvotes: r.data.upvotes ?? t.upvotes,
                votedByMe: !!r.data.votedByMe,
                replyCount: list.filter((x: ForumReplyView) => !x.hidden).length,
              }
            : t
        )
      );
    } catch (e) {
      if (alive.current) setError(messageOf(e, 'Could not load replies'));
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
        if (!courseId) throw new Error('No course selected');
        const r = await api.post<{ data: any }>(`/api/v1/courses/${courseId}/threads`, input);
        await loadThreads();
        setActiveId(r.data.id);
      }, 'Could not post your question'),
    [act, courseId, loadThreads]
  );

  const postReply = useCallback(
    (threadId: string, body: string) =>
      act(async () => {
        await api.post(`/api/v1/threads/${threadId}/posts`, { body });
        await loadReplies(threadId);
      }, 'Could not post your reply'),
    [act, loadReplies]
  );

  const vote = useCallback(
    (targetType: 'THREAD' | 'POST', targetId: string, threadId: string) =>
      act(async () => {
        const r = await api.post<{ data: { voted: boolean; upvotes: number } }>('/api/v1/votes', { targetType, targetId });
        if (targetType === 'THREAD') {
          setThreads((prev) => prev.map((t) => (t.id === targetId ? { ...t, upvotes: r.data.upvotes, votedByMe: r.data.voted } : t)));
        } else {
          setReplies((prev) => ({
            ...prev,
            [threadId]: (prev[threadId] ?? []).map((p) =>
              p.id === targetId ? { ...p, upvotes: r.data.upvotes, votedByMe: r.data.voted } : p
            ),
          }));
        }
      }, 'Could not record your vote'),
    [act]
  );

  /** Course staff only; the API answers 403 to anyone else. */
  const endorse = useCallback(
    (postId: string, threadId: string) =>
      act(async () => {
        await api.post(`/api/v1/posts/${postId}/endorse`);
        await loadReplies(threadId);
      }, 'Could not verify this answer'),
    [act, loadReplies]
  );

  /** Course staff: pin, lock or hide a thread. */
  const moderateThread = useCallback(
    (threadId: string, patch: { pinned?: boolean; locked?: boolean; hidden?: boolean }) =>
      act(async () => {
        await api.patch(`/api/v1/threads/${threadId}/moderate`, patch);
        await loadThreads();
      }, 'Could not update the thread'),
    [act, loadThreads]
  );

  /** Course staff: hide or restore a reply. */
  const moderatePost = useCallback(
    (postId: string, hidden: boolean, threadId: string) =>
      act(async () => {
        await api.patch(`/api/v1/posts/${postId}/moderate`, { hidden });
        await loadReplies(threadId);
      }, 'Could not update the reply'),
    [act, loadReplies]
  );

  const report = useCallback(
    (targetType: 'THREAD' | 'POST', targetId: string, reason: string) =>
      act(async () => {
        await api.post('/api/v1/flags', { targetType, targetId, reason });
      }, 'Could not send your report'),
    [act]
  );

  const withReplies = threads.map((t) => {
    const list = replies[t.id];
    return list ? { ...t, replies: list, hasVerifiedAnswer: list.some((r) => r.isVerifiedAnswer) } : t;
  });

  return {
    threads: withReplies,
    activeId,
    setActiveId,
    isLoading,
    busy,
    error,
    createThread,
    postReply,
    vote,
    endorse,
    report,
    moderateThread,
    moderatePost,
    refresh: loadThreads,
    refreshReplies: loadReplies,
  };
}

export interface ForumFlagView {
  id: string;
  targetType: 'THREAD' | 'POST';
  targetId: string;
  reason: string;
  createdAt: string;
  reporterName: string;
  target: { threadId: string; threadTitle: string; excerpt: string; hidden: boolean } | null;
}

/** Open reports on a course's discussion, for its staff. Pass `null` to skip loading. */
export function useModerationQueue(courseId: string | null | undefined) {
  const [flags, setFlags] = useState<ForumFlagView[]>([]);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    if (!courseId) {
      setFlags([]);
      return;
    }
    try {
      const r = await api.get<{ data: ForumFlagView[] }>(`/api/v1/courses/${courseId}/flags`);
      setFlags(r.data);
      setError(null);
    } catch (e) {
      setError(messageOf(e, 'Could not load the reports'));
    }
  }, [courseId]);
  useEffect(() => {
    load();
  }, [load]);
  return { flags, error, reload: load };
}
