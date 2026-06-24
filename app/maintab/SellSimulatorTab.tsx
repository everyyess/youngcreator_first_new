"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { CheckCircle2, Loader2, Receipt, TrendingDown, TrendingUp } from "lucide-react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useCustomerContext } from "./CustomerContext";
import type { PortfolioAsset, SellRecord } from "./CustomerContext";
import { useCustomerView } from "./CustomerViewContext";
import { TLHTabContent } from "./tab1/FinancialIncomeGauge";
import {
  CLASS_COLORS,
  DonutChart,
  formatKrwAmount,
  normalizeAssetClass,
} from "./PortfolioResultComponents";
import { formatLocalTickerName } from "./tickerUtils";

// ─── Pure Helpers ─────────────────────────────────────────────────────────────

function getEffectivePrice(a: PortfolioAsset): number {
  const cp = Number(a.current_price);
  if (Number.isFinite(cp) && cp > 0) return cp;
  const bp = Number(a.buy_price);
  return Number.isFinite(bp) && bp > 0 ? bp : 0;
}

function getEffectiveValue(a: PortfolioAsset): number {
  if (a.current_value != null && a.current_value > 0) return a.current_value;
  const price = getEffectivePrice(a);
  if (a.amount_type === "quantity" && price > 0) return a.amount * price;
  return a.amount ?? 0;
}

// 해외주식·해외ETF만 과세 대상 (국내주식 소액주주 비과세)
function isTaxable(productType: string): boolean {
  return productType === "해외주식" || productType === "해외ETF";
}

function makeKey(a: PortfolioAsset): string {
  return `${a.name}::${a.ticker ?? ""}`;
}

// ─── 종목 펀더멘털 타입 (stock-metrics 응답 형상) ─────────────────────────────

interface StockDetail {
  price: number | null;
  per: number | null;
  pbr: number | null;
  psr: number | null;
  ebitda: number | null;
  revenue: number | null;
  currency: string;
  dataNote?: string;
}

// ─── 포맷 헬퍼 ─────────────────────────────────────────────────────────────────

function fmtDetailPrice(price: number | null, currency: string): string {
  if (price === null || !Number.isFinite(price)) return "N/A";
  if (currency === "KRW")
    return `${Math.round(price).toLocaleString("ko-KR")}원`;
  return `$${price.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function fmtDetailLarge(v: number | null, currency: string): string {
  if (v === null || !Number.isFinite(v) || v === 0) return "N/A";
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

function fmtMultiple(v: number | null, digits: number, dataNote?: string): string {
  if (v === null || !Number.isFinite(v))
    return dataNote === "krx-partial" ? "공시없음" : "N/A";
  return v.toFixed(digits);
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function SellSimulatorTab() {
  const {
    portfolioAssets, analysisResult,
    rebalancingSellAssets,           // 확정 매도 후 잔여 수량이 실시간 반영된 배열
    setRebalancingSellAssets,
    sellHistory, addSellRecord, availableInvestmentFunds, addBuyCost,
  } = useCustomerContext();
  const { isCustomerView } = useCustomerView();

  // 원본 포트폴리오 맵 — 추가 매수 배지 계산용
  const origAmountMap = useMemo(
    () => new Map(portfolioAssets.map((a) => [makeKey(a), a.amount])),
    [portfolioAssets],
  );

  // ─── 카드 그리드 기준 자산 ───────────────────────────────────────────────
  // rebalancingSellAssets: 매도 확정마다 수량이 차감되는 working copy
  // → 카드에 잔여 수량 실시간 반영 + 완전 매도 종목 0개 마킹
  // 비어 있으면(최초 접근) enriched/raw 폴백 사용
  const baseAssets = useMemo<PortfolioAsset[]>(() => {
    const enriched = (analysisResult?.enrichedAssets ?? []) as PortfolioAsset[];
    const priceMap = new Map(enriched.map((a) => [makeKey(a), a]));

    if (rebalancingSellAssets.length > 0) {
      return rebalancingSellAssets
        .filter((a) => a.name)
        .map((a) => {
          const e = priceMap.get(makeKey(a));
          const cp = Number(e?.current_price ?? a.current_price);
          return {
            ...a,
            current_price: cp > 0 ? cp : a.current_price,
            current_value: a.amount > 0 && cp > 0 ? a.amount * cp : 0,
          };
        });
    }
    // 최초 접근 — 분석 완료 여부에 따라 enriched 또는 raw 사용
    const src = enriched.length ? enriched : portfolioAssets;
    return src.filter((a) => a.name); // amount > 0 필터 없음 (0개 카드도 표시)
  }, [analysisResult, portfolioAssets, rebalancingSellAssets]);

  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [sellQtyStr, setSellQtyStr] = useState<string>("");

  // 매수/매도 모드 토글
  const [mode, setMode] = useState<"sell" | "buy">("sell");
  const [buyQtyStr, setBuyQtyStr] = useState<string>("");

  // ── 선택 종목 상세 (펀더멘털 + 1Y 차트) ────────────────────────────────────
  const [stockDetail, setStockDetail] = useState<StockDetail | null>(null);
  const [chartData, setChartData] = useState<{ date: string; price: number | null }[]>([]);
  const [isLoadingDetail, setIsLoadingDetail] = useState(false);

  const selectedAsset = useMemo(
    () => (selectedKey ? baseAssets.find((a) => makeKey(a) === selectedKey) ?? null : null),
    [baseAssets, selectedKey],
  );

  // 3개 독립 행: [국내주식+국내ETF] / [해외주식+해외ETF] / [채권(국내→해외 순)]
  const groupedCards = useMemo(() => {
    const domestic: PortfolioAsset[] = [];
    const foreign: PortfolioAsset[] = [];
    const bonds: PortfolioAsset[] = [];
    const others: PortfolioAsset[] = [];
    for (const a of baseAssets) {
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

  const maxQty = selectedAsset?.amount_type === "quantity" ? (selectedAsset.amount ?? 0) : 0;

  // 선택 종목 변경 시 펀더멘털 + 1Y 차트 데이터 로드
  useEffect(() => {
    const ticker = selectedAsset?.ticker;
    if (!ticker) {
      setStockDetail(null);
      setChartData([]);
      return;
    }
    let cancelled = false;
    setIsLoadingDetail(true);
    setStockDetail(null);
    setChartData([]);

    const productType = selectedAsset.productType ?? "해외주식";

    Promise.all([
      fetch(`/api/stock-metrics?ticker=${encodeURIComponent(ticker)}`).then((r) =>
        r.ok ? (r.json() as Promise<StockDetail>) : null,
      ),
      fetch(
        `/api/proxy-finance?assetName=${encodeURIComponent(ticker)}&productType=${encodeURIComponent(productType)}`,
      ).then((r) => r.ok ? (r.json() as Promise<Record<string, unknown>>) : null),
    ])
      .then(([metrics, raw]) => {
        if (cancelled) return;
        if (metrics) setStockDetail(metrics);
        if (raw) {
          const chartResult = (raw.chart as Record<string, unknown> | undefined)
            ?.result as Record<string, unknown>[] | undefined;
          const r0 = chartResult?.[0];
          const timestamps = (r0?.timestamp as number[] | undefined) ?? [];
          const closes =
            (
              (r0?.indicators as Record<string, unknown> | undefined)
                ?.quote as Record<string, unknown>[] | undefined
            )?.[0]?.close as (number | null)[] | undefined ?? [];
          const points = timestamps
            .map((ts, i) => ({
              date: new Date(ts * 1000).toLocaleDateString("ko-KR", {
                month: "short",
                day: "numeric",
              }),
              price: closes[i] ?? null,
            }))
            .filter((p) => p.price !== null && Number.isFinite(p.price));
          setChartData(points);
        }
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setIsLoadingDetail(false); });

    return () => { cancelled = true; };
  }, [selectedAsset?.ticker, selectedAsset?.productType]);

  const sellQty = useMemo(() => {
    const n = parseFloat(sellQtyStr);
    if (!Number.isFinite(n) || n <= 0) return 0;
    return maxQty > 0 ? Math.min(n, maxQty) : n;
  }, [sellQtyStr, maxQty]);

  const buyQty = useMemo(() => {
    const n = parseFloat(buyQtyStr);
    return Number.isFinite(n) && n > 0 ? n : 0;
  }, [buyQtyStr]);

  // 매수 비용 및 예산 가드
  const buyCost = useMemo(() => {
    if (!selectedAsset || buyQty <= 0 || mode !== "buy") return 0;
    return buyQty * getEffectivePrice(selectedAsset);
  }, [selectedAsset, buyQty, mode]);

  const isBuyOverBudget = useMemo(
    () => (availableInvestmentFunds != null && availableInvestmentFunds > 0 ? buyCost > availableInvestmentFunds : false),
    [buyCost, availableInvestmentFunds],
  );

  const remainingAfterBuy = useMemo(
    () => (availableInvestmentFunds !== null ? availableInvestmentFunds - buyCost : null),
    [availableInvestmentFunds, buyCost],
  );

  // 가용 자금 기준 최대 매수 수량
  const maxBuyQtyByFunds = useMemo(() => {
    if (!selectedAsset || !availableInvestmentFunds || availableInvestmentFunds <= 0) return null;
    const price = getEffectivePrice(selectedAsset);
    return price > 0 ? Math.floor(availableInvestmentFunds / price) : null;
  }, [selectedAsset, availableInvestmentFunds]);

  const handleBuyQtyChange = useCallback((val: string) => {
    if (maxBuyQtyByFunds !== null) {
      const n = parseFloat(val);
      if (Number.isFinite(n) && n > maxBuyQtyByFunds) {
        setBuyQtyStr(String(maxBuyQtyByFunds));
        return;
      }
    }
    setBuyQtyStr(val);
  }, [maxBuyQtyByFunds]);

  // 매수 시뮬레이션 — 선택 종목 수량 증가 후 도넛 재계산
  const simulatedBuyAssets = useMemo<PortfolioAsset[]>(() => {
    if (!selectedAsset || buyQty <= 0 || mode !== "buy") return baseAssets;
    return baseAssets.map((a) => {
      if (makeKey(a) !== selectedKey) return a;
      const price = getEffectivePrice(a);
      const newAmt = a.amount + buyQty;
      return {
        ...a,
        amount: newAmt,
        current_value: price > 0 ? newAmt * price : a.current_value,
      };
    });
  }, [baseAssets, selectedAsset, selectedKey, buyQty, mode]);

  // 수량 입력 — 오버플로우 가드: 최대 보유 수량 초과 시 자동 리셋
  const handleQtyChange = useCallback(
    (val: string) => {
      if (maxQty > 0) {
        const n = parseFloat(val);
        if (Number.isFinite(n) && n > maxQty) {
          setSellQtyStr(String(maxQty));
          return;
        }
      }
      setSellQtyStr(val);
    },
    [maxQty],
  );

  // 실시간 도넛 차트용 — 매도 수량 반영 시뮬레이션 자산
  const simulatedAssets = useMemo<PortfolioAsset[]>(() => {
    if (!selectedAsset || sellQty <= 0) return baseAssets;
    return baseAssets.map((a) => {
      if (makeKey(a) !== selectedKey) return a;
      const newAmt = Math.max(0, a.amount - sellQty);
      const price = getEffectivePrice(a);
      return {
        ...a,
        amount: newAmt,
        current_value: newAmt > 0 ? newAmt * price : 0,
        current_price: price > 0 ? price : a.current_price,
      };
    });
  }, [baseAssets, selectedAsset, selectedKey, sellQty]);

  // 선택 종목 손익 정보
  const pnlInfo = useMemo(() => {
    if (!selectedAsset) return null;
    const cp = getEffectivePrice(selectedAsset);
    const bp = Number(selectedAsset.buy_price);
    if (!(cp > 0) || !(bp > 0)) return null;
    const pct = ((cp - bp) / bp) * 100;
    const amt = (cp - bp) * selectedAsset.amount;
    return { pct, amt };
  }, [selectedAsset]);

  // 매수 확정 — rebalancingSellAssets에 수량 증가 반영 + 가용 자금 영구 차감
  const handleConfirmBuy = useCallback(() => {
    if (!selectedAsset || buyQty <= 0) return;
    const price = getEffectivePrice(selectedAsset);
    if (price <= 0) return;
    const cost = buyQty * price;
    const updated = baseAssets.map((a) => {
      if (makeKey(a) !== selectedKey) return a;
      const newAmt = a.amount + buyQty;
      return { ...a, amount: newAmt, current_value: newAmt * price };
    });
    setRebalancingSellAssets(updated);
    addBuyCost(cost);
    setBuyQtyStr("");
    setSelectedKey(null);
  }, [selectedAsset, buyQty, baseAssets, selectedKey, setRebalancingSellAssets, addBuyCost]);

  // 매도 확정 — 전역 Context에 누적 (탭 이동 후 복귀 시에도 유지)
  const handleConfirmSell = () => {
    if (!selectedAsset || sellQty <= 0) return;
    const price = getEffectivePrice(selectedAsset);
    if (price <= 0) return; // 현재가·매수단가 모두 없는 종목은 확정 불가
    const bp = selectedAsset.buy_price;
    const gain = bp != null ? (price - bp) * sellQty : 0;
    const record: SellRecord = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      name: selectedAsset.name,
      productType: selectedAsset.productType ?? selectedAsset.asset_class ?? "",
      sellPrice: price,
      sellQty,
      buyPrice: bp,
      realizedGain: gain,
    };
    addSellRecord(record); // Context → Supabase 즉시 동기화
    setSellQtyStr("");
    setSelectedKey(null);
  };

  // 세금 통산 — 순양도차익에서 250만 원 공제 후 22% 적용
  const taxInfo = useMemo(() => {
    if (!sellHistory.length) return null;
    const totalGain = sellHistory.reduce((s, r) => s + r.realizedGain, 0);
    const taxableNet = sellHistory
      .filter((r) => isTaxable(r.productType))
      .reduce((s, r) => s + r.realizedGain, 0);
    const tax = Math.max(0, taxableNet - 2_500_000) * 0.22;
    return { totalGain, taxableNet, tax };
  }, [sellHistory]);

  // TLH 후보 계산 — 확정 매도로 양도소득세가 발생할 때 기존 포트폴리오에서 손실 종목 탐색
  const tlhInfo = useMemo(() => {
    if (!taxInfo || taxInfo.tax <= 0) return null;
    const today = new Date();
    const isYearEnd = today.getMonth() === 11 && today.getDate() >= 21 && today.getDate() <= 26;
    const dec26 = new Date(today.getFullYear(), 11, 26);
    const daysLeft = isYearEnd
      ? Math.max(0, Math.ceil((dec26.getTime() - today.getTime()) / 86400000))
      : null;
    const baseCandidates = baseAssets
      .filter(
        (a) =>
          (a.productType === "해외주식" || a.productType === "해외ETF") &&
          a.buy_price != null && a.buy_price > 0 &&
          a.current_price != null && (a.current_price as number) > 0 &&
          a.amount_type === "quantity" && a.amount > 0,
      )
      .map((a) => {
        const cp = a.current_price as number;
        const bp = a.buy_price!;
        const unrealizedGain = (cp - bp) * a.amount;
        const lossRate = (cp - bp) / bp;
        const newNetGains = taxInfo.taxableNet + unrealizedGain;
        const newTax = newNetGains > 2_500_000 ? Math.round((newNetGains - 2_500_000) * 0.22) : 0;
        const taxSaving = Math.max(0, Math.round(taxInfo.tax) - newTax);
        return {
          name: a.name, ticker: a.ticker ?? "",
          unrealizedGain, lossRate, taxSaving,
          amount: a.amount, buyPrice: bp, currentPrice: cp,
        };
      })
      .filter((c) => c.unrealizedGain < 0);
    const hasAny = isYearEnd
      ? baseCandidates.length > 0
      : baseCandidates.some((c) => c.taxSaving >= 1_000_000 || c.lossRate <= -0.15);
    if (!hasAny) return null;
    return { baseCandidates, isYearEnd, daysLeft, netCapitalGains: taxInfo.taxableNet, capitalGainsTax: Math.round(taxInfo.tax) };
  }, [taxInfo, baseAssets]);

  return (
    <div className="space-y-6">

      {/* ── [1] 상단: 보유 자산 카드 그리드 ───────────────────────────────── */}
      {/* 자산 미로드 시에도 sellHistory 섹션은 유지 — early return 제거 */}
      {baseAssets.length === 0 ? (
        <div className="flex min-h-[320px] items-center justify-center rounded-lg border border-dashed border-slate-200 bg-slate-50">
          <p className="text-sm font-semibold text-slate-400">
            TAB 2-1에서 자산을 입력하고 분석 실행 후 이 화면으로 돌아오세요.
          </p>
        </div>
      ) : (
      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-soft">
        <p className="mb-3 text-[10px] font-extrabold uppercase tracking-widest text-slate-400">
          보유 자산 선택 — 매도 시뮬레이션할 종목을 클릭하세요
        </p>
        <div className="flex flex-col gap-3">
          {groupedCards.map((group, gi) => (
          <div key={gi} className="flex flex-wrap gap-3">
          {group.assets.map((a) => {
            const cls = normalizeAssetClass(a.asset_class ?? a.productType ?? "기타");
            const color = CLASS_COLORS[cls] ?? "#94a3b8";
            const key = makeKey(a);
            const isSel = selectedKey === key;
            const isSoldOut = a.amount_type === "quantity" && a.amount <= 0;
            const cp = getEffectivePrice(a);
            const val = getEffectiveValue(a);
            const bp = Number(a.buy_price);
            const gainPct = cp > 0 && bp > 0 ? ((cp - bp) / bp) * 100 : null;
            const origAmt = origAmountMap.get(key);
            const addedQty =
              !isSoldOut && origAmt != null && a.amount_type === "quantity" && a.amount > origAmt
                ? a.amount - origAmt
                : null;
            return (
              <button
                key={key}
                type="button"
                disabled={isSoldOut}
                onClick={() => {
                  if (isSoldOut) return;
                  setSelectedKey(isSel ? null : key);
                  setSellQtyStr("");
                  setBuyQtyStr("");
                }}
                className={`relative flex flex-col gap-1 rounded-xl border-2 px-4 py-3 text-left transition-all duration-150 ${
                  isSoldOut
                    ? "cursor-not-allowed opacity-50"
                    : "hover:shadow-md"
                }`}
                style={{
                  borderColor: isSoldOut ? "#cbd5e1" : isSel ? color : color + "55",
                  backgroundColor: isSoldOut ? "#f8fafc" : isSel ? color + "12" : "#ffffff",
                  minWidth: "9rem",
                }}
              >
                {addedQty !== null && addedQty > 0 && (
                  <span className="absolute right-2 -top-2.5 z-10 rounded bg-red-500 px-1.5 py-0.5 text-[9px] font-bold leading-none text-white shadow-sm ring-1 ring-white">
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
                <span className={`mt-1 max-w-[148px] truncate text-sm font-bold leading-tight ${isSoldOut ? "text-slate-400 line-through" : "text-navy"}`}>
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
              </button>
            );
          })}
          </div>
          ))}
        </div>
      </section>
      )} {/* baseAssets.length > 0 조건부 블록 끝 */}

      {/* ── [2] 중간: 실시간 매도/매수 조율 ─────────────────────────────────── */}
      {selectedAsset && selectedAsset.amount > 0 && (
        <section className="grid grid-cols-1 gap-5 lg:grid-cols-2">

          {/* 좌측: 선택 종목 명세 + 펀더멘털 + 1Y 차트 */}
          <div className="space-y-4 overflow-y-auto rounded-xl border border-slate-200 bg-white p-5 shadow-soft">
            <p className="text-[10px] font-extrabold uppercase tracking-widest text-slate-400">선택 종목 명세</p>
            <div className="flex items-start gap-3">
              <span
                className="mt-1 h-3 w-3 shrink-0 rounded-full"
                style={{
                  backgroundColor:
                    CLASS_COLORS[normalizeAssetClass(selectedAsset.asset_class ?? selectedAsset.productType ?? "기타")] ??
                    "#94a3b8",
                }}
              />
              <div>
                <p className="text-xl font-black leading-tight text-navy">
                  {formatLocalTickerName(selectedAsset.name, selectedAsset.ticker, portfolioAssets)}
                </p>
                {selectedAsset.ticker && (
                  <p className="mt-0.5 font-mono text-[10px] text-slate-400">{selectedAsset.ticker}</p>
                )}
                <p className="mt-0.5 text-xs text-slate-500">
                  {selectedAsset.productType ?? selectedAsset.asset_class}
                </p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              {[
                {
                  label: "매수단가",
                  val:
                    selectedAsset.buy_price != null
                      ? formatKrwAmount(selectedAsset.buy_price)
                      : "—",
                },
                {
                  label: "현재가",
                  val:
                    getEffectivePrice(selectedAsset) > 0
                      ? formatKrwAmount(getEffectivePrice(selectedAsset))
                      : "—",
                },
                {
                  label: "보유수량",
                  val:
                    selectedAsset.amount_type === "quantity"
                      ? `${selectedAsset.amount.toLocaleString()}주`
                      : "평가액",
                },
                {
                  label: "평가금액",
                  val:
                    getEffectiveValue(selectedAsset) > 0
                      ? formatKrwAmount(getEffectiveValue(selectedAsset))
                      : "—",
                },
              ].map(({ label, val }) => (
                <div key={label} className="rounded-lg bg-slate-50 px-3 py-2.5">
                  <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{label}</p>
                  <p className="mt-1 text-sm font-bold text-navy">{val}</p>
                </div>
              ))}
            </div>

            {pnlInfo && (
              <div
                className={`flex items-center justify-between rounded-lg px-4 py-3 ${
                  pnlInfo.pct >= 0 ? "bg-emerald-50" : "bg-red-50"
                }`}
              >
                <div className="flex items-center gap-2">
                  {pnlInfo.pct >= 0 ? (
                    <TrendingUp size={15} className="text-emerald-600" />
                  ) : (
                    <TrendingDown size={15} className="text-red-500" />
                  )}
                  <span
                    className={`text-lg font-black ${
                      pnlInfo.pct >= 0 ? "text-emerald-700" : "text-red-600"
                    }`}
                  >
                    {pnlInfo.pct >= 0 ? "+" : ""}
                    {pnlInfo.pct.toFixed(2)}%
                  </span>
                </div>
                <span
                  className={`text-sm font-semibold ${
                    pnlInfo.pct >= 0 ? "text-emerald-600" : "text-red-500"
                  }`}
                >
                  {pnlInfo.amt >= 0 ? "+" : ""}
                  {formatKrwAmount(pnlInfo.amt)}
                </span>
              </div>
            )}

            {/* ── 펀더멘털 지표 전광판 ── */}
            {isLoadingDetail && !stockDetail && (
              <div className="flex items-center gap-2 py-1 text-xs text-slate-400">
                <Loader2 size={12} className="animate-spin" />
                실무 지표 로드 중…
              </div>
            )}
            {stockDetail && (
              <div>
                <p className="mb-2 text-[10px] font-extrabold uppercase tracking-widest text-slate-400">
                  실무 핵심 지표
                </p>
                <div className="grid grid-cols-3 gap-2">
                  {[
                    {
                      label: "현재가",
                      value: fmtDetailPrice(stockDetail.price, stockDetail.currency),
                    },
                    {
                      label: "PER",
                      value: fmtMultiple(stockDetail.per, 1, stockDetail.dataNote),
                    },
                    {
                      label: "PBR",
                      value: fmtMultiple(stockDetail.pbr, 2, stockDetail.dataNote),
                    },
                    {
                      label: "PSR",
                      value: fmtMultiple(stockDetail.psr, 2, stockDetail.dataNote),
                    },
                    {
                      label: "EBITDA",
                      value:
                        fmtDetailLarge(stockDetail.ebitda, stockDetail.currency) === "N/A" &&
                        stockDetail.dataNote === "krx-partial"
                          ? "공시없음"
                          : fmtDetailLarge(stockDetail.ebitda, stockDetail.currency),
                    },
                    {
                      label: "직전매출",
                      value:
                        fmtDetailLarge(stockDetail.revenue, stockDetail.currency) === "N/A" &&
                        stockDetail.dataNote === "krx-partial"
                          ? "공시없음"
                          : fmtDetailLarge(stockDetail.revenue, stockDetail.currency),
                    },
                  ].map(({ label, value }) => (
                    <div key={label} className="rounded-lg bg-slate-50 p-2">
                      <div className="text-[9px] font-bold text-slate-400">{label}</div>
                      <div className="mt-0.5 text-xs font-bold text-navy">{value}</div>
                    </div>
                  ))}
                </div>
                <p className="mt-1.5 text-[9px] text-slate-400">
                  * Yahoo Finance 실시간 데이터 기준
                </p>
              </div>
            )}

            {/* ── 1Y 주가 추이 차트 ── */}
            {chartData.length > 1 && (
              <div>
                <p className="mb-1.5 text-[10px] font-extrabold uppercase tracking-widest text-slate-400">
                  1Y 주가 추이
                </p>
                <ResponsiveContainer width="100%" height={148}>
                  <LineChart
                    data={chartData}
                    margin={{ top: 4, right: 4, bottom: 0, left: 0 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                    <XAxis
                      dataKey="date"
                      tick={{ fontSize: 8 }}
                      interval="preserveStartEnd"
                    />
                    <YAxis
                      tick={{ fontSize: 8 }}
                      width={52}
                      tickFormatter={(v: number) =>
                        v.toLocaleString("ko-KR", { maximumFractionDigits: 0 })
                      }
                    />
                    <Tooltip
                      contentStyle={{ fontSize: 10 }}
                      formatter={(v: unknown) => {
                        const n = typeof v === "number" ? v : NaN;
                        return [
                          Number.isFinite(n)
                            ? n.toLocaleString("ko-KR", { maximumFractionDigits: 2 })
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
            )}
          </div>

          {/* 우측: 수량 입력 + 실시간 도넛 차트 */}
          <div className="space-y-4 rounded-xl border border-slate-200 bg-white p-5 shadow-soft">
            {/* 매수/매도 모드 토글 */}
            <div className="flex rounded-lg border border-slate-200 p-0.5">
              <button
                type="button"
                onClick={() => { setMode("sell"); setBuyQtyStr(""); }}
                className={`flex-1 rounded-md py-2 text-sm font-bold transition ${mode === "sell" ? "bg-samsung text-white shadow-sm" : "text-slate-500 hover:text-navy"}`}
              >
                매도
              </button>
              <button
                type="button"
                onClick={() => { setMode("buy"); setSellQtyStr(""); }}
                className={`flex-1 rounded-md py-2 text-sm font-bold transition ${mode === "buy" ? "bg-emerald-600 text-white shadow-sm" : "text-slate-500 hover:text-navy"}`}
              >
                추가 매수
              </button>
            </div>

            <p className="text-[10px] font-extrabold uppercase tracking-widest text-slate-400">
              {mode === "sell" ? "매도 수량 입력 및 매도 후 예상 비중" : "매수 수량 입력 및 매수 후 예상 비중"}
            </p>

            {mode === "sell" ? (
              <>
                <div className="flex flex-wrap items-center gap-3">
                  <input
                    type="number"
                    min={0}
                    max={maxQty > 0 ? maxQty : undefined}
                    value={sellQtyStr}
                    onChange={(e) => handleQtyChange(e.target.value)}
                    onBlur={() => {
                      if (maxQty > 0 && parseFloat(sellQtyStr) > maxQty) setSellQtyStr(String(maxQty));
                    }}
                    placeholder="0"
                    disabled={isCustomerView}
                    className="w-28 rounded-lg border border-slate-300 bg-slate-50 px-3 py-2.5 text-center text-lg font-bold text-navy focus:border-samsung focus:outline-none focus:ring-1 focus:ring-samsung disabled:cursor-not-allowed disabled:opacity-50"
                  />
                  <span className="text-sm font-semibold text-slate-500">
                    개 매도 시
                    {maxQty > 0 && (
                      <span className="ml-1 text-slate-400">(최대 {maxQty.toLocaleString()}주)</span>
                    )}
                  </span>
                </div>

                {sellQty > 0 && selectedAsset.buy_price != null && (
                  <div className="rounded-lg bg-slate-50 px-4 py-2.5 text-xs font-semibold text-slate-600">
                    예상 실현손익:{" "}
                    {(() => {
                      const gain = (getEffectivePrice(selectedAsset) - selectedAsset.buy_price) * sellQty;
                      return (
                        <span className={`font-black ${gain >= 0 ? "text-emerald-600" : "text-red-600"}`}>
                          {gain >= 0 ? "+" : ""}{formatKrwAmount(gain)}
                        </span>
                      );
                    })()}
                  </div>
                )}

                <div className="flex justify-center">
                  <DonutChart assets={simulatedAssets} />
                </div>

                <button
                  type="button"
                  onClick={handleConfirmSell}
                  disabled={sellQty <= 0 || isCustomerView}
                  className="flex w-full items-center justify-center gap-2 rounded-lg bg-samsung px-4 py-3 text-sm font-bold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <CheckCircle2 size={16} />
                  매도 확정
                </button>
              </>
            ) : (
              <>
                <div className="flex flex-wrap items-center gap-3">
                  <input
                    type="number"
                    min={1}
                    max={maxBuyQtyByFunds ?? undefined}
                    value={buyQtyStr}
                    onChange={(e) => handleBuyQtyChange(e.target.value)}
                    onBlur={() => {
                      if (maxBuyQtyByFunds !== null && parseFloat(buyQtyStr) > maxBuyQtyByFunds)
                        setBuyQtyStr(String(maxBuyQtyByFunds));
                    }}
                    placeholder="0"
                    disabled={isCustomerView}
                    className={`w-28 rounded-lg border px-3 py-2.5 text-center text-lg font-bold text-navy focus:outline-none focus:ring-1 disabled:cursor-not-allowed disabled:opacity-50 ${
                      isBuyOverBudget && !isCustomerView
                        ? "border-red-400 bg-red-50 focus:border-red-500 focus:ring-red-400"
                        : "border-slate-300 bg-slate-50 focus:border-emerald-500 focus:ring-emerald-500"
                    }`}
                  />
                  <span className="text-sm font-semibold text-slate-500">
                    주 추가 매수
                    {maxBuyQtyByFunds !== null && (
                      <span className="ml-1 text-slate-400">(최대 {maxBuyQtyByFunds.toLocaleString()}주)</span>
                    )}
                  </span>
                </div>

                {buyQty > 0 && (
                  <div className={`rounded-lg px-4 py-2.5 text-xs font-semibold ${isBuyOverBudget ? "bg-red-50 text-red-700" : "bg-emerald-50 text-slate-600"}`}>
                    <div className="flex flex-wrap items-center gap-x-2">
                      <span>매수 예정: </span>
                      <span className={`font-black ${isBuyOverBudget ? "text-red-600" : "text-emerald-700"}`}>
                        {formatKrwAmount(buyCost)}
                      </span>
                      {isBuyOverBudget && <span className="font-bold text-red-500">— 가용 자금 초과!</span>}
                    </div>
                    {remainingAfterBuy !== null && (
                      <div className={`mt-0.5 text-[10px] ${isBuyOverBudget ? "text-red-400" : "text-slate-400"}`}>
                        잔여 가용: {formatKrwAmount(remainingAfterBuy)}
                        {availableInvestmentFunds !== null && (
                          <span className="ml-1">(총 가용: {formatKrwAmount(availableInvestmentFunds)})</span>
                        )}
                      </div>
                    )}
                  </div>
                )}

                <div className="flex justify-center">
                  <DonutChart assets={simulatedBuyAssets} />
                </div>

                <button
                  type="button"
                  onClick={handleConfirmBuy}
                  disabled={buyQty <= 0 || isBuyOverBudget || isCustomerView}
                  className="flex w-full items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 py-3 text-sm font-bold text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <CheckCircle2 size={16} />
                  매수 확정
                </button>
              </>
            )}
          </div>
        </section>
      )}

      {/* ── [3] 하단: 매도 현황 + 세금 통산 (확정 1건 이상 시 조건부 렌더링) ── */}
      {sellHistory.length > 0 && (
        <section className="grid grid-cols-1 gap-5 lg:grid-cols-2">

          {/* 좌측: 확정 매도 내역 테이블 */}
          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-soft">
            <div className="flex items-center gap-2 border-b border-slate-100 bg-slate-50 px-5 py-3">
              <Receipt size={14} className="text-slate-400" />
              <p className="text-[10px] font-extrabold uppercase tracking-widest text-slate-400">
                확정 매도 현황
              </p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full table-fixed text-xs">
                <thead className="border-b border-slate-100 bg-slate-50">
                  <tr>
                    <th className="w-[32%] px-3 py-2 text-left font-bold text-slate-500">종목명</th>
                    <th className="w-[22%] px-3 py-2 text-right font-bold text-slate-500">매도단가(현재가)</th>
                    <th className="w-[16%] px-3 py-2 text-right font-bold text-slate-500">매도수량</th>
                    <th className="w-[30%] px-3 py-2 text-right font-bold text-slate-500">실현손익</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {sellHistory.map((r) => (
                    <tr key={r.id} className="bg-white hover:bg-slate-50">
                      <td className="max-w-0 truncate px-3 py-2.5 font-semibold text-navy">
                        {r.name}
                      </td>
                      <td className="px-3 py-2.5 text-right text-slate-700">
                        {formatKrwAmount(r.sellPrice)}
                      </td>
                      <td className="px-3 py-2.5 text-right text-slate-700">
                        {r.sellQty.toLocaleString()}
                      </td>
                      <td
                        className={`px-3 py-2.5 text-right font-bold ${
                          r.realizedGain >= 0 ? "text-emerald-600" : "text-red-600"
                        }`}
                      >
                        {r.realizedGain >= 0 ? "+" : ""}
                        {formatKrwAmount(r.realizedGain)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* 우측: 포트폴리오 통합 세금 통산 스코어보드 */}
          {taxInfo && (
            <div className="rounded-xl border border-red-100 bg-white p-6 shadow-soft">
              <p className="mb-4 text-[10px] font-extrabold uppercase tracking-widest text-red-500">
                포트폴리오 통합 세금 통산
              </p>

              <div className="space-y-2.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-slate-500">총 실현손익 (전체 종목)</span>
                  <span
                    className={`font-bold ${
                      taxInfo.totalGain >= 0 ? "text-emerald-600" : "text-red-500"
                    }`}
                  >
                    {taxInfo.totalGain >= 0 ? "+" : ""}
                    {formatKrwAmount(taxInfo.totalGain)}
                  </span>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-slate-500">
                    과세 대상 손익 (해외주식·ETF 통산)
                  </span>
                  <span
                    className={`font-bold ${
                      taxInfo.taxableNet >= 0 ? "text-emerald-600" : "text-slate-400"
                    }`}
                  >
                    {taxInfo.taxableNet >= 0 ? "+" : ""}
                    {formatKrwAmount(taxInfo.taxableNet)}
                  </span>
                </div>
                <div className="flex items-center justify-between text-xs text-slate-400">
                  <span>기본공제</span>
                  <span className="font-semibold">− 250만 원</span>
                </div>
                <div className="flex items-center justify-between text-xs text-slate-400">
                  <span>양도소득세율</span>
                  <span className="font-semibold">22% (지방세 포함)</span>
                </div>
                <div className="my-1 border-t border-red-100" />

                {/* 발생 가능 양도소득세 스코어보드 */}
                <div>
                  <p className="mb-1.5 text-xs font-bold text-red-500">발생 가능 양도소득세</p>
                  <p
                    className={`font-black leading-none ${
                      taxInfo.tax > 0 ? "text-5xl text-red-600" : "text-2xl text-emerald-600"
                    }`}
                  >
                    {taxInfo.tax > 0 ? formatKrwAmount(taxInfo.tax) : "비과세"}
                  </p>
                  {taxInfo.tax === 0 && taxInfo.taxableNet > 0 && (
                    <p className="mt-2 text-xs text-slate-400">
                      기본공제 250만 원 이하 — 납부 세액 없음
                    </p>
                  )}
                  {taxInfo.tax === 0 && taxInfo.taxableNet <= 0 && (
                    <p className="mt-2 text-xs text-slate-400">
                      국내주식 소액주주 비과세 적용 또는 손실 통산 완료
                    </p>
                  )}
                </div>
              </div>

              {availableInvestmentFunds !== null && (
                <div className="mt-3 rounded-lg border border-blue-100 bg-blue-50 px-3 py-2.5">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-blue-500">
                    가용 추가 투자 의향 자금 (d = b + (a − c))
                  </p>
                  <p className="mt-1 text-xl font-black text-blue-700">
                    {formatKrwAmount(availableInvestmentFunds)}
                  </p>
                  <p className="mt-0.5 text-[10px] text-blue-400">
                    TAB3 매수 배분 시 분모 기준 — 매도 확정 건이 늘어날수록 실시간 갱신
                  </p>
                </div>
              )}
              <div className="mt-3 rounded-lg bg-red-50 px-3 py-2">
                <p className="text-[10px] font-semibold leading-relaxed text-red-400">
                  * 국내주식(소액주주)·국내ETF는 비과세. 해외주식·해외ETF 순이익만 손익 통산 적용.
                  <br />
                  산식: max(0, 과세 대상 순이익 − 250만 원) × 22%
                </p>
              </div>
            </div>
          )}
        </section>
      )}

      {/* ── [4] TLH 절세 전략 — 양도소득세 발생 시 기존 포트폴리오 손실 종목 제안 ── */}
      {tlhInfo && (
        <section className="rounded-xl border border-blue-200 bg-white p-5 shadow-soft">
          <div className="mb-3 flex items-center gap-2 border-b border-slate-100 pb-3">
            <span className="text-[10px] font-extrabold uppercase tracking-widest text-blue-600">
              절세 전략 TLH
            </span>
            <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-bold text-blue-700">
              기존 포트폴리오 손실 종목 활용
            </span>
          </div>
          <TLHTabContent
            baseCandidates={tlhInfo.baseCandidates}
            isYearEnd={tlhInfo.isYearEnd}
            daysLeft={tlhInfo.daysLeft}
            netCapitalGains={tlhInfo.netCapitalGains}
            capitalGainsTax={tlhInfo.capitalGainsTax}
          />
        </section>
      )}
    </div>
  );
}
