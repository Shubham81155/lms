import { describe, expect, it } from 'vitest';
import { FaceWatch, SoundWatch, Sustained, rms } from '@/lib/proctor-signals';

/** Feeds readings every `step` ms from `from` to `to`; returns the times at which events fired. */
function run<T>(watch: { update(t: number, v: T): string[] }, from: number, to: number, value: (t: number) => T, step = 500) {
  const fired: [number, string][] = [];
  for (let t = from; t <= to; t += step) for (const e of watch.update(t, value(t))) fired.push([t, e]);
  return fired;
}

describe('Sustained', () => {
  it('fires once per episode after the minimum time, tolerating short gaps', () => {
    const s = new Sustained(2000, 1100);
    const fires = [0, 500, 1000, 1500, 2000, 2500].map((t) => s.update(t, t !== 1000)); // 1000 is a dropped frame
    expect(fires).toEqual([false, false, false, false, true, false]);
  });

  it('starts a new episode after a longer gap', () => {
    const s = new Sustained(1000, 600);
    expect([0, 500, 1000].map((t) => s.update(t, true))).toEqual([false, false, true]);
    expect(s.update(1500, false) || s.update(2000, false)).toBe(false);
    expect([2500, 3000, 3500].map((t) => s.update(t, true))).toEqual([false, false, true]);
  });

  it('waits out the cooldown before firing again', () => {
    const s = new Sustained(1000, 600, 10_000);
    const episode = (from: number) => [0, 500, 1000].some((d) => s.update(from + d, true));
    expect(episode(0)).toBe(true);
    s.update(2000, false);
    expect(episode(3000)).toBe(false); // within 10 s of the first
    s.update(5000, false);
    expect(episode(12_000)).toBe(true);
  });
});

describe('FaceWatch', () => {
  it('reports a missing face after 5 seconds, once', () => {
    const fired = run(new FaceWatch(), 0, 20_000, (t) => (t < 3000 ? 1 : 0));
    expect(fired).toEqual([[8000, 'FACE_NOT_DETECTED']]);
  });

  it('ignores the detector losing the face for a moment', () => {
    expect(run(new FaceWatch(), 0, 30_000, (t) => (t % 4000 === 0 ? 0 : 1))).toEqual([]);
  });

  it('reports a second face after 3 seconds, and again for a new episode', () => {
    const fired = run(new FaceWatch(), 0, 20_000, (t) => ((t >= 2000 && t < 7000) || t >= 12_000 ? 2 : 1));
    expect(fired).toEqual([
      [5000, 'MULTIPLE_FACES'],
      [15_000, 'MULTIPLE_FACES'],
    ]);
  });
});

describe('SoundWatch', () => {
  const quiet = 0.01;
  const talking = 0.15;

  it('reports a stretch of talking once', () => {
    const fired = run(new SoundWatch(), 0, 60_000, (t) => (t >= 5000 ? talking : quiet), 200);
    expect(fired).toEqual([[7600, 'AUDIO_SPIKE']]);
  });

  it('reports a later stretch only after 30 seconds', () => {
    const talk = (t: number) => (t >= 5000 && t < 10_000) || (t >= 15_000 && t < 20_000) || t >= 45_000;
    const fired = run(new SoundWatch(), 0, 60_000, (t) => (talk(t) ? talking : quiet), 200);
    expect(fired.map(([t]) => t)).toEqual([7600, 47_600]);
  });

  it('ignores short sounds (a cough, a door)', () => {
    expect(run(new SoundWatch(), 0, 30_000, (t) => (t % 10_000 < 800 && t > 3000 ? talking : quiet), 200)).toEqual([]);
  });

  it("learns a noisy room's background instead of firing all the time", () => {
    const fan = 0.06;
    const w = new SoundWatch();
    expect(run(w, 0, 20_000, () => fan, 200)).toEqual([]);
    expect(w.threshold()).toBeGreaterThan(fan);
  });

  it('measures RMS', () => {
    expect(rms([0.5, -0.5, 0.5, -0.5])).toBeCloseTo(0.5);
    expect(rms([])).toBe(0);
  });
});
