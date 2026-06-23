"use client";

import { useState, useMemo } from "react";
import { AlertTriangle } from "lucide-react";

// ─── 상수 ──────────────────────────────────────────────────────────────────────
export const THRESHOLD = 20_000_000; // 금융소득 종합과세 기준
export const FINANCIAL_INCOME_STORAGE_KEY = "financial-income-summary-v1";
export const NEW_PORTFOLIO_INCOME_STORAGE_KEY = "new-portfolio-income-summary-v1";
export const FINANCIAL_INCOME_RESET_KEY = "financial-income-reset-v1";

const INTEREST_WITHHOLDING  = 0.154; // 이자소득 원천징수 14% + 지방세 1.4%
const DOMESTIC_DIV_WITHHOLDING = 0.154;
const FOREIGN_DIV_WITHHOLDING  = 0.15;  // 미국 조세조약 기준

// ─── 타입 ──────────────────────────────────────────────────────────────────────
export interface IncomeBreakdownItem {
  name: string;
  ticker: string;
  incomeType: "배당" | "이자" | "배당(국내직접)" | "배당(해외직접)" | "배당(집합투자)";
  annualIncome: number;    // 연간 gross 소득 (세전, 원)
  netIncome: number;       // 실수령 (원천징수 차감, 원)
  yieldRate: number;       // 수익률 (소수)
  value: number;           // 보유 평가액 (원)
  principal?: number;      // 채권 원금 (buy_price × 수량)
  withholdingRate: number; // 원천징수율 (소수)
}

export interface CapitalGainsBreakdownItem {
  name: string;
  ticker: string;
  gain: number;
  tax: number;
  category: "해외주식" | "국내대주주" | "해외펀드";
}

export interface FinancialIncomeSummary {
  interestIncome: number;
  dividendIncome: number;
  totalCapitalGains: number;
  totalCapitalLosses: number;
  netCapitalGains: number;
  foreignCapitalGainsTax: number;
  domesticMajorShareholderTax: number;
  capitalGainsTax: number;
  totalFinancialIncome: number;
  grossUpAmount: number;
  taxableFinancialIncome: number;
  generalTax: number;
  comparisonTax: number;
  finalTax: number;
  dividendTaxCredit: number;
  withholdingTax: number;
  additionalTax: number;
  tMarginal: number;
  isOverThreshold: boolean;
  breakdown: IncomeBreakdownItem[];
  capitalGainsBreakdown: CapitalGainsBreakdownItem[];
  majorShareholderWarning: boolean;
  majorShareholderItems: { name: string; ticker: string; value: number; estimatedTax: number }[];
  updatedAt: number;
}

// ─── TLH 타입 ──────────────────────────────────────────────────────────────────
export interface TLHAsset {
  name: string;
  ticker: string;
  buy_price?: number | null;
  current_price?: number;
  amount: number;
  amount_type: "quantity" | "value";
  productType?: string;
}

export interface TLHData {
  assets: TLHAsset[];
  netCapitalGains: number;
  capitalGainsTax: number;
}

// ─── 포맷 유틸 ─────────────────────────────────────────────────────────────────
function fmtWon(n: number) {
  if (Math.abs(n) >= 100_000_000) return `${(n / 100_000_000).toFixed(1)}억원`;
  if (Math.abs(n) >= 10_000) return `${Math.round(n / 10_000).toLocaleString("ko-KR")}만원`;
  return `${Math.round(n).toLocaleString("ko-KR")}원`;
}

function fmtPct(n: number) {
  return `${(n * 100).toFixed(2)}%`;
}

// ─── IncomeRow ─────────────────────────────────────────────────────────────────
function IncomeRow({ item }: { item: IncomeBreakdownItem }) {
  const isInterest = item.incomeType === "이자";

  const tagLabel = isInterest ? null :
    item.incomeType === "배당(국내직접)" ? "국내직접" :
    item.incomeType === "배당(해외직접)" ? "해외직접" :
    item.incomeType === "배당(집합투자)" ? "집합투자" : "배당";

  return (
    <div className="flex items-center justify-between gap-2 py-1.5 border-b border-slate-50 last:border-0">
      <div className="flex items-center gap-1.5 min-w-0 flex-1 text-xs">
        <span className="font-bold text-navy truncate">{item.name}</span>
        {item.ticker && (
          <span className="text-[10px] text-slate-400 font-mono shrink-0">({item.ticker})</span>
        )}
        {isInterest ? (
          <>
            <span className="text-[10px] text-slate-500 shrink-0">이자율 {fmtPct(item.yieldRate)}</span>
            {item.principal != null && item.principal > 0 && (
              <span className="text-[10px] text-slate-400 shrink-0">원금 {fmtWon(item.principal)}</span>
            )}
          </>
        ) : (
          <>
            <span className="text-[10px] text-slate-500 shrink-0">배당률 {fmtPct(item.yieldRate)}</span>
            {tagLabel && (
              <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[9px] font-bold text-slate-500 shrink-0">
                {tagLabel}
              </span>
            )}
          </>
        )}
      </div>
      <div className="shrink-0 text-xs font-bold text-samsung">
        {fmtWon(item.annualIncome)}
      </div>
    </div>
  );
}

// ─── CapitalGainsRow ───────────────────────────────────────────────────────────
function CapitalGainsRow({ item }: { item: CapitalGainsBreakdownItem }) {
  return (
    <div className="flex items-center justify-between gap-2 py-1.5 border-b border-slate-50 last:border-0">
      <div className="flex items-center gap-1.5 min-w-0 flex-1 text-xs">
        <span className="font-bold text-navy truncate">{item.name}</span>
        {item.ticker && (
          <span className="text-[10px] text-slate-400 font-mono shrink-0">({item.ticker})</span>
        )}
        <span className={`text-[10px] shrink-0 font-semibold ${item.gain >= 0 ? "text-blue-600" : "text-red-500"}`}>
          차익 {fmtWon(item.gain)}
        </span>
        <span className="rounded-full bg-orange-50 px-1.5 py-0.5 text-[9px] font-bold text-orange-600 shrink-0">
          {item.category}
        </span>
      </div>
      <div className="shrink-0 text-xs font-bold text-orange-600">
        세액 {fmtWon(item.tax)}
      </div>
    </div>
  );
}

// ─── FinancialIncomeGauge ──────────────────────────────────────────────────────
interface FinancialIncomeGaugeProps {
  summary: FinancialIncomeSummary | null;
  additionalIncome?: number;
  tlhData?: TLHData;
  hideCapitalGains?: boolean;
}

export function FinancialIncomeGauge({
  summary,
  additionalIncome = 0,
  tlhData,
  hideCapitalGains = false,
}: FinancialIncomeGaugeProps) {
  const [activeTab, setActiveTab] = useState<"배당" | "이자" | "양도">("배당");
  const [taxDetailExpanded, setTaxDetailExpanded] = useState(false);
  const [yangdoSubTab, setYangdoSubTab] = useState<"양도소득세" | "TLH">("양도소득세");
  const [showAllDividends, setShowAllDividends] = useState(false);
  const [showAllInterest, setShowAllInterest] = useState(false);

  const ITEM_LIMIT = 7;

  // TLH 탭 표시 여부 및 기초 데이터 (B패널에만 tlhData가 전달됨)
  const tlhComputed = useMemo(() => {
    if (!tlhData) return null;
    const today = new Date();
    const isYearEnd = today.getMonth() === 11 && today.getDate() >= 21 && today.getDate() <= 26;
    const dec26 = new Date(today.getFullYear(), 11, 26);
    const daysLeft = isYearEnd
      ? Math.max(0, Math.ceil((dec26.getTime() - today.getTime()) / 86400000))
      : null;

    const baseCandidates = tlhData.assets
      .filter(
        (a) =>
          (a.productType === "해외주식" || a.productType === "해외ETF") &&
          a.buy_price != null && a.buy_price > 0 &&
          a.current_price != null && a.current_price > 0 &&
          a.amount_type === "quantity"
      )
      .map((a) => {
        const unrealizedGain = (a.current_price! - a.buy_price!) * a.amount;
        const lossRate = (a.current_price! - a.buy_price!) / a.buy_price!;
        const newNetGains = tlhData.netCapitalGains + unrealizedGain;
        const newTax = newNetGains > 2_500_000 ? Math.round((newNetGains - 2_500_000) * 0.22) : 0;
        const taxSaving = Math.max(0, tlhData.capitalGainsTax - newTax);
        return { name: a.name, ticker: a.ticker, unrealizedGain, lossRate, taxSaving };
      })
      .filter((c) => c.unrealizedGain < 0);

    const hasAny = isYearEnd
      ? baseCandidates.length > 0
      : baseCandidates.some((c) => c.taxSaving >= 1_000_000 || c.lossRate <= -0.15);

    return { baseCandidates, isYearEnd, daysLeft, hasAny };
  }, [tlhData]);

  const baseIncome = summary?.totalFinancialIncome ?? 0;
  const totalIncome = baseIncome + additionalIncome;
  const basePct = Math.min((baseIncome / THRESHOLD) * 100, 100);
  const totalPct = Math.min((totalIncome / THRESHOLD) * 100, 100);
  const isOver = totalIncome > THRESHOLD;
  const remaining = Math.max(THRESHOLD - totalIncome, 0);

  const gaugeColor =
    totalPct >= 100 ? "#dc2626" :
    totalPct >= 80  ? "#f59e0b" :
    totalPct >= 50  ? "#2563eb" : "#10b981";

  const statusLabel =
    totalPct >= 100 ? "종합과세 해당" :
    totalPct >= 80  ? "종합과세 임박" :
    totalPct >= 50  ? "주의 구간"    : "안전 구간";

  const dividendItems = (summary?.breakdown ?? []).filter(b => b.incomeType.startsWith("배당"));
  const interestItems = (summary?.breakdown ?? []).filter(b => b.incomeType === "이자");
  const visibleGainsItems = (summary?.capitalGainsBreakdown ?? []).filter(item => item.gain !== 0);


  return (
    <div className="rounded-xl border border-slate-200 bg-white shadow-soft overflow-hidden flex-1">

      {/* 헤더 */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
        <span className="text-xs font-extrabold uppercase tracking-widest text-slate-400">
          금융소득종합과세 및 해외양도세 점검
        </span>
        <span
          className="text-[10px] font-bold px-2 py-0.5 rounded-full"
          style={{
            backgroundColor: isOver ? "#fee2e2" : "#f0fdf4",
            color: isOver ? "#dc2626" : "#16a34a",
          }}
        >
          {statusLabel}
        </span>
      </div>

      {/* 금액 + 게이지 */}
      <div className="px-4 pt-4 pb-3">
        <div className="flex items-end gap-1.5 mb-1">
          <span className="text-3xl font-black tracking-tight text-slate-800">
            {fmtWon(totalIncome)}
          </span>
          <span className="text-sm font-bold text-slate-400 pb-1">/ 2,000만원</span>
        </div>
        <div className="text-[11px] text-slate-500 mb-3">
          배당소득 {fmtWon(summary?.dividendIncome ?? 0)} + 이자소득 {fmtWon(summary?.interestIncome ?? 0)}
          <span className="ml-1.5 text-slate-400">(세전 합산, 종합과세 기준)</span>
        </div>

        {/* 게이지 바 */}
        <div className="relative h-3 w-full rounded-full bg-slate-100 overflow-hidden">
          <div
            className="absolute left-0 top-0 h-full rounded-full transition-all duration-700 ease-out"
            style={{ width: `${basePct}%`, backgroundColor: gaugeColor }}
          />
          {additionalIncome > 0 && (
            <div
              className="absolute top-0 h-full rounded-r-full transition-all duration-700 ease-out"
              style={{
                left: `${basePct}%`,
                width: `${Math.min((additionalIncome / THRESHOLD) * 100, 100 - basePct)}%`,
                backgroundColor: "#7c3aed",
                opacity: 0.75,
              }}
            />
          )}
        </div>

        {/* 눈금 */}
        <div className="flex justify-between mt-1">
          <span className="text-[10px] text-slate-400">0</span>
          <span className="text-[10px] text-slate-500 font-bold">1,000만원</span>
          <span className="text-[10px] text-slate-400">2,000만원</span>
        </div>

        {/* 상태 메시지 */}
        <div className="mt-3">
          {isOver ? (
            <div className="flex items-start gap-2 rounded-lg bg-red-50 border border-red-200 px-3 py-2.5">
              <AlertTriangle size={14} className="shrink-0 text-red-500 mt-0.5" />
              <p className="text-xs font-semibold text-red-700 leading-snug">
                2,000만원을 <strong>{fmtWon(totalIncome - THRESHOLD)}</strong> 초과.
                금융소득 종합과세 신고 대상입니다.
              </p>
            </div>
          ) : (
            <div className="rounded-lg bg-emerald-50 px-3 py-2">
              <span className="text-xs font-semibold text-emerald-700">
                여유 <strong>{fmtWon(remaining)}</strong> · 원천징수 15.4%로 분리과세 적용
              </span>
            </div>
          )}
        </div>

        {/* 대주주 요건 알림 */}
        {summary?.majorShareholderWarning && (
          <div className="mt-3 bg-orange-50 border border-orange-200 rounded-lg px-3 py-2.5">
            <div className="text-xs font-bold text-orange-700 mb-1">⚠️ 대주주 요건 해당 가능 종목</div>
            <div className="space-y-1">
              {summary.majorShareholderItems.map((item, idx) => (
                <div key={idx} className="text-xs text-orange-600">
                  {item.name} · 보유액 {(item.value / 100_000_000).toFixed(1).replace(/\.0$/, "")}억원 · 매도 시 양도소득세 20~25%
                  {item.estimatedTax > 0 && ` · 추정 세액 ${Math.round(item.estimatedTax / 10_000).toLocaleString("ko-KR")}만원`}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>


      {/* 소득 탭: 배당 / 이자 — hideCapitalGains 시 양도 탭 제외 */}
      <div className="border-t border-slate-100">
        <div className="flex border-b border-slate-100">
          {(hideCapitalGains ? ["배당", "이자"] as const : ["배당", "이자", "양도"] as const).map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => setActiveTab(tab)}
              className={`flex-1 py-2 text-xs font-bold transition ${
                activeTab === tab
                  ? "border-b-2 border-samsung text-samsung"
                  : "text-slate-400 hover:text-slate-600"
              }`}
            >
              {tab === "배당" && `배당소득 ${fmtWon(summary?.dividendIncome ?? 0)}`}
              {tab === "이자" && `이자소득 ${fmtWon(summary?.interestIncome ?? 0)}`}
              {tab === "양도" && `양도소득세 ${fmtWon(summary?.capitalGainsTax ?? 0)}`}
            </button>
          ))}
        </div>

        <div className="px-4 py-3 min-h-[80px]">
          {activeTab === "배당" && (
            <div className="space-y-0">
              {dividendItems.length > 0 ? (
                <>
                  {(showAllDividends ? dividendItems : dividendItems.slice(0, ITEM_LIMIT)).map((item, i) => (
                    <IncomeRow key={i} item={item} />
                  ))}
                  {dividendItems.length > ITEM_LIMIT && (
                    <button
                      type="button"
                      onClick={() => setShowAllDividends(v => !v)}
                      className="w-full mt-1 py-1 text-xs text-slate-400 hover:text-slate-600 hover:bg-slate-50 rounded transition"
                    >
                      {showAllDividends
                        ? "▲ 접기"
                        : `▼ ${dividendItems.length - ITEM_LIMIT}개 더보기`}
                    </button>
                  )}
                  <div className="mt-2 pt-2 border-t border-slate-100">
                    <div className="flex justify-between text-xs font-bold text-navy">
                      <span>배당소득 합계 (세전)</span>
                      <span>{fmtWon(summary?.dividendIncome ?? 0)}</span>
                    </div>
                  </div>
                </>
              ) : (
                <p className="text-xs text-slate-400 text-center py-4">
                  배당소득 내역이 없습니다. 종목을 입력하면 자동 계산됩니다.
                </p>
              )}

              {/* 종합과세 상세 */}
              {summary?.isOverThreshold && (
                <div className="border-t border-slate-100 mt-2 pt-2 space-y-1">
                  {taxDetailExpanded ? (
                    <>
                      <div className="flex justify-between text-xs text-slate-500">
                        <span>Gross-up 가산액</span>
                        <span>{fmtWon(summary.grossUpAmount)}</span>
                      </div>
                      <div className="flex justify-between text-xs text-slate-500">
                        <span>종합과세 합산액</span>
                        <span>{fmtWon(summary.taxableFinancialIncome)}</span>
                      </div>
                      <div className="flex justify-between text-xs text-slate-500">
                        <span>일반산출세액</span>
                        <span>{fmtWon(summary.generalTax)}</span>
                      </div>
                      <div className="flex justify-between text-xs text-slate-500">
                        <span>비교산출세액</span>
                        <span>{fmtWon(summary.comparisonTax)}</span>
                      </div>
                      <div className="flex justify-between text-xs text-slate-700 font-bold">
                        <span>적용 산출세액 <span className="text-[10px] font-normal text-slate-400">(둘 중 큰 금액)</span></span>
                        <span>{fmtWon(summary.finalTax)}</span>
                      </div>
                      <div className="flex justify-between text-xs text-emerald-600">
                        <span>배당세액공제</span>
                        <span>-{fmtWon(summary.dividendTaxCredit)}</span>
                      </div>
                      <div className="flex justify-between text-xs text-blue-600">
                        <span>기납부 원천징수세액</span>
                        <span>-{fmtWon(summary.withholdingTax)}</span>
                      </div>
                      <div className="flex justify-between text-xs text-red-600 font-bold mt-1 pt-1 border-t border-slate-50">
                        <span>추가 납부세액</span>
                        <span>{fmtWon(summary.additionalTax)}</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => setTaxDetailExpanded(false)}
                        className="w-full text-center text-xs font-semibold text-slate-500 mt-2 py-1 hover:text-slate-700 transition"
                      >
                        세금 계산 상세 보기 ▲
                      </button>
                    </>
                  ) : (
                    <>
                      <div className="flex justify-between text-xs text-red-600 font-bold">
                        <span>추가 납부세액</span>
                        <span>{fmtWon(summary.additionalTax)}</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => setTaxDetailExpanded(true)}
                        className="w-full text-center text-xs font-semibold text-slate-500 mt-1 py-1 hover:text-slate-700 transition"
                      >
                        세금 계산 상세 보기 ▼
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>
          )}

          {activeTab === "이자" && (
            <div className="space-y-0">
              {interestItems.length > 0 ? (
                <>
                  {(showAllInterest ? interestItems : interestItems.slice(0, ITEM_LIMIT)).map((item, i) => <IncomeRow key={i} item={item} />)}
                  {interestItems.length > ITEM_LIMIT && (
                    <button
                      type="button"
                      onClick={() => setShowAllInterest(v => !v)}
                      className="w-full mt-1 py-1 text-xs text-slate-400 hover:text-slate-600 hover:bg-slate-50 rounded transition"
                    >
                      {showAllInterest
                        ? "▲ 접기"
                        : `▼ ${interestItems.length - ITEM_LIMIT}개 더보기`}
                    </button>
                  )}
                  <div className="mt-2 pt-2 border-t border-slate-100">
                    <div className="flex justify-between text-xs font-bold text-navy">
                      <span>이자소득 합계 (세전)</span>
                      <span>{fmtWon(summary?.interestIncome ?? 0)}</span>
                    </div>
                  </div>
                </>
              ) : (
                <p className="text-xs text-slate-400 text-center py-4">
                  이자소득 내역이 없습니다. 채권 종목을 입력하면 자동 계산됩니다.
                </p>
              )}
            </div>
          )}

          {activeTab === "양도" && (
            <div className="space-y-0">
              {/* B패널 TLH 서브탭 토글 — tlhData가 전달된 경우에만 표시 */}
              {tlhComputed?.hasAny && (
                <div className="flex gap-1 border-b border-slate-100 mb-2">
                  <button
                    type="button"
                    onClick={() => setYangdoSubTab("양도소득세")}
                    className={`px-3 py-1.5 text-xs font-bold rounded-t transition ${
                      yangdoSubTab === "양도소득세"
                        ? "bg-slate-100 text-navy"
                        : "text-slate-400 hover:text-slate-600"
                    }`}
                  >
                    양도소득세
                  </button>
                  <button
                    type="button"
                    onClick={() => setYangdoSubTab("TLH")}
                    className={`flex items-center gap-1 px-3 py-1.5 text-xs font-bold rounded-t transition ${
                      yangdoSubTab === "TLH"
                        ? "bg-slate-100 text-navy"
                        : "text-slate-400 hover:text-slate-600"
                    }`}
                  >
                    절세 전략 TLH
                    {tlhComputed.isYearEnd && tlhComputed.daysLeft !== null && (
                      <span className="text-[10px] font-bold text-orange-500">
                        ⏰ D-{tlhComputed.daysLeft}
                      </span>
                    )}
                  </button>
                </div>
              )}

              {/* 양도소득세 기존 내용 — TLH 탭이 없거나 양도소득세 서브탭 선택 시 */}
              {(!tlhComputed?.hasAny || yangdoSubTab === "양도소득세") && (
                <>
                  {visibleGainsItems.length > 0 ? (
                    <>
                      {visibleGainsItems.map((item, i) => (
                        <CapitalGainsRow key={i} item={item} />
                      ))}
                      <div className="border-t border-slate-100 mt-2 pt-2 space-y-1">
                        <div className="flex justify-between text-xs text-slate-500">
                          <span>총 차익 (손익통산)</span>
                          <span>{fmtWon(summary?.netCapitalGains ?? 0)}</span>
                        </div>
                        <div className="flex justify-between text-xs text-slate-500">
                          <span>기본공제</span>
                          <span>-250만원</span>
                        </div>
                        <div className="flex justify-between text-xs font-bold text-orange-600 pt-1 border-t border-slate-50">
                          <span>최종 양도소득세</span>
                          <span>{fmtWon(summary?.capitalGainsTax ?? 0)}</span>
                        </div>
                      </div>
                    </>
                  ) : (
                    <p className="text-xs text-slate-400 text-center py-4">
                      해외주식·ETF 양도차익 내역이 없습니다.
                    </p>
                  )}
                </>
              )}

              {/* TLH 탭 내용 */}
              {tlhComputed?.hasAny && yangdoSubTab === "TLH" && tlhData && (
                <TLHTabContent
                  baseCandidates={tlhComputed.baseCandidates}
                  isYearEnd={tlhComputed.isYearEnd}
                  daysLeft={tlhComputed.daysLeft}
                  netCapitalGains={tlhData.netCapitalGains}
                  capitalGainsTax={tlhData.capitalGainsTax}
                />
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── TLHTabContent ─────────────────────────────────────────────────────────────
export function TLHTabContent({
  baseCandidates,
  isYearEnd,
  daysLeft,
  netCapitalGains,
  capitalGainsTax,
}: {
  baseCandidates: { name: string; ticker: string; unrealizedGain: number; lossRate: number; taxSaving: number }[];
  isYearEnd: boolean;
  daysLeft: number | null;
  netCapitalGains: number;
  capitalGainsTax: number;
}) {
  const [lossThreshold, setLossThreshold] = useState(15);

  const candidates = useMemo(() => {
    return baseCandidates
      .map((c) => {
        const triggers: ("tax_saving" | "year_end" | "loss_rate")[] = [];
        if (c.taxSaving >= 1_000_000) triggers.push("tax_saving");
        if (isYearEnd) triggers.push("year_end");
        if (c.lossRate < -(lossThreshold / 100)) triggers.push("loss_rate");
        return { ...c, triggers };
      })
      .filter((c) => c.triggers.length > 0);
  }, [baseCandidates, lossThreshold, isYearEnd]);

  const totalLoss = candidates.reduce((sum, c) => sum + c.unrealizedGain, 0);
  const newNetGains = netCapitalGains + totalLoss;
  const newTax = newNetGains > 2_500_000 ? Math.round((newNetGains - 2_500_000) * 0.22) : 0;
  const totalSaving = Math.max(0, capitalGainsTax - newTax);

  return (
    <div className="space-y-3 pt-1">
      {/* 손실 기준 슬라이더 */}
      <div className="flex items-center gap-2">
        <span className="text-[11px] text-slate-500 font-semibold whitespace-nowrap shrink-0">
          손실 기준
        </span>
        <input
          type="range"
          min={10}
          max={30}
          value={lossThreshold}
          onChange={(e) => setLossThreshold(Number(e.target.value))}
          className="flex-1 h-1.5 accent-blue-600"
        />
        <span className="text-[11px] font-bold text-blue-700 w-8 text-right shrink-0">
          -{lossThreshold}%
        </span>
      </div>

      {/* 절세 시뮬레이션 요약 */}
      {capitalGainsTax > 0 && candidates.length > 0 && (
        <div className="rounded-lg bg-blue-50 border border-blue-200 px-3 py-2.5">
          <p className="text-[11px] font-bold text-blue-700 mb-2">
            후보 종목 전량 매도 시 절세 시뮬레이션
          </p>
          <div className="flex items-center justify-center gap-4">
            <div className="text-center">
              <p className="text-[10px] text-slate-500">현재 양도소득세</p>
              <p className="text-sm font-black text-red-600">{fmtWon(capitalGainsTax)}</p>
            </div>
            <span className="text-slate-400 text-lg font-bold">→</span>
            <div className="text-center">
              <p className="text-[10px] text-slate-500">TLH 후 세액</p>
              <p className="text-sm font-black text-blue-700">{fmtWon(newTax)}</p>
            </div>
          </div>
          <div className="mt-2 text-center border-t border-blue-100 pt-2">
            <span className="text-xs font-black text-emerald-600">
              절세 효과 {fmtWon(totalSaving)}
            </span>
          </div>
        </div>
      )}

      {/* 후보 종목 리스트 */}
      {candidates.length > 0 ? (
        <div className="space-y-0">
          {candidates.map((c, i) => (
            <div
              key={i}
              className="flex items-start justify-between gap-2 py-2 border-b border-slate-50 last:border-0"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="text-xs font-bold text-navy truncate">{c.name}</span>
                  {c.ticker && (
                    <span className="text-[10px] text-slate-400 font-mono">({c.ticker})</span>
                  )}
                  {c.triggers.includes("loss_rate") && (
                    <span className="rounded-full bg-red-100 px-1.5 py-0.5 text-[9px] font-bold text-red-700">
                      {Math.abs(c.lossRate * 100).toFixed(1)}%↓
                    </span>
                  )}
                </div>
                <div className="flex flex-wrap gap-1 mt-0.5">
                  {c.triggers.includes("tax_saving") && (
                    <span className="rounded-full bg-blue-100 px-1.5 py-0.5 text-[9px] font-bold text-blue-700">
                      절세효과
                    </span>
                  )}
                  {c.triggers.includes("year_end") && (
                    <span className="rounded-full bg-orange-100 px-1.5 py-0.5 text-[9px] font-bold text-orange-700">
                      연말임박{daysLeft !== null ? ` D-${daysLeft}` : ""}
                    </span>
                  )}
                </div>
                <div className="text-[10px] text-slate-500 mt-0.5">
                  평가손실 {fmtWon(Math.abs(c.unrealizedGain))}
                </div>
              </div>
              <div className="shrink-0 text-right">
                <p className="text-xs font-bold text-emerald-600">절세 {fmtWon(c.taxSaving)}</p>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-xs text-slate-400 text-center py-3">
          현재 기준 TLH 후보 종목이 없습니다.
        </p>
      )}

      {/* 30일 재매수 주의 */}
      <div className="flex items-start gap-1.5 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2">
        <span className="text-amber-500 text-xs mt-0.5 shrink-0">⚠</span>
        <p className="text-[11px] font-semibold text-amber-700 leading-snug">
          절세 매도 후 동일 종목 재매수는 30일 이후 권장
        </p>
      </div>
    </div>
  );
}

// ─── AssetForIncomeCalc ────────────────────────────────────────────────────────
export interface AssetForIncomeCalc {
  name: string;
  ticker?: string;
  asset_class: string;
  productType?: string;
  country?: string;
  current_price?: number;
  current_value?: number;
  amount: number;
  amount_type: "quantity" | "value";
  buy_price?: number | null;
  dividendYield?: number;              // 연간 배당수익률 (소수)
  trailingAnnualDividendRate?: number; // 주당 연간 배당금
  interestRate?: number;               // 채권 이자율 (소수 — bond_yield/100)
}

// ─── calcFinancialIncomeSummary ────────────────────────────────────────────────
export function calcFinancialIncomeSummary(
  assets: AssetForIncomeCalc[],
  tMarginal: number = 0.385
): FinancialIncomeSummary {
  const breakdown: IncomeBreakdownItem[] = [];
  const cgBreakdownTemp: CapitalGainsBreakdownItem[] = [];
  const majorShareholderItems: { name: string; ticker: string; value: number; estimatedTax: number }[] = [];

  let interestIncome = 0;
  let dividendIncome = 0;
  let totalCapitalGains = 0;
  let totalCapitalLosses = 0;
  let domesticMajorShareholderTax = 0;
  let grossUpTargetDividend = 0;

  for (const a of assets) {
    const assetClass = (a.asset_class ?? "").trim();
    const productType = (a.productType ?? "").trim();

    // 채권 여부 (통합유형 + 레거시 모두 처리)
    const isBond =
      assetClass === "국내채권" || assetClass === "해외채권" ||
      productType === "국내채권" || productType === "해외채권";

    // 채권은 종목명 입력이 비활성화되어 name=""일 수 있음 → productType으로 대체
    // 주식·ETF는 name 없으면 스킵
    if (!a.name && !isBond) continue;
    const name = a.name || productType || "채권";

    const ticker = a.ticker ?? "";
    const isKoreanTicker = ticker.endsWith(".KS") || ticker.endsWith(".KQ");
    const isDomesticListed = isKoreanTicker || a.country === "국내" || a.country === "한국";

    // 보유 평가액 (주식·ETF용)
    const value =
      a.current_value ??
      (a.amount_type === "quantity"
        ? (a.current_price ?? 0) * a.amount
        : a.amount);

    // 매매차익 (주식·ETF용)
    let gain = 0;
    if (!isBond && a.buy_price && a.current_price && a.amount_type === "quantity") {
      gain = (a.current_price - a.buy_price) * a.amount;
    }

    // ── 채권: 이자소득 ──────────────────────────────────────────────────────────
    if (isBond) {
      // 액면금액(원금) = 매수단가 × 수량
      const principal =
        a.amount_type === "quantity"
          ? (a.buy_price ?? 0) * a.amount
          : (a.buy_price ?? 0); // value 기준 입력 시
      const rate = a.interestRate ?? 0; // 이미 소수 (bond_yield / 100)

      // 이자 지급 일수 = 365 (연간 기준)
      const annualGross = principal * rate * (365 / 365);
      if (annualGross > 0 && principal > 0) {
        const annualNet = Math.round(annualGross * (1 - INTEREST_WITHHOLDING));
        interestIncome += annualGross;
        breakdown.push({
          name,  // a.name || productType || "채권"
          ticker,
          incomeType: "이자",
          annualIncome: Math.round(annualGross),
          netIncome: annualNet,
          yieldRate: rate,
          value: value > 0 ? Math.round(value) : Math.round(principal),
          principal: Math.round(principal),
          withholdingRate: INTEREST_WITHHOLDING,
        });
      }
      continue; // 채권은 양도소득 계산 생략
    }

    // ── 리츠 / 주식 / ETF: 배당소득 ────────────────────────────────────────────
    if (value > 0) {
      const yieldRate = a.dividendYield ?? 0;

      if (yieldRate > 0) {
        const annualGross = value * yieldRate;
        const withholdingRate = isDomesticListed ? DOMESTIC_DIV_WITHHOLDING : FOREIGN_DIV_WITHHOLDING;
        const annualNet = Math.round(annualGross * (1 - withholdingRate));
        dividendIncome += annualGross;

        // 소득유형 분류
        let incomeType: IncomeBreakdownItem["incomeType"] = "배당";
        if (isDomesticListed && productType === "국내주식") {
          incomeType = "배당(국내직접)";
          grossUpTargetDividend += annualGross; // Gross-up (11%) 대상
        } else if (!isDomesticListed && productType === "해외주식") {
          incomeType = "배당(해외직접)";
        } else if (
          productType === "국내ETF" || productType === "해외ETF" ||
          productType === "ETF" || productType === "펀드" ||
          productType === "채권형" || productType === "리츠" ||
          productType === "집합투자"
        ) {
          incomeType = "배당(집합투자)";
        }

        breakdown.push({
          name,  // a.name || productType || "채권" (fallback 적용)
          ticker,
          incomeType,
          annualIncome: Math.round(annualGross),
          netIncome: annualNet,
          yieldRate,
          value: Math.round(value),
          withholdingRate,
        });
      }
    }

    // ── ② 국내 대주주 (보유액 50억 이상 국내주식) — gain 여부와 무관하게 항상 체크 ──────
    if (isDomesticListed && value >= 5_000_000_000 && productType === "국내주식") {
      // 기본공제 250만원 (국내 주식 양도소득 그룹 — 해외주식 그룹과 별도 적용)
      const taxableGain = gain <= 0 ? 0 : Math.max(0, gain - 2_500_000);
      // 세율: 3억 이하 22%, 3억 초과 27.5% (지방소득세 10% 포함)
      const tax = taxableGain <= 0 ? 0
        : taxableGain <= 300_000_000
          ? taxableGain * 0.22
          : 300_000_000 * 0.22 + (taxableGain - 300_000_000) * 0.275;
      majorShareholderItems.push({ name: a.name, ticker, value, estimatedTax: Math.round(tax) });
      if (tax > 0) {
        domesticMajorShareholderTax += tax;
        cgBreakdownTemp.push({ name: a.name, ticker, gain, tax: Math.round(tax), category: "국내대주주" });
      }
    }

    // ── 양도소득 ────────────────────────────────────────────────────────────────
    if (gain !== 0) {
      // ① 해외주식·해외ETF·해외펀드: 손익통산 후 250만원 공제, 22%
      const isForeignTaxable =
        !isDomesticListed && (
          productType === "해외주식" ||
          productType === "해외ETF" ||
          productType === "주식형" ||    // 레거시
          productType === "ETF" ||       // 레거시
          productType === "개별주식" ||  // 레거시
          productType === "채권형" ||    // 레거시
          productType === "펀드"         // 레거시
        );

      if (isForeignTaxable) {
        const cat: CapitalGainsBreakdownItem["category"] =
          productType === "해외ETF" || productType === "ETF" ? "해외주식" :
          productType === "펀드" || productType === "채권형" ? "해외펀드" : "해외주식";
        if (gain > 0) totalCapitalGains += gain;
        else totalCapitalLosses += gain;
        cgBreakdownTemp.push({ name: a.name, ticker, gain, tax: 0, category: cat });

      // ③ 국내상장 해외ETF (자산 = 해외) 매매차익 → 배당소득(집합투자)
      } else if (isDomesticListed && gain > 0 && assetClass === "해외주식") {
        dividendIncome += gain;
        breakdown.push({
          name: a.name + " (매매차익)",
          ticker,
          incomeType: "배당(집합투자)",
          annualIncome: Math.round(gain),
          netIncome: Math.round(gain * (1 - DOMESTIC_DIV_WITHHOLDING)),
          yieldRate: (a.buy_price && a.amount) ? gain / (a.buy_price * a.amount) : 0,
          value: Math.round(value),
          withholdingRate: DOMESTIC_DIV_WITHHOLDING,
        });
      }
      // ④ 국내주식형 ETF·국내채권 매매차익: 비과세 (생략)
    }
  }

  // ── 해외 손익통산 및 양도소득세 ──────────────────────────────────────────────
  const netCapitalGains = totalCapitalGains + totalCapitalLosses;
  const foreignCapitalGainsTax = netCapitalGains > 2_500_000
    ? Math.round((netCapitalGains - 2_500_000) * 0.22)
    : 0;

  const capitalGainsTax = foreignCapitalGainsTax + Math.round(domesticMajorShareholderTax);

  // 항목별 기여 세액 배분
  const capitalGainsBreakdown: CapitalGainsBreakdownItem[] = cgBreakdownTemp.map((item) => {
    if (item.category === "국내대주주") return { ...item, gain: Math.round(item.gain) };
    let tax = 0;
    if (foreignCapitalGainsTax > 0 && totalCapitalGains > 0 && item.gain > 0) {
      tax = foreignCapitalGainsTax * (item.gain / totalCapitalGains);
    }
    return { ...item, gain: Math.round(item.gain), tax: Math.round(tax) };
  }).sort((a, b) => b.gain - a.gain);

  // ── 금융소득 종합과세 계산 (gross 기준) ─────────────────────────────────────
  const totalFinancialIncome = interestIncome + dividendIncome; // gross (세전)

  const grossUpAmount = grossUpTargetDividend * 0.11;
  const taxableFinancialIncome = totalFinancialIncome + grossUpAmount;
  let generalTax = 0;
  let comparisonTax = 0;
  let finalTax = 0;
  let dividendTaxCredit = 0;
  const withholdingTax = totalFinancialIncome * 0.154;
  let additionalTax = 0;

  if (totalFinancialIncome > THRESHOLD) {
    // 일반산출세액: 2,000만원 초과분에 한계세율, 이하에 14%
    generalTax = (taxableFinancialIncome - THRESHOLD) * tMarginal + THRESHOLD * 0.14;
    // 비교산출세액: 전액 14%
    comparisonTax = taxableFinancialIncome * 0.14;
    finalTax = Math.max(generalTax, comparisonTax);
    dividendTaxCredit = Math.min(grossUpAmount, finalTax * 0.1);
    additionalTax = Math.max(finalTax - dividendTaxCredit - withholdingTax, 0);
  }

  return {
    interestIncome: Math.round(interestIncome),
    dividendIncome: Math.round(dividendIncome),
    totalCapitalGains: Math.round(totalCapitalGains),
    totalCapitalLosses: Math.round(totalCapitalLosses),
    netCapitalGains: Math.round(netCapitalGains),
    foreignCapitalGainsTax,
    domesticMajorShareholderTax: Math.round(domesticMajorShareholderTax),
    capitalGainsTax,
    totalFinancialIncome: Math.round(totalFinancialIncome),
    grossUpAmount: Math.round(grossUpAmount),
    taxableFinancialIncome: Math.round(taxableFinancialIncome),
    generalTax: Math.round(generalTax),
    comparisonTax: Math.round(comparisonTax),
    finalTax: Math.round(finalTax),
    dividendTaxCredit: Math.round(dividendTaxCredit),
    withholdingTax: Math.round(withholdingTax),
    additionalTax: Math.round(additionalTax),
    tMarginal,
    isOverThreshold: totalFinancialIncome > THRESHOLD,
    breakdown: (() => {
      const map = new Map<string, IncomeBreakdownItem>();
      for (const item of breakdown) {
        const key = `${item.name}::${item.ticker}::${item.incomeType}`;
        const existing = map.get(key);
        if (existing) {
          map.set(key, {
            ...existing,
            annualIncome: existing.annualIncome + item.annualIncome,
            netIncome: existing.netIncome + item.netIncome,
            value: (existing.value ?? 0) + (item.value ?? 0),
          });
        } else {
          map.set(key, { ...item });
        }
      }
      return Array.from(map.values()).sort((a, b) => b.annualIncome - a.annualIncome);
    })(),
    capitalGainsBreakdown,
    majorShareholderWarning: majorShareholderItems.length > 0,
    majorShareholderItems,
    updatedAt: Date.now(),
  };
}

/** 새 공식 기반 세후 수익률 계산
 * = (① 양도 세후 수익 + ② 배당·이자 세후 수익) ÷ 투자 원금
 */
export function calcAfterTaxReturn(
  summary: FinancialIncomeSummary,
  assets: Array<{ buy_price?: number | null; current_price?: number; current_value?: number; amount: number; amount_type?: string }>,
  includeCapitalGainsTax?: boolean
): number {
  // 총 투자원금: 매수단가 × 수량 합계
  const principal = assets.reduce((sum, a) => {
    if ((a.amount_type ?? "quantity") === "value") return sum + a.amount;
    if (a.buy_price != null && a.buy_price > 0) return sum + a.buy_price * a.amount;
    if (a.current_value != null && a.current_value > 0) return sum + a.current_value;
    if (a.current_price != null && a.current_price > 0) return sum + a.current_price * a.amount;
    return sum;
  }, 0);

  if (principal <= 0) return 0;

  // 현재 평가금액 합계 (모든 종목 포함)
  const currentTotal = assets.reduce((sum, a) => {
    if ((a.amount_type ?? "quantity") === "value") return sum + (a.current_value ?? a.amount);
    if (a.current_value != null && a.current_value > 0) return sum + a.current_value;
    if (a.current_price != null && a.current_price > 0) return sum + a.current_price * a.amount;
    if (a.buy_price != null && a.buy_price > 0) return sum + a.buy_price * a.amount;
    return sum;
  }, 0);

  // 전체 평가손익 (국내 + 해외 모든 종목)
  const priceReturn = currentTotal - principal;

  // 금융소득세: 금융소득 × 15.4% (2,000만원 초과 시 종합과세 기준)
  const totalFI = summary.totalFinancialIncome;
  const financialIncomeTax = summary.isOverThreshold
    ? (summary.finalTax - summary.dividendTaxCredit)
    : totalFI * 0.154;

  // 양도소득세 (기존 포트폴리오는 실제 매도 없으므로 제외)
  const capitalGainsTax = (includeCapitalGainsTax ?? true) ? summary.capitalGainsTax : 0;

  // 세후수익률 = (전체 평가손익 − 금융소득세 − 양도소득세) / 총 투자원금
  return (priceReturn - financialIncomeTax - capitalGainsTax) / principal;
}

/** proxy-finance API 응답에서 배당 데이터 추출 */
export function extractDividendFromYahoo(yahooJson: Record<string, unknown>): {
  dividendYield?: number;
  trailingAnnualDividendRate?: number;
} {
  let dy = yahooJson?.dividendYield;
  let tadr = yahooJson?.trailingAnnualDividendRate;

  if (typeof dy !== "number" || typeof tadr !== "number") {
    const results = (yahooJson?.chart as Record<string, unknown>)?.result as Record<string, unknown>[] | undefined;
    const m = (results?.[0]?.meta ?? {}) as Record<string, unknown>;
    if (typeof dy !== "number") dy = m?.dividendYield;
    if (typeof tadr !== "number") tadr = m?.trailingAnnualDividendRate;
  }

  return {
    dividendYield: typeof dy === "number" && dy > 0 ? dy : undefined,
    trailingAnnualDividendRate: typeof tadr === "number" && tadr > 0 ? tadr : undefined,
  };
}
