'use client';

import { useState, useEffect, useCallback } from 'react';
import { typedGet } from '@/lib/typed-api';
import { errorMessage } from '@/hooks/useApiData';

export interface AtRiskLearner {
  id: string;
  name: string;
  email: string;
  course: string;
  courseId?: string;
  riskFactor: 'HIGH' | 'MEDIUM' | 'LOW';
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
      const response = await typedGet('/api/v1/analytics/cohort');
      setData(response);
    } catch (err: unknown) {
      setError(errorMessage(err, 'Failed to fetch cohort analytics'));
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
      const response = await typedGet('/api/v1/analytics/xapi/stream', { limit });
      setStatements((response.statements || []) as XApiStatementItem[]);
      setTotal(response.total || 0);
    } catch (err: unknown) {
      setError(errorMessage(err, 'Failed to fetch xAPI stream'));
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
