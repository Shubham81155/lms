"use client";

import { useState, useEffect, useCallback } from 'react';
import { api, ApiError } from '@/lib/api';
import { typedGet } from '@/lib/typed-api';
import { Course, PaginatedResponse, PaginationMeta } from '@/lib/types';

export function useCourses(page: number = 1, limit: number = 10) {
  const [courses, setCourses] = useState<Course[]>([]);
  const [pagination, setPagination] = useState<PaginationMeta | null>(null);
  const [data, setData] = useState<PaginatedResponse<Course> | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const fetchCourses = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const response = await typedGet('/api/v1/courses', { page, limit });
      // The API's list item and the web's Course type describe the same record.
      const paginatedData: PaginatedResponse<Course> = { data: response.data as Course[], pagination: response.pagination };
      setData(paginatedData);
      setCourses(paginatedData.data);
      setPagination(paginatedData.pagination);
    } catch (err: any) {
      const message = err instanceof ApiError ? err.message : (err?.message || 'Failed to fetch courses');
      setError(message);
      setCourses([]);
      setData(null);
      setPagination(null);
    } finally {
      setIsLoading(false);
    }
  }, [page, limit]);

  useEffect(() => {
    fetchCourses();
  }, [fetchCourses]);

  return {
    courses,
    pagination,
    data,
    isLoading,
    error,
    refetch: fetchCourses,
  };
}

/**
 * Creates a course and then its modules and lessons, in order. Throws with a message that says
 * what was and was not saved, so a half-built course is never reported as a success.
 */
export async function createCourseWithCurriculum(draft: import('@/components/CourseBuilder').CourseDraft): Promise<Course> {
  const res = await api.post<any>('/api/v1/courses', {
    title: draft.title,
    code: draft.code,
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
