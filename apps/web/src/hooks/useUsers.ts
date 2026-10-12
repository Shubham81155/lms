"use client";

import { useState, useEffect, useCallback } from 'react';
import { api, ApiError } from '@/lib/api';
import { User, PaginatedResponse, PaginationMeta } from '@/lib/types';

export function useUsers(page: number = 1, limit: number = 10, search?: string) {
  const [users, setUsers] = useState<User[]>([]);
  const [pagination, setPagination] = useState<PaginationMeta | null>(null);
  const [data, setData] = useState<PaginatedResponse<User> | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const fetchUsers = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const response = await api.get<any>('/api/v1/users', {
        params: {
          page,
          limit,
          ...(search ? { search } : {}),
        },
      });

      if (response && Array.isArray(response.data)) {
        const paginatedData = response as PaginatedResponse<User>;
        setData(paginatedData);
        setUsers(paginatedData.data);
        setPagination(paginatedData.pagination);
      } else if (response && Array.isArray(response.users)) {
        const userList = response.users as User[];
        const meta: PaginationMeta = response.pagination || {
          page,
          limit,
          total: userList.length,
          totalPages: Math.ceil(userList.length / limit) || 1,
        };
        const structured: PaginatedResponse<User> = {
          data: userList,
          pagination: meta,
        };
        setData(structured);
        setUsers(userList);
        setPagination(meta);
      } else if (Array.isArray(response)) {
        const meta: PaginationMeta = {
          page,
          limit,
          total: response.length,
          totalPages: Math.ceil(response.length / limit) || 1,
        };
        const structured: PaginatedResponse<User> = {
          data: response,
          pagination: meta,
        };
        setData(structured);
        setUsers(response);
        setPagination(meta);
      } else {
        setUsers([]);
        setData(null);
        setPagination(null);
      }
    } catch (err: any) {
      const message = err instanceof ApiError ? err.message : (err?.message || 'Failed to fetch users');
      setError(message);
      setUsers([]);
      setData(null);
      setPagination(null);
    } finally {
      setIsLoading(false);
    }
  }, [page, limit, search]);

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  return {
    users,
    pagination,
    data,
    isLoading,
    error,
    refetch: fetchUsers,
  };
}

export function useUserProfile(id?: string) {
  const [user, setUser] = useState<User | null>(null);
  const [data, setData] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const fetchProfile = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const endpoint = id ? `/api/v1/users/${id}` : '/api/v1/users/me';
      const response = await api.get<any>(endpoint);
      const profileData: User = response.user || response.data || response;
      setUser(profileData);
      setData(profileData);
    } catch (err: any) {
      const message = err instanceof ApiError ? err.message : (err?.message || 'Failed to fetch user profile');
      setError(message);
      setUser(null);
      setData(null);
    } finally {
      setIsLoading(false);
    }
  }, [id]);

  useEffect(() => {
    fetchProfile();
  }, [fetchProfile]);

  return {
    user,
    data,
    isLoading,
    error,
    refetch: fetchProfile,
  };
}
