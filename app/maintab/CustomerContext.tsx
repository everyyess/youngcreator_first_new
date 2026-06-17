"use client";

import { createContext, useContext } from "react";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// ── Types ──────────────────────────────────────────────────────────────────
export type CustomerId = string;

export type FinancialInfo = {
  totalAssets: string;
  financialAssets: string;
  existingInvestmentAssets: string;
  cashAssets: string;
  realEstate: string;
  debt: string;
  annualFixedIncome: string;
  irregularIncome: string;
  irregularIncomeNone: boolean;
  investableAssets: string;
  monthlyFixedExpense: string;
};

export type HeaderAssetSummaryState = {
  confirmedOperatingAssetsAfterSell: number | null;
  confirmedOperatingAssetsAfterBuy: number | null;
  confirmedBuyAmount: number | null;
};

export type RrttlluInfo = {
  returnObjective: string;
  expectedReturn: string;
  expectedReturnUnknown: boolean;
  investmentExperience: string[];
  knowledgeLevel: string;
  derivativesExperience: string;
  financialAssetRatio: string;
  investmentAssetRatio: string;
  riskAttitude: string;
  lossResponse: string;
  timeHorizon: string;
  expectedInterestIncome: string;
  expectedDividendIncome: string;
  giftingPlan: string;
  globalTaxImportance: string;
  recentGlobalTaxSubject: string;
  foreignStockTaxImportance: string;
  regularCashflowNeed: string;
  lumpSumPlan: string;
  emergencyReservePlan: string;
  legalConstraints: string[];
  legalConstraintOther: string;
  preferredAssets: string;
  avoidedAssets: string;
  holdingOrDisposalPlan: string;
  uniqueOther: string;
};

export type RiskLevel = "초저위험" | "저위험" | "중위험" | "고위험" | "초고위험";

export type RiskResult = {
  score: number;
  level: RiskLevel;
  answers: {
    investment_experience: string[];
    investment_knowledge: string;
    derivatives_experience: string;
    financial_assets_ratio: string;
    investment_assets_ratio: string;
    risk_attitude: string;
    loss_response: string;
  };
  interpretation: string;
};

export type StructuredJsonPayload = {
  basic_financial_info: {
    asset_summary: string | null;
    annual_fixed_income: string | null;
    irregular_income: string | null;
    investable_assets: string | null;
    monthly_fixed_expense: string | null;
  };
  rrttllu: {
    return: { objective: string | null; expected_return: string | null };
    risk: {
      score: number;
      level: RiskLevel;
      answers: {
        investment_experience: string[] | null;
        investment_knowledge: string | null;
        derivatives_experience: string | null;
        financial_assets_ratio: string | null;
        investment_assets_ratio: string | null;
        risk_attitude: string | null;
        loss_response: string | null;
      };
      interpretation: string;
    };
    time_horizon: { investment_period: string | null };
    tax: {
      expected_interest_income: string | null;
      expected_dividend_income: string | null;
      gift_plan: string | null;
      financial_income_tax_importance: string | null;
      financial_income_tax_history: string | null;
      foreign_stock_capital_gains_tax_importance: string | null;
      financial_income_tax_alert: string;
    };
    liquidity: {
      cashflow_need: string | null;
      large_cash_need: string | null;
      emergency_reserve_need: string | null;
    };
    legal: { constraints: string[] | null; other_detail: string | null };
    unique_circumstances: {
      preferred_assets: {
        raw_input: string | null;
        portfolio_rule: { type: "soft_constraint"; description: string; min_weight_hint: "10%" };
      };
      avoided_assets: {
        raw_input: string | null;
        portfolio_rule: { type: "hard_constraint"; description: string; max_weight: "0%" };
      };
      existing_asset_plan: string | null;
      other: string | null;
    };
    warnings: string[];
  };
};

export type ChangeEntry = { label: string; before: string; after: string; changedAt: number };

export type CustomerUpdatedMap = Record<CustomerId, number>;

export type StoredAdvisoryGuideLine = { text: string; highlights?: string[]; memoItems?: string[] };
export type StoredAdvisoryGuideCheckpoint = { id: string; title: string; prompt?: string };
export type StoredAdvisoryGuide = {
  conflicts: { lines: StoredAdvisoryGuideLine[] };
  followUps: { lines: StoredAdvisoryGuideLine[]; checkpoints: StoredAdvisoryGuideCheckpoint[] };
  explanation: { lines: StoredAdvisoryGuideLine[] };
};

export type AppState = { financial: FinancialInfo; rrttllu: RrttlluInfo; smartInputNote: string; uniqueOtherManual: string; smartExtractedUniqueOther: string; aiGuidePbNotes: Record<string, string>; aiAdvisoryGuide: StoredAdvisoryGuide | null; aiGuidePayloadSignature: string; aiGuideGeneratedAt: string; headerAssetSummary: HeaderAssetSummaryState };

export type CustomerProfile = {
  id: CustomerId;
  name: string;
  gender: string;
  birthYear: string;
  birth_year?: string;
  age: string;
  job: string;
  data?: AppState;
  sort_order?: number;
  fallbackName?: string;
  fallbackBirthYear?: string;
};

export type StoredCustomerState = {
  customerProfiles: CustomerProfile[];
  customerData: Record<CustomerId, AppState>;
  selectedCustomer: CustomerId;
};

export type SmartExtractionPayload = {
  profile?: Partial<Pick<CustomerProfile, "name" | "gender" | "birthYear" | "birth_year" | "age" | "job">>;
  financial?: Partial<FinancialInfo>;
  rrttllu?: Partial<RrttlluInfo>;
};

export type CustomerRow = {
  id: string;
  profile?: CustomerProfile;
  app_state?: AppState;
  sort_order?: number;
  updated_at?: string;
  [key: string]: unknown;
};

export type StorageResult = { ok: boolean; message: string };

// ── Constants ──────────────────────────────────────────────────────────────
export const workspaceTabs = [
  { id: "profile"   as const, label: "고객 성향 분석",       description: "기본 정보와 RRTTLLU 입력" },
  { id: "existing"  as const, label: "기존 포트폴리오 분석", description: "보유 자산, 위험 및 건강 분석" },
  { id: "create"    as const, label: "신규 포트폴리오 생성", description: "RRTTLLU 기반 신규 배분" },
  { id: "compare"   as const, label: "포트폴리오 비교",       description: "기존과 신규 비교" },
  { id: "recommend" as const, label: "상품 추천",             description: "버킷별 상품 추천" },
];

// ── Portfolio Analysis Types ───────────────────────────────────────────────
export type PortfolioAsset = {
  name: string;
  asset_class: string;
  theme: string;
  country: string;
  buy_price: number | null;
  amount: number;
  amount_type: "quantity" | "value";
  is_hedged: boolean;        // 항상 false — 환노출 고정
  needs_review: boolean;
  review_reason?: string | null;
  current_price?: number;
  current_value?: number;
  weight?: number;
  gain?: number;
  price_source?: string;
  _rawAmount?: string;
  ticker?: string;           // Yahoo Finance 티커 (Gemini 자동완성 또는 직접 입력)
  productType?: string;      // 통합 상품유형 (국내주식|해외주식|국내채권|해외채권|국내ETF|해외ETF|예적금/현금)
  bond_yield?: number | null;    // 채권 수익률(%) — 채권 유형일 때만 사용
  bond_maturity?: number | null; // 채권 만기(년) — 채권 유형일 때만 사용
  // 데이터 소유권 낙인 — 로드 시 해당 고객 ID로 강제 찍힘, null이면 미확정 상태
  owner_customer_id?: string | null;
};

export type PortfolioAnalysisResult = {
  enrichedAssets: PortfolioAsset[];
  portfolioIssueSummary: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  quantResult?: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  stressResult?: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  healthResult?: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tlhResult?: any;
};

export type Tab3InnerTab = "correlation-domestic" | "correlation-global" | "rebalancing";
export type CorrelationPeriodRange = "1W" | "1M" | "3M" | "6M" | "1Y" | "3Y";
export type CorrelationInnerViewTab = "optimal" | "heatmap" | "chart" | "weight" | "sectorlist";
export type CorrelationAnalysisState = {
  strategy?: "conservative" | "balanced" | "aggressive";
  k?: number;
  periodRange?: CorrelationPeriodRange;
  lockedTicker?: string | null;
  innerViewTab?: CorrelationInnerViewTab;
};
export type Tab3AnalysisState = {
  activeInnerTab?: Tab3InnerTab;
  domestic?: CorrelationAnalysisState;
  global?: CorrelationAnalysisState;
};

// 빈 자산 행 템플릿 — MainTabShell과 ExistingPortfolioTab에서 공용으로 사용
export const EMPTY_PORTFOLIO_ASSET: PortfolioAsset = {
  name: "",
  asset_class: "해외주식",
  theme: "기타",
  country: "미국",
  buy_price: null,
  amount: 0,
  amount_type: "quantity",
  is_hedged: false,
  needs_review: false,
  ticker: "",
  productType: "해외주식",
  bond_yield: null,
  bond_maturity: null,
  owner_customer_id: null,  // 소유권 미확정 — addPortfolioRow 시 selectedCustomer로 덮어씌워짐
};

export const defaultCustomerProfiles: CustomerProfile[] = [
  { id: "11111111-1111-4111-8111-111111111111", name: "", gender: "", birthYear: "", age: "", job: "", fallbackName: "김준호", fallbackBirthYear: "1991" },
  { id: "22222222-2222-4222-8222-222222222222", name: "", gender: "", birthYear: "", age: "", job: "", fallbackName: "박서현", fallbackBirthYear: "1978" },
  { id: "33333333-3333-4333-8333-333333333333", name: "", gender: "", birthYear: "", age: "", job: "", fallbackName: "이재형", fallbackBirthYear: "1961" },
];

export const selectedCustomerStorageKey = "samsung-vvip-advisor-selected-customer-id";

export const noneExperience = "금융상품에 투자해 본 경험 없음";
export const noLegalConstraint = "없음";

export const returnOptions = [
  "적극적 수익 추구",
  "시장수익률 수준의 수익 추구",
  "예금, 채권이자 수준의 안정적 수익 추구",
  "원금 보존 투자",
];

export const riskExperienceOptions = [
  "ELW, 선물옵션, 주식신용거래, 파생상품 펀드",
  "주식, 주식형펀드, 원금비보장ELS, 고위험회사채",
  "혼합형펀드, 원금부분보장ELS, 일반 회사채",
  "은행 예/적금, 채권형펀드, 원금지급형ELB, 금융채",
  noneExperience,
];

export const fieldGroups = {
  knowledge: ["금융상품을 잘 이해하며 스스로 의사결정 가능", "금융상품을 이해하며 설명 듣고 의사결정 가능", "서로 다른 금융상품을 구별할 수 있음", "금융상품에 대해 전혀 모름"],
  derivatives: ["3년 이상", "2년 이상", "1년 이상", "1년 미만", "없음"],
  financialAssetRatio: ["10% 미만", "10~25% 미만", "25~50% 미만", "50~75% 미만", "75% 이상"],
  investmentAssetRatio: ["10% 미만", "10~20% 미만", "20~30% 미만", "30~40% 미만", "40% 이상"],
  riskAttitude: [
    "고수익의 기회를 위해 큰 폭의 손실 가능성도 받아들일 수 있음",
    "수익을 기대할 수 있다면 일정 수준의 손실을 수용할 수 있음",
    "일부 손실은 감수할 수 있으나, 전체적인 안정성이 중요",
    "원금 보전을 최우선으로 하며 손실 가능성을 원하지 않음",
  ],
  lossResponse: ["신규 자금 추가 투자", "관망", "일부 환매", "전액 환매 또는 계약 해지"],
  timeHorizon: ["5년 이상", "3~5년", "2~3년", "1~2년", "1년 미만"],
  giftingPlan: ["없음", "검토 중", "있음"],
  taxImportance: ["아니오", "보통", "매우 중요"],
  recentTax: ["예", "아니오", "모름"],
  legal: [noLegalConstraint, "임직원 매매 제한", "기타"],
};

export const riskInterpretations: Record<RiskLevel, string> = {
  초저위험: "예·적금 수준의 기대수익률을 가지고 있으며, 가급적이면 투자원금에 손실이 발생하는 것을 원하지 않습니다.",
  저위험: "투자원금 손실 위험은 최소화하고, 이자·배당소득 중심의 안정적 투자를 목표로 하며, 높은 수익을 위해 단기적인 손실을 수용합니다.",
  중위험: "주식형과 채권형 상품에 적절하게 배분하여 투자하는 것을 선호하며, 상당히 높은 수익을 기대할 수 있다면 손실 위험을 감수합니다.",
  고위험: "투자원금의 보전보다는 투자수익을 추구하며, 투자자금의 상당 부분을 위험자산에 투자합니다.",
  초고위험: "시장평균 수익률을 훨씬 넘어서는 높은 수준의 투자수익을 추구하며, 자산가치의 변동에 따른 손실 위험을 적극적으로 수용합니다.",
};

// ── Initial State ──────────────────────────────────────────────────────────
const emptyFinancial: FinancialInfo = {
  totalAssets: "", financialAssets: "", realEstate: "", debt: "",
  existingInvestmentAssets: "", cashAssets: "",
  annualFixedIncome: "", irregularIncome: "", irregularIncomeNone: false, investableAssets: "", monthlyFixedExpense: "",
};

const emptyRrttllu: RrttlluInfo = {
  returnObjective: "", expectedReturn: "", expectedReturnUnknown: false, investmentExperience: [],
  knowledgeLevel: "", derivativesExperience: "", financialAssetRatio: "", investmentAssetRatio: "",
  riskAttitude: "", lossResponse: "", timeHorizon: "", expectedInterestIncome: "",
  expectedDividendIncome: "", giftingPlan: "", globalTaxImportance: "", recentGlobalTaxSubject: "",
  foreignStockTaxImportance: "", regularCashflowNeed: "", lumpSumPlan: "", emergencyReservePlan: "",
  legalConstraints: [], legalConstraintOther: "", preferredAssets: "", avoidedAssets: "",
  holdingOrDisposalPlan: "", uniqueOther: "",
};

export function createInitialState(): AppState {
  return { financial: { ...emptyFinancial }, rrttllu: { ...emptyRrttllu, investmentExperience: [], legalConstraints: [] }, smartInputNote: "", uniqueOtherManual: "", smartExtractedUniqueOther: "", aiGuidePbNotes: {}, aiAdvisoryGuide: null, aiGuidePayloadSignature: "", aiGuideGeneratedAt: "", headerAssetSummary: { confirmedOperatingAssetsAfterSell: null, confirmedOperatingAssetsAfterBuy: null, confirmedBuyAmount: null } };
}

export function createInitialCustomerData(profiles = defaultCustomerProfiles): Record<CustomerId, AppState> {
  return Object.fromEntries(profiles.map((p) => [p.id, createInitialState()])) as Record<CustomerId, AppState>;
}

export function createNewCustomerProfile(): CustomerProfile {
  return {
    id: typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `44444444-4444-4444-8444-${Date.now().toString().slice(-12).padStart(12, "0")}`,
    name: "", gender: "", birthYear: "", age: "", job: "", fallbackName: "신규 고객",
  };
}

export function customerTabLabel(profile: CustomerProfile) {
  const name = profile.name.trim() || "신규 고객";
  const year = (profile.birth_year ?? profile.birthYear).trim() || "xxxx";
  return `${name} (${year})`;
}

export function normalizeAppState(value: unknown): AppState {
  const defaults = createInitialState();
  const state = value && typeof value === "object" ? (value as Partial<AppState>) : {};
  const financial = state.financial && typeof state.financial === "object" ? state.financial : {};
  const rrttllu = state.rrttllu && typeof state.rrttllu === "object" ? state.rrttllu : {};
  return deriveCalculatedAppState({
    smartInputNote: typeof state.smartInputNote === "string" ? state.smartInputNote : "",
    uniqueOtherManual: typeof state.uniqueOtherManual === "string" ? state.uniqueOtherManual : "",
    smartExtractedUniqueOther: typeof state.smartExtractedUniqueOther === "string" ? state.smartExtractedUniqueOther : "",
    aiGuidePbNotes: state.aiGuidePbNotes && typeof state.aiGuidePbNotes === "object" && !Array.isArray(state.aiGuidePbNotes) ? state.aiGuidePbNotes as Record<string, string> : {},
    aiAdvisoryGuide: state.aiAdvisoryGuide && typeof state.aiAdvisoryGuide === "object" && !Array.isArray(state.aiAdvisoryGuide) ? state.aiAdvisoryGuide as StoredAdvisoryGuide : null,
    aiGuidePayloadSignature: typeof state.aiGuidePayloadSignature === "string" ? state.aiGuidePayloadSignature : "",
    aiGuideGeneratedAt: typeof state.aiGuideGeneratedAt === "string" ? state.aiGuideGeneratedAt : "",
    headerAssetSummary: state.headerAssetSummary && typeof state.headerAssetSummary === "object" && !Array.isArray(state.headerAssetSummary)
        ? {
            confirmedOperatingAssetsAfterSell: typeof (state.headerAssetSummary as Partial<HeaderAssetSummaryState>).confirmedOperatingAssetsAfterSell === "number" ? (state.headerAssetSummary as Partial<HeaderAssetSummaryState>).confirmedOperatingAssetsAfterSell ?? null : null,
            confirmedOperatingAssetsAfterBuy: typeof (state.headerAssetSummary as Partial<HeaderAssetSummaryState>).confirmedOperatingAssetsAfterBuy === "number" ? (state.headerAssetSummary as Partial<HeaderAssetSummaryState>).confirmedOperatingAssetsAfterBuy ?? null : null,
            confirmedBuyAmount: typeof (state.headerAssetSummary as Partial<HeaderAssetSummaryState>).confirmedBuyAmount === "number" ? (state.headerAssetSummary as Partial<HeaderAssetSummaryState>).confirmedBuyAmount ?? null : null,
          }
      : defaults.headerAssetSummary,
    financial: { ...defaults.financial, ...financial, irregularIncomeNone: Boolean((financial as Partial<FinancialInfo>).irregularIncomeNone) },
    rrttllu: {
      ...defaults.rrttllu, ...rrttllu,
      expectedReturnUnknown: Boolean((rrttllu as Partial<RrttlluInfo>).expectedReturnUnknown),
      investmentExperience: Array.isArray((rrttllu as Partial<RrttlluInfo>).investmentExperience) ? ((rrttllu as Partial<RrttlluInfo>).investmentExperience as string[]) : [],
      legalConstraints: Array.isArray((rrttllu as Partial<RrttlluInfo>).legalConstraints) ? ((rrttllu as Partial<RrttlluInfo>).legalConstraints as string[]) : [],
    },
  });
}

function normalizeProfileText(text: unknown) {
  const value = typeof text === "string" ? text : "";
  return value === "입력 대기" ? "" : value;
}

export function normalizeCustomerProfile(value: unknown, fallback: CustomerProfile): CustomerProfile {
  const profile = value && typeof value === "object" ? (value as Partial<CustomerProfile>) : {};
  const id = typeof profile.id === "string" && profile.id ? profile.id : fallback.id;
  return {
    id, name: normalizeProfileText(profile.name), gender: normalizeProfileText(profile.gender),
    birthYear: normalizeProfileText(profile.birth_year ?? profile.birthYear),
    birth_year: normalizeProfileText(profile.birth_year ?? profile.birthYear),
    age: normalizeProfileText(profile.age), job: normalizeProfileText(profile.job),
    data: profile.data, sort_order: profile.sort_order,
    fallbackName: typeof profile.fallbackName === "string" ? profile.fallbackName : fallback.fallbackName,
    fallbackBirthYear: typeof profile.fallbackBirthYear === "string" ? profile.fallbackBirthYear : fallback.fallbackBirthYear,
  };
}

function mergeDefaultCustomerProfiles(profiles: CustomerProfile[]) {
  const storedById = new Map(profiles.map((p) => [p.id, p]));
  const defaultsToAdd = defaultCustomerProfiles.filter((d) => !storedById.has(d.id));
  return [...profiles, ...defaultsToAdd];
}

export function normalizeCustomerProfiles(value: unknown): CustomerProfile[] {
  if (!Array.isArray(value)) return defaultCustomerProfiles;
  const normalized = value
    .map((p, i) => normalizeCustomerProfile(p, defaultCustomerProfiles[i] ?? createNewCustomerProfile()))
    .filter((p, i, arr) => p.id && arr.findIndex((x) => x.id === p.id) === i);
  return mergeDefaultCustomerProfiles(normalized.length ? normalized : defaultCustomerProfiles);
}

// ── Supabase Storage ───────────────────────────────────────────────────────
function getSupabaseClient(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  return createClient(url, key);
}

export const supabase = getSupabaseClient();
export let latestStorageErrorMessage = "";
const embeddedAppStateKey = "__app_state";
type CustomerScopedTableName = "rebalancing_state" | "new_analysis_results" | "tax_summaries" | "product_selections";

const scopedPayloadColumns: Record<CustomerScopedTableName, string[]> = {
  rebalancing_state: ["state", "data"],
  new_analysis_results: ["result", "data"],
  tax_summaries: ["summary", "data"],
  product_selections: ["selections", "data"],
};

function readScopedPayload(row: Record<string, unknown> | null, table: CustomerScopedTableName): unknown | null {
  if (!row) return null;
  for (const column of scopedPayloadColumns[table]) {
    if (row[column] !== undefined && row[column] !== null) return row[column];
  }
  return row;
}

async function loadScopedPayload(table: CustomerScopedTableName, customerId: CustomerId): Promise<unknown | null> {
  if (!supabase) return null;
  try {
    const { data, error } = await supabase
      .from(table)
      .select("*")
      .eq("customer_id", customerId)
      .maybeSingle();
    if (error || !data) return null;
    return readScopedPayload(data as Record<string, unknown>, table);
  } catch (error) {
    console.error(`Supabase ${table} load failed`, error);
    return null;
  }
}

async function upsertScopedPayload(
  table: CustomerScopedTableName,
  customerId: CustomerId,
  payload: unknown,
  extraCandidates: Record<string, unknown>[] = [],
): Promise<void> {
  if (!supabase) return;
  const updatedAt = new Date().toISOString();
  const preferredColumn = scopedPayloadColumns[table][0];
  const candidates: Record<string, unknown>[] = [
    { customer_id: customerId, [preferredColumn]: payload, updated_at: updatedAt },
    { customer_id: customerId, data: payload, updated_at: updatedAt },
    ...extraCandidates.map((candidate) => ({ customer_id: customerId, ...candidate, updated_at: updatedAt })),
  ];
  let lastError = "";
  for (const candidate of candidates) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase.from(table) as any).upsert(candidate, { onConflict: "customer_id" });
    if (!error) return;
    lastError = error.message;
  }
  console.error(`Supabase ${table} upsert failed`, lastError, { customerId, payload });
}

function rowToCustomerProfile(row: CustomerRow): CustomerProfile {
  const bundledData = row.customer_data ?? row.data ?? row.app_data ?? row.state;
  const bundledProfile = bundledData && typeof bundledData === "object" && "profile" in bundledData ? (bundledData as { profile?: unknown }).profile : undefined;
  const fallbackProfile = defaultCustomerProfiles.find((p) => p.id === row.id) ?? createNewCustomerProfile();
  const flatProfile = {
    id: row.id, name: typeof row.name === "string" ? row.name : "",
    gender: typeof row.gender === "string" ? row.gender : "",
    birthYear: typeof row.birth_year === "string" ? row.birth_year : typeof row.birthYear === "string" ? row.birthYear : "",
    age: typeof row.age === "number" ? String(row.age) : typeof row.age === "string" ? row.age : "",
    job: typeof row.job === "string" ? row.job : "",
  };
  const hasFlatData = Boolean(flatProfile.name || flatProfile.gender || flatProfile.birthYear || flatProfile.age || flatProfile.job);
  return normalizeCustomerProfile(hasFlatData ? flatProfile : row.profile ?? bundledProfile ?? flatProfile, fallbackProfile);
}

export function customerRowsToStoredState(rows: CustomerRow[]): StoredCustomerState {
  const sorted = [...rows].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
  const customerProfiles = sorted.map((row, i) => normalizeCustomerProfile(rowToCustomerProfile(row), defaultCustomerProfiles[i] ?? createNewCustomerProfile()));
  const rowStateById = new Map(sorted.map((row) => {
    const profileWithState = row.profile as (CustomerProfile & { [embeddedAppStateKey]?: unknown }) | undefined;
    const bundledData = (row.customer_data ?? row.data ?? row.app_data ?? row.state) as { appState?: unknown; app_state?: unknown } | undefined;
    return [row.id, row.app_state ?? profileWithState?.[embeddedAppStateKey] ?? bundledData?.appState ?? bundledData?.app_state ?? bundledData];
  }));
  return {
    customerProfiles,
    customerData: Object.fromEntries(customerProfiles.map((p) => [p.id, normalizeAppState(rowStateById.get(p.id))])) as Record<CustomerId, AppState>,
    selectedCustomer: customerProfiles[0]?.id ?? defaultCustomerProfiles[0].id,
  };
}

export function customerRowsToUpdatedMap(rows: CustomerRow[]): CustomerUpdatedMap {
  return Object.fromEntries(rows.map((row) => {
    const ts = typeof row.updated_at === "string" ? new Date(row.updated_at).getTime() : 0;
    return [row.id, Number.isFinite(ts) ? ts : 0];
  }));
}

function omitKeys<T extends Record<string, unknown>>(obj: T, keys: string[]) {
  const next = { ...obj };
  keys.forEach((k) => { delete next[k]; });
  return next;
}

function customerProfileColumnPayload(customer: CustomerProfile) {
  const payload: Record<string, string> = {};
  const raw: Record<string, string> = {
    name: customer.name, gender: customer.gender,
    birth_year: customer.birth_year ?? customer.birthYear,
    age: customer.age, job: customer.job,
  };
  Object.entries(raw).forEach(([k, v]) => { payload[k] = (v === "입력 대기" || v === "EMPTY") ? "" : (typeof v === "string" ? v : ""); });
  return payload;
}

export async function saveCustomerProfileColumns(customer: CustomerProfile): Promise<StorageResult> {
  if (!supabase) return { ok: false, message: "Supabase is not configured." };
  const profileColumns = customerProfileColumnPayload(customer);
  if (!Object.keys(profileColumns).length) return { ok: true, message: "No columns to save." };
  const updatedAt = new Date().toISOString();
  const { data, error } = await supabase.from("customers").update({ ...profileColumns, updated_at: updatedAt }).eq("id", customer.id).select("id,name,gender,birth_year,age,job");
  if (error) return { ok: false, message: `Supabase profile save failed: ${error.message}` };
  if (!data || data.length === 0) {
    const { error: insertError } = await supabase.from("customers").insert({ id: customer.id, ...profileColumns, updated_at: updatedAt, data: {}, sort_order: customer.sort_order ?? 0 });
    if (insertError) return { ok: false, message: `Supabase profile insert failed: ${insertError.message}` };
  }
  return { ok: true, message: "Customer profile saved." };
}

export async function saveCustomerDataJsonOnly(customerId: CustomerId, dataPayload: unknown): Promise<StorageResult> {
  if (!supabase) return { ok: false, message: "Supabase is not configured." };
  const { data, error } = await supabase.from("customers").update({ data: dataPayload, updated_at: new Date().toISOString() }).eq("id", customerId).select("id");
  if (error) return { ok: false, message: `Supabase data save failed: ${error.message}` };
  if (!data || data.length === 0) return { ok: false, message: "Supabase row not found." };
  return { ok: true, message: "Customer data saved." };
}

async function insertEmptyCustomerRow(customerId: CustomerId, dataPayload: unknown, sortOrder: number): Promise<StorageResult> {
  if (!supabase) return { ok: false, message: "Supabase is not configured." };
  const candidates: Record<string, unknown>[] = [
    { id: customerId, data: dataPayload, sort_order: sortOrder, updated_at: new Date().toISOString() },
    { id: customerId, data: dataPayload, updated_at: new Date().toISOString() },
    { id: customerId, data: dataPayload },
  ];
  let lastErr = "";
  for (const c of candidates) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase.from("customers") as any).insert(c);
    if (!error) return { ok: true, message: "Customer row created." };
    lastErr = (error as { message: string }).message;
  }
  return { ok: false, message: `Supabase insert failed: ${lastErr}` };
}

function storedStateToCustomerRows(state: StoredCustomerState) {
  return state.customerProfiles.map((p, i) => ({ id: p.id, profile: p, app_state: normalizeAppState(state.customerData[p.id]), sort_order: i, updated_at: new Date().toISOString() }));
}

async function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(message)), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

async function writeRowsWithFallback(state: StoredCustomerState, op: "insert" | "upsert"): Promise<StorageResult> {
  if (!supabase) return { ok: false, message: "Supabase not configured." };
  const rows = storedStateToCustomerRows(state);
  const result = op === "insert" ? await supabase.from("customers").insert(rows) : await supabase.from("customers").upsert(rows, { onConflict: "id" });
  if (!result.error) return { ok: true, message: "Saved." };
  return { ok: false, message: result.error.message };
}

export const customerStorage = {
  async selectRows(): Promise<{ rows: CustomerRow[]; errorMessage?: string } | null> {
    if (!supabase) return null;
    try {
      const ordered = await withTimeout(
        Promise.resolve(supabase.from("customers").select("*").order("sort_order", { ascending: true })),
        8000,
        "Supabase customer select timed out.",
      );
      const fallback = ordered.error
        ? await withTimeout(Promise.resolve(supabase.from("customers").select("*")), 8000, "Supabase customer fallback select timed out.")
        : ordered;
      const { data, error } = fallback;
      if (error) throw error;
      return { rows: Array.isArray(data) ? (data as CustomerRow[]) : [] };
    } catch (e) {
      console.error("Supabase customer select failed", e);
      return { rows: [], errorMessage: "Supabase 고객 데이터 로드에 실패했습니다. 기본 화면으로 계속 진행합니다." };
    }
  },
  async insertCustomer(profile: CustomerProfile, appState: AppState, sortOrder: number): Promise<StorageResult> {
    return insertEmptyCustomerRow(profile.id, normalizeAppState(appState), sortOrder);
  },
  async insertDefaults(state: StoredCustomerState): Promise<StorageResult> {
    let final: StorageResult = { ok: true, message: "기본 고객 생성 완료" };
    for (const [i, p] of state.customerProfiles.entries()) {
      const r = await insertEmptyCustomerRow(p.id, normalizeAppState(state.customerData[p.id]), i);
      if (!r.ok) final = r;
    }
    return final;
  },
  async saveSortOrders(profiles: CustomerProfile[]): Promise<StorageResult> {
    if (!supabase) return { ok: false, message: "Supabase not configured." };
    const updatedAt = new Date().toISOString();
    const results = await Promise.all(
      profiles.map((profile, index) =>
        supabase.from("customers").update({ sort_order: index, updated_at: updatedAt }).eq("id", profile.id),
      ),
    );
    const error = results.find((result) => result.error)?.error;
    if (error) return { ok: false, message: `Sort order save failed: ${error.message}` };
    return { ok: true, message: "Customer sort order saved." };
  },
  async remove(customerId: CustomerId): Promise<StorageResult> {
    if (!supabase) return { ok: false, message: "Supabase not configured." };
    const { error } = await supabase.from("customers").delete().eq("id", customerId);
    if (error) return { ok: false, message: `Delete failed: ${error.message}` };
    return { ok: true, message: "Deleted." };
  },
};

export function getStoredSelectedCustomerId() {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(selectedCustomerStorageKey);
}

export function storeSelectedCustomerId(customerId: CustomerId) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(selectedCustomerStorageKey, customerId);
}

// ── Analysis Functions ─────────────────────────────────────────────────────
const tenPointScale = [10, 8, 5, 3, 0];
const ratioScale = [0, 3, 5, 8, 10];
const knowledgeScale = [10, 6, 3, 0];
const riskAttitudeScale = [25, 18, 10, 0];

function selectedScore(value: string, options: string[], scores: number[]) {
  const i = options.indexOf(value);
  return i >= 0 ? scores[i] : 0;
}

function maxSelectedScore(values: string[], options: string[], scores: number[]) {
  if (!values.length) return 0;
  return Math.max(...values.map((v) => selectedScore(v, options, scores)));
}

export function riskLevel(score: number): RiskLevel {
  if (score <= 20) return "초저위험";
  if (score <= 40) return "저위험";
  if (score <= 60) return "중위험";
  if (score <= 80) return "고위험";
  return "초고위험";
}

export function riskLevelColor(level: RiskLevel) {
  const colors: Record<RiskLevel, string> = {
    초저위험: "text-blue-600", 저위험: "text-green-600", 중위험: "text-lime-600",
    고위험: "text-orange-700", 초고위험: "text-red-700",
  };
  return colors[level];
}

export function calculateRiskResult(rrttllu: RrttlluInfo): RiskResult {
  const score =
    maxSelectedScore(rrttllu.investmentExperience, riskExperienceOptions, tenPointScale) +
    selectedScore(rrttllu.knowledgeLevel, fieldGroups.knowledge, knowledgeScale) +
    selectedScore(rrttllu.derivativesExperience, fieldGroups.derivatives, tenPointScale) +
    selectedScore(rrttllu.financialAssetRatio, fieldGroups.financialAssetRatio, ratioScale) +
    selectedScore(rrttllu.investmentAssetRatio, fieldGroups.investmentAssetRatio, ratioScale) +
    selectedScore(rrttllu.riskAttitude, fieldGroups.riskAttitude, riskAttitudeScale) +
    selectedScore(rrttllu.lossResponse, fieldGroups.lossResponse, riskAttitudeScale);
  const level = riskLevel(score);
  return {
    score, level,
    answers: {
      investment_experience: rrttllu.investmentExperience,
      investment_knowledge: rrttllu.knowledgeLevel,
      derivatives_experience: rrttllu.derivativesExperience,
      financial_assets_ratio: rrttllu.financialAssetRatio,
      investment_assets_ratio: rrttllu.investmentAssetRatio,
      risk_attitude: rrttllu.riskAttitude,
      loss_response: rrttllu.lossResponse,
    },
    interpretation: riskInterpretations[level],
  };
}

export function nullableText(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const normalized = trimmed.replace(/\s+/g, "");
  const nullExpressions = ["모름", "잘모르겠음", "말하기어려움", "비공개", "정확히모름", "정확한금액은말하기어렵습니다", "답변하고싶지않음"];
  return nullExpressions.includes(normalized) ? null : trimmed;
}

export function nullableArray(values: string[]) { return values.length ? values : null; }

function uniqueWarnings(warnings: string[]) { return Array.from(new Set(warnings)); }

function financialIncomeTaxAlert(interest: number | null, dividend: number | null) {
  if (interest === null || dividend === null) return "이자소득 또는 배당소득 정보가 부족하여 금융소득종합과세 여부를 판단하기 어렵습니다.";
  const total = interest + dividend;
  return total > 20_000_000
    ? "올해 예상 이자소득과 배당소득 합계가 2,000만 원을 초과하여 금융소득종합과세 대상이 될 가능성이 높습니다."
    : "올해 예상 이자소득과 배당소득 합계가 2,000만 원 이하로, 금융소득종합과세 가능성은 상대적으로 낮습니다.";
}

function parseSingleKrwAmount(value: string): number | null {
  const cleaned = value.replace(/원|이하|미만|이상|초과|약|대략|정도/g, "");
  if (!cleaned) return null;
  let total = 0;
  let consumed = cleaned;
  const eok = cleaned.match(/(\d+(?:\.\d+)?)억/);
  const cheon = cleaned.match(/(\d+(?:\.\d+)?)천(?:만)?/);
  const man = cleaned.match(/(\d+(?:\.\d+)?)만/);
  if (eok) { total += Number(eok[1]) * 100_000_000; consumed = consumed.replace(eok[0], ""); }
  if (cheon) { total += Number(cheon[1]) * 10_000_000; consumed = consumed.replace(cheon[0], ""); }
  if (man) { total += Number(man[1]) * 10_000; consumed = consumed.replace(man[0], ""); }
  if (total > 0) return Math.round(total);
  const numOnly = consumed.match(/^\d+(?:\.\d+)?$/);
  return numOnly ? Math.round(Number(numOnly[0])) : null;
}

export function parseKrwAmount(value: string | null): number | null {
  if (!value) return null;
  const normalized = value.replace(/,/g, "").replace(/\s+/g, "");
  const parts = normalized.split(/~|∼|〜|-/).map((p) => p.trim()).filter(Boolean);
  if (parts.length > 1) {
    const parsed = parts.map(parseSingleKrwAmount);
    if (parsed.some((x) => x === null)) return null;
    const amounts = parsed as number[];
    return Math.round(amounts.reduce((s, x) => s + x, 0) / amounts.length);
  }
  return parseSingleKrwAmount(normalized);
}

function formatCompactKrw(amount: number | null) {
  if (amount === null || !Number.isFinite(amount)) return "";
  const eok = Math.floor(amount / 100_000_000);
  const man = Math.floor((amount % 100_000_000) / 10_000);
  if (eok && man) return `${eok}억 ${man.toLocaleString("ko-KR")}만`;
  if (eok) return `${eok}억`;
  if (man) return `${man.toLocaleString("ko-KR")}만`;
  return `${Math.round(amount).toLocaleString("ko-KR")}원`;
}

function sumKnownAmounts(values: Array<string | null>) {
  const amounts = values.map((value) => parseKrwAmount(nullableText(value ?? ""))).filter((value): value is number => value !== null);
  return amounts.length ? amounts.reduce((sum, value) => sum + value, 0) : null;
}

function ratioOption(value: number | null, ranges: Array<{ limit: number; label: string }>, fallback: string) {
  if (value === null || !Number.isFinite(value) || value < 0) return "";
  const matched = ranges.find((range) => value < range.limit);
  return matched ? matched.label : fallback;
}

export function deriveFinancialFields(financial: FinancialInfo): FinancialInfo {
  const financialAssetsAmount = sumKnownAmounts([financial.existingInvestmentAssets, financial.cashAssets]);
  const realEstateAmount = parseKrwAmount(nullableText(financial.realEstate)) ?? 0;
  const debtAmount = parseKrwAmount(nullableText(financial.debt)) ?? 0;
  const hasNetAssetInput = financialAssetsAmount !== null || nullableText(financial.realEstate) !== null || nullableText(financial.debt) !== null;
  const netAssetsAmount = hasNetAssetInput ? (financialAssetsAmount ?? 0) + realEstateAmount - debtAmount : null;

  return {
    ...financial,
    financialAssets: formatCompactKrw(financialAssetsAmount),
    totalAssets: formatCompactKrw(netAssetsAmount),
  };
}

export function deriveRiskRatioFields(financial: FinancialInfo, rrttllu: RrttlluInfo): RrttlluInfo {
  const financialAssetsAmount = parseKrwAmount(nullableText(financial.financialAssets));
  const netAssetsAmount = parseKrwAmount(nullableText(financial.totalAssets));
  const existingInvestmentAssetsAmount = parseKrwAmount(nullableText(financial.existingInvestmentAssets));
  const financialAssetRatio = financialAssetsAmount !== null && netAssetsAmount !== null && netAssetsAmount > 0
    ? (financialAssetsAmount / netAssetsAmount) * 100
    : null;
  const investmentAssetRatio = existingInvestmentAssetsAmount !== null && financialAssetsAmount !== null && financialAssetsAmount > 0
    ? (existingInvestmentAssetsAmount / financialAssetsAmount) * 100
    : null;

  return {
    ...rrttllu,
    financialAssetRatio: ratioOption(financialAssetRatio, [
      { limit: 10, label: "10% 미만" },
      { limit: 25, label: "10~25% 미만" },
      { limit: 50, label: "25~50% 미만" },
      { limit: 75, label: "50~75% 미만" },
    ], "75% 이상"),
    investmentAssetRatio: ratioOption(investmentAssetRatio, [
      { limit: 10, label: "10% 미만" },
      { limit: 20, label: "10~20% 미만" },
      { limit: 30, label: "20~30% 미만" },
      { limit: 40, label: "30~40% 미만" },
    ], "40% 이상"),
  };
}

export function deriveCalculatedAppState(state: AppState): AppState {
  const financial = deriveFinancialFields(state.financial);
  return { ...state, financial, rrttllu: deriveRiskRatioFields(financial, state.rrttllu) };
}

export function buildStructuredJsonPayload(formData: AppState, riskResult: RiskResult, customerProfile?: CustomerProfile): StructuredJsonPayload {
  const { financial, rrttllu } = formData;
  const warnings: string[] = [];
  const totalAssets = nullableText(financial.totalAssets);
  const financialAssets = nullableText(financial.financialAssets);
  const realEstate = nullableText(financial.realEstate);
  const debt = nullableText(financial.debt);
  const assetParts = [totalAssets ? `순자산 ${totalAssets}` : null, financialAssets ? `금융자산 ${financialAssets}` : null, realEstate ? `부동산 ${realEstate}` : null, debt ? `부채 ${debt}` : null].filter(Boolean);
  const assetSummary = assetParts.length ? assetParts.join(", ") : null;
  const annualFixedIncome = nullableText(financial.annualFixedIncome);
  const irregularIncome = financial.irregularIncomeNone ? "없음" : nullableText(financial.irregularIncome);
  const investableAssets = nullableText(financial.investableAssets);
  const monthlyFixedExpense = nullableText(financial.monthlyFixedExpense);
  const expectedInterestIncome = nullableText(rrttllu.expectedInterestIncome);
  const expectedDividendIncome = nullableText(rrttllu.expectedDividendIncome);
  const interestAmount = parseKrwAmount(expectedInterestIncome);
  const dividendAmount = parseKrwAmount(expectedDividendIncome);
  const taxAlert = financialIncomeTaxAlert(interestAmount, dividendAmount);
  const hasMissingProfile = !customerProfile || !nullableText(customerProfile.name) || !nullableText(customerProfile.gender) || !nullableText(customerProfile.birthYear) || !nullableText(customerProfile.age) || !nullableText(customerProfile.job);
  const riskAnswers = {
    investment_experience: nullableArray(rrttllu.investmentExperience),
    investment_knowledge: nullableText(rrttllu.knowledgeLevel),
    derivatives_experience: nullableText(rrttllu.derivativesExperience),
    financial_assets_ratio: nullableText(rrttllu.financialAssetRatio),
    investment_assets_ratio: nullableText(rrttllu.investmentAssetRatio),
    risk_attitude: nullableText(rrttllu.riskAttitude),
    loss_response: nullableText(rrttllu.lossResponse),
  };

  if (hasMissingProfile) warnings.push("기본 신상 정보가 부족합니다.");
  if (!assetSummary || !annualFixedIncome || !monthlyFixedExpense || !irregularIncome || !investableAssets) warnings.push("기본 재무 정보가 부족합니다.");
  if (!nullableText(rrttllu.returnObjective) || (!nullableText(rrttllu.expectedReturn) && !rrttllu.expectedReturnUnknown)) warnings.push("목표 수익률 (Return) 정보가 부족합니다.");
  if (Object.values(riskAnswers).some((v) => v === null)) warnings.push("위험 허용도 (Risk) 정보가 부족합니다.");
  if (!nullableText(rrttllu.timeHorizon)) warnings.push("투자 기간 (Time Horizon) 정보가 부족합니다.");
  if (!expectedInterestIncome || !expectedDividendIncome || interestAmount === null || dividendAmount === null || !nullableText(rrttllu.giftingPlan) || !nullableText(rrttllu.globalTaxImportance) || !nullableText(rrttllu.recentGlobalTaxSubject) || !nullableText(rrttllu.foreignStockTaxImportance)) warnings.push("세금 요인 (Tax) 정보가 부족합니다.");
  if (!nullableText(rrttllu.regularCashflowNeed) || !nullableText(rrttllu.lumpSumPlan) || !nullableText(rrttllu.emergencyReservePlan)) warnings.push("유동성 필요 시기 (Liquidity) 정보가 부족합니다.");
  if (!rrttllu.legalConstraints.length) warnings.push("법적/규제 제약 (Legal) 정보가 부족합니다.");
  if (rrttllu.legalConstraints.includes("기타") && !nullableText(rrttllu.legalConstraintOther)) warnings.push("법적/규제 제약 (Legal) 정보가 부족합니다.");
  if (!nullableText(rrttllu.preferredAssets) || !nullableText(rrttllu.avoidedAssets) || !nullableText(rrttllu.holdingOrDisposalPlan)) warnings.push("고객 고유 상황 (Unique Circumstances) 정보가 부족합니다.");

  return {
    basic_financial_info: { asset_summary: assetSummary, annual_fixed_income: annualFixedIncome, irregular_income: irregularIncome, investable_assets: investableAssets, monthly_fixed_expense: monthlyFixedExpense },
    rrttllu: {
      return: { objective: nullableText(rrttllu.returnObjective), expected_return: rrttllu.expectedReturnUnknown ? "구체적인 수치는 모름" : nullableText(rrttllu.expectedReturn) },
      risk: { score: riskResult.score, level: riskResult.level, answers: riskAnswers, interpretation: riskResult.interpretation },
      time_horizon: { investment_period: nullableText(rrttllu.timeHorizon) },
      tax: { expected_interest_income: expectedInterestIncome, expected_dividend_income: expectedDividendIncome, gift_plan: nullableText(rrttllu.giftingPlan), financial_income_tax_importance: nullableText(rrttllu.globalTaxImportance), financial_income_tax_history: nullableText(rrttllu.recentGlobalTaxSubject), foreign_stock_capital_gains_tax_importance: nullableText(rrttllu.foreignStockTaxImportance), financial_income_tax_alert: taxAlert },
      liquidity: { cashflow_need: nullableText(rrttllu.regularCashflowNeed), large_cash_need: nullableText(rrttllu.lumpSumPlan), emergency_reserve_need: nullableText(rrttllu.emergencyReservePlan) },
      legal: { constraints: nullableArray(rrttllu.legalConstraints), other_detail: nullableText(rrttllu.legalConstraintOther) },
      unique_circumstances: {
        preferred_assets: { raw_input: nullableText(rrttllu.preferredAssets), portfolio_rule: { type: "soft_constraint", description: "고객이 선호하는 자산군은 포트폴리오 추천 시 우선 고려한다.", min_weight_hint: "10%" } },
        avoided_assets: { raw_input: nullableText(rrttllu.avoidedAssets), portfolio_rule: { type: "hard_constraint", description: "고객이 피하고 싶은 자산군은 포트폴리오 추천 후보에서 제외한다.", max_weight: "0%" } },
        existing_asset_plan: nullableText(rrttllu.holdingOrDisposalPlan),
        other: nullableText(rrttllu.uniqueOther),
      },
      warnings: uniqueWarnings(warnings),
    },
  };
}

export function completion(values: string[]) {
  const done = values.filter((v) => v.trim().length > 0).length;
  return Math.round((done / values.length) * 100);
}

export function formatUpdatedAt(timestamp: number) {
  if (!timestamp) return "업데이트 이력 없음";
  const date = new Date(timestamp);
  const datePart = date.toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" });
  const timePart = date.toLocaleTimeString("ko-KR", { timeZone: "Asia/Seoul", hour: "2-digit", minute: "2-digit", hour12: false });
  return `${datePart} ${timePart} 업데이트`;
}

export function formatChangeDate(timestamp: number) {
  return new Date(timestamp).toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" });
}

export function irregularIncomeDisplay(financial: FinancialInfo) {
  if (financial.irregularIncomeNone) return "없음";
  return financial.irregularIncome || "입력 대기";
}

export function expectedReturnDisplay(rrttllu: RrttlluInfo) {
  if (rrttllu.expectedReturnUnknown) return "구체적인 수치는 모름";
  return rrttllu.expectedReturn || "입력 대기";
}

// ── Portfolio & Analysis Supabase Helpers ─────────────────────────────────
// 저장 위치 (전용 컬럼):
//   rebalancing_state.portfolio_assets  → TAB2 보유현황 자산
//   rebalancing_state.sell_assets       → TAB2 리밸런싱(매도)
//   new_analysis_results.buy_assets     → TAB3 리밸런싱(매수)
//   new_analysis_results.portfolio_analysis_result → TAB2 기존 포트폴리오 분석결과
//   new_analysis_results.analysis_result           → TAB3 신규 포트폴리오 분석결과

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const rebSB = () => supabase!.from("rebalancing_state") as any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const narSB = () => supabase!.from("new_analysis_results") as any;

export async function loadPortfolioAssets(customerId: CustomerId): Promise<PortfolioAsset[]> {
  if (!supabase) return [];
  try {
    const { data, error } = await supabase
      .from("rebalancing_state")
      .select("portfolio_assets")
      .eq("customer_id", customerId)
      .maybeSingle();
    if (error || !data) return [];
    const raw = Array.isArray((data as Record<string, unknown>).portfolio_assets)
      ? (data as Record<string, unknown>).portfolio_assets as PortfolioAsset[]
      : [];
    return raw.map(a => ({ ...a, owner_customer_id: customerId }));
  } catch {
    return [];
  }
}

export async function savePortfolioAssets(customerId: CustomerId, assets: PortfolioAsset[]): Promise<void> {
  if (!supabase) return;
  if (assets.length > 0) {
    const isOwnershipValid = assets.every(a => a.owner_customer_id === customerId);
    if (!isOwnershipValid) return;
    const hasContent = assets.some(a => (a.name ?? "").trim() || (a.ticker ?? "").trim());
    if (!hasContent) return;
  }
  await rebSB().upsert(
    { customer_id: customerId, portfolio_assets: assets, updated_at: new Date().toISOString() },
    { onConflict: "customer_id" },
  );
}

export async function loadAnalysisResult(customerId: CustomerId): Promise<unknown | null> {
  if (!supabase) return null;
  try {
    const { data, error } = await supabase
      .from("new_analysis_results")
      .select("portfolio_analysis_result")
      .eq("customer_id", customerId)
      .maybeSingle();
    if (error || !data) return null;
    return (data as Record<string, unknown>).portfolio_analysis_result ?? null;
  } catch {
    return null;
  }
}

export async function saveAnalysisResult(customerId: CustomerId, result: unknown): Promise<void> {
  if (!supabase) return;
  await narSB().upsert(
    { customer_id: customerId, portfolio_analysis_result: result, updated_at: new Date().toISOString() },
    { onConflict: "customer_id" },
  );
}

// ── Rebalancing State Helpers ─────────────────────────────────────────────

export async function loadRebalancingState(customerId: CustomerId): Promise<{ sellAssets: PortfolioAsset[]; buyAssets: PortfolioAsset[] }> {
  if (!supabase) return { sellAssets: [], buyAssets: [] };
  try {
    const [{ data: rebRow }, { data: narRow }] = await Promise.all([
      supabase.from("rebalancing_state").select("sell_assets, state").eq("customer_id", customerId).maybeSingle(),
      supabase.from("new_analysis_results").select("buy_assets").eq("customer_id", customerId).maybeSingle(),
    ]);
    const row = (rebRow ?? {}) as Record<string, unknown>;
    const stateData = (row.state && typeof row.state === "object") ? row.state as Record<string, unknown> : {};
    const nar = (narRow ?? {}) as Record<string, unknown>;

    // sell: 전용 sell_assets 컬럼 우선 → state.sellAssets → state.sellRebalancing (구버전 호환)
    let sellAssets: PortfolioAsset[] = [];
    if (Array.isArray(row.sell_assets) && (row.sell_assets as unknown[]).length > 0) {
      sellAssets = row.sell_assets as PortfolioAsset[];
    } else {
      sellAssets = Array.isArray(stateData.sellAssets) ? stateData.sellAssets as PortfolioAsset[] :
        Array.isArray(stateData.sellRebalancing) ? stateData.sellRebalancing as PortfolioAsset[] : [];
    }

    // buy: 전용 new_analysis_results.buy_assets 컬럼 우선 → state.buyRebalancing (구버전 호환)
    let buyAssets: PortfolioAsset[] = [];
    if (Array.isArray(nar.buy_assets) && (nar.buy_assets as unknown[]).length > 0) {
      buyAssets = nar.buy_assets as PortfolioAsset[];
    } else {
      buyAssets = Array.isArray(stateData.buyRebalancing) ? stateData.buyRebalancing as PortfolioAsset[] : [];
    }

    return { sellAssets, buyAssets };
  } catch {
    return { sellAssets: [], buyAssets: [] };
  }
}

// TAB2 매도 → rebalancing_state.sell_assets 전용 컬럼
export async function saveRebalancingState(customerId: CustomerId, sellAssets: PortfolioAsset[]): Promise<void> {
  if (!supabase) return;
  await rebSB().upsert(
    { customer_id: customerId, sell_assets: sellAssets, updated_at: new Date().toISOString() },
    { onConflict: "customer_id" },
  );
}

// TAB3 매수 → new_analysis_results.buy_assets 전용 컬럼
export async function saveRebalancingBuyAssets(customerId: CustomerId, buyAssets: PortfolioAsset[]): Promise<void> {
  if (!supabase) return;
  await narSB().upsert(
    { customer_id: customerId, buy_assets: buyAssets, updated_at: new Date().toISOString() },
    { onConflict: "customer_id" },
  );
}

// ── New Portfolio Analysis Result Helpers ─────────────────────────────────

export async function loadNewAnalysisResult(customerId: CustomerId): Promise<unknown | null> {
  if (!supabase) return null;
  try {
    const { data, error } = await supabase
      .from("new_analysis_results")
      .select("analysis_result")
      .eq("customer_id", customerId)
      .maybeSingle();
    if (error || !data) return null;
    return (data as Record<string, unknown>).analysis_result ?? null;
  } catch {
    return null;
  }
}

export async function saveNewAnalysisResult(customerId: CustomerId, result: unknown): Promise<void> {
  if (!supabase) return;
  await narSB().upsert(
    { customer_id: customerId, analysis_result: result, updated_at: new Date().toISOString() },
    { onConflict: "customer_id" },
  );
}

export async function loadTab3AnalysisState(customerId: CustomerId): Promise<Tab3AnalysisState> {
  const payload = await loadScopedPayload("new_analysis_results", customerId);
  if (!payload || typeof payload !== "object") return {};
  const state = (payload as { tab3State?: unknown }).tab3State;
  return state && typeof state === "object" ? state as Tab3AnalysisState : {};
}

export async function saveTab3AnalysisState(customerId: CustomerId, state: Tab3AnalysisState): Promise<void> {
  const current = await loadScopedPayload("new_analysis_results", customerId);
  const existing = (current && typeof current === "object") ? { ...(current as Record<string, unknown>) } : {};
  await upsertScopedPayload("new_analysis_results", customerId, { ...existing, tab3State: state });
}

// ── Tax Summary Helpers ───────────────────────────────────────────────────
export async function loadTaxSummaries(customerId: CustomerId): Promise<{ currentSummary: unknown | null; newSummary: unknown | null }> {
  const payload = await loadScopedPayload("tax_summaries", customerId);
  const data = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
  return {
    currentSummary: data.currentSummary ?? data.current_summary ?? null,
    newSummary: data.newSummary ?? data.new_summary ?? null,
  };
}

export async function saveTaxSummaryToDb(customerId: CustomerId, type: 'current' | 'new', summary: unknown): Promise<void> {
  const current = await loadTaxSummaries(customerId);
  const payload = {
    currentSummary: type === "current" ? summary : current.currentSummary,
    newSummary: type === "new" ? summary : current.newSummary,
  };
  await upsertScopedPayload(
    "tax_summaries",
    customerId,
    payload,
    [{ current_summary: payload.currentSummary, new_summary: payload.newSummary }],
  );
}

// ── Product Selection Helpers ─────────────────────────────────────────────
export async function loadProductSelections(customerId: CustomerId): Promise<string[]> {
  const payload = await loadScopedPayload("product_selections", customerId);
  if (Array.isArray(payload)) return payload as string[];
  const data = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
  return Array.isArray(data.selectedIds) ? data.selectedIds as string[] : Array.isArray(data.selected_ids) ? data.selected_ids as string[] : [];
}

export async function saveProductSelections(customerId: CustomerId, selectedIds: string[]): Promise<void> {
  await upsertScopedPayload(
    "product_selections",
    customerId,
    { selectedIds },
    [{ selected_ids: selectedIds }],
  );
}

// ── Context ────────────────────────────────────────────────────────────────
export type CustomerContextValue = {
  formData: AppState;
  selectedCustomerProfile: CustomerProfile;
  customerProfiles: CustomerProfile[];
  selectedCustomer: CustomerId;
  riskResult: RiskResult;
  financialCompletion: number;
  rrttlluCompletion: number;
  internalJsonPayload: StructuredJsonPayload;
  warnings: string[];
  analysisRequested: boolean;
  confirmedRiskResult: RiskResult | null;
  changeHistory: ChangeEntry[];
  changeHistoryExpanded: boolean;
  setFinancial: (key: keyof FinancialInfo, value: string) => void;
  setRrttllu: (key: keyof RrttlluInfo, value: string) => void;
  setIrregularIncome: (value: string) => void;
  toggleNoIrregularIncome: () => void;
  setExpectedReturn: (value: string) => void;
  toggleExpectedReturnUnknown: () => void;
  toggleInvestmentExperience: (option: string) => void;
  toggleLegalConstraint: (option: string) => void;
  setSmartInputNote: (value: string) => void;
  setAiGuidePbNote: (checkpointId: string, value: string) => void;
  setAiAdvisoryGuide: (guide: StoredAdvisoryGuide | null, payloadSignature?: string, generatedAt?: string) => void;
  analyzeRrttllu: () => void;
  resetSelectedCustomer: () => void;
  resetSelectedCustomerInputs: () => void;
  applySmartExtraction: (payload: SmartExtractionPayload) => void;
  updateCustomerProfile: (key: keyof Omit<CustomerProfile, "id">, value: string) => void;
  setChangeHistoryExpanded: React.Dispatch<React.SetStateAction<boolean>>;
  // ── 포트폴리오 전역 상태 (탭 이동 시에도 메모리에서 유지됨) ──────────────
  portfolioAssets: PortfolioAsset[];
  isPortfolioLoaded: boolean;
  analysisResult: PortfolioAnalysisResult | null;
  addPortfolioRow: () => void;
  removePortfolioRow: (index: number) => void;
  updatePortfolioRow: (index: number, patch: Partial<PortfolioAsset>) => void;
  setAnalysisResult: (result: PortfolioAnalysisResult | null) => void;
  setPortfolioDirty: (dirty: boolean) => void;
  // ── 리밸런싱 파이프라인 (탭2보유현황 → 탭2리밸런싱 → 탭3매수 → 탭5비교) ──
  rebalancingSellAssets: PortfolioAsset[];
  rebalancingBuyAssets: PortfolioAsset[];
  newPortfolioAnalysisResult: PortfolioAnalysisResult | null;
  tab3AnalysisState: Tab3AnalysisState;
  pushToRebalancingSell: () => void;
  setRebalancingSellAssets: (assets: PortfolioAsset[]) => void;
  confirmRebalancingSell: () => void;
  resetRebalancingSellSummary: () => void;
  confirmRebalancingBuy: () => void;
  resetRebalancingBuySummary: () => void;
  setRebalancingBuyAssets: (assets: PortfolioAsset[]) => void;
  setNewPortfolioAnalysisResult: (result: PortfolioAnalysisResult | null) => void;
  updateTab3AnalysisState: (patch: Partial<Tab3AnalysisState>) => void;
  // ── Tab 5 상품 선택 (고객별 격리, Supabase 영속) ──────────────────────────
  productSelectedIds: string[];
  setProductSelectedIds: (ids: string[]) => void;
  // ── 세금 요약 Supabase 저장 (Tab 2/3에서 호출) ────────────────────────────
  saveTaxSummary: (type: 'current' | 'new', summary: unknown) => void;
};

export const CustomerContext = createContext<CustomerContextValue | null>(null);

export function useCustomerContext() {
  const ctx = useContext(CustomerContext);
  if (!ctx) throw new Error("useCustomerContext must be used inside CustomerProvider");
  return ctx;
}
