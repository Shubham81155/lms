"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { Mic, MicOff, MonitorUp, PhoneOff, Send, Video, VideoOff } from "lucide-react";
import { ConnectionState, Participant, RemoteTrack, Room, RoomEvent, Track } from "livekit-client";
import { ChatMessage, decodeChat, encodeChat, MAX_CHAT_LENGTH } from "@/lib/live";

export interface JoinInfo {
  url: string;
  token: string;
  role: "HOST" | "ASSISTANT" | "LEARNER";
  canPublish: boolean;
}

interface Tile {
  id: string;
  name: string;
  video: Track | null;
  isLocal: boolean;
}

const btn = "p-2.5 rounded-xl border text-xs font-bold flex items-center gap-1.5 transition-colors disabled:opacity-50";

/** Plays one participant's video. The track is attached to and detached from the element. */
const VideoTile: React.FC<{ tile: Tile }> = ({ tile }) => {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const el = ref.current;
    const track = tile.video;
    if (!el || !track) return;
    track.attach(el);
    return () => {
      track.detach(el);
    };
  }, [tile.video]);
  return (
    <div className="relative bg-slate-950 border border-slate-800 rounded-2xl overflow-hidden aspect-video">
      {tile.video ? (
        <video ref={ref} autoPlay playsInline muted={tile.isLocal} className="h-full w-full object-cover" />
      ) : (
        <div className="h-full w-full flex items-center justify-center text-2xl font-bold text-slate-600">{tile.name.charAt(0).toUpperCase()}</div>
      )}
      <span className="absolute bottom-2 left-2 text-[11px] font-semibold bg-slate-950/80 text-white px-2 py-0.5 rounded-md">{tile.name}{tile.isLocal ? " (you)" : ""}</span>
    </div>
  );
};

/**
 * A live class room on a LiveKit server. Course staff can share camera, microphone and screen;
 * learners watch, listen and chat unless the instructor allowed them to publish (the server's
 * token decides, so hiding a button here is a convenience, not the control).
 */
export const LiveRoom: React.FC<{ title: string; join: JoinInfo; onLeave: () => void }> = ({ title, join, onLeave }) => {
  const roomRef = useRef<Room | null>(null);
  const audioHost = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<"connecting" | "connected" | "failed">("connecting");
  const [error, setError] = useState<string | null>(null);
  const [tiles, setTiles] = useState<Tile[]>([]);
  const [chat, setChat] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [mic, setMic] = useState(false);
  const [cam, setCam] = useState(false);
  const [screen, setScreen] = useState(false);

  const refresh = useCallback(() => {
    const room = roomRef.current;
    if (!room) return;
    const all: Participant[] = [room.localParticipant, ...Array.from(room.remoteParticipants.values())];
    setTiles(
      all.map((p) => {
        const screenPub = p.getTrackPublication(Track.Source.ScreenShare);
        const camPub = p.getTrackPublication(Track.Source.Camera);
        return {
          id: p.identity,
          name: p.name || p.identity,
          video: (screenPub?.track as Track | undefined) ?? (camPub?.track as Track | undefined) ?? null,
          isLocal: p === room.localParticipant,
        };
      })
    );
  }, []);

  useEffect(() => {
    const room = new Room({ adaptiveStream: true, dynacast: true });
    roomRef.current = room;
    let cancelled = false;

    const attachAudio = (t: RemoteTrack) => {
      if (t.kind !== Track.Kind.Audio || !audioHost.current) return;
      audioHost.current.appendChild(t.attach());
    };
    room
      .on(RoomEvent.TrackSubscribed, (t) => { attachAudio(t); refresh(); })
      .on(RoomEvent.TrackUnsubscribed, (t) => { t.detach().forEach((el) => el.remove()); refresh(); })
      .on(RoomEvent.ParticipantConnected, refresh)
      .on(RoomEvent.ParticipantDisconnected, refresh)
      .on(RoomEvent.LocalTrackPublished, refresh)
      .on(RoomEvent.LocalTrackUnpublished, refresh)
      .on(RoomEvent.TrackMuted, refresh)
      .on(RoomEvent.TrackUnmuted, refresh)
      .on(RoomEvent.DataReceived, (payload, participant) => {
        // Only accept chat from someone actually in the room (the server attributes the sender).
        const m = participant ? decodeChat(payload, participant.name || participant.identity) : null;
        if (m) setChat((c) => [...c.slice(-199), m]);
      })
      .on(RoomEvent.Disconnected, () => {
        if (!cancelled) onLeave();
      });

    room
      .connect(join.url, join.token)
      .then(() => {
        if (cancelled) return;
        setState("connected");
        refresh();
      })
      .catch(() => {
        if (cancelled) return;
        setState("failed");
        setError("Could not connect to the live class server. Check your connection and try again.");
      });

    return () => {
      cancelled = true;
      room.removeAllListeners();
      void room.disconnect();
      roomRef.current = null;
    };
    // The connection is made once per join token.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [join.token, join.url]);

  const toggle = async (kind: "mic" | "cam" | "screen") => {
    const room = roomRef.current;
    if (!room || !join.canPublish || room.state !== ConnectionState.Connected) return;
    setError(null);
    try {
      if (kind === "mic") { await room.localParticipant.setMicrophoneEnabled(!mic); setMic(!mic); }
      if (kind === "cam") { await room.localParticipant.setCameraEnabled(!cam); setCam(!cam); }
      if (kind === "screen") { await room.localParticipant.setScreenShareEnabled(!screen); setScreen(!screen); }
      refresh();
    } catch {
      setError("Could not start that. Check that your browser has permission to use the device.");
    }
  };

  const send = async () => {
    const data = encodeChat(draft);
    const room = roomRef.current;
    if (!data || !room) return;
    try {
      await room.localParticipant.publishData(data, { reliable: true });
      setChat((c) => [...c.slice(-199), { from: "You", text: draft.trim().slice(0, MAX_CHAT_LENGTH), at: Date.now() }]);
      setDraft("");
    } catch {
      setError("Your message could not be sent.");
    }
  };

  const active = tiles.filter((t) => t.video);
  const shown = active.length > 0 ? active : tiles.slice(0, 1);

  return (
    <div className="fixed inset-0 z-[60] bg-slate-950 flex flex-col" role="dialog" aria-modal="true" aria-label={`Live class: ${title}`}>
      <div className="border-b border-slate-800 px-5 py-3 flex items-center justify-between gap-4">
        <div>
          <h3 className="text-sm font-bold text-white">{title}</h3>
          <p className="text-[11px] text-slate-500">
            {state === "connecting" ? "Connecting…" : state === "failed" ? "Not connected" : `${tiles.length} in the room`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {join.canPublish && (
            <>
              <button className={`${btn} ${mic ? "bg-blue-600 border-blue-500 text-white" : "bg-slate-900 border-slate-800 text-slate-300"}`} onClick={() => toggle("mic")} disabled={state !== "connected"} aria-pressed={mic} aria-label={mic ? "Mute microphone" : "Unmute microphone"}>
                {mic ? <Mic className="h-4 w-4" /> : <MicOff className="h-4 w-4" />}
              </button>
              <button className={`${btn} ${cam ? "bg-blue-600 border-blue-500 text-white" : "bg-slate-900 border-slate-800 text-slate-300"}`} onClick={() => toggle("cam")} disabled={state !== "connected"} aria-pressed={cam} aria-label={cam ? "Turn camera off" : "Turn camera on"}>
                {cam ? <Video className="h-4 w-4" /> : <VideoOff className="h-4 w-4" />}
              </button>
              {join.role !== "LEARNER" && (
                <button className={`${btn} ${screen ? "bg-blue-600 border-blue-500 text-white" : "bg-slate-900 border-slate-800 text-slate-300"}`} onClick={() => toggle("screen")} disabled={state !== "connected"} aria-pressed={screen} aria-label={screen ? "Stop sharing screen" : "Share screen"}>
                  <MonitorUp className="h-4 w-4" />
                </button>
              )}
            </>
          )}
          <button className={`${btn} bg-rose-600 hover:bg-rose-500 border-rose-500 text-white`} onClick={onLeave}>
            <PhoneOff className="h-4 w-4" />
            <span>Leave</span>
          </button>
        </div>
      </div>

      {error && <div role="alert" className="bg-rose-950/60 border-b border-rose-900 px-5 py-2 text-xs text-rose-300">{error}</div>}

      <div className="flex-1 flex min-h-0">
        <div className="flex-1 p-4 overflow-y-auto">
          {state === "failed" ? (
            <div className="h-full flex items-center justify-center text-sm text-slate-400">The room could not be opened.</div>
          ) : (
            <div className={`grid gap-3 ${shown.length > 1 ? "grid-cols-1 md:grid-cols-2" : "grid-cols-1 max-w-4xl mx-auto"}`}>
              {shown.map((t) => <VideoTile key={t.id} tile={t} />)}
              {state === "connected" && active.length === 0 && (
                <p className="text-center text-xs text-slate-500 md:col-span-2">Waiting for the instructor to share video.</p>
              )}
            </div>
          )}
          <div ref={audioHost} className="hidden" aria-hidden />
        </div>

        <aside className="w-72 border-l border-slate-800 flex flex-col" aria-label="Chat and participants">
          <div className="p-3 border-b border-slate-800 text-[11px] text-slate-400 space-y-1 max-h-40 overflow-y-auto">
            <div className="font-bold uppercase tracking-wider text-slate-500">In the room</div>
            {tiles.map((t) => <div key={t.id} className="text-slate-300">{t.name}{t.isLocal ? " (you)" : ""}</div>)}
          </div>
          <div className="flex-1 overflow-y-auto p-3 space-y-2" aria-live="polite">
            {chat.length === 0 && <p className="text-[11px] text-slate-500">No messages yet.</p>}
            {chat.map((m, i) => (
              <div key={i} className="text-xs">
                <span className="font-bold text-slate-200">{m.from}</span> <span className="text-slate-300 break-words">{m.text}</span>
              </div>
            ))}
          </div>
          <form className="p-3 border-t border-slate-800 flex gap-2" onSubmit={(e) => { e.preventDefault(); void send(); }}>
            <input
              className="flex-1 bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-blue-500"
              aria-label="Chat message"
              placeholder="Message everyone"
              maxLength={MAX_CHAT_LENGTH}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              disabled={state !== "connected"}
            />
            <button className="px-3 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded-xl" disabled={state !== "connected" || !draft.trim()} aria-label="Send message">
              <Send className="h-4 w-4" />
            </button>
          </form>
        </aside>
      </div>
    </div>
  );
};
