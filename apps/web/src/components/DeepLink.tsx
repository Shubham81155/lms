"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { AuthCard } from "@/components/AuthCard";
import { useAuth } from "@/context/AuthContext";
import { resolveDeepLink } from "@/lib/deeplink";

/**
 * Landing page for links in notifications and emails (/courses/…, /quizzes/…, /assignments/…).
 * Signed-out people sign in first and come back; everyone else is sent to their dashboard with the
 * right panel open.
 */
export function DeepLink() {
  const pathname = usePathname();
  const router = useRouter();
  const { user, isLoading } = useAuth();

  useEffect(() => {
    if (isLoading) return;
    if (!user) router.replace(`/login?next=${encodeURIComponent(pathname)}`);
    // Course links mean nothing in the platform console; operators go to its overview.
    else router.replace(user.platformOperator ? "/platform" : resolveDeepLink(pathname, user.role));
  }, [user, isLoading, pathname, router]);

  return (
    <AuthCard title="Taking you there">
      <p role="status" className="text-center text-xs text-ink-muted">
        One moment…
      </p>
    </AuthCard>
  );
}
