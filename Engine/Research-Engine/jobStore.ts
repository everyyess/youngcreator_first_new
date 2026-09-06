/**
 * 통합 리서치 엔진 — 백그라운드 작업 스토어
 *
 * AI 자동매매 엔진(lib/autotrade/convictionEngine.ts)과 동일한 globalThis 상주 패턴:
 * 서버 프로세스 수명 동안 작업 상태를 들고 있어, HTTP 응답이 끝난 뒤에도 실행이 계속되고
 * 클라이언트는 폴링으로 진행률을 조회한다 (탭을 이동해도 서버의 작업은 끊기지 않는다).
 */
import { AsyncLocalStorage } from "async_hooks";
import type { ResearchStage, UnifiedResearchRequest, UnifiedResearchResult } from "./types";

export type HumanApprovalStep = 1 | 2 | 3 | 4 | 5;
export type AgentUpdate = {
  step: HumanApprovalStep;
  agent: string;
  status: "completed" | "skipped" | "error";
  summary: string;
  completedAt: string;
};
export type HumanApprovalState = {
  completedStep: 0 | HumanApprovalStep;
  awaitingStep: HumanApprovalStep | null;
  awaitingApproval: boolean;
  agentUpdates: AgentUpdate[];
};

export const jobLocalStorage = new AsyncLocalStorage<{ jobId: string; trackModel: (model: string) => void }>();

export type Job = {
  id: string;
  request: UnifiedResearchRequest;
  status: "running" | "awaiting_approval" | "done" | "error";
  stage: ResearchStage;
  /** 거쳐간 stage 누적 — STEP4-1/4-2/4-3이 병렬 실행되면서 stage가 빠르게 덮어써져도
   *  UI가 "어떤 단계가 실행됐는지"를 폴링 타이밍과 무관하게 판별할 수 있게 한다 */
  stageHistory: ResearchStage[];
  /** STEP1 DB별 에이전트 진행 상태 — 파이프라인 UI의 DB 노드가 개별 완료/스킵을 실시간 표시한다 */
  dbStates: Record<string, "running" | "done" | "skipped" | "error">;
  percent: number;
  stageLabel: string;
  startedAt: string;
  updatedAt: string;
  finishedAt: string | null;
  result: UnifiedResearchResult | null;
  error: string | null;
  modelUsage?: Record<string, number>;
  /** Human-In-The-Loop: 완료 정보 확인 후 PB 승인으로만 다음 STEP을 실행한다. */
  hitl: HumanApprovalState;
};

type Store = { jobs: Map<string, Job> };
const g = globalThis as unknown as { __unifiedResearchJobs?: Store };

function state(): Store {
  if (!g.__unifiedResearchJobs) g.__unifiedResearchJobs = { jobs: new Map() };
  return g.__unifiedResearchJobs;
}

const MAX_AGE_MS = 2 * 60 * 60 * 1000; // 완료 후 2시간 지난 작업은 조회 시 정리

function pruneOldJobs(): void {
  const jobs = state().jobs;
  const cutoff = Date.now() - MAX_AGE_MS;
  for (const [id, job] of jobs) {
    if (job.status !== "running" && new Date(job.updatedAt).getTime() < cutoff) jobs.delete(id);
  }
}

export function createJob(request: UnifiedResearchRequest): Job {
  const id = `ur_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const now = new Date().toISOString();
  const job: Job = {
    id,
    request,
    status: "running",
    stage: "collecting",
    stageHistory: ["collecting"],
    dbStates: Object.fromEntries(
      (Array.isArray(request.databases) ? request.databases : []).map((d) => [d, "running" as const]),
    ),
    percent: 1,
    stageLabel: "작업 준비 중",
    startedAt: now,
    updatedAt: now,
    finishedAt: null,
    result: null,
    error: null,
    modelUsage: {},
    hitl: { completedStep: 0, awaitingStep: null, awaitingApproval: false, agentUpdates: [] },
  };
  state().jobs.set(id, job);
  pruneOldJobs();
  return job;
}

export function updateJob(id: string, patch: Partial<Job>): void {
  const job = state().jobs.get(id);
  if (!job) return;
  Object.assign(job, patch, { updatedAt: new Date().toISOString() });
}

export function getJob(id: string): Job | null {
  return state().jobs.get(id) ?? null;
}

export function updateJobModelUsage(id: string, usage: Record<string, number>): void {
  const job = state().jobs.get(id);
  if (job) {
    job.modelUsage = usage;
    job.updatedAt = new Date().toISOString();
  }
}

export function listJobs(limit = 10): Job[] {
  pruneOldJobs();
  return [...state().jobs.values()]
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
    .slice(0, limit);
}

