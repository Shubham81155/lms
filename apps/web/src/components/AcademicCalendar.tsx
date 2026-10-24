'use client';

import React, { useState } from 'react';
import { useCalendarEvents, type ServerEvent } from '@/hooks/useEngagement';
import {
  X,
  Calendar as CalendarIcon,
  Clock,
  Video,
  FileCheck,
  AlertTriangle,
  Award,
  Download,
  ChevronLeft,
  ChevronRight,
  Sparkles,
  CheckCircle2,
} from 'lucide-react';
import { useEscapeKey } from '@/hooks/useEscapeKey';
import { useT, type Translator } from '@/lib/i18n';
import { activateOnKey } from '@/lib/a11y';

export interface CalendarEvent {
  id: string;
  title: string;
  description: string | null;
  dateStr: string;
  time: string;
  type: 'EXAM' | 'ASSIGNMENT' | 'LECTURE' | 'OFFICE_HOURS';
  countdown: string;
  startsAt: string;
  /** Badge text: the event type, or "Quiz due" / "Due" for due dates (in the viewer's language). */
  label: string;
  extended: boolean;
  completed: boolean;
}

const TYPE_BY_CATEGORY: Record<ServerEvent['category'], CalendarEvent['type']> = {
  EXAM: 'EXAM',
  LAB: 'ASSIGNMENT',
  DEADLINE: 'ASSIGNMENT',
  LECTURE: 'LECTURE',
  OFFICE_HOURS: 'OFFICE_HOURS',
};

/**
 * Formats a stored event in its own time zone, so an exam shows the time the organiser meant. Due dates
 * have no organiser zone and show in the viewer's.
 */
function countdownText(t: Translator, startsAt: string, now: number = Date.now()): string {
  const ms = new Date(startsAt).getTime() - now;
  if (ms <= 0) return t('community.calendar.past');
  const h = Math.floor(ms / 3_600_000);
  if (h < 1) return t('community.calendar.inMin', { count: t.number(Math.max(1, Math.floor(ms / 60_000))) });
  if (h < 48) return t('community.calendar.inHours', { count: t.number(h) });
  return t('community.calendar.inDays', { count: t.number(Math.floor(h / 24)) });
}

function toView(e: ServerEvent, t: Translator): CalendarEvent {
  const tz = e.source === 'EVENT' ? e.timezone || 'UTC' : Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  const fmt = (opts: Intl.DateTimeFormatOptions, d: string) => {
    try {
      return t.date(d, { timeZone: tz, ...opts });
    } catch {
      return t.date(d, { timeZone: 'UTC', ...opts });
    }
  };
  const day = fmt({ weekday: 'short', month: 'short', day: 'numeric' }, e.startsAt);
  const start = fmt({ hour: 'numeric', minute: '2-digit' }, e.startsAt);
  const end = fmt({ hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }, e.endsAt);
  const due = e.source !== 'EVENT';
  return {
    id: e.id,
    title: e.title,
    description: e.description,
    dateStr: e.startsAt.slice(0, 10),
    time: due ? t('community.calendar.dueAt', { day, end }) : t('community.calendar.range', { day, start, end }),
    type: TYPE_BY_CATEGORY[e.category] ?? 'ASSIGNMENT',
    label:
      e.source === 'QUIZ'
        ? t('community.calendar.quizDue')
        : e.source === 'ASSIGNMENT'
          ? t('community.calendar.due')
          : t.dyn(`community.calendar.cat.${e.category}`, e.category.replace('_', ' ')),
    extended: e.extended,
    completed: e.completed,
    countdown: countdownText(t, e.startsAt),
    startsAt: e.startsAt,
  };
}

interface AcademicCalendarProps {
  onClose: () => void;
  onSelectEvent?: (event: CalendarEvent) => void;
}

export const AcademicCalendar: React.FC<AcademicCalendarProps> = ({ onClose, onSelectEvent }) => {
  const t = useT();
  useEscapeKey(onClose);
  const [selectedView, setSelectedView] = useState<'MONTH' | 'AGENDA'>('AGENDA');
  const [calendarSyncNotification, setCalendarSyncNotification] = useState<{ ok: boolean; message?: string } | null>(null);

  const { events: raw, next, isLoading, error, downloadIcs } = useCalendarEvents();
  const events = raw.map((e) => toView(e, t));
  const nextView = next ? toView(next, t) : null;

  const handleExportIcal = async () => {
    try {
      await downloadIcs();
      setCalendarSyncNotification({ ok: true });
    } catch (e: any) {
      setCalendarSyncNotification({ ok: false, message: e?.message });
    }
    setTimeout(() => setCalendarSyncNotification(null), 4000);
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-canvas/85 backdrop-blur-md flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label={t('community.calendar.label')}
    >
      <div className="bg-surface border border-line rounded-3xl w-full max-w-5xl h-[88vh] flex flex-col overflow-hidden shadow-2xl">
        {/* Header */}
        <div className="bg-canvas border-b border-line px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-2xl bg-brand/20 border border-brand/30 flex items-center justify-center text-brand-fg">
              <CalendarIcon className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-bold text-base text-ink">{t('community.calendar.title')}</h3>
              </div>
              <p className="text-xs text-ink-muted">{t('community.calendar.subtitle')}</p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={handleExportIcal}
              className="px-3.5 py-1.5 bg-surface hover:bg-raised border border-line text-ink rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-colors"
            >
              <Download className="h-3.5 w-3.5 text-brand-fg" />
              <span>{t('community.calendar.export')}</span>
            </button>
            <button
              onClick={onClose}
              aria-label={t('common.close')}
              className="p-1 rounded-xl hover:bg-raised text-ink-muted hover:text-ink transition-colors"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Sync Banner */}
        {calendarSyncNotification && (
          <div className="bg-success/10 border-b border-success/30 px-6 py-2.5 text-xs text-success flex items-center gap-2 animate-fadeIn">
            <CheckCircle2 className="h-4 w-4 text-success" />
            <span className="font-semibold">
              {calendarSyncNotification.ok
                ? t('community.calendar.exported')
                : calendarSyncNotification.message || t('community.calendar.exportFailed')}
            </span>
          </div>
        )}

        {/* Next Deadline Spotlight */}
        {nextView && (
          <div className="bg-gradient-to-r from-danger/10 via-canvas to-surface border-b border-danger/30 px-6 py-3.5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="h-8 w-8 rounded-xl bg-danger/30 text-danger border border-danger/40 flex items-center justify-center font-bold">
                <Clock className="h-4 w-4" />
              </div>
              <div>
                <span className="text-[10px] font-bold uppercase tracking-wider text-danger block">
                  {t('community.calendar.nextDeadline')}
                </span>
                <strong className="text-xs text-ink">{nextView.title}</strong>
                <span className="text-xs text-ink-muted ml-2">• {nextView.time}</span>
              </div>
            </div>

            <span className="text-xs font-mono font-bold text-accent bg-accent/10 border border-accent/30 px-3 py-1 rounded-full">
              {nextView.countdown}
            </span>
          </div>
        )}

        {/* Main Body */}
        <div className="flex-1 p-6 overflow-y-auto space-y-6">
          {/* View Toggles */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-sm font-bold text-ink">{t('community.calendar.itinerary')}</span>
              <span className="text-xs text-ink-muted">
                ({t.plural('community.calendar.events', events.length, { count: t.number(events.length) })})
              </span>
            </div>

            <div className="flex items-center gap-2 text-xs">
              <span className="flex items-center gap-1.5 text-ink-muted">
                <span className="h-2 w-2 rounded-full bg-rose-500" />
                <span>{t('community.calendar.legendExams')}</span>
              </span>
              <span className="flex items-center gap-1.5 text-ink-muted">
                <span className="h-2 w-2 rounded-full bg-brand-hover" />
                <span>{t('community.calendar.legendLabs')}</span>
              </span>
              <span className="flex items-center gap-1.5 text-ink-muted">
                <span className="h-2 w-2 rounded-full bg-purple-500" />
                <span>{t('community.calendar.legendLectures')}</span>
              </span>
              <span className="flex items-center gap-1.5 text-ink-muted">
                <span className="h-2 w-2 rounded-full bg-emerald-500" />
                <span>{t('community.calendar.legendOfficeHours')}</span>
              </span>
            </div>
          </div>

          {/* Agenda Event Cards */}
          <div className="space-y-3">
            {isLoading && <div className="text-xs text-ink-subtle p-6 text-center">{t('community.calendar.loading')}</div>}
            {error && (
              <div role="alert" className="text-xs text-danger p-6 text-center">
                {error}
              </div>
            )}
            {!isLoading && !error && events.length === 0 && (
              <div className="text-xs text-ink-subtle p-10 text-center bg-canvas border border-line rounded-2xl">
                {t('community.calendar.empty')}
              </div>
            )}
            {events.map((ev) => (
              // The card holds its own buttons, so it cannot be a button itself; Enter or Space on it selects the event.
              // eslint-disable-next-line jsx-a11y/no-static-element-interactions
              <div
                key={ev.id}
                onClick={() => onSelectEvent && onSelectEvent(ev)}
                // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex
                tabIndex={onSelectEvent ? 0 : undefined}
                onKeyDown={onSelectEvent ? activateOnKey(() => onSelectEvent(ev)) : undefined}
                className="bg-canvas border border-line/90 hover:border-line rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4 transition-all group cursor-pointer shadow-md"
              >
                <div className="flex items-center gap-4">
                  <div
                    className={`h-11 w-11 rounded-2xl flex items-center justify-center font-bold text-ink shrink-0 shadow-md ${
                      ev.type === 'EXAM'
                        ? 'bg-danger/30 border border-danger/50 text-danger'
                        : ev.type === 'ASSIGNMENT'
                          ? 'bg-brand/30 border border-brand/50 text-brand-fg'
                          : ev.type === 'LECTURE'
                            ? 'bg-orchid/30 border border-orchid/50 text-orchid'
                            : 'bg-success/30 border border-success/50 text-success'
                    }`}
                  >
                    {ev.type === 'EXAM' ? (
                      <AlertTriangle className="h-5 w-5" />
                    ) : ev.type === 'LECTURE' ? (
                      <Video className="h-5 w-5" />
                    ) : (
                      <FileCheck className="h-5 w-5" />
                    )}
                  </div>

                  <div>
                    <div className="flex items-center gap-2">
                      <strong className="text-sm text-ink group-hover:text-brand-fg transition-colors">{ev.title}</strong>
                      <span
                        className={`text-[9px] font-bold px-2 py-0.5 rounded-full ${
                          ev.type === 'EXAM'
                            ? 'bg-danger/10 text-danger border border-danger/30'
                            : ev.type === 'ASSIGNMENT'
                              ? 'bg-brand/15 text-brand-fg border border-brand/30'
                              : ev.type === 'LECTURE'
                                ? 'bg-orchid/15 text-orchid border border-orchid/30'
                                : 'bg-success/10 text-success border border-success/30'
                        }`}
                      >
                        {ev.label}
                      </span>
                      {ev.extended && (
                        <span className="text-[9px] font-bold px-2 py-0.5 rounded-full bg-accent/10 text-accent border border-accent/30">
                          {t('community.calendar.extended')}
                        </span>
                      )}
                      {ev.completed && (
                        <span className="text-[9px] font-bold px-2 py-0.5 rounded-full bg-success/10 text-success border border-success/30 inline-flex items-center gap-1">
                          <CheckCircle2 className="h-2.5 w-2.5" />
                          {t('community.calendar.done')}
                        </span>
                      )}
                    </div>

                    {ev.description && <div className="text-xs text-ink-muted mt-1 line-clamp-2">{ev.description}</div>}
                  </div>
                </div>

                <div className="flex sm:flex-col items-center sm:items-end justify-between sm:justify-center border-t sm:border-t-0 border-line pt-2 sm:pt-0 shrink-0">
                  <span className="text-xs font-bold text-ink">{ev.time}</span>
                  <span className="text-[11px] text-accent font-medium sm:mt-0.5">{ev.countdown}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
