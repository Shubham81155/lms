"use client";

import { useState, useEffect, useCallback } from 'react';
import { api, ApiError } from '@/lib/api';
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
      // Backend may return PaginatedResponse<Course> or { courses: Course[], pagination?: ... }
      const response = await api.get<any>('/api/v1/courses', {
        params: { page, limit },
      });

      if (response && Array.isArray(response.data)) {
        const paginatedData = response as PaginatedResponse<Course>;
        setData(paginatedData);
        setCourses(paginatedData.data);
        setPagination(paginatedData.pagination);
      } else if (response && Array.isArray(response.courses)) {
        const courseList = response.courses as Course[];
        const meta: PaginationMeta = response.pagination || {
          page,
          limit,
          total: courseList.length,
          totalPages: Math.ceil(courseList.length / limit) || 1,
        };
        const structured: PaginatedResponse<Course> = {
          data: courseList,
          pagination: meta,
        };
        setData(structured);
        setCourses(courseList);
        setPagination(meta);
      } else if (Array.isArray(response)) {
        const meta: PaginationMeta = {
          page,
          limit,
          total: response.length,
          totalPages: Math.ceil(response.length / limit) || 1,
        };
        const structured: PaginatedResponse<Course> = {
          data: response,
          pagination: meta,
        };
        setData(structured);
        setCourses(response);
        setPagination(meta);
      } else {
        setCourses([]);
        setData(null);
        setPagination(null);
      }
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
