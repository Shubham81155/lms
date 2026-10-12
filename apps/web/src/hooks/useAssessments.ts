"use client";

import { useState, useEffect, useCallback } from 'react';
import { api, ApiError } from '@/lib/api';
import { Quiz, Assignment, AssignmentSubmission } from '@/lib/types';

export function useQuizzes(courseId: string) {
  const [quizzes, setQuizzes] = useState<Quiz[]>([]);
  const [data, setData] = useState<Quiz[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(!!courseId);
  const [error, setError] = useState<string | null>(null);

  const fetchQuizzes = useCallback(async () => {
    if (!courseId) {
      setQuizzes([]);
      setData([]);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setError(null);
    try {
      const response = await api.get<any>(`/api/v1/courses/${courseId}/quizzes`);
      const list: Quiz[] = Array.isArray(response)
        ? response
        : response.quizzes || response.data || [];
      setQuizzes(list);
      setData(list);
    } catch (err: any) {
      const message = err instanceof ApiError ? err.message : (err?.message || 'Failed to fetch quizzes');
      setError(message);
      setQuizzes([]);
      setData([]);
    } finally {
      setIsLoading(false);
    }
  }, [courseId]);

  useEffect(() => {
    fetchQuizzes();
  }, [fetchQuizzes]);

  return {
    quizzes,
    data,
    isLoading,
    error,
    refetch: fetchQuizzes,
  };
}

export function useQuiz(id: string | null | undefined) {
  const [quiz, setQuiz] = useState<Quiz | null>(null);
  const [data, setData] = useState<Quiz | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(!!id);
  const [error, setError] = useState<string | null>(null);

  const fetchQuiz = useCallback(async () => {
    if (!id) {
      setQuiz(null);
      setData(null);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setError(null);
    try {
      const response = await api.get<any>(`/api/v1/quizzes/${id}`);
      const quizData: Quiz = response.quiz || response.data || response;
      setQuiz(quizData);
      setData(quizData);
    } catch (err: any) {
      const message = err instanceof ApiError ? err.message : (err?.message || 'Failed to fetch quiz');
      setError(message);
      setQuiz(null);
      setData(null);
    } finally {
      setIsLoading(false);
    }
  }, [id]);

  useEffect(() => {
    fetchQuiz();
  }, [fetchQuiz]);

  return {
    quiz,
    data,
    isLoading,
    error,
    refetch: fetchQuiz,
  };
}

export function useSubmitQuiz() {
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const submitQuiz = useCallback(
    async (
      quizId: string,
      answers: Record<string, any> | Array<{ questionId: string; answer: any }>
    ): Promise<any> => {
      setIsSubmitting(true);
      setIsLoading(true);
      setError(null);
      try {
        const response = await api.post<any>(`/api/v1/quizzes/${quizId}/submissions`, {
          answers,
        });
        return response.submission || response.data || response;
      } catch (err: any) {
        const message = err instanceof ApiError ? err.message : (err?.message || 'Failed to submit quiz');
        setError(message);
        throw err;
      } finally {
        setIsSubmitting(false);
        setIsLoading(false);
      }
    },
    []
  );

  return {
    submitQuiz,
    mutate: submitQuiz,
    isSubmitting,
    isLoading,
    error,
  };
}

export function useAssignments(courseId: string) {
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [data, setData] = useState<Assignment[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(!!courseId);
  const [error, setError] = useState<string | null>(null);

  const fetchAssignments = useCallback(async () => {
    if (!courseId) {
      setAssignments([]);
      setData([]);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setError(null);
    try {
      const response = await api.get<any>(`/api/v1/courses/${courseId}/assignments`);
      const list: Assignment[] = Array.isArray(response)
        ? response
        : response.assignments || response.data || [];
      setAssignments(list);
      setData(list);
    } catch (err: any) {
      const message = err instanceof ApiError ? err.message : (err?.message || 'Failed to fetch assignments');
      setError(message);
      setAssignments([]);
      setData([]);
    } finally {
      setIsLoading(false);
    }
  }, [courseId]);

  useEffect(() => {
    fetchAssignments();
  }, [fetchAssignments]);

  return {
    assignments,
    data,
    isLoading,
    error,
    refetch: fetchAssignments,
  };
}

export interface AssignmentSubmissionInput {
  fileUrl?: string | null;
  submissionText?: string | null;
  [key: string]: any;
}

export function useSubmitAssignment() {
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const submitAssignment = useCallback(
    async (
      assignmentId: string,
      submission: AssignmentSubmissionInput
    ): Promise<AssignmentSubmission> => {
      setIsSubmitting(true);
      setIsLoading(true);
      setError(null);
      try {
        const response = await api.post<any>(
          `/api/v1/assignments/${assignmentId}/submissions`,
          submission
        );
        const result: AssignmentSubmission = response.submission || response.data || response;
        return result;
      } catch (err: any) {
        const message =
          err instanceof ApiError ? err.message : (err?.message || 'Failed to submit assignment');
        setError(message);
        throw err;
      } finally {
        setIsSubmitting(false);
        setIsLoading(false);
      }
    },
    []
  );

  return {
    submitAssignment,
    mutate: submitAssignment,
    isSubmitting,
    isLoading,
    error,
  };
}
