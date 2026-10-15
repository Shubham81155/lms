"use client";

import { useMemo } from "react";
import { useAuth } from "@/context/AuthContext";
import { useApiData } from "@/hooks/useApiData";

export interface StaffCourse {
  id: string;
  code: string;
  title: string;
}

/** Courses the signed-in staff member may manage: all of them for administrators, else those they teach. */
export function useStaffCourses() {
  const { user } = useAuth();
  const { data, isLoading, error } = useApiData<{ data: any[] }>("/api/v1/courses", { limit: 100 });

  const courses = useMemo<StaffCourse[]>(() => {
    const all = data?.data ?? [];
    const admin = user?.role === "TENANT_ADMIN" || user?.role === "SUPER_ADMIN";
    return all
      .filter((c) => admin || (c.instructors ?? []).some((i: any) => i.user?.id === user?.id))
      .map((c) => ({ id: c.id, code: c.code, title: c.title }));
  }, [data, user]);

  return { courses, isLoading, error };
}
