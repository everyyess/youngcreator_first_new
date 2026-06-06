"use client";

import {
  AlertTriangle,
  BadgeCheck,
  BarChart3,
  ChevronDown,
  ClipboardList,
  LockKeyhole,
  PieChart,
  ShieldCheck,
  Sparkles,
  Trash2,
  WalletCards
} from "lucide-react";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { type DragEvent, useEffect, useMemo, useState } from "react";

type CustomerId = string;

type FinancialInfo = {
  totalAssets: string;
  financialAssets: string;
  realEstate: string;
  debt: string;
  annualFixedIncome: string;
  irregularIncome: string;
  irregularIncomeNone: boolean;
  monthlyFixedExpense: string;
};

type RrttlluInfo = {
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

type RiskLevel = "초저위험" | "저위험" | "중위험" | "고위험" | "초고위험";

type RiskResult = {
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

type StructuredJsonPayload = {
  basic_financial_info: {
    asset_summary: string | null;
    annual_fixed_income: string | null;
    irregular_income: string | null;
    monthly_fixed_expense: string | null;
  };
  rrttllu: {
    return: {
      objective: string | null;
      expected_return: string | null;
    };
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
    time_horizon: {
      investment_period: string | null;
    };
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
    legal: {
      constraints: string[] | null;
      other_detail: string | null;
    };
    unique_circumstances: {
      preferred_assets: {
        raw_input: string | null;
        portfolio_rule: {
          type: "soft_constraint";
          description: string;
          min_weight_hint: "10%";
        };
      };
      avoided_assets: {
        raw_input: string | null;
        portfolio_rule: {
          type: "hard_constraint";
          description: string;
          max_weight: "0%";
        };
      };
      existing_asset_plan: string | null;
      other: string | null;
    };
    warnings: string[];
  };
};

type ChangeEntry = {
  label: string;
  before: string;
  after: string;
  changedAt: number;
};

type LiquiditySummaryInfo = {
  requiredAmount: number | null;
  investableAmount: number | null;
  requiredDisplay: string;
  investableDisplay: string;
};

type CustomerUpdatedMap = Record<CustomerId, number>;

type AppState = {
  financial: FinancialInfo;
  rrttllu: RrttlluInfo;
};

type WorkspaceTab = "profile" | "existing" | "create" | "compare";

type CustomerProfile = {
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

type StoredCustomerState = {
  customerProfiles: CustomerProfile[];
  customerData: Record<CustomerId, AppState>;
  selectedCustomer: CustomerId;
};

type CustomerRow = {
  id: string;
  profile?: CustomerProfile;
  app_state?: AppState;
  sort_order?: number;
  updated_at?: string;
  [key: string]: unknown;
};

type StorageResult = {
  ok: boolean;
  message: string;
};

const workspaceTabs: { id: WorkspaceTab; label: string; description: string }[] = [
  { id: "profile", label: "고객 성향 분석", description: "재무 정보와 RRTTLLU 입력" },
  { id: "existing", label: "기존 포트폴리오 분석", description: "보유 자산과 제약 확인" },
  { id: "create", label: "신규 포트폴리오 생성", description: "추천 조건과 선호 반영" },
  { id: "compare", label: "포트폴리오 비교", description: "기존안과 신규안 비교" }
];

const defaultCustomerProfiles: CustomerProfile[] = [
  {
    id: "11111111-1111-4111-8111-111111111111",
    name: "",
    gender: "",
    birthYear: "",
    age: "",
    job: "",
    fallbackName: "김준호",
    fallbackBirthYear: "1991"
  },
  {
    id: "22222222-2222-4222-8222-222222222222",
    name: "",
    gender: "",
    birthYear: "",
    age: "",
    job: "",
    fallbackName: "박서현",
    fallbackBirthYear: "1978"
  },
  {
    id: "33333333-3333-4333-8333-333333333333",
    name: "",
    gender: "",
    birthYear: "",
    age: "",
    job: "",
    fallbackName: "이재형",
    fallbackBirthYear: "1961"
  }
];

const storageKey = "samsung-vvip-advisor-customer-data-v1";
const selectedCustomerStorageKey = "samsung-vvip-advisor-selected-customer-id";

const legacyDefaultProfileValues: Record<string, Omit<CustomerProfile, "id">> = {
  kim: {
    name: "김준호",
    gender: "남",
    birthYear: "1991",
    age: "35",
    job: "삼성전자 임직원 (전략기획실)",
    fallbackName: "김준호",
    fallbackBirthYear: "1991"
  },
  park: {
    name: "박서현",
    gender: "여",
    birthYear: "1978",
    age: "48",
    job: "바이오헬스케어 기업 대표",
    fallbackName: "박서현",
    fallbackBirthYear: "1978"
  },
  lee: {
    name: "이재형",
    gender: "남",
    birthYear: "1961",
    age: "65",
    job: "제조업 창업주 (회장)",
    fallbackName: "이재형",
    fallbackBirthYear: "1961"
  }
};

const initialState: AppState = {
  financial: {
    totalAssets: "",
    financialAssets: "",
    realEstate: "",
    debt: "",
    annualFixedIncome: "",
    irregularIncome: "",
    irregularIncomeNone: false,
    monthlyFixedExpense: ""
  },
  rrttllu: {
    returnObjective: "",
    expectedReturn: "",
    expectedReturnUnknown: false,
    investmentExperience: [],
    knowledgeLevel: "",
    derivativesExperience: "",
    financialAssetRatio: "",
    investmentAssetRatio: "",
    riskAttitude: "",
    lossResponse: "",
    timeHorizon: "",
    expectedInterestIncome: "",
    expectedDividendIncome: "",
    giftingPlan: "",
    globalTaxImportance: "",
    recentGlobalTaxSubject: "",
    foreignStockTaxImportance: "",
    regularCashflowNeed: "",
    lumpSumPlan: "",
    emergencyReservePlan: "",
    legalConstraints: [],
    legalConstraintOther: "",
    preferredAssets: "",
    avoidedAssets: "",
    holdingOrDisposalPlan: "",
    uniqueOther: ""
  }
};

function createInitialState(): AppState {
  return {
    financial: { ...initialState.financial },
    rrttllu: {
      ...initialState.rrttllu,
      investmentExperience: [],
      legalConstraints: []
    }
  };
}

function createInitialCustomerData(profiles = defaultCustomerProfiles): Record<CustomerId, AppState> {
  return Object.fromEntries(profiles.map((profile) => [profile.id, createInitialState()])) as Record<CustomerId, AppState>;
}

function createNewCustomerProfile(): CustomerProfile {
  return {
    id: typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `44444444-4444-4444-8444-${Date.now().toString().slice(-12).padStart(12, "0")}`,
    name: "",
    gender: "",
    birthYear: "",
    age: "",
    job: "",
    fallbackName: "신규 고객"
  };
}

function customerTabLabel(profile: CustomerProfile) {
  const enteredName = profile.name.trim();
  const name = enteredName ? enteredName : "신규 고객";
  const birthYear = (profile.birth_year ?? profile.birthYear).trim();
  const year = birthYear || "xxxx";
  return `${name} (${year})`;
}

function normalizeAppState(value: unknown): AppState {
  const defaults = createInitialState();
  const state = value && typeof value === "object" ? (value as Partial<AppState>) : {};
  const financial = state.financial && typeof state.financial === "object" ? state.financial : {};
  const rrttllu = state.rrttllu && typeof state.rrttllu === "object" ? state.rrttllu : {};

  return {
    financial: {
      ...defaults.financial,
      ...financial,
      irregularIncomeNone: Boolean((financial as Partial<FinancialInfo>).irregularIncomeNone)
    },
    rrttllu: {
      ...defaults.rrttllu,
      ...rrttllu,
      expectedReturnUnknown: Boolean((rrttllu as Partial<RrttlluInfo>).expectedReturnUnknown),
      investmentExperience: Array.isArray((rrttllu as Partial<RrttlluInfo>).investmentExperience)
        ? ((rrttllu as Partial<RrttlluInfo>).investmentExperience as string[])
        : [],
      legalConstraints: Array.isArray((rrttllu as Partial<RrttlluInfo>).legalConstraints)
        ? ((rrttllu as Partial<RrttlluInfo>).legalConstraints as string[])
        : []
    }
  };
}

function normalizeCustomerProfile(value: unknown, fallback: CustomerProfile): CustomerProfile {
  const profile = value && typeof value === "object" ? (value as Partial<CustomerProfile>) : {};
  const normalizeProfileText = (text: unknown, fallbackText: string) => {
    const value = typeof text === "string" ? text : "";
    return value === "입력 대기" ? "" : value;
  };
  const id = typeof profile.id === "string" && profile.id ? profile.id : fallback.id;
  const normalized = {
    id,
    name: normalizeProfileText(profile.name, fallback.name),
    gender: normalizeProfileText(profile.gender, fallback.gender),
    birthYear: normalizeProfileText(profile.birth_year ?? profile.birthYear, fallback.birthYear),
    birth_year: normalizeProfileText(profile.birth_year ?? profile.birthYear, fallback.birthYear),
    age: normalizeProfileText(profile.age, fallback.age),
    job: normalizeProfileText(profile.job, fallback.job),
    data: profile.data,
    sort_order: profile.sort_order,
    fallbackName: typeof profile.fallbackName === "string" ? profile.fallbackName : fallback.fallbackName,
    fallbackBirthYear: typeof profile.fallbackBirthYear === "string" ? profile.fallbackBirthYear : fallback.fallbackBirthYear
  };
  return normalized;
}

function normalizeCustomerProfiles(value: unknown): CustomerProfile[] {
  if (!Array.isArray(value)) return defaultCustomerProfiles;
  const normalized = value
    .map((profile, index) => normalizeCustomerProfile(profile, defaultCustomerProfiles[index] ?? createNewCustomerProfile()))
    .filter((profile, index, profiles) => profile.id && profiles.findIndex((item) => item.id === profile.id) === index);
  return mergeDefaultCustomerProfiles(normalized.length ? normalized : defaultCustomerProfiles);
}

function mergeDefaultCustomerProfiles(profiles: CustomerProfile[]) {
  const storedById = new Map(profiles.map((profile) => [profile.id, profile]));
  const defaultsToAdd = defaultCustomerProfiles.filter((defaultProfile) => !storedById.has(defaultProfile.id));
  return [...profiles, ...defaultsToAdd];
}

function normalizeCustomerData(value: unknown, profiles: CustomerProfile[]): Record<CustomerId, AppState> {
  const data = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  return Object.fromEntries(profiles.map((profile) => [profile.id, normalizeAppState(data[profile.id])])) as Record<CustomerId, AppState>;
}

function isCustomerId(value: unknown, profiles: CustomerProfile[]): value is CustomerId {
  return typeof value === "string" && profiles.some((profile) => profile.id === value);
}

function getSupabaseClient(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return null;
  return createClient(url, anonKey);
}

const supabase = getSupabaseClient();
let latestStorageErrorMessage = "";
const embeddedAppStateKey = "__app_state";

function customerRowsToStoredState(rows: CustomerRow[]): StoredCustomerState {
  const sortedRows = [...rows].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
  const customerProfiles = sortedRows.map((row, index) => normalizeCustomerProfile(rowToCustomerProfile(row), defaultCustomerProfiles[index] ?? createNewCustomerProfile()));
  const rowStateById = new Map(
    sortedRows.map((row) => {
      const profileWithState = row.profile as (CustomerProfile & { [embeddedAppStateKey]?: unknown }) | undefined;
      const bundledData = (row.customer_data ?? row.data ?? row.app_data ?? row.state) as { appState?: unknown; app_state?: unknown } | undefined;
      return [row.id, row.app_state ?? profileWithState?.[embeddedAppStateKey] ?? bundledData?.appState ?? bundledData?.app_state ?? bundledData];
    })
  );

  return {
    customerProfiles,
    customerData: Object.fromEntries(customerProfiles.map((profile) => [profile.id, normalizeAppState(rowStateById.get(profile.id))])) as Record<CustomerId, AppState>,
    selectedCustomer: customerProfiles[0]?.id ?? defaultCustomerProfiles[0].id
  };
}

function customerRowsToUpdatedMap(rows: CustomerRow[]): CustomerUpdatedMap {
  return Object.fromEntries(
    rows.map((row) => {
      const timestamp = typeof row.updated_at === "string" ? new Date(row.updated_at).getTime() : 0;
      return [row.id, Number.isFinite(timestamp) ? timestamp : 0];
    })
  );
}

function storedStateToCustomerRows(state: StoredCustomerState): CustomerRow[] {
  return state.customerProfiles.map((profile, index) => ({
    id: profile.id,
    profile,
    app_state: normalizeAppState(state.customerData[profile.id]),
    sort_order: index,
    updated_at: new Date().toISOString()
  }));
}

function rowToCustomerProfile(row: CustomerRow): CustomerProfile {
  const bundledData = row.customer_data ?? row.data ?? row.app_data ?? row.state;
  const bundledProfile =
    bundledData && typeof bundledData === "object" && "profile" in bundledData
      ? (bundledData as { profile?: unknown }).profile
      : undefined;
  const fallbackProfile = defaultCustomerProfiles.find((profile) => profile.id === row.id) ?? createNewCustomerProfile();
  const flatProfile = {
    id: row.id,
    name: typeof row.name === "string" ? row.name : "",
    gender: typeof row.gender === "string" ? row.gender : "",
    birthYear: typeof row.birth_year === "string" ? row.birth_year : typeof row.birthYear === "string" ? row.birthYear : "",
    age: typeof row.age === "number" ? String(row.age) : typeof row.age === "string" ? row.age : "",
    job: typeof row.job === "string" ? row.job : ""
  };
  const hasFlatProfileData = Boolean(flatProfile.name || flatProfile.gender || flatProfile.birthYear || flatProfile.age || flatProfile.job);

  return normalizeCustomerProfile(
    hasFlatProfileData ? flatProfile : row.profile ?? bundledProfile ?? flatProfile,
    fallbackProfile
  );
}

function storedStateToEmbeddedRows(state: StoredCustomerState) {
  return state.customerProfiles.map((profile, index) => ({
    id: profile.id,
    profile: {
      ...profile,
      [embeddedAppStateKey]: normalizeAppState(state.customerData[profile.id])
    },
    sort_order: index,
    updated_at: new Date().toISOString()
  }));
}

function storedStateToBundledRows(state: StoredCustomerState, key: "customer_data" | "data") {
  return state.customerProfiles.map((profile, index) => ({
    id: profile.id,
    [key]: {
      profile,
      appState: normalizeAppState(state.customerData[profile.id])
    },
    sort_order: index,
    updated_at: new Date().toISOString()
  }));
}

function storedStateToFlatRows(state: StoredCustomerState, key?: "customer_data" | "data") {
  return state.customerProfiles.map((profile, index) => ({
    id: profile.id,
    name: profile.name,
    gender: profile.gender,
    birth_year: profile.birth_year ?? profile.birthYear,
    age: profile.age,
    job: profile.job,
    ...(key ? { [key]: normalizeAppState(state.customerData[profile.id]) } : {}),
    sort_order: index,
    updated_at: new Date().toISOString()
  }));
}

function customerRowCandidates(state: StoredCustomerState) {
  const withoutMeta = (rows: Record<string, unknown>[]) =>
    rows.map(({ sort_order, updated_at, ...row }) => row);
  return [
    { mode: "app_state_column", rows: storedStateToCustomerRows(state) },
    { mode: "flat_data", rows: storedStateToFlatRows(state, "data") },
    { mode: "flat_customer_data", rows: storedStateToFlatRows(state, "customer_data") },
    { mode: "flat_data_no_meta", rows: withoutMeta(storedStateToFlatRows(state, "data")) },
    { mode: "flat_customer_data_no_meta", rows: withoutMeta(storedStateToFlatRows(state, "customer_data")) },
    { mode: "flat_profile_only", rows: storedStateToFlatRows(state) },
    { mode: "flat_profile_only_no_meta", rows: withoutMeta(storedStateToFlatRows(state)) },
    { mode: "profile_embedded_state", rows: storedStateToEmbeddedRows(state) },
    { mode: "customer_data_bundle", rows: storedStateToBundledRows(state, "customer_data") },
    { mode: "data_bundle", rows: storedStateToBundledRows(state, "data") },
    { mode: "customer_data_bundle_no_meta", rows: withoutMeta(storedStateToBundledRows(state, "customer_data")) },
    { mode: "data_bundle_no_meta", rows: withoutMeta(storedStateToBundledRows(state, "data")) }
  ];
}

async function writeRowsWithFallback(state: StoredCustomerState, operation: "insert" | "upsert"): Promise<StorageResult> {
  if (!supabase) return { ok: false, message: "Supabase 환경변수가 설정되지 않아 고객 정보를 저장할 수 없습니다." };

  let lastErrorMessage = "";
  for (const candidate of customerRowCandidates(state)) {
    const result =
      operation === "insert"
        ? await supabase.from("customers").insert(candidate.rows)
        : await supabase.from("customers").upsert(candidate.rows, { onConflict: "id" });
    if (!result.error) {
      console.info(`[Supabase] customers ${operation.toUpperCase()} success`, { count: candidate.rows.length, mode: candidate.mode });
      return { ok: true, message: "Supabase 저장 완료" };
    }
    lastErrorMessage = result.error.message;
    console.warn(`[Supabase] customers ${operation.toUpperCase()} failed`, { mode: candidate.mode, error: result.error });
  }

  console.error(`[Supabase] customers ${operation.toUpperCase()} failed for every schema candidate`, lastErrorMessage);
  return { ok: false, message: `Supabase 저장 실패: ${lastErrorMessage}` };
}

async function insertRowsWithFallback(state: StoredCustomerState): Promise<StorageResult> {
  return writeRowsWithFallback(state, "insert");
}

async function upsertRowsWithFallback(state: StoredCustomerState): Promise<StorageResult> {
  return writeRowsWithFallback(state, "upsert");
}

function cleanCustomerValue(value: unknown) {
  if (value === "입력 대기" || value === "EMPTY") return "";
  return typeof value === "string" ? value : "";
}

function hasSavableCustomerValue(value: unknown) {
  return cleanCustomerValue(value).trim() !== "";
}

function omitCustomerColumns<T extends Record<string, unknown>, K extends keyof T>(payload: T, keys: K[]) {
  const next = { ...payload };
  keys.forEach((key) => {
    delete next[key];
  });
  return next;
}

function customerProfileColumnPayload(updatedCustomer: CustomerProfile) {
  const payload: Record<string, string> = {};
  const entries = {
    name: updatedCustomer.name,
    gender: updatedCustomer.gender,
    birth_year: updatedCustomer.birth_year ?? updatedCustomer.birthYear,
    age: updatedCustomer.age,
    job: updatedCustomer.job
  };

  Object.entries(entries).forEach(([key, value]) => {
    payload[key] = cleanCustomerValue(value);
  });

  return payload;
}

async function upsertCustomerProfileColumns(updatedCustomer: CustomerProfile): Promise<StorageResult> {
  if (!supabase) return { ok: false, message: "Supabase 환경변수가 설정되지 않아 고객 신상 정보를 저장할 수 없습니다." };

  const profileColumns = customerProfileColumnPayload(updatedCustomer);
  const customerColumnsPayload = {
    ...profileColumns,
    updated_at: new Date().toISOString()
  };
  const payload = { id: updatedCustomer.id, ...customerColumnsPayload };

  if (!Object.keys(profileColumns).length) {
    console.info("saving customer payload skipped: no non-empty profile columns", payload);
    return { ok: true, message: "저장할 고객 신상 정보가 없습니다." };
  }

  console.info("saving customer payload", payload);
  const updateCandidates = [
    { mode: "update_full", values: customerColumnsPayload },
    { mode: "update_without_updated_at", values: profileColumns }
  ];

  let lastErrorMessage = "";
  for (const candidate of updateCandidates) {
    console.info("saving customer payload", { id: updatedCustomer.id, ...candidate.values });
    const { data, error } = await supabase
      .from("customers")
      .update(candidate.values)
      .eq("id", updatedCustomer.id)
      .select("id");

    if (!error && data && data.length > 0) {
      console.info("[Supabase] customer profile UPDATE success", { id: updatedCustomer.id, mode: candidate.mode });
      return { ok: true, message: "고객 신상 정보 Supabase 저장 완료" };
    }
    if (error) {
      lastErrorMessage = error.message;
      console.warn("[Supabase] customer profile UPDATE failed", { mode: candidate.mode, error });
    }
  }

  const upsertCandidates = [
    { mode: "upsert_full", values: payload },
    { mode: "upsert_without_updated_at", values: { id: updatedCustomer.id, ...profileColumns } }
  ];

  for (const candidate of upsertCandidates) {
    console.info("saving customer payload", candidate.values);
    const { error } = await supabase.from("customers").upsert(candidate.values, { onConflict: "id" });
    if (!error) {
      console.info("[Supabase] customer profile UPSERT success", { id: updatedCustomer.id, mode: candidate.mode });
      return { ok: true, message: "고객 신상 정보 Supabase 저장 완료" };
    }
    lastErrorMessage = error.message;
    console.warn("[Supabase] customer profile UPSERT failed", { mode: candidate.mode, error });
  }

  console.error("[Supabase] customer profile SAVE failed", lastErrorMessage);
  return { ok: false, message: `Supabase 고객 신상 정보 저장 실패: ${lastErrorMessage}` };
}

async function saveCustomerProfileColumns(updatedCustomer: CustomerProfile): Promise<StorageResult> {
  if (!supabase) return { ok: false, message: "Supabase is not configured, so customer profile columns cannot be saved." };

  const profileColumns = customerProfileColumnPayload(updatedCustomer);
  if (!Object.keys(profileColumns).length) {
    console.info("saving customer payload skipped: no non-empty profile columns", { id: updatedCustomer.id });
    return { ok: true, message: "No customer profile columns to save." };
  }

  const updatedAt = new Date().toISOString();
  const profileUpdatePayload = {
    ...profileColumns,
    updated_at: updatedAt
  };
  const payload = { id: updatedCustomer.id, ...profileUpdatePayload };
  console.info("saving customer payload", payload);

  const { data, error } = await supabase
    .from("customers")
    .update(profileUpdatePayload)
    .eq("id", updatedCustomer.id)
    .select("id,name,gender,birth_year,age,job");

  if (error) {
    console.error("[Supabase] customer profile UPDATE failed", error);
    return { ok: false, message: `Supabase customer profile save failed: ${error.message}` };
  }

  if (!data || data.length === 0) {
    const insertPayload = {
      id: updatedCustomer.id,
      ...profileUpdatePayload,
      data: {},
      sort_order: updatedCustomer.sort_order ?? 0
    };
    console.info("[Supabase] customer profile row missing; inserting profile row", insertPayload);
    const { data: insertedData, error: insertError } = await supabase
      .from("customers")
      .insert(insertPayload)
      .select("id,name,gender,birth_year,age,job");

    if (insertError) {
      console.error("[Supabase] customer profile INSERT failed", insertError);
      return { ok: false, message: `Supabase customer profile insert failed: ${insertError.message}` };
    }

    if (!insertedData || insertedData.length === 0) {
      const message = "Supabase customer profile row was not inserted.";
      console.error("[Supabase] customer profile INSERT returned no row", { id: updatedCustomer.id, insertPayload });
      return { ok: false, message };
    }
  }

  const { data: verifiedData, error: verifyError } = await supabase
    .from("customers")
    .select("id,name,gender,birth_year,age,job")
    .eq("id", updatedCustomer.id)
    .single();

  if (verifyError) {
    console.error("[Supabase] customer profile VERIFY failed", verifyError);
    return { ok: false, message: `Supabase customer profile verification failed: ${verifyError.message}` };
  }

  console.info("[Supabase] customer profile UPDATE verified", verifiedData);
  return { ok: true, message: "Customer profile saved to Supabase." };
}

async function updateCustomerDataJson(customerId: CustomerId, dataPayload: unknown): Promise<StorageResult> {
  if (!supabase) return { ok: false, message: "Supabase 환경변수가 설정되지 않아 고객 입력 데이터를 저장할 수 없습니다." };

  const payload = {
    data: dataPayload,
    updated_at: new Date().toISOString()
  };

  console.info("[Supabase] saving customer data payload", { id: customerId, ...payload });
  const updateCandidates = [
    { mode: "data_update_full", values: payload },
    { mode: "data_update_without_updated_at", values: omitCustomerColumns(payload, ["updated_at"]) }
  ];

  let lastErrorMessage = "";
  for (const candidate of updateCandidates) {
    const { data, error } = await supabase
      .from("customers")
      .update(candidate.values)
      .eq("id", customerId)
      .select("id");

    if (!error && data && data.length > 0) {
      console.info("[Supabase] customer data UPDATE success", { id: customerId, mode: candidate.mode });
      return { ok: true, message: "고객 입력 데이터 Supabase 저장 완료" };
    }
    if (error) {
      lastErrorMessage = error.message;
      console.warn("[Supabase] customer data UPDATE failed", { mode: candidate.mode, error });
    }
  }

  const upsertCandidates = [
    { mode: "data_upsert_full", values: { id: customerId, ...payload } },
    { mode: "data_upsert_without_updated_at", values: { id: customerId, data: dataPayload } }
  ];

  for (const candidate of upsertCandidates) {
    const { error } = await supabase.from("customers").upsert(candidate.values, { onConflict: "id" });
    if (!error) {
      console.info("[Supabase] customer data UPSERT success", { id: customerId, mode: candidate.mode });
      return { ok: true, message: "고객 입력 데이터 Supabase 저장 완료" };
    }
    lastErrorMessage = error.message;
    console.warn("[Supabase] customer data UPSERT failed", { mode: candidate.mode, error });
  }

  console.error("[Supabase] customer data SAVE failed", lastErrorMessage);
  return { ok: false, message: `Supabase 고객 입력 데이터 저장 실패: ${lastErrorMessage}` };
}

async function saveCustomerDataJsonOnly(customerId: CustomerId, dataPayload: unknown): Promise<StorageResult> {
  if (!supabase) return { ok: false, message: "Supabase is not configured, so customer data cannot be saved." };

  const payload = {
    data: dataPayload,
    updated_at: new Date().toISOString()
  };

  console.info("[Supabase] saving customer data payload", { id: customerId, ...payload });
  const { data, error } = await supabase
    .from("customers")
    .update(payload)
    .eq("id", customerId)
    .select("id");

  if (error) {
    console.error("[Supabase] customer data UPDATE failed", error);
    return { ok: false, message: `Supabase customer data save failed: ${error.message}` };
  }

  if (!data || data.length === 0) {
    const message = "Supabase customer row was not found, so customer data was not saved.";
    console.error("[Supabase] customer data UPDATE missing row", { id: customerId });
    return { ok: false, message };
  }

  console.info("[Supabase] customer data UPDATE success", { id: customerId });
  return { ok: true, message: "Customer data saved to Supabase." };
}

async function insertEmptyCustomerRow(customerId: CustomerId, dataPayload: unknown, sortOrder: number): Promise<StorageResult> {
  if (!supabase) return { ok: false, message: "Supabase 환경변수가 설정되지 않아 고객 row를 생성할 수 없습니다." };

  const payload = {
    id: customerId,
    data: dataPayload,
    sort_order: sortOrder,
    updated_at: new Date().toISOString()
  };

  console.info("[Supabase] inserting empty customer row", payload);
  const insertCandidates = [
    { mode: "insert_empty_full", values: payload },
    { mode: "insert_empty_without_sort_order", values: omitCustomerColumns(payload, ["sort_order"]) },
    { mode: "insert_empty_without_updated_at", values: omitCustomerColumns(payload, ["updated_at"]) },
    { mode: "insert_empty_minimal", values: { id: customerId, data: dataPayload } }
  ];

  let lastErrorMessage = "";
  for (const candidate of insertCandidates) {
    const { error } = await supabase.from("customers").insert(candidate.values);
    if (!error) {
      console.info("[Supabase] empty customer INSERT success", { id: customerId, mode: candidate.mode });
      return { ok: true, message: "고객 row Supabase 생성 완료" };
    }
    lastErrorMessage = error.message;
    console.warn("[Supabase] empty customer INSERT failed", { mode: candidate.mode, error });
  }

  console.error("[Supabase] empty customer INSERT failed", lastErrorMessage);
  return { ok: false, message: `Supabase 고객 row 생성 실패: ${lastErrorMessage}` };
}

// Supabase storage adapter. Preferred schema:
// id text primary key, profile jsonb, app_state jsonb, sort_order integer, updated_at timestamptz.
// If app_state is not present, the app stores form data inside profile.__app_state.
const customerStorage = {
  async selectRows(): Promise<{ rows: CustomerRow[]; errorMessage?: string } | null> {
    if (!supabase) return null;
    try {
      const orderedResult = await supabase
        .from("customers")
        .select("*")
        .order("sort_order", { ascending: true });
      const { data, error } = orderedResult.error
        ? await supabase.from("customers").select("*")
        : orderedResult;

      if (error) throw error;
      const rows = Array.isArray(data) ? (data as CustomerRow[]) : [];
      console.info("[Supabase] customers SELECT success", { count: rows.length });
      return { rows };
    } catch (error) {
      console.error("[Supabase] customers SELECT failed", error);
      return { rows: [], errorMessage: "Supabase 고객 데이터 로드에 실패했습니다. 테이블 권한과 컬럼 구성을 확인해주세요." };
    }
  },
  async load(): Promise<StoredCustomerState | null> {
    if (!supabase) return null;
    try {
      const orderedResult = await supabase
        .from("customers")
        .select("*")
        .order("sort_order", { ascending: true });
      const { data, error } = orderedResult.error
        ? await supabase.from("customers").select("*")
        : orderedResult;

      if (error) throw error;
      const rows = Array.isArray(data) ? (data as CustomerRow[]) : [];
      console.info("[Supabase] customers SELECT success", { count: rows.length });
      if (!rows.length) {
        const defaultState: StoredCustomerState = {
          customerProfiles: defaultCustomerProfiles,
          customerData: createInitialCustomerData(defaultCustomerProfiles),
          selectedCustomer: defaultCustomerProfiles[0].id
        };
        const seedResult = await this.insertDefaults(defaultState);
        if (!seedResult.ok) {
          latestStorageErrorMessage = seedResult.message;
          console.error("[Supabase] default customers INSERT failed", seedResult.message);
        } else {
          latestStorageErrorMessage = "";
        }
        return defaultState;
      }
      latestStorageErrorMessage = "";
      return customerRowsToStoredState(rows);
    } catch (error) {
      console.error("[Supabase] customers SELECT failed", error);
      latestStorageErrorMessage = "Supabase 고객 데이터 로드에 실패했습니다. 테이블 권한과 컬럼 구성을 확인해주세요.";
      return null;
    }
  },
  async save(state: StoredCustomerState): Promise<StorageResult> {
    return saveCustomerDataJsonOnly(state.selectedCustomer, normalizeAppState(state.customerData[state.selectedCustomer]));
  },
  async insertCustomer(profile: CustomerProfile, appState: AppState, sortOrder: number): Promise<StorageResult> {
    return insertEmptyCustomerRow(profile.id, normalizeAppState(appState), sortOrder);
  },
  async insertDefaults(state: StoredCustomerState): Promise<StorageResult> {
    let finalResult: StorageResult = { ok: true, message: "기본 고객 Supabase 생성 완료" };
    for (const [index, profile] of state.customerProfiles.entries()) {
      const result = await insertEmptyCustomerRow(profile.id, normalizeAppState(state.customerData[profile.id]), index);
      if (!result.ok) finalResult = result;
    }
    return finalResult;
  },
  async remove(customerId: CustomerId): Promise<StorageResult> {
    if (!supabase) return { ok: false, message: "Supabase 환경변수가 설정되지 않아 고객을 삭제할 수 없습니다." };
    const { error } = await supabase.from("customers").delete().eq("id", customerId);
    if (error) {
      console.error("[Supabase] customer DELETE failed", error);
      return { ok: false, message: `Supabase 고객 삭제 실패: ${error.message}` };
    }
    console.info("[Supabase] customer DELETE success", { id: customerId });
    return { ok: true, message: "고객 Supabase 삭제 완료" };
  }
};

async function loadStoredCustomerState() {
  return customerStorage.load();
}

async function saveStoredCustomerState(customerProfiles: CustomerProfile[], customerData: Record<CustomerId, AppState>, selectedCustomer: CustomerId) {
  return customerStorage.save({ customerProfiles, customerData, selectedCustomer });
}

function getStoredSelectedCustomerId() {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(selectedCustomerStorageKey);
}

function storeSelectedCustomerId(customerId: CustomerId) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(selectedCustomerStorageKey, customerId);
}

const noneExperience = "금융상품에 투자해 본 경험 없음";
const noLegalConstraint = "없음";

const returnOptions = [
  "적극적 수익 추구",
  "시장수익률 수준의 수익 추구",
  "예금, 채권이자 수준의 안정적 수익 추구",
  "원금 보존 투자"
];

const riskExperienceOptions = [
  "ELW, 선물옵션, 주식신용거래, 파생상품 펀드",
  "주식, 주식형펀드, 원금비보장ELS, 고위험회사채",
  "혼합형펀드, 원금부분보장ELS, 일반 회사채",
  "은행 예/적금, 채권형펀드, 원금지급형ELB, 금융채",
  noneExperience
];

const fieldGroups = {
  knowledge: [
    "금융상품을 잘 이해하며 스스로 의사결정 가능",
    "금융상품을 이해하며 설명 듣고 의사결정 가능",
    "서로 다른 금융상품을 구별할 수 있음",
    "금융상품에 대해 전혀 모름"
  ],
  derivatives: ["3년 이상", "2년 이상", "1년 이상", "1년 미만", "없음"],
  financialAssetRatio: ["10% 미만", "10~25% 미만", "25~50% 미만", "50~75% 미만", "75% 이상"],
  investmentAssetRatio: ["10% 미만", "10~20% 미만", "20~30% 미만", "30~40% 미만", "40% 이상"],
  riskAttitude: [
    "고수익의 기회를 위해 큰 폭의 손실 가능성도 받아들일 수 있음",
    "수익을 기대할 수 있다면 일정 수준의 손실을 수용할 수 있음",
    "일부 손실은 감수할 수 있으나, 전체적인 안정성이 중요",
    "원금 보전을 최우선으로 하며 손실 가능성을 원하지 않음"
  ],
  lossResponse: ["신규 자금 추가 투자", "관망", "일부 환매", "전액 환매 또는 계약 해지"],
  timeHorizon: ["5년 이상", "3~5년", "2~3년", "1~2년", "1년 미만"],
  giftingPlan: ["없음", "검토 중", "있음"],
  taxImportance: ["아니오", "보통", "매우 중요"],
  recentTax: ["예", "아니오", "모름"],
  legal: [noLegalConstraint, "임직원 매매 제한", "기타"]
};

const tenPointScale = [10, 8, 5, 3, 0];
const knowledgeScale = [10, 6, 3, 0];
const riskAttitudeScale = [25, 18, 10, 0];

const riskInterpretations: Record<RiskLevel, string> = {
  초저위험: "원금 보전을 가장 중요하게 생각하며, 손실 가능성이 낮은 상품을 선호합니다.",
  저위험: "안정성을 중시하되, 제한적인 범위 내에서 수익을 추구합니다.",
  중위험: "일정 수준의 손실을 감수하며, 균형 잡힌 수익을 추구합니다.",
  고위험: "원금 손실 가능성을 감수하더라도, 적극적인 수익을 추구합니다.",
  초고위험: "높은 변동성과 손실 가능성을 감수하고, 고수익 기회를 적극적으로 추구합니다."
};

export default function Home() {
  const [customerProfiles, setCustomerProfiles] = useState<CustomerProfile[]>(defaultCustomerProfiles);
  const [customerData, setCustomerData] = useState<Record<CustomerId, AppState>>(() => createInitialCustomerData(defaultCustomerProfiles));
  const [selectedCustomer, setSelectedCustomer] = useState<CustomerId>(defaultCustomerProfiles[0].id);
  const [showCustomerTabs, setShowCustomerTabs] = useState(false);
  const [draggedCustomerId, setDraggedCustomerId] = useState<CustomerId | null>(null);
  const [customerDropIndex, setCustomerDropIndex] = useState<number | null>(null);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<WorkspaceTab>("profile");
  const [storageReady, setStorageReady] = useState(false);
  const [isSeeding, setIsSeeding] = useState(false);
  const [persistedCustomerIds, setPersistedCustomerIds] = useState<CustomerId[]>([]);
  const [customerUpdatedAt, setCustomerUpdatedAt] = useState<CustomerUpdatedMap>({});
  const [storageErrorMessage, setStorageErrorMessage] = useState("");
  const [analysisRequested, setAnalysisRequested] = useState(false);
  const [confirmedRiskResult, setConfirmedRiskResult] = useState<RiskResult | null>(null);
  const [lastAnalysisSnapshot, setLastAnalysisSnapshot] = useState<StructuredJsonPayload | null>(null);
  const [changeHistory, setChangeHistory] = useState<ChangeEntry[]>([]);
  const [changeHistoryExpanded, setChangeHistoryExpanded] = useState(false);
  const formData = customerData[selectedCustomer] ?? createInitialState();
  const selectedCustomerProfile = customerProfiles.find((customer) => customer.id === selectedCustomer) ?? customerProfiles[0];

  useEffect(() => {
    let cancelled = false;

    async function loadCustomers() {
      const selectedRows = await customerStorage.selectRows();
      if (cancelled) return;

      if (!selectedRows) {
        setStorageErrorMessage("Supabase 환경변수가 설정되지 않아 고객 데이터를 불러올 수 없습니다.");
        setStorageReady(true);
        return;
      }
      if (selectedRows.errorMessage) {
        setStorageErrorMessage(selectedRows.errorMessage);
        setStorageReady(true);
        return;
      }

      let rows = selectedRows.rows;
      if (!rows.length) {
        setIsSeeding(true);
        const defaultState: StoredCustomerState = {
          customerProfiles: defaultCustomerProfiles,
          customerData: createInitialCustomerData(defaultCustomerProfiles),
          selectedCustomer: defaultCustomerProfiles[0].id
        };
        const seedResult = await customerStorage.insertDefaults(defaultState);
        if (cancelled) return;
        if (!seedResult.ok) {
          setStorageErrorMessage(seedResult.message);
          console.error("[Supabase] default customers INSERT failed", seedResult.message);
          setIsSeeding(false);
          setStorageReady(true);
          return;
        }

        const seededRows = await customerStorage.selectRows();
        if (cancelled) return;
        if (!seededRows || seededRows.errorMessage) {
          setStorageErrorMessage(seededRows?.errorMessage ?? "Supabase 기본 고객 생성 후 재조회에 실패했습니다.");
          setIsSeeding(false);
          setStorageReady(true);
          return;
        }
        rows = seededRows.rows;
      }

      const storedState = rows.length ? customerRowsToStoredState(rows) : null;
      if (storedState) {
        const storedSelectedCustomerId = getStoredSelectedCustomerId();
        const nextSelectedCustomer =
          storedSelectedCustomerId && storedState.customerProfiles.some((profile) => profile.id === storedSelectedCustomerId)
            ? storedSelectedCustomerId
            : storedState.selectedCustomer;
        setCustomerProfiles(storedState.customerProfiles);
        setCustomerData(storedState.customerData);
        setSelectedCustomer(nextSelectedCustomer);
        storeSelectedCustomerId(nextSelectedCustomer);
        setPersistedCustomerIds(rows.map((row) => row.id));
        setCustomerUpdatedAt(customerRowsToUpdatedMap(rows));
      }
      setIsSeeding(false);
      setStorageErrorMessage("");
      setStorageReady(true);
    }

    loadCustomers();
    return () => {
      cancelled = true;
    };
  }, []);

  const riskResult = useMemo(() => calculateRiskResult(formData.rrttllu), [formData.rrttllu]);

  const financialCompletion = useMemo(
    () =>
      completion([
        formData.financial.totalAssets,
        formData.financial.financialAssets,
        formData.financial.realEstate,
        formData.financial.debt,
        formData.financial.annualFixedIncome,
        formData.financial.irregularIncomeNone ? "없음" : formData.financial.irregularIncome,
        formData.financial.monthlyFixedExpense
      ]),
    [formData.financial]
  );

  const rrttlluCompletion = useMemo(() => {
    const r = formData.rrttllu;
    return completion([
      r.returnObjective,
      r.expectedReturnUnknown ? "unknown" : r.expectedReturn,
      r.investmentExperience.length ? "selected" : "",
      r.knowledgeLevel,
      r.derivativesExperience,
      r.financialAssetRatio,
      r.investmentAssetRatio,
      r.riskAttitude,
      r.lossResponse,
      r.timeHorizon,
      r.expectedInterestIncome,
      r.expectedDividendIncome,
      r.giftingPlan,
      r.globalTaxImportance,
      r.recentGlobalTaxSubject,
      r.foreignStockTaxImportance,
      r.regularCashflowNeed,
      r.lumpSumPlan,
      r.emergencyReservePlan,
      r.legalConstraints.length ? "selected" : "",
      r.preferredAssets,
      r.avoidedAssets,
      r.holdingOrDisposalPlan,
      r.uniqueOther
    ]);
  }, [formData.rrttllu]);

  const internalJsonPayload = useMemo(
    () => buildStructuredJsonPayload(formData, confirmedRiskResult ?? riskResult, selectedCustomerProfile),
    [confirmedRiskResult, formData, riskResult, selectedCustomerProfile]
  );

  const warnings = internalJsonPayload.rrttllu.warnings;
  const liquiditySummary = useMemo(() => calculateLiquiditySummary(formData), [formData]);
  const customerDataJsonPayload = useMemo(
    () => ({
      appState: formData,
      analysis: {
        riskResult,
        internalJsonPayload,
        liquiditySummary,
        financialCompletion,
        rrttlluCompletion
      }
    }),
    [financialCompletion, formData, internalJsonPayload, liquiditySummary, riskResult, rrttlluCompletion]
  );

  useEffect(() => {
    if (!storageReady) return;
    if (isSeeding) return;
    if (!persistedCustomerIds.includes(selectedCustomer)) return;
    void saveCustomerDataJsonOnly(selectedCustomer, customerDataJsonPayload).then((result) => {
      if (!result.ok) {
        setStorageErrorMessage(result.message);
      } else {
        setStorageErrorMessage("");
      }
    });
  }, [customerDataJsonPayload, isSeeding, persistedCustomerIds, selectedCustomer, storageReady]);

  const markCustomerUpdated = (customerId: CustomerId, timestamp = Date.now()) => {
    setCustomerUpdatedAt((prev) => ({ ...prev, [customerId]: timestamp }));
  };

  const setFormData = (updater: (current: AppState) => AppState) => {
    markCustomerUpdated(selectedCustomer);
    setCustomerData((prev) => ({
      ...prev,
      [selectedCustomer]: updater(prev[selectedCustomer] ?? createInitialState())
    }));
  };

  const selectCustomer = (customerId: CustomerId) => {
    setSelectedCustomer(customerId);
    storeSelectedCustomerId(customerId);
    setAnalysisRequested(false);
    setConfirmedRiskResult(null);
    setLastAnalysisSnapshot(null);
    setChangeHistory([]);
    setChangeHistoryExpanded(false);
  };

  const resetSelectedCustomer = () => {
    const resetCurrent = window.confirm("현재 고객만 초기화하시겠습니까?");
    if (resetCurrent) {
      markCustomerUpdated(selectedCustomer);
      setCustomerData((prev) => ({
        ...prev,
        [selectedCustomer]: createInitialState()
      }));
    } else {
      const resetAll = window.confirm("전체 고객을 초기화하시겠습니까?");
      if (!resetAll) return;
      const resetAt = Date.now();
      setCustomerUpdatedAt(Object.fromEntries(customerProfiles.map((profile) => [profile.id, resetAt])));
      setCustomerData(createInitialCustomerData(customerProfiles));
      setSelectedCustomer(customerProfiles[0]?.id ?? defaultCustomerProfiles[0].id);
    }
    setAnalysisRequested(false);
    setConfirmedRiskResult(null);
    setLastAnalysisSnapshot(null);
    setChangeHistory([]);
    setChangeHistoryExpanded(false);
  };

  const addCustomer = () => {
    const profile = createNewCustomerProfile();
    const newCustomerState = createInitialState();
    setCustomerProfiles((prev) => [...prev, profile]);
    setCustomerData((prev) => ({ ...prev, [profile.id]: newCustomerState }));
    markCustomerUpdated(profile.id);
    void customerStorage.insertCustomer(profile, newCustomerState, customerProfiles.length).then((result) => {
      if (!result.ok) {
        setStorageErrorMessage(result.message);
      } else {
        setPersistedCustomerIds((prev) => (prev.includes(profile.id) ? prev : [...prev, profile.id]));
        setStorageErrorMessage("");
      }
    });
    selectCustomer(profile.id);
  };

  const reorderCustomer = (dropIndex: number) => {
    if (!draggedCustomerId) return;
    setCustomerProfiles((prev) => {
      const sourceIndex = prev.findIndex((profile) => profile.id === draggedCustomerId);
      if (sourceIndex < 0) return prev;

      const next = [...prev];
      const [moved] = next.splice(sourceIndex, 1);
      const adjustedDropIndex = sourceIndex < dropIndex ? dropIndex - 1 : dropIndex;
      next.splice(Math.max(0, Math.min(adjustedDropIndex, next.length)), 0, moved);
      return next;
    });
    setDraggedCustomerId(null);
    setCustomerDropIndex(null);
  };

  const deleteSelectedCustomer = () => {
    const remainingProfiles = customerProfiles.filter((profile) => profile.id !== selectedCustomer);
    const nextProfiles = remainingProfiles.length ? remainingProfiles : [createNewCustomerProfile()];
    const nextSelectedCustomer = nextProfiles[0].id;

    setCustomerProfiles(nextProfiles);
    setCustomerData((prev) => {
      const nextData = { ...prev };
      delete nextData[selectedCustomer];
      if (!nextData[nextSelectedCustomer]) {
        nextData[nextSelectedCustomer] = createInitialState();
      }
      return nextData;
    });
    void customerStorage.remove(selectedCustomer).then((result) => {
      if (!result.ok) {
        setStorageErrorMessage(result.message);
      } else {
        setPersistedCustomerIds((prev) => prev.filter((customerId) => customerId !== selectedCustomer));
        setCustomerUpdatedAt((prev) => {
          const next = { ...prev };
          delete next[selectedCustomer];
          return next;
        });
        setStorageErrorMessage("");
      }
    });
    selectCustomer(nextSelectedCustomer);
    setDeleteConfirmOpen(false);
  };

  const updateCustomerField = (customerId: CustomerId, field: keyof Pick<CustomerProfile, "name" | "gender" | "birth_year" | "age" | "job">, value: string) => {
    const customerIndex = customerProfiles.findIndex((profile) => profile.id === customerId);
    const currentCustomer = customerProfiles[customerIndex];
    if (!currentCustomer) return;

    const updatedCustomer: CustomerProfile = {
      ...currentCustomer,
      [field]: value,
      birthYear: field === "birth_year" ? value : currentCustomer.birthYear,
      birth_year: field === "birth_year" ? value : currentCustomer.birth_year,
      sort_order: customerIndex
    };
    const updatedCustomers = customerProfiles.map((customer) => (customer.id === customerId ? updatedCustomer : customer));

    setCustomerProfiles(updatedCustomers);
    markCustomerUpdated(updatedCustomer.id);
    if (!storageReady) return;
    if (isSeeding) return;

    void saveCustomerProfileColumns(updatedCustomer).then((result) => {
      if (!result.ok) {
        setStorageErrorMessage(result.message);
      } else {
        setPersistedCustomerIds((prev) => (prev.includes(updatedCustomer.id) ? prev : [...prev, updatedCustomer.id]));
        setStorageErrorMessage("");
      }
    });
  };

  const updateCustomerProfile = (key: keyof Omit<CustomerProfile, "id">, value: string) => {
    const field = key === "birthYear" ? "birth_year" : key;
    if (field === "name" || field === "gender" || field === "birth_year" || field === "age" || field === "job") {
      updateCustomerField(selectedCustomer, field, value);
    }
  };

  const setFinancial = (key: keyof FinancialInfo, value: string) => {
    setFormData((prev) => ({
      ...prev,
      financial: { ...prev.financial, [key]: value }
    }));
  };

  const setRrttllu = (key: keyof RrttlluInfo, value: string) => {
    setFormData((prev) => ({
      ...prev,
      rrttllu: { ...prev.rrttllu, [key]: value }
    }));
  };

  const setIrregularIncome = (value: string) => {
    setFormData((prev) => ({
      ...prev,
      financial: { ...prev.financial, irregularIncome: value, irregularIncomeNone: false }
    }));
  };

  const toggleNoIrregularIncome = () => {
    setFormData((prev) => ({
      ...prev,
      financial: {
        ...prev.financial,
        irregularIncome: "",
        irregularIncomeNone: !prev.financial.irregularIncomeNone
      }
    }));
  };

  const setExpectedReturn = (value: string) => {
    setFormData((prev) => ({
      ...prev,
      rrttllu: { ...prev.rrttllu, expectedReturn: value, expectedReturnUnknown: false }
    }));
  };

  const toggleExpectedReturnUnknown = () => {
    setFormData((prev) => ({
      ...prev,
      rrttllu: {
        ...prev.rrttllu,
        expectedReturn: "",
        expectedReturnUnknown: !prev.rrttllu.expectedReturnUnknown
      }
    }));
  };

  const toggleInvestmentExperience = (option: string) => {
    setFormData((prev) => {
      const current = prev.rrttllu.investmentExperience;
      const next =
        option === noneExperience
          ? current.includes(option)
            ? []
            : [option]
          : current.includes(option)
            ? current.filter((item) => item !== option)
            : [...current.filter((item) => item !== noneExperience), option];

      return { ...prev, rrttllu: { ...prev.rrttllu, investmentExperience: next } };
    });
  };

  const toggleLegalConstraint = (option: string) => {
    setFormData((prev) => {
      const current = prev.rrttllu.legalConstraints;
      const next =
        option === noLegalConstraint
          ? current.includes(option)
            ? []
            : [option]
          : current.includes(option)
            ? current.filter((item) => item !== option)
            : [...current.filter((item) => item !== noLegalConstraint), option];

      return {
        ...prev,
        rrttllu: {
          ...prev.rrttllu,
          legalConstraints: next,
          legalConstraintOther: next.includes("기타") ? prev.rrttllu.legalConstraintOther : ""
        }
      };
    });
  };

  const analyzeRrttllu = () => {
    const latestPayload = buildStructuredJsonPayload(formData, riskResult);
    const changes = lastAnalysisSnapshot ? diffAnalysisPayload(lastAnalysisSnapshot, latestPayload) : [];

    setAnalysisRequested(true);
    setConfirmedRiskResult(riskResult);
    setLastAnalysisSnapshot(latestPayload);
    setChangeHistory(changes);
    setChangeHistoryExpanded(false);
  };

  return (
    <main className="min-h-screen px-5 py-6 text-ink lg:px-8">
      <div className="mx-auto flex max-w-[1680px] flex-col gap-5">
        <CustomerSelector
          customers={customerProfiles}
          selectedCustomer={selectedCustomer}
          showCustomers={showCustomerTabs}
          onToggleSearch={() => setShowCustomerTabs((prev) => !prev)}
          onSelectCustomer={selectCustomer}
          onAddCustomer={addCustomer}
          onRequestDelete={() => setDeleteConfirmOpen(true)}
          onDragStartCustomer={setDraggedCustomerId}
          draggedCustomerId={draggedCustomerId}
          dropIndex={customerDropIndex}
          onSetDropIndex={setCustomerDropIndex}
          onDropCustomer={reorderCustomer}
          recentUpdatedAt={customerUpdatedAt[selectedCustomer] ?? 0}
          storageErrorMessage={storageErrorMessage}
        />
        <div className="flex flex-col gap-5 xl:flex-row">
          <TabStrip activeTab={activeTab} onChange={setActiveTab} />
        <section className="min-w-0 flex-1">
          <div className="flex flex-col gap-5">
        <header className="rounded-lg border border-slate-200 bg-white px-6 py-5 shadow-soft">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
            <div>
              <p className="text-sm font-semibold text-samsung">Samsung Securities PB Advisory</p>
              <h1 className="mt-1 text-2xl font-bold tracking-normal text-navy md:text-3xl">
                VVIP 고객 지능형 입력부
              </h1>
            </div>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <Metric label="기본 정보" value={`${financialCompletion}%`} />
              <Metric label="RRTTLLU" value={`${rrttlluCompletion}%`} />
              <Metric label="Risk 점수" value={`${riskResult.score}/100`} />
              <Metric label="경고" value={`${warnings.length}개`} strong />
            </div>
          </div>
        </header>

        {activeTab === "profile" ? (
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1.18fr)_minmax(430px,0.82fr)]">
          <section className="space-y-5">
            <CustomerInfoCard profile={selectedCustomerProfile} onChange={updateCustomerProfile} />
            <Panel
              icon={<WalletCards size={18} />}
              eyebrow="기본 재무 정보"
              title="고객 재무 현황"
              note="※ 금액은 원화(KRW) 기준으로 입력해주세요."
            >
              <div className="question-card asset-summary-card rounded-lg border border-slate-200 p-4">
                <p className="text-sm font-bold text-slate-800">{questionLabel("현재 자산 현황을 알려주세요.")}</p>
                <p className="mt-1 text-xs font-semibold text-slate-500">총 자산, 금융자산, 부동산, 부채를 항목별로 입력합니다.</p>
                <div className="asset-detail-grid mt-3 grid gap-3 md:grid-cols-2">
                  <TextField compact label="총 자산" value={formData.financial.totalAssets} placeholder="예. 20억 원" onChange={(value) => setFinancial("totalAssets", value)} />
                  <TextField compact label="금융자산" value={formData.financial.financialAssets} placeholder="예. 8억 원" onChange={(value) => setFinancial("financialAssets", value)} />
                  <TextField compact label="부동산" value={formData.financial.realEstate} placeholder="예. 15억 원" onChange={(value) => setFinancial("realEstate", value)} />
                  <TextField compact label="부채" value={formData.financial.debt} placeholder="예. 3억 원" onChange={(value) => setFinancial("debt", value)} />
                </div>
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <TextField label="(가구 기준) 연 고정소득" value={formData.financial.annualFixedIncome} placeholder="예. 3억 원~5억 원" onChange={(value) => setFinancial("annualFixedIncome", value)} />
                <TextField label="(가구 기준) 월 고정지출" value={formData.financial.monthlyFixedExpense} placeholder="예. 500만 원~1,000만 원" onChange={(value) => setFinancial("monthlyFixedExpense", value)} />
              </div>
              <IncomeWithNoneField
                label="향후 예상되는 비정기 소득"
                value={formData.financial.irregularIncome}
                placeholder="예. 연 성과급 6~7억 원, 3년 내 스톡옵션 행사, 사업체 매각대금 약 20억 원 예상"
                noneSelected={formData.financial.irregularIncomeNone}
                onChange={setIrregularIncome}
                onToggleNone={toggleNoIrregularIncome}
              />
            </Panel>

            <Panel icon={<BarChart3 size={18} />} eyebrow="RRTTLLU" title="① Return 목표 수익률">
              <ChoiceGroup label="투자 목적은 무엇인가요?" options={returnOptions} value={formData.rrttllu.returnObjective} onChange={(value) => setRrttllu("returnObjective", value)} />
              <ExpectedReturnField
                value={formData.rrttllu.expectedReturn}
                unknownSelected={formData.rrttllu.expectedReturnUnknown}
                onChange={setExpectedReturn}
                onToggleUnknown={toggleExpectedReturnUnknown}
              />
            </Panel>

            <Panel icon={<ShieldCheck size={18} />} eyebrow="RRTTLLU" title="② Risk 위험 허용도">
              <MultiChoiceGroup label="투자 경험이 있는 금융상품을 모두 선택해주세요." options={riskExperienceOptions} values={formData.rrttllu.investmentExperience} onToggle={toggleInvestmentExperience} />
              <ChoiceGroup label="투자 지식 수준은 어느 정도인가요?" options={fieldGroups.knowledge} value={formData.rrttllu.knowledgeLevel} onChange={(value) => setRrttllu("knowledgeLevel", value)} />
              <ChoiceGroup label="파생상품 투자 경험이 있으신가요?" description="파생상품: 파생상품, 원금비보장형 파생결합 증권, 파생상품펀드, 레버리지/인버스 ETF 등" options={fieldGroups.derivatives} value={formData.rrttllu.derivativesExperience} onChange={(value) => setRrttllu("derivativesExperience", value)} />
              <div className="risk-ratio-grid grid gap-4 lg:grid-cols-2">
                <ChoiceGroup cardClassName="risk-mobile-gray" label="총 자산 중 금융자산의 비중" description="금융자산: 예·적금, CMA, 투자자산(주식·채권·펀드·ETF 등) 등" options={fieldGroups.financialAssetRatio} value={formData.rrttllu.financialAssetRatio} onChange={(value) => setRrttllu("financialAssetRatio", value)} />
                <ChoiceGroup cardClassName="risk-mobile-blue" label="금융자산 중 투자자산의 비중" description="투자자산: 주식, ETF, 펀드, 채권, 리츠(REITs), ELS 등" options={fieldGroups.investmentAssetRatio} value={formData.rrttllu.investmentAssetRatio} onChange={(value) => setRrttllu("investmentAssetRatio", value)} />
              </div>
              <ChoiceGroup cardClassName="risk-mobile-gray" label="기대이익 및 기대손실 등을 고려한 위험에 대한 태도" options={fieldGroups.riskAttitude} value={formData.rrttllu.riskAttitude} onChange={(value) => setRrttllu("riskAttitude", value)} />
              <ChoiceGroup cardClassName="risk-mobile-blue" label="단기적으로 손실이 초과 발생할 때 대응" options={fieldGroups.lossResponse} value={formData.rrttllu.lossResponse} onChange={(value) => setRrttllu("lossResponse", value)} />
            </Panel>

            <Panel icon={<ClipboardList size={18} />} eyebrow="RRTTLLU" title="③ Time Horizon 투자 기간">
              <ChoiceGroup label="투자 가능한 기간을 선택해 주세요." options={fieldGroups.timeHorizon} value={formData.rrttllu.timeHorizon} onChange={(value) => setRrttllu("timeHorizon", value)} />
            </Panel>

            <Panel icon={<PieChart size={18} />} eyebrow="RRTTLLU" title="④ Tax 세금 요인">
              <div className="grid gap-3 md:grid-cols-2">
                <TextField tone="blue" label="올해 예상 이자소득" value={formData.rrttllu.expectedInterestIncome} placeholder="예. 1,000만 원~2,000만 원" onChange={(value) => setRrttllu("expectedInterestIncome", value)} />
                <TextField tone="gray" label="올해 예상 배당소득" value={formData.rrttllu.expectedDividendIncome} placeholder="예. 1,000만 원 미만" onChange={(value) => setRrttllu("expectedDividendIncome", value)} />
              </div>
              <div className="grid gap-4 lg:grid-cols-2">
                <ChoiceGroup tone="gray" label="자녀/가족 사전증여 계획" options={fieldGroups.giftingPlan} value={formData.rrttllu.giftingPlan} onChange={(value) => setRrttllu("giftingPlan", value)} />
                <ChoiceGroup tone="blue" label="금융소득종합과세 절감 중요도" options={fieldGroups.taxImportance} value={formData.rrttllu.globalTaxImportance} onChange={(value) => setRrttllu("globalTaxImportance", value)} />
                <ChoiceGroup tone="blue" label="최근 3년 내 금융소득종합과세 대상 여부" options={fieldGroups.recentTax} value={formData.rrttllu.recentGlobalTaxSubject} onChange={(value) => setRrttllu("recentGlobalTaxSubject", value)} />
                <ChoiceGroup tone="gray" label="해외주식 양도소득세 절감 중요도" options={fieldGroups.taxImportance} value={formData.rrttllu.foreignStockTaxImportance} onChange={(value) => setRrttllu("foreignStockTaxImportance", value)} />
              </div>
            </Panel>

            <Panel icon={<WalletCards size={18} />} eyebrow="RRTTLLU" title="⑤ Liquidity 유동성 필요 시기">
              <div className="grid gap-3 md:grid-cols-2">
                <TextField label="향후 정기적인 현금흐름 필요" value={formData.rrttllu.regularCashflowNeed} placeholder="예. 20년간 월 생활비 500만 원" onChange={(value) => setRrttllu("regularCashflowNeed", value)} />
                <TextField label="향후 목돈 사용 계획" value={formData.rrttllu.lumpSumPlan} placeholder="예. 5년 후 자녀 유학비 1억원" onChange={(value) => setRrttllu("lumpSumPlan", value)} />
                <TextField label="향후 비상예비자금 확보 계획" value={formData.rrttllu.emergencyReservePlan} placeholder="예. 의료비 등 비상 상황 대비 1억 원" onChange={(value) => setRrttllu("emergencyReservePlan", value)} />
              </div>
              <LiquiditySummary summary={liquiditySummary} />
            </Panel>

            <Panel icon={<LockKeyhole size={18} />} eyebrow="RRTTLLU" title="⑥ Legal 법적 규제">
              <MultiChoiceGroup label="투자 의사결정에 영향을 줄 수 있는 법적/제도적 제약" options={fieldGroups.legal} values={formData.rrttllu.legalConstraints} onToggle={toggleLegalConstraint} />
              {formData.rrttllu.legalConstraints.includes("기타") ? (
                <TextField label="기타 제약 직접 입력" value={formData.rrttllu.legalConstraintOther} placeholder="예. 내부 투자심의 승인 필요" onChange={(value) => setRrttllu("legalConstraintOther", value)} />
              ) : null}
            </Panel>

            <Panel icon={<Sparkles size={18} />} eyebrow="RRTTLLU" title="⑦ Unique Circumstances 고객 고유 상황">
              <div className="grid gap-3 md:grid-cols-2">
                <TextAreaField label="선호하는 자산" value={formData.rrttllu.preferredAssets} placeholder="예. 미국 배당주 ETF, 은퇴 후 안정적 현금흐름" onChange={(value) => setRrttllu("preferredAssets", value)} />
                <TextAreaField label="피하고 싶은 자산" value={formData.rrttllu.avoidedAssets} placeholder="예. 가상자산, 가치 평가가 어려움" onChange={(value) => setRrttllu("avoidedAssets", value)} />
              </div>
              <TextAreaField label="계속 보유하거나 향후 처분할 계획" value={formData.rrttllu.holdingOrDisposalPlan} placeholder="예. 삼성전자 10억 원은 계속 보유, 1년 내 임대용 부동산 매각, 해외주식 차익이 커서 올해 일부만 매도 등" onChange={(value) => setRrttllu("holdingOrDisposalPlan", value)} />
              <TextAreaField label="기타" value={formData.rrttllu.uniqueOther} placeholder="예. 투자 의사결정에 영향을 줄 수 있는 가족 상황, 선호 상담 방식, 정성적 고려사항 등" onChange={(value) => setRrttllu("uniqueOther", value)} />
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-900">
                선호 자산은 추천 시 우선 고려하고, 비선호 자산은 추천 후보에서 제외하거나 최대 비중 0% 제한 조건으로 저장됩니다.
              </div>
            </Panel>
          </section>

          <aside className="space-y-5 xl:sticky xl:top-6 xl:max-h-[calc(100vh-48px)] xl:overflow-auto xl:pr-1">
            <div className="grid gap-3 sm:grid-cols-2">
              <button className="flex min-h-12 items-center justify-center gap-2 rounded-lg bg-samsung px-4 py-3 text-sm font-bold text-white shadow-soft transition hover:bg-[#1b35bd]" onClick={analyzeRrttllu}>
                <BarChart3 size={17} />
                재분석
              </button>
              <button className="flex min-h-12 items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-3 text-sm font-bold text-slate-700 shadow-soft transition hover:border-slate-400 hover:bg-slate-50" onClick={resetSelectedCustomer}>
                <AlertTriangle size={17} />
                초기화
              </button>
            </div>

            <ResultCard icon={<WalletCards size={18} />} title="기본 재무 정보 요약 카드" accent="blue">
              <ResultGrid
                rows={[
                  ["총 자산", formData.financial.totalAssets || "입력 대기"],
                  ["금융자산", formData.financial.financialAssets || "입력 대기"],
                  ["향후 주요 자금 유입", irregularIncomeDisplay(formData.financial)],
                  ["부동산", formData.financial.realEstate || "입력 대기"],
                  ["부채", formData.financial.debt || "입력 대기"],
                  ["필요자금", liquiditySummary.requiredDisplay],
                  ["투자 가능 자산", liquiditySummary.investableDisplay]
                ]}
              />
              <p className="mt-3 text-sm text-slate-600">
                입력값은 실시간으로 요약에 반영됩니다.
              </p>
            </ResultCard>

            <ResultCard icon={<ClipboardList size={18} />} title="RRTTLLU 분석 결과 카드" accent="green">
              <div className="grid gap-2 text-sm">
                <Highlight label="Return" value={formData.rrttllu.returnObjective || "미선택"} />
                <Highlight label="기대수익률" value={expectedReturnDisplay(formData.rrttllu)} />
                <Highlight label="Risk 핵심 태도" value={formData.rrttllu.riskAttitude || "미선택"} />
                <Highlight label="Time Horizon" value={formData.rrttllu.timeHorizon || "미선택"} />
                <Highlight label="Unique 제약" value={formData.rrttllu.preferredAssets || "선호 자산 입력 대기"} />
              </div>
              {analysisRequested ? (
                <p className="mt-3 text-sm text-slate-600">RRTTLLU 분석 결과가 갱신되었습니다.</p>
              ) : null}
            </ResultCard>

            <ResultCard icon={<ShieldCheck size={18} />} title="Risk 점수 및 위험등급 카드" accent="gold">
              <div className="grid gap-3">
                <div className="rounded-lg bg-amber-50 p-4 ring-1 ring-amber-100">
                  <p className="text-sm font-semibold text-amber-800">위험점수</p>
                  <p className="mt-1 text-3xl font-bold text-navy">{riskResult.score}/100</p>
                </div>
                <div className="rounded-lg bg-slate-50 p-4">
                  <p className="text-sm font-semibold text-slate-500">위험등급</p>
                  <p className={`mt-1 text-2xl font-bold ${riskLevelColor(riskResult.level)}`}>{riskResult.level}</p>
                </div>
                <p className="rounded-lg border border-slate-200 px-4 py-3 text-sm font-semibold leading-6 text-slate-700">
                  {riskResult.interpretation}
                </p>
                <p className="text-xs font-semibold text-slate-500">
                  {confirmedRiskResult ? `내부 JSON 확정 저장: ${confirmedRiskResult.score}/100, ${confirmedRiskResult.level}` : "선택 즉시 실시간 반영 중"}
                </p>
              </div>
            </ResultCard>

            <ResultCard icon={<ClipboardList size={18} />} title="변경 이력 카드" accent="blue">
              {changeHistory.length ? (
                <>
                <div className="grid gap-2">
                  {(changeHistoryExpanded ? changeHistory : changeHistory.slice(0, 3)).map((change) => (
                    <div key={`${change.changedAt}-${change.label}`} className="rounded-lg border border-blue-100 bg-blue-50 px-3 py-2">
                      <p className="text-sm font-bold leading-6 text-samsung">
                        <span className="mr-2 text-xs text-slate-500">{formatChangeDate(change.changedAt)}</span>
                        {change.label}: {change.before} → {change.after}
                      </p>
                    </div>
                  ))}
                </div>
                {changeHistory.length > 3 ? (
                  <button
                    type="button"
                    onClick={() => setChangeHistoryExpanded((prev) => !prev)}
                    className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg border border-blue-100 bg-white px-3 py-2 text-sm font-bold text-samsung transition hover:bg-blue-50"
                  >
                    <ChevronDown size={16} className={`transition ${changeHistoryExpanded ? "rotate-180" : ""}`} />
                    {changeHistoryExpanded ? "접기" : "더 보기"}
                  </button>
                ) : null}
                </>
              ) : (
                <p className="rounded-lg bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-600">변경된 정보가 없습니다.</p>
              )}
            </ResultCard>

            <ResultCard icon={<AlertTriangle size={18} />} title="Tax 분석 알림 카드" accent="red">
              <ResultGrid
                rows={[
                  ["이자소득", formData.rrttllu.expectedInterestIncome || "입력 대기"],
                  ["배당소득", formData.rrttllu.expectedDividendIncome || "입력 대기"],
                  ["종합과세 절감", formData.rrttllu.globalTaxImportance || "미선택"],
                  ["해외주식 절감", formData.rrttllu.foreignStockTaxImportance || "미선택"]
                ]}
              />
              <p className="mt-3 rounded-lg bg-red-50 px-4 py-3 text-sm font-semibold leading-6 text-red-800">
                {internalJsonPayload.rrttllu.tax.financial_income_tax_alert}
              </p>
            </ResultCard>

            <ResultCard icon={<AlertTriangle size={18} />} title="누락 정보 경고 카드" accent="orange">
              {warnings.length ? (
                <div className="space-y-3">
                  <p className="rounded-lg bg-orange-50 px-4 py-3 text-sm font-bold leading-6 text-orange-800">
                    누락된 정보가 있어 정확한 분석이 제한될 수 있습니다.
                  </p>
                  <div className="grid gap-2">
                    {warnings.map((warning) => (
                      <p key={warning} className="rounded-lg border border-orange-100 bg-white px-3 py-2 text-sm font-semibold leading-6 text-slate-700">
                        {warning}
                      </p>
                    ))}
                  </div>
                </div>
              ) : (
                <p className="rounded-lg bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800">필수 정보가 충분히 입력되었습니다.</p>
              )}
            </ResultCard>

            <p className="rounded-lg border border-slate-200 bg-white px-5 py-4 text-sm font-semibold leading-6 text-slate-600 shadow-soft">
              민감 정보는 필수 입력이 아니며, 제공이 어려운 경우 대략적인 범위만 입력하셔도 됩니다. 단, 정보가 부족한 항목이 있는 경우 분석 정확도가 낮을 수 있습니다.
            </p>
          </aside>
        </div>
        ) : activeTab === "existing" ? (
          <ExistingPortfolioTab
            formData={formData}
            riskResult={riskResult}
            warnings={warnings}
            setFinancial={setFinancial}
            setRrttllu={setRrttllu}
          />
        ) : activeTab === "create" ? (
          <NewPortfolioTab
            formData={formData}
            riskResult={riskResult}
            setRrttllu={setRrttllu}
          />
        ) : (
          <ComparePortfolioTab
            formData={formData}
            riskResult={riskResult}
            internalJsonPayload={internalJsonPayload}
            setRrttllu={setRrttllu}
          />
        )}
          </div>
      </section>
        </div>
      </div>
      {deleteConfirmOpen ? (
        <DeleteCustomerDialog
          customerLabel={selectedCustomerProfile ? customerTabLabel(selectedCustomerProfile) : "현재 고객"}
          onCancel={() => setDeleteConfirmOpen(false)}
          onDelete={deleteSelectedCustomer}
        />
      ) : null}
    </main>
  );
}

function CustomerSelector({
  customers,
  selectedCustomer,
  showCustomers,
  onToggleSearch,
  onSelectCustomer,
  onAddCustomer,
  onRequestDelete,
  onDragStartCustomer,
  draggedCustomerId,
  dropIndex,
  onSetDropIndex,
  onDropCustomer,
  recentUpdatedAt,
  storageErrorMessage
}: {
  customers: CustomerProfile[];
  selectedCustomer: CustomerId;
  showCustomers: boolean;
  onToggleSearch: () => void;
  onSelectCustomer: (customerId: CustomerId) => void;
  onAddCustomer: () => void;
  onRequestDelete: () => void;
  onDragStartCustomer: (customerId: CustomerId | null) => void;
  draggedCustomerId: CustomerId | null;
  dropIndex: number | null;
  onSetDropIndex: (index: number | null) => void;
  onDropCustomer: (index: number) => void;
  recentUpdatedAt: number;
  storageErrorMessage: string;
}) {
  const currentCustomer = customers.find((customer) => customer.id === selectedCustomer);
  const [isDraggingTab, setIsDraggingTab] = useState(false);

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-3 shadow-soft">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={onToggleSearch}
            className={`min-h-11 rounded-lg px-4 py-2 text-left text-sm font-bold transition ${
              showCustomers ? "bg-[#2f2f9d] text-white" : "bg-slate-50 text-navy hover:bg-slate-100"
            }`}
          >
            고객명 검색
          </button>
          <button
            type="button"
            onClick={onAddCustomer}
            className="min-h-11 rounded-lg bg-samsung px-4 py-2 text-left text-sm font-bold text-white transition hover:bg-[#1b35bd]"
          >
            고객 추가
          </button>
        </div>
        <div className="customer-current-summary grid grid-cols-[minmax(0,auto)_auto] content-center items-center gap-x-2 gap-y-1 self-center md:justify-end">
          <p className="text-sm font-bold text-slate-600">현재 상담 고객: <span className="text-samsung">{currentCustomer ? customerTabLabel(currentCustomer) : "선택 대기"}</span></p>
          <button
            type="button"
            onClick={onRequestDelete}
            aria-label="현재 고객 삭제"
            className="flex h-10 w-10 items-center justify-center rounded-lg border border-red-200 bg-red-50 text-red-700 transition hover:border-red-300 hover:bg-red-100"
          >
            <Trash2 size={17} />
          </button>
          <p className="basis-full text-xs font-bold text-slate-400">{formatUpdatedAt(recentUpdatedAt)}</p>
        </div>
      </div>
      <p className="hidden">
        기본 고객 3명은 항상 초기 로드되며, 고객 정보는 Supabase customers 테이블에 저장되어 여러 기기에서 동일하게 조회됩니다.
      </p>
      {storageErrorMessage ? (
        <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-bold text-red-700">
          {storageErrorMessage}
        </div>
      ) : null}
      {showCustomers ? (
        <div
          className="mt-3 flex items-stretch overflow-x-auto pb-1"
          onDragLeave={(event) => {
            if (event.currentTarget === event.target) onSetDropIndex(null);
          }}
        >
          {customers.map((customer, index) => (
            <CustomerTabDragItem
              key={customer.id}
              customer={customer}
              index={index}
              selected={selectedCustomer === customer.id}
              dragging={draggedCustomerId === customer.id}
              dropBefore={dropIndex === index}
              onSelect={() => {
                if (!isDraggingTab) onSelectCustomer(customer.id);
              }}
              onDragStart={(event) => {
                setIsDraggingTab(true);
                onDragStartCustomer(customer.id);
                onSetDropIndex(index);
                event.dataTransfer.effectAllowed = "move";
                event.dataTransfer.setData("text/plain", customer.id);
              }}
              onDragOverIndex={onSetDropIndex}
              onDropIndex={onDropCustomer}
              onDragEnd={() => {
                onDragStartCustomer(null);
                onSetDropIndex(null);
                window.setTimeout(() => setIsDraggingTab(false), 0);
              }}
            />
          ))}
          <CustomerDropIndicator
            index={customers.length}
            active={dropIndex === customers.length}
            onDragOverIndex={onSetDropIndex}
            onDropIndex={onDropCustomer}
          />
        </div>
      ) : null}
    </section>
  );
}

function CustomerTabDragItem({
  customer,
  index,
  selected,
  dragging,
  dropBefore,
  onSelect,
  onDragStart,
  onDragOverIndex,
  onDropIndex,
  onDragEnd
}: {
  customer: CustomerProfile;
  index: number;
  selected: boolean;
  dragging: boolean;
  dropBefore: boolean;
  onSelect: () => void;
  onDragStart: (event: DragEvent<HTMLButtonElement>) => void;
  onDragOverIndex: (index: number | null) => void;
  onDropIndex: (index: number) => void;
  onDragEnd: () => void;
}) {
  return (
    <div className="flex shrink-0 items-stretch">
      <CustomerDropIndicator index={index} active={dropBefore} onDragOverIndex={onDragOverIndex} onDropIndex={onDropIndex} />
      <button
        type="button"
        draggable
        onClick={onSelect}
        onDragStart={onDragStart}
        onDragOver={(event) => {
          event.preventDefault();
          const rect = event.currentTarget.getBoundingClientRect();
          const nextIndex = event.clientX < rect.left + rect.width / 2 ? index : index + 1;
          onDragOverIndex(nextIndex);
        }}
        onDrop={(event) => {
          event.preventDefault();
          const rect = event.currentTarget.getBoundingClientRect();
          const nextIndex = event.clientX < rect.left + rect.width / 2 ? index : index + 1;
          onDropIndex(nextIndex);
        }}
        onDragEnd={onDragEnd}
        className={`min-h-11 shrink-0 rounded-lg border px-4 py-2 text-sm font-bold transition ${
          selected ? "border-samsung bg-blue-50 text-samsung" : "border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50"
        } ${dragging ? "opacity-45" : "opacity-100"}`}
      >
        {customerTabLabel(customer)}
      </button>
    </div>
  );
}

function CustomerDropIndicator({
  index,
  active,
  onDragOverIndex,
  onDropIndex
}: {
  index: number;
  active: boolean;
  onDragOverIndex: (index: number | null) => void;
  onDropIndex: (index: number) => void;
}) {
  return (
    <div
      className="flex w-3 shrink-0 items-center justify-center"
      onDragOver={(event) => {
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
        onDragOverIndex(index);
      }}
      onDrop={(event) => {
        event.preventDefault();
        onDropIndex(index);
      }}
    >
      <span className={`h-9 w-0.5 rounded-full transition ${active ? "bg-samsung opacity-100" : "bg-transparent opacity-0"}`} />
    </div>
  );
}

function DeleteCustomerDialog({ customerLabel, onCancel, onDelete }: { customerLabel: string; onCancel: () => void; onDelete: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 px-4">
      <section className="w-full max-w-md rounded-lg border border-slate-200 bg-white p-6 shadow-soft">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-red-50 text-red-700">
            <Trash2 size={20} />
          </div>
          <div>
            <h2 className="text-lg font-bold text-navy">고객 정보 삭제</h2>
            <p className="mt-2 text-sm font-semibold leading-6 text-slate-600">
              {customerLabel} 고객 정보가 모두 사라집니다. 정말 삭제하시겠습니까?
            </p>
          </div>
        </div>
        <div className="mt-6 grid gap-2 sm:grid-cols-2">
          <button
            type="button"
            onClick={onCancel}
            className="min-h-11 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-700 transition hover:bg-slate-50"
          >
            취소
          </button>
          <button
            type="button"
            onClick={onDelete}
            className="min-h-11 rounded-lg bg-red-600 px-4 py-2 text-sm font-bold text-white transition hover:bg-red-700"
          >
            삭제
          </button>
        </div>
      </section>
    </div>
  );
}

function TabNavigation({ activeTab, onChange }: { activeTab: WorkspaceTab; onChange: (tab: WorkspaceTab) => void }) {
  return (
    <nav className="hidden w-64 shrink-0 rounded-lg border border-slate-800 bg-[#08111f] p-3 shadow-soft xl:block xl:sticky xl:top-6 xl:h-[calc(100vh-48px)]">
      <div className="border-b border-white/10 px-3 py-4">
        <p className="text-lg font-bold text-gold">Samsung Securities</p>
        <p className="mt-1 text-xs font-semibold text-slate-400">VVIP Asset Advisor Hub</p>
      </div>
      <div className="mt-4 grid gap-2">
        {workspaceTabs.map((tab, index) => {
          const selected = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => onChange(tab.id)}
              className={`rounded-lg px-4 py-4 text-left transition ${
                selected ? "bg-samsung text-white shadow-soft" : "text-slate-400 hover:bg-white/5 hover:text-white"
              }`}
            >
              <span className="block text-sm font-bold">{index + 1}. {tab.label}</span>
              <span className={`mt-1 block text-xs font-semibold ${selected ? "text-blue-100" : "text-slate-500"}`}>
                {tab.description}
              </span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}

function TabStrip({ activeTab, onChange }: { activeTab: WorkspaceTab; onChange: (tab: WorkspaceTab) => void }) {
  return (
    <nav className="grid shrink-0 gap-2 rounded-lg border border-slate-200 bg-white p-2 shadow-soft sm:grid-cols-2 xl:w-44 xl:grid-cols-1 xl:self-start xl:sticky xl:top-6">
      {workspaceTabs.map((tab, index) => (
        <button
          key={tab.id}
          type="button"
          onClick={() => onChange(tab.id)}
          className={`min-h-11 rounded-lg px-3 py-2 text-left transition ${
            activeTab === tab.id ? "bg-[#2f2f9d] text-white shadow-soft" : "bg-slate-50 text-slate-600 hover:bg-slate-100 hover:text-navy"
          }`}
        >
          <span className="block text-sm font-bold tracking-normal">{index + 1}. {tab.label}</span>
        </button>
      ))}
    </nav>
  );
}

function CustomerInfoCard({ profile, onChange }: { profile: CustomerProfile; onChange: (key: keyof Omit<CustomerProfile, "id">, value: string) => void }) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white px-5 py-4 shadow-soft">
      <div className="flex flex-wrap items-end gap-3">
        <EditableProfileField label="성명" value={profile.name} onChange={(value) => onChange("name", value)} />
        <EditableProfileField label="성별" value={profile.gender} onChange={(value) => onChange("gender", value)} />
        <div className="flex flex-wrap gap-2">
          <EditableProfileField label="출생연도" value={profile.birth_year ?? profile.birthYear} placeholder="입력 대기" onChange={(value) => onChange("birthYear", value)} />
          <EditableProfileField label="만 나이" value={profile.age} placeholder="입력 대기" onChange={(value) => onChange("age", value)} />
        </div>
        <EditableProfileField label="직업" value={profile.job} widthClassName="w-80 max-w-full" onChange={(value) => onChange("job", value)} />
      </div>
    </section>
  );
}

function EditableProfileField({ label, value, placeholder, widthClassName = "w-32", onChange }: { label: string; value: string; placeholder?: string; widthClassName?: string; onChange: (value: string) => void }) {
  return (
    <label className={`block ${widthClassName}`}>
      <span className="mb-1 block text-xs font-bold text-samsung">[{label}]</span>
      <input
        className="h-11 min-w-0 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 text-sm font-bold text-navy transition placeholder:text-slate-400 hover:border-slate-300 focus:border-samsung"
        value={value}
        placeholder={placeholder ?? "입력 대기"}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}

function ExistingPortfolioTab({
  formData,
  riskResult,
  warnings,
  setFinancial,
  setRrttllu
}: {
  formData: AppState;
  riskResult: RiskResult;
  warnings: string[];
  setFinancial: (key: keyof FinancialInfo, value: string) => void;
  setRrttllu: (key: keyof RrttlluInfo, value: string) => void;
}) {
  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1.1fr)_minmax(380px,0.9fr)]">
      <section className="space-y-5">
        <Panel icon={<WalletCards size={18} />} eyebrow="기존 포트폴리오 분석" title="보유 자산 정보">
          <TextAreaField
            label="현재 보유하거나 처분을 검토 중인 자산"
            value={formData.rrttllu.holdingOrDisposalPlan}
            placeholder="예. 삼성전자 10억 원 계속 보유, 임대용 부동산 1년 내 매각 검토"
            onChange={(value) => setRrttllu("holdingOrDisposalPlan", value)}
          />
          <div className="grid gap-3 md:grid-cols-2">
            <TextField label="총 자산" value={formData.financial.totalAssets} placeholder="예. 20억 원" onChange={(value) => setFinancial("totalAssets", value)} />
            <TextField label="금융자산" value={formData.financial.financialAssets} placeholder="예. 8억 원" onChange={(value) => setFinancial("financialAssets", value)} />
          </div>
          <TextAreaField
            label="피하고 싶은 자산"
            value={formData.rrttllu.avoidedAssets}
            placeholder="예. 가상자산, 변동성이 큰 테마형 상품"
            onChange={(value) => setRrttllu("avoidedAssets", value)}
          />
        </Panel>

        <Panel icon={<ClipboardList size={18} />} eyebrow="공유 입력" title="포트폴리오 분석에 반영되는 조건">
          <div className="grid gap-3 md:grid-cols-2">
            <TextField label="향후 목돈 사용 계획" value={formData.rrttllu.lumpSumPlan} placeholder="예. 5년 후 자녀 유학비 1억원" onChange={(value) => setRrttllu("lumpSumPlan", value)} />
            <TextField label="정기 현금흐름 필요" value={formData.rrttllu.regularCashflowNeed} placeholder="예. 20년간 월 생활비 500만 원" onChange={(value) => setRrttllu("regularCashflowNeed", value)} />
            <TextField label="비상예비자금 확보 계획" value={formData.rrttllu.emergencyReservePlan} placeholder="예. 의료비 등 비상 상황 대비 1억 원" onChange={(value) => setRrttllu("emergencyReservePlan", value)} />
          </div>
        </Panel>
      </section>

      <aside className="space-y-5">
        <ResultCard icon={<ShieldCheck size={18} />} title="고객 성향 연동 요약" accent="gold">
          <ResultGrid
            rows={[
              ["위험점수", `${riskResult.score}/100`],
              ["위험등급", riskResult.level],
              ["투자 기간", formData.rrttllu.timeHorizon || "미선택"],
              ["투자 목적", formData.rrttllu.returnObjective || "미선택"]
            ]}
          />
        </ResultCard>
        <ResultCard icon={<AlertTriangle size={18} />} title="분석 전 확인 사항" accent={warnings.length ? "orange" : "green"}>
          <p className="text-sm font-semibold leading-6 text-slate-700">
            {warnings.length ? "고객 성향 분석 탭의 누락 정보가 기존 포트폴리오 진단에도 반영됩니다." : "현재 입력된 고객 정보가 기존 포트폴리오 분석에 충분히 반영되어 있습니다."}
          </p>
        </ResultCard>
      </aside>
    </div>
  );
}

function NewPortfolioTab({
  formData,
  riskResult,
  setRrttllu
}: {
  formData: AppState;
  riskResult: RiskResult;
  setRrttllu: (key: keyof RrttlluInfo, value: string) => void;
}) {
  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1.1fr)_minmax(380px,0.9fr)]">
      <section className="space-y-5">
        <Panel icon={<Sparkles size={18} />} eyebrow="신규 포트폴리오 생성" title="추천 조건 입력">
          <TextAreaField
            label="우선 고려할 자산"
            value={formData.rrttllu.preferredAssets}
            placeholder="예. 미국 배당주 ETF, 월지급식 채권형 상품"
            onChange={(value) => setRrttllu("preferredAssets", value)}
          />
          <TextAreaField
            label="추천 후보에서 제외할 자산"
            value={formData.rrttllu.avoidedAssets}
            placeholder="예. 가상자산, 가치 평가가 어려운 비상장 자산"
            onChange={(value) => setRrttllu("avoidedAssets", value)}
          />
          <div className="grid gap-3 md:grid-cols-2">
            <TextField label="정기 현금흐름 필요" value={formData.rrttllu.regularCashflowNeed} placeholder="예. 월 500만 원" onChange={(value) => setRrttllu("regularCashflowNeed", value)} />
            <TextField label="목돈 사용 계획" value={formData.rrttllu.lumpSumPlan} placeholder="예. 5년 후 1억 원" onChange={(value) => setRrttllu("lumpSumPlan", value)} />
            <TextField label="비상예비자금 확보 계획" value={formData.rrttllu.emergencyReservePlan} placeholder="예. 의료비 등 비상 상황 대비 1억 원" onChange={(value) => setRrttllu("emergencyReservePlan", value)} />
          </div>
        </Panel>
      </section>

      <aside className="space-y-5">
        <ResultCard icon={<BarChart3 size={18} />} title="신규 포트폴리오 생성 기준" accent="blue">
          <ResultGrid
            rows={[
              ["목표 수익률", formData.rrttllu.returnObjective || "미선택"],
              ["위험등급", riskResult.level],
              ["투자 기간", formData.rrttllu.timeHorizon || "미선택"],
              ["금융자산", formData.financial.financialAssets || "입력 대기"]
            ]}
          />
          <p className="mt-3 rounded-lg bg-blue-50 px-4 py-3 text-sm font-semibold leading-6 text-blue-900">
            선호 자산은 우선 고려 조건으로, 비선호 자산은 제외 조건으로 고객 성향 분석 JSON에 함께 저장됩니다.
          </p>
        </ResultCard>
      </aside>
    </div>
  );
}

function ComparePortfolioTab({
  formData,
  riskResult,
  internalJsonPayload,
  setRrttllu
}: {
  formData: AppState;
  riskResult: RiskResult;
  internalJsonPayload: StructuredJsonPayload;
  setRrttllu: (key: keyof RrttlluInfo, value: string) => void;
}) {
  return (
    <div className="space-y-5">
      <div className="grid gap-5 xl:grid-cols-2">
        <ResultCard icon={<WalletCards size={18} />} title="기존 포트폴리오" accent="slate">
          <ResultGrid
            rows={[
              ["보유/처분 계획", formData.rrttllu.holdingOrDisposalPlan || "입력 대기"],
              ["비선호 자산", formData.rrttllu.avoidedAssets || "입력 대기"],
              ["유동성 필요", formData.rrttllu.lumpSumPlan || "입력 대기"],
              ["비상예비자금", formData.rrttllu.emergencyReservePlan || "입력 대기"],
              ["Tax 알림", internalJsonPayload.rrttllu.tax.financial_income_tax_alert]
            ]}
          />
        </ResultCard>

        <ResultCard icon={<Sparkles size={18} />} title="신규 포트폴리오 생성 기준" accent="blue">
          <ResultGrid
            rows={[
              ["선호 자산", formData.rrttllu.preferredAssets || "입력 대기"],
              ["위험점수", `${riskResult.score}/100`],
              ["위험등급", riskResult.level],
              ["투자 기간", formData.rrttllu.timeHorizon || "미선택"]
            ]}
          />
        </ResultCard>
      </div>

      <Panel icon={<ClipboardList size={18} />} eyebrow="포트폴리오 비교" title="비교 기준 보완">
        <div className="grid gap-3 md:grid-cols-2">
          <TextAreaField
            label="기존 자산 운용 계획"
            value={formData.rrttllu.holdingOrDisposalPlan}
            placeholder="예. 기존 주식은 유지, 임대 부동산은 매각 검토"
            onChange={(value) => setRrttllu("holdingOrDisposalPlan", value)}
          />
          <TextAreaField
            label="신규안에서 우선 반영할 자산"
            value={formData.rrttllu.preferredAssets}
            placeholder="예. 미국 배당 ETF, 월지급식 상품"
            onChange={(value) => setRrttllu("preferredAssets", value)}
          />
        </div>
      </Panel>
    </div>
  );
}

function diffAnalysisPayload(previous: StructuredJsonPayload, latest: StructuredJsonPayload): ChangeEntry[] {
  const now = Date.now();
  const previousFields = Object.fromEntries(
    flattenComparablePayload(previous).map((field) => [field.key, field.value])
  ) as Record<string, string>;
  const latestFields = flattenComparablePayload(latest);

  return latestFields
    .filter((field) => previousFields[field.key] !== field.value)
    .map((field, index) => ({
      label: field.label,
      before: previousFields[field.key] ?? "미입력",
      after: field.value,
      changedAt: now - index
    }))
    .sort((a, b) => b.changedAt - a.changedAt);
}

function flattenComparablePayload(payload: StructuredJsonPayload) {
  const comparableFields = [
    ["asset_summary", "자산 요약", payload.basic_financial_info.asset_summary],
    ["annual_fixed_income", "연 고정소득", payload.basic_financial_info.annual_fixed_income],
    ["irregular_income", "향후 주요 자금 유입", payload.basic_financial_info.irregular_income],
    ["monthly_fixed_expense", "월 고정지출", payload.basic_financial_info.monthly_fixed_expense],
    ["return_objective", "투자 목적", payload.rrttllu.return.objective],
    ["expected_return", "기대수익률", payload.rrttllu.return.expected_return],
    ["risk_score", "Risk 점수", `${payload.rrttllu.risk.score}점`],
    ["risk_level", "위험등급", payload.rrttllu.risk.level],
    ["investment_experience", "투자 경험", payload.rrttllu.risk.answers.investment_experience],
    ["investment_knowledge", "투자 지식", payload.rrttllu.risk.answers.investment_knowledge],
    ["derivatives_experience", "파생상품 투자 경험", payload.rrttllu.risk.answers.derivatives_experience],
    ["financial_assets_ratio", "금융자산 비중", payload.rrttllu.risk.answers.financial_assets_ratio],
    ["investment_assets_ratio", "투자자산 비중", payload.rrttllu.risk.answers.investment_assets_ratio],
    ["risk_attitude", "위험에 대한 태도", payload.rrttllu.risk.answers.risk_attitude],
    ["loss_response", "단기 손실 대응", payload.rrttllu.risk.answers.loss_response],
    ["investment_period", "투자 기간", payload.rrttllu.time_horizon.investment_period],
    ["expected_interest_income", "예상 이자소득", payload.rrttllu.tax.expected_interest_income],
    ["expected_dividend_income", "예상 배당소득", payload.rrttllu.tax.expected_dividend_income],
    ["gift_plan", "사전증여 계획", payload.rrttllu.tax.gift_plan],
    ["financial_income_tax_importance", "금융소득종합과세 절감 중요도", payload.rrttllu.tax.financial_income_tax_importance],
    ["financial_income_tax_history", "금융소득종합과세 이력", payload.rrttllu.tax.financial_income_tax_history],
    ["foreign_stock_tax_importance", "해외주식 양도소득세 절감 중요도", payload.rrttllu.tax.foreign_stock_capital_gains_tax_importance],
    ["financial_income_tax_alert", "Tax 분석 알림", payload.rrttllu.tax.financial_income_tax_alert],
    ["cashflow_need", "정기 현금흐름 필요", payload.rrttllu.liquidity.cashflow_need],
    ["large_cash_need", "목돈 사용 계획", payload.rrttllu.liquidity.large_cash_need],
    ["emergency_reserve_need", "비상예비자금 확보 계획", payload.rrttllu.liquidity.emergency_reserve_need],
    ["legal_constraints", "법적/제도적 제약", payload.rrttllu.legal.constraints],
    ["legal_other_detail", "기타 법적 제약 상세", payload.rrttllu.legal.other_detail],
    ["preferred_assets", "선호 자산", payload.rrttllu.unique_circumstances.preferred_assets.raw_input],
    ["avoided_assets", "비선호 자산", payload.rrttllu.unique_circumstances.avoided_assets.raw_input],
    ["existing_asset_plan", "기존 자산 보유/처분 계획", payload.rrttllu.unique_circumstances.existing_asset_plan],
    ["unique_other", "고객 고유 상황 기타", payload.rrttllu.unique_circumstances.other]
  ] as const;

  return comparableFields.map(([key, label, value]) => ({
    key,
    label,
    value: comparableValue(value)
  }));
}

function comparableValue(value: string | string[] | null) {
  if (Array.isArray(value)) return value.length ? value.join(", ") : "미입력";
  return value ?? "미입력";
}

function calculateLiquiditySummary(formData: AppState): LiquiditySummaryInfo {
  const liquidityAmounts = [
    parseKrwAmount(nullableText(formData.rrttllu.regularCashflowNeed)),
    parseKrwAmount(nullableText(formData.rrttllu.lumpSumPlan)),
    parseKrwAmount(nullableText(formData.rrttllu.emergencyReservePlan))
  ].filter((amount): amount is number => amount !== null);
  const requiredAmount = liquidityAmounts.length ? liquidityAmounts.reduce((sum, amount) => sum + amount, 0) : null;
  const totalAssets = parseKrwAmount(nullableText(formData.financial.totalAssets));
  const investableAmount = requiredAmount !== null && totalAssets !== null ? Math.max(totalAssets - requiredAmount, 0) : null;

  return {
    requiredAmount,
    investableAmount,
    requiredDisplay: formatKrwDisplay(requiredAmount),
    investableDisplay: formatKrwDisplay(investableAmount)
  };
}

function formatKrwDisplay(amount: number | null) {
  if (amount === null) return "계산 대기";
  return `${amount.toLocaleString("ko-KR")}원`;
}

function buildStructuredJsonPayload(formData: AppState, riskResult: RiskResult, customerProfile?: CustomerProfile): StructuredJsonPayload {
  const financial = formData.financial;
  const rrttllu = formData.rrttllu;
  const warnings: string[] = [];

  const totalAssets = nullableText(financial.totalAssets);
  const financialAssets = nullableText(financial.financialAssets);
  const realEstate = nullableText(financial.realEstate);
  const debt = nullableText(financial.debt);
  const assetSummaryParts = [
    totalAssets ? `총 자산 ${totalAssets}` : null,
    financialAssets ? `금융자산 ${financialAssets}` : null,
    realEstate ? `부동산 ${realEstate}` : null,
    debt ? `부채 ${debt}` : null
  ].filter(Boolean);
  const assetSummary = assetSummaryParts.length ? assetSummaryParts.join(", ") : null;

  const annualFixedIncome = nullableText(financial.annualFixedIncome);
  const irregularIncome = financial.irregularIncomeNone ? "없음" : nullableText(financial.irregularIncome);
  const monthlyFixedExpense = nullableText(financial.monthlyFixedExpense);
  const expectedInterestIncome = nullableText(rrttllu.expectedInterestIncome);
  const expectedDividendIncome = nullableText(rrttllu.expectedDividendIncome);
  const interestAmount = parseKrwAmount(expectedInterestIncome);
  const dividendAmount = parseKrwAmount(expectedDividendIncome);
  const taxAlert = financialIncomeTaxAlert(interestAmount, dividendAmount);
  const hasMissingProfileInfo =
    !customerProfile ||
    !nullableText(customerProfile.name) ||
    !nullableText(customerProfile.gender) ||
    !nullableText(customerProfile.birthYear) ||
    !nullableText(customerProfile.age) ||
    !nullableText(customerProfile.job);

  const riskAnswers = {
    investment_experience: nullableArray(rrttllu.investmentExperience),
    investment_knowledge: nullableText(rrttllu.knowledgeLevel),
    derivatives_experience: nullableText(rrttllu.derivativesExperience),
    financial_assets_ratio: nullableText(rrttllu.financialAssetRatio),
    investment_assets_ratio: nullableText(rrttllu.investmentAssetRatio),
    risk_attitude: nullableText(rrttllu.riskAttitude),
    loss_response: nullableText(rrttllu.lossResponse)
  };

  if (hasMissingProfileInfo) {
    warnings.push("기본 신상 정보가 부족합니다.");
  }
  if (!assetSummary || !annualFixedIncome || !monthlyFixedExpense || !irregularIncome) {
    warnings.push("기본 재무 정보가 부족합니다.");
  }
  if (!nullableText(rrttllu.returnObjective) || (!nullableText(rrttllu.expectedReturn) && !rrttllu.expectedReturnUnknown)) {
    warnings.push("목표 수익률 (Return) 정보가 부족합니다.");
  }
  if (Object.values(riskAnswers).some((value) => value === null)) {
    warnings.push("위험 허용도 (Risk) 정보가 부족합니다.");
  }
  if (!nullableText(rrttllu.timeHorizon)) {
    warnings.push("투자 기간 (Time Horizon) 정보가 부족합니다.");
  }
  if (
    !expectedInterestIncome ||
    !expectedDividendIncome ||
    interestAmount === null ||
    dividendAmount === null ||
    !nullableText(rrttllu.giftingPlan) ||
    !nullableText(rrttllu.globalTaxImportance) ||
    !nullableText(rrttllu.recentGlobalTaxSubject) ||
    !nullableText(rrttllu.foreignStockTaxImportance)
  ) {
    warnings.push("세금 요인 (Tax) 정보가 부족합니다.");
  }
  if (!nullableText(rrttllu.regularCashflowNeed) || !nullableText(rrttllu.lumpSumPlan) || !nullableText(rrttllu.emergencyReservePlan)) {
    warnings.push("유동성 필요 시기 (Liquidity) 정보가 부족합니다.");
  }
  if (!rrttllu.legalConstraints.length) {
    warnings.push("법적/규제 제약 (Legal) 정보가 부족합니다.");
  }
  if (rrttllu.legalConstraints.includes("기타") && !nullableText(rrttllu.legalConstraintOther)) {
    warnings.push("법적/규제 제약 (Legal) 정보가 부족합니다.");
  }
  if (!nullableText(rrttllu.preferredAssets) || !nullableText(rrttllu.avoidedAssets) || !nullableText(rrttllu.holdingOrDisposalPlan)) {
    warnings.push("고객 고유 상황 (Unique Circumstances) 정보가 부족합니다.");
  }

  return {
    basic_financial_info: {
      asset_summary: assetSummary,
      annual_fixed_income: annualFixedIncome,
      irregular_income: irregularIncome,
      monthly_fixed_expense: monthlyFixedExpense
    },
    rrttllu: {
      return: {
        objective: nullableText(rrttllu.returnObjective),
        expected_return: rrttllu.expectedReturnUnknown ? "구체적인 수치는 모름" : nullableText(rrttllu.expectedReturn)
      },
      risk: {
        score: riskResult.score,
        level: riskResult.level,
        answers: riskAnswers,
        interpretation: riskResult.interpretation
      },
      time_horizon: {
        investment_period: nullableText(rrttllu.timeHorizon)
      },
      tax: {
        expected_interest_income: expectedInterestIncome,
        expected_dividend_income: expectedDividendIncome,
        gift_plan: nullableText(rrttllu.giftingPlan),
        financial_income_tax_importance: nullableText(rrttllu.globalTaxImportance),
        financial_income_tax_history: nullableText(rrttllu.recentGlobalTaxSubject),
        foreign_stock_capital_gains_tax_importance: nullableText(rrttllu.foreignStockTaxImportance),
        financial_income_tax_alert: taxAlert
      },
      liquidity: {
        cashflow_need: nullableText(rrttllu.regularCashflowNeed),
        large_cash_need: nullableText(rrttllu.lumpSumPlan),
        emergency_reserve_need: nullableText(rrttllu.emergencyReservePlan)
      },
      legal: {
        constraints: nullableArray(rrttllu.legalConstraints),
        other_detail: nullableText(rrttllu.legalConstraintOther)
      },
      unique_circumstances: {
        preferred_assets: {
          raw_input: nullableText(rrttllu.preferredAssets),
          portfolio_rule: {
            type: "soft_constraint",
            description: "고객이 선호하는 자산군은 포트폴리오 추천 시 우선 고려한다.",
            min_weight_hint: "10%"
          }
        },
        avoided_assets: {
          raw_input: nullableText(rrttllu.avoidedAssets),
          portfolio_rule: {
            type: "hard_constraint",
            description: "고객이 피하고 싶은 자산군은 포트폴리오 추천 후보에서 제외한다.",
            max_weight: "0%"
          }
        },
        existing_asset_plan: nullableText(rrttllu.holdingOrDisposalPlan),
        other: nullableText(rrttllu.uniqueOther)
      },
      warnings: uniqueWarnings(warnings)
    }
  };
}

function calculateRiskResult(rrttllu: RrttlluInfo): RiskResult {
  const score =
    maxSelectedScore(rrttllu.investmentExperience, riskExperienceOptions, tenPointScale) +
    selectedScore(rrttllu.knowledgeLevel, fieldGroups.knowledge, knowledgeScale) +
    selectedScore(rrttllu.derivativesExperience, fieldGroups.derivatives, tenPointScale) +
    selectedScore(rrttllu.financialAssetRatio, fieldGroups.financialAssetRatio, tenPointScale) +
    selectedScore(rrttllu.investmentAssetRatio, fieldGroups.investmentAssetRatio, tenPointScale) +
    selectedScore(rrttllu.riskAttitude, fieldGroups.riskAttitude, riskAttitudeScale) +
    selectedScore(rrttllu.lossResponse, fieldGroups.lossResponse, riskAttitudeScale);

  const level = riskLevel(score);

  return {
    score,
    level,
    answers: {
      investment_experience: rrttllu.investmentExperience,
      investment_knowledge: rrttllu.knowledgeLevel,
      derivatives_experience: rrttllu.derivativesExperience,
      financial_assets_ratio: rrttllu.financialAssetRatio,
      investment_assets_ratio: rrttllu.investmentAssetRatio,
      risk_attitude: rrttllu.riskAttitude,
      loss_response: rrttllu.lossResponse
    },
    interpretation: riskInterpretations[level]
  };
}

function selectedScore(value: string, options: string[], scores: number[]) {
  const index = options.indexOf(value);
  return index >= 0 ? scores[index] : 0;
}

function maxSelectedScore(values: string[], options: string[], scores: number[]) {
  if (!values.length) return 0;
  return Math.max(...values.map((value) => selectedScore(value, options, scores)));
}

function riskLevel(score: number): RiskLevel {
  if (score <= 20) return "초저위험";
  if (score <= 40) return "저위험";
  if (score <= 60) return "중위험";
  if (score <= 80) return "고위험";
  return "초고위험";
}

function riskLevelColor(level: RiskLevel) {
  const colors: Record<RiskLevel, string> = {
    초저위험: "text-emerald-700",
    저위험: "text-teal-700",
    중위험: "text-gold",
    고위험: "text-orange-700",
    초고위험: "text-red-700"
  };
  return colors[level];
}

function nullableText(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const normalized = trimmed.replace(/\s+/g, "");
  const nullExpressions = [
    "모름",
    "잘모르겠음",
    "말하기어려움",
    "비공개",
    "정확히모름",
    "정확한금액은말하기어렵습니다",
    "답변하고싶지않음"
  ];
  return nullExpressions.includes(normalized) ? null : trimmed;
}

function nullableArray(values: string[]) {
  return values.length ? values : null;
}

function uniqueWarnings(warnings: string[]) {
  return Array.from(new Set(warnings));
}

function financialIncomeTaxAlert(interestAmount: number | null, dividendAmount: number | null) {
  if (interestAmount === null || dividendAmount === null) {
    return "이자소득 또는 배당소득 정보가 부족하여 금융소득종합과세 여부를 판단하기 어렵습니다.";
  }

  const total = interestAmount + dividendAmount;
  if (total > 20_000_000) {
    return "올해 예상 이자소득과 배당소득 합계가 2,000만 원을 초과하여 금융소득종합과세 대상이 될 가능성이 높습니다.";
  }

  return "올해 예상 이자소득과 배당소득 합계가 2,000만 원 이하로, 금융소득종합과세 가능성은 상대적으로 낮습니다.";
}

function parseKrwAmount(value: string | null): number | null {
  if (!value) return null;
  const normalized = value.replace(/,/g, "").replace(/\s+/g, "");
  const rangeParts = normalized
    .split(/~|∼|〜|-/)
    .map((part) => part.trim())
    .filter(Boolean);

  if (rangeParts.length > 1) {
    const parsed = rangeParts.map(parseSingleKrwAmount);
    if (parsed.some((amount) => amount === null)) return null;
    const amounts = parsed as number[];
    return Math.round(amounts.reduce((sum, amount) => sum + amount, 0) / amounts.length);
  }

  return parseSingleKrwAmount(normalized);
}

function parseSingleKrwAmount(value: string): number | null {
  const cleaned = value.replace(/원|이하|미만|이상|초과|약|대략|정도/g, "");
  if (!cleaned) return null;

  let total = 0;
  let consumed = cleaned;
  const eokMatch = cleaned.match(/(\d+(?:\.\d+)?)억/);
  const cheonMatch = cleaned.match(/(\d+(?:\.\d+)?)천(?:만)?/);
  const manMatch = cleaned.match(/(\d+(?:\.\d+)?)만/);

  if (eokMatch) {
    total += Number(eokMatch[1]) * 100_000_000;
    consumed = consumed.replace(eokMatch[0], "");
  }
  if (cheonMatch) {
    total += Number(cheonMatch[1]) * 10_000_000;
    consumed = consumed.replace(cheonMatch[0], "");
  }
  if (manMatch) {
    total += Number(manMatch[1]) * 10_000;
    consumed = consumed.replace(manMatch[0], "");
  }
  if (total > 0) return Math.round(total);

  const numericOnly = consumed.match(/^\d+(?:\.\d+)?$/);
  if (numericOnly) return Math.round(Number(numericOnly[0]));

  return null;
}

function completion(values: string[]) {
  const completed = values.filter((value) => value.trim().length > 0).length;
  return Math.round((completed / values.length) * 100);
}

function Panel({ icon, eyebrow, title, note, children }: { icon: React.ReactNode; eyebrow: string; title: string; note?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-soft">
      <div className="mb-4 flex items-start gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-samsung">{icon}</div>
        <div>
          <p className="text-xs font-bold uppercase tracking-normal text-slate-500">{eyebrow}</p>
          <h2 className="mt-1 text-lg font-bold text-navy">{title}</h2>
          {note ? <p className="mt-2 rounded-lg bg-blue-50 px-3 py-2 text-sm leading-6 text-blue-900">{note}</p> : null}
        </div>
      </div>
      <div className="question-stack space-y-4">{children}</div>
    </section>
  );
}

function TextField({ label, value, placeholder, onChange, compact = false, tone }: { label: string; value: string; placeholder: string; onChange: (value: string) => void; compact?: boolean; tone?: "blue" | "gray" }) {
  return (
    <label className={`question-card ${tone ? `question-card-${tone}` : ""} block rounded-lg border border-slate-200 p-4 ${compact ? "" : ""}`}>
      <span className="mb-2 block text-sm font-bold text-slate-700">{questionLabel(label)}</span>
      <input className="h-12 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-ink shadow-sm transition placeholder:text-slate-400 hover:border-slate-300 focus:border-samsung" value={value} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

function TextAreaField({ label, value, placeholder, onChange }: { label: string; value: string; placeholder: string; onChange: (value: string) => void }) {
  return (
    <label className="question-card block rounded-lg border border-slate-200 p-4">
      <span className="mb-2 block text-sm font-bold text-slate-700">{questionLabel(label)}</span>
      <textarea className="min-h-28 w-full resize-y rounded-lg border border-slate-200 bg-white px-3 py-3 text-sm leading-6 text-ink shadow-sm transition placeholder:text-slate-400 hover:border-slate-300 focus:border-samsung" value={value} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

function IncomeWithNoneField({
  label,
  value,
  placeholder,
  noneSelected,
  onChange,
  onToggleNone
}: {
  label: string;
  value: string;
  placeholder: string;
  noneSelected: boolean;
  onChange: (value: string) => void;
  onToggleNone: () => void;
}) {
  return (
    <div className="question-card rounded-lg border border-slate-200 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-bold text-slate-700">{questionLabel(label)}</p>
        <button
          type="button"
          onClick={onToggleNone}
          className={`min-h-10 rounded-lg border px-4 py-2 text-sm font-bold transition ${
            noneSelected ? "border-samsung bg-blue-50 text-samsung" : "border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50"
          }`}
        >
          없음
        </button>
      </div>
      <div className="mt-3">
        <textarea
          className="min-h-24 w-full resize-y rounded-lg border border-slate-200 bg-white px-3 py-3 text-sm leading-6 text-ink shadow-sm transition placeholder:text-slate-400 hover:border-slate-300 focus:border-samsung disabled:bg-slate-100 disabled:text-slate-400 sm:min-h-12"
          value={value}
          placeholder={placeholder}
          disabled={noneSelected}
          onChange={(event) => onChange(event.target.value)}
        />
      </div>
    </div>
  );
}

function ExpectedReturnField({
  value,
  unknownSelected,
  onChange,
  onToggleUnknown
}: {
  value: string;
  unknownSelected: boolean;
  onChange: (value: string) => void;
  onToggleUnknown: () => void;
}) {
  return (
    <div className="question-card rounded-lg border border-slate-200 p-4">
      <p className="text-sm font-bold text-slate-700">{questionLabel("기대수익률")}</p>
      <div className="mt-3 grid gap-2 lg:grid-cols-[minmax(0,1fr)_190px]">
        <input
          className="h-12 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-ink shadow-sm transition placeholder:text-slate-400 hover:border-slate-300 focus:border-samsung disabled:bg-slate-100 disabled:text-slate-400"
          value={value}
          placeholder="예. 15%"
          disabled={unknownSelected}
          onChange={(event) => onChange(event.target.value)}
        />
        <button
          type="button"
          onClick={onToggleUnknown}
          className={`min-h-12 rounded-lg border px-3 py-2 text-sm font-bold transition ${
            unknownSelected ? "border-samsung bg-blue-50 text-samsung" : "border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50"
          }`}
        >
          구체적인 수치는 모름
        </button>
      </div>
    </div>
  );
}

function ChoiceGroup({ label, description, options, value, onChange, tone, cardClassName }: { label: string; description?: string; options: string[]; value: string; onChange: (value: string) => void; tone?: "blue" | "gray"; cardClassName?: string }) {
  return (
    <div className={`question-card ${tone ? `question-card-${tone}` : ""} ${cardClassName ?? ""} rounded-lg border border-slate-200 p-4`}>
      <p className="text-sm font-bold text-slate-700">{questionLabel(label)}</p>
      {description ? <p className="mt-1 text-sm leading-6 text-slate-500">{description}</p> : null}
      <div className="mt-3 grid gap-2 md:grid-cols-2">
        {options.map((option) => (
          <button key={option} type="button" onClick={() => onChange(option)} className={`min-h-11 rounded-lg border px-3 py-2 text-left text-sm font-semibold leading-5 transition ${value === option ? "border-samsung bg-blue-50 text-samsung shadow-sm" : "border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50"}`}>
            {option}
          </button>
        ))}
      </div>
    </div>
  );
}

function MultiChoiceGroup({ label, options, values, onToggle }: { label: string; options: string[]; values: string[]; onToggle: (value: string) => void }) {
  return (
    <div className="question-card rounded-lg border border-slate-200 p-4">
      <p className="text-sm font-bold text-slate-700">{questionLabel(label)}</p>
      <div className="mt-3 grid gap-2 md:grid-cols-2">
        {options.map((option) => {
          const selected = values.includes(option);
          return (
            <button key={option} type="button" onClick={() => onToggle(option)} className={`flex min-h-12 items-center gap-3 rounded-lg border px-3 py-2 text-left text-sm font-semibold leading-5 transition ${selected ? "border-mint bg-emerald-50 text-mint shadow-sm" : "border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50"}`}>
              <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded border ${selected ? "border-mint bg-mint text-white" : "border-slate-300 bg-white"}`}>
                {selected ? <BadgeCheck size={14} /> : null}
              </span>
              {option}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function ResultCard({ icon, title, accent, children }: { icon: React.ReactNode; title: string; accent: "blue" | "green" | "gold" | "red" | "orange" | "slate"; children: React.ReactNode }) {
  const accentMap = {
    blue: "text-samsung bg-blue-50",
    green: "text-mint bg-emerald-50",
    gold: "text-gold bg-amber-50",
    red: "text-red-700 bg-red-50",
    orange: "text-orange-700 bg-orange-50",
    slate: "text-slate-700 bg-slate-100"
  };

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-soft">
      <div className="mb-4 flex items-center gap-3">
        <div className={`flex h-9 w-9 items-center justify-center rounded-lg ${accentMap[accent]}`}>{icon}</div>
        <h3 className="text-base font-bold text-navy">{title}</h3>
      </div>
      {children}
    </section>
  );
}

function ResultGrid({ rows }: { rows: [string, string][] }) {
  return (
    <div className="grid gap-2">
      {rows.map(([label, value]) => (
        <div key={label} className="flex min-h-10 items-center justify-between gap-3 rounded-lg bg-slate-50 px-3 py-2">
          <span className="text-sm font-semibold text-slate-500">{label}</span>
          <span className="text-right text-sm font-bold text-navy">{value}</span>
        </div>
      ))}
    </div>
  );
}

function irregularIncomeDisplay(financial: FinancialInfo) {
  if (financial.irregularIncomeNone) return "없음";
  return financial.irregularIncome || "입력 대기";
}

function expectedReturnDisplay(rrttllu: RrttlluInfo) {
  if (rrttllu.expectedReturnUnknown) return "구체적인 수치는 모름";
  return rrttllu.expectedReturn || "입력 대기";
}

function LiquiditySummary({ summary }: { summary: LiquiditySummaryInfo }) {
  return (
    <div className="grid gap-2 rounded-lg border border-blue-100 bg-blue-50 px-4 py-3">
      <p className="text-sm font-bold leading-6 text-blue-900">
        필요 자금(정기적 현금흐름, 목돈 사용 자금, 비상예비자금): {summary.requiredDisplay}
      </p>
      <p className="text-sm font-bold leading-6 text-blue-900">
        투자 가능 자산(당장 사용 계획이 없는 자산): {summary.investableDisplay}
      </p>
    </div>
  );
}

function Highlight({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-slate-200 px-3 py-3">
      <p className="text-xs font-bold uppercase tracking-normal text-slate-500">{label}</p>
      <p className="mt-1 text-sm font-bold leading-5 text-navy">{value}</p>
    </div>
  );
}

function Metric({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={`flex items-center justify-between gap-2 rounded-lg border px-3 py-2 sm:block sm:px-4 sm:py-3 ${strong ? "border-orange-200 bg-orange-50" : "border-slate-200 bg-slate-50"}`}>
      <p className="text-xs font-bold text-slate-500">{label}</p>
      <p className={`text-sm font-bold sm:mt-1 sm:text-xl ${strong ? "text-orange-700" : "text-navy"}`}>{value}</p>
    </div>
  );
}

function questionLabel(label: string) {
  return label.startsWith("Q. ") ? label : `Q. ${label}`;
}

function formatUpdatedAt(timestamp: number) {
  if (!timestamp) return "업데이트 이력 없음";
  const date = new Date(timestamp);
  const datePart = date.toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" });
  const timePart = date.toLocaleTimeString("ko-KR", {
    timeZone: "Asia/Seoul",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  });
  return `${datePart} ${timePart} 업데이트`;
}

function formatChangeDate(timestamp: number) {
  return new Date(timestamp).toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" });
}
