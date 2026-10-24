'use client';

import React from 'react';
import { ExternalLink } from 'lucide-react';
import { videoSource } from '@/lib/video';

interface VideoPlayerProps {
  url: string;
  title: string;
  /** Shown faintly over the video as a deterrent to screen recording; never sent anywhere. */
  watermark?: string;
}

/** Plays a lesson video: YouTube / Vimeo through their players, media files natively, other pages as a link. */
export const VideoPlayer: React.FC<VideoPlayerProps> = ({ url, title, watermark }) => {
  const source = videoSource(url);

  if (!source || source.kind === 'link') {
    return (
      <div className="flex aspect-video flex-col items-center justify-center gap-3 rounded-2xl border border-line bg-canvas p-6 text-center">
        <p className="text-xs text-ink-muted">This video is hosted on a site that cannot be shown here.</p>
        {source && (
          <a
            href={source.src}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 rounded-xl bg-brand px-4 py-2 text-xs font-bold text-on-brand hover:bg-brand-hover"
          >
            <ExternalLink className="h-4 w-4" />
            <span>Watch in a new tab</span>
          </a>
        )}
      </div>
    );
  }

  return (
    <div className="relative aspect-video overflow-hidden rounded-2xl border border-line bg-black">
      {source.kind === 'file' ? (
        <video
          src={source.src}
          controls
          preload="metadata"
          playsInline
          controlsList="nodownload"
          className="h-full w-full"
          aria-label={title}
        >
          <a href={source.src}>Download the video</a>
        </video>
      ) : (
        <iframe
          src={source.src}
          title={title}
          className="h-full w-full"
          allow="autoplay; encrypted-media; fullscreen; picture-in-picture"
          allowFullScreen
          referrerPolicy="strict-origin-when-cross-origin"
          sandbox="allow-scripts allow-same-origin allow-presentation allow-popups"
        />
      )}
      {watermark && (
        <span aria-hidden className="pointer-events-none absolute right-3 top-3 select-none text-[10px] font-medium text-white/30">
          {watermark}
        </span>
      )}
    </div>
  );
};
