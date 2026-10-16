"use client";

import { useState, useEffect, useCallback } from 'react';
import { api, ApiError } from '@/lib/api';
import { Enrollment, EnrollmentStats } from '@/lib/types';

export function useMyEnrollments() {
  const [enrollments, setEnrollments] = useState<Enrollment[]>([]);
  const [data, setData] = useState<Enrollment[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const fetchEnrollments = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const response = await api.get<any>('/api/v1/enrollments/my');
      const list: Enrollment[] = Array.isArray(response)
        ? response
        : response.enrollments || response.data || [];
      setEnrollments(list);
      setData(list);
    } catch (err: any) {
      const message = err instanceof ApiError ? err.message : (err?.message || 'Failed to fetch enrollments');
      setError(message);
      setEnrollments([]);
      setData([]);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchEnrollments();
  }, [fetchEnrollments]);

  return {
    enrollments,
    data,
    isLoading,
    error,
    refetch: fetchEnrollments,
  };
}

export function useEnroll() {
  const [isEnrolling, setIsEnrolling] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const enroll = useCallback(async (courseId: string): Promise<Enrollment> => {
    setIsEnrolling(true);
    setIsLoading(true);
    setError(null);
    try {
      const response = await api.post<any>('/api/v1/enrollments', { courseId });
      const enrollment: Enrollment = response.enrollment || response.data || response;
      return enrollment;
    } catch (err: any) {
      const message = err instanceof ApiError ? err.message : (err?.message || 'Failed to enroll in course');
      setError(message);
      throw err;
    } finally {
      setIsEnrolling(false);
      setIsLoading(false);
    }
  }, []);

  return {
    enroll,
    mutate: enroll,
    isEnrolling,
    isLoading,
    error,
  };
}

export function useEnrollmentStats() {
  const [stats, setStats] = useState<EnrollmentStats | null>(null);
  const [data, setData] = useState<EnrollmentStats | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const fetchStats = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const response = await api.get<any>('/api/v1/enrollments/stats');
      const statsData: EnrollmentStats = response.stats || response.data || response;
      setStats(statsData);
      setData(statsData);
    } catch (err: any) {
      const message = err instanceof ApiError ? err.message : (err?.message || 'Failed to fetch enrollment stats');
      setError(message);
      setStats(null);
      setData(null);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStats();
  }, [fetchStats]);

  return {
    stats,
    data,
    isLoading,
    error,
    refetch: fetchStats,
  };
}
