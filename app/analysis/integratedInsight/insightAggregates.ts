// 통합 인사이트 태그 집계 유틸 — InsightDbTab · KeywordTrendTab이 공유하는 순수 로직.
// (원본: NSTK lib/aggregate.ts 이식분을 InsightDbTab에서 추출)

import type { InsightItem, InsightSource } from "@/app/api/insight-db/route";
import { CANONICAL_TOPICS, CANONICAL_COMPANIES, CANONICAL_MACRO } from "@/lib/tagRules";

const canonicalTopicSet = new Set<string>(CANONICAL_TOPICS as readonly string[]);
const canonicalCompanySet = new Set<string>(CANONICAL_COMPANIES as readonly string[]);
const canonicalMacroSet = new Set<string>(CANONICAL_MACRO as readonly string[]);

export type TagRank = { name: string; count: number; latest: string };

/** 키워드 비교 차트 색 (dataviz validator 통과, 흰 배경 기준) — DB/실시간 뷰가 공유해 슬롯 색이 일치하게 함 */
export const KEYWORD_COLORS = ["#059669", "#2a78d6", "#eda100", "#e34948", "#4a3aa7"];

export function allTags(item: InsightItem): string[] {
  return [...item.companies, ...item.topics, ...item.macro];
}

export function topTags(items: InsightItem[], limit = 20): TagRank[] {
  const map = new Map<string, { count: number; latest: string }>();
  for (const it of items) {
    for (const tag of new Set(allTags(it))) {
      const rec = map.get(tag) ?? { count: 0, latest: "0000-00-00" };
      rec.count++;
      if (it.date > rec.latest) rec.latest = it.date;
      map.set(tag, rec);
    }
  }
  return [...map.entries()]
    .map(([name, v]) => ({ name, ...v }))
    .sort((a, b) => b.count - a.count || b.latest.localeCompare(a.latest) || a.name.localeCompare(b.name, "ko"))
    .slice(0, limit);
}

// ── 자산유형 분류 (개별종목 / 산업·테마 / 매크로·경제) ──────────────────────────
// 태그를 "출처(매체)"가 아니라 "무엇에 대한 자료인가"로 분류한다.
//  · stock  = 개별 종목 (기업 태그)
//  · theme  = 산업·테마 (2차전지·AI·조선 같은 섹터/모멘텀 키워드)
//  · macro  = 매크로·경제 (금리·환율·유가·CPI 등 top-down 지표)
export type TagType = "stock" | "theme" | "macro";

/** 매크로·경제 지표성 키워드 — 태그에 부분 포함되면 매크로로 우선 분류 (오탐 줄이려 모호어 제외) */
export const MACRO_KEYWORDS = [
  "금리", "기준금리", "국채", "채권", "회사채", "물가", "인플레이션", "인플레", "디플레이션", "디플레", "스태그플레이션",
  "cpi", "ppi", "pce", "통화량", "유동성", "환율", "원달러", "원/달러", "달러", "엔화", "위안화", "위안", "유로화",
  "유가", "원유", "wti", "브렌트", "브렌트유", "국제유가", "천연가스", "금값", "은값", "구리", "니켈", "리튬", "원자재", "곡물",
  "연준", "연방준비", "fomc", "파월", "한국은행", "한은", "ecb", "boj", "기축통화",
  "gdp", "경기침체", "리세션", "경착륙", "연착륙", "실업률", "고용", "고용지표", "비농업",
  "무역", "무역수지", "경상수지", "관세", "무역분쟁", "지정학",
  "양적긴축", "양적완화", "테이퍼링", "긴축", "소매판매", "pmi", "ism", "생산", "산업생산", "부동산", "소비",
];

export function isMacroTag(tag: string): boolean {
  const t = tag.toLowerCase();
  return MACRO_KEYWORDS.some((k) => t.includes(k));
}

/**
 * 태그를 자산유형으로 분류. lib/tagRules.ts의 CANONICAL_TOPICS/COMPANIES/MACRO를
 * "정답지"로 우선 신뢰해 인사이트 탭 통계가 실제 태깅 기준과 항상 일치하도록 한다.
 *  1. CANONICAL_MACRO에 있으면 → macro (저장된 macro 배열도 함께 확인 — 정규화 이전 레거시 데이터 대비)
 *  2. CANONICAL_COMPANIES에 있으면 → stock, CANONICAL_TOPICS에 있으면 → theme
 *  3. 셋 다 아닌 자유입력 태그는 기업/토픽 어느 배열에 더 자주 등장했는지로 추정
 */
export function buildClassifyMap(items: InsightItem[]): Map<string, TagType> {
  const company = new Map<string, number>();
  const topic = new Map<string, number>();
  const macro = new Map<string, number>();
  for (const it of items) {
    for (const t of new Set(it.companies)) company.set(t, (company.get(t) ?? 0) + 1);
    for (const t of new Set(it.topics)) topic.set(t, (topic.get(t) ?? 0) + 1);
    for (const t of new Set(it.macro)) macro.set(t, (macro.get(t) ?? 0) + 1);
  }
  const map = new Map<string, TagType>();
  for (const t of new Set([...company.keys(), ...topic.keys(), ...macro.keys()])) {
    if (canonicalMacroSet.has(t) || macro.has(t)) { map.set(t, "macro"); continue; }
    if (canonicalCompanySet.has(t)) { map.set(t, "stock"); continue; }
    if (canonicalTopicSet.has(t)) { map.set(t, "theme"); continue; }
    map.set(t, (company.get(t) ?? 0) >= (topic.get(t) ?? 0) ? "stock" : "theme");
  }
  return map;
}

// ── 동시출현 / 시간축 균형 샘플링 (InsightDbTab · 새 AI 리서치 데스크가 공유) ─────

/** 앵커 태그(복수 가능 — 전부 포함한 항목 기준)와 같은 항목에 등장한 태그 (동시출현) */
export function coOccurrence(items: InsightItem[], anchors: string[], limit = 10): TagRank[] {
  const containing = items.filter((it) => anchors.every((a) => allTags(it).includes(a)));
  const map = new Map<string, { count: number; latest: string }>();
  for (const it of containing) {
    for (const tag of new Set(allTags(it))) {
      if (anchors.includes(tag)) continue;
      const rec = map.get(tag) ?? { count: 0, latest: "0000-00-00" };
      rec.count++;
      if (it.date > rec.latest) rec.latest = it.date;
      map.set(tag, rec);
    }
  }
  return [...map.entries()]
    .map(([name, v]) => ({ name, ...v }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}

/**
 * 시간축 계층 샘플링: 최근 N건(소스별 최대 M건 균형) + 나머지 기간 균등 샘플 P건, 날짜 오름차순.
 * 최신순으로만 자르면 게시 빈도가 높은 소스가 독식하고 과거 자료가 통째로 잘리는 문제를 방지한다.
 */
export function sampleTimeBalanced(
  items: InsightItem[],
  opts?: { recentCount?: number; perSourceCap?: number; pastCount?: number }
): InsightItem[] {
  const recentCount = opts?.recentCount ?? 12;
  const perSourceCap = opts?.perSourceCap ?? 4;
  const pastCount = opts?.pastCount ?? 28;

  const sorted = [...items].sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  const recent: InsightItem[] = [];
  const perSource = new Map<InsightSource, number>();
  for (const it of sorted) {
    if (recent.length >= recentCount) break;
    const n = perSource.get(it.source) ?? 0;
    if (n >= perSourceCap) continue;
    recent.push(it);
    perSource.set(it.source, n + 1);
  }
  const recentSet = new Set(recent);
  const rest = sorted.filter((it) => !recentSet.has(it));
  const past = rest.length <= pastCount
    ? rest
    : Array.from({ length: pastCount }, (_, i) => rest[Math.round((i * (rest.length - 1)) / (pastCount - 1))]);
  return [...recent, ...past].sort((a, b) => (a.date || "").localeCompare(b.date || ""));
}


