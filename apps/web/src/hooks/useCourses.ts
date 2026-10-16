"use client";

import { api } from '@/lib/api';
import { Course } from '@/lib/types';

/**
 * Creates a course and then its modules and lessons, in order. Throws with a message that says
 * what was and was not saved, so a half-built course is never reported as a success.
 */
export async function createCourseWithCurriculum(draft: import('@/components/CourseBuilder').CourseDraft): Promise<Course> {
  const res = await api.post<any>('/api/v1/courses', {
    title: draft.title,
    code: draft.code,
    ...(draft.description ? { description: draft.description } : {}),
    status: draft.status,
    passingGradePercent: draft.passingGradePercent,
    allowSelfEnroll: draft.allowSelfEnroll,
  });
  const course: Course = res.data ?? res.course ?? res;

  for (const [m, mod] of draft.modules.entries()) {
    try {
      const created = await api.post<any>(`/api/v1/courses/${course.id}/modules`, { title: mod.title.trim(), orderIndex: m });
      const moduleId = (created.data ?? created).id;
      for (const [l, lesson] of mod.lessons.entries()) {
        await api.post(`/api/v1/courses/${course.id}/modules/${moduleId}/lessons`, {
          title: lesson.title.trim(),
          orderIndex: l,
          contentType: lesson.type,
          estimatedMinutes: Math.max(1, lesson.minutes || 15),
          ...(lesson.body.trim() ? { bodyContent: lesson.body.trim() } : {}),
          ...(lesson.url.trim() && lesson.type === 'EXTERNAL_LTI_TOOL' ? { ltiToolLaunchUrl: lesson.url.trim() } : {}),
          ...(lesson.url.trim() && lesson.type !== 'EXTERNAL_LTI_TOOL' ? { mediaUrl: lesson.url.trim() } : {}),
        });
      }
    } catch (e) {
      const reason = e instanceof Error ? e.message : 'unknown error';
      throw new Error(`The course "${draft.code}" was created, but "${mod.title}" could not be saved (${reason}). Add the missing content from the course page.`);
    }
  }
  return course;
}
