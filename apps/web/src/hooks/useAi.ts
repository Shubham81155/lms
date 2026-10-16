"use client";

import { useApiData } from "@/hooks/useApiData";

export type AiOffReason = "NOT_ON_PLAN" | "TURNED_OFF" | "NOT_CONFIGURED";

/** Whether AI assistance can be used in this organisation; screens hide AI entry points otherwise. */
export function useAiStatus() {
  const { data, isLoading } = useApiData<{ data: { enabled: boolean; reason: AiOffReason | null } }>("/api/v1/ai/status");
  return { enabled: data?.data.enabled ?? false, reason: data?.data.reason ?? null, isLoading };
}

export const AI_OFF_TEXT: Record<AiOffReason, string> = {
  NOT_ON_PLAN: "AI assistance is not part of your organisation's plan.",
  TURNED_OFF: "An administrator has turned AI assistance off.",
  NOT_CONFIGURED: "AI assistance is not set up yet. An administrator can add a provider key under Administration › Plan & Integrations.",
};
