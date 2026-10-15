"use client";

import { useState, useEffect, useCallback } from "react";
import { api, ApiError } from "@/lib/api";

export interface AtRiskLearner {
  id: string;
  name: string;
  email: string;
  course: string;
  courseId?: string;
  riskFactor: "HIGH" | "MEDIUM" | "LOW";
  reasons: string[];
  suggestedAction: string;
  streakDays?: number;
}

export interface AssessmentItemAnalysis {
  questionId: string;
  concept: string;
  taxonomyLevel?: string;
  questionType?: string;
  attempts?: number;
  averageScorePercent: number;
  status: string;
  recommendation: string;
}

export interface CohortAnalyticsResponse {
  tenantId: string;
  metrics: {
    totalEnrolled: number;
    activeThisWeek: number;
    averageProgress: number;
    completionRate: number;
    averageGpa: number;
    averageGrade?: number;
  };
  atRiskLearners: AtRiskLearner[];
  itemAnalysis: AssessmentItemAnalysis[];
  bloomsMastery: Array<{ level: string; score: number }>;
}

export interface XApiStatementItem {
  id: string;
  timestamp: string;
  actor: { mbox: string; name?: string };
  verb: { id: string; display?: Record<string, string> };
  object: {
    id: string;
    definition?: { name?: Record<string, string>; type?: string };
  };
  result?: { score?: { raw: number }; completion?: boolean; duration?: string; success?: boolean };
}

export function useCohortAnalytics() {
  const [data, setData] = useState<CohortAnalyticsResponse | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const fetchCohort = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const response = await api.get<CohortAnalyticsResponse>("/api/v1/analytics/cohort");
      setData(response);
    } catch (err: any) {
      const message = err instanceof ApiError ? err.message : (err?.message || "Failed to fetch cohort analytics");
      setError(message);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchCohort();
  }, [fetchCohort]);

  return {
    analytics: data,
    data,
    isLoading,
    error,
    refetch: fetchCohort,
  };
}

export function useXApiStream(limit: number = 20) {
  const [statements, setStatements] = useState<XApiStatementItem[]>([]);
  const [total, setTotal] = useState<number>(0);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const fetchStream = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const response = await api.get<{ total: number; statements: XApiStatementItem[] }>(
        `/api/v1/analytics/xapi/stream?limit=${limit}`
      );
      setStatements(response.statements || []);
      setTotal(response.total || 0);
    } catch (err: any) {
      const message = err instanceof ApiError ? err.message : (err?.message || "Failed to fetch xAPI stream");
      setError(message);
    } finally {
      setIsLoading(false);
    }
  }, [limit]);

  useEffect(() => {
    fetchStream();
  }, [fetchStream]);

  return {
    statements,
    total,
    isLoading,
    error,
    refetch: fetchStream,
  };
}

export function useAiTutorDrill() {
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const requestDrill = useCallback(
    async (topic: string, message?: string) => {
      setIsLoading(true);
      setError(null);
      try {
        const response = await api.post<{
          topic: string;
          explanation: string;
          keyTakeaways: string[];
          recommendedDrill: any[];
          readinessBoostPercent: number;
        }>("/api/v1/analytics/ai/tutor", { topic, message });
        return response;
      } catch (err: any) {
        const message = err instanceof ApiError ? err.message : (err?.message || "Failed to generate AI tutor drill");
        setError(message);
        throw err;
      } finally {
        setIsLoading(false);
      }
    },
    []
  );

  return {
    requestDrill,
    isLoading,
    error,
  };
}
