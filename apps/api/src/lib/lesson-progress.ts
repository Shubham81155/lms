/** A learner can never reach 100% on their own: course completion is recorded by the instructor. */
export const LEARNER_MAX_PROGRESS = 99;

/** Share of lessons finished, as a whole percent, held below 100 until staff record completion. */
export function progressFromLessons(completed: number, total: number): number {
  if (total <= 0 || completed <= 0) return 0;
  return Math.min(LEARNER_MAX_PROGRESS, Math.round((Math.min(completed, total) / total) * 100));
}
