'use client';

import { useState, useEffect, useCallback } from 'react';
import { typedGet } from '@/lib/typed-api';
import { errorMessage } from '@/hooks/useApiData';
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
      const response = await typedGet('/api/v1/enrollments/my');
      const list: Enrollment[] = response.data ?? [];
      setEnrollments(list);
      setData(list);
    } catch (err: unknown) {
      setError(errorMessage(err, 'Failed to fetch enrollments'));
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

export function useEnrollmentStats() {
  const [stats, setStats] = useState<EnrollmentStats | null>(null);
  const [data, setData] = useState<EnrollmentStats | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const fetchStats = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const response = await typedGet('/api/v1/enrollments/stats');
      const d = response.data;
      const statsData: EnrollmentStats = {
        totalCourses: d.total,
        inProgress: d.inProgress,
        completed: d.completed,
        averageGrade: d.averageProgress,
      };
      setStats(statsData);
      setData(statsData);
    } catch (err: unknown) {
      setError(errorMessage(err, 'Failed to fetch enrollment stats'));
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
