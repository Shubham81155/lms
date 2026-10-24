// Turning camera and microphone readings into proctoring events. Pure, so the rules can be tested without a
// device: the hook in hooks/useMediaProctor.ts feeds readings in and reports what comes out. Events are
// signals for a human reviewer; one episode (a face gone for a while, a stretch of talking) is one event.

/**
 * Fires once when a condition has held for `minMs`. Gaps up to `gapMs` between active readings (a detector
 * missing a frame, a pause between words) do not break it; a longer gap ends the episode. `gapMs` must
 * exceed twice the reading interval, or a single missed reading ends the episode. After firing, the next
 * episode may fire only `cooldownMs` later.
 */
export class Sustained {
  private startedAt: number | null = null;
  private lastActive: number | null = null;
  private fired = false;
  private lastFire = -Infinity;

  constructor(
    private readonly minMs: number,
    private readonly gapMs: number,
    private readonly cooldownMs = 0
  ) {}

  /** Feed one reading taken at `t` (ms); true when this reading completes an episode worth reporting. */
  update(t: number, active: boolean): boolean {
    if (!active) {
      if (this.lastActive !== null && t - this.lastActive > this.gapMs) this.reset();
      return false;
    }
    if (this.startedAt === null || this.lastActive === null || t - this.lastActive > this.gapMs) {
      this.startedAt = t;
      this.fired = false;
    }
    this.lastActive = t;
    if (!this.fired && t - this.startedAt >= this.minMs && t - this.lastFire >= this.cooldownMs) {
      this.fired = true;
      this.lastFire = t;
      return true;
    }
    return false;
  }

  private reset() {
    this.startedAt = null;
    this.lastActive = null;
    this.fired = false;
  }
}

export type MediaEvent = 'FACE_NOT_DETECTED' | 'MULTIPLE_FACES' | 'AUDIO_SPIKE';

/** Face-count readings (about every 500 ms) → events: no face for 5 s, or more than one face for 3 s. */
export class FaceWatch {
  private readonly missing = new Sustained(5000, 1200);
  private readonly crowd = new Sustained(3000, 1200);

  update(t: number, faces: number): MediaEvent[] {
    const out: MediaEvent[] = [];
    if (this.missing.update(t, faces === 0)) out.push('FACE_NOT_DETECTED');
    if (this.crowd.update(t, faces > 1)) out.push('MULTIPLE_FACES');
    return out;
  }
}

/** Root-mean-square level of one block of samples (-1..1). */
export function rms(samples: ArrayLike<number>): number {
  if (samples.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
  return Math.sqrt(sum / samples.length);
}

/**
 * Level readings (about every 200 ms) → AUDIO_SPIKE when sound stays well above the room's own background
 * for about 2.5 s (talking, someone reading questions aloud), at most once every 30 s. The background is
 * learnt from the first two seconds and then follows quiet readings slowly, so a noisy room does not fire
 * all the time.
 */
export class SoundWatch {
  private readonly loud = new Sustained(2500, 600, 30_000);
  private background: number | null = null;
  private readonly calibration: number[] = [];
  private startedAt: number | null = null;

  /** The level a reading must exceed to count as sound. */
  threshold(): number {
    return Math.max(0.04, (this.background ?? 0.01) * 4);
  }

  update(t: number, level: number): MediaEvent[] {
    if (this.startedAt === null) this.startedAt = t;
    if (t - this.startedAt < 2000) {
      this.calibration.push(level);
      return [];
    }
    if (this.background === null) {
      const sorted = [...this.calibration].sort((a, b) => a - b);
      this.background = sorted.length ? sorted[Math.floor(sorted.length / 2)] : level;
    }
    const isLoud = level > this.threshold();
    if (!isLoud) this.background = this.background * 0.98 + level * 0.02;
    return this.loud.update(t, isLoud) ? ['AUDIO_SPIKE'] : [];
  }
}
