"use client";

import { useState, useEffect, useCallback } from 'react';
import { api, ApiError } from '@/lib/api';
import {
  TenantConfig,
  DashboardStats,
  AuditLog,
  PaginatedResponse,
  PaginationMeta,
} from '@/lib/types';

export function useTenantConfig() {
  const [config, setConfig] = useState<TenantConfig | null>(null);
  const [data, setData] = useState<TenantConfig | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const fetchConfig = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const response = await api.get<any>('/api/v1/tenant/config');
      const normalized: TenantConfig = {
        id: response.id || response.tenantId || '',
        name: response.name || '',
        logoUrl: response.logoUrl || response.theme?.logoUrl || null,
        primaryColor: response.primaryColor || response.theme?.primaryColor || '#0f172a',
        secondaryColor: response.secondaryColor || response.theme?.secondaryColor || '#3b82f6',
        features: response.features || {},
        tenantId: response.tenantId || response.id,
        slug: response.slug,
        theme: response.theme,
      };
      setConfig(normalized);
      setData(normalized);
    } catch (err: any) {
      const message = err instanceof ApiError ? err.message : (err?.message || 'Failed to fetch tenant configuration');
      setError(message);
      setConfig(null);
      setData(null);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchConfig();
  }, [fetchConfig]);

  return {
    config,
    data,
    isLoading,
    error,
    refetch: fetchConfig,
  };
}

export function useDashboardStats() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [data, setData] = useState<DashboardStats | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const fetchStats = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const response = await api.get<any>('/api/v1/admin/stats');
      const statsData: DashboardStats = response.stats || response.data || response;
      setStats(statsData);
      setData(statsData);
    } catch (err: any) {
      const message = err instanceof ApiError ? err.message : (err?.message || 'Failed to fetch dashboard stats');
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
      const response = await api.get<any>('/api/v1/admin/audit-logs', {
        params: {
          page,
          limit,
          ...(action ? { action } : {}),
          ...(resourceType ? { resourceType } : {}),
          ...(userId ? { userId } : {}),
        },
      });

      if (response && Array.isArray(response.data)) {
        const paginatedData = response as PaginatedResponse<AuditLog>;
        setData(paginatedData);
        setLogs(paginatedData.data);
        setPagination(paginatedData.pagination);
      } else if (response && Array.isArray(response.logs)) {
        const logList = response.logs as AuditLog[];
        const meta: PaginationMeta = response.pagination || {
          page,
          limit,
          total: logList.length,
          totalPages: Math.ceil(logList.length / limit) || 1,
        };
        const structured: PaginatedResponse<AuditLog> = {
          data: logList,
          pagination: meta,
        };
        setData(structured);
        setLogs(logList);
        setPagination(meta);
      } else if (Array.isArray(response)) {
        const meta: PaginationMeta = {
          page,
          limit,
          total: response.length,
          totalPages: Math.ceil(response.length / limit) || 1,
        };
        const structured: PaginatedResponse<AuditLog> = {
          data: response,
          pagination: meta,
        };
        setData(structured);
        setLogs(response);
        setPagination(meta);
      } else {
        setLogs([]);
        setData(null);
        setPagination(null);
      }
    } catch (err: any) {
      const message = err instanceof ApiError ? err.message : (err?.message || 'Failed to fetch audit logs');
      setError(message);
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
