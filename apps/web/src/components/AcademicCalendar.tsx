"use client";

import React, { useState } from "react";
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

interface CalendarEvent {
  id: string;
  title: string;
  course: string;
  dateStr: string; // "2026-10-13"
  time: string;
  type: "EXAM" | "ASSIGNMENT" | "LECTURE" | "OFFICE_HOURS";
  instructor: string;
  countdown?: string;
  isCompleted?: boolean;
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

  const events: CalendarEvent[] = [
    {
      id: "ev_1",
      title: "CS-101 Midterm Proctored Examination",
      course: "Advanced Distributed Systems",
      dateStr: "2026-10-13",
      time: "2:00 PM - 3:30 PM EST",
      type: "EXAM",
      instructor: "Prof. David Malan",
      countdown: "Tomorrow, 2:00 PM",
    },
    {
      id: "ev_2",
      title: "Live WebRTC Lecture: Raft Consensus In-Depth",
      course: "Advanced Distributed Systems",
      dateStr: "2026-10-14",
      time: "10:00 AM - 11:30 AM EST",
      type: "LECTURE",
      instructor: "Prof. David Malan",
      countdown: "2 days left",
    },
    {
      id: "ev_3",
      title: "Lab 3: Zero-Trust Ingress & mTLS Policies Due",
      course: "Enterprise Data Governance",
      dateStr: "2026-10-16",
      time: "11:59 PM EST",
      type: "ASSIGNMENT",
      instructor: "Dr. Elena Rostova",
      countdown: "4 days left",
    },
    {
      id: "ev_4",
      title: "Faculty Office Hours: Distributed Quorums",
      course: "Department of Computer Science",
      dateStr: "2026-10-17",
      time: "4:00 PM - 5:00 PM EST",
      type: "OFFICE_HOURS",
      instructor: "Prof. David Malan",
      countdown: "5 days left",
    },
    {
      id: "ev_5",
      title: "Neural Attention Transformer Quiz",
      course: "Deep Learning Foundations",
      dateStr: "2026-10-18",
      time: "5:00 PM EST",
      type: "EXAM",
      instructor: "Prof. Andrew Ng",
      countdown: "6 days left",
    },
  ];

  const handleExportIcal = () => {
    setCalendarSyncNotification("iCal & Google Calendar Sync generated (lms_schedule_2026.ics)!");
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
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-blue-950 text-blue-400 border border-blue-800">
                  Fall Semester 2026
                </span>
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

        {/* Next Urgent Deadline Spotlight */}
        <div className="bg-gradient-to-r from-rose-950/40 via-slate-950 to-slate-900 border-b border-rose-900/40 px-6 py-3.5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="h-8 w-8 rounded-xl bg-rose-600/30 text-rose-400 border border-rose-500/40 flex items-center justify-center font-bold">
              <Clock className="h-4 w-4 animate-pulse" />
            </div>
            <div>
              <span className="text-[10px] font-bold uppercase tracking-wider text-rose-400 block">
                Next Immediate Academic Deadline
              </span>
              <strong className="text-xs text-white">CS-101 Midterm Proctored Exam</strong>
              <span className="text-xs text-slate-400 ml-2">• Tomorrow at 2:00 PM EST</span>
            </div>
          </div>

          <span className="text-xs font-mono font-bold text-amber-400 bg-amber-950/60 border border-amber-800/80 px-3 py-1 rounded-full">
            Countdown: ~28 hours remaining
          </span>
        </div>

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

                    <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400 mt-1">
                      <span className="font-medium text-slate-300">{ev.course}</span>
                      <span>•</span>
                      <span>{ev.instructor}</span>
                    </div>
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
