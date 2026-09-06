"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import type { Job } from "@/Engine/Research-Engine/jobStore";
import { normalizeResearchResult } from "@/Engine/Research-Engine/result";

type BackgroundEngineValue = {
  researchJobs: Job[];
  refreshResearchJobs: () => Promise<Job[]>;
};

const BackgroundEngineContext = createContext<BackgroundEngineValue | null>(null);

export function BackgroundEngineProvider({ children }: { children: React.ReactNode }) {
  const [researchJobs, setResearchJobs] = useState<Job[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const refreshResearchJobs = useCallback(async () => {
    try {
      const response = await fetch("/api/unified-research/jobs");
      if (!response.ok) return [];
      const payload = (await response.json()) as { jobs?: Job[] };
      const jobs = (Array.isArray(payload.jobs) ? payload.jobs : []).map((job) => ({
        ...job,
        result: job.result ? normalizeResearchResult(job.result) : null,
        hitl: job.hitl ?? {
          completedStep: job.status === "done" ? 5 : 0,
          awaitingStep: null,
          awaitingApproval: false,
          agentUpdates: [],
        },
      }));
      setResearchJobs(jobs);
      if (jobs.some((job) => job.status === "running")) {
        if (!timerRef.current) timerRef.current = setInterval(() => void refreshResearchJobs(), 3000);
      } else if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
      return jobs;
    } catch {
      return [];
    }
  }, []);

  useEffect(() => {
    void refreshResearchJobs();
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [refreshResearchJobs]);

  return <BackgroundEngineContext.Provider value={{ researchJobs, refreshResearchJobs }}>{children}</BackgroundEngineContext.Provider>;
}

export function useBackgroundEngine() {
  const value = useContext(BackgroundEngineContext);
  if (!value) throw new Error("통합 인사이트는 BackgroundEngineProvider 안에서 사용해야 합니다.");
  return value;
}
