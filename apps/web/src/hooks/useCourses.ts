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

export function useCourse(id: string | null | undefined) {
  const [course, setCourse] = useState<Course | null>(null);
  const [data, setData] = useState<Course | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(!!id);
  const [error, setError] = useState<string | null>(null);

  const fetchCourse = useCallback(async () => {
    if (!id) {
      setCourse(null);
      setData(null);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setError(null);
    try {
      const res = await api.get<any>(`/api/v1/courses/${id}`);
      const courseData: Course = res.course || res.data || res;
      setCourse(courseData);
      setData(courseData);
    } catch (err: any) {
      const message = err instanceof ApiError ? err.message : (err?.message || 'Failed to fetch course');
      setError(message);
      setCourse(null);
      setData(null);
    } finally {
      setIsLoading(false);
    }
  }, [id]);

  useEffect(() => {
    fetchCourse();
  }, [fetchCourse]);

  return {
    course,
    data,
    isLoading,
    error,
    refetch: fetchCourse,
  };
}

export function useCreateCourse() {
  const [isCreating, setIsCreating] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const createCourse = useCallback(async (courseData: Partial<Course>): Promise<Course> => {
    setIsCreating(true);
    setIsLoading(true);
    setError(null);
    try {
      const response = await api.post<any>('/api/v1/courses', courseData);
      const created: Course = response.course || response.data || response;
      return created;
    } catch (err: any) {
      const message = err instanceof ApiError ? err.message : (err?.message || 'Failed to create course');
      setError(message);
      throw err;
    } finally {
      setIsCreating(false);
      setIsLoading(false);
    }
  }, []);

  return {
    createCourse,
    mutate: createCourse,
    isCreating,
    isLoading,
    error,
  };
}

export function useUpdateCourse() {
  const [isUpdating, setIsUpdating] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const updateCourse = useCallback(async (id: string, courseData: Partial<Course>): Promise<Course> => {
    setIsUpdating(true);
    setIsLoading(true);
    setError(null);
    try {
      const response = await api.put<any>(`/api/v1/courses/${id}`, courseData);
      const updated: Course = response.course || response.data || response;
      return updated;
    } catch (err: any) {
      const message = err instanceof ApiError ? err.message : (err?.message || 'Failed to update course');
      setError(message);
      throw err;
    } finally {
      setIsUpdating(false);
      setIsLoading(false);
    }
  }, []);

  return {
    updateCourse,
    mutate: updateCourse,
    isUpdating,
    isLoading,
    error,
  };
}

const LESSON_CONTENT_TYPE: Record<string, string> = {
  VIDEO: 'VIDEO',
  CODE: 'INTERACTIVE_CODE',
  SCORM: 'SCORM_PACKAGE',
  RICHTEXT: 'RICHTEXT',
};

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
    enableProctoring: draft.enableProctoring,
  });
  const course: Course = res.data ?? res.course ?? res;

  for (const [m, mod] of draft.modules.entries()) {
    try {
      const created = await api.post<any>(`/api/v1/courses/${course.id}/modules`, { title: mod.title, orderIndex: m });
      const moduleId = (created.data ?? created).id;
      for (const [l, lesson] of mod.lessons.entries()) {
        await api.post(`/api/v1/courses/${course.id}/modules/${moduleId}/lessons`, {
          title: lesson.title,
          orderIndex: l,
          contentType: LESSON_CONTENT_TYPE[lesson.type] ?? 'RICHTEXT',
          estimatedMinutes: Math.max(1, parseInt(lesson.duration, 10) || 15),
        });
      }
    } catch (e) {
      const reason = e instanceof Error ? e.message : 'unknown error';
      throw new Error(`The course "${draft.code}" was created, but "${mod.title}" could not be saved (${reason}). Add the missing content from the course page.`);
    }
  }
  return course;
}
