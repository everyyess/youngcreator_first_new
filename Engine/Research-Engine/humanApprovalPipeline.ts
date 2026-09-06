import type { SupabaseClient } from "@supabase/supabase-js";
import { createJob, getJob, updateJob, type AgentUpdate, type HumanApprovalStep, type Job } from "./jobStore";
import { isDatabaseId, type DatabaseId, type EvidenceCard, type IntegratedContext, type ReportMetricChart, type UnifiedResearchRequest, type UnifiedResearchResult } from "./types";
import { normalizeResearchResult } from "./result";
import { extractMappedTags } from "@/lib/tagRules";
import { loadLiveInsightSources } from "@/lib/liveInsightSources";
import { formatSupabaseError } from "@/lib/supabaseInsightDb";
import { generateResearchReport } from "./researchReport";
import { runHumanDebate } from "./humanDebate";
import { sectorsForMarket } from "@/app/api/sector-scanner/sectorMaster";

const DB: Partial<Record<DatabaseId, { table: string; label: string; fields: string }>> = {
  telegram: { table: "telegram_saved", label: "텔레그램", fields: "id,text,summary,msg_date,link,created_at,topic_tags,company_tags,macro_tags" },
  news: { table: "news_articles", label: "뉴스", fields: "id,title,notes,published_date,url,created_at,topic_tags,company_tags,macro_tags" },
  report: { table: "report_db", label: "리포트", fields: "id,title,ai_summary,published_date,url,created_at,topic_tags,company_tags,macro_tags" },
};
const DATABASE_LABEL: Partial<Record<DatabaseId, string>> = {
  telegram: "텔레그램", news: "뉴스", report: "리포트",
  correlation: "Correlation", peer: "Peer",
  fred: "FRED", ecos: "ECOS", kosis: "KOSIS",
};
const STAGE = { 1: "collecting", 2: "integrating", 3: "reintegrating", 4: "supplementing", 5: "reporting" } as const;
const clean = (value: unknown) => typeof value === "string" ? value : "";
const searchable = (value: string) => value.normalize("NFKC").replace(/\s+/g, "").toLowerCase();
const now = () => new Date().toISOString();
const dateOf = (value: unknown) => {
  const text = clean(value);
  const short = text.match(/^(\d{2})\.(\d{2})\.(\d{2})/);
  return short ? "20" + short[1] + "-" + short[2] + "-" + short[3] : text.slice(0, 10);
};
const update = (step: HumanApprovalStep, agent: string, status: AgentUpdate["status"], summary: string): AgentUpdate => ({
  step, agent, status, summary, completedAt: now(),
});
const emptyIntegrated = (): IntegratedContext => ({
  summary: "", tagAnalysis: "", timeSeries: "", trend: "",
  conflicts: [], gaps: [], old: [], needsSupplement: false,
});
const emptyResult = (request: UnifiedResearchRequest): UnifiedResearchResult => ({
  keyword: request.keyword, keywordType: request.keywordType ?? "theme", method: request.method,
  databases: request.databases, sources: [], storedCards: [], liveCards: [], skipped: [],
  integrated: emptyIntegrated(), supplemented: false, debate: null, report: null, score: null,
  metricCharts: [],
  timings: {}, generatedAt: "",
});

export function serializeResearchJob(job: Job): Job {
  return {
    ...job,
    result: job.result ? normalizeResearchResult(job.result) : null,
    hitl: job.hitl ?? { completedStep: job.status === "done" ? 5 : 0, awaitingStep: null, awaitingApproval: false, agentUpdates: [] },
  };
}
function matches(row: Record<string, unknown>, keyword: string) {
  const tags = extractMappedTags(clean(row.title) || clean(row.text));
  return searchable([...Object.values(row).flat(), ...tags.topics, ...tags.companies, ...tags.macro].join(" "))
    .includes(searchable(keyword));
}
function addEvidence(result: UnifiedResearchResult, database: DatabaseId, rows: Record<string, unknown>[], phase: "stored" | "live") {
  const seen = new Set(result.sources.map((source) => source.url).filter(Boolean));
  const citedSources: string[] = [];
  const evidence: string[] = [];
  const dates: string[] = [];
  for (const row of rows.slice(0, 30)) {
    const url = clean(row.link) || clean(row.url) || null;
    if (url && seen.has(url)) continue;
    if (url) seen.add(url);
    const title = (clean(row.title) || clean(row.text)).slice(0, 120);
    const summary = (clean(row.summary) || clean(row.notes) || clean(row.ai_summary)).slice(0, 400);
    const date = dateOf(row.date ?? row.msg_date ?? row.published_date ?? row.created_at);
    const id = "#" + (result.sources.length + 1);
    result.sources.push({ id, database, phase, title, url, date });
    citedSources.push(id);
    if (date) dates.push(date);
    evidence.push("- [" + id + "] **" + title + "** (" + (date || "날짜 미상") + ")\n  " + (summary || "제목 기반 자료 — 원문 확인 필요"));
  }
  if (!citedSources.length) return 0;
  const card: EvidenceCard = {
    databaseId: database, databaseLabel: DATABASE_LABEL[database] ?? database, phase,
    conclusion: result.keyword + " 관련 " + citedSources.length + "건의 " + (phase === "live" ? "실시간" : "저장") + " 자료를 확인했습니다.",
    evidence: evidence.join("\n"), citedSources, asOfDate: dates.sort().at(-1) ?? "",
    confidence: citedSources.length >= 5 ? "중간" : "낮음", itemCount: citedSources.length,
  };
  (phase === "stored" ? result.storedCards : result.liveCards).push(card);
  return citedSources.length;
}
function setCheckpoint(job: Job, step: HumanApprovalStep, updates: AgentUpdate[]) {
  const next = step < 5 ? (step + 1) as HumanApprovalStep : null;
  const history = [...job.stageHistory, STAGE[step]];
  updateJob(job.id, {
    status: next ? "awaiting_approval" : "done",
    stage: next ? STAGE[next] : "done",
    stageHistory: next ? history : [...history, "done"],
    percent: step * 20,
    stageLabel: next ? "PB 승인 대기 · STEP " + next : "분석 완료",
    finishedAt: next ? null : now(),
    hitl: {
      completedStep: step, awaitingStep: next, awaitingApproval: Boolean(next),
      agentUpdates: [...job.hitl.agentUpdates, ...updates],
    },
    result: job.result,
  });
}
function analyzeStep2(result: UnifiedResearchResult) {
  const tags = new Map<string, number>();
  const months = new Map<string, number>();
  for (const source of result.sources) {
    const mapped = extractMappedTags(source.title);
    for (const tag of [...mapped.topics, ...mapped.companies, ...mapped.macro]) tags.set(tag, (tags.get(tag) ?? 0) + 1);
    if (source.date) months.set(source.date.slice(0, 7), (months.get(source.date.slice(0, 7)) ?? 0) + 1);
  }
  const top = [...tags.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
  const timeline = [...months.entries()].sort();
  const latest = [...result.sources].filter((source) => source.date).sort((a, b) => b.date.localeCompare(a.date))[0];
  result.integrated.summary = result.sources.length + "건의 근거 자료를 통합했습니다.";
  result.integrated.tagAnalysis = top.length ? top.map(([tag, count]) => tag + "(" + count + ")").join(", ") : "추출된 연관 태그가 없습니다.";
  result.integrated.timeSeries = timeline.length ? timeline.map(([month, count]) => month + " " + count + "건").join(" → ") : "날짜 정보가 부족합니다.";
  result.integrated.trend = latest ? "최근 자료: " + latest.title + " (" + latest.date + ")" : "최신 자료가 없습니다.";
  return { sourceCount: result.sources.length, tagCount: top.length, monthCount: timeline.length };
}

async function fetchFredRows(baseUrl: string): Promise<Record<string, unknown>[]> {
  const url = new URL("/api/market/fred", baseUrl);
  url.searchParams.set("limit", "6");
  const response = await fetch(url, { signal: AbortSignal.timeout(30_000), cache: "no-store" });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({})) as { error?: string };
    throw new Error(payload.error ?? "FRED 조회 실패 (HTTP " + response.status + ")");
  }
  const payload = await response.json() as {
    data?: Record<string, {
      title: string; unit: string;
      observations: Array<{ date: string; value: string }>;
    }>;
  };
  return Object.entries(payload.data ?? {}).flatMap(([seriesId, series]) => {
    const latest = series.observations[0];
    if (!latest) return [];
    const history = series.observations
      .map((observation) => observation.date + " " + observation.value + series.unit)
      .join(" → ");
    return [{
      title: "FRED " + seriesId + " · " + series.title,
      summary: "최근 관측값: " + history,
      published_date: latest.date,
    }];
  });
}

async function fetchEcosRows(baseUrl: string): Promise<Record<string, unknown>[]> {
  const url = new URL("/api/market/ecos", baseUrl);
  url.searchParams.set("preset", "macro");
  const response = await fetch(url, { signal: AbortSignal.timeout(30_000), cache: "no-store" });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({})) as { error?: string };
    throw new Error(payload.error ?? "ECOS 조회 실패 (HTTP " + response.status + ")");
  }
  const payload = await response.json() as {
    indicators?: Array<{
      label: string; unit: string; cycle: string;
      observations: Array<{ time: string; value: string }>;
    }>;
  };
  return (payload.indicators ?? []).flatMap((indicator) => {
    const latest = indicator.observations[0];
    if (!latest) return [];
    const toDate = (time: string) => /^\d{6}$/.test(time)
      ? time.slice(0, 4) + "-" + time.slice(4, 6)
      : time;
    const history = indicator.observations
      .map((observation) => toDate(observation.time) + " " + observation.value + indicator.unit)
      .join(" → ");
    return [{
      title: "한국은행 ECOS · " + indicator.label,
      summary: "최근 관측값: " + history,
      published_date: toDate(latest.time),
    }];
  });
}

async function fetchInitialReportRows(keyword: string): Promise<Record<string, unknown>[]> {
  const live = await loadLiveInsightSources();
  return live.reports
    .map((item) => ({
      title: item.title,
      summary: item.summary,
      notes: item.meta,
      url: item.url,
      published_date: item.publishedDate,
    }))
    .filter((row) => matches(row, keyword));
}

async function fetchInitialNewsRows(keyword: string): Promise<Record<string, unknown>[]> {
  const live = await loadLiveInsightSources();
  return live.news
    .map((item) => ({
      title: item.title,
      summary: item.summary,
      notes: item.meta,
      url: item.url,
      published_date: item.publishedDate,
    }))
    .filter((row) => matches(row, keyword));
}

async function fetchCorrelationRows(baseUrl: string, keyword: string): Promise<Record<string, unknown>[]> {
  const url = new URL("/api/etf-correlation-domestic-html", baseUrl);
  url.searchParams.set("format", "json");
  url.searchParams.set("period", "6M");
  url.searchParams.set("strategy", "balanced");
  url.searchParams.set("k", "5");
  const response = await fetch(url, { signal: AbortSignal.timeout(45_000), cache: "no-store" });
  if (!response.ok) throw new Error("상관관계 분석 조회 실패 (HTTP " + response.status + ")");
  const payload = await response.json() as {
    period?: {
      start?: string; end?: string; optimal?: string[];
      opt_avg_corr?: number; global_avg?: number; capped_weights?: Record<string, number>;
    };
    sectorMap?: Record<string, string>;
  };
  const period = payload.period;
  if (!period?.optimal?.length) return [];
  const assets = period.optimal.map((ticker) => {
    const sector = payload.sectorMap?.[ticker];
    const weight = period.capped_weights?.[ticker];
    return ticker + (sector ? " (" + sector + ")" : "") + (typeof weight === "number" ? " " + (weight * 100).toFixed(1) + "%" : "");
  });
  return [{
    title: keyword + " 관련 국내 자산 6개월 상관관계·분산 조합",
    summary: "낮은 상관관계 조합: " + assets.join(", ")
      + ". 조합 평균 상관계수 " + (period.opt_avg_corr ?? 0).toFixed(3)
      + ", 전체 평균 " + (period.global_avg ?? 0).toFixed(3) + ".",
    published_date: period.end ?? now().slice(0, 10),
  }];
}

const PEER_SECTOR_ALIAS: Record<string, string> = {
  ai: "software", 인공지능: "software", 반도체: "semiconductor", 이차전지: "battery",
  "2차전지": "battery", 바이오: "bio", 제약: "bio", 자동차: "auto", 인터넷: "internet",
  플랫폼: "internet", 게임: "game", 엔터: "entertainment", 금융: "finance", 은행: "finance",
  증권: "securities", 보험: "insurance", 방산: "defense", 우주: "defense", 조선: "ship",
  로봇: "machinery", 기계: "machinery", 원전: "electric", 전력: "electric", 화학: "chemical",
  정유: "chemical", 철강: "steel", 건설: "construction", 음식료: "food", 화장품: "cosmetics",
  유통: "consumer", 통신: "telecom", 에너지: "utilities", 운송: "transport", 물류: "transport",
};

function findPeerSector(keyword: string) {
  const key = searchable(keyword).replace(/[·/]/g, "");
  const aliasId = PEER_SECTOR_ALIAS[key];
  for (const market of ["domestic", "global"] as const) {
    const sectors = sectorsForMarket(market);
    const matched = sectors.find((sector) => sector.id === aliasId
      || searchable(sector.name).includes(key)
      || key.includes(searchable(sector.name)));
    if (matched) return { market, sector: matched };
  }
  return null;
}

async function fetchPeerRows(baseUrl: string, keyword: string): Promise<Record<string, unknown>[]> {
  const matched = findPeerSector(keyword);
  if (!matched) return [];
  const url = new URL("/api/peer-analysis", baseUrl);
  url.searchParams.set("market", matched.market);
  url.searchParams.set("sector", matched.sector.id);
  const response = await fetch(url, { signal: AbortSignal.timeout(45_000), cache: "no-store" });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({})) as { error?: string };
    throw new Error(payload.error ?? "경쟁사 분석 조회 실패 (HTTP " + response.status + ")");
  }
  const payload = await response.json() as {
    sectorName?: string; asOf?: string;
    peers?: Array<Record<string, unknown> & { symbol?: string; name?: string; error?: string }>;
  };
  const fmt = (value: unknown, suffix = "") => typeof value === "number" && Number.isFinite(value)
    ? value.toFixed(2) + suffix : "N/A";
  return (payload.peers ?? []).filter((peer) => !peer.error).map((peer) => ({
    title: (payload.sectorName ?? matched.sector.name) + " Peer · " + (peer.name || peer.symbol || "기업"),
    summary: "티커 " + (peer.symbol ?? "-")
      + " · PER " + fmt(peer.per, "배") + " · PBR " + fmt(peer.pbr, "배")
      + " · ROE " + fmt(peer.roe, "%") + " · 영업이익률 " + fmt(peer.operatingMargin, "%")
      + " · 매출 YoY " + fmt(peer.revenueGrowthYoY, "%") + " · EPS 성장 " + fmt(peer.epsGrowthFwd, "%"),
    published_date: clean(payload.asOf).slice(0, 10) || now().slice(0, 10),
  }));
}

function buildMetricCharts(result: UnifiedResearchResult): ReportMetricChart[] {
  const charts: ReportMetricChart[] = [];
  for (const card of result.storedCards) {
    if (card.databaseId !== "fred" && card.databaseId !== "ecos") continue;
    const source = card.databaseId === "fred" ? "FRED" : "ECOS";
    const itemPattern = /- \[(#\d+)\] \*\*(.+?)\*\* \([^)]+\)\n\s+최근 관측값:\s*([^\n]+)/g;
    for (const match of card.evidence.matchAll(itemPattern)) {
      const points: Array<{ date: string; value: number }> = [];
      let unit = "";
      for (const raw of match[3].split("→")) {
        const point = raw.trim().match(/^(\d{4}-\d{2}(?:-\d{2})?)\s+(-?[\d,.]+)\s*(.*)$/);
        if (!point) continue;
        const value = Number(point[2].replace(/,/g, ""));
        if (!Number.isFinite(value)) continue;
        points.push({ date: point[1], value });
        if (!unit && point[3]) unit = point[3].trim();
      }
      points.sort((a, b) => a.date.localeCompare(b.date));
      if (points.length >= 2) charts.push({ title: match[2], source, unit, points });
    }
  }
  const selected = [
    ...charts.filter((chart) => chart.source === "FRED").slice(0, 3),
    ...charts.filter((chart) => chart.source === "ECOS").slice(0, 3),
  ];
  if (selected.length < 6) {
    const selectedKeys = new Set(selected.map((chart) => chart.source + "\u0000" + chart.title));
    selected.push(...charts.filter((chart) => !selectedKeys.has(chart.source + "\u0000" + chart.title)).slice(0, 6 - selected.length));
  }
  return selected.slice(0, 6);
}

function analyzeStep3(result: UnifiedResearchResult) {
  const selectedStored = new Set(result.storedCards.map((card) => card.databaseId));
  result.integrated.gaps = result.databases.filter((database) => !selectedStored.has(database))
    .map((database) => ({ description: (DB[database]?.label ?? database) + " 저장 근거가 없습니다.", databases: [database] }));
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 120);
  const cutoffDay = cutoff.toISOString().slice(0, 10);
  result.integrated.old = result.storedCards.filter((card) => card.asOfDate && card.asOfDate < cutoffDay)
    .map((card) => ({ description: card.databaseLabel + " 자료의 최신성이 낮습니다.", databases: [card.databaseId] }));
  result.integrated.conflicts = [];
  result.integrated.needsSupplement = result.integrated.gaps.length > 0 || result.integrated.old.length > 0;
}
async function runStep4(result: UnifiedResearchResult) {
  const updates: AgentUpdate[] = [];
  if (result.databases.some((id) => id === "news" || id === "report")) {
    try {
      const live = await loadLiveInsightSources();
      let total = 0;
      for (const database of ["news", "report"] as const) {
        if (!result.databases.includes(database)) continue;
        const candidates = database === "news" ? live.news : live.reports;
        const rows = candidates.map((item) => ({
          title: item.title,
          summary: item.summary,
          notes: item.meta,
          url: item.url,
          published_date: item.publishedDate,
        }))
          .filter((row) => matches(row, result.keyword));
        total += addEvidence(result, database, rows, "live");
      }
      result.supplemented = total > 0;
      updates.push(update(4, "실시간 리서치 에이전트", total ? "completed" : "skipped",
        total ? "뉴스·리포트 최신 근거 " + total + "건을 보강했습니다." : "일치하는 최신 근거가 없어 보강을 건너뛰었습니다."));
    } catch {
      updates.push(update(4, "실시간 리서치 에이전트", "error", "실시간 자료를 불러오지 못했습니다. 저장 근거로 다음 단계를 진행할 수 있습니다."));
    }
  } else {
    updates.push(update(4, "실시간 리서치 에이전트", "skipped", "뉴스·리포트가 선택되지 않아 실시간 보강을 건너뛰었습니다."));
  }
  const debateDatabases = new Set<DatabaseId>(["news", "report", "fred", "ecos", "correlation", "peer"]);
  const publicSources = result.sources.filter((source) => debateDatabases.has(source.database));
  const publicSourceIds = new Set(publicSources.map((source) => source.id));
  const debateCards: EvidenceCard[] = [...result.storedCards, ...result.liveCards]
    .filter((card) => debateDatabases.has(card.databaseId))
    .map((card) => {
      const citedSources = card.citedSources.filter((id) => publicSourceIds.has(id));
      const approvedEvidence = card.evidence.split(/(?=^- \[#\d+\])/gm)
        .filter((entry) => citedSources.some((id) => entry.includes("[" + id + "]")))
        .map((entry) => entry.trim())
        .join("\n");
      return {
        databaseId: card.databaseId,
        databaseLabel: card.databaseLabel,
        phase: card.phase,
        conclusion: card.databaseLabel + " 공개 출처 " + citedSources.length + "건",
        evidence: approvedEvidence,
        citedSources,
        asOfDate: card.asOfDate,
        confidence: card.confidence,
        itemCount: citedSources.length,
      };
    })
    .filter((card) => card.itemCount > 0 && card.evidence);
  const publicMonths = new Map<string, number>();
  const publicTags = new Map<string, number>();
  for (const source of publicSources) {
    if (source.date) publicMonths.set(source.date.slice(0, 7), (publicMonths.get(source.date.slice(0, 7)) ?? 0) + 1);
    const mapped = extractMappedTags(source.title);
    for (const tag of [...mapped.topics, ...mapped.companies, ...mapped.macro]) {
      publicTags.set(tag, (publicTags.get(tag) ?? 0) + 1);
    }
  }
  const latestPublic = [...publicSources].filter((source) => source.date).sort((a, b) => b.date.localeCompare(a.date))[0];
  const publicIntegrated: IntegratedContext = {
    summary: "공개 뉴스·리포트 및 시장지표 " + publicSources.length + "건을 비교합니다.",
    tagAnalysis: [...publicTags.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10)
      .map(([tag, count]) => tag + "(" + count + ")").join(", "),
    timeSeries: [...publicMonths.entries()].sort().map(([month, count]) => month + " " + count + "건").join(" → "),
    trend: latestPublic ? "최근 공개 자료: " + latestPublic.title + " (" + latestPublic.date + ")" : "",
    conflicts: [], gaps: [], old: [], needsSupplement: false,
  };
  if (debateCards.length) {
    try {
      const generated = await runHumanDebate(result.keyword, result.keywordType, publicIntegrated, debateCards);
      result.debate = generated.debate;
      for (const [model, count] of Object.entries(generated.modelUsage)) {
        result.modelUsage = {
          ...(result.modelUsage ?? {}),
          [model]: (result.modelUsage?.[model] ?? 0) + count,
        };
      }
      updates.push(update(4, "찬반토론 AI 에이전트", "completed",
        "Gemini 다중 키·모델 폴백으로 승인된 공개 출처 기반 입론 2건, 상호 반박 2건, 종합 판정 1건을 완료했습니다. 최종 판정: "
        + generated.debate.verdict + " (확신도 " + generated.debate.confidence + ")"));
    } catch (error) {
      updates.push(update(4, "찬반토론 AI 에이전트", "error",
        "Gemini 찬반토론 실행 실패: " + (error instanceof Error ? error.message : String(error))));
    }
  } else {
    updates.push(update(4, "찬반토론 AI 에이전트", "skipped", "승인된 공개 출처 기반 토론 근거가 없습니다."));
  }
  analyzeStep2(result);
  return updates;
}
export async function startHumanResearch(db: SupabaseClient, input: unknown): Promise<{ job?: Job; error?: string; status: number }> {
  if (!input || typeof input !== "object" || Array.isArray(input)) return { error: "올바른 리서치 요청이 필요합니다.", status: 400 };
  const body = input as Partial<UnifiedResearchRequest>;
  const request: UnifiedResearchRequest = {
    keyword: clean(body.keyword).trim(),
    databases: [...new Set(Array.isArray(body.databases) ? body.databases.filter(isDatabaseId) : [])],
    method: body.method === "score" ? "score" : "report",
    ticker: clean(body.ticker) || undefined, corpName: clean(body.corpName) || undefined,
    baseUrl: clean(body.baseUrl) || undefined,
    keywordType: ["stock", "theme", "macro"].includes(body.keywordType ?? "") ? body.keywordType : undefined,
  };
  if (!request.keyword) return { error: "keyword가 필요합니다.", status: 400 };
  if (!request.databases.length) return { error: "데이터베이스를 하나 이상 선택해주세요.", status: 400 };
  const job = createJob(request);
  job.result = emptyResult(request);
  const updates: AgentUpdate[] = [];
  for (const database of request.databases) {
    const spec = DB[database];
    if (!spec) {
      if ((database === "fred" || database === "ecos") && request.baseUrl) {
        try {
          const rows = database === "fred"
            ? await fetchFredRows(request.baseUrl)
            : await fetchEcosRows(request.baseUrl);
          const count = addEvidence(job.result, database, rows, "stored");
          job.dbStates[database] = count ? "done" : "skipped";
          if (!count) job.result.skipped.push({ databaseId: database, phase: "stored", reason: "조회된 거시 지표가 없습니다." });
          updates.push(update(1, (DATABASE_LABEL[database] ?? database) + " 에이전트", count ? "completed" : "skipped",
            count ? "거시 지표 " + count + "개 시리즈를 분석해 PB에게 전달했습니다." : "조회된 거시 지표가 없습니다."));
        } catch (error) {
          const reason = error instanceof Error ? error.message : String(error);
          job.dbStates[database] = "error";
          job.result.skipped.push({ databaseId: database, phase: "stored", reason, errored: true });
          updates.push(update(1, (DATABASE_LABEL[database] ?? database) + " 에이전트", "error", "자료 조회 실패: " + reason));
        }
        continue;
      }
      if ((database === "correlation" || database === "peer") && request.baseUrl) {
        try {
          const rows = database === "correlation"
            ? await fetchCorrelationRows(request.baseUrl, request.keyword)
            : await fetchPeerRows(request.baseUrl, request.keyword);
          const count = addEvidence(job.result, database, rows, "stored");
          job.dbStates[database] = count ? "done" : "skipped";
          const emptyReason = database === "peer"
            ? "키워드와 연결되는 경쟁사 섹터를 찾지 못했습니다."
            : "조회된 상관관계 분석 결과가 없습니다.";
          if (!count) job.result.skipped.push({ databaseId: database, phase: "stored", reason: emptyReason });
          updates.push(update(1, (DATABASE_LABEL[database] ?? database) + " 에이전트", count ? "completed" : "skipped",
            count
              ? (database === "peer" ? "경쟁사 " : "상관관계 ") + count + "건을 분석해 PB에게 전달했습니다."
              : emptyReason));
        } catch (error) {
          const reason = error instanceof Error ? error.message : String(error);
          job.dbStates[database] = "error";
          job.result.skipped.push({ databaseId: database, phase: "stored", reason, errored: true });
          updates.push(update(1, (DATABASE_LABEL[database] ?? database) + " 에이전트", "error", "자료 조회 실패: " + reason));
        }
        continue;
      }
      job.dbStates[database] = "skipped";
      job.result.skipped.push({ databaseId: database, phase: "stored", reason: "현재 연결되지 않은 분석 소스입니다." });
      updates.push(update(1, (DATABASE_LABEL[database] ?? database) + " 에이전트", "skipped", "현재 연결되지 않은 분석 소스라 수집을 건너뛰었습니다."));
      continue;
    }
    try {
      const { data, error } = await db.from(spec.table).select(spec.fields).order("created_at", { ascending: false }).limit(200);
      if (error) throw error;
      const rows = (data ?? []).map((row) => row as unknown as Record<string, unknown>).filter((row) => matches(row, request.keyword));
      let count = addEvidence(job.result, database, rows, "stored");
      if (!count && (database === "news" || database === "report")) {
        const fallbackRows = database === "news"
          ? await fetchInitialNewsRows(request.keyword)
          : await fetchInitialReportRows(request.keyword);
        count = addEvidence(job.result, database, fallbackRows, "stored");
      }
      job.dbStates[database] = count ? "done" : "skipped";
      if (!count) job.result.skipped.push({ databaseId: database, phase: "stored", reason: "일치하는 저장 자료가 없습니다." });
      updates.push(update(1, spec.label + " 에이전트", count ? "completed" : "skipped",
        count ? "저장 근거 " + count + "건을 PB에게 전달했습니다." : "태그와 일치하는 저장 근거가 없습니다."));
    } catch (error) {
      job.dbStates[database] = "error";
      const reason = formatSupabaseError(error);
      job.result.skipped.push({ databaseId: database, phase: "stored", reason, errored: true });
      updates.push(update(1, spec.label + " 에이전트", "error", "자료 조회 실패: " + reason));
    }
  }
  job.result.timings.step1 = Date.now() - new Date(job.startedAt).getTime();
  setCheckpoint(job, 1, updates);
  return { job: serializeResearchJob(getJob(job.id) ?? job), status: 201 };
}
export async function approveHumanResearch(jobId: string, expectedStep: number): Promise<{ job?: Job; error?: string; status: number }> {
  const job = getJob(jobId);
  if (!job) return { error: "작업을 찾을 수 없습니다.", status: 404 };
  if (job.status !== "awaiting_approval" || !job.hitl.awaitingApproval || job.hitl.awaitingStep !== expectedStep) {
    return { error: "이미 처리됐거나 현재 승인할 STEP이 아닙니다.", status: 409 };
  }
  const step = job.hitl.awaitingStep;
  if (!step || !job.result) return { error: "승인할 중간 결과가 없습니다.", status: 409 };
  updateJob(job.id, { status: "running", stage: STAGE[step], stageLabel: "STEP " + step + " 실행 중" });
  const started = Date.now();
  let updates: AgentUpdate[] = [];
  if (step === 2) {
    const counts = analyzeStep2(job.result);
    updates = [
      update(2, "연관 태그 분석 에이전트", "completed", "근거 " + counts.sourceCount + "건에서 상위 연관 태그 " + counts.tagCount + "개를 분석했습니다."),
      update(2, "시계열 분석 에이전트", "completed", "근거 " + counts.sourceCount + "건을 " + counts.monthCount + "개 월 구간으로 분석했습니다."),
      update(2, "트렌드 분석 에이전트", "completed", "근거 " + counts.sourceCount + "건 분석 · " + job.result.integrated.trend),
    ];
  } else if (step === 3) {
    analyzeStep3(job.result);
    updates = [update(3, "검증 에이전트", "completed",
      "충돌 " + job.result.integrated.conflicts.length + "건 · 정보 공백 " + job.result.integrated.gaps.length
      + "건 · 신선도 경고 " + job.result.integrated.old.length + "건을 PB에게 전달했습니다.")];
  } else if (step === 4) {
    updates = await runStep4(job.result);
    job.modelUsage = { ...(job.modelUsage ?? {}), ...(job.result.modelUsage ?? {}) };
  } else if (step === 5) {
    job.result.metricCharts = buildMetricCharts(job.result);
    const generated = await generateResearchReport(job.result);
    job.result.report = generated.markdown;
    job.result.generatedAt = now();
    if (generated.model) {
      job.result.modelUsage = { ...(job.result.modelUsage ?? {}), [generated.model]: 1 };
      job.modelUsage = { ...(job.modelUsage ?? {}), [generated.model]: 1 };
    }
    updates = [update(5, "팩트체크·보고서 에이전트", "completed",
      (generated.mode === "ai" ? "AI가 " : "근거 기반 폴백이 ")
      + "근거 " + job.result.sources.length + "건을 분석한 최종 보고서를 PB에게 전달했습니다."
      + (job.result.metricCharts.length ? " 실제 지표 그래프 " + job.result.metricCharts.length + "개를 포함했습니다." : "")
      + (generated.warning ? " (" + generated.warning + ")" : ""))];
  }
  job.result.timings["step" + step] = Date.now() - started;
  setCheckpoint(job, step, updates);
  return { job: serializeResearchJob(getJob(job.id) ?? job), status: 200 };
}
