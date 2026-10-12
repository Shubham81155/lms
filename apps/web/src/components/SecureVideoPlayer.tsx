"use client";

import React, { useState, useEffect } from "react";
import {
  X,
  Play,
  Pause,
  Volume2,
  VolumeX,
  Maximize,
  Shield,
  Clock,
  Sparkles,
  Layers,
} from "lucide-react";

interface SecureVideoPlayerProps {
  lessonTitle: string;
  studentEmail?: string;
  onClose: () => void;
  onProgress?: (percent: number) => void;
}

export const SecureVideoPlayer: React.FC<SecureVideoPlayerProps> = ({
  lessonTitle,
  studentEmail = "alex.chen@harvard.edu",
  onClose,
  onProgress,
}) => {
  const [isPlaying, setIsPlaying] = useState(true);
  const [isMuted, setIsMuted] = useState(false);
  const [progress, setProgress] = useState(35);
  const [quality, setQuality] = useState("1080p 60fps (HLS Adaptive)");
  const [watermarkPos, setWatermarkPos] = useState({ top: "25%", left: "40%" });

  // Anti-Piracy: Periodically move floating watermark across the video to prevent cropping
  useEffect(() => {
    const interval = setInterval(() => {
      const top = Math.floor(Math.random() * 70 + 10) + "%";
      const left = Math.floor(Math.random() * 60 + 10) + "%";
      setWatermarkPos({ top, left });
    }, 4000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/85 backdrop-blur-md flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-slate-800 rounded-3xl w-full max-w-4xl overflow-hidden shadow-2xl flex flex-col">
        {/* Header */}
        <div className="bg-slate-950 border-b border-slate-800 px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="h-8 w-8 rounded-xl bg-rose-500/20 border border-rose-500/40 text-rose-400 flex items-center justify-center">
              <Shield className="h-4 w-4" />
            </div>
            <div>
              <h3 className="font-bold text-sm text-white">{lessonTitle}</h3>
              <p className="text-[11px] text-slate-400">Encrypted HLS Stream • Dynamic Forensic Watermarking</p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <span className="text-[10px] font-mono px-2.5 py-1 rounded-full bg-slate-900 text-blue-400 border border-slate-800">
              DRM: Widevine L1 / FairPlay
            </span>
            <button
              onClick={onClose}
              className="p-1 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white transition-colors"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Video Screen Area */}
        <div className="relative aspect-video bg-black flex items-center justify-center overflow-hidden group select-none">
          {/* Simulated Video Canvas */}
          <div className="absolute inset-0 bg-gradient-to-tr from-slate-950 via-slate-900 to-indigo-950/40 flex flex-col items-center justify-center text-center p-6 space-y-3">
            <div className="h-16 w-16 rounded-2xl bg-blue-600/30 border border-blue-500/40 text-blue-400 flex items-center justify-center shadow-2xl">
              {isPlaying ? <Play className="h-8 w-8 animate-pulse" /> : <Pause className="h-8 w-8" />}
            </div>
            <div className="space-y-1">
              <h4 className="text-base font-bold text-white tracking-tight">{lessonTitle}</h4>
              <p className="text-xs text-slate-400">Lecture Segment: Leader Election, Split-Brain Quorum & State Machine Replication</p>
            </div>
          </div>

          {/* Dynamic Anti-Piracy Watermark Overlay */}
          <div
            className="absolute pointer-events-none transition-all duration-1000 ease-in-out font-mono text-[10px] text-white/20 font-bold bg-black/25 px-2.5 py-1 rounded border border-white/5 backdrop-blur-[1px]"
            style={{ top: watermarkPos.top, left: watermarkPos.left }}
          >
            <span>{studentEmail} • {new Date().toLocaleTimeString()} • SESSION_HASH_0x89A</span>
          </div>

          {/* Bottom Video Controls Overlay */}
          <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/90 via-black/50 to-transparent p-4 space-y-2">
            {/* Scrubber Bar */}
            <div className="w-full bg-slate-800/80 h-1.5 rounded-full overflow-hidden cursor-pointer">
              <div className="bg-rose-500 h-1.5 rounded-full transition-all" style={{ width: `${progress}%` }} />
            </div>

            <div className="flex items-center justify-between text-xs text-slate-300">
              <div className="flex items-center gap-3">
                <button
                  onClick={() => setIsPlaying(!isPlaying)}
                  className="hover:text-white transition-colors"
                >
                  {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                </button>

                <button
                  onClick={() => setIsMuted(!isMuted)}
                  className="hover:text-white transition-colors"
                >
                  {isMuted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
                </button>

                <span className="font-mono text-[11px] text-slate-400">14:22 / 42:00</span>
              </div>

              <div className="flex items-center gap-3">
                <select
                  value={quality}
                  onChange={(e) => setQuality(e.target.value)}
                  className="bg-slate-900 border border-slate-700 rounded-lg px-2 py-0.5 text-[10px] text-slate-300 focus:outline-none"
                >
                  <option value="1080p 60fps (HLS Adaptive)">1080p 60fps (HLS Adaptive)</option>
                  <option value="720p (HLS)">720p (HLS)</option>
                  <option value="480p (HLS)">480p (Data Saver)</option>
                </select>

                <button className="hover:text-white transition-colors">
                  <Maximize className="h-4 w-4" />
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
