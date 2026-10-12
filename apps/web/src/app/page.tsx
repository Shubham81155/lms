"use client";

import React, { useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  GraduationCap,
  ShieldCheck,
  ArrowRight,
  BookOpen,
  Award,
} from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { ThemeToggle } from "@/components/ThemeToggle";

export default function Home() {
  const router = useRouter();
  const { user, isLoading } = useAuth();

  // If user already has an active session, forward them directly to their authorized portal
  useEffect(() => {
    if (!isLoading && user && user.targetRoute) {
      router.replace(user.targetRoute);
    }
  }, [user, isLoading, router]);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col justify-between">
      {/* Top Header */}
      <header className="border-b border-slate-800 bg-slate-950/80 backdrop-blur-md px-6 py-4 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-2.5 font-bold text-lg text-white">
            <div className="h-9 w-9 rounded-xl bg-blue-600 flex items-center justify-center text-white shadow-lg shadow-blue-500/30">
              <GraduationCap className="h-5 w-5" />
            </div>
            <div className="flex flex-col">
              <span className="leading-tight">
                Apex<span className="text-blue-500">LMS</span>
              </span>
              <span className="text-[10px] text-slate-400 font-normal">Enterprise Education</span>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <ThemeToggle />
            <Link
              href="/login"
              className="px-5 py-2.5 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-bold shadow-md shadow-blue-500/20 transition-all flex items-center gap-1.5"
            >
              <span>Sign In</span>
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <main className="max-w-5xl w-full mx-auto px-6 py-16 md:py-24 text-center space-y-8">
        <div className="space-y-4 max-w-3xl mx-auto">
          <h1 className="text-4xl md:text-6xl font-extrabold tracking-tight text-white leading-tight">
            Academic Excellence Powered by <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-400 via-indigo-300 to-purple-400">Zero-Trust Learning</span>
          </h1>
          <p className="text-base text-slate-400 leading-relaxed max-w-2xl mx-auto">
            Secure, scalable, and verifiable digital education for students, faculty, and administrative staff.
          </p>
        </div>

        <div className="pt-4 flex flex-col sm:flex-row items-center justify-center gap-4">
          <Link
            href="/login"
            className="w-full sm:w-auto px-8 py-3.5 bg-blue-600 hover:bg-blue-500 text-white rounded-2xl text-sm font-bold flex items-center justify-center gap-2 shadow-xl shadow-blue-500/25 transition-all"
          >
            <span>Sign In to Your Account</span>
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>

        {/* System Pillars */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 pt-12 text-left">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 space-y-3">
            <div className="h-10 w-10 rounded-xl bg-blue-600/20 text-blue-400 flex items-center justify-center border border-blue-500/30">
              <BookOpen className="h-5 w-5" />
            </div>
            <h3 className="font-bold text-white text-base">Standardized Delivery</h3>
            <p className="text-xs text-slate-400 leading-relaxed">
              Native SCORM 1.2/2004 runtime player, xAPI Learning Record Store, and 1EdTech LTI 1.3 Advantage interoperability.
            </p>
          </div>

          <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 space-y-3">
            <div className="h-10 w-10 rounded-xl bg-emerald-600/20 text-emerald-400 flex items-center justify-center border border-emerald-500/30">
              <ShieldCheck className="h-5 w-5" />
            </div>
            <h3 className="font-bold text-white text-base">Zero-Trust Security</h3>
            <p className="text-xs text-slate-400 leading-relaxed">
              PostgreSQL Row-Level Security, AES-256-GCM Field-Level Encryption, and immutable write-once audit logging.
            </p>
          </div>

          <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 space-y-3">
            <div className="h-10 w-10 rounded-xl bg-purple-600/20 text-purple-400 flex items-center justify-center border border-purple-500/30">
              <Award className="h-5 w-5" />
            </div>
            <h3 className="font-bold text-white text-base">Verifiable Credentials</h3>
            <p className="text-xs text-slate-400 leading-relaxed">
              Cryptographically signed W3C Open Badges 3.0 verifiable achievements with instant public verification.
            </p>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-slate-900 bg-slate-950 py-6 text-center text-xs text-slate-500">
        <p>© ApexLMS Enterprise Platform. All rights reserved.</p>
      </footer>
    </div>
  );
}
