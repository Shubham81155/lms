'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useT, type Translator } from '@/lib/i18n';
import { FaceWatch, SoundWatch, rms } from '@/lib/proctor-signals';

// Camera and microphone proctoring in the learner's browser. Faces are found with MediaPipe's face detector
// (served from /proctoring, see scripts/copy-proctoring-assets.mjs) and sound is measured with Web Audio.
// Nothing but the resulting events leaves the browser: no image, video or audio is uploaded or stored.

export type MediaProctorEvent = 'FACE_NOT_DETECTED' | 'MULTIPLE_FACES' | 'AUDIO_SPIKE' | 'CAMERA_STOPPED' | 'MICROPHONE_STOPPED';

export type MediaProctorStatus = 'off' | 'starting' | 'on' | 'error';

const FACE_EVERY_MS = 500;
const SOUND_EVERY_MS = 200;
const ASSETS = '/proctoring';

type Detector = { detectForVideo(video: HTMLVideoElement, timestamp: number): { detections: unknown[] }; close(): void };

async function loadFaceDetector(): Promise<Detector> {
  const { FaceDetector, FilesetResolver } = await import('@mediapipe/tasks-vision');
  const fileset = await FilesetResolver.forVisionTasks(`${ASSETS}/wasm`);
  return FaceDetector.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: `${ASSETS}/blaze_face_short_range.tflite`, delegate: 'CPU' },
    runningMode: 'VIDEO',
    // Chrome's synthetic test camera gives false faces at 0.55-0.74; a real face in view scores higher.
    minDetectionConfidence: 0.8,
  });
}

/** Why the camera or microphone could not be used, in words for the learner. */
function permissionMessage(t: Translator, e: unknown, camera: boolean, microphone: boolean): string {
  const what = t(camera && microphone ? 'mx.media.what.both' : camera ? 'mx.media.what.camera' : 'mx.media.what.microphone');
  const name = (e as { name?: string })?.name;
  if (name === 'NotAllowedError' || name === 'SecurityError') return t('mx.media.denied', { what });
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return t('mx.media.notFound', { what });
  if (name === 'NotReadableError') return t('mx.media.inUse', { what });
  return t('mx.media.failed', { what });
}

/**
 * Watches the camera and/or microphone while `active`. `start()` asks for permission (call it from a click);
 * it throws a message for the learner when access is refused. Events go to `onEvent`.
 */
export function useMediaProctor(opts: { camera: boolean; microphone: boolean; active: boolean; onEvent: (e: MediaProctorEvent) => void }) {
  const { camera, microphone, active } = opts;
  const t = useT();
  const tRef = useRef(t);
  tRef.current = t;
  const onEvent = useRef(opts.onEvent);
  onEvent.current = opts.onEvent;
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [status, setStatus] = useState<MediaProctorStatus>('off');
  /** The camera works but faces cannot be detected here (the detector failed to load). */
  const [detectorFailed, setDetectorFailed] = useState(false);
  const videoEl = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const needed = camera || microphone;

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setStream(null);
    setStatus('off');
  }, []);

  const start = useCallback(async () => {
    if (!needed) return;
    if (streamRef.current) return;
    setStatus('starting');
    try {
      const s = await navigator.mediaDevices.getUserMedia({
        video: camera ? { width: { ideal: 320 }, height: { ideal: 240 }, facingMode: 'user' } : false,
        audio: microphone ? { echoCancellation: false, noiseSuppression: false, autoGainControl: false } : false,
      });
      streamRef.current = s;
      setStream(s);
      setStatus('on');
    } catch (e) {
      setStatus('error');
      throw new Error(permissionMessage(tRef.current, e, camera, microphone));
    }
  }, [needed, camera, microphone]);

  // The preview element shows the camera to the learner (and gives the detector its frames). The stream is
  // usually ready before the element exists (it is asked for when Start is pressed), so it is attached both
  // when the element mounts (this callback ref) and when the stream changes.
  const show = (v: HTMLVideoElement | null, s: MediaStream | null) => {
    if (v && s && v.srcObject !== s) {
      v.srcObject = s;
      v.play().catch(() => undefined);
    }
  };
  const videoRef = useCallback((v: HTMLVideoElement | null) => {
    videoEl.current = v;
    show(v, streamRef.current);
  }, []);
  useEffect(() => show(videoEl.current, stream), [stream]);

  // A device turned off or unplugged during the exam.
  useEffect(() => {
    if (!stream || !active) return;
    const tracks = stream.getTracks();
    const ended = (t: MediaStreamTrack) => () => onEvent.current(t.kind === 'video' ? 'CAMERA_STOPPED' : 'MICROPHONE_STOPPED');
    const handlers = tracks.map((t) => [t, ended(t)] as const);
    handlers.forEach(([t, h]) => t.addEventListener('ended', h));
    return () => handlers.forEach(([t, h]) => t.removeEventListener('ended', h));
  }, [stream, active]);

  // Faces.
  useEffect(() => {
    if (!stream || !active || !camera) return;
    let detector: Detector | null = null;
    let timer: ReturnType<typeof setInterval> | null = null;
    let cancelled = false;
    const watch = new FaceWatch();
    loadFaceDetector()
      .then((d) => {
        if (cancelled) return d.close();
        detector = d;
        timer = setInterval(() => {
          const v = videoEl.current;
          if (!v || v.readyState < 2 || document.hidden) return;
          const t = performance.now();
          const faces = d.detectForVideo(v, t).detections.length;
          for (const e of watch.update(t, faces)) onEvent.current(e);
        }, FACE_EVERY_MS);
      })
      .catch(() => !cancelled && setDetectorFailed(true));
    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
      detector?.close();
    };
  }, [stream, active, camera]);

  // Sound.
  useEffect(() => {
    if (!stream || !active || !microphone || stream.getAudioTracks().length === 0) return;
    const ctx = new AudioContext();
    const source = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 2048;
    source.connect(analyser);
    const samples = new Float32Array(analyser.fftSize);
    const watch = new SoundWatch();
    const timer = setInterval(() => {
      if (ctx.state === 'suspended') ctx.resume().catch(() => undefined);
      analyser.getFloatTimeDomainData(samples);
      for (const e of watch.update(performance.now(), rms(samples))) onEvent.current(e);
    }, SOUND_EVERY_MS);
    return () => {
      clearInterval(timer);
      source.disconnect();
      ctx.close().catch(() => undefined);
    };
  }, [stream, active, microphone]);

  // Never leave the camera or microphone on after the exam screen goes away.
  useEffect(() => stop, [stop]);

  const detectorProblem = detectorFailed ? t('mx.media.detectorFailed') : null;
  return { start, stop, status, stream, videoRef, detectorProblem, needed };
}
