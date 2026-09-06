import type { UnifiedResearchResult } from "./types";

/** 이전 서버/메모리 작업의 누락 필드를 보정하여 결과 패널의 배열 접근 오류를 막는다. */
export function normalizeResearchResult(result: UnifiedResearchResult): UnifiedResearchResult {
  const integrated = result.integrated;
  return {
    ...result,
    sources: Array.isArray(result.sources) ? result.sources : [],
    storedCards: Array.isArray(result.storedCards) ? result.storedCards : [],
    liveCards: Array.isArray(result.liveCards) ? result.liveCards : [],
    skipped: Array.isArray(result.skipped) ? result.skipped : [],
    databases: Array.isArray(result.databases) ? result.databases : [],
    score: result.score ?? null,
    report: result.report ?? null,
    debate: result.debate ?? null,
    supplemented: result.supplemented ?? false,
    timings: result.timings ?? {},
    generatedAt: result.generatedAt ?? "",
    integrated: {
      ...integrated,
      summary: integrated?.summary ?? "",
      tagAnalysis: integrated?.tagAnalysis ?? "",
      timeSeries: integrated?.timeSeries ?? "",
      trend: integrated?.trend ?? "",
      needsSupplement: integrated?.needsSupplement ?? false,
      conflicts: Array.isArray(integrated?.conflicts) ? integrated.conflicts : [],
      gaps: Array.isArray(integrated?.gaps) ? integrated.gaps : [],
      old: Array.isArray(integrated?.old) ? integrated.old : [],
    },
  };
}
