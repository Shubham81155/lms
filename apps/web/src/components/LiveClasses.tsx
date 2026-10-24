'use client';

import React, { useEffect, useState } from 'react';
import { Radio, Users, X } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
import { useAction, useApiData } from '@/hooks/useApiData';
import { useStaffCourses } from '@/hooks/useStaffCourses';
import { Banner } from '@/components/admin/IdentityPanels';
import { LiveRoom, type JoinInfo } from '@/components/LiveRoom';
import { fromLocalInput, LiveSessionView, scheduleProblem, startsIn, toLocalInput } from '@/lib/live';
import { useEscapeKey } from '@/hooks/useEscapeKey';

interface AttendanceRow {
  userId: string;
  name: string;
  email: string;
  minutes: number;
  present: boolean;
  joinCount: number;
  inRoomNow: boolean;
}
interface Attendance {
  data: AttendanceRow[];
  summary: { enrolled: number; present: number };
}

const input =
  'bg-canvas border border-line rounded-xl px-3 py-2 text-xs text-ink placeholder:text-ink-subtle focus:outline-none focus:border-brand';
const primary = 'px-4 py-2 bg-brand hover:bg-brand-hover disabled:opacity-50 text-on-brand rounded-xl text-xs font-bold transition-all';
const ghost =
  'px-3 py-1.5 bg-surface hover:bg-raised border border-line text-ink rounded-lg text-[11px] font-semibold transition-colors disabled:opacity-50';

const STATUS: Record<string, string> = {
  SCHEDULED: 'bg-brand/15 text-brand-fg border-brand/30',
  LIVE: 'bg-danger/10 text-danger border-danger/30',
  ENDED: 'bg-raised text-ink border-line',
};

const AttendanceTable: React.FC<{ sessionId: string }> = ({ sessionId }) => {
  const { data, isLoading, error } = useApiData<Attendance>(`/api/v1/live-sessions/${sessionId}/attendance`);
  if (isLoading) return <p className="text-[11px] text-ink-subtle">Loading…</p>;
  if (error) return <Banner kind="error">{error}</Banner>;
  if (!data) return null;
  return (
    <div className="space-y-2">
      <p className="text-[11px] text-ink-muted">
        {data.summary.present} of {data.summary.enrolled} enrolled learners attended (5+ minutes).
      </p>
      <table className="w-full text-xs">
        <thead className="text-ink-subtle text-left">
          <tr>
            <th className="py-1">Learner</th>
            <th>Minutes</th>
            <th>Joins</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {data.data.map((r) => (
            <tr key={r.userId} className="border-t border-line">
              <td className="py-1.5 text-ink">{r.name}</td>
              <td className="text-ink-muted">{r.minutes}</td>
              <td className="text-ink-muted">{r.joinCount}</td>
              <td className={r.present ? 'text-success' : 'text-ink-subtle'}>
                {r.inRoomNow ? 'In the room' : r.present ? 'Present' : 'Absent'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

export const LiveClasses: React.FC<{
  onClose: () => void;
  /** Open on this course when the person may use it. */ initialCourseId?: string | null;
}> = ({ onClose, initialCourseId }) => {
  useEscapeKey(onClose);
  const { user } = useAuth();
  const { courses, isLoading: loadingCourses } = useStaffCourses();
  const [courseId, setCourseId] = useState('');
  const [title, setTitle] = useState('');
  const [when, setWhen] = useState(() => toLocalInput(new Date(Date.now() + 3_600_000)));
  const [duration, setDuration] = useState(60);
  const [studentVideo, setStudentVideo] = useState(false);
  const [openAttendance, setOpenAttendance] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [room, setRoom] = useState<{ title: string; join: JoinInfo } | null>(null);
  const { busy, error, run, clearError } = useAction();

  useEffect(() => {
    if (!courseId && courses.length)
      setCourseId(initialCourseId && courses.some((c) => c.id === initialCourseId) ? initialCourseId : courses[0].id);
  }, [courses, courseId]);
  const sessions = useApiData<{ configured: boolean; data: LiveSessionView[] }>(
    courseId ? `/api/v1/courses/${courseId}/live-sessions` : null
  );
  const list = sessions.data?.data ?? [];

  const isAdmin = user?.role === 'TENANT_ADMIN' || user?.role === 'SUPER_ADMIN';
  const canManage = isAdmin || user?.role === 'INSTRUCTOR';
  const editedSession = editingId ? list.find((x) => x.id === editingId) : undefined;
  const startUnchanged = !!editedSession && when === toLocalInput(new Date(editedSession.scheduledAt));
  const problem = scheduleProblem({ title, when, durationMins: duration }, Date.now(), startUnchanged);

  const joinRoom = (s: LiveSessionView) =>
    run(async () => {
      const r = await api.post<{ data: JoinInfo }>(`/api/v1/live-sessions/${s.id}/join`);
      setRoom({ title: s.title, join: r.data });
    });

  const schedule = (e: React.FormEvent) => {
    e.preventDefault();
    run(async () => {
      const body = { title: title.trim(), scheduledAt: fromLocalInput(when), durationMins: duration, allowStudentVideo: studentVideo };
      if (editingId) {
        // Send only what changed, so retitling a class does not re-submit a start time that has passed.
        const was = list.find((x) => x.id === editingId);
        const changes = was
          ? {
              ...(body.title !== was.title ? { title: body.title } : {}),
              ...(when !== toLocalInput(new Date(was.scheduledAt)) ? { scheduledAt: body.scheduledAt } : {}),
              ...(duration !== was.durationMins ? { durationMins: duration } : {}),
              ...(studentVideo !== was.allowStudentVideo ? { allowStudentVideo: studentVideo } : {}),
            }
          : body;
        if (Object.keys(changes).length > 0) await api.patch(`/api/v1/live-sessions/${editingId}`, changes);
        setEditingId(null);
      } else {
        await api.post(`/api/v1/courses/${courseId}/live-sessions`, body);
      }
      setTitle('');
      await sessions.reload();
    });
  };

  const startEditing = (s: LiveSessionView) => {
    clearError();
    setEditingId(s.id);
    setTitle(s.title);
    setWhen(toLocalInput(new Date(s.scheduledAt)));
    setDuration(s.durationMins);
    setStudentVideo(!!s.allowStudentVideo);
  };

  const stopEditing = () => {
    setEditingId(null);
    setTitle('');
  };

  const act = (path: string, then?: () => Promise<unknown>) =>
    run(async () => {
      await api.post(path);
      await sessions.reload();
      await then?.();
    });

  return (
    <div
      className="fixed inset-0 z-50 bg-canvas/85 backdrop-blur-md flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Live classes"
    >
      <div className="bg-surface border border-line rounded-3xl w-full max-w-4xl h-[88vh] flex flex-col overflow-hidden shadow-2xl">
        <div className="bg-canvas border-b border-line px-6 py-4 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-2xl bg-danger/20 border border-danger/30 flex items-center justify-center text-danger">
              <Radio className="h-5 w-5" />
            </div>
            <div>
              <h3 className="font-bold text-base text-ink">Live classes</h3>
              <p className="text-xs text-ink-muted">Schedule, run and review live sessions.</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <select className={input} aria-label="Course" value={courseId} onChange={(e) => setCourseId(e.target.value)}>
              {courses.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.code} · {c.title}
                </option>
              ))}
            </select>
            <button onClick={onClose} aria-label="Close" className="p-1 rounded-xl hover:bg-raised text-ink-muted hover:text-ink">
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {sessions.data && !sessions.data.configured && (
            <Banner kind="error">
              Live classes are not set up on this server yet. An administrator needs to connect a LiveKit media server (LIVEKIT_URL,
              LIVEKIT_API_KEY, LIVEKIT_API_SECRET). You can still schedule classes.
            </Banner>
          )}
          {(error || sessions.error) && <Banner kind="error">{error || sessions.error}</Banner>}
          {loadingCourses && <p className="text-xs text-ink-subtle">Loading…</p>}
          {!loadingCourses && courses.length === 0 && (
            <p className="text-xs text-ink-subtle text-center p-10">You are not assigned to any course yet.</p>
          )}

          {canManage && courseId && (
            <form onSubmit={schedule} onChange={clearError} className="bg-canvas border border-line rounded-2xl p-4 space-y-3">
              <h4 className="text-sm font-bold text-ink">{editingId ? 'Change this class' : 'Schedule a class'}</h4>
              <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                <input
                  className={`${input} md:col-span-2`}
                  aria-label="Title"
                  placeholder="Title"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                />
                <input
                  className={input}
                  type="datetime-local"
                  aria-label="Start time"
                  value={when}
                  onChange={(e) => setWhen(e.target.value)}
                />
                <input
                  className={input}
                  type="number"
                  min={5}
                  max={480}
                  step={5}
                  aria-label="Duration in minutes"
                  value={duration}
                  onChange={(e) => setDuration(Number(e.target.value))}
                />
              </div>
              <label className="flex items-center gap-2 text-xs text-ink">
                <input type="checkbox" checked={studentVideo} onChange={(e) => setStudentVideo(e.target.checked)} />
                Let learners use their camera and microphone
              </label>
              <div className="flex items-center gap-3">
                <button className={primary} disabled={busy || !!problem}>
                  {editingId ? 'Save changes' : 'Schedule'}
                </button>
                {editingId && (
                  <button type="button" className={ghost} onClick={stopEditing}>
                    Cancel
                  </button>
                )}
                {problem && title.trim().length > 0 && <span className="text-[11px] text-accent">{problem}</span>}
              </div>
            </form>
          )}

          <ul className="space-y-3">
            {courseId && sessions.data && list.length === 0 && (
              <li className="text-xs text-ink-subtle text-center p-8">No live classes yet.</li>
            )}
            {list.map((s) => (
              <li key={s.id} className="bg-canvas border border-line rounded-2xl p-4 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <strong className="text-sm text-ink">{s.title}</strong>
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${STATUS[s.status] ?? STATUS.ENDED}`}>
                        {s.status}
                      </span>
                    </div>
                    <div className="text-[11px] text-ink-subtle">
                      {new Date(s.scheduledAt).toLocaleString()} · {s.durationMins} min
                      {s.status === 'SCHEDULED' ? ` · ${startsIn(s.scheduledAt)}` : ''}
                      {s.attendeeCount !== undefined && s.status !== 'SCHEDULED' ? ` · ${s.attendeeCount} joined` : ''}
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {s.status === 'SCHEDULED' && canManage && (
                      <>
                        <button
                          className={primary}
                          disabled={busy || !sessions.data?.configured}
                          onClick={() => act(`/api/v1/live-sessions/${s.id}/start`, () => joinRoom(s))}
                        >
                          Start and join
                        </button>
                        <button className={ghost} disabled={busy} onClick={() => startEditing(s)} aria-label={`Edit ${s.title}`}>
                          Edit
                        </button>
                        <button
                          className={ghost}
                          disabled={busy}
                          onClick={() =>
                            window.confirm(`Cancel "${s.title}"? Learners will be told.`) && act(`/api/v1/live-sessions/${s.id}/cancel`)
                          }
                        >
                          Cancel
                        </button>
                      </>
                    )}
                    {s.status === 'LIVE' && (
                      <>
                        <button className={primary} disabled={busy} onClick={() => joinRoom(s)}>
                          Join
                        </button>
                        {canManage && (
                          <button
                            className={ghost}
                            disabled={busy}
                            onClick={() => window.confirm('End the class for everyone?') && act(`/api/v1/live-sessions/${s.id}/end`)}
                          >
                            End class
                          </button>
                        )}
                      </>
                    )}
                    {s.status !== 'SCHEDULED' && (
                      <button className={ghost} onClick={() => setOpenAttendance(openAttendance === s.id ? null : s.id)}>
                        <Users className="h-3 w-3 inline mr-1" />
                        Attendance
                      </button>
                    )}
                  </div>
                </div>
                {openAttendance === s.id && <AttendanceTable sessionId={s.id} />}
              </li>
            ))}
          </ul>
        </div>
      </div>

      {room && (
        <LiveRoom
          title={room.title}
          join={room.join}
          onLeave={() => {
            setRoom(null);
            sessions.reload();
          }}
        />
      )}
    </div>
  );
};
