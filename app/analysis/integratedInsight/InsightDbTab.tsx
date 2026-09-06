"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useCustomerContext } from "../../maintab/CustomerContext";
import { useBackgroundEngine } from "./BackgroundEngineContext";
import { createPortal } from "react-dom";
import {
  forceCollide, forceLink, forceManyBody, forceSimulation, forceX, forceY,
  type SimulationLinkDatum, type SimulationNodeDatum,
} from "d3-force";
import {
  Building2, Database, ExternalLink, FileText, Flame, Globe, LayoutDashboard, Lightbulb, Link2, Loader2,
  MessageSquare, Newspaper, Printer, RefreshCw, Scale, Search, Share2, Sparkles, Tags, TrendingDown, TrendingUp, X,
} from "lucide-react";
import type { InsightItem, InsightSource } from "@/app/api/insight-db/route";
import type { DebateLogRow, DebateResult } from "@/app/api/insight-debate/route";
import { allTags, buildClassifyMap, coOccurrence, topTags, type TagRank, type TagType } from "./insightAggregates";
import KeywordTrendView from "./KeywordTrendView";
import { TagEditSection, recordAiUsage, type AiModelId } from "./shared";
import type { DatabaseId as UnifiedDatabaseId, SourceRef, ResearchStage, UnifiedResearchResult, EvidenceCard } from "@/Engine/Research-Engine/types";
import type { Job as UnifiedJob } from "@/Engine/Research-Engine/jobStore";
import { BriefingReportViewer } from "@/components/BriefingReportViewer";

/**
 * 통합 인사이트 — TAB4 3개 DB(텔레그램·뉴스·리포트) 저장 데이터를
 * 한 화면에서 포괄 조회·분석한다.
 *
 * NSTK Trend Research Platform(github.com/Gyeongyeon918)에서 이식한 구조:
 *  - 태그 워드클라우드 (spiral 배치 알고리즘) + 클릭 필터 토글
 *  - 소스별 누적/주간 통계 카드
 *  - 급상승 시그널 (최근 7일 신규·급증 태그)
 *  - 동시출현(co-occurrence) 연관 태그
 *  - 태그 네트워크 (KeywordGraph — d3-force 실시간 시뮬레이션)
 *  - 선택 키워드 AI 인사이트 (Gemini) + 전체 자료 기반 종합 보고서
 *  - 통합 데이터 피드 + 상세 모달
 */

// ── 소스 메타 ────────────────────────────────────────────────────────────────
const SOURCE_META: Record<InsightSource, { label: string; icon: React.ReactNode; chip: string }> = {
  telegram: { label: "텔레그램", icon: <MessageSquare size={13} />, chip: "bg-sky-50 text-sky-600 border-sky-200" },
  news: { label: "뉴스", icon: <Newspaper size={13} />, chip: "bg-blue-50 text-blue-700 border-blue-200" },
  report: { label: "리포트", icon: <Database size={13} />, chip: "bg-purple-50 text-purple-700 border-purple-200" },
};
const ALL_SOURCES = Object.keys(SOURCE_META) as InsightSource[];
// 별도 DB 탭 없이도 기존에 저장한 모든 출처의 자료를 기본 분석 대상으로 포함한다.
const DEFAULT_SOURCES: InsightSource[] = [...ALL_SOURCES];

const ALL_UNIFIED_DBS: UnifiedDatabaseId[] = [
  "telegram",
  "news",
  "report",
  "technical",
  "options",
  "holdings",
  "dart",
  "financials",
  "correlation",
  "peer",
  "fred",
  "ecos",
  "kosis",
];

/** 매크로 키워드 전용 데이터 소스 (TAB6 Research-Engine tab6Def 등록분).
 *  AV·Finnhub 라이브 검색은 제외 — macroCollect 크론이 같은 소스를 이미 뉴스 매크로 캐시에
 *  한글 태깅과 함께 적재하므로 news DB와 완전 중복이고, 한글 키워드는 영어 헤드라인
 *  텍스트 매칭에 실패해 사실상 항상 스킵되던 죽은 노드였다. */
const MACRO_SOURCE_DBS: UnifiedDatabaseId[] = ["fred", "ecos", "kosis"];

const UNIFIED_DB_LABEL: Record<UnifiedDatabaseId, string> = {
  telegram: "텔레그램 채널",
  news: "뉴스 기사",
  report: "리포트/보고서",
  technical: "기술적 지표",
  options: "옵션 시장 분석",
  holdings: "수급 동향",
  dart: "DART 기업 공시",
  financials: "재무제표 정량분석",
  alphavantage: "Alpha Vantage 해외뉴스",
  finnhub: "Finnhub 해외뉴스",
  fred: "미국연준 (FRED)",
  ecos: "한국은행 (ECOS)",
  kosis: "통계청 KOSIS",
  correlation: "상관관계 분석",
  peer: "경쟁사 분석",
};

/** 파이프라인 DB 노드용 축약 라벨 — 노드 폭이 좁아 2~4자로 줄인다 */
const UNIFIED_DB_SHORT: Record<UnifiedDatabaseId, string> = {
  telegram: "텔레그램",
  news: "뉴스",
  report: "리포트",
  technical: "기술지표",
  options: "옵션",
  holdings: "수급",
  dart: "DART",
  financials: "재무",
  alphavantage: "AV뉴스",
  finnhub: "FH뉴스",
  fred: "미국연준",
  ecos: "한국은행",
  kosis: "KOSIS",
  correlation: "상관관계",
  peer: "경쟁사",
};

/** 파이프라인 노드 클릭 → 상세 팝업 대상. 노드 종류마다 팝업 내용이 다르다 */
type PipelineDetail =
  | { kind: "db"; dbId: UnifiedDatabaseId }                    // STEP1 — DB별 결론·참고 자료
  | { kind: "analysis"; which: "tag" | "time" | "trend" }      // STEP2 — 분석별 결론
  | { kind: "detection" }                                      // STEP3 — 통합 결론 + 충돌·공백·신선도 감지
  | { kind: "remedy"; which: "debate" | "live" }                // STEP4 — 에러 원인 + 해결 과정 (방식별 상이)
  | { kind: "output" };                                        // STEP5 — 보고서 / 데이터 수치화

const UNIFIED_DB_GROUPS = [
  {
    label: "인사이트 피드 데이터베이스",
    ids: ["telegram", "news", "report"] as UnifiedDatabaseId[],
  },
  {
    label: "종목/재무 정보 분석 툴",
    ids: ["technical", "options", "holdings", "dart", "financials"] as UnifiedDatabaseId[],
  },
];

const splitIntoSentences = (text: string): string[] => {
  if (!text) return [];
  return text.split(/(?<=[.!?])\s+/).filter(Boolean);
};

const loadStoredUnifiedJobId = (keyword: string): string | null => {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(`unified_job_id_${keyword}`);
};

const storeUnifiedJobId = (keyword: string, jobId: string) => {
  if (typeof window === "undefined") return;
  try { localStorage.setItem(`unified_job_id_${keyword}`, jobId); } catch { }
};

const removeStoredUnifiedJobId = (keyword: string) => {
  if (typeof window === "undefined") return;
  localStorage.removeItem(`unified_job_id_${keyword}`);
};

// 새 키워드로 통합 리서치를 시작할 때 이전 키워드들의 잡ID를 모두 정리한다
// (키워드별로 영구 누적돼 스토리지 용량을 잡아먹는 것을 방지 — 현재 진행 중인 것만 남긴다).
const clearOtherStoredUnifiedJobIds = () => {
  if (typeof window === "undefined") return;
  try {
    Object.keys(localStorage)
      .filter((k) => k.startsWith("unified_job_id_"))
      .forEach((k) => localStorage.removeItem(k));
  } catch { }
};

// ── 태그 클라우드 기간 필터 ────────────────────────────────────────────────────
type CloudPeriod = "1d" | "1w" | "1m" | "1y" | "all";
const CLOUD_PERIODS: { key: CloudPeriod; label: string; days: number | null }[] = [
  { key: "1d", label: "1D", days: 1 },
  { key: "1w", label: "1W", days: 7 },
  { key: "1m", label: "1M", days: 30 },
  { key: "1y", label: "1Y", days: 365 },
  { key: "all", label: "전체", days: null },
];

// 자산유형 메타 (라벨·아이콘·칩 색) — 종목은 뉴트럴, 테마는 브랜드 그린, 매크로는 앰버
const ASSET_META: Record<TagType, { label: string; icon: React.ReactNode; chip: string; dot: string }> = {
  stock: { label: "개별종목", icon: <Building2 size={13} />, chip: "border-[#DDE8E5] bg-[#F6FAF8] text-[#33493F]", dot: "#5F7A70" },
  theme: { label: "산업·테마", icon: <Tags size={13} />, chip: "border-emerald-200 bg-emerald-50 text-emerald-700", dot: "#059669" },
  macro: { label: "매크로·경제", icon: <Globe size={13} />, chip: "border-amber-200 bg-amber-50 text-amber-700", dot: "#D97706" },
};
const ASSET_TYPES: TagType[] = ["stock", "theme", "macro"];

/** 최근 7일 신규 등장 or 급증 태그 (NSTK EarlySignal 이식) */
type RisingTag = { name: string; recentCount: number; pastCount: number; isNew: boolean };

function risingTags(items: InsightItem[], limit = 6): RisingTag[] {
  const cutoff = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString().slice(0, 10);
  const recent = new Map<string, number>();
  const past = new Map<string, number>();
  for (const it of items) {
    const bucket = (it.createdAt || it.date).slice(0, 10) >= cutoff ? recent : past;
    for (const tag of new Set(allTags(it))) bucket.set(tag, (bucket.get(tag) ?? 0) + 1);
  }
  return [...recent.entries()]
    .map(([name, recentCount]) => ({
      name, recentCount,
      pastCount: past.get(name) ?? 0,
      isNew: !past.has(name),
    }))
    .sort((a, b) => {
      const growthA = a.recentCount / Math.max(1, a.pastCount);
      const growthB = b.recentCount / Math.max(1, b.pastCount);
      return (Number(b.isNew) - Number(a.isNew)) || growthB - growthA || b.recentCount - a.recentCount;
    })
    .slice(0, limit);
}

// ── 워드클라우드 (NSTK WordCloud spiral 배치 이식 · 그린 팔레트) ──────────────
type CloudItem = TagRank & { x: number; y: number; fs: number; color: string; w: number; h: number; fw: string };

const CHAR_W_RATIO = 0.95;

function cloudLayout(data: TagRank[], vw: number, vh: number, pinnedTag?: string): CloudItem[] {
  if (!data.length || vw <= 0 || vh <= 0) return [];
  // pinnedTag를 첫 번째로 이동 (중앙 배치)
  let arranged = data;
  if (pinnedTag) {
    const idx = data.findIndex((d) => d.name === pinnedTag);
    if (idx > 0) arranged = [data[idx], ...data.slice(0, idx), ...data.slice(idx + 1)];
    else if (idx === -1) arranged = [{ name: pinnedTag, count: Math.max(1, (data[0]?.count ?? 1)), latest: "" }, ...data];
  }
  for (let fontFactor = 1.0; fontFactor >= 0.4; fontFactor -= 0.05) {
    const result = attemptLayout(arranged, vw, vh, fontFactor, pinnedTag);
    if (result.length === arranged.length) return result;
  }
  return attemptLayout(arranged, vw, vh, 0.4, pinnedTag);
}

function attemptLayout(data: TagRank[], vw: number, vh: number, fontFactor: number, pinnedTag?: string): CloudItem[] {
  const items: CloudItem[] = [];
  const scale = Math.min(vw / 900, vh / 380);
  const centerX = vw / 2, centerY = vh / 2;
  const padX = 24, padY = 18;
  const maxWidth = vw - padX * 2;

  const ranks = data.map((item) => 1 + data.filter((o) => o.count > item.count).length);

  const rawSize = (idx: number) => (idx < 3 ? 76 - idx * 12 : idx < 10 ? 40 - (idx - 3) * 2.5 : 20);
  const styleOf = (rank: number, isPinned?: boolean) =>
    isPinned ? { color: "#005B52", fw: "900" as const }
      : rank <= 3 ? { color: "#005B52", fw: "900" as const }
        : rank <= 10 ? { color: "#3E7A6E", fw: "700" as const }
          : { color: "#A8C5C0", fw: "500" as const };

  const overlaps = (lx: number, ty: number, w: number, h: number, fs: number) => {
    const m = Math.max(2, fs * 0.05);
    return items.some((o) =>
      lx < o.x + o.w / 2 + m && lx + w > o.x - o.w / 2 - m &&
      ty < o.y + o.h / 2 + m && ty + h > o.y - o.h / 2 - m,
    );
  };
  const inBounds = (cx: number, cy: number, w: number, h: number) =>
    cx - w / 2 >= padX && cx + w / 2 <= vw - padX && cy - h / 2 >= padY && cy + h / 2 <= vh - padY;

  data.forEach((item, index) => {
    const isPinned = pinnedTag !== undefined && item.name === pinnedTag;
    let fs = Math.round((isPinned ? rawSize(0) : rawSize(index)) * scale * fontFactor);
    const estW0 = item.name.length * fs * CHAR_W_RATIO;
    if (estW0 > maxWidth) fs = Math.max(10, Math.floor(maxWidth / (item.name.length * CHAR_W_RATIO)));
    const estW = item.name.length * fs * CHAR_W_RATIO;
    const estH = fs * 1.2;
    const style = styleOf(ranks[index], isPinned);

    let placed = false;
    let angle = 0, radius = index === 0 ? 0 : 30 * scale;
    while (!placed && radius < 2000 * scale) {
      const cx = centerX + radius * Math.cos(angle) * 1.55;
      const cy = centerY + radius * Math.sin(angle) * 0.8;
      if (inBounds(cx, cy, estW, estH) && !overlaps(cx - estW / 2, cy - estH / 2, estW, estH, fs)) {
        items.push({ ...item, x: cx, y: cy, fs, color: style.color, w: estW, h: estH, fw: style.fw });
        placed = true;
      }
      angle += 0.22;
      radius += 1.2 * scale;
    }
  });
  return items;
}

function TagCloud({ tags, activeTags, onTagClick, pinnedTag }: { tags: TagRank[]; activeTags: string[]; onTagClick: (t: string, additive: boolean) => void; pinnedTag?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [dims, setDims] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect;
      if (width > 0 && height > 0) {
        const roundedW = Math.round(width / 20) * 20;
        const roundedH = Math.round(height / 20) * 20;
        setDims((prev) => {
          if (prev.w === roundedW && prev.h === roundedH) return prev;
          return { w: roundedW, h: roundedH };
        });
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const layout = useMemo(() => cloudLayout(tags, dims.w, dims.h, pinnedTag), [tags, dims, pinnedTag]);

  return (
    <div ref={ref} className="relative h-64 w-full">
      {tags.length === 0 ? (
        <p className="flex h-full items-center justify-center text-sm font-bold text-[#B9CCC4]">저장된 태그가 없습니다</p>
      ) : (
        <svg className="absolute inset-0 h-full w-full" viewBox={`0 0 ${dims.w} ${dims.h}`} preserveAspectRatio="none">
          {layout.map((item, i) => (
            <g key={`${item.name}-${i}`} transform={`translate(${item.x}, ${item.y})`}
              onClick={(e) => onTagClick(item.name, e.ctrlKey || e.metaKey)} className="cursor-pointer transition-opacity hover:opacity-60">
              <text textAnchor="middle" alignmentBaseline="middle"
                style={{
                  fontSize: `${item.fs}px`,
                  fill: activeTags.includes(item.name) ? BRAND_ORANGE : item.color,
                  fontWeight: item.fw as never,
                  fontFamily: "Pretendard, sans-serif",
                  textDecoration: activeTags.includes(item.name) ? "underline" : "none",
                }}>
                {item.name}
              </text>
            </g>
          ))}
        </svg>
      )}
    </div>
  );
}

// ── 태그 네트워크 그래프 (NSTK KeywordGraph 이식 — d3-force 실시간 시뮬레이션) ─
type EdgeType = "new" | "consistent" | "fading";

interface SimNode extends SimulationNodeDatum {
  id: string;
  count: number;
  kwType: EdgeType;
}
interface SimLink extends SimulationLinkDatum<SimNode> {
  weight: number;
  type: EdgeType;
}
type ResolvedLink = { source: SimNode; target: SimNode; weight: number; type: EdgeType };

const MAX_CO_NODES = 40;
const RECENT_DAYS = 91;

// 브랜드 컬러 기반 — Primary Green(#53682B) 그라데이션 + 신규는 Primary Orange(#E98300)로 대비
const BRAND_ORANGE = "#E98300";
const GREEN_DARK = "#2E3A16";  // 선택 키워드 (가장 진함)
const GREEN_MAIN = "#53682B";  // 꾸준히 언급
const GREEN_PALE = "#C6CFAC";  // 최근 언급 없음 (가장 연함)
const NODE_COLOR: Record<EdgeType, string> = {
  new: BRAND_ORANGE, // 최근 3개월 내 최초 등장
  consistent: GREEN_MAIN,   // 꾸준히 언급
  fading: GREEN_PALE,   // 최근 3개월 언급 없음
};
const NODE_TEXT: Record<EdgeType, string> = {
  new: "#FFFFFF",
  consistent: "#FFFFFF",
  fading: GREEN_MAIN,
};
const LINK_COLOR: Record<EdgeType, string> = {
  new: BRAND_ORANGE,
  consistent: "#7B9142",
  fading: "#CBD2B9",
};
const ANCHOR_FILL = GREEN_DARK;

function nodeRadius(count: number, maxCount: number) {
  const t = maxCount > 1 ? (count - 1) / (maxCount - 1) : 0;
  return 14 + Math.sqrt(t) * 22;
}

type TagDoc = { date: string; keywords: string[] };

function TagNetwork({ items, anchorTags, onTagClick, typeFilter, classifyMap }: {
  items: InsightItem[]; anchorTags: string[]; onTagClick: (t: string, additive: boolean) => void;
  typeFilter: "all" | TagType; classifyMap: Map<string, TagType>;
}) {
  const docs = useMemo<TagDoc[]>(
    () => items
      .map((it) => {
        const keys = [...new Set(allTags(it))];
        return {
          date: it.date,
          keywords: typeFilter === "all" ? keys : keys.filter((k) => classifyMap.get(k) === typeFilter),
        };
      })
      .filter((d) => d.keywords.length > 0),
    [items, typeFilter, classifyMap],
  );
  // 유형 필터에 걸러져 데이터에 없는 앵커는 제외
  const anchors = useMemo(
    () => anchorTags.filter((a) => docs.some((d) => d.keywords.includes(a))),
    [anchorTags, docs],
  );
  // 복수 선택인데 모든 키워드가 함께 등장한 자료가 없는 경우 (안내 문구용)
  const noOverlap = useMemo(
    () => anchors.length > 1 && !docs.some((d) => anchors.every((a) => d.keywords.includes(a))),
    [anchors, docs],
  );

  const nodesRef = useRef<SimNode[]>([]);
  const linksRef = useRef<ResolvedLink[]>([]);
  const simRef = useRef<ReturnType<typeof forceSimulation<SimNode>> | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [, setTick] = useState(0);
  const [hovered, setHovered] = useState<string | null>(null);
  // 실제 SVG 픽셀 크기 — ResizeObserver 로 측정
  const [svgW, setSvgW] = useState(860);
  const [svgH, setSvgH] = useState(600);

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const ro = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect;
      if (width > 50 && height > 50) {
        const roundedW = Math.round(width / 20) * 20;
        const roundedH = Math.round(height / 20) * 20;
        setSvgW((prev) => (prev === roundedW ? prev : roundedW));
        setSvgH((prev) => (prev === roundedH ? prev : roundedH));
      }
    });
    ro.observe(svg);
    return () => ro.disconnect();
  }, []);

  // 시뮬레이션
  useEffect(() => {
    if (!docs.length || svgW < 50 || svgH < 50) return;

    const W = svgW;
    const H = svgH;

    // yyyy-mm-dd 형식이 아닌 날짜(빈 값·비정상 포맷)는 기준일 계산에서 제외 — Invalid Date 방지
    const validDates = docs.map((d) => d.date).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort();
    const latest = validDates[validDates.length - 1];
    let latestMs = latest ? new Date(latest + "T00:00:00").getTime() : Date.now();
    if (Number.isNaN(latestMs)) latestMs = Date.now();
    const cutoffStr = new Date(latestMs - RECENT_DAYS * 24 * 3600 * 1000).toISOString().slice(0, 10);

    // 전체 키워드 집계
    const kwCount = new Map<string, number>();
    for (const d of docs) for (const k of d.keywords) kwCount.set(k, (kwCount.get(k) ?? 0) + 1);

    let topKws: string[];
    let simLinks: SimLink[];
    const kwTypeMap = new Map<string, EdgeType>();

    if (!anchors.length) {
      // ── 키워드 미선택: 상위 키워드(초록/회색) + 3개월 내 신규(주황) ──
      const beforeKw = new Map<string, number>();
      const recentKw = new Map<string, number>();
      const recentKwDate = new Map<string, string>();
      for (const d of docs) {
        const isRecent = d.date >= cutoffStr;
        for (const k of d.keywords) {
          if (isRecent) {
            recentKw.set(k, (recentKw.get(k) ?? 0) + 1);
            if (!recentKwDate.has(k) || d.date > recentKwDate.get(k)!) recentKwDate.set(k, d.date);
          } else {
            beforeKw.set(k, (beforeKw.get(k) ?? 0) + 1);
          }
        }
      }

      const totalByKw = new Map<string, number>();
      for (const [k, v] of beforeKw) totalByKw.set(k, (totalByKw.get(k) ?? 0) + v);
      for (const [k, v] of recentKw) totalByKw.set(k, (totalByKw.get(k) ?? 0) + v);

      // 데이터 수에 따라 임계값 동적 조정
      const minCount = docs.length >= 150 ? 3 : 2;

      const top40 = [...totalByKw.entries()]
        .filter(([, v]) => v >= minCount)
        .sort((a, b) => b[1] - a[1])
        .slice(0, MAX_CO_NODES)
        .map(([k]) => k);
      const top40Set = new Set(top40);

      for (const k of top40) {
        kwTypeMap.set(k, (recentKw.get(k) ?? 0) > 0 ? "consistent" : "fading");
      }

      // 신규 키워드: 과거 등장 이력이 없는 최근 3개월 키워드 (최신순)
      const orangeBase = [...recentKw.entries()]
        .filter(([k]) => !(beforeKw.get(k) ?? 0) && !top40Set.has(k))
        .sort((a, b) => b[1] - a[1] || (recentKwDate.get(b[0]) ?? "").localeCompare(recentKwDate.get(a[0]) ?? ""));
      const orangeNew = (docs.length >= 150
        ? orangeBase.filter(([, v]) => v >= 2)
        : orangeBase.slice(0, Math.max(3, Math.round(top40.length * 0.15)))
      ).slice(0, 20).map(([k]) => k);
      for (const k of orangeNew) kwTypeMap.set(k, "new");

      topKws = [...top40, ...orangeNew];

      const nodeSet = new Set(topKws);
      const beforeMap = new Map<string, number>();
      const recentMap = new Map<string, number>();
      for (const d of docs) {
        const kws = d.keywords.filter((k) => nodeSet.has(k));
        const isRecent = d.date >= cutoffStr;
        for (let i = 0; i < kws.length; i++) {
          for (let j = i + 1; j < kws.length; j++) {
            const key = [kws[i], kws[j]].sort().join("\0");
            if (isRecent) recentMap.set(key, (recentMap.get(key) ?? 0) + 1);
            else beforeMap.set(key, (beforeMap.get(key) ?? 0) + 1);
          }
        }
      }
      simLinks = [];
      for (const key of new Set([...beforeMap.keys(), ...recentMap.keys()])) {
        const [a, bStr] = key.split("\0");
        const b = beforeMap.get(key) ?? 0;
        const r = recentMap.get(key) ?? 0;
        const isNew = kwTypeMap.get(a) === "new" || kwTypeMap.get(bStr) === "new";
        if (b + r < 2 && !isNew) continue; // weight=1 노이즈 제거 (신규 키워드 예외)
        const type: EdgeType = r > 0 && b === 0 ? "new" : r > 0 ? "consistent" : "fading";
        simLinks.push({ source: a as unknown as SimNode, target: bStr as unknown as SimNode, weight: b + r, type });
      }

      // 엣지 없는 고립 노드 제거 (신규 키워드는 고립이어도 유지)
      const connectedKws = new Set<string>();
      for (const l of simLinks) {
        connectedKws.add(l.source as unknown as string);
        connectedKws.add(l.target as unknown as string);
      }
      topKws = topKws.filter((k) => connectedKws.has(k) || kwTypeMap.get(k) === "new");

    } else {
      // ── 키워드 선택(복수 가능): 모든 앵커와 함께 등장한 연관어 최대 40개 ──
      const anchorKwSet = new Set(anchors);
      const containing = docs.filter((d) => anchors.every((a) => d.keywords.includes(a)));
      const beforeCo = new Map<string, number>();
      const recentCo = new Map<string, number>();
      const recentCoDate = new Map<string, string>();
      for (const d of containing) {
        const isRecent = d.date >= cutoffStr;
        for (const k of d.keywords) {
          if (anchorKwSet.has(k)) continue;
          if (isRecent) {
            recentCo.set(k, (recentCo.get(k) ?? 0) + 1);
            if (!recentCoDate.has(k) || d.date > recentCoDate.get(k)!) recentCoDate.set(k, d.date);
          } else {
            beforeCo.set(k, (beforeCo.get(k) ?? 0) + 1);
          }
        }
      }

      const allCo = new Map<string, number>();
      for (const [k, v] of beforeCo) allCo.set(k, (allCo.get(k) ?? 0) + v);
      for (const [k, v] of recentCo) allCo.set(k, (allCo.get(k) ?? 0) + v);

      const top40 = [...allCo.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, MAX_CO_NODES)
        .map(([k]) => k);

      const top40Set = new Set(top40);
      // 신규 연관어: 최신 등장일 내림차순, 상위 20개
      const newKws = [...recentCo.entries()]
        .filter(([k]) => !(beforeCo.get(k) ?? 0) && !top40Set.has(k))
        .sort((a, b) => (recentCoDate.get(b[0]) ?? "").localeCompare(recentCoDate.get(a[0]) ?? ""))
        .slice(0, 20)
        .map(([k]) => k);

      const coKws = [...top40, ...newKws];
      const coSet = new Set(coKws);
      topKws = [...anchors, ...coKws];

      for (const a of anchors) kwTypeMap.set(a, "consistent");
      for (const k of coKws) {
        const b = beforeCo.get(k) ?? 0;
        const r = recentCo.get(k) ?? 0;
        kwTypeMap.set(k, b === 0 && r > 0 ? "new" : r > 0 ? "consistent" : "fading");
      }

      const anchorLinks: SimLink[] = [];
      // 앵커끼리 연결 (함께 등장한 자료 수를 굵기로)
      if (containing.length) {
        for (let i = 0; i < anchors.length; i++) {
          for (let j = i + 1; j < anchors.length; j++) {
            anchorLinks.push({
              source: anchors[i] as unknown as SimNode, target: anchors[j] as unknown as SimNode,
              weight: containing.length, type: "consistent",
            });
          }
        }
      }
      // 각 앵커 → 연관어 연결
      for (const a of anchors) {
        for (const k of coKws) {
          const b = beforeCo.get(k) ?? 0;
          const r = recentCo.get(k) ?? 0;
          const type: EdgeType = b === 0 && r > 0 ? "new" : r > 0 ? "consistent" : "fading";
          anchorLinks.push({ source: a as unknown as SimNode, target: k as unknown as SimNode, weight: b + r, type });
        }
      }

      const nodeBefore = new Map<string, number>();
      const nodeRecent = new Map<string, number>();
      for (const d of docs) {
        const kws = d.keywords.filter((k) => coSet.has(k));
        const isRecent = d.date >= cutoffStr;
        for (let i = 0; i < kws.length; i++) {
          for (let j = i + 1; j < kws.length; j++) {
            const key = [kws[i], kws[j]].sort().join("\0");
            if (isRecent) nodeRecent.set(key, (nodeRecent.get(key) ?? 0) + 1);
            else nodeBefore.set(key, (nodeBefore.get(key) ?? 0) + 1);
          }
        }
      }
      const nodeLinks: SimLink[] = [];
      for (const key of new Set([...nodeBefore.keys(), ...nodeRecent.keys()])) {
        const b = nodeBefore.get(key) ?? 0;
        const r = nodeRecent.get(key) ?? 0;
        if (b + r < 2) continue; // weight=1 노이즈 링크 제거
        const [a, bStr] = key.split("\0");
        const type: EdgeType = b === 0 && r > 0 ? "new" : r > 0 ? "consistent" : "fading";
        nodeLinks.push({ source: a as unknown as SimNode, target: bStr as unknown as SimNode, weight: b + r, type });
      }

      simLinks = [...anchorLinks, ...nodeLinks];
    }

    // 초기 위치: 황금각 나선형으로 전체 영역 분산 (이전 위치가 있으면 유지)
    const simNodes: SimNode[] = topKws.map((id, i) => {
      const prev = nodesRef.current.find((n) => n.id === id);
      const angle = i * 2.399963;
      const spread = Math.sqrt(i / Math.max(topKws.length, 1)) * Math.min(W, H) * 0.32;
      return {
        id,
        count: kwCount.get(id) ?? 1,
        kwType: kwTypeMap.get(id) ?? "consistent",
        x: prev?.x ?? W / 2 + spread * Math.cos(angle),
        y: prev?.y ?? H / 2 + spread * Math.sin(angle),
      };
    });

    simRef.current?.stop();
    const maxCount = Math.max(...simNodes.map((n) => n.count));

    const sim = forceSimulation<SimNode>(simNodes)
      .alphaDecay(0.008)
      .velocityDecay(0.55)
      .force("link", forceLink<SimNode, SimLink>(simLinks)
        .id((d) => d.id)
        .distance((d) => {
          const l = d as SimLink;
          if (l.type === "fading") return Math.min(W, H) * 0.18;
          // weight=2: ~92px  weight=5: ~58px  weight=10: ~41px  weight=20: ~29px
          return Math.max(25, 130 / Math.sqrt(l.weight));
        })
        .strength((d) => {
          const l = d as SimLink;
          if (l.type === "fading") return 0.005;
          return Math.min(1.0, 0.2 + l.weight * 0.1);
        }))
      .force("charge", forceManyBody<SimNode>().strength(-250))
      .force("x", forceX(W / 2).strength(0.10))
      .force("y", forceY(H / 2).strength(0.10))
      .force("collide", forceCollide<SimNode>().radius((d) => nodeRadius(d.count, maxCount) + 20).iterations(20))
      .stop();

    if (anchors.length) {
      // 앵커가 복수면 중앙에서 가로로 나란히 고정
      const gap = Math.min(300, W * 0.24);
      anchors.forEach((a, i) => {
        const anchorNode = simNodes.find((n) => n.id === a);
        if (anchorNode) {
          anchorNode.fx = W / 2 + (i - (anchors.length - 1) / 2) * gap;
          anchorNode.fy = H / 2;
        }
      });
    }

    const clampNodes = () => {
      for (const node of sim.nodes()) {
        const r = nodeRadius(node.count, maxCount);
        const fontSize = Math.max(9, r * 0.42);
        const textHalf = Math.ceil(node.id.length * fontSize * 0.52);
        const padX = Math.max(r + 20, textHalf + 16);
        const padY = r + 20;
        node.x = Math.max(padX, Math.min(W - padX, node.x ?? W / 2));
        node.y = Math.max(padY, Math.min(H - padY, node.y ?? H / 2));
      }
    };
    const publish = () => {
      nodesRef.current = [...sim.nodes()];
      linksRef.current = sim
        .force<ReturnType<typeof forceLink<SimNode, SimLink>>>("link")!
        .links() as unknown as ResolvedLink[];
      setTick((t) => t + 1);
    };

    // 초기 안정화: 화면에 그리기 전에 수렴할 때까지 미리 계산 — 노드가 튀지 않음
    for (let i = 0; i < 400 && sim.alpha() > 0.03; i++) { sim.tick(); clampNodes(); }
    publish();

    // 이후엔 잔여 미세 조정만 잔잔하게 애니메이션
    sim.on("tick", () => { clampNodes(); publish(); });
    sim.alpha(0.08).alphaDecay(0.03).restart();

    simRef.current = sim;
    return () => { sim.stop(); };
  }, [docs, anchors, svgW, svgH]);

  const nodes = nodesRef.current;
  const links = linksRef.current;
  const maxCount = nodes.length ? Math.max(...nodes.map((n) => n.count)) : 1;

  // 앵커 기준 연결 노드 + 엣지 유형 (하이라이트/색상용)
  const anchorSet = new Set(anchors);
  const connectedSet = new Set<string>();
  const nodeEdgeType = new Map<string, EdgeType>();
  if (anchors.length) {
    for (const a of anchors) connectedSet.add(a);
    for (const l of links) {
      const sIsAnchor = anchorSet.has(l.source.id);
      const tIsAnchor = anchorSet.has(l.target.id);
      const other = sIsAnchor && !tIsAnchor ? l.target.id : tIsAnchor && !sIsAnchor ? l.source.id : null;
      if (other) {
        connectedSet.add(other);
        const prev = nodeEdgeType.get(other);
        if (!prev || (l.type === "new") || (l.type === "consistent" && prev === "fading")) {
          nodeEdgeType.set(other, l.type);
        }
      }
    }
  }

  const legendItems = anchors.length
    ? [
      { color: ANCHOR_FILL, label: "선택 키워드" },
      { color: NODE_COLOR.new, label: "최근 3개월 새 연결" },
      { color: NODE_COLOR.consistent, label: "꾸준한 연결" },
      { color: NODE_COLOR.fading, label: "과거엔 있었지만 최근 없는" },
    ]
    : [
      { color: NODE_COLOR.new, label: "3개월 내 최초 등장" },
      { color: NODE_COLOR.consistent, label: "꾸준히 언급" },
      { color: NODE_COLOR.fading, label: "최근 3개월 언급 없음" },
    ];

  if (!docs.length) {
    return <p className="flex h-full items-center justify-center text-sm font-bold text-[#B9CCC4]">태그 데이터가 없습니다</p>;
  }

  return (
    <div className="flex h-full w-full flex-col overflow-hidden">
      {/* viewBox 없이 실제 픽셀 좌표 사용 — 컨테이너를 픽셀 단위로 100% 채움 */}
      <svg ref={svgRef} width="100%" height="100%" className="block min-h-0 flex-1 overflow-hidden">
        {links.map((link, i) => {
          const s = link.source;
          const t = link.target;
          if (s.x == null || t.x == null) return null;
          // 앵커에 직접 연결된 선은 연결 유형 색으로 뚜렷하게, 나머지는 흐리게
          const isAnchorLink = anchors.length > 0 && (anchorSet.has(s.id) || anchorSet.has(t.id));
          return (
            <line
              key={i}
              x1={s.x} y1={s.y!} x2={t.x} y2={t.y!}
              stroke={isAnchorLink ? LINK_COLOR[link.type] : "#A9B78E"}
              strokeWidth={isAnchorLink ? 1.6 + Math.min(3, link.weight * 0.45) : 1 + Math.min(2, link.weight * 0.3)}
              strokeOpacity={isAnchorLink ? 0.85 : anchors.length ? 0.15 : link.weight <= 1 ? 0.30 : link.weight === 2 ? 0.45 : 0.65}
            />
          );
        })}

        {nodes.map((node) => {
          if (node.x == null) return null;
          const r = nodeRadius(node.count, maxCount);
          const isAnchor = anchorSet.has(node.id);
          const dimmed = anchors.length > 0 && !connectedSet.has(node.id);
          const isHov = hovered === node.id;
          const edgeType = nodeEdgeType.get(node.id);
          const colorType = anchors.length && edgeType ? edgeType : node.kwType;
          const fill = isAnchor ? ANCHOR_FILL : NODE_COLOR[colorType];
          const labelFill = isAnchor ? "#FFFFFF" : NODE_TEXT[colorType];
          const fontSize = Math.max(9, r * 0.42);
          return (
            <g
              key={node.id}
              transform={`translate(${node.x},${node.y!})`}
              onClick={(e) => onTagClick(node.id, e.ctrlKey || e.metaKey)}
              onMouseEnter={() => setHovered(node.id)}
              onMouseLeave={() => setHovered(null)}
              style={{ cursor: "pointer", opacity: dimmed ? 0.12 : 1, transition: "opacity 0.2s" }}
            >
              <circle
                r={isAnchor ? r * 0.84 : r}
                fill={fill}
                fillOpacity={isHov || isAnchor ? 1 : 0.9}
              />
              <text
                textAnchor="middle"
                dominantBaseline="central"
                fontSize={isAnchor ? fontSize + 1 : fontSize}
                fill={labelFill}
                fontWeight={700}
                stroke={isAnchor ? ANCHOR_FILL : "none"}
                strokeWidth={isAnchor ? 2.5 : 0}
                strokeLinejoin="round"
                style={{ pointerEvents: "none", paintOrder: "stroke fill", fontFamily: "Pretendard, sans-serif" }}
              >
                {node.id}
              </text>
              {isHov && !dimmed && (
                <text
                  y={r + 14}
                  textAnchor="middle"
                  fontSize={10}
                  fill={GREEN_MAIN}
                  fontWeight={600}
                  style={{ pointerEvents: "none", fontFamily: "Pretendard, sans-serif" }}
                >
                  {node.count}건
                </text>
              )}
            </g>
          );
        })}
      </svg>

      {noOverlap && (
        <p className="shrink-0 pb-1 text-center text-[11px] font-bold text-[#B85D19]">
          선택한 키워드들이 함께 등장한 자료가 없습니다 — 키워드 조합을 조정해 보세요
        </p>
      )}
      <div className="flex shrink-0 flex-wrap justify-center gap-4 pb-2">
        {legendItems.map(({ color, label }) => (
          <div key={label} className="flex items-center gap-1.5">
            <div className="h-3 w-3 shrink-0 rounded-full" style={{ background: color }} />
            <span className="text-[11px] font-bold text-[#5F7A70]">{label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── AI 인사이트 ──────────────────────────────────────────────────────────────
type AiInsight = { keyword: string; count: number; trend: string; implication: string; watch: string; timeline?: string; relation?: string };

// ── 키워드 종합 보고서 ────────────────────────────────────────────────────────
type KeywordReport = { keyword: string; count: number; from: string; to: string; markdown: string };

type MarkdownVariant = "report" | "summary";

/**
 * 마크다운(##·### 헤딩, **볼드**, - 목록, --- 구분선) → HTML.
 * variant="report": 키워드 종합 보고서(17px, 진한 헤딩 스타일) — 인쇄용 창(태그 셀렉터 CSS)에도 사용되므로 class는 장식용일 뿐 실제 스타일은 tag selector가 담당.
 * variant="summary": 자료 상세 모달의 AI 요약(17px, ---/spacer 지원)
 */
function renderMarkdown(md: string, variant: MarkdownVariant = "summary"): string {
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const bold = (s: string) => {
    let t = s.replace(/\*\*([^*]+)\*\*/g, variant === "report" ? '<strong class="font-black text-[#0D2318]">$1</strong>' : "<strong>$1</strong>");
    return t.replace(/(#\d+)/g, '<button type="button" class="citation-link mx-0.5 inline-flex items-center justify-center rounded bg-primary-100 px-1 text-[11px] font-black text-primary hover:bg-primary hover:text-white" data-citation="$1">$1</button>');
  };

  const out: string[] = [];
  for (const raw of md.split("\n")) {
    const line = variant === "report" ? esc(raw.trim()) : esc(raw);

    if (line.startsWith("## ")) {
      out.push(
        variant === "report"
          ? `<h2 class="mb-2 mt-5 border-l-4 border-primary pl-2.5 text-[18px] font-black text-primary first:mt-0">${bold(line.slice(3))}</h2>`
          : `<h3 class="font-bold text-[#005B52] text-[17px] mt-4 mb-1">${bold(line.slice(3))}</h3>`
      );
    } else if (line.startsWith("### ")) {
      out.push(
        variant === "report"
          ? `<h3 class="mb-1 mt-3 text-[17px] font-black text-[#0D2318]">${bold(line.slice(4))}</h3>`
          : `<h3 class="mb-1 mt-3 text-[13px] font-black text-[#0D2318]">${bold(line.slice(4))}</h3>`
      );
    } else if (variant === "summary" && line.startsWith("**") && line.endsWith("**") && line.length > 4) {
      out.push(`<p class="font-semibold text-[#33493F] text-[17px] mt-2">${line.slice(2, -2)}</p>`);
    } else if (line.startsWith("- ")) {
      out.push(
        variant === "report"
          ? `<li class="ml-4 list-disc text-[17px] font-semibold leading-relaxed text-[#33493F]">${bold(line.slice(2))}</li>`
          : `<li class="ml-4 text-[17px] text-[#33493F] list-disc">${bold(line.slice(2))}</li>`
      );
    } else if (variant === "summary" && line.trim() === "---") {
      out.push(`<hr class="border-[#DDE8E5] my-3" />`);
    } else if (line.trim() === "") {
      out.push(variant === "summary" ? `<div class="h-1"></div>` : "");
    } else {
      out.push(
        variant === "report"
          ? `<p class="mb-1.5 text-[17px] font-semibold leading-relaxed text-[#33493F]">${bold(line)}</p>`
          : `<p class="text-[17px] text-[#33493F]">${bold(line)}</p>`
      );
    }
  }
  return out.join(variant === "report" ? "" : "\n");
}

function MarkdownView({ text, className = "" }: { text: string; className?: string }) {
  return (
    <div
      className={className}
      dangerouslySetInnerHTML={{ __html: renderMarkdown(text, "summary") }}
    />
  );
}

// STEP5 최종 보고서 상세보기는 공용 BriefingReportViewer가 전담한다
// (문장별 [팩트]/[인용]/[판단] 태그 렌더링·출처 점프·종목 링크 포함 — components/BriefingReportViewer.tsx).

function formatInsightText(text: string): string {
  if (!text) return "";
  return text
    .split("\n")
    .map((paragraph) => {
      return paragraph
        .split(/(?<!\d)\.\s+/)
        .map((s) => s.trim())
        .filter(Boolean)
        .map((s) => (/[.!?]$/.test(s) ? s : s + "."))
        .join("\n");
    })
    .join("\n");
}

type DebateStage = "idle" | "opening" | "rebuttal" | "synthesis" | "done";

const DEBATE_STAGE_LABEL: Record<"opening" | "rebuttal" | "synthesis", string> = {
  opening: "① 강세/약세 논거 생성 중",
  rebuttal: "② 반박 중",
  synthesis: "③ 종합 판단 중",
};

function frameLabels(tagType: DebateResult["tagType"]) {
  return tagType === "macro"
    ? { bull: "우호적 영향", bear: "비우호적 영향" }
    : { bull: "강세 논거", bear: "약세 논거" };
}

// ── 메인 컴포넌트 ────────────────────────────────────────────────────────────
export default function InsightDbTab() {
  const router = useRouter();
  const { sharedUiState, updateSharedUiState } = useCustomerContext();
  const { researchJobs, refreshResearchJobs } = useBackgroundEngine();

  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);
  const [items, setItems] = useState<InsightItem[]>([]);
  const [sourceCounts, setSourceCounts] = useState<Record<InsightSource, number> | null>(null);
  const [skippedSources, setSkippedSources] = useState<InsightSource[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [sources, setSources] = useState<Set<InsightSource>>(new Set(DEFAULT_SOURCES));
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [activeTags, setActiveTags] = useState<string[]>([]);
  const [selected, setSelected] = useState<InsightItem | null>(null);
  const [insight, setInsight] = useState<AiInsight | null>(null);
  const [insightLoading, setInsightLoading] = useState(false);
  const [insightError, setInsightError] = useState("");
  const [view, setView] = useState<"dashboard" | "network" | "keyword">("dashboard");
  const [tagSearch, setTagSearch] = useState("");
  const [tagType, setTagType] = useState<"all" | TagType>("all");
  const [cloudPeriod, setCloudPeriod] = useState<CloudPeriod>("all");
  const [cloudTagSearch, setCloudTagSearch] = useState("");
  const [showCloudSuggestions, setShowCloudSuggestions] = useState(false);
  const [report, setReport] = useState<KeywordReport | null>(null);
  const [reportLoading, setReportLoading] = useState(false);
  const [reportError, setReportError] = useState("");
  const [showReport, setShowReport] = useState(false);

  // ── AI 찬반 토론 상태 ──────────────────────────────────────────────────────
  const [debateKeyword, setDebateKeyword] = useState("");
  const [debateStage, setDebateStage] = useState<DebateStage>("idle");
  const [debateResult, setDebateResult] = useState<DebateResult | null>(null);
  const [debateError, setDebateError] = useState("");
  const [debateHistory, setDebateHistory] = useState<DebateLogRow[]>([]);
  const [debateHistoryLoading, setDebateHistoryLoading] = useState(true);

  // ── 통합 리서치 엔진 상태 (단일 키워드) ───────────────────────────
  const [unifiedJobId, setUnifiedJobId] = useState<string | null>(null);
  const [unifiedJob, setUnifiedJob] = useState<UnifiedJob | null>(null);
  /** 모델별 사용량 동기화 기준점 — 잡이 바뀌면 리셋 */
  const lastUsageSyncRef = useRef<Record<string, number>>({});
  const [reportKind, setReportKind] = useState<"insight" | "unified">("insight");
  const [showDbModal, setShowDbModal] = useState(false);
  const [selectedDbs, setSelectedDbs] = useState<Set<UnifiedDatabaseId>>(new Set(ALL_UNIFIED_DBS));
  const [dbModalError, setDbModalError] = useState("");
  const [unifiedStarting, setUnifiedStarting] = useState(false);
  const unifiedStartingRef = useRef(false);
  const [approvalLoading, setApprovalLoading] = useState(false);
  const [approvalError, setApprovalError] = useState("");
  const [hasDebated, setHasDebated] = useState(false);
  const [hasSupplemented, setHasSupplemented] = useState(false);
  const [analysisMethod, setAnalysisMethod] = useState<"report" | "score">("report");
  // 모델 선택 UI는 제거됨 — 서버가 단계별 티어로 자동 배분한다
  // (STEP1 카드·토론 입론/반박·실시간 보강 = 경량 lite / 통합·감지·판정·보고서·점수 = 고성능 flash 계열)
  const [pipelineDetail, setPipelineDetail] = useState<PipelineDetail | null>(null); // 파이프라인 노드 클릭 팝업

  const getCardDateRange = (card: EvidenceCard, sources: SourceRef[]) => {
    if (!card.citedSources || card.citedSources.length === 0) {
      return card.asOfDate;
    }
    const dates = card.citedSources
      .map((id: string) => sources.find(s => s.id === id)?.date)
      .filter((d): d is string => !!d);

    if (dates.length === 0) {
      return card.asOfDate;
    }
    dates.sort();
    const earliest = dates[0];
    const latest = dates[dates.length - 1];
    if (earliest === latest) {
      return earliest;
    }
    return `${earliest} ~ ${latest}`;
  };

  const unifiedLoading = unifiedJob?.status === "running";
  const unifiedResult = unifiedJob?.result ?? null;
  const unifiedError = unifiedJob?.status === "error" ? unifiedJob.error ?? "통합 리서치 도중 오류가 발생했습니다." : "";

  const handleGoToTab2 = (database: string) => {
    const kwType = unifiedJob?.result?.keywordType ?? (activeTags.length === 1 ? classifyMap.get(activeTags[0]) : "stock");
    const keyword = unifiedJob?.request?.keyword ?? activeTags[0] ?? "선택 키워드";

    if (kwType === "theme") {
      const activeInnerTab = (database === "correlation" || database === "financials") ? "correlation" : "peer";

      updateSharedUiState({
        tab2: {
          ...sharedUiState.tab2,
          activeInnerTab,
          selectedTheme: keyword,
        },
      });

      setSelected(null);
      router.push("/maintab/tab2");
      return;
    }

    const ticker = unifiedJob?.request?.ticker;
    if (!ticker) return;

    const name = unifiedJob?.request?.corpName ?? unifiedJob?.request?.keyword ?? "선택 종목";
    const market = /^\d{6}$/.test(ticker) ? "domestic" as const : "overseas" as const;
    const stockItem = { code: ticker, name, ticker, market };

    let activeStockAnalysisTab = "overview";
    let activeInnerTab = "stock-analysis";

    if (database === "technical") {
      activeStockAnalysisTab = "technical";
    } else if (database === "options") {
      activeStockAnalysisTab = "options";
    } else if (database === "holdings") {
      activeStockAnalysisTab = "holdings";
    } else if (database === "dart") {
      activeStockAnalysisTab = "dart";
    } else if (database === "financials") {
      activeInnerTab = "finmodel";
    }

    updateSharedUiState({
      tab2: {
        ...sharedUiState.tab2,
        activeInnerTab,
        incomingSelectedStock: stockItem,
        selectedTheme: null,
        activeStockAnalysisTab,
      },
    });

    setSelected(null);
    router.push("/maintab/tab2");
  };

  const handleCitationClick = (ref: SourceRef) => {
    if (!ref) return;

    const found = items.find((it) => {
      if (it.url && ref.url && it.url === ref.url) return true;
      return it.title === ref.title;
    });

    if (found) {
      setSelected(found);
    } else {
      const getDbLabel = (db: string) => {
        const labels: Record<string, string> = {
          telegram: "텔레그램",
          news: "뉴스",
          report: "리포트",
          technical: "기술적 분석",
          options: "옵션 분석",
          holdings: "수급 분석",
          dart: "DART 공시",
          financials: "정량분석"
        };
        return labels[db] ?? db;
      };

      const sourceMap: Record<string, InsightSource> = {
        telegram: "telegram",
        news: "news",
        report: "report"
      };

      // 1. 에비던스 카드에서 상세 분석 내용 검색
      const matchingCard = (unifiedResult?.storedCards ?? [])
        .concat(unifiedResult?.liveCards ?? [])
        .find((c) => c.databaseId === ref.database && c.phase === ref.phase)
        || (unifiedResult?.storedCards ?? [])
          .concat(unifiedResult?.liveCards ?? [])
          .find((c) => c.databaseId === ref.database);

      let summaryText = "";
      if (matchingCard) {
        summaryText = `### 📌 분석 결론\n${matchingCard.conclusion}\n\n### 🔍 상세 분석 근거\n${matchingCard.evidence}`;
      }

      const defaultNotes = ref.phase === "live"
        ? "이 자료는 리서치 과정에서 실시간으로 수집하여 통합 분석에 반영한 외부 자료입니다. 상세 페이지로 이동해 확인하실 수 있습니다."
        : "이 자료는 리서치 과정에서 데이터베이스 정적 분석을 통해 활용한 과거 이력 자료입니다. 상세 페이지로 이동해 확인하실 수 있습니다.";

      const notesText = matchingCard
        ? `[자료 안내] 본 자료는 리서치 과정에서 ${getDbLabel(ref.database)} 데이터베이스 ${ref.phase === "live" ? "실시간 수집" : "정적 분석"}을 통해 활용한 자료입니다.`
        : defaultNotes;

      const virtualItem: InsightItem = {
        id: `virtual_${ref.id}`,
        source: sourceMap[ref.database] ?? "report",
        title: ref.title,
        url: ref.url,
        date: ref.date,
        createdAt: ref.date,
        meta: (ref.database === "telegram" || ref.database === "news" || ref.database === "report")
          ? (ref.phase === "live" ? "실시간 자료" : "")
          : `${ref.phase === "live" ? "실시간 " : ""}${getDbLabel(ref.database)}`,
        companies: [],
        topics: [],
        macro: [],
        notes: notesText,
        summary: summaryText,
        database: ref.database,
      };
      setSelected(virtualItem);
    }
  };

  const handleReportCitationClick = (citationId: string) => {
    if (reportKind === "unified" && unifiedResult) {
      const sourceRef = unifiedResult.sources.find(
        (s) => s.id === citationId || s.id === citationId.replace("#", "S") || s.id === citationId.replace("S", "#")
      );
      if (sourceRef) {
        handleCitationClick(sourceRef);
      }
    }
  };

  const loadDebateHistory = useCallback(() => {
    setDebateHistoryLoading(true);
    fetch("/api/insight-debate?limit=50")
      .then((r) => r.json())
      .then((json: { debates?: DebateLogRow[] }) => setDebateHistory(json.debates ?? []))
      .catch(() => { })
      .finally(() => setDebateHistoryLoading(false));
  }, []);

  useEffect(() => {
    loadDebateHistory();
  }, [loadDebateHistory]);

  // 잡 소실 확인(1회) — 진행률 폴링은 BackgroundEngineProvider가 앱 전역에서 한 번만 수행하므로
  // 이 탭은 자체 인터벌을 돌리지 않는다 (기존 2.5초 자체 폴러 + 전역 3초 폴러 이중 요청 제거).
  useEffect(() => {
    if (!unifiedJobId) return;
    lastUsageSyncRef.current = {};
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`/api/unified-research/jobs?id=${unifiedJobId}`);
        if (cancelled) return;
        if (res.status === 404) {
          // 서버 잡 스토어(메모리)에서 소실된 잡 — localStorage에 남은 jobId도 함께 지워
          // "통합 리서치 시작" 버튼이 다시 뜨도록 복구한다 (버튼도 결과도 없는 흐린 화면 방지)
          if (activeTags.length === 1) removeStoredUnifiedJobId(activeTags[0]);
          setUnifiedJobId(null);
          return;
        }
        // 잡이 살아 있으면 전역 폴링을 즉시 시작/유지시킨다
        void refreshResearchJobs();
      } catch {
        // 네트워크 오류 — 전역 폴링이 이어서 처리
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unifiedJobId]);

  // 전역 폴링 결과(researchJobs)에서 내 잡을 찾아 진행 상태·결과를 반영
  useEffect(() => {
    if (!unifiedJobId) return;
    const job = researchJobs.find((j) => j.id === unifiedJobId);
    if (!job) return;

    setUnifiedJob(job);
    if (job.result?.debate) setHasDebated(true);
    if (job.result?.supplemented) setHasSupplemented(true);

    // 서버의 실제 API 호출량을 로컬 스토리지 한도 트래커에 누적 동기화
    if (job.modelUsage) {
      for (const [model, count] of Object.entries(job.modelUsage)) {
        const prev = lastUsageSyncRef.current[model] ?? 0;
        const diff = count - prev;
        if (diff > 0) {
          recordAiUsage(model as AiModelId, diff);
          lastUsageSyncRef.current[model] = count;
        }
      }
    }

    // STEP4-1/4-2는 병렬 실행이라 stage가 빠르게 덮어써진다 — 누적 이력으로 판별
    const hist = job.stageHistory ?? [];
    if (hist.includes("debating") || job.stage === "debating") setHasDebated(true);
    if (hist.includes("supplementing") || job.stage === "supplementing") setHasSupplemented(true);

    if (job.status === "done" && job.result) {
      const result = job.result;
      if (result.debate) setHasDebated(true);
      if (result.supplemented) setHasSupplemented(true);
      const dates = result.sources.map((s) => s.date).filter(Boolean).sort();
      setReport({
        keyword: result.keyword,
        count: result.sources.length,
        from: dates[0] ?? "",
        to: dates[dates.length - 1] ?? "",
        markdown: result.report ?? "",
      });
      setReportKind("unified");
    }
  }, [unifiedJobId, researchJobs]);

  const runDebate = useCallback(async (kw: string) => {
    const targetKw = kw.trim();
    if (!targetKw) return;
    setDebateError("");
    setDebateResult(null);
    setDebateStage("opening");
    const rebuttalTimer = setTimeout(() => setDebateStage("rebuttal"), 6000);
    const synthesisTimer = setTimeout(() => setDebateStage("synthesis"), 14000);
    try {
      const res = await fetch("/api/insight-debate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keyword: targetKw }),
      });
      const json = (await res.json()) as DebateResult & { error?: string };
      if (!res.ok || json.error) {
        setDebateError(json.error ?? "토론 생성에 실패했습니다.");
        setDebateStage("idle");
        return;
      }
      setDebateResult(json);
      setDebateStage("done");
      loadDebateHistory();
    } catch (e) {
      setDebateError(e instanceof Error ? e.message : "토론 생성 요청 실패");
      setDebateStage("idle");
    } finally {
      clearTimeout(rebuttalTimer);
      clearTimeout(synthesisTimer);
    }
  }, [loadDebateHistory]);

  const openDbModal = () => {
    const kwType = activeTags.length === 1 ? classifyMap.get(activeTags[0]) : null;
    if (activeTags.length !== 1 || (kwType !== "stock" && kwType !== "theme" && kwType !== "macro")) return;

    if (kwType === "theme") {
      setSelectedDbs(new Set(["telegram", "news", "report", "correlation", "peer"]));
    } else if (kwType === "macro") {
      // 저장 3종 + 매크로 지표 소스 기본 선택 (KOSIS는 목록만 노출, 기본 해제)
      setSelectedDbs(new Set(["telegram", "news", "report", "fred", "ecos"]));
    } else {
      setSelectedDbs(new Set(["telegram", "news", "report", "technical", "options", "holdings", "dart", "financials"]));
    }

    setDbModalError("");
    setShowDbModal(true);
  };

  const toggleDbSelection = (id: UnifiedDatabaseId) => {
    setSelectedDbs((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const startUnifiedJob = async () => {
    if (unifiedStartingRef.current) return;
    const kwType = activeTags.length === 1 ? classifyMap.get(activeTags[0]) : null;
    if (activeTags.length !== 1 || !showDbModal || (kwType !== "stock" && kwType !== "theme" && kwType !== "macro")) return;
    const keyword = activeTags[0];
    const databases = ALL_UNIFIED_DBS.filter((id) => selectedDbs.has(id));
    if (!databases.length) {
      setDbModalError("데이터베이스를 하나 이상 선택해주세요.");
      return;
    }
    setDbModalError("");
    setHasDebated(false);
    setHasSupplemented(false);
    unifiedStartingRef.current = true;
    setUnifiedStarting(true);

    try {
      let ticker: string | undefined;
      if (kwType === "stock") {
        try {
          const sr = await fetch(`/api/stock-search?q=${encodeURIComponent(keyword)}`);
          if (sr.ok) {
            const sj = (await sr.json()) as { items?: Array<{ code: string; market: string }> };
            ticker = sj.items?.[0]?.code;
          }
        } catch {
          // ignore
        }
      }

      const res = await fetch("/api/unified-research/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          keyword, databases, method: analysisMethod, ticker, corpName: keyword,
          keywordType: kwType,
        }),
      });
      const json = await res.json().catch(() => null) as { jobId?: string; job?: UnifiedJob; error?: string } | null;
      if (!res.ok || !json?.jobId) {
        setDbModalError(json?.error ?? "통합 리서치 작업 생성에 실패했습니다. 잠시 후 다시 시도해주세요.");
        return;
      }
      clearOtherStoredUnifiedJobIds();
      storeUnifiedJobId(keyword, json.jobId);
      setUnifiedJobId(json.jobId);
      setUnifiedJob(json.job ?? null);
      setShowDbModal(false);
      // 사이드바 미니위젯(다른 탭에서도 실행 중 표시)이 이 새 작업을 즉시 알도록 공유 폴링을 깨운다
      void refreshResearchJobs();
    } catch (e) {
      setDbModalError(e instanceof Error ? e.message : "통합 리서치 생성 오류");
    } finally {
      unifiedStartingRef.current = false;
      setUnifiedStarting(false);
    }
  };

  const approveNextStep = async () => {
    const expectedStep = unifiedJob?.hitl?.awaitingStep;
    if (!unifiedJobId || !expectedStep || approvalLoading) return;
    setApprovalLoading(true);
    setApprovalError("");
    try {
      const res = await fetch("/api/unified-research/jobs", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId: unifiedJobId, action: "approve", expectedStep }),
      });
      const json = await res.json().catch(() => null) as { job?: UnifiedJob; error?: string } | null;
      if (!res.ok || !json?.job) {
        setApprovalError(json?.error ?? "STEP 승인 처리에 실패했습니다.");
        return;
      }
      setUnifiedJob(json.job);
      await refreshResearchJobs();
    } catch (error) {
      setApprovalError(error instanceof Error ? error.message : "STEP 승인 처리 중 오류가 발생했습니다.");
    } finally {
      setApprovalLoading(false);
    }
  };

  type NodeState = "waiting" | "active" | "done" | "skipped" | "error";

  const renderPipeline = () => {
    const isRunning = unifiedLoading;
    const isFinished = unifiedJob?.status === "done";
    const currentStage = unifiedJob?.stage ?? null;
    const jobMethod = unifiedResult?.method ?? unifiedJob?.request?.method ?? analysisMethod;

    // 실행 대상 DB — 실행 중엔 요청 값, 완료 후엔 결과 값 기준. 시작 전엔 노드를 만들지 않는다.
    const jobDbs = (unifiedResult?.databases ?? unifiedJob?.request?.databases ?? []) as UnifiedDatabaseId[];

    // ── 단계별 상태 산정 ─────────────────────────────────────────────────────
    let step1State: NodeState = "waiting";
    let step2State: NodeState = "waiting"; // 연관 태그·시계열·트렌드 3개 노드 공통 (서버에서 통합 1회 호출)
    let step3State: NodeState = "waiting";
    let step41State: NodeState = "waiting"; // 충돌→토론
    let stepSupplementState: NodeState = "waiting"; // 정보 공백(gaps) 또는 신선도 의심(old)→실시간 보강, 화면 표기상 STEP 4-2
    let step5State: NodeState = "waiting";

    const completedStep = unifiedJob?.hitl?.completedStep ?? (isFinished ? 5 : 0);
    const runningStep = unifiedJob?.status === "running" ? unifiedJob.hitl?.awaitingStep : null;

    if (unifiedJob?.hitl) {
      step1State = completedStep >= 1 ? "done" : runningStep === 1 ? "active" : "waiting";
      step2State = completedStep >= 2 ? "done" : runningStep === 2 ? "active" : "waiting";
      step3State = completedStep >= 3 ? "done" : runningStep === 3 ? "active" : "waiting";
      step41State = completedStep >= 4 ? (hasDebated ? "done" : "skipped") : runningStep === 4 ? "active" : "waiting";
      stepSupplementState = completedStep >= 4 ? (hasSupplemented ? "done" : "skipped") : runningStep === 4 ? "active" : "waiting";
      step5State = completedStep >= 5 ? "done" : runningStep === 5 ? "active" : "waiting";
    }

    if (!unifiedJob?.hitl && (isRunning || isFinished)) {
      step1State = currentStage === "collecting" ? "active" : "done";

      if (step1State === "done") {
        step2State = currentStage === "integrating" ? "active" : "done";
        step3State = step2State; // STEP2·3은 runIntegration 한 호출로 함께 수행된다
      }

      if (step2State === "done") {
        // STEP 4-1/4-2는 병렬 실행 — 단일 stage 값으로는 개별 진행을 알 수 없으므로
        // stageHistory 기반 플래그(hasDebated 등)로 "실행됨" 여부를, 현재 stage가 STEP4 구간을
        // 지났는지로 "완료/스킵"을 판정한다.
        const step4Running = ["debating", "supplementing"].includes(currentStage ?? "");
        const step4Past = ["reintegrating", "reporting", "scoring"].includes(currentStage ?? "") || isFinished;

        step41State = hasDebated ? (step4Running ? "active" : "done") : step4Past ? "skipped" : "waiting";
        stepSupplementState = hasSupplemented ? (step4Running ? "active" : "done") : step4Past ? "skipped" : "waiting";
      }

      if (isFinished) step5State = "done";
      else if (["reintegrating", "reporting", "scoring"].includes(currentStage ?? "")) step5State = "active";
    }

    // DB 노드 상태 — 실행 중엔 서버가 기록한 dbStates, 완료 후엔 결과 카드 유무 기준
    const dbNodeState = (id: UnifiedDatabaseId): NodeState => {
      if (unifiedResult) {
        if (unifiedResult.storedCards.some((c) => c.databaseId === id)) return "done";
        return unifiedResult.skipped.some((s) => s.databaseId === id && s.errored) ? "error" : "skipped";
      }
      const s = unifiedJob?.dbStates?.[id];
      if (s === "done") return "done";
      if (s === "error") return "error";
      if (s === "skipped") return "skipped";
      if (step1State === "active") return "active";
      return step1State === "done" ? "done" : "waiting";
    };

    // ── 연결선 상태 — 다음 노드가 활성이면 흐르고, 완료면 채워진다 ──────────────
    const flowTo = (next: NodeState): NodeState =>
      next === "active" ? "active" : next === "done" ? "done" : "waiting";
    const branchOut = (branch: NodeState): NodeState => (branch === "skipped" ? "skipped" : flowTo(branch));
    const branchIn = (branch: NodeState): NodeState => {
      if (branch === "skipped") return "skipped";
      if (branch !== "done") return "waiting";
      return step5State === "done" ? "done" : "active";
    };

    const strokeColor = (state: NodeState) => (state === "done" || state === "active" ? "#005B52" : "#DDE8E5");
    const lineClass = (state: NodeState) => (state === "active" ? "line-flow-active" : "");

    // ── 노드 스타일 ──────────────────────────────────────────────────────────
    const nodeCls = (state: NodeState, clickable: boolean) => {
      const byState =
        state === "active" ? "border-primary bg-[#F0FAF9] text-primary shadow-soft ring-4 ring-primary/10"
          : state === "done" ? "border-primary bg-primary-50 text-primary"
            : state === "error" ? "border-red-200 bg-red-50/40 text-red-400 blur-[0.6px] opacity-60"
              : state === "skipped" ? "border-[#DDE8E5] bg-[#F7FAF9]/40 text-[#B9CCC4] blur-[0.6px] opacity-40"
                : "border-dashed border-[#DDE8E5] bg-[#F7FAF9] text-[#94A8A0] opacity-50";
      return `${byState}${clickable ? " cursor-pointer hover:-translate-y-0.5 hover:shadow-card" : ""}`;
    };

    const statusBadge = (state: NodeState) => {
      switch (state) {
        case "active":
          return (
            <span className="flex shrink-0 items-center gap-1 text-[11px] font-black text-primary">
              <Loader2 size={11} className="animate-spin" /> 분석 중
            </span>
          );
        case "done":
          return <span className="shrink-0 text-[11px] font-black text-primary">✓ 완료</span>;
        case "error":
          return <span className="shrink-0 text-[11px] font-medium text-red-400">오류 발생</span>;
        case "skipped":
          return <span className="shrink-0 text-[11px] font-medium italic text-[#B9CCC4]">스킵됨</span>;
        default:
          return <span className="shrink-0 text-[11px] font-medium text-[#94A8A0]">대기 중</span>;
      }
    };

    // 단계 노드 — 완료되면 노드 전체가 상세 팝업 버튼이 된다
    const renderStepNode = (
      eyebrow: string,
      title: string,
      state: NodeState,
      opts?: { onDetail?: () => void; sub?: string; wide?: boolean; footer?: React.ReactNode },
    ) => {
      const clickable = state === "done" && !!opts?.onDetail;
      const inner = (
        <>
          <div className="flex items-center justify-between gap-2 border-b border-[#F0F7F4]/40 pb-1">
            <span className="truncate text-[9px] font-black uppercase tracking-wider opacity-80">{eyebrow}</span>
            {statusBadge(state)}
          </div>
          <span className="mt-1.5 text-[13px] font-bold leading-snug tracking-tight">{title}</span>
          {opts?.sub && state !== "waiting" && state !== "skipped" && state !== "error" && (
            <span className="mt-0.5 text-[10px] font-semibold opacity-70">{opts.sub}</span>
          )}
          {state === "active" && (
            <div className="mt-2 flex flex-col gap-1">
              <div className="h-1 w-full overflow-hidden rounded-full bg-[#CCEEEB]">
                <div className="h-full w-2/5 rounded-full bg-primary/70" style={{ animation: "nodeShimmer 1.3s ease-in-out infinite" }} />
              </div>
              <span className="truncate text-[10px] font-bold text-[#5F7A70]">{unifiedJob?.stageLabel ?? "분석 중"}</span>
            </div>
          )}
          {clickable && (
            <span className="mt-2 text-[10px] font-black text-primary/70 transition group-hover:text-primary">상세보기 →</span>
          )}
          {state === "done" && opts?.footer && <div className="mt-2.5">{opts.footer}</div>}
        </>
      );
      const cls = `group relative flex w-full ${opts?.wide ? "max-w-[240px]" : "max-w-[200px]"} flex-col rounded-card border-2 p-3 text-left transition-all duration-500 ${nodeCls(state, clickable)}`;
      return clickable
        ? <button type="button" onClick={opts?.onDetail} className={cls}>{inner}</button>
        : <div className={cls}>{inner}</div>;
    };

    // DB 미니 노드 — 조사 종료 후 클릭하면 해당 DB의 결론·참고 자료 팝업
    const renderDbNode = (id: UnifiedDatabaseId) => {
      const state = dbNodeState(id);
      const clickable = state === "done" || state === "error";
      const byState =
        state === "active" ? "border-primary/50 bg-white text-[#0D2318]"
          : state === "done" ? "border-primary bg-primary-50 text-primary"
            : state === "error" ? "border-red-200 bg-red-50/60 text-red-400"
              : state === "skipped" ? "border-[#DDE8E5] bg-[#F7FAF9] text-[#B9CCC4]"
                : "border-dashed border-[#DDE8E5] bg-[#F7FAF9] text-[#94A8A0] opacity-60";
      const cls = `group flex w-full flex-col items-center gap-0.5 rounded-btn border px-1 py-1.5 shadow-soft transition-all duration-300 ${byState}${clickable ? " cursor-pointer hover:-translate-y-0.5 hover:shadow-card" : ""
        }`;
      const mini =
        state === "active" ? <span className="flex items-center gap-0.5 text-[9px] font-black text-primary"><Loader2 size={9} className="animate-spin" /> 분석 중</span>
          : state === "done" ? <span className="text-[9px] font-black leading-none text-primary">✓ 완료</span>
            : state === "error" ? <span className="text-[9px] font-medium leading-none text-red-400">오류 발생</span>
              : state === "skipped" ? <span className="text-[9px] font-medium italic leading-none text-[#B9CCC4]">스킵됨</span>
                : <span className="text-[9px] font-medium leading-none text-[#94A8A0]">대기 중</span>;
      const inner = (
        <>
          <span className="w-full truncate text-center text-[11px] font-bold leading-tight">{UNIFIED_DB_SHORT[id]}</span>
          {mini}
          {clickable && (
            <span className={`text-[9px] font-black leading-none transition ${state === "error" ? "text-red-400 group-hover:text-red-500" : "text-primary/70 group-hover:text-primary"
              }`}>상세보기 →</span>
          )}
        </>
      );
      return clickable
        ? <button type="button" onClick={() => setPipelineDetail({ kind: "db", dbId: id })} className={cls}>{inner}</button>
        : <div className={cls}>{inner}</div>;
    };

    // 1→N / N→1 분기·합류 곡선 — 노드 행(max-w-620px) 위에 states 개수만큼 균등 배치한 중심선에 맞춘다
    const fanSvg = (dir: "out" | "in", states: NodeState[]) => {
      const mid = 310;
      const xs = states.length === 1 ? [mid] : states.map((_, i) => 100 + (i * (520 - 100)) / (states.length - 1));
      return (
        <div className="relative h-12 w-full max-w-[620px]">
          <svg className="absolute inset-0 h-full w-full overflow-visible" viewBox="0 0 620 48" preserveAspectRatio="none">
            {xs.map((x, i) => (
              <path
                key={i}
                d={dir === "out"
                  ? (x === mid ? `M ${mid},0 L ${mid},48` : `M ${mid},0 C ${mid},26 ${x},22 ${x},48`)
                  : (x === mid ? `M ${mid},0 L ${mid},48` : `M ${x},0 C ${x},26 ${mid},22 ${mid},48`)}
                fill="none"
                stroke={strokeColor(states[i])}
                strokeWidth="2"
                className={lineClass(states[i])}
              />
            ))}
          </svg>
        </div>
      );
    };

    // N개 DB 노드를 STEP1 위에 반구(半球) 형태로 배치 — 궤도 반지름을 번갈아 사용해
    // (레이더처럼) 인접 노드가 겹치지 않게 깊이를 준다. 각 노드→STEP1 경로는 점선으로만
    // 잇고, 조사 중(active)인 노드는 그 점선을 따라 데이터 입자가 STEP1로 흘러들어가는
    // 애니메이션을 재생한다.
    const dbArcLayout = (ids: UnifiedDatabaseId[]) => {
      const n = ids.length;
      if (n === 0) return null;
      const SWEEP_DEG = 168;
      const R_OUTER = 270;
      const R_INNER = 195;
      const CHIP_W = 76;
      const CHIP_H = 48;
      const PAD = 12;
      const halfSweep = (SWEEP_DEG / 2) * (Math.PI / 180);
      const centerX = R_OUTER * Math.sin(halfSweep) + CHIP_W / 2 + PAD;
      const width = centerX * 2;
      const height = R_OUTER + CHIP_H / 2 + PAD + 4;
      const anchorY = height - 2; // STEP1 상단과 맞닿는 하단 중앙 앵커

      const nodes = ids.map((id, i) => {
        const t = n === 1 ? 0.5 : i / (n - 1);
        const angle = (-SWEEP_DEG / 2 + t * SWEEP_DEG) * (Math.PI / 180);
        const r = i % 2 === 0 ? R_OUTER : R_INNER;
        return { id, x: centerX + r * Math.sin(angle), y: anchorY - r * Math.cos(angle) };
      });

      return (
        <div className="relative" style={{ width, height }}>
          <svg className="absolute inset-0 h-full w-full overflow-visible" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none">
            {nodes.map(({ id, x, y }) => {
              const state = dbNodeState(id);
              const isActive = state === "active";
              const isDone = state === "done";
              // 노드에서 거의 수직으로 내려오다 하단 중앙 앵커로 부드럽게 모이는 곡선
              const d = `M ${x},${y} C ${x},${y + (anchorY - y) * 0.4} ${centerX + (x - centerX) * 0.15},${anchorY - (anchorY - y) * 0.08} ${centerX},${anchorY}`;
              return (
                <g key={id}>
                  <path
                    d={d}
                    fill="none"
                    stroke={isDone || isActive ? "#005B52" : "#DDE8E5"}
                    strokeOpacity={isDone ? 0.3 : isActive ? 0.55 : 0.6}
                    strokeWidth={1.5}
                    strokeLinecap="round"
                    strokeDasharray="1 7"
                  />
                  {isActive && [0, 1, 2].map((k) => (
                    <circle key={k} r={2.4} fill="#005B52">
                      <animateMotion dur="1.6s" repeatCount="indefinite" begin={`${k * 0.53}s`} path={d} />
                    </circle>
                  ))}
                </g>
              );
            })}
          </svg>
          {nodes.map(({ id, x, y }) => (
            <div
              key={id}
              className="absolute flex flex-col items-center"
              style={{ left: x, top: y, width: CHIP_W, transform: "translate(-50%, -50%)" }}
            >
              {renderDbNode(id)}
            </div>
          ))}
        </div>
      );
    };

    return (
      <div className="flex w-full flex-col items-center py-6">
        <style dangerouslySetInnerHTML={{
          __html: `
          @keyframes lineFlow {
            0% { stroke-dashoffset: 16; }
            100% { stroke-dashoffset: 0; }
          }
          .line-flow-active {
            stroke-dasharray: 8 8;
            animation: lineFlow 0.8s linear infinite;
          }
          @keyframes nodeShimmer {
            0% { transform: translateX(-100%); }
            100% { transform: translateX(280%); }
          }
        `}} />

        {/* STEP 1 소스 — 선택된 DB별 병렬 에이전트 노드, STEP1을 감싸는 반구 형태로 배치되며
            점선 궤도를 따라 조사 중인 노드의 데이터가 STEP1로 흘러들어간다 */}
        {jobDbs.length > 0 && dbArcLayout(jobDbs)}

        {renderStepNode("STEP 1", "데이터베이스 리서치", step1State, {
          sub: jobDbs.length ? `${jobDbs.length}개 DB 병렬 에이전트` : undefined,
          wide: true,
        })}

        {fanSvg("out", [flowTo(step2State), flowTo(step2State), flowTo(step2State)])}

        {/* STEP 2 — 병렬 3분석 */}
        <div className="flex w-full max-w-[620px] justify-between gap-4">
          {renderStepNode("STEP 2-1", "연관 태그 분석", step2State, { onDetail: () => setPipelineDetail({ kind: "analysis", which: "tag" }) })}
          {renderStepNode("STEP 2-2", "시계열 분석", step2State, { onDetail: () => setPipelineDetail({ kind: "analysis", which: "time" }) })}
          {renderStepNode("STEP 2-3", "트렌드 분석", step2State, { onDetail: () => setPipelineDetail({ kind: "analysis", which: "trend" }) })}
        </div>

        {fanSvg("in", [flowTo(step3State), flowTo(step3State), flowTo(step3State)])}

        {renderStepNode("STEP 3", "의견 충돌 · 데이터 보완", step3State, {
          onDetail: () => setPipelineDetail({ kind: "detection" }),
          wide: true,
        })}

        {fanSvg("out", [branchOut(step41State), branchOut(stepSupplementState)])}

        {/* STEP 4 — 감지된 오류별 해결 분기 (실제 오류가 있을 때만 활성화) */}
        <div className="flex w-full max-w-[620px] justify-between gap-4">
          {renderStepNode("STEP 4-1 · 충돌 해소", "AI 찬반토론", step41State, { onDetail: () => setPipelineDetail({ kind: "remedy", which: "debate" }) })}
          {renderStepNode("STEP 4-2 · 정보 보강", "실시간 리서치", stepSupplementState, { onDetail: () => setPipelineDetail({ kind: "remedy", which: "live" }) })}
        </div>

        {fanSvg("in", [branchIn(step41State), branchIn(stepSupplementState)])}

        {renderStepNode("STEP 5", "팩트체크 · 보고서 출력", step5State, {
          sub: "팩트 · 인용 · 판단 태그 부여",
          wide: true,
          footer: unifiedResult && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); setPipelineDetail({ kind: "output" }); }}
              className="flex w-full items-center justify-center gap-1.5 rounded-btn bg-primary px-3 py-2 text-[12px] font-black text-white"
            >
              {jobMethod === "report" ? <><FileText size={13} /> 보고서 출력</> : <><Scale size={13} /> 데이터 수치화</>}
            </button>
          ),
        })}
      </div>
    );
  };

  const renderTextWithCitations = (
    text?: string,
    fontSize = "text-[17px]",
    shouldShowDot?: (sentence: string, idx: number) => boolean
  ) => {
    if (!text) return null;
    const sentences = splitIntoSentences(text);
    return (
      <div className="flex flex-col gap-2">
        {sentences.map((sentence, idx) => {
          const parts = sentence.split(/(#\d+)/g);
          const showDot = shouldShowDot ? shouldShowDot(sentence, idx) : true;
          return (
            <p key={idx} className={`${fontSize} leading-relaxed text-[#33493F] ${showDot ? "pl-3 -indent-3" : "pl-3"}`}>
              {showDot && <span className="mr-1.5 text-primary font-black">·</span>}
              {parts.map((part, pIdx) => {
                if (/#\d+/.test(part)) {
                  return (
                    <button
                      key={pIdx}
                      type="button"
                      onClick={() => handleReportCitationClick(part)}
                      className="mx-0.5 inline-flex items-center justify-center rounded bg-primary-100 px-1 text-[11px] font-black text-primary hover:bg-primary hover:text-white"
                    >
                      {part}
                    </button>
                  );
                }
                return part;
              })}
            </p>
          );
        })}
      </div>
    );
  };

  const renderParagraphWithCitations = (text?: string, fontSize = "text-[17px]") => {
    if (!text) return null;
    const parts = text.split(/(#\d+)/g);
    return (
      <p className={`${fontSize} whitespace-pre-line leading-relaxed text-[#33493F]`}>
        {parts.map((part, pIdx) => {
          if (/#\d+/.test(part)) {
            return (
              <button
                key={pIdx}
                type="button"
                onClick={() => handleReportCitationClick(part)}
                className="mx-0.5 inline-flex items-center justify-center rounded bg-primary-100 px-1 text-[11px] font-black text-primary hover:bg-primary hover:text-white"
              >
                {part}
              </button>
            );
          }
          return part;
        })}
      </p>
    );
  };



  // activeTags가 변경될 때 첫 번째 태그를 토론 키워드로 지정하고 자동으로 토론 시작 (기존 이력이 있으면 로드)
  useEffect(() => {
    if (debateHistoryLoading) return; // 히스토리 로드가 완료된 후에 판정하여 중복 생성 방지
    if (activeTags.length > 0) {
      const kw = activeTags[0];
      setDebateKeyword(kw);

      const existing = debateHistory.filter(
        (h) => h.keyword.toLowerCase() === kw.toLowerCase()
      );

      if (existing.length > 0) {
        // 기존 이력이 있으면 가장 최근(첫번째) 이력을 로드
        const latest = [...existing].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
        setDebateResult({ ...latest, dateFrom: latest.dateFrom ?? "", dateTo: latest.dateTo ?? "" });
        setDebateStage("done");
        setDebateError("");
      } else {
        // 기존 이력이 없으면 새로 분석 실행
        void runDebate(kw);
      }
    } else {
      setDebateKeyword("");
      setDebateResult(null);
    }
  }, [activeTags, debateHistory, debateHistoryLoading, runDebate]);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30_000);
    try {
      const res = await fetch("/api/insight-db", { signal: controller.signal });
      let json: Record<string, unknown> = {};
      try {
        json = await res.json();
      } catch {
        throw new Error("서버 응답을 파싱하지 못했습니다. 잠시 후 다시 시도해 주세요.");
      }
      if (!res.ok) throw new Error((json.error as string) ?? "통합 데이터를 불러오지 못했습니다.");
      setItems((json.items as typeof items) ?? []);
      setSourceCounts((json.sourceCounts as typeof sourceCounts) ?? null);
      setSkippedSources((json.skippedSources as InsightSource[]) ?? []);
    } catch (e) {
      if (e instanceof Error && e.name === "AbortError") {
        setError("데이터 로딩 시간이 초과되었습니다. 서버 상태를 확인하거나 새로고침하세요.");
      } else {
        setError(e instanceof Error ? e.message : "오류가 발생했습니다.");
      }
    } finally {
      clearTimeout(timer);
      setLoading(false);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  // ── 필터링 (NSTK filterTrends 이식) ────────────────────────────────────────
  const filtered = useMemo(() => {
    return items.filter((it) => {
      if (!sources.has(it.source)) return false;
      if (fromDate && it.date < fromDate) return false;
      if (toDate && it.date > toDate) return false;
      if (activeTags.length && !activeTags.every((t) => allTags(it).includes(t))) return false;
      return true;
    });
  }, [items, sources, fromDate, toDate, activeTags]);

  // 클라우드·급상승은 태그 필터 제외한 풀에서 계산 (토글 시에도 전체 맥락 유지)
  const cloudBase = useMemo(() => {
    return items.filter((it) => {
      if (!sources.has(it.source)) return false;
      if (fromDate && it.date < fromDate) return false;
      if (toDate && it.date > toDate) return false;
      return true;
    });
  }, [items, sources, fromDate, toDate]);

  const classifyMap = useMemo(() => buildClassifyMap(cloudBase), [cloudBase]);
  // 자산유형별 태그 수·자료 수 (상단 분류 카드용)
  const assetStats = useMemo(() => {
    const tagsByType: Record<TagType, Set<string>> = { stock: new Set(), theme: new Set(), macro: new Set() };
    const itemsByType: Record<TagType, number> = { stock: 0, theme: 0, macro: 0 };
    const totalTags = new Set<string>();
    for (const it of cloudBase) {
      const types = new Set<TagType>();
      for (const t of allTags(it)) {
        const ty = classifyMap.get(t);
        if (!ty) continue;
        tagsByType[ty].add(t); totalTags.add(t); types.add(ty);
      }
      for (const ty of types) itemsByType[ty]++;
    }
    return { tagsByType, itemsByType, totalTags: totalTags.size };
  }, [cloudBase, classifyMap]);
  const allTagRanks = useMemo(() => {
    const ranks = topTags(cloudBase, Number.MAX_SAFE_INTEGER);
    return tagType === "all" ? ranks : ranks.filter((t) => classifyMap.get(t.name) === tagType);
  }, [cloudBase, tagType, classifyMap]);
  const filteredTagRanks = useMemo(() => {
    const q = tagSearch.trim().toLowerCase();
    return q ? allTagRanks.filter((t) => t.name.toLowerCase().includes(q)) : allTagRanks;
  }, [allTagRanks, tagSearch]);

  // 태그 클라우드 검색 자동완성
  const cloudSearchSuggestions = useMemo(() => {
    const q = cloudTagSearch.trim().toLowerCase();
    if (!q) return [];
    return allTagRanks.filter((t) => t.name.toLowerCase().includes(q)).slice(0, 8);
  }, [allTagRanks, cloudTagSearch]);

  // 태그 클라우드 전용 — 기간(1D/1W/1M/1Y) 필터 적용 (다른 뷰의 태그 집계와는 독립)
  const cloudPeriodBase = useMemo(() => {
    const period = CLOUD_PERIODS.find((p) => p.key === cloudPeriod);
    if (!period || period.days === null) return cloudBase;
    const cutoff = new Date(Date.now() - period.days * 24 * 3600 * 1000).toISOString().slice(0, 10);
    return cloudBase.filter((it) => it.date >= cutoff);
  }, [cloudBase, cloudPeriod]);
  const cloudClassifyMap = useMemo(() => buildClassifyMap(cloudPeriodBase), [cloudPeriodBase]);
  const tags = useMemo(() => {
    const ranks = topTags(cloudPeriodBase, 22 * 3);
    let filteredRanks = tagType === "all" ? ranks : ranks.filter((t) => cloudClassifyMap.get(t.name) === tagType);
    filteredRanks = filteredRanks.slice(0, 22);
    // 선택된 단일 태그를 클라우드 최상단(중앙)에 고정
    if (activeTags.length === 1) {
      const pinnedName = activeTags[0];
      const inList = filteredRanks.find((r) => r.name === pinnedName);
      if (inList) return [inList, ...filteredRanks.filter((r) => r.name !== pinnedName)];
      const anyRank = ranks.find((r) => r.name === pinnedName);
      if (anyRank) return [anyRank, ...filteredRanks.slice(0, 21)];
      return [{ name: pinnedName, count: Math.max(1, filteredRanks[0]?.count ?? 1), latest: "" }, ...filteredRanks.slice(0, 21)];
    }
    return filteredRanks;
  }, [cloudPeriodBase, tagType, cloudClassifyMap, activeTags]);
  const rising = useMemo(() => risingTags(items, 6), [items]);
  const related = useMemo(() => (activeTags.length ? coOccurrence(items, activeTags, 10) : []), [items, activeTags]);

  const weekCutoff = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString().slice(0, 10);
  const stats = useMemo(() => {
    const bySource = new Map<InsightSource, { total: number; week: number }>();
    for (const s of ALL_SOURCES) bySource.set(s, { total: 0, week: 0 });
    for (const it of items) {
      const rec = bySource.get(it.source)!;
      rec.total++;
      if ((it.createdAt || "").slice(0, 10) >= weekCutoff) rec.week++;
    }
    return bySource;
  }, [items, weekCutoff]);
  const totalWeek = [...stats.values()].reduce((s, v) => s + v.week, 0);

  // ── 태그 토글 (Ctrl/Cmd+클릭 = 복수 선택) → AI 인사이트 로드 ────────────────
  const toggleTag = (tag: string, additive = false) => {
    let next: string[];
    if (additive) {
      next = activeTags.includes(tag) ? activeTags.filter((t) => t !== tag) : [...activeTags, tag];
    } else {
      next = activeTags.length === 1 && activeTags[0] === tag ? [] : [tag];
    }
    setActiveTags(next);
    setInsight(null);
    setInsightError("");
    setReport(null);
    setReportError("");
    setShowReport(false);
    setUnifiedJob(null);
    setHasDebated(false);
    setHasSupplemented(false);
    setPipelineDetail(null);
    if (!next.length) {
      setUnifiedJobId(null);
      return;
    }
    const kwType = next.length === 1 ? classifyMap.get(next[0]) : null;
    if (next.length === 1 && (kwType === "stock" || kwType === "theme" || kwType === "macro")) {
      setUnifiedJobId(loadStoredUnifiedJobId(next[0]));
      return;
    }
    // 시간축 계층 샘플링: 최근 12건(소스별 최대 4건 균형)으로 최신 트렌드의 깊이를,
    // 나머지 기간 균등 샘플 28건으로 과거→현재 시계열 흐름을 확보한다.
    // (최신순으로만 자르면 게시 빈도가 높은 소스가 독식하고 과거 자료가 통째로 잘린다)
    const matched = items
      .filter((it) => next.every((t) => allTags(it).includes(t)))
      .sort((a, b) => (b.date || "").localeCompare(a.date || ""));
    const recent: InsightItem[] = [];
    const perSource = new Map<InsightSource, number>();
    for (const it of matched) {
      if (recent.length >= 12) break;
      const n = perSource.get(it.source) ?? 0;
      if (n >= 4) continue;
      recent.push(it);
      perSource.set(it.source, n + 1);
    }
    const rest = matched.filter((it) => !recent.includes(it));
    const past = rest.length <= 28
      ? rest
      : Array.from({ length: 28 }, (_, i) => rest[Math.round((i * (rest.length - 1)) / 27)]);
    const relatedItems = [...recent, ...past]
      .sort((a, b) => (a.date || "").localeCompare(b.date || "")) // 시계열 서술을 위해 날짜 오름차순
      .map((it) => ({ source: SOURCE_META[it.source].label, title: it.title, summary: it.summary, date: it.date }));
    if (!relatedItems.length) return;
    const monthlyMap = new Map<string, number>();
    for (const it of matched) {
      const m = it.date.slice(0, 7);
      monthlyMap.set(m, (monthlyMap.get(m) ?? 0) + 1);
    }
    setInsightLoading(true);
    fetch("/api/insight-db", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        keyword: next.join(" + "),
        items: relatedItems,
        related: coOccurrence(items, next, 10).map((r) => ({ name: r.name, count: r.count })),
        monthly: [...monthlyMap.entries()].sort().map(([month, count]) => ({ month, count })),
      }),
    })
      .then((res) => res.json())
      .then((json: AiInsight & { error?: string }) => {
        if (json.error) setInsightError(json.error);
        else setInsight(json);
      })
      .catch(() => setInsightError("AI 인사이트 요청 실패"))
      .finally(() => setInsightLoading(false));
  };

  // ── 전체 저장 자료 기반 키워드 종합 보고서 생성 ─────────────────────────────
  const generateReport = () => {
    if (!activeTags.length || reportLoading) return;
    const keywordLabel = activeTags.join(" + ");
    if (report && report.keyword === keywordLabel) { setShowReport(true); return; }
    const matching = items.filter((it) => activeTags.every((t) => allTags(it).includes(t)));
    if (!matching.length) { setReportError("이 키워드 조합으로 저장된 자료가 없습니다."); return; }
    setReportLoading(true);
    setReportError("");
    const monthlyMap = new Map<string, number>();
    for (const it of matching) {
      const m = it.date.slice(0, 7);
      monthlyMap.set(m, (monthlyMap.get(m) ?? 0) + 1);
    }
    fetch("/api/insight-db/report", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        keyword: keywordLabel,
        items: matching.map((it) => ({
          source: SOURCE_META[it.source].label,
          title: it.title,
          summary: (it.summary || it.notes || "").slice(0, 400),
          date: it.date,
        })),
        related: coOccurrence(items, activeTags, 15).map((r) => ({ name: r.name, count: r.count })),
        monthly: [...monthlyMap.entries()].sort().map(([month, count]) => ({ month, count })),
      }),
    })
      .then((res) => res.json())
      .then((json: KeywordReport & { error?: string }) => {
        if (json.error) setReportError(json.error);
        else { setReport(json); setShowReport(true); }
      })
      .catch(() => setReportError("보고서 생성 요청 실패"))
      .finally(() => setReportLoading(false));
  };

  // 인쇄용 창 — Tailwind 없이 동작하도록 태그 셀렉터 CSS 내장
  const printReport = () => {
    if (!report) return;
    const w = window.open("", "_blank", "width=880,height=1100");
    if (!w) return;
    w.document.write(`<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>#${report.keyword} 키워드 종합 보고서</title><style>
      @page { size: A4; margin: 18mm 16mm; }
      * { box-sizing: border-box; }
      body { margin: 0; font-family: Pretendard, "Malgun Gothic", sans-serif; color: #1C3329; font-size: 12px; line-height: 1.7; }
      .hd { border-bottom: 3px solid #005B52; padding-bottom: 12px; margin-bottom: 16px; }
      .hd h1 { margin: 0 0 4px; font-size: 21px; color: #0D2318; }
      .hd p { margin: 0; font-size: 11px; color: #7A9488; font-weight: 600; }
      h2 { margin: 20px 0 8px; font-size: 15px; color: #005B52; border-left: 4px solid #005B52; padding-left: 9px; }
      h3 { margin: 12px 0 4px; font-size: 13px; color: #0D2318; }
      p { margin: 5px 0; }
      li { margin: 3px 0 3px 18px; }
      strong { color: #0D2318; }
    </style></head><body>
      <div class="hd">
        <h1>#${report.keyword} 키워드 종합 보고서</h1>
        <p>분석 기간 ${report.from} ~ ${report.to} · 전체 저장 자료 ${report.count}건 기반 · 생성일 ${new Date().toISOString().slice(0, 10)} · 통합 인사이트</p>
      </div>
      ${renderMarkdown(report.markdown, "report")}
    </body></html>`);
    w.document.close();
    w.focus();
    setTimeout(() => w.print(), 350);
  };

  // (통합 리서치 최종 보고서의 인쇄·PDF는 BriefingReportViewer 내장 PDF 다운로드가 대체한다)

  const toggleSource = (s: InsightSource) => {
    setSources((prev) => {
      const next = new Set(prev);
      if (next.has(s) && next.size === 1) return new Set(ALL_SOURCES); // 마지막 하나 재클릭 → 전체 복원
      if (next.has(s) && next.size === ALL_SOURCES.length) return new Set([s]); // 전체 상태에서 클릭 → 단독 선택
      if (next.has(s)) next.delete(s); else next.add(s);
      return next.size ? next : new Set(ALL_SOURCES);
    });
  };

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col gap-5">
      {/* ── 헤더 카드 ── */}
      <section className="rounded-card border border-[#DDE8E5] bg-white p-5 shadow-card">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary text-white">
              <Sparkles size={22} />
            </span>
            <div>
              <h2 className="text-lg font-black text-[#0D2318]">통합 인사이트</h2>
              <p className="text-xs font-semibold text-[#7A9488]">
                텔레그램, 뉴스, 리포트의 모든 데이터를 융합하여 AI 통합 분석 리포트를 도출합니다
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <div className="flex rounded-btn bg-[#F0F5F4] p-1">
              <button type="button" onClick={() => setView("dashboard")}
                className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-bold transition ${view === "dashboard" ? "bg-primary text-white shadow-soft" : "text-[#4B6358] hover:text-primary"}`}>
                <Search size={13} /> 태그 리서치
              </button>
              <button type="button" onClick={() => setView("network")}
                className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-bold transition ${view === "network" ? "bg-primary text-white shadow-soft" : "text-[#4B6358] hover:text-primary"}`}>
                <Share2 size={13} /> 태그 네트워크
              </button>
              <button type="button" onClick={() => setView("keyword")}
                className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-bold transition ${view === "keyword" ? "bg-primary text-white shadow-soft" : "text-[#4B6358] hover:text-primary"}`}>
                <TrendingUp size={13} /> 태그 트렌드
              </button>
            </div>
            <button type="button" onClick={() => void load()} disabled={loading}
              className="flex items-center gap-1.5 rounded-btn border border-[#DDE8E5] bg-white px-3 py-2 text-sm font-bold text-[#4B6358] transition hover:border-primary hover:text-primary disabled:opacity-50">
              <RefreshCw size={13} className={loading ? "animate-spin" : ""} /> 새로고침
            </button>
          </div>
        </div>
      </section>

      {/* ── 메인 콘텐츠 영역 ── */}
      <div className="rounded-xl border border-[#DDE8E5] bg-white p-6 shadow-sm overflow-hidden flex flex-col gap-4">

        {error && <p className="rounded-btn border border-red-200 bg-red-50 px-4 py-2.5 text-sm font-semibold text-red-600">{error}</p>}

        {/* 숨겨진 DB를 포함해 조회에 실패한 모든 출처를 표시한다. */}
        {skippedSources.length > 0 && (
          <p className="rounded-btn border border-amber-200 bg-amber-50 px-4 py-2.5 text-[12px] font-semibold text-amber-700">
            ⚠ 일부 데이터 소스 로드 실패: {skippedSources.map(s => SOURCE_META[s].label).join(", ")} — Supabase 연결을 확인하거나 잠시 후 새로고침하세요.
          </p>
        )}

        {/* 자산유형 분류 카드 (주 분류 축 — 태그 클라우드·네트워크 필터) */}
        <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
          <button type="button" onClick={() => setTagType("all")}
            className={`flex flex-col rounded-card border p-3 text-left transition ${tagType === "all" ? "border-primary bg-primary-50" : "border-[#DDE8E5] bg-white hover:border-primary/40"
              }`}>
            <span className="text-[10px] font-bold text-[#7A9488]">전체 태그</span>
            <span className="text-lg font-black tabular-nums text-[#0D2318]">{assetStats.totalTags}</span>
            <span className="text-[10px] font-semibold text-primary">자료 {cloudBase.length}건 · 최근 7일 +{totalWeek}</span>
          </button>
          {ASSET_TYPES.map((ty) => {
            const on = tagType === ty;
            return (
              <button key={ty} type="button" onClick={() => setTagType(on ? "all" : ty)}
                className={`flex flex-col rounded-card border p-3 text-left transition ${on ? "border-primary bg-primary-50" : "border-[#DDE8E5] bg-white hover:border-primary/40"
                  }`}>
                <span className="flex items-center gap-1 text-[10px] font-bold text-[#7A9488]">
                  <span style={{ color: ASSET_META[ty].dot }}>{ASSET_META[ty].icon}</span>{ASSET_META[ty].label}
                </span>
                <span className="text-lg font-black tabular-nums text-[#0D2318]">{assetStats.tagsByType[ty].size}<span className="ml-0.5 text-[11px] font-bold text-[#94A8A0]">개</span></span>
                <span className="text-[10px] font-semibold text-[#7A9488]">자료 {assetStats.itemsByType[ty]}건</span>
              </button>
            );
          })}
        </div>

        {/* 필터 바 */}
        <div className="flex flex-wrap items-center gap-2">
          <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)}
            className="rounded-input border border-[#DDE8E5] px-2.5 py-1.5 text-[12px] font-semibold text-[#33493F] focus:border-primary" />
          <span className="text-xs font-bold text-[#94A8A0]">~</span>
          <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)}
            className="rounded-input border border-[#DDE8E5] px-2.5 py-1.5 text-[12px] font-semibold text-[#33493F] focus:border-primary" />
          {/* 출처 필터 (보조) — 자산유형 분류 위에 매체를 교차 적용 */}
          <div className="flex flex-wrap items-center gap-1">
            <span className="mr-0.5 text-[10px] font-bold text-[#94A8A0]">출처</span>
            <button type="button" onClick={() => setSources(new Set(ALL_SOURCES))}
              className={`rounded-full px-2.5 py-1 text-[11px] font-bold transition ${sources.size === ALL_SOURCES.length ? "bg-primary text-white" : "border border-[#DDE8E5] bg-white text-[#4B6358] hover:border-primary/50"
                }`}>
              전체
            </button>
            {ALL_SOURCES.map((s) => {
              const on = sources.has(s) && sources.size !== ALL_SOURCES.length;
              return (
                <button key={s} type="button" onClick={() => toggleSource(s)}
                  className={`flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-bold transition ${on ? "bg-primary text-white" : "border border-[#DDE8E5] bg-white text-[#4B6358] hover:border-primary/50"
                    }`}>
                  {SOURCE_META[s].icon}{SOURCE_META[s].label}
                  <span className={on ? "text-white/70" : "text-[#94A8A0]"}>{sourceCounts?.[s] ?? stats.get(s)!.total}</span>
                </button>
              );
            })}
          </div>
          {activeTags.map((tag) => (
            <span key={tag} className="flex items-center gap-1.5 rounded-full bg-primary px-3 py-1 text-[11px] font-black text-white">
              #{tag}
              <button type="button" onClick={() => toggleTag(tag, true)}><X size={11} /></button>
            </span>
          ))}
          {activeTags.length > 0 && (
            <span className="text-[10px] font-bold text-[#94A8A0]">Ctrl+클릭으로 키워드 추가 선택</span>
          )}
          {(fromDate || toDate || activeTags.length > 0 || sources.size !== DEFAULT_SOURCES.length || !DEFAULT_SOURCES.every(s => sources.has(s)) || tagType !== "all") && (
            <button type="button"
              onClick={() => {
                setFromDate(""); setToDate(""); setActiveTags([]); setInsight(null);
                setSources(new Set(DEFAULT_SOURCES)); setTagType("all");
                setReport(null); setReportError(""); setShowReport(false);
              }}
              className="text-[11px] font-bold text-[#94A8A0] transition hover:text-red-500">
              필터 초기화
            </button>
          )}
        </div>

        {/* 태그 네트워크 뷰 — 전체 태그 목록 + 동시출현 그래프 */}
        {view === "network" && (
          <div className="grid gap-4 xl:grid-cols-[280px_1fr]">
            <section className="flex max-h-[700px] flex-col rounded-card border border-[#DDE8E5] bg-white shadow-card">
              <div className="border-b border-[#F0F7F4] p-3">
                <p className="mb-2 text-[13px] font-black tracking-tight text-[#0D2318]">
                  전체 태그 <span className="text-[11px] font-bold text-[#94A8A0]">{allTagRanks.length}개</span>
                </p>
                <div className="relative">
                  <Search size={12} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[#94A8A0]" />
                  <input type="text" value={tagSearch} onChange={(e) => setTagSearch(e.target.value)}
                    placeholder="태그 검색"
                    className="w-full rounded-input border border-[#DDE8E5] py-1.5 pl-7 pr-2 text-[12px] font-semibold text-[#0D2318] placeholder:text-[#B9CCC4] focus:border-primary" />
                </div>
              </div>
              <div className="flex-1 overflow-y-auto p-1.5">
                {filteredTagRanks.map((t) => {
                  const active = activeTags.includes(t.name);
                  return (
                    <button key={t.name} type="button" onClick={(e) => toggleTag(t.name, e.ctrlKey || e.metaKey)}
                      className={`flex w-full items-center justify-between rounded-md px-2.5 py-1.5 text-left transition ${active ? "bg-primary text-white" : "hover:bg-[#F6FAF8]"
                        }`}>
                      <span className={`truncate text-[12px] font-bold ${active ? "text-white" : "text-[#33493F]"}`}>#{t.name}</span>
                      <span className={`ml-2 shrink-0 text-[10px] font-black tabular-nums ${active ? "text-white/80" : "text-[#94A8A0]"}`}>{t.count}</span>
                    </button>
                  );
                })}
                {filteredTagRanks.length === 0 && <p className="py-6 text-center text-xs font-semibold text-[#B9CCC4]">일치하는 태그가 없습니다</p>}
              </div>
            </section>
            <section className="rounded-card border border-[#DDE8E5] bg-white p-4 shadow-card">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2 border-b border-[#F0F7F4] pb-2">
                <span className="flex items-center gap-2 text-[13px] font-black tracking-tight text-[#0D2318]">
                  {activeTags.length ? `#${activeTags.join(" · #")} 연관 키워드 네트워크` : "키워드 동시출현 네트워크"}
                </span>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-bold text-[#94A8A0]">
                    {activeTags.length
                      ? "선택 키워드를 중앙에 고정 · 연결된 태그만 강조 · Ctrl+클릭 = 복수 선택"
                      : "노드 크기 = 등장 횟수 · 선 굵기 = 함께 등장한 횟수 · 클릭으로 필터 · Ctrl+클릭 = 복수 선택"}
                  </span>
                  <div className="flex items-center gap-0.5 rounded-btn bg-[#F0F5F4] p-1">
                    {CLOUD_PERIODS.map((p) => (
                      <button key={p.key} type="button" onClick={() => setCloudPeriod(p.key)}
                        className={`rounded-lg px-2 py-1 text-[10px] font-black transition ${cloudPeriod === p.key ? "bg-primary text-white shadow-soft" : "text-[#4B6358] hover:text-primary"
                          }`}>
                        {p.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
              <div className="h-[600px]">
                <TagNetwork items={cloudPeriodBase} anchorTags={activeTags} onTagClick={toggleTag} typeFilter={tagType} classifyMap={cloudClassifyMap} />
              </div>
            </section>
          </div>
        )}

        {/* 태그 트렌드 뷰 — 언급량 랭킹 + 시계열 비교 (DB) / 실시간 조회 */}
        {view === "keyword" && (
          <KeywordTrendView
            items={cloudBase}
            classifyMap={classifyMap}
            typeFilter={tagType}
            onOpenItem={setSelected}
            activeTags={activeTags}
            onTagClick={toggleTag}
          />
        )}

        {/* 워드클라우드 + 우측 패널 (대시보드 뷰) */}
        {view === "dashboard" && (
          <div className="grid gap-4 xl:grid-cols-[1.6fr_1fr]">
            <section className="rounded-card border border-[#DDE8E5] bg-white p-4 shadow-card">
              <div className="mb-2 flex flex-col gap-2">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#F0F7F4] pb-2">
                  <span className="text-[13px] font-black tracking-tight text-[#0D2318]">태그 클라우드</span>
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] font-bold text-[#94A8A0]">상위 {tags.length}개 · 클릭으로 필터</span>
                    <div className="flex items-center gap-0.5 rounded-btn bg-[#F0F5F4] p-1">
                      {CLOUD_PERIODS.map((p) => (
                        <button key={p.key} type="button" onClick={() => setCloudPeriod(p.key)}
                          className={`rounded-lg px-2 py-1 text-[10px] font-black transition ${cloudPeriod === p.key ? "bg-primary text-white shadow-soft" : "text-[#4B6358] hover:text-primary"
                            }`}>
                          {p.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
                {/* 태그 직접 검색 */}
                <div className="relative">
                  <Search size={12} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[#94A8A0]" />
                  <input
                    type="text"
                    value={cloudTagSearch}
                    onChange={(e) => { setCloudTagSearch(e.target.value); setShowCloudSuggestions(true); }}
                    onFocus={() => setShowCloudSuggestions(true)}
                    onBlur={() => setTimeout(() => setShowCloudSuggestions(false), 150)}
                    placeholder="태그 직접 검색 후 선택 → 클라우드 중앙 고정 + AI 찬반토론"
                    className="w-full rounded-input border border-[#DDE8E5] py-1.5 pl-7 pr-2 text-[12px] font-semibold text-[#0D2318] placeholder:text-[#B9CCC4] focus:border-primary focus:outline-none"
                  />
                  {showCloudSuggestions && cloudSearchSuggestions.length > 0 && (
                    <div className="absolute z-20 mt-1 w-full rounded-lg border border-[#DDE8E5] bg-white shadow-card">
                      {cloudSearchSuggestions.map((t) => (
                        <button
                          key={t.name}
                          type="button"
                          onMouseDown={(e) => { e.preventDefault(); toggleTag(t.name); setCloudTagSearch(""); setShowCloudSuggestions(false); }}
                          className="flex w-full items-center justify-between px-3 py-2 text-left hover:bg-[#F6FAF8]"
                        >
                          <span className="text-[12px] font-bold text-[#33493F]">#{t.name}</span>
                          <span className="text-[10px] text-[#94A8A0]">{t.count}건</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
              <TagCloud tags={tags} activeTags={activeTags} onTagClick={toggleTag} pinnedTag={activeTags.length === 1 ? activeTags[0] : undefined} />
            </section>

            <div className="flex flex-col gap-4">
              {/* 급상승 시그널 */}
              <section className="rounded-card border border-[#DDE8E5] bg-white p-4 shadow-card">
                <div className="mb-2 flex items-center justify-between border-b border-[#F0F7F4] pb-2">
                  <span className="flex items-center gap-1.5 text-[13px] font-black tracking-tight text-[#0D2318]"><Flame size={13} className="text-accent" /> 급상승 시그널</span>
                  <span className="text-[10px] font-bold text-[#94A8A0]">최근 7일</span>
                </div>
                {rising.length === 0 ? (
                  <p className="py-3 text-center text-xs font-semibold text-[#B9CCC4]">최근 7일 신규 저장이 없습니다</p>
                ) : (
                  <div className="flex flex-col gap-1">
                    {rising.map((r) => (
                      <button key={r.name} type="button" onClick={(e) => toggleTag(r.name, e.ctrlKey || e.metaKey)}
                        className={`flex items-center justify-between rounded-md px-2.5 py-1.5 text-left transition ${activeTags.includes(r.name) ? "bg-primary-50" : "hover:bg-[#F6FAF8]"
                          }`}>
                        <span className="text-[12px] font-black text-[#0D2318]">#{r.name}</span>
                        <span className="text-[10px] font-bold">
                          {r.isNew
                            ? <span className="rounded-full bg-accent px-1.5 py-0.5 text-white">NEW</span>
                            : <span className="text-primary">{r.pastCount} → {r.pastCount + r.recentCount}건</span>}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </section>

              {/* 연관 태그 (동시출현) */}
              <section className="rounded-card border border-[#DDE8E5] bg-white p-4 shadow-card">
                <div className="mb-2 flex items-center justify-between border-b border-[#F0F7F4] pb-2">
                  <span className="flex items-center gap-1.5 text-[13px] font-black tracking-tight text-[#0D2318]"><Link2 size={13} className="text-primary" /> 연관 태그</span>
                  {activeTags.length > 0 && <span className="text-[10px] font-bold text-primary">#{activeTags.join(" · #")} 기준</span>}
                </div>
                {!activeTags.length ? (
                  <p className="py-3 text-center text-xs font-semibold text-[#B9CCC4]">태그를 선택하면 함께 등장한 태그를 보여줍니다</p>
                ) : related.length === 0 ? (
                  <p className="py-3 text-center text-xs font-semibold text-[#B9CCC4]">동시출현 태그가 없습니다</p>
                ) : (
                  <div className="flex flex-wrap gap-1.5">
                    {related.map((r) => (
                      <button key={r.name} type="button" onClick={(e) => toggleTag(r.name, e.ctrlKey || e.metaKey)}
                        className="rounded-full border border-[#DDE8E5] bg-white px-2.5 py-1 text-[11px] font-bold text-[#4B6358] transition hover:border-primary hover:text-primary">
                        #{r.name} <span className="text-[#94A8A0]">{r.count}</span>
                      </button>
                    ))}
                  </div>
                )}
              </section>
            </div>
          </div>
        )}

        {/* 통합 AI 인사이트 (종목분석) 혹은 표준 AI 인사이트 / 찬반토론 */}
        {view === "dashboard" && activeTags.length > 0 && (() => {
          const kwType = activeTags.length === 1 ? classifyMap.get(activeTags[0]) : null;
          const isResearchableSingleTag = activeTags.length === 1 && (kwType === "stock" || kwType === "theme" || kwType === "macro");

          if (isResearchableSingleTag) {
            const isTheme = kwType === "theme";
            const isMacro = kwType === "macro";
            return (
              <>
              <section className="order-last rounded-card border border-[#DDE8E5] bg-white p-5 shadow-card">
                <div className="mb-3 flex flex-wrap items-center gap-2 border-b border-[#F0F7F4] pb-2.5">
                  <span className="text-[18px] font-black tracking-tight text-[#0D2318]">{isMacro ? "통합 AI 인사이트 (매크로·경제)" : isTheme ? "통합 AI 인사이트 (산업/테마)" : "통합 AI 인사이트 (종목분석)"}</span>
                  {unifiedResult && (
                    <span className="ml-auto text-[11px] font-bold text-[#94A8A0]">
                      완료된 단계를 클릭하면 상세 결과를 볼 수 있습니다
                    </span>
                  )}
                </div>

                {/* 파이프라인 시각화 영역 */}
                {renderPipeline()}

                {/* 각 에이전트가 STEP 완료 정보를 전달하고, PB 승인 전에는 다음 STEP을 실행하지 않는다. */}
                {unifiedJob?.hitl && unifiedJob.hitl.agentUpdates.length > 0 && (
                  <div className="mt-4 rounded-xl border border-[#B2D8D2] bg-[#F6FAF8] p-4">
                    <div className="mb-3 flex flex-wrap items-center gap-2">
                      <span className="text-[13px] font-black text-[#0D2318]">Human-In-The-Loop 승인 기록</span>
                      <span className="rounded-full bg-primary-50 px-2.5 py-1 text-[10px] font-black text-primary">
                        STEP {unifiedJob.hitl.completedStep} 완료
                      </span>
                      {unifiedJob.hitl.awaitingApproval && (
                        <span className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-[10px] font-black text-amber-700">
                          PB 확인 대기
                        </span>
                      )}
                    </div>
                    <div className="flex max-h-[280px] flex-col gap-2 overflow-y-auto pr-1">
                      {unifiedJob.hitl.agentUpdates.map((message, index) => (
                        <div key={message.step + "-" + message.agent + "-" + index}
                          className="rounded-btn border border-[#DDE8E5] bg-white px-3 py-2.5">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-[11px] font-black text-primary">STEP {message.step}</span>
                            <span className="text-[12px] font-black text-[#1C3329]">{message.agent}</span>
                            <span className={`ml-auto rounded-full px-2 py-0.5 text-[9px] font-black ${
                              message.status === "completed" ? "bg-emerald-50 text-emerald-700"
                                : message.status === "error" ? "bg-red-50 text-red-600"
                                  : "bg-slate-100 text-slate-500"
                            }`}>
                              {message.status === "completed" ? "완료" : message.status === "error" ? "오류" : "건너뜀"}
                            </span>
                          </div>
                          <p className="mt-1 text-[12px] font-semibold leading-relaxed text-[#5F7A70]">{message.summary}</p>
                        </div>
                      ))}
                    </div>
                    {unifiedJob.hitl.awaitingApproval && unifiedJob.hitl.awaitingStep && (
                      <div className="mt-3 border-t border-[#DDE8E5] pt-3">
                        <p className="mb-2 text-[11px] font-semibold text-[#5F7A70]">
                          위 완료 정보를 확인한 뒤 STEP {unifiedJob.hitl.awaitingStep} 실행을 승인해주세요.
                        </p>
                        <button type="button" onClick={() => void approveNextStep()} disabled={approvalLoading}
                          className="flex w-full items-center justify-center gap-2 rounded-btn bg-primary px-4 py-2.5 text-[13px] font-black text-white transition hover:bg-primary-light disabled:opacity-50">
                          {approvalLoading ? <Loader2 size={14} className="animate-spin" /> : <Scale size={14} />}
                          {approvalLoading ? "승인 처리 중…" : "승인 · STEP " + unifiedJob.hitl.awaitingStep + " 실행"}
                        </button>
                        {approvalError && <p className="mt-2 text-[11px] font-bold text-red-600">{approvalError}</p>}
                      </div>
                    )}
                  </div>
                )}

                {/* 1. 리서치 시작 전 대기화면 */}
                {!unifiedJobId && !unifiedLoading && !unifiedResult && (
                  <div className="mt-4 flex flex-col items-center justify-center p-6 text-center border border-dashed border-[#B9CCC4] rounded-xl bg-[#F6FAF8]/50">
                    <Sparkles className="text-primary mb-2" size={24} />
                    <p className="text-[15px] font-bold text-[#33493F]">#{activeTags[0]} 통합 리서치 파이프라인</p>
                    <p className="text-[12px] text-[#5F7A70] mt-1 mb-4">
                      {isMacro
                        ? "3개 인사이트 피드 DB와 미국연준(FRED)·한국은행(ECOS) 지표 소스를 연계하여 충돌 및 정보 공백을 감지하고 브리핑형 보고서를 작성합니다."
                        : isTheme
                        ? "3개 인사이트 피드 DB를 연계하여 충돌 및 정보 공백을 감지하고 종합 보고서를 작성합니다."
                        : "3개 인사이트 피드 DB와 기업 공시, 수급, 기술 지표를 연계하여 충돌 및 정보 공백을 감지하고 종합 보고서를 작성합니다."}
                    </p>
                    <button type="button" onClick={openDbModal} className="rounded-btn bg-[#005B52] px-5 py-2.5 text-[14px] font-black text-white transition hover:bg-[#004D45] flex items-center gap-1.5 shadow-sm">
                      통합 리서치 시작
                    </button>
                  </div>
                )}

                {/* 2. 진행 상황은 파이프라인 다이어그램(노드별 상태 + 상단 진행 스트립)이 직접 보여준다 */}

                {/* 3. 오류 화면 */}
                {unifiedError && (
                  <div className="mt-4 p-4 rounded-xl border border-red-200 bg-red-50 text-center">
                    <p className="text-sm font-semibold text-red-600">오류 발생: {unifiedError}</p>
                    <div className="mt-2.5 flex justify-center">
                      <button type="button" onClick={openDbModal} className="rounded-btn bg-red-600 px-4 py-1.5 text-[12px] font-bold text-white transition hover:bg-red-700">
                        통합 리서치 재시도
                      </button>
                    </div>
                  </div>
                )}

              </section>

              <section className="order-last rounded-card border border-[#DDE8E5] bg-white p-5 shadow-card mt-6">
                <div className="mb-3 flex items-center justify-between border-b border-[#F0F7F4] pb-2.5">
                  <div className="flex items-center gap-2">
                    <span className="text-[18px] font-black tracking-tight text-[#0D2318]">AI 찬반 토론</span>
                  </div>
                  {debateKeyword && (
                    <button
                      type="button"
                      onClick={() => void runDebate(debateKeyword)}
                      disabled={debateStage !== "idle" && debateStage !== "done"}
                      className="ml-auto flex items-center gap-1.5 rounded-btn bg-primary px-4 py-2 text-[13px] font-black text-white transition hover:bg-primary-light disabled:opacity-50"
                    >
                      {debateStage !== "idle" && debateStage !== "done" ? (
                        <Loader2 size={13} className="animate-spin" />
                      ) : (
                        <RefreshCw size={13} />
                      )}
                      새로고침
                    </button>
                  )}
                </div>

                <div className="flex flex-col gap-4">
                  <div className="flex flex-col gap-4">
                    {(debateStage !== "idle" && debateStage !== "done") && (
                      <p className="flex items-center gap-2 py-4 text-sm font-bold text-[#94A8A0]">
                        <Loader2 size={15} className="animate-spin" />
                        {DEBATE_STAGE_LABEL[debateStage as "opening" | "rebuttal" | "synthesis"]}…
                      </p>
                    )}
                    {debateError && (
                      <p className="rounded-card border border-red-200 bg-red-50 p-3 text-[12px] font-semibold text-red-600">{debateError}</p>
                    )}

                    {debateResult && (
                      <>
                        <div className="rounded-btn border border-[#B2D8D2] bg-white p-4 shadow-soft">
                          <div className="mb-3 flex items-center gap-2 border-b border-[#F0F7F4] pb-2">
                            <span className="text-[15px] font-black text-primary">종합 판단 및 시사점</span>
                            <span className="ml-auto rounded-full bg-primary-50 px-2.5 py-0.5 text-[11px] font-black text-primary">{debateResult.verdict}</span>
                            <span className="rounded-full bg-[#F6FAF8] border border-[#DDE8E5] px-2.5 py-0.5 text-[11px] font-bold text-[#4B6358]">확신도 {debateResult.confidence}</span>
                          </div>
                          <div className="flex flex-col gap-2.5">
                            <div>
                              <p className="mb-0.5 text-[11px] font-black uppercase tracking-wide text-[#94A8A0]">종합 요약</p>
                              <p className="text-[17px] leading-relaxed text-[#33493F]">{debateResult.rationale}</p>
                            </div>
                            <div>
                              <p className="mb-0.5 text-[11px] font-black uppercase tracking-wide text-[#94A8A0]">향후 관찰 포인트</p>
                              <p className="text-[17px] leading-relaxed text-[#5F7A70]">{debateResult.watchpoints}</p>
                            </div>
                          </div>
                        </div>

                        <div className="grid gap-4 md:grid-cols-2">
                          {(["bull", "bear"] as const).map((side) => {
                            const labels = frameLabels(debateResult.tagType);
                            const label = side === "bull" ? labels.bull : labels.bear;
                            const opening = side === "bull" ? debateResult.bullOpening : debateResult.bearOpening;
                            const Icon = side === "bull" ? TrendingUp : TrendingDown;
                            return (
                              <div key={`${side}-opening`} className="rounded-card border border-[#DDE8E5] bg-[#F7FAF9] p-4 shadow-soft flex flex-col">
                                <div className="mb-2 flex items-center gap-1.5 border-b border-[#F0F7F4] pb-1.5">
                                  <Icon size={14} className="text-[#5F7A70]" />
                                  <span className="text-[17px] font-black text-[#0D2318]">{label} - 1차 논거</span>
                                </div>
                                <p className="text-[17px] leading-relaxed text-[#33493F]">{opening}</p>
                              </div>
                            );
                          })}

                          {(["bull", "bear"] as const).map((side) => {
                            const labels = frameLabels(debateResult.tagType);
                            const label = side === "bull" ? labels.bull : labels.bear;
                            const rebuttal = side === "bull" ? debateResult.bullRebuttal : debateResult.bearRebuttal;
                            const Icon = side === "bull" ? TrendingUp : TrendingDown;
                            return (
                              <div key={`${side}-rebuttal`} className="rounded-card border border-[#DDE8E5] bg-[#F7FAF9] p-4 shadow-soft flex flex-col">
                                <div className="mb-2 flex items-center gap-1.5 border-b border-[#F0F7F4] pb-1.5">
                                  <Icon size={14} className="text-[#5F7A70]" />
                                  <span className="text-[17px] font-black text-[#0D2318]">{label} - 반박</span>
                                </div>
                                <p className="text-[17px] leading-relaxed text-[#33493F]">{rebuttal}</p>
                              </div>
                            );
                          })}
                        </div>
                      </>
                    )}

                    {!debateResult && (debateStage === "idle" || debateStage === "done") && !debateError && (
                      <p className="py-10 text-center text-[13px] font-semibold text-[#94A8A0]">
                        저장된 찬반 토론 결과가 없습니다.
                      </p>
                    )}
                  </div>

                  {(() => {
                    const keywordHistory = debateHistory.filter(
                      (h) => h.keyword.toLowerCase() === debateKeyword.toLowerCase()
                    );
                    if (keywordHistory.length === 0) return null;
                    return (
                      <div className="mt-2 border-t border-[#F0F7F4] pt-4">
                        <h4 className="mb-2 text-[12px] font-black text-[#0D2318]">#{debateKeyword} 과거 분석 이력 ({keywordHistory.length}건)</h4>
                        <div className="flex flex-wrap gap-2">
                          {keywordHistory.map((h) => (
                            <div
                              key={h.id}
                              className="group/pill relative flex items-center rounded-btn border border-[#DDE8E5] bg-[#F7FAF9] pr-9 pl-3 py-1.5 text-left text-[11px] font-semibold text-[#4B6358] transition hover:border-primary hover:bg-[#F0F5F4]"
                            >
                              <button
                                type="button"
                                onClick={() => {
                                  setDebateResult({ ...h, dateFrom: h.dateFrom ?? "", dateTo: h.dateTo ?? "" });
                                  setDebateStage("done");
                                  setDebateError("");
                                }}
                                className="w-full text-left"
                              >
                                <span className="font-bold text-[#1C3329] mr-1">{h.verdict}</span>
                                <span className="text-[#94A8A0]">({h.createdAt.slice(0, 10)})</span>
                              </button>
                              <button
                                type="button"
                                onClick={async (e) => {
                                  e.stopPropagation();
                                  if (confirm("이 분석 이력을 삭제하시겠습니까?")) {
                                    try {
                                      const res = await fetch(`/api/insight-debate?id=${h.id}`, { method: "DELETE" });
                                      if (res.ok) {
                                        loadDebateHistory();
                                        if (debateResult?.keyword === h.keyword || (debateResult as any)?.id === h.id) {
                                          setDebateResult(null);
                                        }
                                      }
                                    } catch (err) {
                                      console.error("이력 삭제 실패:", err);
                                    }
                                  }
                                }}
                                className="absolute right-1 top-1/2 -translate-y-1/2 rounded-full p-2 text-[#94A8A0] hover:bg-red-50 hover:text-red-500 opacity-0 group-hover/pill:opacity-100 transition-opacity"
                                title="삭제"
                              >
                                <X size={13} className="stroke-[3.5]" />
                              </button>
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })()}
                </div>
              </section>
              </>
            );
          }

          return (
            <>
              <section className="rounded-card border border-[#DDE8E5] bg-white p-5 shadow-card">
                <div className="mb-3 flex flex-wrap items-center gap-2 border-b border-[#F0F7F4] pb-2.5">
                  <span className="text-[18px] font-black tracking-tight text-[#0D2318]">AI 인사이트</span>
                  <button type="button" onClick={generateReport} disabled={reportLoading}
                    className="ml-auto flex items-center gap-1.5 rounded-btn bg-primary px-4 py-2 text-[13px] font-black text-white transition hover:bg-primary-light disabled:opacity-50">
                    {reportLoading ? <Loader2 size={13} className="animate-spin" /> : <FileText size={13} />}
                    {reportLoading ? "전체 자료 분석 중…" : "보고서 출력"}
                  </button>
                </div>
                {reportError && <p className="mb-3 rounded-btn border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold text-red-600">{reportError}</p>}
                {insightLoading ? (
                  <p className="flex items-center gap-2 py-4 text-sm font-bold text-[#94A8A0]"><Loader2 size={15} className="animate-spin" /> 저장된 자료를 종합 분석하는 중…</p>
                ) : insightError ? (
                  <p className="py-3 text-sm font-semibold text-[#94A8A0]">{insightError}</p>
                ) : insight ? (
                  <div className="flex flex-col gap-3">
                    {insight.timeline && (
                      <div className="rounded-btn border border-[#B2D8D2] bg-white p-3.5">
                        <p className="mb-1 text-[17px] font-black text-primary">시계열 흐름</p>
                        <p className="whitespace-pre-line text-[16px] font-normal leading-relaxed text-[#33493F]">{formatInsightText(insight.timeline)}</p>
                      </div>
                    )}
                    <div className="rounded-btn border border-[#B2D8D2] bg-white p-3.5">
                      <p className="mb-1 text-[17px] font-black text-primary">최신 트렌드</p>
                      <p className="whitespace-pre-line text-[16px] font-normal leading-relaxed text-[#33493F]">{formatInsightText(insight.trend)}</p>
                    </div>
                    {insight.relation && (
                      <div className="rounded-btn border border-[#B2D8D2] bg-white p-3.5">
                        <p className="mb-1 text-[17px] font-black text-primary">연관 태그 관계</p>
                        <p className="whitespace-pre-line text-[16px] font-normal leading-relaxed text-[#33493F]">{formatInsightText(insight.relation)}</p>
                      </div>
                    )}
                    <div className="rounded-btn border border-[#B2D8D2] bg-white p-3.5">
                      <p className="mb-1 text-[17px] font-black text-primary">투자 시사점</p>
                      <p className="whitespace-pre-line text-[16px] font-normal leading-relaxed text-[#33493F]">{formatInsightText(insight.implication)}</p>
                    </div>
                    <div className="rounded-btn border border-[#B2D8D2] bg-white p-3.5">
                      <p className="mb-1 text-[17px] font-black text-primary">관찰 포인트</p>
                      <p className="whitespace-pre-line text-[16px] font-normal leading-relaxed text-[#33493F]">{formatInsightText(insight.watch)}</p>
                    </div>
                  </div>
                ) : null}
              </section>

              <section className="rounded-card border border-[#DDE8E5] bg-white p-5 shadow-card mt-6">
                <div className="mb-3 flex items-center justify-between border-b border-[#F0F7F4] pb-2.5">
                  <div className="flex items-center gap-2">
                    <span className="text-[18px] font-black tracking-tight text-[#0D2318]">AI 찬반 토론</span>
                  </div>
                  {debateKeyword && (
                    <button
                      type="button"
                      onClick={() => void runDebate(debateKeyword)}
                      disabled={debateStage !== "idle" && debateStage !== "done"}
                      className="ml-auto flex items-center gap-1.5 rounded-btn bg-primary px-4 py-2 text-[13px] font-black text-white transition hover:bg-primary-light disabled:opacity-50"
                    >
                      {debateStage !== "idle" && debateStage !== "done" ? (
                        <Loader2 size={13} className="animate-spin" />
                      ) : (
                        <RefreshCw size={13} />
                      )}
                      새로고침
                    </button>
                  )}
                </div>

                <div className="flex flex-col gap-4">
                  <div className="flex flex-col gap-4">
                    {(debateStage !== "idle" && debateStage !== "done") && (
                      <p className="flex items-center gap-2 py-4 text-sm font-bold text-[#94A8A0]">
                        <Loader2 size={15} className="animate-spin" />
                        {DEBATE_STAGE_LABEL[debateStage as "opening" | "rebuttal" | "synthesis"]}…
                      </p>
                    )}
                    {debateError && (
                      <p className="rounded-card border border-red-200 bg-red-50 p-3 text-[12px] font-semibold text-red-600">{debateError}</p>
                    )}

                    {debateResult && (
                      <>
                        <div className="rounded-btn border border-[#B2D8D2] bg-white p-4 shadow-soft">
                          <div className="mb-3 flex items-center gap-2 border-b border-[#F0F7F4] pb-2">
                            <span className="text-[15px] font-black text-primary">종합 판단 및 시사점</span>
                            <span className="ml-auto rounded-full bg-primary-50 px-2.5 py-0.5 text-[11px] font-black text-primary">{debateResult.verdict}</span>
                            <span className="rounded-full bg-[#F6FAF8] border border-[#DDE8E5] px-2.5 py-0.5 text-[11px] font-bold text-[#4B6358]">확신도 {debateResult.confidence}</span>
                          </div>
                          <div className="flex flex-col gap-2.5">
                            <div>
                              <p className="mb-0.5 text-[11px] font-black uppercase tracking-wide text-[#94A8A0]">종합 요약</p>
                              <p className="text-[17px] leading-relaxed text-[#33493F]">{debateResult.rationale}</p>
                            </div>
                            <div>
                              <p className="mb-0.5 text-[11px] font-black uppercase tracking-wide text-[#94A8A0]">향후 관찰 포인트</p>
                              <p className="text-[17px] leading-relaxed text-[#5F7A70]">{debateResult.watchpoints}</p>
                            </div>
                          </div>
                        </div>

                        <div className="grid gap-4 md:grid-cols-2">
                          {(["bull", "bear"] as const).map((side) => {
                            const labels = frameLabels(debateResult.tagType);
                            const label = side === "bull" ? labels.bull : labels.bear;
                            const opening = side === "bull" ? debateResult.bullOpening : debateResult.bearOpening;
                            const Icon = side === "bull" ? TrendingUp : TrendingDown;
                            return (
                              <div key={`${side}-opening`} className="rounded-card border border-[#DDE8E5] bg-[#F7FAF9] p-4 shadow-soft flex flex-col">
                                <div className="mb-2 flex items-center gap-1.5 border-b border-[#F0F7F4] pb-1.5">
                                  <Icon size={14} className="text-[#5F7A70]" />
                                  <span className="text-[17px] font-black text-[#0D2318]">{label} - 1차 논거</span>
                                </div>
                                <p className="text-[17px] leading-relaxed text-[#33493F]">{opening}</p>
                              </div>
                            );
                          })}

                          {(["bull", "bear"] as const).map((side) => {
                            const labels = frameLabels(debateResult.tagType);
                            const label = side === "bull" ? labels.bull : labels.bear;
                            const rebuttal = side === "bull" ? debateResult.bullRebuttal : debateResult.bearRebuttal;
                            const Icon = side === "bull" ? TrendingUp : TrendingDown;
                            return (
                              <div key={`${side}-rebuttal`} className="rounded-card border border-[#DDE8E5] bg-[#F7FAF9] p-4 shadow-soft flex flex-col">
                                <div className="mb-2 flex items-center gap-1.5 border-b border-[#F0F7F4] pb-1.5">
                                  <Icon size={14} className="text-[#5F7A70]" />
                                  <span className="text-[17px] font-black text-[#0D2318]">{label} - 반박</span>
                                </div>
                                <p className="text-[17px] leading-relaxed text-[#33493F]">{rebuttal}</p>
                              </div>
                            );
                          })}
                        </div>
                      </>
                    )}

                    {!debateResult && (debateStage === "idle" || debateStage === "done") && !debateError && (
                      <p className="py-10 text-center text-[13px] font-semibold text-[#94A8A0]">
                        저장된 찬반 토론 결과가 없습니다.
                      </p>
                    )}
                  </div>

                  {(() => {
                    const keywordHistory = debateHistory.filter(
                      (h) => h.keyword.toLowerCase() === debateKeyword.toLowerCase()
                    );
                    if (keywordHistory.length === 0) return null;
                    return (
                      <div className="mt-2 border-t border-[#F0F7F4] pt-4">
                        <h4 className="mb-2 text-[12px] font-black text-[#0D2318]">#{debateKeyword} 과거 분석 이력 ({keywordHistory.length}건)</h4>
                        <div className="flex flex-wrap gap-2">
                          {keywordHistory.map((h) => (
                            <div
                              key={h.id}
                              className="group/pill relative flex items-center rounded-btn border border-[#DDE8E5] bg-[#F7FAF9] pr-9 pl-3 py-1.5 text-left text-[11px] font-semibold text-[#4B6358] transition hover:border-primary hover:bg-[#F0F5F4]"
                            >
                              <button
                                type="button"
                                onClick={() => {
                                  setDebateResult({ ...h, dateFrom: h.dateFrom ?? "", dateTo: h.dateTo ?? "" });
                                  setDebateStage("done");
                                  setDebateError("");
                                }}
                                className="w-full text-left"
                              >
                                <span className="font-bold text-[#1C3329] mr-1">{h.verdict}</span>
                                <span className="text-[#94A8A0]">({h.createdAt.slice(0, 10)})</span>
                              </button>
                              <button
                                type="button"
                                onClick={async (e) => {
                                  e.stopPropagation();
                                  if (confirm("이 분석 이력을 삭제하시겠습니까?")) {
                                    try {
                                      const res = await fetch(`/api/insight-debate?id=${h.id}`, { method: "DELETE" });
                                      if (res.ok) {
                                        loadDebateHistory();
                                        if (debateResult?.keyword === h.keyword || (debateResult as any)?.id === h.id) {
                                          setDebateResult(null);
                                        }
                                      }
                                    } catch (err) {
                                      console.error("이력 삭제 실패:", err);
                                    }
                                  }
                                }}
                                className="absolute right-1 top-1/2 -translate-y-1/2 rounded-full p-2 text-[#94A8A0] hover:bg-red-50 hover:text-red-500 opacity-0 group-hover/pill:opacity-100 transition-opacity"
                                title="삭제"
                              >
                                <X size={13} className="stroke-[3.5]" />
                              </button>
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })()}
                </div>
              </section>
            </>
          );
        })()}

        {/* 통합 피드 */}
        <section className="rounded-card border border-[#DDE8E5] bg-white shadow-card">
          <div className="flex items-center justify-between border-b border-[#F0F7F4] px-4 py-3">
            <span className="text-[13px] font-black tracking-tight text-[#0D2318]">통합 피드</span>
            <span className="text-[11px] font-bold text-[#94A8A0]">{filtered.length}건</span>
          </div>
          <div className="max-h-[540px] overflow-y-auto">
            {loading ? (
              <p className="py-16 text-center text-sm font-bold text-[#94A8A0]"><Loader2 size={15} className="mr-1.5 inline animate-spin" /> 3개 DB 통합 조회 중…</p>
            ) : filtered.length === 0 ? (
              <p className="py-16 text-center text-sm font-bold text-[#94A8A0]">조건에 맞는 저장 자료가 없습니다.</p>
            ) : (
              filtered.slice(0, 200).map((it) => (
                <button key={it.id} type="button" onClick={() => setSelected(it)}
                  className="group flex w-full flex-col gap-1 border-b border-[#F0F7F4] px-4 py-3 text-left transition hover:bg-[#F6FAF8]">
                  <span className="flex flex-wrap items-center gap-1.5">
                    <span className={`flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-black ${SOURCE_META[it.source].chip}`}>
                      {SOURCE_META[it.source].icon}{SOURCE_META[it.source].label}
                    </span>
                    {it.meta && <span className="text-[10px] font-bold text-[#94A8A0]">{it.meta}</span>}
                    <span className="text-[10px] font-semibold text-[#94A8A0]">{it.date}</span>
                  </span>
                  <span className="text-[13px] font-bold text-[#1C3329]">{it.title}</span>
                  {allTags(it).length > 0 && (
                    <span className="hidden flex-wrap gap-1 mt-1 group-hover:flex">
                      {[...new Set(allTags(it))].map((t) => (
                        <span key={t} className={`rounded-full border px-1.5 py-0.5 text-[9px] font-bold ${activeTags.includes(t) ? "border-primary bg-primary text-white" : ASSET_META[classifyMap.get(t) ?? "theme"].chip}`}>{t}</span>
                      ))}
                    </span>
                  )}
                </button>
              ))
            )}
          </div>
        </section>

        {/* 상세 모달 (NSTK DetailModal 이식) — 파이프라인 팝업(z-110) 안의 인용 클릭으로도 열리므로 그 위(z-120)에 띄운다 */}
        {selected && mounted && (() => {
          const isTab2Db = selected.id?.startsWith("virtual_") &&
            (selected.database === "technical" || selected.database === "options" || selected.database === "holdings" || selected.database === "dart" || selected.database === "financials");

          return createPortal(
            <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/60 p-4 sm:p-8" onClick={() => setSelected(null)}>
              <div className="flex max-h-[85vh] w-full max-w-5xl flex-col overflow-hidden rounded-xl bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
                <div className="flex flex-1 flex-col overflow-y-auto">
                  {/* 헤더 */}
                  <div className="sticky top-0 z-10 border-b border-[#E8F0ED] bg-white px-5 py-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="mb-1 flex items-center gap-2">
                          {isTab2Db ? (
                            <span className="flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-black text-emerald-700">
                              <Database size={11} /> 분석 데이터
                            </span>
                          ) : (
                            <span className={`flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-black ${SOURCE_META[selected.source].chip}`}>
                              {SOURCE_META[selected.source].icon}{SOURCE_META[selected.source].label}
                            </span>
                          )}
                          {selected.meta && (
                            <span className="text-[11px] font-bold text-[#94A8A0]">{selected.meta}</span>
                          )}
                          <span className="text-[11px] font-semibold text-[#94A8A0]">{selected.date}</span>
                        </div>
                        <h3 className="text-[15px] font-bold leading-snug text-[#1C3329]">
                          {selected.title}
                        </h3>
                      </div>
                      <div className="flex shrink-0 items-center gap-1.5">
                        {/* TAB2 분석 화면 이동 버튼 (정량 데이터용) */}
                        {isTab2Db && selected.database && unifiedJob?.request?.ticker && (
                          <button
                            type="button"
                            onClick={() => handleGoToTab2(selected.database!)}
                            className="flex items-center gap-1 rounded-md border border-[#DDE8E5] bg-emerald-50 px-2.5 py-1.5 text-[12px] font-black text-emerald-700 hover:bg-emerald-100 transition"
                          >
                            <TrendingUp size={12} className="text-emerald-700" />
                            TAB2 분석 화면으로 이동
                          </button>
                        )}

                        {selected.url && (
                          <a
                            href={selected.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center gap-1 rounded-md border border-[#DDE8E5] px-2.5 py-1.5 text-[12px] font-medium text-[#5F7A70] hover:bg-[#F6FAF8] transition"
                          >
                            <ExternalLink size={12} />
                            {selected.source === "report" ? "PDF 원문" : "원문"}
                          </a>
                        )}
                        <button
                          type="button"
                          onClick={() => setSelected(null)}
                          className="rounded-md border border-[#DDE8E5] p-1.5 text-[#94A8A0] hover:bg-[#F6FAF8] transition"
                        >
                          <X size={13} />
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* 본문 */}
                  <div className="flex-1 px-5 py-5 space-y-4">
                    <TagEditSection
                      companies={selected.companies}
                      topics={selected.topics}
                      macro={selected.macro}
                      readOnly
                    />

                    {/* 정리 */}
                    {selected.notes && (
                      <div>
                        <label className="mb-2 block text-[11px] font-semibold uppercase tracking-wide text-[#94A8A0]">자료 정보</label>
                        <p className="whitespace-pre-wrap text-[14px] leading-relaxed text-[#5F7A70] bg-[#F6FAF8] border border-[#E8F0ED] rounded-lg p-3.5">
                          {selected.notes}
                        </p>
                      </div>
                    )}

                    {/* AI 요약 */}
                    {selected.summary && (
                      <div>
                        <label className="mb-2 block text-[11px] font-semibold uppercase tracking-wide text-[#94A8A0]">
                          {isTab2Db ? "AI 데이터베이스 분석 요약" : "AI 요약"}
                        </label>
                        <div className="rounded-md border border-[#E8F0ED] bg-[#F6FAF8] p-4 h-auto">
                          <MarkdownView text={selected.summary} />
                        </div>
                      </div>
                    )}

                    {!selected.notes && !selected.summary && (
                      <p className="py-6 text-center text-sm text-[#94A8A0]">저장된 내용이 없습니다.</p>
                    )}
                  </div>
                </div>
              </div>
            </div>
            , document.body);
        })()}

        {/* 키워드 종합 보고서 모달 */}
        {showReport && report && mounted && createPortal(
          <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4" onClick={() => setShowReport(false)}>
            <div className="flex max-h-[85vh] w-full max-w-3xl flex-col overflow-hidden rounded-card bg-white shadow-popup" onClick={(e) => e.stopPropagation()}>
              <div className="flex flex-wrap items-center justify-between gap-3 border-b-2 border-primary px-6 py-4">
                <div>
                  <h3 className="flex items-center gap-2 text-[16px] font-black text-[#0D2318]">
                    <FileText size={16} className="text-primary" /> #{report.keyword} 키워드 종합 보고서
                  </h3>
                  <p className="mt-0.5 text-[11px] font-bold text-[#94A8A0]">
                    분석 기간 {report.from} ~ {report.to} · 전체 저장 자료 {report.count}건 기반 · 생성일 {new Date().toISOString().slice(0, 10)}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button type="button" onClick={printReport}
                    className="flex items-center gap-1.5 rounded-btn bg-primary px-3.5 py-2 text-xs font-black text-white transition hover:bg-primary-light">
                    <Printer size={13} /> 인쇄 · PDF 저장
                  </button>
                  <button type="button" onClick={() => setShowReport(false)} className="text-[#B9CCC4] transition hover:text-[#4B6358]"><X size={18} /></button>
                </div>
              </div>
              <div className="overflow-y-auto px-6 py-5 text-[17px]" dangerouslySetInnerHTML={{ __html: renderMarkdown(report.markdown, "report") }} />
            </div>
          </div>
          , document.body)}

        {/* 파이프라인 노드 상세 팝업 — 노드 종류(DB/분석/감지/해결/산출물)별로 내용이 달라진다 */}
        {pipelineDetail && unifiedResult && mounted && createPortal((() => {
          const close = () => setPipelineDetail(null);
          const integrated = unifiedResult.integrated;

          const sectionLabel = (text: string) => (
            <h4 className="mb-1.5 text-[11px] font-black uppercase tracking-wider text-[#94A8A0]">{text}</h4>
          );

          // 인용 출처 목록 — 카드가 참조한 SourceRef를 원문 링크와 함께 나열
          const renderSourceList = (ids: string[]) => (
            <div className="flex flex-col gap-2">
              {ids.map((id) => {
                const ref = unifiedResult.sources.find((s) => s.id === id);
                if (!ref) return null;
                return (
                  <div key={id} className="flex items-start justify-between gap-2 rounded-btn border border-[#DDE8E5]/60 bg-[#F6FAF8]/60 p-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="rounded bg-primary-50 px-1.5 py-0.5 text-[9px] font-black text-primary">{ref.id}</span>
                        {ref.phase === "live" && (
                          <span className="rounded-full bg-accent-50 px-1.5 py-0.5 text-[9px] font-black text-accent">실시간</span>
                        )}
                        <span className="block flex-1 truncate text-[13px] font-bold text-[#0D2318]">{ref.title}</span>
                      </div>
                      <span className="mt-0.5 block text-[10px] font-semibold text-[#94A8A0]">
                        {ref.date} · {UNIFIED_DB_LABEL[ref.database as UnifiedDatabaseId] ?? ref.database}
                      </span>
                    </div>
                    {ref.url && (
                      <a href={ref.url} target="_blank" rel="noopener noreferrer"
                        className="ml-2 flex shrink-0 items-center gap-0.5 text-xs font-bold text-primary transition hover:text-primary-light">
                        <ExternalLink size={12} /> 원문보기
                      </a>
                    )}
                  </div>
                );
              })}
            </div>
          );

          // 에비던스 카드 상세 — 결론·핵심 근거·참고 자료
          // bare: 팝업 제목에 DB명·메타 정보를 이미 표시한 단일 카드 뷰(STEP1)에서 박스-안-박스를 피하기 위한 모드
          const renderCardDetail = (card: EvidenceCard, badge?: string, bare?: boolean) => {
            const content = (
              <>
                {!bare && (
                  <div className="flex flex-wrap items-center gap-2 border-b border-[#F0F7F4] pb-2">
                    <span className="text-[14px] font-black text-[#0D2318]">{card.databaseLabel}</span>
                    {badge && <span className="rounded-full bg-primary-50 px-2 py-0.5 text-[10px] font-black text-primary">{badge}</span>}
                    <span className="ml-auto text-[10px] font-bold text-[#94A8A0]">
                      분석 기간 {getCardDateRange(card, unifiedResult.sources)} · 신뢰도 {card.confidence} · 자료 {card.itemCount}건
                    </span>
                  </div>
                )}
                <div>
                  {sectionLabel("분석 결론")}
                  {renderTextWithCitations(card.conclusion, "text-[17px]")}
                </div>
                {card.evidence && (
                  <div>
                    {sectionLabel("핵심 근거")}
                    {renderTextWithCitations(card.evidence, "text-[17px]")}
                  </div>
                )}
                {card.citedSources.length > 0 && (
                  <div>
                    {sectionLabel(`인용 자료 (${card.citedSources.length}건)`)}
                    {renderSourceList(card.citedSources)}
                  </div>
                )}
              </>
            );
            return bare
              ? <div className="flex flex-col gap-4">{content}</div>
              : <div className="flex flex-col gap-4 rounded-btn border border-[#DDE8E5] bg-white p-4">{content}</div>;
          };

          // STEP3 감지 결과 카테고리 박스 (충돌=레드 / 공백=앰버 / 신선도=블루)
          const detectBox = (
            label: string,
            list: Array<{ description: string; databases: string[] }>,
            tone: { text: string; border: string; bg: string; chip: string },
          ) => (
            <div className={`flex flex-col gap-2 rounded-btn border p-3.5 ${tone.border} ${tone.bg}`}>
              <div className="flex items-center justify-between border-b border-[#F0F7F4] pb-1.5">
                <span className={`text-[13px] font-black ${tone.text}`}>{label}</span>
                <span className={`rounded px-1.5 py-0.5 text-[10px] font-black ${tone.chip}`}>{list.length}건</span>
              </div>
              {list.length === 0 ? (
                <p className="text-[12px] font-semibold text-[#94A8A0]">감지되지 않음</p>
              ) : (
                list.map((item, i) => (
                  <div key={i} className="mb-2 last:mb-0">
                    {item.databases.length > 0 && (
                      <p className={`mb-1 text-[10px] font-bold ${tone.text}`}>
                        {item.databases.map((db) => UNIFIED_DB_LABEL[db as UnifiedDatabaseId] ?? db).join(" · ")}
                      </p>
                    )}
                    {renderTextWithCitations(item.description, "text-[17px]")}
                  </div>
                ))
              )}
            </div>
          );

          const RED = { text: "text-red-600", border: "border-red-100", bg: "bg-red-50/30", chip: "bg-red-100 text-red-700" };
          const AMBER = { text: "text-amber-600", border: "border-amber-100", bg: "bg-amber-50/30", chip: "bg-amber-100 text-amber-700" };
          const BLUE = { text: "text-blue-600", border: "border-blue-100", bg: "bg-blue-50/30", chip: "bg-blue-100 text-blue-700" };

          let title = "";
          let sub = "";
          let width = "max-w-2xl";
          let headerActions: React.ReactNode = null;
          let body: React.ReactNode = null;

          if (pipelineDetail.kind === "db") {
            const dbId = pipelineDetail.dbId;
            const card = unifiedResult.storedCards.find((c) => c.databaseId === dbId);
            const dbErrored = unifiedResult.skipped.some((s) => s.databaseId === dbId && s.errored);
            title = `${UNIFIED_DB_LABEL[dbId]} 리서치 결과`;
            sub = card
              ? `STEP 1 · 분석 기간 ${getCardDateRange(card, unifiedResult.sources)} · 신뢰도 ${card.confidence} · 자료 ${card.itemCount}건`
              : dbErrored ? "조회 중 오류가 발생해 분석에서 제외되었습니다" : "이 데이터베이스는 분석에서 제외되었습니다";
            width = "max-w-3xl";
            body = card ? (
              renderCardDetail(card, undefined, true)
            ) : (
              <div className={`rounded-btn border p-4 ${dbErrored ? "border-red-200 bg-red-50/30" : "border-[#DDE8E5] bg-[#F6FAF8]"}`}>
                {sectionLabel(dbErrored ? "오류 내용" : "제외 사유")}
                {unifiedResult.skipped
                  .filter((s) => s.databaseId === dbId && s.phase === "stored")
                  .map((s, i) => (
                    <p key={i} className={`text-[13px] leading-relaxed ${dbErrored ? "text-red-500" : "text-[#5F7A70]"}`}>{s.reason}</p>
                  ))}
              </div>
            );
          } else if (pipelineDetail.kind === "analysis") {
            const meta = {
              tag: { label: "연관 태그 분석", desc: "동시출현 태그 신호 기반", text: integrated.tagAnalysis },
              time: { label: "시계열 분석", desc: "월별 언급 추이 신호 기반", text: integrated.timeSeries },
              trend: { label: "트렌드 분석", desc: "최근 자료·실시간 스냅샷 기반", text: integrated.trend },
            }[pipelineDetail.which];
            title = meta.label;
            sub = unifiedResult.supplemented
              ? `STEP 2 · 전체 에비던스 카드 통합 · ${meta.desc} · STEP5 보강 반영(실시간 자료 포함)`
              : `STEP 2 · 전체 에비던스 카드 통합 · ${meta.desc}`;
            width = "max-w-3xl";
            body = meta.text
              ? renderTextWithCitations(
                meta.text,
                "text-[17px]",
                pipelineDetail.which === "tag"
                  ? (sentence, idx) => idx === 0 || /^(첫|두|세|네)\s*번째\s*클러스터|^(첫|둘|셋|넷)째/.test(sentence.trim())
                  : undefined
              )
              : <p className="text-[17px] leading-relaxed text-[#33493F]">분석 결과가 없습니다.</p>;
          } else if (pipelineDetail.kind === "detection") {
            title = "의견 충돌 · 데이터 보완 결과";
            sub = unifiedResult.supplemented
              ? "STEP 3 · 통합 결론을 3가지 관점에서 검증 · STEP5 보강 반영(실시간 자료 포함)"
              : "STEP 3 · 통합 결론을 3가지 관점에서 검증";
            width = "max-w-6xl";
            body = (
              <div className="flex flex-col gap-5">
                <div>
                  {sectionLabel("통합 결론")}
                  {renderTextWithCitations(integrated.summary, "text-[17px]")}
                </div>
                <div className="grid gap-3 md:grid-cols-3">
                  {detectBox("의견 충돌", integrated.conflicts, RED)}
                  {detectBox("정보 공백", integrated.gaps, AMBER)}
                  {detectBox("신선도 의심", integrated.old ?? [], BLUE)}
                </div>
              </div>
            );
          } else if (pipelineDetail.kind === "remedy" && pipelineDetail.which === "debate") {
            const debate = unifiedResult.debate;
            title = "AI 찬반토론 — 의견 충돌 해소";
            sub = "STEP 4-1 · Bull/Bear 입론 → 반박 → 종합 판정";
            width = "max-w-4xl";
            body = (
              <div className="flex flex-col gap-5">
                {debate ? (
                  <>
                    <div className="flex flex-col gap-3">
                      <div>
                        <div className="mb-1 flex items-center gap-2">
                          <span className="text-[11px] font-black text-[#94A8A0]">종합 판정</span>
                        </div>
                        {renderTextWithCitations(debate.rationale, "text-[17px]")}
                      </div>
                      <div>
                        <span className="text-[11px] font-black text-[#94A8A0]">관찰 포인트</span>
                        {renderTextWithCitations(debate.watchpoints, "text-[17px]")}
                      </div>
                    </div>
                    <div>
                      {sectionLabel("해결 과정 — 찬반 검증 토론")}
                      <div className="grid gap-3 md:grid-cols-2">
                        <div className="rounded-btn border border-red-100 bg-red-50/20 p-3.5">
                          <p className="mb-2 flex items-center gap-1 text-[13px] font-black text-red-600">
                            <TrendingUp size={13} /> {debate.frame === "macro" ? "매크로 낙관론" : "긍정적 관점 (Bull)"}
                          </p>
                          {renderTextWithCitations(debate.proOpening, "text-[17px]")}
                          {debate.proRebuttal && (
                            <div className="mt-2.5 border-t border-red-100/60 pt-2.5">
                              <p className="mb-1 text-[11px] font-bold text-red-500">반론 및 방어</p>
                              {renderTextWithCitations(debate.proRebuttal, "text-[17px]")}
                            </div>
                          )}
                        </div>
                        <div className="rounded-btn border border-blue-100 bg-blue-50/20 p-3.5">
                          <p className="mb-2 flex items-center gap-1 text-[13px] font-black text-blue-600">
                            <TrendingDown size={13} /> {debate.frame === "macro" ? "매크로 비관론" : "부정적 관점 (Bear)"}
                          </p>
                          {renderTextWithCitations(debate.conOpening, "text-[17px]")}
                          {debate.conRebuttal && (
                            <div className="mt-2.5 border-t border-blue-100/60 pt-2.5">
                              <p className="mb-1 text-[11px] font-bold text-blue-500">반론 및 방어</p>
                              {renderTextWithCitations(debate.conRebuttal, "text-[17px]")}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </>
                ) : (
                  <p className="text-[13px] font-semibold text-[#94A8A0]">토론 결과가 저장되지 않았습니다.</p>
                )}
              </div>
            );
          } else if (pipelineDetail.kind === "remedy" && pipelineDetail.which === "live") {
            title = "실시간 리서치 — 정보 보강";
            const firstCard = unifiedResult.liveCards[0];
            sub = firstCard
              ? `STEP 4-2 · 분석 기간 ${getCardDateRange(firstCard, unifiedResult.sources)} · 신뢰도 ${firstCard.confidence} · 자료 ${firstCard.itemCount}건`
              : "STEP 4-2 · 출처 부족·신선도 의심으로 지목된 DB의 최신 데이터를 실시간 재수집";
            width = "max-w-3xl";
            body = (
              <div className="flex flex-col gap-5">
                {unifiedResult.liveCards.length === 0 ? (
                  <p className="text-[13px] font-semibold text-[#94A8A0]">실시간으로 수집된 새 자료가 없습니다.</p>
                ) : (
                  <div className="flex flex-col gap-6">
                    {unifiedResult.liveCards.map((card, i) => (
                      <div key={i} className="flex flex-col gap-4">
                        {renderCardDetail(card, undefined, true)}
                      </div>
                    ))}
                  </div>
                )}
                {unifiedResult.skipped.filter((s) => s.phase === "live").length > 0 && (
                  <div className="rounded-btn border border-[#DDE8E5] bg-[#F6FAF8] p-3">
                    <p className="mb-1 text-[11px] font-black text-[#94A8A0]">보강 제외</p>
                    {unifiedResult.skipped.filter((s) => s.phase === "live").map((s, i) => (
                      <p key={i} className="text-[12px] leading-relaxed text-[#5F7A70]">
                        {UNIFIED_DB_LABEL[s.databaseId as UnifiedDatabaseId] ?? s.databaseId} — {s.reason}
                      </p>
                    ))}
                  </div>
                )}
              </div>
            );
          } else if (pipelineDetail.kind === "output" && unifiedResult.method === "report") {
            // 보고서 출력 — 모달 껍데기 없이 브리핑 보고서 자체를 팝업으로 띄운다 (전 키워드 유형 공통)
            // (뷰어에 Markdown 복사·PDF 다운로드·닫기 툴바와 종목 링크 처리 내장)
            const brief = unifiedResult.keywordType === "macro"
              ? { kicker: "Macro Research Briefing", subtitle: `#${unifiedResult.keyword} 매크로 분석 리포트`, pdf: "Macro_Report" }
              : unifiedResult.keywordType === "theme"
              ? { kicker: "Industry & Theme Briefing", subtitle: `#${unifiedResult.keyword} 산업·테마 분석 리포트`, pdf: "Theme_Report" }
              : { kicker: "Equity Research Briefing", subtitle: `#${unifiedResult.keyword} 종목 분석 리포트`, pdf: "Stock_Report" };
            return (
              <div className="fixed inset-0 z-[110] flex items-start justify-center overflow-y-auto bg-black/45 p-4 pb-10" onClick={close}>
                <div className="w-full max-w-5xl" onClick={(e) => e.stopPropagation()}>
                  <BriefingReportViewer
                    report={unifiedResult.report ?? ""}
                    metricCharts={unifiedResult.metricCharts ?? []}
                    kicker={brief.kicker}
                    subtitle={brief.subtitle}
                    pdfFilePrefix={brief.pdf}
                    onClose={close}
                    onStockClick={(name, ticker) => {
                      const isDomestic = /^[0-9]{6}\.(?:KS|KQ)$/.test(ticker);
                      updateSharedUiState({
                        tab2: {
                          ...sharedUiState.tab2,
                          activeInnerTab: "stock-analysis",
                          incomingSelectedStock: {
                            code: isDomestic ? ticker.slice(0, 6) : ticker,
                            name,
                            ticker,
                            market: isDomestic ? ("domestic" as const) : ("overseas" as const),
                          },
                          selectedTheme: null,
                        },
                      });
                      setPipelineDetail(null);
                      setSelected(null);
                      router.push("/maintab/tab2");
                    }}
                  />
                </div>
              </div>
            );
          } else if (pipelineDetail.kind === "output") {
            const score = unifiedResult.score;
            title = `#${unifiedResult.keyword} 데이터 수치화`;
            sub = "정량 · 정성 평가 스코어";
            width = "max-w-3xl";
            body = !score ? (
              <p className="text-[13px] font-semibold text-[#94A8A0]">점수 산정 결과가 없습니다.</p>
            ) : (
              <div className="flex flex-col gap-4">
                <div className="flex flex-col gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full bg-primary-50 px-3 py-1 text-xs font-black text-primary">종합 판정: {score.verdict}</span>
                    <span className="rounded-full border border-[#DDE8E5] bg-[#F6FAF8] px-2.5 py-1 text-xs font-bold text-[#4B6358]">확신도 {score.confidence}</span>
                  </div>
                  <p className="text-[17px] font-semibold leading-relaxed text-[#33493F]">{score.keyReason}</p>
                </div>

                <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                  {([
                    { label: "종목 긍정도 (Sentiment)", value: score.sentimentScore, tone: "text-primary", empty: null },
                    { label: "최근 언급 강도 (Buzz)", value: score.buzzScore, tone: "text-amber-500", empty: "데이터 없음" },
                    { label: "매수 추천도 (Buy Strength)", value: score.buyStrength, tone: "text-rose-500", empty: "종목 분석만 지원" },
                  ] as const).map((g) => (
                    <div key={g.label} className="flex flex-col items-center rounded-btn border border-[#DDE8E5] bg-[#F6FAF8]/40 p-4 text-center">
                      <span className="mb-1.5 text-xs font-bold text-[#5F7A70]">{g.label}</span>
                      {g.value !== null ? (
                        <div className="relative flex h-20 w-20 items-center justify-center">
                          <svg className="h-full w-full -rotate-90 transform" viewBox="0 0 36 36">
                            <path className="text-[#EEF4F1]" strokeWidth="3" stroke="currentColor" fill="none" d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" />
                            <path className={g.tone} strokeDasharray={`${g.value}, 100`} strokeWidth="3" strokeLinecap="round" stroke="currentColor" fill="none" d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" />
                          </svg>
                          <span className="absolute text-[18px] font-black text-[#0D2318]">{g.value}%</span>
                        </div>
                      ) : (
                        <span className="my-auto text-sm text-[#94A8A0]">{g.empty}</span>
                      )}
                    </div>
                  ))}
                </div>

                <div className="rounded-btn border border-[#DDE8E5] bg-[#F6FAF8]/50 p-3.5">
                  {sectionLabel("산정 논거 (Rationale)")}
                  {renderParagraphWithCitations(score.rationale, "text-[17px]")}
                </div>
                <div className="rounded-btn border border-[#DDE8E5] bg-[#F6FAF8]/50 p-3.5">
                  {sectionLabel("관찰 포인트 (Watchpoints)")}
                  {renderParagraphWithCitations(score.watchpoints, "text-[17px]")}
                </div>
              </div>
            );
          }

          return (
            <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/45 p-4" onClick={close}>
              <div className={`flex max-h-[85vh] w-full ${width} flex-col overflow-hidden rounded-card bg-white shadow-popup`} onClick={(e) => e.stopPropagation()}>
                <div className="flex items-center justify-between gap-3 border-b-2 border-primary px-6 py-4">
                  <div className="min-w-0">
                    <h3 className="truncate text-[16px] font-black text-[#0D2318]">{title}</h3>
                    {sub && <p className="mt-0.5 text-[11px] font-bold text-[#94A8A0]">{sub}</p>}
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {headerActions}
                    <button type="button" onClick={close} className="text-[#B9CCC4] transition hover:text-[#4B6358]"><X size={18} /></button>
                  </div>
                </div>
                <div className="overflow-y-auto px-6 py-5">{body}</div>
              </div>
            </div>
          );
        })(), document.body)}

        {/* 통합 리서치 데이터베이스 선택 모달 */}
        {showDbModal && mounted && createPortal(
          <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4" onClick={() => setShowDbModal(false)}>
            <div className="flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden rounded-card bg-white shadow-popup" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center justify-between gap-3 border-b-2 border-primary px-6 py-4">
                <div>
                  <h3 className="flex items-center gap-2 text-[16px] font-black text-[#0D2318]">
                    <Sparkles size={16} className="text-primary" />
                    통합 리서치 분석 데이터베이스 선택
                  </h3>
                  <p className="mt-0.5 text-[11px] font-bold text-[#94A8A0]">
                    #{activeTags[0]} 에 대한 다중 데이터베이스 통합 분석을 시작합니다 (충돌/공백 감시, 필요시 실시간 리서치)
                  </p>
                </div>
                <button type="button" onClick={() => setShowDbModal(false)} className="text-[#B9CCC4] transition hover:text-[#4B6358]"><X size={18} /></button>
              </div>
              <div className="overflow-y-auto px-6 py-5">
                <div className="mb-5 border-b border-[#F0F7F4] pb-4.5">
                  <h4 className="mb-2 text-[11px] font-black uppercase tracking-wide text-[#94A8A0]">분석 방법</h4>
                  <div className="flex gap-2">
                    <label
                      className={`flex flex-1 cursor-pointer items-center gap-2 rounded-btn border px-3 py-2.5 text-[13px] font-black transition ${analysisMethod === "report" ? "border-primary bg-primary-50 text-primary" : "border-[#DDE8E5] text-[#4B6358] hover:border-primary/40"
                        }`}
                    >
                      <input type="checkbox" checked={analysisMethod === "report"} onChange={() => setAnalysisMethod("report")} className="h-4 w-4 shrink-0 accent-primary" />
                      종합 보고서 출력 (Report)
                    </label>
                    <label
                      className={`flex flex-1 cursor-pointer items-center gap-2 rounded-btn border px-3 py-2.5 text-[13px] font-black transition ${analysisMethod === "score" ? "border-primary bg-primary-50 text-primary" : "border-[#DDE8E5] text-[#4B6358] hover:border-primary/40"
                        }`}
                    >
                      <input type="checkbox" checked={analysisMethod === "score"} onChange={() => setAnalysisMethod("score")} className="h-4 w-4 shrink-0 accent-primary" />
                      정량/정성 점수 산정 (Score)
                    </label>
                  </div>
                </div>


                {(() => {
                  const kwType = activeTags.length === 1 ? classifyMap.get(activeTags[0]) : "stock";
                  const groups = [
                    {
                      label: "인사이트 피드 데이터베이스",
                      ids: ["telegram", "news", "report"] as UnifiedDatabaseId[],
                    },
                    kwType === "macro" ? {
                      label: "매크로 데이터 소스",
                      ids: MACRO_SOURCE_DBS,
                    } : kwType === "theme" ? {
                      label: "산업/테마 정보 분석 툴",
                      ids: ["correlation", "peer"] as UnifiedDatabaseId[],
                    } : {
                      label: "종목/재무 정보 분석 툴",
                      ids: ["technical", "options", "holdings", "dart", "financials"] as UnifiedDatabaseId[],
                    }
                  ];
                  return groups;
                })().map((group) => (
                  <div key={group.label} className="mb-4 last:mb-0">
                    <h4 className="mb-2 text-[11px] font-black uppercase tracking-wide text-[#94A8A0]">{group.label}</h4>
                    <div className="grid grid-cols-2 gap-2">
                      {group.ids.map((id) => {
                        const checked = selectedDbs.has(id);
                        return (
                          <label
                            key={id}
                            className={`flex cursor-pointer items-center gap-2 rounded-btn border px-3 py-2 text-[13px] font-bold transition ${checked ? "border-primary bg-primary-50 text-primary" : "border-[#DDE8E5] text-[#4B6358] hover:border-primary/40"
                              }`}
                          >
                            <input type="checkbox" checked={checked} onChange={() => toggleDbSelection(id)} className="h-4 w-4 shrink-0 accent-primary" />
                            {UNIFIED_DB_LABEL[id]}
                          </label>
                        );
                      })}
                    </div>
                  </div>
                ))}
                {dbModalError && (
                  <p className="mt-1 rounded-btn border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold text-red-600">{dbModalError}</p>
                )}
              </div>
              <div className="flex items-center justify-end gap-2 border-t border-[#F0F7F4] px-6 py-4">
                <button type="button" onClick={() => setShowDbModal(false)}
                  className="rounded-btn border border-[#DDE8E5] px-4 py-2 text-[13px] font-bold text-[#4B6358] transition hover:bg-[#F6FAF8]">
                  취소
                </button>
                <button type="button" onClick={() => void startUnifiedJob()} disabled={unifiedStarting}
                  className="flex items-center gap-1.5 rounded-btn bg-primary px-4 py-2 text-[13px] font-black text-white transition hover:bg-primary-light disabled:opacity-50">
                  {unifiedStarting ? <Loader2 size={13} className="animate-spin" /> : <FileText size={13} />}
                  {unifiedStarting ? "STEP 1 실행 중…" : "승인 · STEP 1 (" + selectedDbs.size + "개 DB) 실행"}
                </button>
              </div>
            </div>
          </div>
          , document.body)}
      </div>
    </div>
  );
}


