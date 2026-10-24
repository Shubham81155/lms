'use client';

import React, { useState } from 'react';
import { X, Megaphone, Pin } from 'lucide-react';
import { api } from '@/lib/api';
import { useAction, useApiData } from '@/hooks/useApiData';
import { useEscapeKey } from '@/hooks/useEscapeKey';
import { Banner } from '@/components/admin/IdentityPanels';
import { useT, type Translator } from '@/lib/i18n';

/** "just now", "5 min ago"... in the chosen language (same steps as the notification bell). */
export function relativeTime(t: Translator, iso: string, now: number = Date.now()): string {
  const s = Math.max(0, Math.floor((now - new Date(iso).getTime()) / 1000));
  if (s < 60) return t('work.ago.now');
  if (s < 3600) return t('work.ago.min', { count: t.number(Math.floor(s / 60)) });
  if (s < 86_400) return t('work.ago.hour', { count: t.number(Math.floor(s / 3600)) });
  return t('work.ago.day', { count: t.number(Math.floor(s / 86_400)) });
}

interface Announcement {
  id: string;
  title: string;
  body: string;
  pinned: boolean;
  createdAt: string;
  author: { id: string; name: string } | null;
}

const field =
  'w-full bg-canvas border border-line rounded-xl px-3 py-2 text-xs text-ink placeholder:text-ink-subtle focus:outline-none focus:border-brand';

/**
 * A course's announcements. Course staff (canPost) write them, pin them and remove them; posting notifies
 * every learner. Everyone else reads them.
 */
export const CourseAnnouncements: React.FC<{ courseId: string; courseLabel?: string; canPost: boolean; onClose: () => void }> = ({
  courseId,
  courseLabel,
  canPost,
  onClose,
}) => {
  useEscapeKey(onClose);
  const t = useT();
  const list = useApiData<{ data: Announcement[] }>(`/api/v1/courses/${courseId}/announcements`, { limit: 50 });
  const { busy, error, run } = useAction();
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [pinned, setPinned] = useState(false);
  const [notify, setNotify] = useState(true);
  const [notice, setNotice] = useState<string | null>(null);

  const post = (e: React.FormEvent) => {
    e.preventDefault();
    setNotice(null);
    run(async () => {
      const r = await api.post<{ notified: number }>(`/api/v1/courses/${courseId}/announcements`, {
        title: title.trim(),
        body: body.trim(),
        pinned,
        notify,
      });
      setTitle('');
      setBody('');
      setPinned(false);
      setNotice(notify ? t.plural('work.ann.postedNotified', r.notified) : t('work.ann.posted'));
      await list.reload();
    });
  };

  const togglePin = (a: Announcement) =>
    run(async () => {
      await api.patch(`/api/v1/announcements/${a.id}`, { pinned: !a.pinned });
      await list.reload();
    });

  const remove = (a: Announcement) =>
    run(async () => {
      if (!window.confirm(t('work.ann.confirmDelete', { title: a.title }))) return;
      await api.delete(`/api/v1/announcements/${a.id}`);
      await list.reload();
    });

  const items = list.data?.data ?? [];

  return (
    <div
      className="fixed inset-0 z-50 bg-canvas/85 backdrop-blur-md flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="ann-h"
    >
      <div className="bg-surface border border-line rounded-3xl w-full max-w-2xl h-[85vh] flex flex-col overflow-hidden shadow-2xl">
        <div className="bg-canvas border-b border-line px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <Megaphone className="h-5 w-5 text-brand-fg" />
            <h3 id="ann-h" className="font-bold text-sm text-ink">
              {courseLabel ? t('work.ann.titleWithCourse', { course: courseLabel }) : t('work.ann.title')}
            </h3>
          </div>
          <button onClick={onClose} aria-label={t('common.close')} className="p-1 rounded-xl hover:bg-raised text-ink-muted hover:text-ink">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {(error || list.error) && <Banner kind="error">{error || list.error}</Banner>}
          {notice && <Banner kind="ok">{notice}</Banner>}

          {canPost && (
            <form onSubmit={post} className="space-y-2 rounded-2xl border border-line bg-canvas p-4">
              <input
                className={field}
                placeholder={t('work.ann.titleField')}
                aria-label={t('work.ann.titleField')}
                maxLength={200}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
              <textarea
                className={field}
                rows={4}
                placeholder={t('work.ann.messagePlaceholder')}
                aria-label={t('work.ann.messageField')}
                maxLength={20000}
                value={body}
                onChange={(e) => setBody(e.target.value)}
              />
              <div className="flex flex-wrap items-center gap-4 text-xs text-ink">
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} /> {t('work.ann.notify')}
                </label>
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input type="checkbox" checked={pinned} onChange={(e) => setPinned(e.target.checked)} /> {t('work.ann.pinTop')}
                </label>
                <button
                  disabled={busy || !title.trim() || !body.trim()}
                  className="ml-auto px-4 py-2 rounded-xl bg-brand hover:bg-brand-hover disabled:opacity-50 text-on-brand text-xs font-bold"
                >
                  {busy ? t('work.ann.posting') : t('work.ann.post')}
                </button>
              </div>
            </form>
          )}

          {list.isLoading && <p className="text-xs text-ink-subtle">{t('common.loading')}</p>}
          {!list.isLoading && items.length === 0 && <p className="text-center text-xs text-ink-muted py-8">{t('work.ann.empty')}</p>}
          <ul className="space-y-3">
            {items.map((a) => (
              <li
                key={a.id}
                className={`rounded-2xl border p-4 space-y-1.5 ${a.pinned ? 'border-brand/40 bg-brand/5' : 'border-line bg-canvas'}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <h4 className="text-sm font-bold text-ink flex items-center gap-1.5">
                    {a.pinned && <Pin className="h-3.5 w-3.5 text-brand-fg" aria-label={t('work.ann.pinned')} />}
                    {a.title}
                  </h4>
                  <span className="shrink-0 text-[10px] text-ink-subtle">{relativeTime(t, a.createdAt)}</span>
                </div>
                <p className="text-xs text-ink whitespace-pre-line leading-relaxed">{a.body}</p>
                <div className="flex items-center justify-between text-[11px] text-ink-muted">
                  <span>{a.author?.name ?? t('work.ann.staff')}</span>
                  {canPost && (
                    <span className="flex gap-3">
                      <button onClick={() => togglePin(a)} disabled={busy} className="font-semibold hover:text-ink">
                        {a.pinned ? t('work.ann.unpin') : t('work.ann.pin')}
                      </button>
                      <button onClick={() => remove(a)} disabled={busy} className="font-semibold hover:text-danger">
                        {t('work.ann.delete')}
                      </button>
                    </span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
};
