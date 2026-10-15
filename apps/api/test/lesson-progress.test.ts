import { describe, expect, it } from 'vitest';
import { LEARNER_MAX_PROGRESS, progressFromLessons } from '../src/lib/lesson-progress';

describe('progressFromLessons', () => {
  it('is 0 with no lessons or none finished', () => {
    expect(progressFromLessons(0, 0)).toBe(0);
    expect(progressFromLessons(0, 6)).toBe(0);
    expect(progressFromLessons(3, 0)).toBe(0);
  });

  it('rounds the share of finished lessons', () => {
    expect(progressFromLessons(1, 6)).toBe(17);
    expect(progressFromLessons(3, 6)).toBe(50);
    expect(progressFromLessons(2, 3)).toBe(67);
  });

  it('never reaches 100 on its own', () => {
    expect(progressFromLessons(6, 6)).toBe(LEARNER_MAX_PROGRESS);
    expect(progressFromLessons(9, 6)).toBe(LEARNER_MAX_PROGRESS);
  });
});
