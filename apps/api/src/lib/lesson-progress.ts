/**
 * The most a learner may report by hand (PATCH /enrollments/:id/progress): 100% comes only from finishing
 * every lesson or from staff.
 */
export const LEARNER_MAX_PROGRESS = 99;

/**
 * Share of lessons finished, as a whole percent. 100 only when every lesson is done (rounding never gets
 * there early); whether that completes the course is decided in lib/completion.
 */
export function progressFromLessons(completed: number, total: number): number {
  if (total <= 0 || completed <= 0) return 0;
  if (completed >= total) return 100;
  return Math.min(99, Math.round((completed / total) * 100));
}
