"use client";

import React, { useState } from "react";
import { countdown, useCalendarEvents, type ServerEvent } from "@/hooks/useEngagement";
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
} from "lucide-react";

export interface CalendarEvent {
  id: string;
  title: string;
  description: string | null;
  dateStr: string;
  time: string;
  type: "EXAM" | "ASSIGNMENT" | "LECTURE" | "OFFICE_HOURS";
  countdown: string;
  startsAt: string;
}

const TYPE_BY_CATEGORY: Record<ServerEvent["category"], CalendarEvent["type"]> = {
  EXAM: "EXAM",
  LAB: "ASSIGNMENT",
  DEADLINE: "ASSIGNMENT",
  LECTURE: "LECTURE",
  OFFICE_HOURS: "OFFICE_HOURS",
};

/** Formats in the event's own time zone, so an exam shows the time the organiser meant. */
function toView(e: ServerEvent): CalendarEvent {
  const tz = e.timezone || "UTC";
  const fmt = (opts: Intl.DateTimeFormatOptions, d: string) => {
    try {
      return new Intl.DateTimeFormat(undefined, { timeZone: tz, ...opts }).format(new Date(d));
    } catch {
      return new Intl.DateTimeFormat(undefined, { timeZone: "UTC", ...opts }).format(new Date(d));
    }
  };
  const day = fmt({ weekday: "short", month: "short", day: "numeric" }, e.startsAt);
  const start = fmt({ hour: "numeric", minute: "2-digit" }, e.startsAt);
  const end = fmt({ hour: "numeric", minute: "2-digit", timeZoneName: "short" }, e.endsAt);
  return {
    id: e.id,
    title: e.title,
    description: e.description,
    dateStr: e.startsAt.slice(0, 10),
    time: `${day}, ${start} - ${end}`,
    type: TYPE_BY_CATEGORY[e.category] ?? "ASSIGNMENT",
    countdown: countdown(e.startsAt),
    startsAt: e.startsAt,
  };
}

interface AcademicCalendarProps {
  onClose: () => void;
  onSelectEvent?: (event: CalendarEvent) => void;
}

export const AcademicCalendar: React.FC<AcademicCalendarProps> = ({
  onClose,
  onSelectEvent,
}) => {
  const [selectedView, setSelectedView] = useState<"MONTH" | "AGENDA">("AGENDA");
  const [calendarSyncNotification, setCalendarSyncNotification] = useState<string | null>(null);

  const { events: raw, next, isLoading, error, downloadIcs } = useCalendarEvents();
  const events = raw.map(toView);
  const nextView = next ? toView(next) : null;

  const handleExportIcal = async () => {
    try {
      await downloadIcs();
      setCalendarSyncNotification("Calendar exported (lms-calendar.ics). Import it into Google, Outlook or Apple Calendar.");
    } catch (e: any) {
      setCalendarSyncNotification(e?.message ?? "Could not export the calendar");
    }
    setTimeout(() => setCalendarSyncNotification(null), 4000);
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/85 backdrop-blur-md flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-slate-800 rounded-3xl w-full max-w-5xl h-[88vh] flex flex-col overflow-hidden shadow-2xl">
        {/* Header */}
        <div className="bg-slate-950 border-b border-slate-800 px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-2xl bg-blue-600/20 border border-blue-500/30 flex items-center justify-center text-blue-400">
              <CalendarIcon className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-bold text-base text-white">Unified Academic Calendar</h3>
              </div>
              <p className="text-xs text-slate-400">
                Synchronized deadlines, live lecture schedules, and examination windows.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={handleExportIcal}
              className="px-3.5 py-1.5 bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-200 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-colors"
            >
              <Download className="h-3.5 w-3.5 text-blue-400" />
              <span>Export iCal (.ics)</span>
            </button>
            <button
              onClick={onClose}
              className="p-1 rounded-xl hover:bg-slate-800 text-slate-400 hover:text-white transition-colors"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Sync Banner */}
        {calendarSyncNotification && (
          <div className="bg-emerald-950/90 border-b border-emerald-800/80 px-6 py-2.5 text-xs text-emerald-300 flex items-center gap-2 animate-fadeIn">
            <CheckCircle2 className="h-4 w-4 text-emerald-400" />
            <span className="font-semibold">{calendarSyncNotification}</span>
          </div>
        )}

        {/* Next Deadline Spotlight */}
        {nextView && (
          <div className="bg-gradient-to-r from-rose-950/40 via-slate-950 to-slate-900 border-b border-rose-900/40 px-6 py-3.5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="h-8 w-8 rounded-xl bg-rose-600/30 text-rose-400 border border-rose-500/40 flex items-center justify-center font-bold">
                <Clock className="h-4 w-4" />
              </div>
              <div>
                <span className="text-[10px] font-bold uppercase tracking-wider text-rose-400 block">
                  Next Academic Deadline
                </span>
                <strong className="text-xs text-white">{nextView.title}</strong>
                <span className="text-xs text-slate-400 ml-2">• {nextView.time}</span>
              </div>
            </div>

            <span className="text-xs font-mono font-bold text-amber-400 bg-amber-950/60 border border-amber-800/80 px-3 py-1 rounded-full">
              {nextView.countdown}
            </span>
          </div>
        )}

        {/* Main Body */}
        <div className="flex-1 p-6 overflow-y-auto space-y-6">
          {/* View Toggles */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-sm font-bold text-white">Upcoming Academic Itinerary</span>
              <span className="text-xs text-slate-400">({events.length} Events)</span>
            </div>

            <div className="flex items-center gap-2 text-xs">
              <span className="flex items-center gap-1.5 text-slate-400">
                <span className="h-2 w-2 rounded-full bg-rose-500" />
                <span>Exams</span>
              </span>
              <span className="flex items-center gap-1.5 text-slate-400">
                <span className="h-2 w-2 rounded-full bg-blue-500" />
                <span>Labs</span>
              </span>
              <span className="flex items-center gap-1.5 text-slate-400">
                <span className="h-2 w-2 rounded-full bg-purple-500" />
                <span>Lectures</span>
              </span>
              <span className="flex items-center gap-1.5 text-slate-400">
                <span className="h-2 w-2 rounded-full bg-emerald-500" />
                <span>Office Hours</span>
              </span>
            </div>
          </div>

          {/* Agenda Event Cards */}
          <div className="space-y-3">
            {isLoading && <div className="text-xs text-slate-500 p-6 text-center">Loading your schedule...</div>}
            {error && <div role="alert" className="text-xs text-rose-400 p-6 text-center">{error}</div>}
            {!isLoading && !error && events.length === 0 && (
              <div className="text-xs text-slate-500 p-10 text-center bg-slate-950 border border-slate-800 rounded-2xl">
                Nothing is scheduled yet.
              </div>
            )}
            {events.map((ev) => (
              <div
                key={ev.id}
                onClick={() => onSelectEvent && onSelectEvent(ev)}
                className="bg-slate-950 border border-slate-800/90 hover:border-slate-700 rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4 transition-all group cursor-pointer shadow-md"
              >
                <div className="flex items-center gap-4">
                  <div className={`h-11 w-11 rounded-2xl flex items-center justify-center font-bold text-white shrink-0 shadow-md ${
                    ev.type === "EXAM"
                      ? "bg-rose-600/30 border border-rose-500/50 text-rose-300"
                      : ev.type === "ASSIGNMENT"
                      ? "bg-blue-600/30 border border-blue-500/50 text-blue-300"
                      : ev.type === "LECTURE"
                      ? "bg-purple-600/30 border border-purple-500/50 text-purple-300"
                      : "bg-emerald-600/30 border border-emerald-500/50 text-emerald-300"
                  }`}>
                    {ev.type === "EXAM" ? (
                      <AlertTriangle className="h-5 w-5" />
                    ) : ev.type === "LECTURE" ? (
                      <Video className="h-5 w-5" />
                    ) : (
                      <FileCheck className="h-5 w-5" />
                    )}
                  </div>

                  <div>
                    <div className="flex items-center gap-2">
                      <strong className="text-sm text-white group-hover:text-blue-400 transition-colors">
                        {ev.title}
                      </strong>
                      <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full ${
                        ev.type === "EXAM"
                          ? "bg-rose-950 text-rose-400 border border-rose-800"
                          : ev.type === "ASSIGNMENT"
                          ? "bg-blue-950 text-blue-400 border border-blue-800"
                          : ev.type === "LECTURE"
                          ? "bg-purple-950 text-purple-400 border border-purple-800"
                          : "bg-emerald-950 text-emerald-400 border border-emerald-800"
                      }`}>
                        {ev.type.replace("_", " ")}
                      </span>
                    </div>

                    {ev.description && (
                      <div className="text-xs text-slate-400 mt-1 line-clamp-2">{ev.description}</div>
                    )}
                  </div>
                </div>

                <div className="flex sm:flex-col items-center sm:items-end justify-between sm:justify-center border-t sm:border-t-0 border-slate-900 pt-2 sm:pt-0 shrink-0">
                  <span className="text-xs font-bold text-slate-200">{ev.time}</span>
                  <span className="text-[11px] text-amber-400 font-medium sm:mt-0.5">{ev.countdown}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
