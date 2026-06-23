"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Building2,
  CheckCircle2,
  DollarSign,
  Globe,
  Info,
  Loader2,
  Newspaper,
  Plus,
  RefreshCcw,
  TrendingUp,
  X,
} from "lucide-react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  useCustomerContext,
  type BuySimTickerItem,
  type PortfolioAsset,
  type PbOrderRow,
} from "./CustomerContext";
import { formatLocalTickerName } from "./tickerUtils";
import { parseKoreanNumber } from "@/lib/portfolioLogic";
import {
  calcFinancialIncomeSummary,
  NEW_PORTFOLIO_INCOME_STORAGE_KEY,
  type AssetForIncomeCalc,
} from "./tab1/FinancialIncomeGauge";
import {
  CLASS_COLORS,
  formatKrwAmount,
  normalizeAssetClass,
} from "./PortfolioResultComponents";

// ── 타입 ──────────────────────────────────────────────────────────────────────

type Strategy = "conservative" | "balanced" | "aggressive";
type SectorCategory = "equity" | "bond" | "commodity" | "crypto" | "market";

interface PeriodResult {
  optimal: string[];
  capped_weights: Record<string, number>;
  prices: Record<string, number[]>;
  dates: string[];
  scores: Record<string, number>;
  opt_score: number;
}

interface OptApiResponse {
  period: PeriodResult | null;
  sectorMap: Record<string, string>;
}

interface PortfolioMetrics {
  cagr: number;
  mdd: number;
  sharpe: number;
  optScore: number;
  tickerCount: number;
}

// CustomerContext.BuySimTickerItem 재사용 — 전역 영속 타입과 구조 동일
type TickerItem = BuySimTickerItem;

// 야후 파이낸스 검색 결과 관련 기업
interface RelatedCompany {
  symbol: string;
  name: string;
  exchDisp: string;
  marketCap: number;  // 0 = 데이터 없음
  volume: number;     // 거래량, 0 = 데이터 없음
}

type RelatedSortFilter = "theme" | "marketCap" | "volume";

// 기업 실무 핵심 지표
interface CompanyMetrics {
  price: number | null;
  per: number | null;
  pbr: number | null;
  psr: number | null;
  ebitda: number | null;
  revenue: number | null;
  currency: string;
  dataNote?: string; // 'krx-partial': KRX 공시 부분 누락
}

// 실시간 뉴스 아이템 (좌측 패널 하단 표시용)
interface StockNewsItem {
  title: string;
  preview: string;
  url: string;
}

// ── 테마 키워드 사전 (섹터명 → Yahoo Finance 검색 쿼리) ─────────────────────
// 국내 관련주 → kr 키워드, 해외 관련주 → en 키워드로 동적 추출

const THEME_KEYWORDS_MAP: Record<string, { en: string; kr: string }> = {
  "자율주행":         { en: "Autonomous Driving",              kr: "자율주행차"   },
  "인프라":           { en: "Infrastructure Engineering",       kr: "건설대표주"   },
  "달러·외환":        { en: "Global Banking",                   kr: "은행"         },
  "귀금속":           { en: "Gold Silver Mining",               kr: "비철금속"     },
  "농산물원자재":     { en: "Agriculture Fertilizer",           kr: "사료"         },
  "에너지원자재":     { en: "Oil Gas Exploration",              kr: "정유"         },
  "채권(단기)":       { en: "Short Term Treasury",              kr: "은행"         },
  "채권":             { en: "Fixed Income Asset",               kr: "증권"         },
  "암호화폐":         { en: "Cryptocurrency Blockchain",        kr: "가상화폐"     },
  "시장전체":         { en: "Mega Cap Stocks",                  kr: "지주사"       },
  "2차전지·리튬":     { en: "Lithium Battery Electric Vehicle", kr: "2차전지"      },
  "반도체":           { en: "Semiconductor Chip Manufacturer",  kr: "반도체"       },
  "헬스케어":         { en: "Healthcare Biotech Pharma",        kr: "바이오"       },
  "클린에너지":       { en: "Clean Energy Solar Wind",          kr: "태양광"       },
  "부동산":           { en: "Real Estate REIT",                 kr: "리츠"         },
  "AI·전력":          { en: "AI Power Infrastructure",          kr: "AI전력"       },
  "AI·빅데이터":      { en: "Artificial Intelligence Big Data", kr: "반도체"       },
  "청정에너지":       { en: "Clean Energy Solar Wind",          kr: "신재생에너지" },
  "바이오테크":       { en: "Healthcare Biotech Pharma",        kr: "바이오"       },
  "원자력·우라늄":    { en: "Uranium Nuclear Energy",           kr: "원자력"       },
  "사이버보안":       { en: "Cybersecurity Technology",         kr: "방산"         },
  "양자컴퓨팅":       { en: "Quantum Computing Technology",     kr: "반도체"       },
  "희토류·전략소재":  { en: "Rare Earth Strategic Materials",   kr: "비철금속"     },
  "데이터센터":       { en: "Data Center Infrastructure",       kr: "반도체"       },
  "로보틱스":         { en: "Robotics Automation",              kr: "로보틱스"     },
};

// ── 전략 상수 ─────────────────────────────────────────────────────────────────

const STRATEGY_LABELS: Record<Strategy, string> = {
  conservative: "안정형",
  balanced: "밸런스형",
  aggressive: "공격형",
};

const STRATEGY_DESCS: Record<Strategy, string> = {
  conservative: "채권 비중 확대, 낮은 변동성 우선",
  balanced: "수익·위험 균형, 샤프 비율 최대화",
  aggressive: "성장 자산 집중, CAGR 극대화",
};

const STRATEGY_COLORS: Record<
  Strategy,
  { bg: string; border: string; text: string; badge: string }
> = {
  conservative: {
    bg: "bg-blue-50",
    border: "border-blue-400",
    text: "text-blue-700",
    badge: "bg-blue-100 text-blue-700",
  },
  balanced: {
    bg: "bg-emerald-50",
    border: "border-emerald-400",
    text: "text-emerald-700",
    badge: "bg-emerald-100 text-emerald-700",
  },
  aggressive: {
    bg: "bg-red-50",
    border: "border-red-400",
    text: "text-red-700",
    badge: "bg-red-100 text-red-700",
  },
};

const RISK_TO_STRATEGY: Record<string, Strategy> = {
  "초저위험": "conservative",
  "저위험": "conservative",
  "중위험": "balanced",
  "고위험": "aggressive",
  "초고위험": "aggressive",
};

const ALL_STRATEGIES: Strategy[] = ["conservative", "balanced", "aggressive"];

// 성향별 API 요청 종목 수 (국내+해외 각각 k종 → 총 2k종 통합 그리드)
const STRATEGY_K: Record<Strategy, number> = {
  conservative: 5,  // 5+5=10종 — 철저한 분산 목표
  balanced:     4,  // 4+4=8종  — 위험·수익 균형
  aggressive:   3,  // 3+3=6종  — 집중 투자 알파
};

// PB 브리핑 핵심 지표 강조 — 성향별 우선순위 타겟팅
const STRATEGY_HIGHLIGHT: Record<Strategy, { keys: string[]; color: string }> = {
  aggressive:   { keys: ["cagr", "optScore"], color: "text-orange-600" },
  balanced:     { keys: ["sharpe", "cagr"],   color: "text-indigo-600" },
  conservative: { keys: ["mdd", "sharpe"],    color: "text-blue-600"   },
};

// ── 섹터 카테고리 (자산군별 색상 규격 — TAB2-5 CLASS_COLORS 기준 정렬) ───────

const SECTOR_CATEGORY_ORDER: Record<SectorCategory, number> = {
  equity: 0,
  market: 1,
  commodity: 2,
  bond: 3,
  crypto: 4,
};

// 자산군별 고유 색상: CLASS_COLORS 기준 (채권=amber, 원자재=orange, 암호화폐=pink)
const SECTOR_CATEGORY_COLORS: Record<
  SectorCategory,
  { border: string; bg: string; text: string; label: string }
> = {
  equity:    { border: "#10B981", bg: "#f0fdf4", text: "#065f46", label: "주식·성장" },
  market:    { border: "#64748B", bg: "#f8fafc", text: "#1e293b", label: "시장전체" },
  commodity: { border: "#F97316", bg: "#fff7ed", text: "#7c2d12", label: "원자재" },
  bond:      { border: "#F59E0B", bg: "#fffbeb", text: "#78350f", label: "채권" },
  crypto:    { border: "#EC4899", bg: "#fdf2f8", text: "#831843", label: "암호화폐" },
};

// 국내ETF equity는 파란색 (CLASS_COLORS["국내주식"] = #3B82F6)
const DOMESTIC_EQUITY_COLOR = { border: "#3B82F6", bg: "#eff6ff", text: "#1e40af", label: "주식·성장" };

// ── 섹터 카테고리 도출 (섹터명 키워드 기반 — 티커 미참조) ───────────────────

function deriveSectorCategory(sector: string): SectorCategory {
  if (sector.includes("채권")) return "bond";
  if (
    sector.includes("원자재") ||
    sector.includes("귀금속") ||
    sector.includes("희토류") ||
    sector.includes("농산물")
  )
    return "commodity";
  if (sector.includes("암호화폐")) return "crypto";
  if (sector.includes("시장전체") || sector.includes("주식시장")) return "market";
  return "equity";
}

function getSectorColor(sector: string, isGlobal: boolean) {
  const cat = deriveSectorCategory(sector);
  if (cat === "equity" && !isGlobal) return DOMESTIC_EQUITY_COLOR;
  return SECTOR_CATEGORY_COLORS[cat];
}

// ── 클라이언트 측 자산군 집중도 상한 안전망 ────────────────────────────────────
// 서버 Monte Carlo 최적화가 수렴하지 못할 경우를 대비한 보정 로직

const CLASS_CAP: Record<Strategy, number> = {
  conservative: 0.35,
  balanced: 0.50,
  aggressive: 0.65,
};

function deriveBroadClass(sector: string): string {
  if (sector.includes("채권")) return "채권";
  if (
    sector.includes("원자재") ||
    sector.includes("귀금속") ||
    sector.includes("희토류") ||
    sector.includes("농산물")
  )
    return "원자재";
  if (sector.includes("암호화폐")) return "암호화폐";
  if (sector.includes("시장전체") || sector.includes("주식시장")) return "시장전체";
  return "성장주식";
}

function enforceClassCap(
  weights: Record<string, number>,
  sectorMap: Record<string, string>,
  cap: number,
): Record<string, number> {
  const tickers = Object.keys(weights);
  const broadClasses: Record<string, string> = {};
  for (const t of tickers) {
    broadClasses[t] = deriveBroadClass(sectorMap[t] ?? "성장주식");
  }

  // 단일 자산군이면 상한 적용 불필요
  if (new Set(Object.values(broadClasses)).size <= 1) return weights;

  let w = { ...weights };

  // 최대 10회 반복으로 수렴
  for (let pass = 0; pass < 10; pass++) {
    const classSum: Record<string, number> = {};
    for (const t of tickers) {
      const cls = broadClasses[t];
      classSum[cls] = (classSum[cls] ?? 0) + w[t];
    }

    let anyViolation = false;
    for (const sum of Object.values(classSum)) {
      if (sum > cap + 1e-9) { anyViolation = true; break; }
    }
    if (!anyViolation) break;

    // 초과 자산군 비례 축소
    for (const t of tickers) {
      const cls = broadClasses[t];
      const sum = classSum[cls] ?? 0;
      if (sum > cap) w[t] = w[t] * (cap / sum);
    }

    // 전체 합이 1이 되도록 정규화
    const total = Object.values(w).reduce((s, v) => s + v, 0);
    if (total > 0) {
      for (const t of tickers) w[t] = w[t] / total;
    }
  }

  return w;
}

// ── 섹터명 → THEME_KEYWORDS_MAP 검색 키워드 도출 ─────────────────────────────
// THEME_KEYWORDS_MAP 키와 매칭 후, 없으면 섹터명 첫 토큰을 그대로 사용

function deriveSearchKeyword(sector: string, market: "domestic" | "global"): string {
  for (const [key, kw] of Object.entries(THEME_KEYWORDS_MAP)) {
    const cleanKey = key.replace("(단기)", "");
    if (sector.includes(cleanKey)) {
      return market === "domestic" ? kw.kr : kw.en;
    }
  }
  // 폴백: 섹터명 첫 구분자 앞 토큰 (예: "IT·반도체 성장주식" → "IT")
  const firstToken = sector.split(/[·\s]/)[0] ?? sector;
  return firstToken || (market === "domestic" ? "주식" : "Stock Market");
}

// ── 지표 계산 ─────────────────────────────────────────────────────────────────

function computePortfolioMetrics(pr: PeriodResult): PortfolioMetrics {
  const { optimal, capped_weights, prices, dates } = pr;
  const n = dates.length;
  if (n < 2)
    return { cagr: 0, mdd: 0, sharpe: 0, optScore: pr.opt_score, tickerCount: optimal.length };

  const dailyReturns: number[] = [];
  for (let i = 1; i < n; i++) {
    let pRet = 0,
      totalW = 0;
    for (const t of optimal) {
      const w = capped_weights[t] ?? 0;
      const p = prices[t];
      if (!p || !p[i - 1]) continue;
      pRet += w * (p[i] / p[i - 1] - 1);
      totalW += w;
    }
    dailyReturns.push(totalW > 0 ? pRet : 0);
  }

  const totalRet = dailyReturns.reduce((acc, r) => acc * (1 + r), 1) - 1;
  const years = n / 252;
  const cagr = years > 0 ? Math.pow(1 + totalRet, 1 / years) - 1 : 0;

  let peak = 1,
    mdd = 0,
    cum = 1;
  for (const r of dailyReturns) {
    cum *= 1 + r;
    if (cum > peak) peak = cum;
    const dd = (peak - cum) / peak;
    if (dd > mdd) mdd = dd;
  }

  const mean = dailyReturns.reduce((s, r) => s + r, 0) / dailyReturns.length;
  const variance =
    dailyReturns.reduce((s, r) => s + (r - mean) ** 2, 0) / dailyReturns.length;
  const annVol = Math.sqrt(variance * 252);
  const sharpe = annVol > 0 ? (cagr - 0.04) / annVol : 0;

  return { cagr, mdd, sharpe, optScore: pr.opt_score, tickerCount: optimal.length };
}

// ── 포맷 헬퍼 ─────────────────────────────────────────────────────────────────

function fmtPct(v: number, digits = 1) {
  return `${(v * 100).toFixed(digits)}%`;
}

function fmtFixed(v: number, digits = 2) {
  return v.toFixed(digits);
}

function fmtKrwMan(v: number | null): string {
  if (v === null || !Number.isFinite(v)) return "-";
  const abs = Math.abs(v);
  const sign = v < 0 ? "-" : "";
  const eok = Math.floor(abs / 1e8);
  const man = Math.floor((abs % 1e8) / 1e4);
  if (eok && man) return `${sign}${eok}억 ${man.toLocaleString("ko-KR")}만`;
  if (eok) return `${sign}${eok}억`;
  if (man) return `${sign}${man.toLocaleString("ko-KR")}만`;
  return `${sign}${Math.round(abs).toLocaleString("ko-KR")}원`;
}

// 대형 수치 포맷: 조(T) > 억(B) > 백만(M) — USD 단위
function fmtLargeUsd(v: number | null): string {
  if (v === null || !Number.isFinite(v) || v === 0) return "-";
  const abs = Math.abs(v);
  if (abs >= 1e12) return `${(v / 1e12).toFixed(1)}T`;
  if (abs >= 1e9) return `${(v / 1e9).toFixed(1)}B`;
  if (abs >= 1e6) return `${(v / 1e6).toFixed(0)}M`;
  return v.toLocaleString();
}

// 통화 인식 현재가 포맷 — KRW: 원화 + 원, USD/기타: $ + 소수2자리
function fmtCompanyPrice(price: number | null, currency: string): string {
  if (price === null || !Number.isFinite(price)) return "N/A";
  if (currency === "KRW") {
    return `${Math.round(price).toLocaleString("ko-KR")}원`;
  }
  return `$${price.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// 통화 인식 대형 재무 수치 포맷 — KRW: 조/억, USD: T/B/M
function fmtLargeFinancial(v: number | null, currency: string): string {
  if (v === null || !Number.isFinite(v)) return "N/A";
  if (v === 0) return "-";
  const abs = Math.abs(v);
  if (currency === "KRW") {
    if (abs >= 1e12) return `${(v / 1e12).toFixed(1)}조`;
    if (abs >= 1e8)  return `${(v / 1e8).toFixed(0)}억`;
    if (abs >= 1e4)  return `${(v / 1e4).toFixed(0)}만`;
    return v.toLocaleString("ko-KR");
  }
  if (abs >= 1e12) return `${(v / 1e12).toFixed(1)}T`;
  if (abs >= 1e9)  return `${(v / 1e9).toFixed(1)}B`;
  if (abs >= 1e6)  return `${(v / 1e6).toFixed(0)}M`;
  return v.toLocaleString();
}

// ── 매수 확정 병합 엔진 ───────────────────────────────────────────────────────────
// 기존 보유 자산에 신규 매수 종목을 병합: 수량형은 qty 누적, 금액형은 금액 누적, 신규면 push

function mergeBuyIntoBase(
  base: PortfolioAsset[],
  pbRows: PbOrderRow[],
  etfBuys: PortfolioAsset[],
  usdKrwRate: number,
): PortfolioAsset[] {
  const merged = base.map((a) => ({ ...a }));

  for (const row of pbRows) {
    const isBond = isBondProductType(row.productType);
    const krwTotal = computeKrwAmount(row, usdKrwRate);
    if (isBond) {
      // 채권: amountManStr(총 투자금액)이 있어야 유효
      if (krwTotal <= 0) continue;
    } else {
      const qty = parseFloat(row.quantity);
      if (!Number.isFinite(qty) || qty <= 0 || (row.currentPrice ?? 0) <= 0) continue;
    }
    const qty = parseFloat(row.quantity);
    const idx = merged.findIndex((a) => isSameAsset(a, row.name, row.ticker));
    if (idx !== -1) {
      const ex = merged[idx];
      if (ex.amount_type === "quantity") {
        merged[idx] = { ...ex, amount: ex.amount + (Number.isFinite(qty) && qty > 0 ? qty : 0) };
      } else {
        merged[idx] = { ...ex, amount: ex.amount + krwTotal };
      }
    } else {
      const bondYieldVal = parseFloat(row.bondYield);
      const maturityVal = parseFloat(row.maturityYears);
      // current_price는 항상 KRW로 정규화 (portfolioLogic.ts 컨벤션 동일)
      const priceKrw = isBond
        ? (Number.isFinite(qty) && qty > 0 ? krwTotal / qty : null)
        : (row.priceCurrency === "USD" && row.currentPrice != null
            ? row.currentPrice * usdKrwRate
            : (row.currentPrice ?? null));
      const newRow: PortfolioAsset = {
        name: row.name || row.ticker || row.productType || "직접매수종목",
        ticker: row.ticker || "",
        asset_class: row.productType,
        productType: row.productType,
        theme: "기타",
        country: row.productType.includes("해외") ? "미국" : "한국",
        buy_price: priceKrw,
        amount: Number.isFinite(qty) && qty > 0 ? qty : 1,
        amount_type: "quantity",
        is_hedged: false,
        needs_review: false,
        bond_yield: Number.isFinite(bondYieldVal) && bondYieldVal > 0 ? bondYieldVal : null,
        bond_maturity: Number.isFinite(maturityVal) && maturityVal > 0 ? maturityVal : null,
        current_price: priceKrw ?? undefined,
        current_value: krwTotal || undefined,
      };
      merged.push(newRow);
    }
  }

  for (const buy of etfBuys) {
    const idx = merged.findIndex((a) => isSameAsset(a, buy.name, buy.ticker));
    if (idx !== -1) {
      const ex = merged[idx];
      if (ex.amount_type === "value") {
        merged[idx] = { ...ex, amount: ex.amount + buy.amount };
      }
    } else {
      merged.push({ ...buy });
    }
  }

  return merged;
}

// ── 보유 자산 카드 그리드 헬퍼 ───────────────────────────────────────────────────

function normalizeKey(name: string, ticker?: string | null): string {
  return `${name.toLowerCase().trim()}::${(ticker ?? "").toLowerCase().trim()}`;
}

// 티커에서 .KS/.KQ 등 거래소 접미사 제거 후 소문자 정규화
function tickerBase(t?: string | null): string {
  return (t ?? "").replace(/\.[A-Za-z]+$/, "").toLowerCase().trim();
}

// 티커 일치 OR 종목명 일치이면 동일 종목으로 판정
function isSameAsset(a: PortfolioAsset, name: string, ticker?: string | null): boolean {
  const tb = tickerBase(ticker);
  if (tb && tickerBase(a.ticker) === tb) return true;
  return a.name.toLowerCase().trim() === name.toLowerCase().trim();
}

function makeAssetKey(a: PortfolioAsset): string {
  return normalizeKey(a.name, a.ticker);
}

function getEffectiveAssetPrice(a: PortfolioAsset): number {
  const cp = Number(a.current_price);
  if (Number.isFinite(cp) && cp > 0) return cp;
  const bp = Number(a.buy_price);
  return Number.isFinite(bp) && bp > 0 ? bp : 0;
}

function getEffectiveAssetValue(a: PortfolioAsset): number {
  if (a.current_value != null && a.current_value > 0) return a.current_value;
  const price = getEffectiveAssetPrice(a);
  if (a.amount_type === "quantity" && price > 0) return a.amount * price;
  return a.amount ?? 0;
}

// ── PB 행 원화 환산 ───────────────────────────────────────────────────────────
// 채권: amountManStr(총 투자금액) 직접 사용
// 비채권 국내(KRW): price × quantity / 해외(USD): price × quantity × usdKrwRate
function isBondProductType(productType: string): boolean {
  return productType === "국내채권" || productType === "해외채권";
}
function computeKrwAmount(row: PbOrderRow, usdKrwRate: number): number {
  if (isBondProductType(row.productType)) {
    const amt = parseKoreanNumber(row.amountManStr);
    return Number.isFinite(amt) && amt > 0 ? Math.round(amt) : 0;
  }
  const qty = parseFloat(row.quantity);
  const price = row.currentPrice;
  if (!Number.isFinite(qty) || qty <= 0 || price === null || !Number.isFinite(price) || price <= 0) return 0;
  const krw = row.priceCurrency === "USD" ? price * qty * usdKrwRate : price * qty;
  return Number.isFinite(krw) && krw > 0 ? Math.round(krw) : 0;
}

// ── 메인 컴포넌트 ─────────────────────────────────────────────────────────────

export default function BuySimulatorTab() {
  const {
    availableInvestmentFunds,
    rebalancingSellAssets,
    setRebalancingSellAssets,
    setRebalancingBuyAssets,
    confirmRebalancingBuy,
    setNewPortfolioAnalysisResult,
    saveTaxSummary,
    portfolioAssets,
    analysisResult,
    formData,
    riskResult,
    selectedCustomer,
    confirmedDomesticPair,
    confirmedGlobalPair,
    buySimTickerItems,
    setBuySimPersistedState,
    pbOrderRows,
    setPbOrderRows,
    addSellRecord,
    addBuyCost,
  } = useCustomerContext();

  // ── 보유 자산 카드 그리드 데이터 ────────────────────────────────────────────────
  const baseAssets = useMemo<PortfolioAsset[]>(() => {
    const enriched = (analysisResult?.enrichedAssets ?? []) as PortfolioAsset[];
    const priceMap = new Map(enriched.map((a) => [makeAssetKey(a), a]));
    if (rebalancingSellAssets.length > 0) {
      return rebalancingSellAssets
        .filter((a) => a.name)
        .map((a) => {
          const e = priceMap.get(makeAssetKey(a));
          const cp = Number(e?.current_price ?? a.current_price);
          return { ...a, current_price: cp > 0 ? cp : a.current_price, current_value: a.amount > 0 && cp > 0 ? a.amount * cp : 0 };
        });
    }
    const src = enriched.length ? enriched : portfolioAssets;
    return src.filter((a) => a.name);
  }, [analysisResult, portfolioAssets, rebalancingSellAssets]);

  const sortedAssetCards = useMemo(() => {
    const marketGroup = (x: PortfolioAsset): number => {
      const k = (x.productType ?? x.asset_class ?? "").trim();
      if (k.startsWith("국내")) return 0;
      if (k.startsWith("해외")) return 1;
      return 2;
    };
    return [...baseAssets]
      .filter((a) => !(a.amount_type === "quantity" && a.amount <= 0))
      .sort((a, b) => {
        const d = marketGroup(a) - marketGroup(b);
        return d !== 0 ? d : (a.productType ?? "").localeCompare(b.productType ?? "");
      });
  }, [baseAssets]);

  const groupedAssetCards = useMemo(() => {
    const groups: { type: string; assets: PortfolioAsset[] }[] = [];
    for (const a of sortedAssetCards) {
      const type = a.productType ?? a.asset_class ?? "기타";
      const last = groups[groups.length - 1];
      if (last && last.type === type) last.assets.push(a);
      else groups.push({ type, assets: [a] });
    }
    return groups;
  }, [sortedAssetCards]);

  const defaultStrategy = useMemo<Strategy>(
    () => RISK_TO_STRATEGY[riskResult.level] ?? "balanced",
    [riskResult.level],
  );

  const [activeStrategy, setActiveStrategy] = useState<Strategy>(defaultStrategy);
  const [globalData, setGlobalData] =
    useState<Partial<Record<Strategy, OptApiResponse>>>({});
  const [domesticData, setDomesticData] =
    useState<Partial<Record<Strategy, OptApiResponse>>>({});
  const [isLoading, setIsLoading] = useState(false);
  // 컨텍스트 영속 상태에서 초기화 — 탭 전환(unmount/remount) 후에도 복원됨
  const [tickerItems, setTickerItems] = useState<TickerItem[]>(buySimTickerItems);

  // 언마운트 시 컨텍스트에 동기화하기 위한 최신값 refs
  const tickerItemsRef = useRef<TickerItem[]>(buySimTickerItems);
  const confirmedSigRef = useRef<string>('');

  // 확정 조합 시그니처 — 같으면 영속 상태 재사용, 다르면 재빌드
  const confirmedSig = useMemo(() => {
    const d = (confirmedDomesticPair ?? []).map(i => `${i.ticker}:${i.weight.toFixed(6)}`).join(',');
    const g = (confirmedGlobalPair ?? []).map(i => `${i.ticker}:${i.weight.toFixed(6)}`).join(',');
    return `D:${d}|G:${g}`;
  }, [confirmedDomesticPair, confirmedGlobalPair]);

  // 딥다이브 모달
  const [modalTicker, setModalTicker] = useState<string | null>(null);
  const [modalSector, setModalSector] = useState<string>("");
  const [modalIsGlobal, setModalIsGlobal] = useState(true);
  const [modalMeta, setModalMeta] = useState<Record<string, unknown> | null>(null);
  const [isLoadingModal, setIsLoadingModal] = useState(false);
  // 좌측 패널 포커스 대상 티커 (초기값=부모ETF, 관련기업 클릭 시 갱신)
  const [modalFocusTicker, setModalFocusTicker] = useState<string | null>(null);
  // 모달 헤더 고정용 ETF 공식명 (포커스 전환 시 변동 방지)
  const [etfOfficialName, setEtfOfficialName] = useState<string | undefined>();
  // 실시간 뉴스 (modalFocusTicker 기준)
  const [stockNews, setStockNews] = useState<StockNewsItem[]>([]);
  const [isLoadingNews, setIsLoadingNews] = useState(false);

  // 모달 우측 — 관련 기업 패널 (Yahoo Finance Holdings null 우회)
  const [relatedMarket, setRelatedMarket] = useState<"domestic" | "global">("global");
  const [selectedCompanyIdx, setSelectedCompanyIdx] = useState<number | null>(null);
  const [companyMetrics, setCompanyMetrics] = useState<CompanyMetrics | null>(null);
  const [isLoadingCompanyMetrics, setIsLoadingCompanyMetrics] = useState(false);
  const [relatedCompanies, setRelatedCompanies] = useState<RelatedCompany[]>([]);
  const [isLoadingRelated, setIsLoadingRelated] = useState(false);
  const [relatedSortFilter, setRelatedSortFilter] = useState<RelatedSortFilter>("theme");
  const [isSortTransitioning, setIsSortTransitioning] = useState(false);
  // 리스트 행 해시태그용: ticker → 테마연관순 상위 5 종목명 캐시
  const [tickerTopNames, setTickerTopNames] = useState<Map<string, string[]>>(new Map());

  const [isConfirming, setIsConfirming] = useState(false);
  const [confirmDone, setConfirmDone] = useState(false);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  // 보유 자산 카드 인라인 매도
  const [sellCardKey, setSellCardKey] = useState<string | null>(null);
  const [inlineSellQtyStr, setInlineSellQtyStr] = useState("");

  // 드래그 앤 드롭
  const [draggedTicker, setDraggedTicker] = useState<TickerItem | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  type DropModal = {
    ticker: string; sector: string; isGlobal: boolean;
    mode: "buy" | "sell"; qtyStr: string;
    price: number | null; currency: "KRW" | "USD"; isLoadingPrice: boolean;
  };
  const [dropModal, setDropModal] = useState<DropModal | null>(null);

  // USD/KRW 실시간 환율 (야후 파이낸스 USDKRW=X — 마운트 시 1회 조회, 기본값 1380)
  const [usdKrwRate, setUsdKrwRate] = useState<number>(1380);

  const tMarginal = useMemo(() => {
    const total = parseKoreanNumber(formData.financial.totalAssets);
    if (total >= 5e9) return 0.45;
    if (total >= 3e9) return 0.40;
    if (total >= 1.2e9) return 0.35;
    return 0.38;
  }, [formData.financial.totalAssets]);

  // 정렬 필터 적용 — 원본 배열 불변, 정렬된 뷰 생성
  // Number() 강제 변환 가드: JSON 역직렬화 시 문자열·undefined가 섞여도 안전하게 연산
  const sortedRelatedCompanies = useMemo<RelatedCompany[]>(() => {
    // 원본 배열 참조를 반드시 끊어 리렌더링을 보장 — sort()는 in-place 변이이므로 항상 spread 복사
    const base = [...relatedCompanies];
    const n = (v: unknown) => Number(v) || 0;
    if (relatedSortFilter === "marketCap") {
      return base.sort((a, b) => n(b.marketCap) - n(a.marketCap));
    }
    if (relatedSortFilter === "volume") {
      return base.sort((a, b) => n(b.volume) - n(a.volume));
    }
    return base; // "theme" — API 원본 순서 유지
  }, [relatedCompanies, relatedSortFilter]);

  // ── API fetch ────────────────────────────────────────────────────────────

  const fetchStrategy = useCallback(async (strategy: Strategy) => {
    const k = STRATEGY_K[strategy];
    const [gRes, dRes] = await Promise.all([
      fetch(`/api/etf-correlation-html?strategy=${strategy}&k=${k}&format=json&period=1Y`),
      fetch(`/api/etf-correlation-domestic-html?strategy=${strategy}&k=${k}&format=json&period=1Y`),
    ]);
    const [g, d] = await Promise.all([gRes.json(), dRes.json()]);
    return { global: g as OptApiResponse, domestic: d as OptApiResponse };
  }, []);

  // 활성 전략 로드
  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    fetchStrategy(activeStrategy)
      .then(({ global: g, domestic: d }) => {
        if (cancelled) return;
        setGlobalData((prev) => ({ ...prev, [activeStrategy]: g }));
        setDomesticData((prev) => ({ ...prev, [activeStrategy]: d }));
      })
      .catch(console.error)
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [activeStrategy, fetchStrategy]);

  // 나머지 전략 백그라운드 프리페치
  useEffect(() => {
    const others = ALL_STRATEGIES.filter((s) => s !== activeStrategy);
    for (const s of others) {
      if (globalData[s] && domesticData[s]) continue;
      fetchStrategy(s)
        .then(({ global: g, domestic: d }) => {
          setGlobalData((prev) => ({ ...prev, [s]: g }));
          setDomesticData((prev) => ({ ...prev, [s]: d }));
        })
        .catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeStrategy]);

  // ── refs 동기화 (unmount 직전 최신값 보장) ──────────────────────────────────
  useEffect(() => { tickerItemsRef.current = tickerItems; }, [tickerItems]);
  useEffect(() => { confirmedSigRef.current = confirmedSig; }, [confirmedSig]);

  // ── unmount 시 컨텍스트에 영속 저장 — 탭 전환 후 재마운트 시 복원 ───────────
  useEffect(() => {
    return () => {
      setBuySimPersistedState(tickerItemsRef.current, confirmedSigRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setBuySimPersistedState]);

  // ── 고객 전환 시 해당 고객의 영속 상태로 재초기화 ────────────────────────────
  const prevCustomerRef = useRef(selectedCustomer);
  useEffect(() => {
    if (prevCustomerRef.current === selectedCustomer) return;
    prevCustomerRef.current = selectedCustomer;
    setTickerItems(buySimTickerItems);
    setConfirmDone(false);
  }, [selectedCustomer, buySimTickerItems]);

  // ── Effect A: 확정 조합 모드 (1순위 무조건 바인딩) ──────────────────────────
  // confirmedDomesticPair / confirmedGlobalPair 가 하나라도 있으면 항상 이 데이터로 빌드.
  // 탭 재마운트 포함 모든 경우에 confirmedPair를 1순위로 강제 반영.
  useEffect(() => {
    const hasConfirmedGlobal = (confirmedGlobalPair?.length ?? 0) > 0;
    const hasConfirmedDomestic = (confirmedDomesticPair?.length ?? 0) > 0;
    if (!hasConfirmedGlobal && !hasConfirmedDomestic) return; // Effect B 담당

    const totalFunds = availableInvestmentFunds ?? 0;
    const rawItems: TickerItem[] = [];
    const combinedSectorMap: Record<string, string> = {};

    if (hasConfirmedGlobal) {
      for (const item of confirmedGlobalPair!) {
        rawItems.push({ ticker: item.ticker, sector: item.sector, weight: item.weight * 0.5, checked: true, customAmountStr: "", isGlobal: true });
        combinedSectorMap[item.ticker] = item.sector;
      }
    }
    if (hasConfirmedDomestic) {
      for (const item of confirmedDomesticPair!) {
        rawItems.push({ ticker: item.ticker, sector: item.sector, weight: item.weight * 0.5, checked: true, customAmountStr: "", isGlobal: false });
        combinedSectorMap[item.ticker] = item.sector;
      }
    }

    const totalW = rawItems.reduce((s, i) => s + i.weight, 0);
    if (totalW > 0) rawItems.forEach((i) => { i.weight = i.weight / totalW; });

    const rawWeights: Record<string, number> = {};
    rawItems.forEach((i) => { rawWeights[i.ticker] = i.weight; });
    const adjusted = enforceClassCap(rawWeights, combinedSectorMap, CLASS_CAP[activeStrategy]);

    const items: TickerItem[] = rawItems.map((item) => {
      const weight = adjusted[item.ticker] ?? item.weight;
      const amountMan = totalFunds > 0 ? Math.floor((totalFunds * weight) / 10000) : 0;
      return { ...item, weight, customAmountStr: amountMan > 0 ? String(amountMan) : "" };
    });

    setTickerItems(items);
    setBuySimPersistedState(items, confirmedSig);
    setConfirmDone(false);
  }, [confirmedSig, confirmedDomesticPair, confirmedGlobalPair, availableInvestmentFunds, activeStrategy, setBuySimPersistedState]);

  // ── Effect B: API 폴백 모드 (확정 조합 없을 때만) ────────────────────────────
  // 확정 조합이 하나라도 있으면 실행 안 함 → API 데이터가 확정 조합을 덮어쓰지 않음
  useEffect(() => {
    if ((confirmedGlobalPair?.length ?? 0) > 0 || (confirmedDomesticPair?.length ?? 0) > 0) return;

    const gData = globalData[activeStrategy];
    const dData = domesticData[activeStrategy];
    if (!gData?.period && !dData?.period) { setTickerItems([]); return; }

    const totalFunds = availableInvestmentFunds ?? 0;
    const rawItems: TickerItem[] = [];
    const combinedSectorMap: Record<string, string> = {};

    if (gData?.period) {
      const { period, sectorMap } = gData;
      const kLen = period.optimal.length;
      for (const ticker of period.optimal) {
        const w = (period.capped_weights[ticker] ?? 1 / kLen) * 0.5;
        combinedSectorMap[ticker] = sectorMap[ticker] ?? ticker;
        rawItems.push({ ticker, sector: sectorMap[ticker] ?? ticker, weight: w, checked: true, customAmountStr: "", isGlobal: true });
      }
    }
    if (dData?.period) {
      const { period, sectorMap } = dData;
      const kLen = period.optimal.length;
      for (const ticker of period.optimal) {
        const w = (period.capped_weights[ticker] ?? 1 / kLen) * 0.5;
        combinedSectorMap[ticker] = sectorMap[ticker] ?? ticker;
        rawItems.push({ ticker, sector: sectorMap[ticker] ?? ticker, weight: w, checked: true, customAmountStr: "", isGlobal: false });
      }
    }

    if (rawItems.length === 0) { setTickerItems([]); return; }

    const totalW = rawItems.reduce((s, i) => s + i.weight, 0);
    if (totalW > 0) rawItems.forEach((i) => { i.weight = i.weight / totalW; });

    const rawWeights: Record<string, number> = {};
    rawItems.forEach((i) => { rawWeights[i.ticker] = i.weight; });
    const adjusted = enforceClassCap(rawWeights, combinedSectorMap, CLASS_CAP[activeStrategy]);

    const items: TickerItem[] = rawItems.map((item) => {
      const weight = adjusted[item.ticker] ?? item.weight;
      const amountMan = totalFunds > 0 ? Math.floor((totalFunds * weight) / 10000) : 0;
      return { ...item, weight, customAmountStr: amountMan > 0 ? String(amountMan) : "" };
    });

    setTickerItems(items);
    setConfirmDone(false);
  }, [globalData, domesticData, availableInvestmentFunds, activeStrategy, confirmedDomesticPair, confirmedGlobalPair]);

  // ── 전략 카드 지표 (해외 ETF 기준 — 글로벌 포트폴리오가 주도) ─────────────

  const allMetrics = useMemo(() => {
    const result: Record<string, PortfolioMetrics | null> = {};
    for (const s of ALL_STRATEGIES) {
      const src = globalData[s];
      if (!src?.period) continue;
      try {
        result[s] = computePortfolioMetrics(src.period);
      } catch {
        result[s] = null;
      }
    }
    return result;
  }, [globalData]);


  // ── 예산 계산 ────────────────────────────────────────────────────────────

  // 순수 대기 행 합산: 이미 rebalancingSellAssets에 반영된 확정 행은 0원 처리 (double-count 방지)
  const pbTotalAmount = useMemo(() => {
    return pbOrderRows.reduce((s, row) => {
      const confirmedAsset = rebalancingSellAssets.find((a) =>
        isSameAsset(a, row.name, row.ticker),
      );
      const origAsset = portfolioAssets.find((pa) =>
        isSameAsset(pa, row.name, row.ticker),
      );
      const alreadyConfirmed =
        !!confirmedAsset &&
        (!origAsset ||
          (confirmedAsset.amount_type === "quantity" &&
            confirmedAsset.amount > origAsset.amount));
      return alreadyConfirmed ? s : s + computeKrwAmount(row, usdKrwRate);
    }, 0);
  }, [pbOrderRows, usdKrwRate, rebalancingSellAssets, portfolioAssets]);

  // 세션 확정 금액: rebalancingSellAssets↔portfolioAssets 전수 비교로 누적 매수분 역산
  // 신규 편입: current_value(KRW 확정값), 기존 증가분: deltaQty × current_price(KRW)
  const confirmedPbAmount = useMemo(() => {
    return rebalancingSellAssets.reduce((sum, a) => {
      const origAsset = portfolioAssets.find((pa) => isSameAsset(pa, a.name, a.ticker));
      if (!origAsset) {
        return sum + (a.current_value ?? 0);
      }
      if (a.amount_type === "quantity" && a.amount > origAsset.amount) {
        const delta = a.amount - origAsset.amount;
        const cp = Number(a.current_price);
        return sum + (Number.isFinite(cp) && cp > 0 ? delta * cp : 0);
      }
      return sum;
    }, 0);
  }, [rebalancingSellAssets, portfolioAssets]);

  const { totalAllocated, remaining, isOverBudget } = useMemo(() => {
    const total = confirmedPbAmount + pbTotalAmount;
    const avail = availableInvestmentFunds ?? 0;
    return {
      totalAllocated: total,
      remaining: avail - total,
      isOverBudget: avail > 0 && total > avail,
    };
  }, [availableInvestmentFunds, confirmedPbAmount, pbTotalAmount]);

  // ── 섹터 카테고리별 정렬 (렌더 전 그룹화) ────────────────────────────────

  const sortedTickerItems = useMemo(() => {
    return tickerItems
      .map((item, originalIdx) => ({ ...item, originalIdx }))
      .sort((a, b) => {
        const catA = deriveSectorCategory(a.sector);
        const catB = deriveSectorCategory(b.sector);
        const orderA = SECTOR_CATEGORY_ORDER[catA] ?? 99;
        const orderB = SECTOR_CATEGORY_ORDER[catB] ?? 99;
        if (orderA !== orderB) return orderA - orderB;
        return a.sector.localeCompare(b.sector, "ko");
      });
  }, [tickerItems]);

  // 리스트 해시태그 pre-fetch: sortedTickerItems 변경 시 미캐시 항목만 순차 조회
  useEffect(() => {
    if (!sortedTickerItems.length) return;
    let cancelled = false;
    (async () => {
      for (const item of sortedTickerItems) {
        if (cancelled) break;
        if (tickerTopNames.has(item.ticker)) continue;
        try {
          const market = item.isGlobal ? "global" : "domestic";
          const keyword = deriveSearchKeyword(item.sector, market);
          const mkt = market === "domestic" ? "kr" : "en";
          const params = new URLSearchParams({ keyword, count: "5", market: mkt, ticker: item.ticker });
          const res = await fetch(`/api/related-companies?${params}`);
          if (cancelled) break;
          if (res.ok) {
            const json = (await res.json()) as { companies: RelatedCompany[] };
            const names = (json.companies ?? []).slice(0, 5).map((c) => c.name);
            setTickerTopNames((prev) => new Map(prev).set(item.ticker, names));
          }
        } catch { /* 네트워크 오류 시 해시태그 생략 */ }
      }
    })();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sortedTickerItems]);

  // ── 핸들러 ───────────────────────────────────────────────────────────────

  // 체크박스 — 시각 효과 전용 (totalAllocated·handleConfirm 비개입)
  const toggleCheck = useCallback(
    (idx: number) =>
      setTickerItems((prev) =>
        prev.map((t, i) => (i === idx ? { ...t, checked: !t.checked } : t)),
      ),
    [],
  );

  const updateAmount = useCallback(
    (idx: number, val: string) =>
      setTickerItems((prev) =>
        prev.map((t, i) =>
          i === idx ? { ...t, customAmountStr: val } : t,
        ),
      ),
    [],
  );

  // 비중 재배분 (저장된 weight 기준 — floor 엄격 적용)
  const reallocate = useCallback(() => {
    const total = availableInvestmentFunds ?? 0;
    setTickerItems((prev) =>
      prev.map((t) => ({
        ...t,
        customAmountStr: String(Math.floor((total * t.weight) / 10000)),
      })),
    );
  }, [availableInvestmentFunds]);

  // ── PB 직접 매수 패널 콜백 ──────────────────────────────────────────────────

  const triggerPbSearch = useCallback((rowId: string, name: string, productType: string) => {
    clearTimeout(pbSearchTimersRef.current[rowId]);
    if (!name.trim()) {
      setPbSearchState((prev) => ({ ...prev, [rowId]: { loading: false, error: null } }));
      return;
    }
    pbSearchTimersRef.current[rowId] = setTimeout(async () => {
      setPbSearchState((prev) => ({ ...prev, [rowId]: { loading: true, error: null } }));
      try {
        const qp = new URLSearchParams({ assetName: name });
        if (productType) qp.set("productType", productType);
        const res = await fetch(`/api/proxy-finance?${qp}`);
        const data = (await res.json()) as {
          ticker?: string;
          error?: string;
          chart?: { result?: Array<{ meta?: { regularMarketPrice?: number; currency?: string } }> };
        };
        if (data.ticker) {
          const chartMeta = data?.chart?.result?.[0]?.meta;
          const price = typeof chartMeta?.regularMarketPrice === "number" ? chartMeta.regularMarketPrice : null;
          const currency = chartMeta?.currency ?? (productType.includes("해외") ? "USD" : "KRW");
          const updated = pbOrderRowsRef.current.map((r) =>
            r.id === rowId ? { ...r, ticker: data.ticker!, currentPrice: price, priceCurrency: currency } : r,
          );
          setPbOrderRows(updated);
          setPbSearchState((prev) => ({ ...prev, [rowId]: { loading: false, error: null } }));
        } else {
          setPbSearchState((prev) => ({
            ...prev,
            [rowId]: { loading: false, error: data.error ?? "티커를 찾을 수 없습니다." },
          }));
        }
      } catch {
        setPbSearchState((prev) => ({
          ...prev,
          [rowId]: { loading: false, error: "검색 중 오류가 발생했습니다." },
        }));
      }
    }, 600);
  }, [setPbOrderRows]);

  const addPbRow = useCallback(() => {
    const newRow: PbOrderRow = {
      id: `pb-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      productType: "국내주식",
      name: "",
      ticker: "",
      amountManStr: "",
      currentPrice: null,
      priceCurrency: "KRW",
      quantity: "",
      bondYield: "",
      maturityYears: "",
    };
    setPbOrderRows([...pbOrderRowsRef.current, newRow]);
  }, [setPbOrderRows]);

  const removePbRow = useCallback((id: string) => {
    const row = pbOrderRowsRef.current.find((r) => r.id === id);

    // 이미 매수 확정된 종목이면 모달 팝업으로 확인 후 처리
    if (row) {
      const confirmedAsset = sellAssetsRef.current.find((a) =>
        isSameAsset(a, row.name, row.ticker),
      );
      const origAsset = portfolioRef.current.find((pa) =>
        isSameAsset(pa, row.name, row.ticker),
      );
      const isConfirmed =
        !!confirmedAsset &&
        (!origAsset ||
          (confirmedAsset.amount_type === "quantity" &&
            confirmedAsset.amount > origAsset.amount));

      if (isConfirmed) {
        setDeleteConfirmId(id);
        return; // 모달에서 확인/취소 후 처리
      }
    }

    // 미확정 행은 바로 삭제
    clearTimeout(pbSearchTimersRef.current[id]);
    delete pbSearchTimersRef.current[id];
    setPbSearchState((prev) => { const next = { ...prev }; delete next[id]; return next; });
    setPbOrderRows(pbOrderRowsRef.current.filter((r) => r.id !== id));
  }, [setPbOrderRows]);

  const confirmDeletePbRow = useCallback(async () => {
    const id = deleteConfirmId;
    if (!id) return;
    setDeleteConfirmId(null);

    const row = pbOrderRowsRef.current.find((r) => r.id === id);

    // 롤백 자산 목록 계산 (row 존재 여부와 무관하게 항상 입력 행은 제거)
    const rolledBack: PortfolioAsset[] | null = row
      ? (() => {
          const origAsset = portfolioRef.current.find((pa) =>
            isSameAsset(pa, row.name, row.ticker),
          );
          return sellAssetsRef.current
            .map((a): PortfolioAsset | null => {
              if (!isSameAsset(a, row.name, row.ticker)) return a;
              if (!origAsset) return null;
              return { ...a, amount: origAsset.amount, current_value: undefined };
            })
            .filter((a): a is PortfolioAsset => a !== null);
        })()
      : null;

    if (rolledBack) setRebalancingSellAssets(rolledBack);

    clearTimeout(pbSearchTimersRef.current[id]);
    delete pbSearchTimersRef.current[id];
    setPbSearchState((prev) => { const next = { ...prev }; delete next[id]; return next; });
    setPbOrderRows(pbOrderRowsRef.current.filter((r) => r.id !== id));

    if (rolledBack) {
      try {
        const { runAnalysis } = await import("@/lib/portfolioLogic");
        const result = await runAnalysis(rolledBack, {
          tMarginal: tMarginalRef.current,
          expectedInterestIncome: formDataRef.current.rrttllu.expectedInterestIncome,
          expectedDividendIncome: formDataRef.current.rrttllu.expectedDividendIncome,
        });
        if (result) setNewPortfolioAnalysisResult(result);
      } catch {
        // 분석 실패는 비치명적 — 자산 롤백은 완료
      }
    }
  }, [deleteConfirmId, setPbOrderRows, setRebalancingSellAssets, setNewPortfolioAnalysisResult]);

  const cancelDeletePbRow = useCallback(() => {
    setDeleteConfirmId(null);
  }, []);

  // 보유 자산 카드 매도 핸들러
  const handleSellCard = useCallback((assetKey: string) => {
    setSellCardKey(assetKey);
    setInlineSellQtyStr("");
  }, []);

  // 드래그 앤 드롭 핸들러
  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    if (!draggedTicker) return;
    const productType = draggedTicker.isGlobal ? "해외ETF" : "국내ETF";
    setDropModal({
      ticker: draggedTicker.ticker,
      sector: draggedTicker.sector,
      isGlobal: draggedTicker.isGlobal,
      mode: "buy",
      qtyStr: "",
      price: null,
      currency: draggedTicker.isGlobal ? "USD" : "KRW",
      isLoadingPrice: true,
    });
    setDraggedTicker(null);
    fetch(`/api/proxy-finance?assetName=${encodeURIComponent(draggedTicker.ticker)}&productType=${encodeURIComponent(productType)}`)
      .then(async (r) => {
        if (!r.ok) return;
        const data = (await r.json()) as Record<string, unknown>;
        const meta = ((data?.chart as Record<string, unknown>)?.result as Record<string, unknown>[])?.[0]
          ?.meta as Record<string, unknown> | undefined;
        const price = typeof meta?.regularMarketPrice === "number" ? meta.regularMarketPrice : null;
        const currency = (meta?.currency as string) ?? (draggedTicker.isGlobal ? "USD" : "KRW");
        setDropModal((prev) => prev ? { ...prev, price, currency: currency as "KRW" | "USD", isLoadingPrice: false } : null);
      })
      .catch(() => setDropModal((prev) => prev ? { ...prev, isLoadingPrice: false } : null));
  }, [draggedTicker]);

  const confirmSellCard = useCallback(() => {
    if (!sellCardKey) return;
    const asset = baseAssets.find((a) => makeAssetKey(a) === sellCardKey);
    if (!asset) { setSellCardKey(null); return; }
    const price = getEffectiveAssetPrice(asset);
    if (price <= 0 || asset.amount_type !== "quantity" || asset.amount <= 0) { setSellCardKey(null); return; }
    const qty = Math.min(parseFloat(inlineSellQtyStr), asset.amount);
    if (!Number.isFinite(qty) || qty <= 0) { setSellCardKey(null); return; }
    const bp = asset.buy_price;
    const gain = bp != null ? (price - bp) * qty : 0;
    addSellRecord({
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      name: asset.name,
      productType: asset.productType ?? asset.asset_class ?? "",
      sellPrice: price,
      sellQty: qty,
      buyPrice: bp,
      realizedGain: gain,
    });
    setSellCardKey(null);
    setInlineSellQtyStr("");
  }, [sellCardKey, inlineSellQtyStr, baseAssets, addSellRecord]);

  const updatePbRow = useCallback((id: string, patch: Partial<PbOrderRow>) => {
    const newType = "productType" in patch ? (patch.productType ?? "") : null;
    const switchingToBond = newType !== null && isBondProductType(newType);
    const switchingFromBond = newType !== null && !isBondProductType(newType);
    const fullPatch: Partial<PbOrderRow> = "productType" in patch
      ? {
          ...patch,
          currentPrice: null,
          priceCurrency: newType?.includes("해외") ? "USD" : "KRW",
          // 채권 선택 시: 종목명 = 상품유형명, 티커 클리어
          ...(switchingToBond ? { name: newType ?? "", ticker: "", amountManStr: "" } : {}),
          // 비채권 전환 시: 채권 전용 필드 클리어
          ...(switchingFromBond ? { bondYield: "", maturityYears: "", amountManStr: "" } : {}),
        }
      : patch;
    const updated = pbOrderRowsRef.current.map((r) => r.id === id ? { ...r, ...fullPatch } : r);
    setPbOrderRows(updated);
    // 채권 유형은 시장 가격 조회 불필요 — 검색 생략
    if (("name" in patch || "productType" in patch) && !switchingToBond) {
      const target = updated.find((r) => r.id === id);
      if (target && !isBondProductType(target.productType)) triggerPbSearch(id, target.name, target.productType);
    }
  }, [setPbOrderRows, triggerPbSearch]);

  // 관련 기업 실시간 검색 (Yahoo Finance + 네이버 파이낸스 3단계 엔진)
  // market=kr → .KS/.KQ 종목만 반환, market=en → 글로벌 EQUITY 반환
  // subQuery: 백엔드 최우선 매칭 키워드 (예: "정유" — oil ETF 감지 시 주입)
  const fetchRelatedCompanies = useCallback(async (sector: string, market: "domestic" | "global", subQuery?: string, etfFullName?: string, parentTicker?: string) => {
    // 진행 중인 이전 요청 취소 — 빠른 ETF 전환 시 구형 네트워크 I/O 정리
    relatedAbortRef.current?.abort();
    const ctrl = new AbortController();
    relatedAbortRef.current = ctrl;

    const fetchId = ++relatedFetchIdRef.current;
    setIsLoadingRelated(true);
    setRelatedCompanies([]);
    setRelatedSortFilter("theme"); // 새 ETF 로드 시 정렬 초기화
    try {
      const keyword = deriveSearchKeyword(sector, market);
      const mkt = market === "domestic" ? "kr" : "en";
      const params = new URLSearchParams({ keyword, count: "10", market: mkt });
      if (parentTicker) params.set("ticker", parentTicker);
      if (subQuery) params.set("subQuery", subQuery);
      if (etfFullName) params.set("etfFullName", etfFullName);
      const res = await fetch(`/api/related-companies?${params}`, { signal: ctrl.signal });
      if (res.ok && fetchId === relatedFetchIdRef.current) {
        const json = (await res.json()) as { companies: RelatedCompany[] };
        setRelatedCompanies(json.companies ?? []);
      }
    } catch (err) {
      // AbortError: 새 요청이 이 요청을 대체한 정상 취소 — loading 상태는 새 요청이 관리
      if ((err as { name?: string })?.name === 'AbortError') return;
    }
    if (fetchId === relatedFetchIdRef.current) {
      setIsLoadingRelated(false);
    }
  }, []);

  // 정렬 탭 전환 — 선택 해제 + 150ms 트랜지션 스피너
  const handleSortChange = useCallback((sort: RelatedSortFilter) => {
    if (sort === relatedSortFilter) return;
    setIsSortTransitioning(true);
    setRelatedSortFilter(sort);
    setSelectedCompanyIdx(null);
    setCompanyMetrics(null);
    setTimeout(() => setIsSortTransitioning(false), 150);
  }, [relatedSortFilter]);

  // 딥다이브 모달 열기 — proxy-finance/뉴스는 modalFocusTicker useEffect가 담당
  const openModal = useCallback(async (item: TickerItem) => {
    const initMarket: "domestic" | "global" = item.isGlobal ? "global" : "domestic";
    setModalTicker(item.ticker);
    setModalSector(item.sector);
    setModalIsGlobal(item.isGlobal);
    setModalMeta(null);
    setIsLoadingModal(true);
    setSelectedCompanyIdx(null);
    setCompanyMetrics(null);
    setRelatedMarket(initMarket);
    setEtfOfficialName(undefined);
    setStockNews([]);
    // 잔상 방지: 모달 교체 즉시 이전 관련주 목록 초기화 — fetch 시작 전 한 frame 갭 차단
    setRelatedCompanies([]);
    setIsLoadingRelated(true);
    setRelatedSortFilter("theme");
    // modalFocusTicker를 ETF 티커로 초기화 → useEffect 트리거 → proxy-finance + 뉴스 로드
    setModalFocusTicker(item.ticker);
    // 관련주는 별도 로드 (이쪽은 isLoadingRelated로 관리)
    await fetchRelatedCompanies(item.sector, initMarket, undefined, undefined, item.ticker);
  }, [fetchRelatedCompanies]);

  const closeModal = useCallback(() => {
    // 모달 닫힐 때 진행 중인 관련주 요청 즉시 취소 — 상태 유실 방지
    relatedAbortRef.current?.abort();
    relatedAbortRef.current = null;
    setIsLoadingRelated(false);
    setModalTicker(null);
    setModalFocusTicker(null);
    setModalMeta(null);
    setEtfOfficialName(undefined);
    setSelectedCompanyIdx(null);
    setCompanyMetrics(null);
    setStockNews([]);
    setRelatedSortFilter("theme");
    setRelatedCompanies([]);
  }, []);

  // 관련 기업 행 클릭 → 좌측 패널을 해당 기업으로 전환 + 실무 지표 로드
  const handleCompanyClick = useCallback(async (company: RelatedCompany, idx: number) => {
    if (selectedCompanyIdx === idx) {
      // 동일 행 재클릭 → 선택 해제, 좌측 패널을 부모 ETF로 복원
      setSelectedCompanyIdx(null);
      setCompanyMetrics(null);
      setModalFocusTicker(modalTicker);
      return;
    }
    setSelectedCompanyIdx(idx);
    setCompanyMetrics(null);
    setIsLoadingCompanyMetrics(true);
    // 좌측 패널 포커스를 선택 기업으로 전환 (useEffect가 proxy-finance + 뉴스 재호출)
    setModalFocusTicker(company.symbol);
    try {
      const res = await fetch(`/api/stock-metrics?ticker=${encodeURIComponent(company.symbol)}`);
      if (res.ok) setCompanyMetrics((await res.json()) as CompanyMetrics);
    } catch {}
    setIsLoadingCompanyMetrics(false);
  }, [selectedCompanyIdx, modalTicker]);

  // 관련주 검색 race condition 방지 — 토글 빠른 전환 시 구형 응답 폐기용
  const relatedFetchIdRef = useRef(0);
  // AbortController ref — 새 요청 시 진행 중인 구형 네트워크 요청 취소
  const relatedAbortRef = useRef<AbortController | null>(null);

  // stale-closure 방지용 ref — 렌더 시점에 동기 갱신 (useEffect 패턴 대비 1 tick 빠름)
  const sellAssetsRef = useRef(rebalancingSellAssets);
  const portfolioRef = useRef(portfolioAssets);
  const analysisRef = useRef(analysisResult);
  const tMarginalRef = useRef(tMarginal);
  const formDataRef = useRef(formData);
  const selectedCustomerRef = useRef(selectedCustomer);
  const pbOrderRowsRef = useRef<PbOrderRow[]>(pbOrderRows);
  const usdKrwRateRef = useRef<number>(usdKrwRate);
  sellAssetsRef.current = rebalancingSellAssets;
  portfolioRef.current = portfolioAssets;
  analysisRef.current = analysisResult;
  tMarginalRef.current = tMarginal;
  formDataRef.current = formData;
  selectedCustomerRef.current = selectedCustomer;
  pbOrderRowsRef.current = pbOrderRows;
  usdKrwRateRef.current = usdKrwRate;

  // PB 행별 검색 상태 (로딩/오류) — 컴포넌트 로컬, Context 비동기 업데이트와 분리
  const [pbSearchState, setPbSearchState] = useState<Record<string, { loading: boolean; error: string | null }>>({});
  const pbSearchTimersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  // modalFocusTicker 변경 시 좌측 패널 데이터(가격차트 + 뉴스) 동적 재로드
  // 포커스가 부모 ETF면 ETF용 productType, 개별 기업이면 KR/EN 주식 분기
  useEffect(() => {
    if (!modalFocusTicker) return;
    let cancelled = false;

    const isKrTicker = modalFocusTicker.endsWith('.KS') || modalFocusTicker.endsWith('.KQ');
    const isEtfFocus = modalFocusTicker === modalTicker;
    const productType = isEtfFocus
      ? (modalIsGlobal ? '해외ETF' : '국내ETF')
      : isKrTicker ? '국내주식' : '해외주식';

    setIsLoadingModal(true);
    setModalMeta(null);
    setIsLoadingNews(true);
    setStockNews([]);

    // 차트·가격 데이터 (proxy-finance) — 개별 완료 시 즉시 반영
    fetch(`/api/proxy-finance?assetName=${encodeURIComponent(modalFocusTicker)}&productType=${encodeURIComponent(productType)}`)
      .then(async (r) => {
        if (cancelled || !r.ok) return;
        const data = (await r.json()) as Record<string, unknown>;
        if (cancelled) return;
        setModalMeta(data);
        // ETF 공식명은 부모 ETF 로드 시에만 저장 (기업 포커스 전환 시 헤더 불변)
        if (isEtfFocus) setEtfOfficialName(data.officialName as string | undefined);
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setIsLoadingModal(false); });

    // 섹터/테마 키워드 — 티커 기반 뉴스 실패 시 백엔드 테마 폴백에 전달
    const themeKeyword = isKrTicker
      ? (THEME_KEYWORDS_MAP[modalSector]?.kr ?? modalSector)
      : (THEME_KEYWORDS_MAP[modalSector]?.en ?? modalSector);

    // 뉴스 피드 (/api/stock-news) — 차트와 독립적으로 완료 시 반영
    fetch(`/api/stock-news?ticker=${encodeURIComponent(modalFocusTicker)}&keyword=${encodeURIComponent(themeKeyword)}`)
      .then(async (r) => {
        if (cancelled || !r.ok) return;
        const data = (await r.json()) as { items: StockNewsItem[] };
        if (!cancelled) setStockNews(data.items ?? []);
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setIsLoadingNews(false); });

    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modalFocusTicker, modalTicker, modalIsGlobal, modalSector]);

  // ETF 공식명 로드 완료 시 특수 마켓 감지 → 정밀 재요청
  // - 원유("Oil"/"원유"/"WTI"): subQuery="정유" + etfFullName으로 글로벌 정유주 타겟팅
  // - KOSDAQ("코스닥"/"KOSDAQ"): etfFullName으로 백엔드 .KQ 격리 가드 활성화
  useEffect(() => {
    if (!etfOfficialName || !modalTicker) return;
    const isOil    = /oil|원유|wti/i.test(etfOfficialName);
    const isKosdaq = /코스닥|kosdaq/i.test(etfOfficialName);
    if (isOil) {
      fetchRelatedCompanies(modalSector, relatedMarket, "정유", etfOfficialName, modalTicker ?? undefined);
    } else if (isKosdaq) {
      fetchRelatedCompanies(modalSector, relatedMarket, undefined, etfOfficialName, modalTicker ?? undefined);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [etfOfficialName, modalTicker]);

  // USD/KRW 실시간 환율 — 마운트 시 1회 조회 (proxy-finance directTicker 경로)
  // 6개월 범위 일별 데이터 요청 → meta.regularMarketPrice = 현재 환율
  useEffect(() => {
    const today = new Date().toISOString().slice(0, 10);
    const sixMonthsAgo = new Date(Date.now() - 180 * 86_400_000).toISOString().slice(0, 10);
    fetch(`/api/proxy-finance?ticker=USDKRW%3DX&startDate=${sixMonthsAgo}&endDate=${today}`)
      .then(async (r) => {
        if (!r.ok) return;
        const data = (await r.json()) as Record<string, unknown>;
        const meta = (
          (data?.chart as Record<string, unknown> | undefined)
            ?.result as Record<string, unknown>[] | undefined
        )?.[0]?.meta as Record<string, unknown> | undefined;
        const rate = typeof meta?.regularMarketPrice === "number" ? meta.regularMarketPrice : null;
        if (rate !== null && rate > 100) setUsdKrwRate(rate);
      })
      .catch(() => {});
  }, []);

  // 매수 확정 — PB 직접 추가 매수 전용 (ETF 카탈로그 비개입)
  // PB 패널 내부 확정 — rebalancingSellAssets만 업데이트 (Tab 4 미반영)
  const handlePbConfirm = useCallback(() => {
    const validPbRows = pbOrderRowsRef.current.filter((r) => {
      if (isBondProductType(r.productType)) {
        return computeKrwAmount(r, usdKrwRateRef.current) > 0;
      }
      const qty = parseFloat(r.quantity);
      return Number.isFinite(qty) && qty > 0 && (r.currentPrice ?? 0) > 0;
    });
    if (!validPbRows.length) return;

    const mergeBase = sellAssetsRef.current.length > 0 ? sellAssetsRef.current : portfolioRef.current;
    const remainingAssets = mergeBase.filter((a) => a.amount > 0);
    const mergedAssets = mergeBuyIntoBase(remainingAssets, validPbRows, [], usdKrwRateRef.current);
    setRebalancingSellAssets(mergedAssets);

    const totalCost = validPbRows.reduce((s, r) => s + computeKrwAmount(r, usdKrwRateRef.current), 0);
    if (totalCost > 0) addBuyCost(totalCost);

    setPbOrderRows([]);
  }, [setRebalancingSellAssets, setPbOrderRows, addBuyCost]);

  const handleConfirm = useCallback(async () => {
    const validPbRows = pbOrderRowsRef.current.filter((r) => {
      if (isBondProductType(r.productType)) {
        return computeKrwAmount(r, usdKrwRateRef.current) > 0;
      }
      const qty = parseFloat(r.quantity);
      return Number.isFinite(qty) && qty > 0 && (r.currentPrice ?? 0) > 0;
    });
    // PB 행이 없어도 드래그앤드롭·PB버튼으로 확정된 자산이 있으면 분석 진행
    // 비동기 실행 중 고객 전환 race condition 방지 — await 전에 스냅샷
    const customerAtStart = selectedCustomerRef.current;
    setIsConfirming(true);
    try {
      const { runAnalysis } = await import("@/lib/portfolioLogic");
      const tm = tMarginalRef.current;
      const fd = formDataRef.current;

      const mergeBase =
        sellAssetsRef.current.length > 0
          ? sellAssetsRef.current
          : portfolioRef.current;
      const remainingAssets = mergeBase.filter((a) => a.amount > 0);

      // 잔여 PB 행 병합 (handlePbConfirm으로 이미 처리된 경우 validPbRows = [])
      const mergedAssets = validPbRows.length > 0
        ? mergeBuyIntoBase(remainingAssets, validPbRows, [], usdKrwRateRef.current)
        : remainingAssets;

      setRebalancingBuyAssets(mergedAssets);

      const result = await runAnalysis(mergedAssets, {
        tMarginal: tm,
        expectedInterestIncome: fd.rrttllu.expectedInterestIncome,
        expectedDividendIncome: fd.rrttllu.expectedDividendIncome,
      });

      // 분석 완료 전 고객 전환이 발생했으면 결과를 버림 — 잘못된 고객에게 덮어쓰기 방지
      if (selectedCustomerRef.current !== customerAtStart) return;

      if (result) {
        confirmRebalancingBuy();
        setNewPortfolioAnalysisResult(result);

        // enrichedAssets의 dividendYield를 mergedAssets에 반영 → PensionTaxPanel 연동
        const enrichedArr = result.enrichedAssets ?? [];
        const mergedWithDividends = mergedAssets.map((a, i) => {
          const ea = enrichedArr[i] as unknown as Record<string, unknown>;
          if (!ea) return a;
          const aExt = a as unknown as Record<string, unknown>;
          const patch: Record<string, unknown> = {};
          if (ea.dividendYield != null && aExt.dividendYield == null) patch.dividendYield = ea.dividendYield;
          if (ea.trailingAnnualDividendRate != null && aExt.trailingAnnualDividendRate == null) patch.trailingAnnualDividendRate = ea.trailingAnnualDividendRate;
          return Object.keys(patch).length ? { ...a, ...patch } : a;
        });
        try {
          localStorage.setItem("new-portfolio-assets-v1", JSON.stringify(mergedWithDividends));
          window.dispatchEvent(new CustomEvent("portfolio-result-updated"));
        } catch {}
        if (mergedWithDividends.some((a, i) => a !== mergedAssets[i])) {
          setRebalancingBuyAssets(mergedWithDividends as typeof mergedAssets);
        }

        // 보유 자산 카드 그리드를 병합 결과로 즉시 동기화
        // (재분석 시 clearSellHistory가 portfolioAssets로 롤백하여 원본 보존)
        setRebalancingSellAssets(mergedAssets);

        const assetsForCalc: AssetForIncomeCalc[] = (
          result.enrichedAssets ?? []
        )
          .map((a) => {
            const isBond =
              a.productType === "국내채권" || a.productType === "해외채권";
            const resolvedName =
              a.name || (isBond ? (a.productType ?? "채권") : "");
            if (!resolvedName) return null;
            const interestRate =
              a.bond_yield != null && a.bond_yield > 0
                ? a.bond_yield / 100
                : undefined;
            const enriched = a as unknown as Record<string, unknown>;
            return {
              name: resolvedName,
              ticker: a.ticker ?? "",
              asset_class: a.asset_class,
              productType: a.productType,
              country: a.country,
              current_price: a.current_price,
              current_value: a.current_value,
              amount: a.amount,
              amount_type: a.amount_type,
              buy_price: isBond ? a.buy_price : undefined,
              dividendYield: enriched.dividendYield as number | undefined,
              interestRate,
            } as AssetForIncomeCalc;
          })
          .filter((x): x is AssetForIncomeCalc => x !== null);

        if (assetsForCalc.length > 0) {
          const originalEnrichedMap = new Map(
            (analysisRef.current?.enrichedAssets ?? []).map((e) => [
              `${e.name ?? ""}::${e.ticker ?? ""}`,
              e as Record<string, unknown>,
            ]),
          );
          const keepSet = new Set(
            sellAssetsRef.current.map(
              (a) => `${a.name ?? ""}::${a.ticker ?? ""}`,
            ),
          );
          const soldAssets = portfolioRef.current.filter(
            (a) => !keepSet.has(`${a.name ?? ""}::${a.ticker ?? ""}`),
          );

          const soldAssetsForCalc: AssetForIncomeCalc[] = soldAssets
            .map((a) => {
              const isBond =
                a.productType === "국내채권" || a.productType === "해외채권";
              const resolvedName =
                a.name || (isBond ? (a.productType ?? "채권") : "");
              if (!resolvedName) return null;
              const key = `${a.name ?? ""}::${a.ticker ?? ""}`;
              const enriched = originalEnrichedMap.get(key);
              return {
                name: resolvedName,
                ticker: a.ticker ?? "",
                asset_class: a.asset_class,
                productType: a.productType,
                country: a.country,
                current_price:
                  (enriched?.current_price as number | undefined) ??
                  a.current_price,
                current_value:
                  (enriched?.current_value as number | undefined) ??
                  a.current_value,
                amount: a.amount,
                amount_type: a.amount_type,
                buy_price: a.buy_price,
                dividendYield: undefined,
                interestRate: undefined,
              } as AssetForIncomeCalc;
            })
            .filter((x): x is AssetForIncomeCalc => x !== null);

          const originalAmountMap = new Map(
            portfolioRef.current.map((a) => [
              `${a.name ?? ""}::${a.ticker ?? ""}`,
              a,
            ]),
          );
          const partiallySoldForCalc: AssetForIncomeCalc[] =
            sellAssetsRef.current
              .map((a) => {
                if (a.amount_type !== "quantity") return null;
                const isBond =
                  a.productType === "국내채권" ||
                  a.productType === "해외채권";
                if (isBond) return null;
                const resolvedName = a.name || "";
                if (!resolvedName) return null;
                const key = `${a.name ?? ""}::${a.ticker ?? ""}`;
                const original = originalAmountMap.get(key);
                const enriched = originalEnrichedMap.get(key);
                if (
                  !original ||
                  original.amount_type !== "quantity" ||
                  original.buy_price == null
                )
                  return null;
                const soldAmount = original.amount - a.amount;
                if (soldAmount <= 0) return null;
                return {
                  name: resolvedName,
                  ticker: a.ticker ?? "",
                  asset_class: a.asset_class,
                  productType: a.productType,
                  country: a.country,
                  current_price:
                    (enriched?.current_price as number | undefined) ??
                    a.current_price,
                  current_value: undefined,
                  amount: soldAmount,
                  amount_type: "quantity" as const,
                  buy_price: original.buy_price,
                  dividendYield: undefined,
                  interestRate: undefined,
                } as AssetForIncomeCalc;
              })
              .filter((x): x is AssetForIncomeCalc => x !== null);

          const combinedForCalc = [
            ...soldAssetsForCalc,
            ...partiallySoldForCalc,
            ...assetsForCalc,
          ];
          const newTaxSummary = calcFinancialIncomeSummary(
            combinedForCalc,
            tm,
          );
          try {
            localStorage.setItem(
              NEW_PORTFOLIO_INCOME_STORAGE_KEY,
              JSON.stringify(newTaxSummary),
            );
            window.dispatchEvent(
              new CustomEvent("new-financial-income-updated"),
            );
          } catch {
            // localStorage 실패 무시
          }
          saveTaxSummary("new", newTaxSummary);
        }
        setConfirmDone(true);
      }
    } catch (err) {
      console.error("[BuySimulatorTab] 매수 확정 오류:", err);
    } finally {
      setIsConfirming(false);
    }
  }, [
    setRebalancingBuyAssets,
    setRebalancingSellAssets,
    confirmRebalancingBuy,
    setNewPortfolioAnalysisResult,
    saveTaxSummary,
  ]);

  // ── 모달 차트 데이터 ─────────────────────────────────────────────────────

  const modalChartData = useMemo(() => {
    if (!modalMeta) return [];
    const chartResult = (
      modalMeta?.chart as Record<string, unknown> | undefined
    )?.result as Record<string, unknown>[] | undefined;
    const r0 = chartResult?.[0];
    const timestamps = (r0?.timestamp as number[] | undefined) ?? [];
    const closes =
      (
        (r0?.indicators as Record<string, unknown> | undefined)
          ?.quote as Record<string, unknown>[] | undefined
      )?.[0]?.close as (number | null)[] | undefined ?? [];
    return timestamps
      .map((ts, i) => ({
        date: new Date(ts * 1000).toLocaleDateString("ko-KR", {
          month: "short",
          day: "numeric",
        }),
        price: closes[i] ?? null,
      }))
      .filter((d): d is { date: string; price: number } => d.price !== null);
  }, [modalMeta]);

  const modalCurrentPrice = useMemo(() => {
    const meta = (
      (modalMeta?.chart as Record<string, unknown> | undefined)
        ?.result as Record<string, unknown>[] | undefined
    )?.[0]?.meta as Record<string, unknown> | undefined;
    return (meta?.regularMarketPrice as number | undefined) ?? null;
  }, [modalMeta]);

  const modalCurrency = useMemo(() => {
    const meta = (
      (modalMeta?.chart as Record<string, unknown> | undefined)
        ?.result as Record<string, unknown>[] | undefined
    )?.[0]?.meta as Record<string, unknown> | undefined;
    return (meta?.currency as string | undefined) ?? "USD";
  }, [modalMeta]);

  const modalDividendYield = modalMeta?.dividendYield as number | undefined;

  // ETF 전략 설명 (섹터명 기반 자동 생성)
  const modalStrategy = modalSector
    ? `${modalSector} 섹터 ETF — AI 분산 최적화 포트폴리오 편입 종목`
    : null;

  // ── 전략 카드 순서 (고객 성향 전략 우선) ────────────────────────────────

  const orderedStrategies = useMemo<Strategy[]>(
    () => [
      defaultStrategy,
      ...ALL_STRATEGIES.filter((s) => s !== defaultStrategy),
    ],
    [defaultStrategy],
  );

  const hasPbItems = pbOrderRows.some((r) => {
    if (isBondProductType(r.productType)) {
      return computeKrwAmount(r, usdKrwRate) > 0;
    }
    const qty = parseFloat(r.quantity);
    return Number.isFinite(qty) && qty > 0 && (r.currentPrice ?? 0) > 0;
  });
  // PB 패널 항목이 있거나, 드래그앤드롭/PB버튼으로 이미 확정된 매수가 있으면 활성화
  const canConfirm = (hasPbItems || confirmedPbAmount > 0) && !isOverBudget;

  // ── 렌더 ─────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col gap-5">

      {/* ── 레이어 1: 가용 자금 전광판 (클라이언트 숨김) ─────────── */}
      <div className="hidden rounded-xl border border-slate-200 bg-gradient-to-br from-[#2f2f9d] to-[#4a4ab8] p-4 text-white shadow-soft">
        <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-white/60">
          <DollarSign size={13} />
          Buying Power — 가용 투자 자금
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="rounded-lg bg-white/10 p-3">
            <div className="text-[10px] text-white/60">총 가용 자금 (d)</div>
            <div className="mt-1 truncate text-base font-bold">
              {availableInvestmentFunds !== null
                ? fmtKrwMan(availableInvestmentFunds)
                : "산출 전"}
            </div>
            <div className="text-[10px] text-white/40">b + (a − c)</div>
          </div>
          <div className="rounded-lg bg-white/10 p-3">
            <div className="text-[10px] text-white/60">배분 예정</div>
            <div className="mt-1 truncate text-base font-bold">
              {fmtKrwMan(totalAllocated)}
            </div>
            <div className="text-[10px] text-white/40">ETF + 직접 매수 합계</div>
          </div>
          <div className="rounded-lg bg-white/10 p-3">
            <div className="text-[10px] text-white/60">가용 추가 자금</div>
            <div className="mt-1 truncate text-base font-bold">
              {fmtKrwMan(remaining)}
            </div>
            <div className="text-[10px] text-white/40">미배분 잔액</div>
          </div>
          <div
            className={`rounded-lg p-3 ${isOverBudget ? "bg-red-500/30" : "bg-white/10"}`}
          >
            <div className="text-[10px] text-white/60">잔여 자금</div>
            <div
              className={`mt-1 truncate text-base font-bold ${isOverBudget ? "text-red-200" : ""}`}
            >
              {fmtKrwMan(remaining)}
            </div>
            {isOverBudget ? (
              <div className="mt-0.5 flex items-center gap-1 text-[10px] text-red-200">
                <AlertTriangle size={9} />
                예산 초과
              </div>
            ) : (
              <div className="text-[10px] text-white/40">미배분 잔액</div>
            )}
          </div>
        </div>
      </div>

      {/* ── 보유 자산 (드롭 존) ──────────────────────────────────────── */}
      {baseAssets.length === 0 ? (
        <div className="flex min-h-[160px] items-center justify-center rounded-lg border border-dashed border-slate-200 bg-slate-50">
          <p className="text-sm font-semibold text-slate-400">
            TAB 2-1에서 자산을 입력하고 분석 실행 후 이 화면으로 돌아오세요.
          </p>
        </div>
      ) : (
        <section
          className={`rounded-xl border-2 bg-white p-5 shadow-soft transition-colors ${isDragOver ? "border-blue-400 bg-blue-50" : "border-slate-200"}`}
          onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
          onDragLeave={() => setIsDragOver(false)}
          onDrop={handleDrop}
        >
          <p className="mb-3 text-[10px] font-extrabold uppercase tracking-widest text-slate-400">
            보유 자산{isDragOver && <span className="ml-2 text-blue-500">여기에 드롭하세요</span>}
          </p>
          <div className="flex flex-col gap-3">
            {groupedAssetCards.map((group, gi) => (
              <div key={gi} className="flex flex-wrap gap-2">
                {group.assets.map((a) => {
                  const cls = normalizeAssetClass(a.asset_class ?? a.productType ?? "기타");
                  const color = CLASS_COLORS[cls] ?? "#94a3b8";
                  const key = makeAssetKey(a);
                  const isSoldOut = a.amount_type === "quantity" && a.amount <= 0;
                  const cp = getEffectiveAssetPrice(a);
                  const val = getEffectiveAssetValue(a);
                  const bp = Number(a.buy_price);
                  const gainPct = cp > 0 && bp > 0 ? ((cp - bp) / bp) * 100 : null;
                  const origAsset = portfolioAssets.find((pa) => isSameAsset(pa, a.name, a.ticker));
                  const isNewBuy = !isSoldOut && !origAsset;
                  const addedQty =
                    !isNewBuy &&
                    !isSoldOut &&
                    origAsset &&
                    a.amount_type === "quantity"
                      ? a.amount - origAsset.amount
                      : null;
                  return (
                    <div
                      key={key}
                      className={`relative flex flex-col gap-1 rounded-xl border-2 px-4 py-3 text-left ${isSoldOut ? "opacity-50" : ""}`}
                      style={{
                        width: "160px",
                        flexShrink: 0,
                        borderColor: isSoldOut ? "#cbd5e1" : color + "55",
                        backgroundColor: isSoldOut ? "#f8fafc" : "#ffffff",
                      }}
                    >
                      {isNewBuy && (
                        <span className="absolute right-3 -top-2.5 z-10 rounded bg-red-500 px-1.5 py-0.5 text-[9px] font-bold leading-none text-white shadow-sm ring-1 ring-white">
                          신규 매수
                        </span>
                      )}
                      {addedQty !== null && addedQty > 0 && (
                        <span className="absolute right-3 -top-2.5 z-10 rounded bg-red-500 px-1.5 py-0.5 text-[9px] font-bold leading-none text-white shadow-sm ring-1 ring-white">
                          {addedQty.toLocaleString()}주 추가 매수
                        </span>
                      )}
                      {isSoldOut ? (
                        <span className="inline-block self-start rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-bold leading-none text-red-600">
                          완전 매도
                        </span>
                      ) : (
                        <span
                          className="inline-block self-start rounded-full px-2 py-0.5 text-[10px] font-bold leading-none"
                          style={{ backgroundColor: color + "22", color }}
                        >
                          {a.productType ?? cls}
                        </span>
                      )}
                      <span className={`mt-1 w-full truncate text-sm font-bold leading-tight ${isSoldOut ? "text-slate-400 line-through" : "text-navy"}`}>
                        {formatLocalTickerName(a.name, a.ticker, portfolioAssets)}
                      </span>
                      <span className="text-[10px] text-slate-500">
                        현재가 {cp > 0 ? formatKrwAmount(cp) : "—"}
                      </span>
                      <span className={`text-xs font-bold ${isSoldOut ? "text-slate-400" : "text-slate-700"}`}>
                        {isSoldOut ? "—" : val > 0 ? formatKrwAmount(val) : "—"}
                      </span>
                      {gainPct !== null && !isSoldOut && (
                        <span className={`text-[10px] font-semibold ${gainPct >= 0 ? "text-emerald-600" : "text-red-500"}`}>
                          {gainPct >= 0 ? "▲" : "▼"} {Math.abs(gainPct).toFixed(1)}%
                        </span>
                      )}
                      <span className={`text-[10px] ${isSoldOut ? "font-bold text-red-500" : "text-slate-400"}`}>
                        {a.amount_type === "quantity"
                          ? isSoldOut
                            ? "0주 (매도 완료)"
                            : `${a.amount.toLocaleString()}주`
                          : "평가액 기준"}
                      </span>
                      {!isSoldOut && a.amount_type === "quantity" && a.amount > 0 && (
                        <button
                          type="button"
                          onClick={() => handleSellCard(makeAssetKey(a))}
                          className="mt-1 w-full rounded border border-red-200 bg-red-50 py-0.5 text-[10px] font-bold text-red-500 hover:bg-red-100"
                        >
                          매도
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ── 레이어 3: 추천 종목 그리드 (섹터 카테고리별 정렬 + 컬러) ─── */}
      <div className="rounded-xl border border-slate-200 bg-white shadow-soft">
        <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
          <div className="flex items-center gap-2">
            <CheckCircle2 size={16} className="text-emerald-600" />
            <span className="text-sm font-bold text-navy">
              선택한 종목
            </span>
          </div>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center gap-2 py-10 text-sm text-slate-400">
            <Loader2 size={16} className="animate-spin" />
            AI 포트폴리오 산출 중…
          </div>
        ) : sortedTickerItems.length === 0 ? (
          <div className="py-10 text-center text-sm text-slate-400">
            추천 종목이 없습니다.
          </div>
        ) : (
          <div className="divide-y divide-slate-50">
            {sortedTickerItems.map((item) => {
              const isChecked = item.checked;

              return (
                <div
                  key={`${item.ticker}-${item.originalIdx}`}
                  draggable
                  onDragStart={() => setDraggedTicker(item)}
                  onDragEnd={() => setDraggedTicker(null)}
                  className={`flex cursor-grab items-center gap-3 px-4 py-3 transition hover:bg-slate-50 active:cursor-grabbing ${
                    isChecked ? "" : "opacity-45"
                  }`}
                  onClick={() => toggleCheck(item.originalIdx)}
                >
                  <input
                    type="checkbox"
                    checked={isChecked}
                    onChange={() => toggleCheck(item.originalIdx)}
                    onClick={(e) => e.stopPropagation()}
                    className="h-4 w-4 flex-shrink-0 cursor-pointer rounded accent-[#2f2f9d]"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-bold text-slate-800">
                      {item.sector}
                    </p>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5">
                      <span className="rounded border border-gray-200 bg-gray-50 px-1.5 py-0.5 font-mono text-[10px] text-gray-600">
                        {item.ticker}
                      </span>
                      <span
                        className={`rounded border px-1.5 py-0.5 text-[10px] ${
                          item.isGlobal
                            ? "border-emerald-100 bg-emerald-50 text-emerald-600"
                            : "border-blue-100 bg-blue-50 text-blue-600"
                        }`}
                      >
                        {item.isGlobal ? "해외 ETF" : "국내 ETF"}
                      </span>
                      {(tickerTopNames.get(item.ticker) ?? []).map((name) => (
                        <span key={name} className="text-[10px] text-slate-400">
                          #{name}
                        </span>
                      ))}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      openModal({
                        ticker: item.ticker,
                        sector: item.sector,
                        weight: item.weight,
                        checked: item.checked,
                        customAmountStr: item.customAmountStr,
                        isGlobal: item.isGlobal,
                      });
                    }}
                    className="flex-shrink-0 flex items-center gap-1 rounded-md border border-slate-200 px-2 py-1.5 text-slate-400 transition hover:bg-slate-50 hover:text-navy"
                    title="딥다이브 분석"
                  >
                    <Info size={13} />
                    <span className="text-[10px] font-medium whitespace-nowrap">관련 개별종목 보기</span>
                  </button>
                </div>
              );
            })}
          </div>
        )}

      </div>

      {/* ── 매수 확정 종목 삭제 확인 모달 ──────────────────────────────────── */}
      {deleteConfirmId && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={cancelDeletePbRow}
        >
          <div
            className="w-80 rounded-2xl bg-white p-6 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="mb-1 text-center text-sm font-bold text-slate-800">
              매수 확정 종목 삭제
            </p>
            <p className="mb-5 text-center text-xs text-slate-500 leading-relaxed">
              해당 종목은 이미 신규 포트폴리오에 반영되었습니다.<br />
              시뮬레이션 데이터에서 삭제(되돌리기)하시겠습니까?
            </p>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={cancelDeletePbRow}
                className="flex-1 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-bold text-slate-600 hover:bg-slate-50"
              >
                취소
              </button>
              <button
                type="button"
                onClick={confirmDeletePbRow}
                className="flex-1 rounded-xl bg-red-500 px-4 py-2.5 text-sm font-bold text-white hover:bg-red-600"
              >
                삭제
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── 드래그 앤 드롭 매수/매도 모달 ──────────────────────────────── */}
      {dropModal && (() => {
        const productType = dropModal.isGlobal ? "해외ETF" : "국내ETF";
        const krwPrice = dropModal.price !== null
          ? (dropModal.currency === "USD" ? dropModal.price * usdKrwRate : dropModal.price)
          : null;
        const dropQty = parseFloat(dropModal.qtyStr) || 0;
        const dropCost = krwPrice !== null && dropQty > 0 ? dropQty * krwPrice : 0;
        const avail = availableInvestmentFunds ?? 0;
        const dropOverBudget = dropModal.mode === "buy" && avail > 0 && dropCost > avail;
        const maxDropQty = dropModal.mode === "buy" && krwPrice && krwPrice > 0 && avail > 0
          ? Math.floor(avail / krwPrice)
          : null;
        // 포트폴리오에 이미 있으면 매도도 가능
        const existingAsset = rebalancingSellAssets.find(
          (a) => (a.ticker ?? "").toLowerCase() === dropModal.ticker.toLowerCase() && a.amount > 0,
        );
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setDropModal(null)}>
            <div className="w-96 rounded-2xl bg-white p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
              <p className="mb-1 text-center text-sm font-bold text-slate-800">
                {dropModal.sector}
              </p>
              <p className="mb-3 text-center font-mono text-xs text-slate-500">
                {dropModal.ticker} · {productType}
              </p>

              {/* 매수/매도 모드 토글 */}
              <div className="mb-4 flex rounded-lg border border-slate-200 p-0.5">
                <button type="button"
                  onClick={() => setDropModal((p) => p ? { ...p, mode: "buy", qtyStr: "" } : null)}
                  className={`flex-1 rounded-md py-2 text-sm font-bold transition ${dropModal.mode === "buy" ? "bg-emerald-600 text-white shadow-sm" : "text-slate-500 hover:text-navy"}`}>
                  매수
                </button>
                <button type="button"
                  disabled={!existingAsset}
                  onClick={() => setDropModal((p) => p ? { ...p, mode: "sell", qtyStr: "" } : null)}
                  className={`flex-1 rounded-md py-2 text-sm font-bold transition disabled:opacity-30 ${dropModal.mode === "sell" ? "bg-samsung text-white shadow-sm" : "text-slate-500 hover:text-navy"}`}>
                  매도 {!existingAsset && "(미보유)"}
                </button>
              </div>

              {dropModal.isLoadingPrice ? (
                <div className="flex items-center justify-center gap-2 py-4 text-sm text-slate-400">
                  <Loader2 size={14} className="animate-spin" />
                  가격 조회 중…
                </div>
              ) : (
                <>
                  {krwPrice !== null && (
                    <p className="mb-3 text-center text-xs text-slate-500">
                      현재가: <span className="font-bold text-navy">{fmtKrwMan(krwPrice)}</span>
                      {dropModal.currency === "USD" && (
                        <span className="ml-1 text-slate-400">
                          (${dropModal.price?.toFixed(2)} · @{usdKrwRate.toLocaleString("ko-KR", { maximumFractionDigits: 0 })}원)
                        </span>
                      )}
                    </p>
                  )}

                  <div className="mb-3 flex items-center gap-2">
                    <input
                      type="number"
                      min={1}
                      max={dropModal.mode === "buy" ? (maxDropQty ?? undefined) : (existingAsset?.amount ?? undefined)}
                      value={dropModal.qtyStr}
                      onChange={(e) => {
                        const n = parseFloat(e.target.value);
                        const cap = dropModal.mode === "buy" ? maxDropQty : (existingAsset?.amount ?? null);
                        if (cap !== null && Number.isFinite(n) && n > cap) {
                          setDropModal((p) => p ? { ...p, qtyStr: String(cap) } : null);
                          return;
                        }
                        setDropModal((p) => p ? { ...p, qtyStr: e.target.value } : null);
                      }}
                      placeholder="수량 입력"
                      className={`flex-1 rounded-xl border px-3 py-2 text-center text-sm font-bold text-navy outline-none ${
                        dropOverBudget ? "border-red-400 bg-red-50 focus:border-red-500" : "border-slate-300 focus:border-emerald-400"
                      }`}
                      autoFocus
                    />
                    <span className="text-xs text-slate-500">주</span>
                  </div>

                  {dropQty > 0 && krwPrice !== null && (
                    <div className={`mb-3 rounded-lg px-3 py-2 text-xs ${dropOverBudget ? "bg-red-50 text-red-700" : "bg-emerald-50 text-slate-600"}`}>
                      <div>
                        {dropModal.mode === "buy" ? "매수 예정" : "매도 예정"}:{" "}
                        <span className={`font-black ${dropOverBudget ? "text-red-600" : "text-emerald-700"}`}>
                          {fmtKrwMan(dropCost)}
                        </span>
                        {dropOverBudget && <span className="ml-1 font-bold text-red-500">— 가용 자금 초과!</span>}
                      </div>
                      {dropModal.mode === "buy" && (
                        <div className={`mt-0.5 text-[10px] ${dropOverBudget ? "text-red-400" : "text-slate-400"}`}>
                          잔여 가용: {fmtKrwMan(avail - dropCost)}
                          {maxDropQty !== null && <span className="ml-1">(최대 {maxDropQty.toLocaleString()}주)</span>}
                        </div>
                      )}
                    </div>
                  )}
                </>
              )}

              <div className="flex gap-3">
                <button type="button" onClick={() => setDropModal(null)}
                  className="flex-1 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-bold text-slate-600 hover:bg-slate-50">
                  취소
                </button>
                <button
                  type="button"
                  disabled={dropQty <= 0 || dropOverBudget || dropModal.isLoadingPrice || krwPrice === null}
                  onClick={() => {
                    if (dropQty <= 0 || krwPrice === null) return;
                    if (dropModal.mode === "buy") {
                      const existing = rebalancingSellAssets.find(
                        (a) => (a.ticker ?? "").toLowerCase() === dropModal.ticker.toLowerCase(),
                      );
                      let updated: PortfolioAsset[];
                      if (existing) {
                        updated = rebalancingSellAssets.map((a) =>
                          (a.ticker ?? "").toLowerCase() === dropModal.ticker.toLowerCase()
                            ? { ...a, amount: a.amount + dropQty, current_value: (a.amount + dropQty) * krwPrice }
                            : a,
                        );
                      } else {
                        const newAsset: PortfolioAsset = {
                          name: dropModal.sector, ticker: dropModal.ticker,
                          asset_class: productType, productType,
                          theme: "기타", country: dropModal.isGlobal ? "미국" : "한국",
                          buy_price: krwPrice, amount: dropQty, amount_type: "quantity" as const,
                          is_hedged: false, needs_review: false,
                          current_price: krwPrice, current_value: dropQty * krwPrice,
                        };
                        updated = [...rebalancingSellAssets, newAsset];
                      }
                      setRebalancingSellAssets(updated);
                      addBuyCost(dropCost);
                    } else if (existingAsset) {
                      addSellRecord({
                        id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
                        name: existingAsset.name,
                        productType: existingAsset.productType ?? existingAsset.asset_class ?? "",
                        sellPrice: krwPrice,
                        sellQty: dropQty,
                        buyPrice: existingAsset.buy_price,
                        realizedGain: existingAsset.buy_price != null ? (krwPrice - existingAsset.buy_price) * dropQty : 0,
                      });
                    }
                    setDropModal(null);
                  }}
                  className={`flex-1 rounded-xl px-4 py-2.5 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-40 ${
                    dropModal.mode === "buy" ? "bg-emerald-600 hover:bg-emerald-700" : "bg-samsung hover:bg-blue-700"
                  }`}
                >
                  {dropModal.mode === "buy" ? "매수 확정" : "매도 확정"}
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── 보유 자산 카드 매도 모달 ────────────────────────────────────── */}
      {sellCardKey && (() => {
        const asset = baseAssets.find((a) => makeAssetKey(a) === sellCardKey);
        const maxQty = asset?.amount ?? 0;
        const price = asset ? getEffectiveAssetPrice(asset) : 0;
        const sellQtyNum = Math.min(parseFloat(inlineSellQtyStr) || 0, maxQty);
        const estGain = asset?.buy_price != null && price > 0
          ? (price - asset.buy_price) * sellQtyNum
          : null;
        // 취소 버튼 표시 조건
        const origAsset = asset ? portfolioAssets.find((pa) => isSameAsset(pa, asset.name, asset.ticker)) : null;
        const hasAdditionalBuy = !!(origAsset && asset && asset.amount_type === "quantity" && asset.amount > origAsset.amount);
        const isNewBuy = !!(asset && !origAsset && asset.amount_type === "quantity" && asset.amount > 0);
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setSellCardKey(null)}>
            <div className="w-80 rounded-2xl bg-white p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
              <p className="mb-1 text-center text-sm font-bold text-slate-800">보유 자산 매도</p>
              <p className="mb-3 text-center text-xs font-semibold text-slate-600">
                {asset?.name ?? "—"} (최대 {maxQty.toLocaleString()}주)
              </p>
              <div className="mb-4 flex items-center gap-2">
                <input
                  type="number"
                  min={1}
                  max={maxQty}
                  value={inlineSellQtyStr}
                  onChange={(e) => {
                    const n = parseFloat(e.target.value);
                    if (Number.isFinite(n) && n > maxQty) { setInlineSellQtyStr(String(Math.floor(maxQty))); return; }
                    setInlineSellQtyStr(e.target.value);
                  }}
                  onBlur={() => {
                    const n = parseFloat(inlineSellQtyStr);
                    if (Number.isFinite(n) && n > maxQty) setInlineSellQtyStr(String(Math.floor(maxQty)));
                  }}
                  placeholder={`최대 ${maxQty.toLocaleString()}주`}
                  className="flex-1 rounded-xl border border-slate-300 px-3 py-2 text-center text-sm font-bold text-navy outline-none focus:border-red-400"
                  autoFocus
                />
                <span className="text-xs text-slate-500">주</span>
              </div>
              {estGain !== null && sellQtyNum > 0 && (
                <p className={`mb-3 text-center text-xs font-semibold ${estGain >= 0 ? "text-emerald-600" : "text-red-500"}`}>
                  예상 손익 {estGain >= 0 ? "+" : ""}{formatKrwAmount(estGain)}
                </p>
              )}
              <div className="flex flex-col gap-2">
                <div className="flex gap-3">
                  <button type="button" onClick={() => setSellCardKey(null)}
                    className="flex-1 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-bold text-slate-600 hover:bg-slate-50">
                    취소
                  </button>
                  <button type="button" onClick={confirmSellCard}
                    disabled={sellQtyNum <= 0}
                    className="flex-1 rounded-xl bg-red-500 px-4 py-2.5 text-sm font-bold text-white hover:bg-red-600 disabled:opacity-40">
                    매도 확정
                  </button>
                </div>
                {hasAdditionalBuy && origAsset && (
                  <button
                    type="button"
                    onClick={() => {
                      const deltaQty = asset!.amount - origAsset.amount;
                      const refund = price * deltaQty;
                      const rolledBack = rebalancingSellAssets.map((a) => {
                        if (!isSameAsset(a, asset!.name, asset!.ticker)) return a;
                        return { ...a, amount: origAsset.amount, current_value: undefined };
                      });
                      setRebalancingSellAssets(rolledBack);
                      if (refund > 0) addBuyCost(-refund);
                      setSellCardKey(null);
                    }}
                    className="w-full rounded-xl border border-orange-300 bg-orange-50 px-4 py-2.5 text-sm font-bold text-orange-700 hover:bg-orange-100"
                  >
                    기존 매수 취소 (+{(asset!.amount - origAsset.amount).toLocaleString()}주 롤백)
                  </button>
                )}
                {isNewBuy && (
                  <button
                    type="button"
                    onClick={() => {
                      const cost = price * asset!.amount;
                      const rolledBack = rebalancingSellAssets.filter(
                        (a) => !isSameAsset(a, asset!.name, asset!.ticker),
                      );
                      setRebalancingSellAssets(rolledBack);
                      if (cost > 0) addBuyCost(-cost);
                      setSellCardKey(null);
                    }}
                    className="w-full rounded-xl border border-orange-300 bg-orange-50 px-4 py-2.5 text-sm font-bold text-orange-700 hover:bg-orange-100"
                  >
                    신규 매수 취소 (종목 제거)
                  </button>
                )}
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── PB 직접 추가 매수 패널 ──────────────────────────────────────── */}
      <div className="rounded-xl border border-slate-200 bg-white shadow-soft">
        <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
          <div className="flex items-center gap-2">
            <Plus size={16} className="text-violet-600" />
            <span className="text-sm font-bold text-navy">PB 직접 추가 매수</span>
          </div>
          <button
            type="button"
            onClick={addPbRow}
            className="flex items-center gap-1.5 rounded-lg border border-violet-300 bg-violet-50 px-3 py-1.5 text-xs font-bold text-violet-700 transition hover:bg-violet-100"
          >
            <Plus size={12} />
            종목 추가
          </button>
        </div>

        {pbOrderRows.length === 0 ? (
          <div className="flex items-center justify-center rounded-b-xl bg-slate-50 py-7">
            <p className="text-sm text-slate-400">종목 추가 버튼을 눌러 직접 매수 종목을 입력하세요.</p>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-slate-100 bg-slate-50">
                    <th className="w-28 px-2 py-2 text-left font-bold text-slate-500">종목유형</th>
                    <th className="px-2 py-2 text-left font-bold text-slate-500">종목명</th>
                    <th className="w-24 px-2 py-2 text-left font-bold text-slate-500">티커</th>
                    <th className="w-28 px-2 py-2 text-right font-bold text-slate-500">현재가</th>
                    <th className="w-20 px-2 py-2 text-right font-bold text-slate-500">수량(주/개)</th>
                    <th className="w-32 px-2 py-2 text-right font-bold text-slate-500">매수단가(원화)</th>
                    <th className="w-20 px-2 py-2 text-right font-bold text-slate-500">채권수익률(%)</th>
                    <th className="w-20 px-2 py-2 text-right font-bold text-slate-500">만기(년)</th>
                    <th className="w-8 px-2 py-2"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {pbOrderRows.map((row) => {
                    const pbState = pbSearchState[row.id] ?? { loading: false, error: null };
                    const isBond = row.productType === "국내채권" || row.productType === "해외채권";
                    const isForeignPrice = row.priceCurrency === "USD";
                    const krwAmount = computeKrwAmount(row, usdKrwRate);
                    return (
                      <tr key={row.id} className="hover:bg-slate-50/70">
                        {/* 종목유형 */}
                        <td className="px-2 py-1.5">
                          <select
                            value={row.productType}
                            onChange={(e) => updatePbRow(row.id, { productType: e.target.value })}
                            className="w-full rounded border border-slate-200 bg-white px-2 py-1 text-xs text-navy outline-none focus:border-[#2f2f9d]"
                          >
                            <option>국내주식</option>
                            <option>해외주식</option>
                            <option>국내ETF</option>
                            <option>해외ETF</option>
                            <option>국내채권</option>
                            <option>해외채권</option>
                            <option>예적금/현금</option>
                          </select>
                        </td>
                        {/* 종목명 — 채권 선택 시 입력 불가 */}
                        <td className="px-2 py-1.5">
                          <div className="relative">
                            <input
                              type="text"
                              value={row.name}
                              disabled={isBond}
                              onChange={(e) =>
                                updatePbRow(row.id, { name: e.target.value, ticker: "" })
                              }
                              placeholder={isBond ? "채권(직접입력불가)" : "종목명 입력"}
                              className={`w-full rounded border px-2 py-1 text-xs outline-none ${
                                isBond
                                  ? "cursor-not-allowed border-slate-100 bg-slate-100 text-slate-400 placeholder:text-slate-300"
                                  : "border-slate-200 bg-white text-navy placeholder:text-slate-300 focus:border-[#2f2f9d]"
                              }`}
                            />
                            {pbState.loading && !isBond && (
                              <Loader2
                                size={11}
                                className="absolute right-2 top-1/2 -translate-y-1/2 animate-spin text-slate-400"
                              />
                            )}
                            {pbState.error && !isBond && (
                              <p className="mt-0.5 text-[10px] leading-tight text-red-500">
                                {pbState.error}
                              </p>
                            )}
                          </div>
                        </td>
                        {/* 티커 (read-only) */}
                        <td className="px-2 py-1.5">
                          <span className="inline-block rounded bg-slate-100 px-2 py-0.5 font-mono text-[10px] text-slate-600">
                            {row.ticker || "—"}
                          </span>
                        </td>
                        {/* 현재가 (read-only, proxy-finance 자동 조회) */}
                        <td className="px-2 py-1.5 text-right">
                          {pbState.loading ? (
                            <span className="text-[10px] text-slate-400">조회중…</span>
                          ) : row.currentPrice !== null ? (
                            <span className="text-xs font-semibold text-slate-700">
                              {isForeignPrice
                                ? `$${row.currentPrice.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                                : `${Math.round(row.currentPrice).toLocaleString("ko-KR")}원`}
                            </span>
                          ) : (
                            <span className="text-[10px] text-slate-300">—</span>
                          )}
                        </td>
                        {/* 수량 (user input) */}
                        <td className="px-2 py-1.5">
                          <input
                            type="number"
                            min="0"
                            value={row.quantity}
                            onChange={(e) => updatePbRow(row.id, { quantity: e.target.value })}
                            placeholder="0"
                            className="w-full rounded border border-slate-200 bg-white px-2 py-1 text-right text-xs text-navy outline-none placeholder:text-slate-300 focus:border-[#2f2f9d]"
                          />
                        </td>
                        {/* 매수단가(원화) — 채권: 직접 입력 / 비채권: read-only 자동 연산 */}
                        <td className="px-2 py-1.5 text-right">
                          {isBond ? (
                            <input
                              type="text"
                              inputMode="numeric"
                              value={row.amountManStr}
                              onChange={(e) => {
                                const raw = e.target.value.replace(/,/g, "");
                                updatePbRow(row.id, { amountManStr: raw });
                              }}
                              placeholder="투자금액(원)"
                              className="w-full rounded border border-slate-200 bg-white px-2 py-1 text-right text-xs text-navy outline-none placeholder:text-slate-300 focus:border-[#2f2f9d]"
                            />
                          ) : (
                            <>
                              <span className={`text-xs font-bold ${krwAmount > 0 ? "text-navy" : "text-slate-300"}`}>
                                {krwAmount > 0 ? fmtKrwMan(krwAmount) : "—"}
                              </span>
                              {isForeignPrice && krwAmount > 0 && (
                                <div className="text-[9px] text-slate-400">
                                  @{usdKrwRate.toLocaleString("ko-KR", { maximumFractionDigits: 0 })}원
                                </div>
                              )}
                            </>
                          )}
                        </td>
                        {/* 채권수익률(%) — 채권 유형만 활성 */}
                        <td className="px-2 py-1.5">
                          <input
                            type="number"
                            min="0"
                            step="0.1"
                            value={row.bondYield}
                            onChange={(e) => updatePbRow(row.id, { bondYield: e.target.value })}
                            disabled={!isBond}
                            placeholder={isBond ? "%" : "—"}
                            className="w-full rounded border border-slate-200 bg-white px-2 py-1 text-right text-xs text-navy outline-none placeholder:text-slate-300 focus:border-[#2f2f9d] disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-300"
                          />
                        </td>
                        {/* 만기(년) — 채권 유형만 활성 */}
                        <td className="px-2 py-1.5">
                          <input
                            type="number"
                            min="0"
                            step="1"
                            value={row.maturityYears}
                            onChange={(e) => updatePbRow(row.id, { maturityYears: e.target.value })}
                            disabled={!isBond}
                            placeholder={isBond ? "년" : "—"}
                            className="w-full rounded border border-slate-200 bg-white px-2 py-1 text-right text-xs text-navy outline-none placeholder:text-slate-300 focus:border-[#2f2f9d] disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-300"
                          />
                        </td>
                        {/* 삭제 */}
                        <td className="px-2 py-1.5">
                          <button
                            type="button"
                            onClick={() => removePbRow(row.id)}
                            className="flex h-6 w-6 items-center justify-center rounded text-slate-400 transition hover:bg-red-50 hover:text-red-500"
                          >
                            <X size={12} />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="flex items-center justify-between border-t border-slate-100 bg-violet-50 px-4 py-2.5">
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-violet-700">매수 합계</span>
                {usdKrwRate > 100 && (
                  <span className="rounded-full bg-violet-100 px-2 py-0.5 text-[9px] text-violet-500">
                    USD/KRW {usdKrwRate.toLocaleString("ko-KR", { maximumFractionDigits: 0 })}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-3">
                <span
                  className={`text-sm font-black ${isOverBudget ? "text-red-600" : "text-violet-900"}`}
                >
                  {fmtKrwMan(pbTotalAmount)}
                </span>
                <button
                  type="button"
                  disabled={!hasPbItems || isOverBudget}
                  onClick={handlePbConfirm}
                  className="flex items-center gap-1.5 rounded-lg bg-violet-600 px-3 py-1.5 text-xs font-bold text-white transition hover:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <CheckCircle2 size={12} />
                  매수 확정
                </button>
              </div>
            </div>
          </>
        )}
      </div>

      {/* ── 매수 확정 ──────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-soft">
        <div className="text-xs text-slate-400">
          합계&nbsp;
          <span
            className={
              isOverBudget
                ? "font-bold text-red-500"
                : "font-semibold"
            }
          >
            {fmtKrwMan(totalAllocated)}
          </span>
        </div>
        <button
          type="button"
          onClick={handleConfirm}
          disabled={isConfirming || !canConfirm}
          className="flex items-center gap-2 rounded-lg bg-[#2f2f9d] px-5 py-2 text-sm font-bold text-white shadow transition hover:bg-[#1e1e8a] disabled:cursor-not-allowed disabled:opacity-40"
        >
          {isConfirming ? (
            <>
              <Loader2 size={14} className="animate-spin" />
              분석 중…
            </>
          ) : confirmDone ? (
            <>
              <CheckCircle2 size={14} />
              완료 — TAB4에서 확인
            </>
          ) : (
            "매수 확정 → TAB4 반영"
          )}
        </button>
      </div>

      {/* ── 딥다이브 모달 (2분할 확장 레이아웃) ───────────────────── */}
      {modalTicker !== null && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm"
          onClick={(e) => {
            if (e.target === e.currentTarget) closeModal();
          }}
        >
          <div className="relative w-full max-w-4xl rounded-2xl bg-white shadow-2xl">
            {/* 모달 헤더 */}
            <div className="flex items-start justify-between border-b border-slate-100 p-4">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-bold text-navy">{modalSector}</span>
                  <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[11px] text-slate-600">
                    {modalTicker}
                  </span>
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] text-slate-500">
                    {modalIsGlobal ? "해외ETF" : "국내ETF"}
                  </span>
                </div>
                {etfOfficialName && (
                  <p className="mt-1 text-xs text-slate-500">
                    {etfOfficialName}
                  </p>
                )}
              </div>
              <button
                type="button"
                onClick={closeModal}
                className="ml-4 flex-shrink-0 rounded-md p-1 text-slate-400 hover:bg-slate-100"
              >
                <X size={16} />
              </button>
            </div>

            {/* 모달 본문 — 2컬럼 그리드 */}
            <div className="grid grid-cols-1 gap-0 md:grid-cols-2">

              {/* ── 좌측: 가격 정보 + 1Y 차트 + 실시간 뉴스 ── */}
              <div className="border-b border-slate-100 p-4 md:border-b-0 md:border-r overflow-y-auto max-h-[80vh]">

                {/* 포커스 기업 표시 배너 (부모 ETF가 아닌 개별 기업 조회 시) */}
                {modalFocusTicker !== null && modalFocusTicker !== modalTicker && (
                  <div className="mb-3 flex items-center gap-2 rounded-lg bg-indigo-50 px-3 py-2">
                    <div className="min-w-0 flex-1">
                      <span className="text-[11px] font-semibold text-indigo-700">
                        {relatedCompanies.find((c) => c.symbol === modalFocusTicker)?.name ?? modalFocusTicker}
                      </span>
                      <span className="ml-1.5 rounded bg-indigo-100 px-1.5 py-0.5 font-mono text-[10px] text-indigo-500">
                        {modalFocusTicker}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setModalFocusTicker(modalTicker);
                        setSelectedCompanyIdx(null);
                        setCompanyMetrics(null);
                      }}
                      className="flex-shrink-0 text-[10px] text-indigo-400 transition hover:text-indigo-600"
                    >
                      ← ETF 보기
                    </button>
                  </div>
                )}

                {isLoadingModal ? (
                  <div className="flex items-center justify-center gap-2 py-10 text-sm text-slate-400">
                    <Loader2 size={16} className="animate-spin" />
                    {modalFocusTicker !== modalTicker ? "기업 데이터 로드 중…" : "가격 데이터 로드 중…"}
                  </div>
                ) : (
                  <>
                    <div className="mb-4 grid grid-cols-2 gap-3">
                      <div className="rounded-lg bg-slate-50 p-3">
                        <div className="text-[10px] text-slate-400">현재가</div>
                        <div className="mt-0.5 text-sm font-bold text-navy">
                          {modalCurrentPrice != null
                            ? `${modalCurrentPrice.toLocaleString("ko-KR", {
                                maximumFractionDigits: 2,
                              })} ${modalCurrency}`
                            : "-"}
                        </div>
                      </div>
                      <div className="rounded-lg bg-slate-50 p-3">
                        <div className="text-[10px] text-slate-400">배당수익률</div>
                        <div className="mt-0.5 text-sm font-bold text-navy">
                          {modalDividendYield != null
                            ? fmtPct(modalDividendYield)
                            : "-"}
                        </div>
                      </div>
                    </div>

                    {modalChartData.length > 1 ? (
                      <div>
                        <div className="mb-2 text-xs font-semibold text-slate-500">
                          1Y 가격 추이
                        </div>
                        <ResponsiveContainer width="100%" height={160}>
                          <LineChart
                            data={modalChartData}
                            margin={{ top: 4, right: 8, bottom: 0, left: 0 }}
                          >
                            <CartesianGrid
                              strokeDasharray="3 3"
                              stroke="#f1f5f9"
                            />
                            <XAxis
                              dataKey="date"
                              tick={{ fontSize: 9 }}
                              interval="preserveStartEnd"
                            />
                            <YAxis
                              tick={{ fontSize: 9 }}
                              width={52}
                              tickFormatter={(v: number) =>
                                v.toLocaleString("ko-KR", {
                                  maximumFractionDigits: 0,
                                })
                              }
                            />
                            <Tooltip
                              contentStyle={{ fontSize: 11 }}
                              formatter={(value: unknown) => {
                                const v =
                                  typeof value === "number" ? value : NaN;
                                return [
                                  Number.isFinite(v)
                                    ? v.toLocaleString("ko-KR", {
                                        maximumFractionDigits: 2,
                                      })
                                    : "-",
                                  "가격",
                                ] as [string, string];
                              }}
                            />
                            <Line
                              type="monotone"
                              dataKey="price"
                              stroke="#2f2f9d"
                              strokeWidth={2}
                              dot={false}
                            />
                          </LineChart>
                        </ResponsiveContainer>
                      </div>
                    ) : (
                      <div className="flex items-center justify-center rounded-lg bg-slate-50 py-8 text-xs text-slate-400">
                        차트 데이터를 불러올 수 없습니다.
                      </div>
                    )}

                    {/* ── 실시간 기업 뉴스 (핵심 3선) ── */}
                    <div className="mt-4 border-t border-slate-100 pt-3">
                      <div className="mb-2 flex items-center gap-1.5">
                        <Newspaper size={12} className="text-slate-400" />
                        <span className="text-xs font-semibold text-slate-500">
                          실시간 기업 뉴스 (핵심 3선)
                        </span>
                      </div>
                      {isLoadingNews ? (
                        <div className="flex items-center gap-2 py-3 text-xs text-slate-400">
                          <Loader2 size={12} className="animate-spin" />
                          뉴스 로드 중…
                        </div>
                      ) : stockNews.length === 0 ? (
                        <div className="py-3 text-center text-xs text-slate-400">
                          뉴스를 불러올 수 없습니다.
                        </div>
                      ) : (
                        <ul className="divide-y divide-slate-100">
                          {stockNews.map((item, i) => (
                            <li key={i} className="py-2">
                              <a
                                href={item.url || undefined}
                                target="_blank"
                                rel="noopener noreferrer"
                                className={`group block${item.url ? " cursor-pointer" : " cursor-default"}`}
                              >
                                <p className="text-sm font-bold leading-snug text-navy transition-colors group-hover:text-blue-600 group-hover:underline">
                                  {item.title}
                                </p>
                                {item.preview && (
                                  <p className="mt-0.5 line-clamp-3 text-xs text-gray-500">
                                    {item.preview}
                                  </p>
                                )}
                              </a>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </>
                )}
              </div>

              {/* ── 우측: 관련 핵심 기업 TOP 10 인터랙티브 패널 ── */}
              <div className="flex flex-col p-4">
                {/* ETF 섹터 브리핑 */}
                {modalStrategy && (
                  <div className="mb-3 rounded-lg bg-blue-50 px-3 py-2 text-[11px] leading-relaxed text-blue-700">
                    {modalStrategy}
                  </div>
                )}

                {/* 헤더 행: 타이틀 + 정렬 세그먼트 + 마켓 배지 */}
                <div className="mb-3 flex flex-wrap items-center gap-x-2 gap-y-2">
                  {/* 타이틀 */}
                  <span className="shrink-0 text-xs font-bold text-slate-500">
                    관련 핵심 기업 TOP 10
                  </span>

                  {/* 정렬 세그먼트 버튼 그룹 — 인디고/블루 테마 */}
                  <div className="flex shrink-0">
                    {(["theme", "marketCap", "volume"] as RelatedSortFilter[]).map((s, i) => (
                      <button
                        key={s}
                        type="button"
                        onClick={() => handleSortChange(s)}
                        className={[
                          "border px-2.5 py-1 text-xs font-medium transition-colors cursor-pointer",
                          i === 0 ? "rounded-l-md" : "-ml-px",
                          i === 2 ? "rounded-r-md" : "",
                          relatedSortFilter === s
                            ? "relative z-10 border-indigo-600 bg-indigo-600 text-white"
                            : "border-indigo-200 bg-white text-indigo-600 hover:bg-indigo-50",
                        ].join(" ")}
                      >
                        {s === "theme" ? "테마 연관순" : s === "marketCap" ? "시가총액순" : "거래량순"}
                      </button>
                    ))}
                    {isSortTransitioning && (
                      <Loader2 size={11} className="ml-1.5 self-center animate-spin text-indigo-400" />
                    )}
                  </div>

                  {/* 마켓 배지 — 우측 정렬 */}
                  <div className="ml-auto flex gap-0.5 rounded-lg border border-slate-200 bg-white p-0.5">
                    {modalIsGlobal ? (
                      <span className="flex items-center gap-1 rounded-md bg-[#2f2f9d] px-2.5 py-1 text-[11px] font-semibold text-white">
                        <Globe size={10} />
                        해외 관련주
                      </span>
                    ) : (
                      <span className="flex items-center gap-1 rounded-md bg-[#2f2f9d] px-2.5 py-1 text-[11px] font-semibold text-white">
                        <Building2 size={10} />
                        국내 관련주
                      </span>
                    )}
                  </div>
                </div>

                {/* 관련 기업 리스트 — 고정 높이·내부 스크롤으로 모달 종횡비 보존 */}
                <div className="divide-y divide-slate-50 rounded-xl border border-slate-100 overflow-y-auto max-h-[450px] pr-1">
                  {isLoadingRelated ? (
                    <div className="flex items-center justify-center gap-2 py-6 text-xs text-slate-400">
                      <Loader2 size={13} className="animate-spin" />
                      관련주 검색 중…
                    </div>
                  ) : sortedRelatedCompanies.length === 0 ? (
                    <div className="py-6 text-center text-xs text-slate-400">
                      관련 기업 데이터를 불러올 수 없습니다.
                    </div>
                  ) : sortedRelatedCompanies.map((company, idx) => (
                    <div key={company.symbol}>
                      <button
                        type="button"
                        onClick={() => handleCompanyClick(company, idx)}
                        className={`flex w-full items-center justify-between px-3 py-2.5 text-left transition hover:bg-slate-50 ${
                          selectedCompanyIdx === idx ? "bg-indigo-50" : ""
                        }`}
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="flex-shrink-0 w-5 h-5 rounded-full bg-slate-100 flex items-center justify-center text-[10px] font-bold text-slate-500">
                            {idx + 1}
                          </span>
                          <span className="truncate text-xs font-semibold text-navy">
                            {formatLocalTickerName(company.name, company.symbol, portfolioAssets)}
                          </span>
                          <span className="flex-shrink-0 rounded bg-slate-100 px-1 py-0.5 font-mono text-[10px] text-slate-500">
                            {company.symbol}
                          </span>
                        </div>
                        <span className={`flex-shrink-0 text-[10px] transition ${selectedCompanyIdx === idx ? "text-indigo-600" : "text-slate-300"}`}>
                          {selectedCompanyIdx === idx ? "▲" : "▼"}
                        </span>
                      </button>

                      {/* 2단계 실시간 지표 패널 */}
                      {selectedCompanyIdx === idx && (
                        <div className="border-t border-indigo-100 bg-indigo-50 px-3 py-2.5">
                          {isLoadingCompanyMetrics ? (
                            <div className="flex items-center gap-2 text-xs text-slate-400">
                              <Loader2 size={12} className="animate-spin" />
                              지표 로드 중…
                            </div>
                          ) : companyMetrics ? (
                            <div className="grid grid-cols-3 gap-2">
                              {[
                                {
                                  label: "현재가",
                                  value: fmtCompanyPrice(companyMetrics.price, companyMetrics.currency),
                                  hasValue: companyMetrics.price != null,
                                },
                                {
                                  label: "PER",
                                  value: companyMetrics.per != null
                                    ? companyMetrics.per.toFixed(1)
                                    : companyMetrics.dataNote === "krx-partial" ? "공시없음" : "N/A",
                                  hasValue: companyMetrics.per != null,
                                },
                                {
                                  label: "PBR",
                                  value: companyMetrics.pbr != null
                                    ? companyMetrics.pbr.toFixed(2)
                                    : companyMetrics.dataNote === "krx-partial" ? "공시없음" : "N/A",
                                  hasValue: companyMetrics.pbr != null,
                                },
                                {
                                  label: "PSR",
                                  value: companyMetrics.psr != null
                                    ? companyMetrics.psr.toFixed(2)
                                    : companyMetrics.dataNote === "krx-partial" ? "공시없음" : "N/A",
                                  hasValue: companyMetrics.psr != null,
                                },
                                {
                                  label: "EBITDA",
                                  value: fmtLargeFinancial(companyMetrics.ebitda, companyMetrics.currency) === "N/A" && companyMetrics.dataNote === "krx-partial"
                                    ? "공시없음"
                                    : fmtLargeFinancial(companyMetrics.ebitda, companyMetrics.currency),
                                  hasValue: companyMetrics.ebitda != null,
                                },
                                {
                                  label: "직전매출",
                                  value: fmtLargeFinancial(companyMetrics.revenue, companyMetrics.currency) === "N/A" && companyMetrics.dataNote === "krx-partial"
                                    ? "공시없음"
                                    : fmtLargeFinancial(companyMetrics.revenue, companyMetrics.currency),
                                  hasValue: companyMetrics.revenue != null,
                                },
                              ].map(({ label, value, hasValue }) => (
                                <div key={label} className="rounded-lg bg-white p-2">
                                  <div className="text-[9px] text-slate-400">{label}</div>
                                  <div className={`mt-0.5 text-xs font-bold ${hasValue ? "text-navy" : "text-slate-400"}`}>
                                    {value}
                                  </div>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <div className="text-[11px] text-slate-400">
                              지표를 불러올 수 없습니다.
                            </div>
                          )}
                          <p className="mt-1.5 text-[9px] text-slate-400">
                            * Yahoo Finance 실시간 데이터 기준
                          </p>
                        </div>
                      )}
                    </div>
                  ))}
                </div>

                <p className="mt-2 text-[9px] text-slate-400">
                  * Yahoo Finance 실시간 검색 · 행 클릭 시 실무 핵심 지표 확인 · 정렬 전환 시 선택 초기화
                </p>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// 전략 카드 내 지표 행 — highlight=true 시 라벨 착색 + 값 강조
function MetricRow({
  label,
  value,
  color,
  highlight = false,
}: {
  label: string;
  value: string;
  color: string;
  highlight?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className={`text-[10px] ${highlight ? `${color} font-semibold` : "text-slate-400"}`}>
        {label}
      </span>
      <span className={`font-bold ${highlight ? "text-sm" : "text-xs"} ${color}`}>
        {value}
      </span>
    </div>
  );
}
