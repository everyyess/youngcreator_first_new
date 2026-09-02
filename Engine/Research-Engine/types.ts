/**
 * 통합 리서치 엔진 — 공용 타입
 *
 * 기존 4개 추론 로직을 하나의 파이프라인으로 통합한다:
 *  · TAB4 통합 인사이트 "AI 인사이트"   → STEP2 통합 단계의 태그/시계열/트렌드 분석 프레임(1회)
 *  · TAB4 "AI 찬반토론(리서치 데스크)"  → STEP4-1 토론 프레임 (conflicts 감지 시에만 실행)
 *  · TAB2 "AI 기업개요"                → 보고서의 [Fact]/[판단] 표기·출처 규율
 *  · TAB3 "AI 논증(미니 토론)"          → 점수화(convictionScore) 프레임
 *
 * 파이프라인: 오케스트레이터
 *   STEP1   지정 [데이터베이스]별 병렬 에이전트 — 저장(Supabase/DART 캐시) 데이터에서
 *           "분석 결론·근거"만 산출(에비던스 카드). 태그/시계열/트렌드는 여기서 하지 않는다
 *           (DB마다 반복하면 비효율 — 아래 STEP2에서 전체를 합쳐 1회만 수행).
 *   STEP2   카드 통합 + 연관 태그·시계열·트렌드 종합 분석(1회) — 결정론적 신호(동시출현 태그·
 *           월별 추이·최근 자료)를 코드가 계산해 얹고, LLM이 그 신호와 카드를 근거로 해석
 *   STEP3   충돌(conflicts)·공백(gaps)·신선도 부족(old) 감지 — STEP2와 LLM 호출 1번으로 함께 수행
 *   STEP4-1 conflicts 발생 시 찬반 토론으로 결론 검증
 *   STEP4-2 gaps(출처 부족)·old(신선도 부족) 중 하나라도 발생 시 실시간 데이터 보강 리서치
 *           (Loop Research는 폐기 — 애초에 저장 자료 자체가 적어 재수집해도 새 자료가 없는 경우가
 *           대부분이라 실효성이 없었음. 대신 두 문제 모두 같은 실시간 보강 경로로 합류시킨다.)
 *           4-1/4-2는 서로 독립적이라 병렬 실행하고, 새 카드가 생기면 STEP5에서 한 번만 재통합한다
 *   STEP5   신규 카드가 있으면 STEP2 통합을 재실행(최종 요약·태그·시계열·트렌드 갱신) →
 *           [분석 방법]=report(분류별 목차 보고서) | score(수치화)
 */

export type DatabaseGroup = "tab4" | "tab2" | "tab6";

/**
 * 지정 가능한 데이터베이스 — TAB4 5개 DB(youtube/blog/telegram/news/report) +
 * TAB2 종목분석 탭의 4개 분석 툴(technical=기술적/options=옵션/holdings=수급/dart=공시) +
 * OpenDART 재무제표 기반 financials(재무 분석). ("외부자료" 툴은 TAB4의 report·telegram 2단계
 * 실시간 보강(naver-reports·telegram-search)과 완전히 겹쳐 제거하고 financials로 대체했다.)
 * 추후 registry(databases.ts)에 정의만 추가하면 확장된다.
 */
export type DatabaseId =
  | "youtube" | "blog" | "telegram" | "news" | "report"
  | "technical" | "options" | "holdings" | "dart" | "financials"
  | "correlation" | "peer"
  // TAB6 외부 데이터 소스 (Daily Briefing)
  | "alphavantage" | "finnhub" | "fred" | "ecos" | "kosis";

export type AnalysisMethod = "report" | "score";
export type Confidence = "높음" | "중간" | "낮음";

/**
 * 키워드 분류 — stock/theme/macro는 insightAggregates.TagType과 동일 의미(자동 분류 대상),
 * overnight/market은 자동 분류로는 나오지 않는 tab6 전용 강제 지정 모드다.
 *  stock    = 개별종목
 *  theme    = 산업·테마
 *  macro    = 매크로·경제
 *  overnight= 전날 오버나이트 브리핑 (tab6 전용 파이프라인)
 *  market   = 시황 분석 (tab6 전용 — 증권사 일일 시황 레포트 포맷, report DB 자동 선택)
 */
export type KeywordType = "stock" | "theme" | "macro" | "overnight" | "market";

// (구 QUICK/DEEP depth 파라미터는 제거됨 — 토론은 depth가 아니라 STEP3 conflicts 감지로 트리거된다)
// (구 preferredModel 파라미터도 제거됨 — 단계별 티어 고정: 추출·압축 단계는 SIMPLE_MODELS,
//  통합·판정·보고서·점수는 DEEP_MODELS. lib/geminiModels.ts::DEEP_MODELS 주석 참고)
export type UnifiedResearchRequest = {
  keyword: string;              // [키워드]
  databases: DatabaseId[];      // [데이터베이스] — overnight 모드에서는 무시되고 자동 지정
  method: AnalysisMethod;       // [분석 방법]
  ticker?: string;              // TAB2 계열 DB 사용 시 필수 (6자리 종목코드)
  corpName?: string;            // 종목명 (미지정 시 keyword 사용)
  baseUrl?: string;             // 내부 API 호출용 Base URL
  keywordType?: KeywordType;    // 강제 지정 — "overnight" 시 overnight 파이프라인으로 분기
  injectedContext?: string;       // macroNewsContext에 선행 주입 — 유사 국면 탐색 등 외부 컨텍스트
  prebuiltCards?: EvidenceCard[]; // STEP1 이전에 주입할 미리 생성된 에비던스 카드 (유사 국면 비교 데이터 등)
  isSimilarityAnalysis?: boolean; // true → STEP1/STEP4-2/최근뉴스 모두 패스, 유사 국면 전용 파이프라인
};

/** 전 파이프라인 공용 인용 단위 — 카드·통합·토론·보고서가 같은 S# ID로 출처를 추적한다 */
export type SourceRef = {
  id: string;                   // "S1", "S2", ...
  database: DatabaseId;
  phase: "stored" | "live";
  title: string;
  url: string | null;
  date: string;                 // yyyy-mm-dd
};

/**
 * 에비던스 카드 — 에이전트 산출물의 압축 형태.
 * 전체 대화가 아니라 "분석 결론 · 근거 · 출처 · 기준일 · 신뢰도"만 다음 단계로 전달한다.
 * 연관 태그·시계열·트렌드는 카드 단위가 아니라 STEP2에서 전체 카드를 합쳐 1회만 산출한다
 * (IntegratedContext.tagAnalysis/timeSeries/trend 참고).
 */
export type EvidenceCard = {
  databaseId: DatabaseId;
  databaseLabel: string;
  phase: "stored" | "live";
  conclusion: string;           // 분석 결론
  evidence: string;             // 근거 (S# 인용)
  citedSources: string[];       // 인용한 SourceRef id
  asOfDate: string;             // 기준일 (자료 최신일)
  confidence: Confidence;       // 신뢰도
  itemCount: number;
};

export type SkippedDatabase = {
  databaseId: DatabaseId;
  phase: "stored" | "live";
  reason: string;
  /** true면 데이터 없음이 아니라 조회 중 예외가 발생한 것 — UI가 "스킵됨"과 구분해 "오류 발생"으로 표기 */
  errored?: boolean;
};

/**
 * fetchStored/fetchLive에서 "이 종목/조건에는 원래 지원하지 않는 분석"임을 알릴 때 던진다.
 * 오케스트레이터가 이를 잡으면 errored:true 없이 skipped에 기록해 UI에 "오류 발생"이 아닌
 * "스킵됨"으로 표기한다 (예: 옵션 분석은 국내 상장 종목을 지원하지 않음).
 */
export class SkipDatabaseError extends Error {}

export type IntegrationConflict = { description: string; databases: string[] };
/** 출처 부족·단일 소스 의존 — 시간과 무관한 커버리지 문제. STEP4-2 실시간 보강으로 해결 */
export type IntegrationGap = { description: string; databases: string[] };
/** 기준일이 오래돼 신선도 의심 — STEP4-2 실시간 보강(최신 데이터 재수집)으로 해결 */
export type IntegrationOld = { description: string; databases: string[] };

/** overnight 모드 전용 — 이슈별 자산군 파급 효과 */
export type OvernightAssetImpact = {
  assetClass: string;                              // "국내주식", "미국채권", "원자재", "달러/원" 등
  direction: "positive" | "negative" | "neutral";
  reason: string;
};

/** overnight 모드 전용 — 핵심 이슈 1개의 팩트·판단·자산 파급 */
export type OvernightIssue = {
  title: string;           // 이슈 제목 (1줄)
  factBrief: string;       // 사실 요약 — 문장 끝 [팩트][#n]/[인용][#n] 태그 (TAB4 표기 규율)
  inferBrief: string;      // 파급 경로 추론 — 문장 끝 [판단(숫자)] 태그
  assetImpacts: OvernightAssetImpact[];
};

/**
 * 통합 컨텍스트 — 오케스트레이터의 STEP2(통합+태그/시계열/트렌드)·STEP3(검증) 산출물.
 * STEP5 재통합(refresh 모드)은 summary/tagAnalysis/timeSeries/trend만 갱신하고,
 * conflicts/gaps/old는 STEP3의 원래 감지 결과를 보존한다 (STEP4 실행 사유가 UI에 그대로 남도록).
 *
 * overnight 전용 필드(overnightOneLiner/overnightIssues/overnightWatchpoints)는
 * keywordType==="overnight" 파이프라인에서만 채워진다.
 */
export type IntegratedContext = {
  summary: string;              // 통합 결론 (S# 인용 유지)
  tagAnalysis: string;          // 연관 태그 분석 — 전체 카드를 합쳐 1회 산출 (동시출현 신호 기반)
  timeSeries: string;           // 시계열 분석 — 전체 카드를 합쳐 1회 산출 (월별 추이 신호 기반)
  trend: string;                // 트렌드 분석 — 전체 카드를 합쳐 1회 산출 (최근 자료·실시간 스냅샷 기반)
  conflicts: IntegrationConflict[]; // DB 간 결론 충돌·맥락 불일치
  gaps: IntegrationGap[];           // 출처 부족·단일 소스 의존 (시간 무관) — needsSupplement 트리거
  old: IntegrationOld[];            // 기준일이 오래돼 신선도 의심 — needsSupplement 트리거
  needsSupplement: boolean;         // true면 STEP4-2 실시간 보강 리서치 트리거 (gaps.length > 0 || old.length > 0)
  // overnight 전용
  overnightOneLiner?: string;
  overnightIssues?: OvernightIssue[];
  overnightJudgments?: string[];    // "[판단(n)]: 근거" 목록 — 보고서 말미 "**판단 근거**" 섹션
  overnightWatchpoints?: string;
};

export type DebateSection = {
  frame: "stock-theme" | "macro";
  proOpening: string;
  conOpening: string;
  proRebuttal: string;
  conRebuttal: string;
  verdict: string;
  rationale: string;
  watchpoints: string;
  confidence: Confidence;
};

export type ScoreResult = {
  sentimentScore: number;       // 0~100 — 분석 결과가 얼마나 긍정적인가 (LLM 산출)
  buzzScore: number | null;     // 0~100 — 최근 언급 강도 (저장 자료 시계열로 결정론 계산, TAB4 자료 없으면 null)
  buyStrength: number | null;   // 0~100 — 매수 강도 (종목 키워드일 때만, conviction 방식 결정론 합성)
  verdict: string;
  confidence: Confidence;
  keyReason: string;            // 핵심 이유 1문장
  rationale: string;
  watchpoints: string;
};

/** 오케스트레이터 진행 단계 — 백그라운드 작업 스토어·진행률 UI가 공유한다 */
export type ResearchStage =
  | "collecting" | "integrating" | "supplementing" | "debating" | "reintegrating" | "reporting" | "scoring" | "done" | "error";

export type ProgressCallback = (stage: ResearchStage, percent: number, label: string) => void;

/** STEP1 개별 DB 에이전트의 완료 상태 콜백 — 잡 스토어가 받아 파이프라인 UI의 DB 노드별 진행 표시에 쓴다 */
export type DbStateCallback = (db: DatabaseId, state: "done" | "skipped" | "error") => void;

// ─── Market Report JSON — 슬라이드형 리포트 (tab6 시황 분석 전용) ────────────

export type ReportChartSource = "FRED" | "ECOS";

export type ReportChartItem = {
  title: string;
  dataId: string;
  source: ReportChartSource;
};

export type ReportPageLayout = "DoubleChart" | "SingleChart" | "TextOnly" | "TableCard";

export type ReportPage = {
  section: string;
  title: string;
  layout: ReportPageLayout;
  charts?: ReportChartItem[];
  comment: string;
  table?: { headers: string[]; rows: string[][] };
};

export type MarketReportJson = {
  cover: { title: string; subtitle: string; oneLiner: string };
  pages: ReportPage[];
};

// ─────────────────────────────────────────────────────────────────────────────

export type UnifiedResearchResult = {
  keyword: string;
  keywordType: KeywordType;
  method: AnalysisMethod;
  databases: DatabaseId[];
  sources: SourceRef[];         // 전체 인용 출처 (S# → 서지)
  storedCards: EvidenceCard[];  // STEP1 산출
  liveCards: EvidenceCard[];    // STEP4-2 실시간 보강 산출 (gaps·old 기반)
  skipped: SkippedDatabase[];
  integrated: IntegratedContext;
  supplemented: boolean;        // STEP4-2 실시간 보강 실행 여부
  debate: DebateSection | null; // STEP4-1 — conflicts 감지 시에만
  report: string | null;        // method=report — 마크다운 (각주·출처 포함)
  score: ScoreResult | null;    // method=score
  timings: Record<string, number>; // 단계별 소요 ms
  generatedAt: string;          // ISO
  modelUsage?: Record<string, number>; // 모델별 사용 횟수
};

