"use client";

import React, { useEffect, useRef } from "react";
import { useApiData } from "@/hooks/useApiData";

interface Launch {
  url: string;
  origin: string;
  version: "1.2" | "2004";
}

/**
 * Plays a SCORM package. The package runs on its own content origin (never this one), framed here; the
 * player page there tells us, by postMessage, when the package reports progress.
 */
export const ScormFrame: React.FC<{ packageId: string; title: string; onCompleted?: () => void }> = ({ packageId, title, onCompleted }) => {
  const launch = useApiData<{ data: Launch }>(`/api/v1/scorm-packages/${packageId}/launch`);
  const data = launch.data?.data;
  const done = useRef(onCompleted);
  done.current = onCompleted;

  useEffect(() => {
    if (!data) return;
    const onMessage = (e: MessageEvent) => {
      // Only the content origin's player page may report progress.
      if (e.origin !== data.origin || e.data?.type !== "lms-scorm") return;
      if (e.data.completed) done.current?.();
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [data]);

  if (launch.isLoading) return <p className="py-10 text-center text-xs text-ink-muted">Loading the activity…</p>;
  if (launch.error || !data) {
    return (
      <div role="alert" className="rounded-2xl border border-danger/30 bg-danger/10 p-6 text-center">
        <p className="text-sm font-bold text-danger">This activity cannot be opened</p>
        <p className="mt-1.5 text-xs text-ink-muted">{launch.error ?? "Try again later."}</p>
      </div>
    );
  }
  return (
    <iframe
      src={data.url}
      title={title}
      sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-downloads"
      allow="fullscreen; autoplay"
      className="h-[70vh] w-full rounded-2xl border border-line bg-white"
    />
  );
};
