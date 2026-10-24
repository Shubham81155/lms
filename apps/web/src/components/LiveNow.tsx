'use client';

import React, { useEffect, useState } from 'react';
import { Video } from 'lucide-react';
import { api } from '@/lib/api';
import { useAction, useApiData } from '@/hooks/useApiData';
import { Banner } from '@/components/admin/IdentityPanels';
import { LiveRoom, type JoinInfo } from '@/components/LiveRoom';
import { LiveSessionView, startsIn } from '@/lib/live';

const POLL_MS = 30_000;

/**
 * Live classes in the signed-in person's own courses: what is on air now (with a Join button) and
 * what starts in the next week. Renders nothing when there is none.
 */
export const LiveNow: React.FC = () => {
  const { data, reload } = useApiData<{ configured: boolean; data: LiveSessionView[] }>('/api/v1/live-sessions/mine');
  const { busy, error, run } = useAction();
  const [room, setRoom] = useState<{ title: string; join: JoinInfo } | null>(null);

  useEffect(() => {
    const t = setInterval(reload, POLL_MS);
    return () => clearInterval(t);
  }, [reload]);

  const sessions = data?.data ?? [];
  if (sessions.length === 0 && !error) return null;
  const live = sessions.filter((s) => s.status === 'LIVE');
  const upcoming = sessions.filter((s) => s.status === 'SCHEDULED');

  const join = (s: LiveSessionView) =>
    run(async () => {
      const r = await api.post<{ data: JoinInfo }>(`/api/v1/live-sessions/${s.id}/join`);
      setRoom({ title: s.title, join: r.data });
    });

  return (
    <section aria-label="Live classes" className="space-y-3">
      {error && <Banner kind="error">{error}</Banner>}
      {live.map((s) => (
        <div
          key={s.id}
          className="bg-gradient-to-r from-danger/10 via-surface to-surface border border-danger/40 rounded-2xl p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4 shadow-xl"
        >
          <div className="flex items-center gap-4">
            <div className="h-12 w-12 rounded-2xl bg-rose-600 text-on-brand flex items-center justify-center shadow-lg shadow-rose-600/30">
              <Video className="h-6 w-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-rose-500 animate-ping" />
                <span className="text-[11px] font-bold uppercase tracking-wider text-danger">Live now</span>
              </div>
              <h3 className="font-bold text-base text-ink">{s.title}</h3>
              <p className="text-xs text-ink-muted">{s.course ? `${s.course.code} · ${s.course.title}` : ''}</p>
            </div>
          </div>
          <button
            onClick={() => join(s)}
            disabled={busy || !data?.configured}
            className="px-5 py-2.5 bg-rose-600 hover:bg-rose-500 disabled:opacity-60 text-on-brand rounded-xl text-xs font-bold flex items-center justify-center gap-2 shadow-lg shadow-rose-600/20"
          >
            <Video className="h-4 w-4" />
            <span>{data?.configured ? 'Join' : 'Unavailable'}</span>
          </button>
        </div>
      ))}
      {upcoming.length > 0 && (
        <div className="bg-surface border border-line rounded-2xl p-4">
          <div className="text-[11px] font-bold uppercase tracking-wider text-ink-subtle mb-2">Upcoming live classes</div>
          <ul className="space-y-1.5">
            {upcoming.map((s) => (
              <li key={s.id} className="flex items-center justify-between text-xs">
                <span className="text-ink">
                  {s.title} <span className="text-ink-subtle">· {s.course?.code}</span>
                </span>
                <span className="text-accent">
                  {startsIn(s.scheduledAt)} ·{' '}
                  {new Date(s.scheduledAt).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' })}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {room && (
        <LiveRoom
          title={room.title}
          join={room.join}
          onLeave={() => {
            setRoom(null);
            reload();
          }}
        />
      )}
    </section>
  );
};
