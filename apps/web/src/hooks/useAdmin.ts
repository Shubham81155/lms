'use client';

import { useState, useEffect, useCallback } from 'react';
import { api } from '@/lib/api';
import { typedGet, type GetResponse } from '@/lib/typed-api';
import { errorMessage } from '@/hooks/useApiData';
import { DashboardStats, AuditLog, PaginatedResponse, PaginationMeta } from '@/lib/types';

type AdminStatsResponse = GetResponse<'/api/v1/admin/stats'>;
type AuditLogsApiResponse = GetResponse<'/api/v1/admin/audit-logs'>;

export function useDashboardStats() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [data, setData] = useState<DashboardStats | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const fetchStats = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const response: AdminStatsResponse = await typedGet('/api/v1/admin/stats');
      const d = response.data;
      const statsData: DashboardStats = {
        totalUsers: d.totalUsers,
        totalCourses: d.totalCourses,
        totalEnrollments: d.totalEnrollments,
        completionRate: d.completionRate,
        activeToday: d.activeEnrollments,
      };
      setStats(statsData);
      setData(statsData);
    } catch (err: unknown) {
      setError(errorMessage(err, 'Failed to fetch dashboard stats'));
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

export interface AuditLogFilters {
  limit?: number;
  action?: string;
  resourceType?: string;
  userId?: string;
  startDate?: string;
  endDate?: string;
}

export function useAuditLogs(page: number = 1, filters?: AuditLogFilters) {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [pagination, setPagination] = useState<PaginationMeta | null>(null);
  const [data, setData] = useState<PaginatedResponse<AuditLog> | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const limit = filters?.limit ?? 20;
  const action = filters?.action;
  const resourceType = filters?.resourceType;
  const userId = filters?.userId;

  const fetchLogs = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const response = await api.get<AuditLogsApiResponse>('/api/v1/admin/audit-logs', {
        params: {
          page,
          limit,
          ...(action ? { action } : {}),
          ...(resourceType ? { resourceType } : {}),
          ...(userId ? { userId } : {}),
        },
      });

      const paginatedData: PaginatedResponse<AuditLog> = {
        data: response.data ?? [],
        pagination: response.pagination ?? {
          page,
          limit,
          total: response.data?.length ?? 0,
          totalPages: Math.ceil((response.data?.length ?? 0) / limit) || 1,
        },
      };
      setData(paginatedData);
      setLogs(paginatedData.data);
      setPagination(paginatedData.pagination);
    } catch (err: unknown) {
      setError(errorMessage(err, 'Failed to fetch audit logs'));
      setLogs([]);
      setData(null);
      setPagination(null);
    } finally {
      setIsLoading(false);
    }
  }, [page, limit, action, resourceType, userId]);

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  return {
    logs,
    pagination,
    data,
    isLoading,
    error,
    refetch: fetchLogs,
  };
}
