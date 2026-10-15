import React from "react";
import Link from "next/link";
import { GraduationCap } from "lucide-react";

// Logo used on the public pages (landing and sign-in flow); links home.
export function BrandLogo() {
  return (
    <Link href="/" className="flex items-center gap-2.5 font-bold text-lg text-ink">
      <div className="h-9 w-9 rounded-xl bg-gradient-to-br from-brand to-brand-hover flex items-center justify-center text-on-brand shadow-lg shadow-brand/30">
        <GraduationCap className="h-5 w-5" />
      </div>
      <div className="flex flex-col">
        <span className="leading-tight">
          Apex<span className="text-brand-fg">LMS</span>
        </span>
        <span className="text-[10px] text-ink-subtle font-normal">Enterprise Education</span>
      </div>
    </Link>
  );
}
