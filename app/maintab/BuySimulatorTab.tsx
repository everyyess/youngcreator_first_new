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
  saveBuySimUncheckedTickers,
  type BuySimTickerItem,
  type PortfolioAsset,
  type PbOrderRow,
} from "./CustomerContext";
import { useCustomerView } from "./CustomerViewContext";
import { WeeklyTopPicksCard } from "./WeeklyTopPicksCard";
import { AiStockPicksCard } from "./AiStockPicksCard";
import { formatLocalTickerName } from "./tickerUtils";
import {
  createStockRebalancingRecord,
  upsertRebalancingHistory,
} from "./rebalancingHistoryUtils";
import { parseKoreanNumber } from "@/lib/portfolioLogic";
import {
  CLASS_COLORS,
  formatKrwAmount,
  normalizeAssetClass,
  isProductHolding,
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
  "금융":             { en: "Global Banking",                   kr: "은행"         },
  "귀금속":           { en: "Gold Silver Mining",               kr: "비철금속"     },
  "농산물원자재":     { en: "Agriculture Fertilizer",           kr: "사료"         },
  "에너지원자재":     { en: "Oil Gas Exploration",              kr: "정유"         },
  "원유":             { en: "Oil Gas Exploration",              kr: "정유"         },
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

// 드래그 매수 모달 전용 — 만 원 미만 단위를 버리지 않는 정밀 원화 포맷
function fmtKrwExact(v: number | null): string {
  if (v === null || !Number.isFinite(v)) return "-";
  return `${Math.round(v).toLocaleString("ko-KR")}원`;
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
        const addedQty =
          Number.isFinite(qty) && qty > 0 ? qty : 0;

        if (!isBond && addedQty > 0) {
          const incomingPriceKrw =
            row.priceCurrency === "USD" && row.currentPrice != null
              ? row.currentPrice * usdKrwRate
              : (row.currentPrice ?? 0);

          const previousAvgPrice =
            ex.buy_price ??
            ex.current_price ??
            incomingPriceKrw;

          const nextQty = ex.amount + addedQty;

          const nextAvgPrice =
            incomingPriceKrw > 0 && nextQty > 0
              ? (
                  previousAvgPrice * ex.amount +
                  incomingPriceKrw * addedQty
                ) / nextQty
              : previousAvgPrice;

          merged[idx] = {
            ...ex,
            amount: nextQty,
            buy_price: nextAvgPrice,
            current_price:
              incomingPriceKrw > 0
                ? incomingPriceKrw
                : ex.current_price,
            current_value:
              incomingPriceKrw > 0
                ? nextQty * incomingPriceKrw
                : ex.current_value,
          };
        } else {
          merged[idx] = {
            ...ex,
            amount: ex.amount + addedQty,
          };
        }
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
  const assetTicker = tickerBase(a.ticker);
  const incomingTicker = tickerBase(ticker);

  // 둘 다 티커가 있으면 이름은 보지 않는다.
  // 예: 씨게이트(STX) === seagate(STX)
  if (assetTicker && incomingTicker) {
    return assetTicker === incomingTicker;
  }

  // 티커가 없는 데이터만 종목명으로 비교
  return a.name.toLowerCase().trim() === name.toLowerCase().trim();
}

function makeAssetKey(a: PortfolioAsset): string {
  const tb = tickerBase(a.ticker);

  // ticker가 있으면 종목명과 무관하게 ticker가 고유 식별자
  if (tb) return `ticker:${tb}`;

  // ticker가 없는 자산만 이름으로 구분
  return `name:${a.name.toLowerCase().trim()}`;
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
  const isGlobalProduct = row.productType === "해외주식" || row.productType === "해외ETF";
  const krw = isGlobalProduct ? price * qty * usdKrwRate : price * qty;
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
    buySimUncheckedTickers,
    setBuySimUncheckedTickers,
    pbOrderRows,
    setPbOrderRows,
    sellHistory,
    addSellRecord,
    addBuyCost,
    sharedUiState,
    updateSharedUiState,
  } = useCustomerContext();
  const { isCustomerView } = useCustomerView();

  // ── 보유 자산 카드 그리드 데이터 ────────────────────────────────────────────────
  // 이 탭(리밸런싱-주식)에는 "기존 포트폴리오 보유 자산 + 이 탭에서 담은 신규 매수 주식"만 표시한다.
  // 탭3-2(리밸런싱-상품)에서 담은 펀드·랩·채권은 같은 rebalancingSellAssets에 들어있지만 여기서는 제외한다.
  const baseAssets = useMemo<PortfolioAsset[]>(() => {
    const enriched = (analysisResult?.enrichedAssets ?? []) as PortfolioAsset[];
    const priceMap = new Map(enriched.map((a) => [makeAssetKey(a), a]));
    const stockSide = rebalancingSellAssets.filter((a) => a.name && !isProductHolding(a));
    if (stockSide.length > 0) {
      return stockSide.map((a) => {
        const e = priceMap.get(makeAssetKey(a));
        const cp = Number(e?.current_price ?? a.current_price);
        return { ...a, current_price: cp > 0 ? cp : a.current_price, current_value: a.amount > 0 && cp > 0 ? a.amount * cp : 0 };
      });
    }
    // 주식 쪽 리밸런싱 이력이 아직 없으면(상품만 담긴 경우 포함) 원본 포트폴리오를 그대로 보여준다.
    const src = enriched.length ? enriched : portfolioAssets;
    return src.filter((a) => a.name);
  }, [analysisResult, portfolioAssets, rebalancingSellAssets]);

  // 3개 독립 행: [국내주식+국내ETF] / [해외주식+해외ETF] / [채권(국내→해외 순)]
  const groupedAssetCards = useMemo(() => {
    const domestic: PortfolioAsset[] = [];
    const foreign: PortfolioAsset[] = [];
    const bonds: PortfolioAsset[] = [];
    const others: PortfolioAsset[] = [];
    for (const a of baseAssets) {
      if (a.amount_type === "quantity" && a.amount <= 0) continue;
      const pt = (a.productType ?? a.asset_class ?? "").trim();
      if (pt === "국내주식" || pt === "국내ETF") domestic.push(a);
      else if (pt === "해외주식" || pt === "해외ETF") foreign.push(a);
      else if (pt.includes("채권")) bonds.push(a);
      else others.push(a);
    }
    bonds.sort((a, b) => {
      const o = (p: string) => p === "국내채권" ? 0 : p === "해외채권" ? 1 : 2;
      return o(a.productType ?? "") - o(b.productType ?? "");
    });
    return [
      { type: "국내", assets: domestic },
      { type: "해외", assets: foreign },
      { type: "채권", assets: bonds },
      ...(others.length ? [{ type: "기타", assets: others }] : []),
    ].filter((r) => r.assets.length > 0);
  }, [baseAssets]);

  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  // 보유 자산 카드 인라인 매도
  const [sellCardKey, setSellCardKey] = useState<string | null>(null);
  const [inlineSellQtyStr, setInlineSellQtyStr] = useState("");

  type DropModal = {
    ticker: string; sector: string; isGlobal: boolean;
    kind: "etf" | "stock";
    mode: "buy" | "sell"; qtyStr: string;
    price: number | null; currency: "KRW" | "USD"; isLoadingPrice: boolean;
  };
  const [dropModal, setDropModal] = useState<DropModal | null>(null);

  // USD/KRW 실시간 환율 (야후 파이낸스 USDKRW=X — 마운트 시 1회 조회, 기본값 1380)
  const syncedTab3Ui = sharedUiState.tab3;

  useEffect(() => {
    if (!isCustomerView || !syncedTab3Ui) return;
    setSellCardKey(syncedTab3Ui.sellCardKey ?? null);
    setInlineSellQtyStr(syncedTab3Ui.inlineSellQtyStr ?? "");
    setDropModal((syncedTab3Ui.dropModal as DropModal | null | undefined) ?? null);
  }, [isCustomerView, syncedTab3Ui]);

  useEffect(() => {
    if (isCustomerView) return;
    updateSharedUiState({
      tab3: {
        sellCardKey,
        inlineSellQtyStr,
        dropModal,
      },
    });
  }, [
    isCustomerView,
    sellCardKey,
    inlineSellQtyStr,
    dropModal,
    updateSharedUiState,
  ]);

  const [usdKrwRate, setUsdKrwRate] = useState<number>(1380);

  const tMarginal = useMemo(() => {
    const total = parseKoreanNumber(formData.financial.totalAssets);
    if (total >= 5e9) return 0.45;
    if (total >= 3e9) return 0.40;
    if (total >= 1.2e9) return 0.35;
    return 0.38;
  }, [formData.financial.totalAssets]);

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
      if (isProductHolding(a)) return sum; // 탭3-2에서 담은 상품·채권은 주식 매수 예산과 무관
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
    // availableInvestmentFunds에는 이미 확정 매수금액이 차감되어 있다.
    // 따라서 여기서는 새로 입력 중인 PB 주문금액만 추가 예산 검사한다.
    const total = confirmedPbAmount + pbTotalAmount;
    const avail = availableInvestmentFunds ?? 0;

    return {
      totalAllocated: total,
      remaining: avail - pbTotalAmount,
      isOverBudget: avail > 0 && pbTotalAmount > avail,
    };
  }, [availableInvestmentFunds, confirmedPbAmount, pbTotalAmount]);

  // ── 핸들러 ───────────────────────────────────────────────────────────────

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


  // 자사 추천 종목(주간 투자 전략) 카드에서 "담기" 클릭 시 매수 모달 오픈
  const handleAddWeeklyPick = useCallback((pick: { name: string; ticker: string; isGlobal: boolean }) => {
    setDropModal({
      ticker: pick.ticker,
      sector: pick.name,
      isGlobal: pick.isGlobal,
      kind: "stock",
      mode: "buy",
      qtyStr: "",
      price: null,
      currency: pick.isGlobal ? "USD" : "KRW",
      isLoadingPrice: true,
    });
    fetch(`/api/price?ticker=${encodeURIComponent(pick.ticker)}`)
      .then(async (r) => {
        if (!r.ok) {
          setDropModal((prev) => prev ? { ...prev, isLoadingPrice: false } : null);
          return;
        }
        const data = (await r.json()) as { regularMarketPrice?: number };
        const price = typeof data?.regularMarketPrice === "number" ? data.regularMarketPrice : null;
        const currency: "KRW" | "USD" = pick.isGlobal ? "USD" : "KRW";
        setDropModal((prev) => prev ? { ...prev, price, currency, isLoadingPrice: false } : null);
      })
      .catch(() => setDropModal((prev) => prev ? { ...prev, isLoadingPrice: false } : null));
  }, []);

  const confirmSellCard = useCallback(() => {
    if (!sellCardKey) return;

    const asset = baseAssets.find(
      (a) => makeAssetKey(a) === sellCardKey,
    );

    if (!asset) {
      setSellCardKey(null);
      return;
    }

    const price = getEffectiveAssetPrice(asset);

    if (
      price <= 0 ||
      asset.amount_type !== "quantity" ||
      asset.amount <= 0
    ) {
      setSellCardKey(null);
      return;
    }

    const qty = Math.min(
      parseFloat(inlineSellQtyStr),
      asset.amount,
    );

    if (!Number.isFinite(qty) || qty <= 0) {
      setSellCardKey(null);
      return;
    }

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

    // 실제 리밸런싱 포트폴리오에서도 매도 수량 차감
    const currentBase =
      rebalancingSellAssets.length > 0
        ? rebalancingSellAssets
        : baseAssets;

    const updatedAssets = currentBase
      .map((a) => {
        if (makeAssetKey(a) !== sellCardKey) return a;

        const remainingQty = Math.max(0, a.amount - qty);

        return {
          ...a,
          amount: remainingQty,
          current_value:
            remainingQty > 0 ? remainingQty * price : 0,
        };
      })
      .filter(
        (a) =>
          !(
            makeAssetKey(a) === sellCardKey &&
            a.amount_type === "quantity" &&
            a.amount <= 0
          ),
      );

    setRebalancingSellAssets(updatedAssets);

    setSellCardKey(null);
    setInlineSellQtyStr("");
  }, [
    sellCardKey,
    inlineSellQtyStr,
    baseAssets,
    rebalancingSellAssets,
    addSellRecord,
    setRebalancingSellAssets,
  ]);

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

  // stale-closure 방지용 ref — 렌더 시점에 동기 갱신 (useEffect 패턴 대비 1 tick 빠름)
  const sellAssetsRef = useRef(rebalancingSellAssets);
  const portfolioRef = useRef(portfolioAssets);
  const tMarginalRef = useRef(tMarginal);
  const formDataRef = useRef(formData);
  const selectedCustomerRef = useRef(selectedCustomer);
  const pbOrderRowsRef = useRef<PbOrderRow[]>(pbOrderRows);
  const usdKrwRateRef = useRef<number>(usdKrwRate);
  const sellHistoryRef = useRef(sellHistory);
  const sharedUiStateRef = useRef(sharedUiState);
  const updateSharedUiStateRef = useRef(updateSharedUiState);
  sellAssetsRef.current = rebalancingSellAssets;
  portfolioRef.current = portfolioAssets;
  tMarginalRef.current = tMarginal;
  formDataRef.current = formData;
  selectedCustomerRef.current = selectedCustomer;
  pbOrderRowsRef.current = pbOrderRows;
  usdKrwRateRef.current = usdKrwRate;
  sellHistoryRef.current = sellHistory;
  sharedUiStateRef.current = sharedUiState;
  updateSharedUiStateRef.current = updateSharedUiState;

  // PB 행별 검색 상태 (로딩/오류) — 컴포넌트 로컬, Context 비동기 업데이트와 분리
  const [pbSearchState, setPbSearchState] = useState<Record<string, { loading: boolean; error: string | null }>>({});
  const pbSearchTimersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

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

  // "리밸런싱 확정" 버튼 제거 — 시세 재분석·세금 계산은 이제 상위(Tab3Page)에서 rebalancingSellAssets
  // 변경을 실시간으로 감지해 자동 처리한다(handlePbConfirm·드래그앤드롭·인라인 매도가 이미 그 배열을
  // 즉시 갱신하므로 트리거는 충분함). 이 화면에 남은 건 "이 화면을 떠날 때 리밸런싱 히스토리를
  // 체크포인트로 기록"하는 것뿐 — 언마운트(다른 내부 탭·다른 TAB으로 이동) 시점에 기록한다.
  // upsertRebalancingHistory가 consultationId 기준으로 병합하므로 반복 기록해도 중복 생성되지 않는다.
  useEffect(() => {
    return () => {
      const afterAssets = sellAssetsRef.current;
      if (afterAssets.length === 0) return;
      const historyRecord = createStockRebalancingRecord({
        customerId: selectedCustomerRef.current,
        beforeAssets: portfolioRef.current,
        afterAssets,
        usdKrwRate: usdKrwRateRef.current,
      });
      updateSharedUiStateRef.current({
        tab3: {
          rebalancingHistory: upsertRebalancingHistory(
            sharedUiStateRef.current.tab3?.rebalancingHistory ?? [],
            historyRecord,
          ),
        },
      });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const hasPbItems = pbOrderRows.some((r) => {
    if (isBondProductType(r.productType)) {
      return computeKrwAmount(r, usdKrwRate) > 0;
    }
    const qty = parseFloat(r.quantity);
    return Number.isFinite(qty) && qty > 0 && (r.currentPrice ?? 0) > 0;
  });
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
        <section className="rounded-xl border-2 border-slate-200 bg-white p-5 shadow-soft transition-colors">
          <p className="mb-3 text-[10px] font-extrabold uppercase tracking-widest text-slate-400">
            보유 자산
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
                          onClick={() => !isCustomerView && handleSellCard(makeAssetKey(a))}
                          disabled={isCustomerView}
                          className="mt-1 w-full rounded border border-red-200 bg-red-50 py-0.5 text-[10px] font-bold text-red-500 hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-50"
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

      {/* ── 자사 추천 종목 (삼성증권 주간 투자 전략 리포트) ─────────── */}
      <WeeklyTopPicksCard isCustomerView={isCustomerView} onAdd={handleAddWeeklyPick} />

      {/* ── AI 추천 종목 (실시간 섹터 강세 스캐너) ──────────────────── */}
      <AiStockPicksCard isCustomerView={isCustomerView} onAdd={handleAddWeeklyPick} />

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
        const productType = dropModal.kind === "stock"
          ? (dropModal.isGlobal ? "해외주식" : "국내주식")
          : (dropModal.isGlobal ? "해외ETF" : "국내ETF");
        // 환율 적용 기준: currency 필드(Yahoo API 오분류 가능)가 아닌 isGlobal 플래그로 판별
        // [해외ETF] → 달러 현재가 × 환율, [국내ETF] → 원화 현재가 그대로
        const krwPrice = dropModal.price !== null
          ? (dropModal.isGlobal ? dropModal.price * usdKrwRate : dropModal.price)
          : null;
        const dropQty = parseFloat(dropModal.qtyStr) || 0;
        const dropCost = krwPrice !== null && dropQty > 0 ? dropQty * krwPrice : 0;
        const avail = availableInvestmentFunds ?? 0;
        const dropOverBudget = dropModal.mode === "buy" && avail > 0 && dropCost > avail;
        const maxDropQty = dropModal.mode === "buy" && krwPrice && krwPrice > 0 && avail > 0
          ? Math.floor(avail / krwPrice)
          : null;
        // 포트폴리오에 이미 있으면 매도도 가능
        // rebalancingSellAssets가 비어 있으면 baseAssets(원본 포트폴리오)에서 검색
        const dropWorkingBase = rebalancingSellAssets.length > 0 ? rebalancingSellAssets : baseAssets;
        const existingAsset = dropWorkingBase.find(
          (a) => isSameAsset(a, dropModal.sector, dropModal.ticker) && a.amount > 0,
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
                      현재가: <span className="font-bold text-navy">{fmtKrwExact(krwPrice)}</span>
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
                          {fmtKrwExact(dropCost)}
                        </span>
                        {dropOverBudget && <span className="ml-1 font-bold text-red-500">— 가용 자금 초과!</span>}
                      </div>
                      {dropModal.mode === "buy" && (
                        <div className={`mt-0.5 text-[10px] ${dropOverBudget ? "text-red-400" : "text-slate-400"}`}>
                          잔여 가용: {fmtKrwExact(avail - dropCost)}
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
                      // rebalancingSellAssets가 비어 있으면 baseAssets(원본 포트폴리오 전체)를 기반으로 병합
                      const base = rebalancingSellAssets.length > 0 ? rebalancingSellAssets : baseAssets;
                      const existing = base.find(
                        (a) => isSameAsset(a, dropModal.sector, dropModal.ticker),
                      );
                      let updated: PortfolioAsset[];
                      if (existing) {
                        updated = base.map((a) =>
                          isSameAsset(a, dropModal.sector, dropModal.ticker)
                            ? {
                                ...a,
                                amount: a.amount + dropQty,
                                buy_price:
                                  a.amount_type === "quantity" &&
                                  a.amount > 0
                                    ? (
                                        (
                                          (a.buy_price ??
                                            a.current_price ??
                                            krwPrice) *
                                          a.amount
                                        ) +
                                        krwPrice * dropQty
                                      ) /
                                      (a.amount + dropQty)
                                    : krwPrice,
                                current_price: krwPrice,
                                current_value:
                                  (a.amount + dropQty) * krwPrice,
                              }
                            : a,
                        );
                      } else {
                        const canonicalAssetName =
                          base.find((a) =>
                            isSameAsset(
                              a,
                              dropModal.sector,
                              dropModal.ticker,
                            ),
                          )?.name ??
                          portfolioAssets.find((a) =>
                            isSameAsset(
                              a,
                              dropModal.sector,
                              dropModal.ticker,
                            ),
                          )?.name ??
                          dropModal.sector;

                        const newAsset: PortfolioAsset = {
                          name: canonicalAssetName, ticker: dropModal.ticker,
                          asset_class: productType, productType,
                          theme: "기타", country: dropModal.isGlobal ? "미국" : "한국",
                          buy_price: krwPrice, amount: dropQty, amount_type: "quantity" as const,
                          is_hedged: false, needs_review: false,
                          current_price: krwPrice, current_value: dropQty * krwPrice,
                        };
                        updated = [...base, newAsset];
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
            disabled={isCustomerView}
            className="flex items-center gap-1.5 rounded-lg border border-violet-300 bg-violet-50 px-3 py-1.5 text-xs font-bold text-violet-700 transition hover:bg-violet-100 disabled:cursor-not-allowed disabled:opacity-40"
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
                            disabled={isCustomerView}
                            className="w-full rounded border border-slate-200 bg-white px-2 py-1 text-xs text-navy outline-none focus:border-[#2f2f9d] disabled:cursor-not-allowed disabled:opacity-50"
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
                              disabled={isBond || isCustomerView}
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
                            disabled={isCustomerView}
                            className="w-full rounded border border-slate-200 bg-white px-2 py-1 text-right text-xs text-navy outline-none placeholder:text-slate-300 focus:border-[#2f2f9d] disabled:cursor-not-allowed disabled:opacity-50"
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
                            disabled={!isBond || isCustomerView}
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
                            disabled={!isBond || isCustomerView}
                            placeholder={isBond ? "년" : "—"}
                            className="w-full rounded border border-slate-200 bg-white px-2 py-1 text-right text-xs text-navy outline-none placeholder:text-slate-300 focus:border-[#2f2f9d] disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-300"
                          />
                        </td>
                        {/* 삭제 */}
                        <td className="px-2 py-1.5">
                          <button
                            type="button"
                            onClick={() => removePbRow(row.id)}
                            disabled={isCustomerView}
                            className="flex h-6 w-6 items-center justify-center rounded text-slate-400 transition hover:bg-red-50 hover:text-red-500 disabled:cursor-not-allowed disabled:opacity-30"
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
                  disabled={!hasPbItems}
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

      {/* ── 매수 반영 현황 ──────────────────────────────────────────────────────── */}
      {/* "리밸런싱 확정" 버튼 제거 — 종목을 담는 순간(PB 주문 확정·드래그앤드롭·인라인 매도)
          바로 rebalancingSellAssets에 반영되고, 상위(Tab3Page)의 실시간 재분석 로직이
          시세·세금 계산까지 자동으로 처리한다. 버튼으로 별도 확정할 필요가 없다. */}
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
        <div className="flex items-center gap-1.5 text-xs font-semibold text-emerald-600">
          <CheckCircle2 size={14} />
          담는 즉시 실시간 반영 — 다음 탭·TAB4에 자동 동기화됩니다
        </div>
      </div>

    </div>
  );
}

