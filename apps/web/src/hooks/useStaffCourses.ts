"use client";

import { useMemo } from "react";
import { useAuth } from "@/context/AuthContext";
import { useApiData } from "@/hooks/useApiData";

export interface StaffCourse {
  id: string;
  code: string;
  title: string;
  status: "DRAFT" | "PUBLISHED" | "ARCHIVED";
  enrollmentCount: number;
  moduleCount: number;
  /** Publishing review: null, PENDING or CHANGES_REQUESTED (with the reviewer's note). */
  reviewStatus: "PENDING" | "CHANGES_REQUESTED" | null;
  reviewNote: string | null;
}

/**
 * Courses the signed-in staff member may work with: all of them for administrators, else those they
 * teach. With `editableOnly`, assistants get none: the API lets only administrators and the assigned
 * instructor change course content, status and structure.
 */
export function useStaffCourses(options: { editableOnly?: boolean } = {}) {
  const { user } = useAuth();
  const { data, isLoading, error, reload } = useApiData<{ data: any[] }>("/api/v1/courses", { limit: 100 });
  const editableOnly = !!options.editableOnly;

  const courses = useMemo<StaffCourse[]>(() => {
    const all = data?.data ?? [];
    const admin = user?.role === "TENANT_ADMIN" || user?.role === "SUPER_ADMIN";
    const mayEdit = admin || user?.role === "INSTRUCTOR";
    if (editableOnly && !mayEdit) return [];
    return all
      .filter((c) => admin || (c.instructors ?? []).some((i: any) => i.user?.id === user?.id))
      .map((c) => ({
        id: c.id, code: c.code, title: c.title, status: c.status, enrollmentCount: c.enrollmentCount ?? 0, moduleCount: c.moduleCount ?? 0,
        reviewStatus: c.reviewStatus ?? null, reviewNote: c.reviewNote ?? null,
      }));
  }, [data, user, editableOnly]);

  return { courses, isLoading, error, reload };
}
