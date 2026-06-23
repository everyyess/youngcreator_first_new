"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Download, GitCompare, Sparkles, TrendingUp, WalletCards, X } from "lucide-react";
import PensionTaxPanel from "../tab1/PensionTaxPanel";
import {
  fmt,
  fmtPct,
  InteractiveDonutWithTable,
  MetricCard,
  NewPortfolioPlaceholder,
  PieChartIcon,
  PortfolioIssueBanner,
  ResultCard,
  STRESS_SCENARIO_ORDER,
  StressScenarioBar,
  usePortfolioResult,
} from "../PortfolioResultComponents";
import { useCustomerContext, loadTaxSummaries } from "../CustomerContext";
import type { PortfolioAsset } from "../CustomerContext";
import {
  FinancialIncomeGauge,
  FINANCIAL_INCOME_STORAGE_KEY,
  NEW_PORTFOLIO_INCOME_STORAGE_KEY,
  FINANCIAL_INCOME_RESET_KEY,
  calcAfterTaxReturn,
} from "../tab1/FinancialIncomeGauge";
import type { FinancialIncomeSummary } from "../tab1/FinancialIncomeGauge";
import { PortfolioReportPdf, OPTIONAL_SECTIONS, type ReportSectionToggles, type ReportMode } from "./PortfolioReportPdf";

// 시계열 연대기 순 키 배열 — STRESS_SCENARIO_ORDER 에서 파생 (2018→2020→2022)
const SCENARIO_KEYS = STRESS_SCENARIO_ORDER.map((s) => s.key);

export default function Tab4Page() {
  const data = usePortfolioResult();
  const { newPortfolioAnalysisResult, selectedCustomer, rebalancingSellAssets, formData, selectedCustomerProfile } = useCustomerContext();
  const [showPensionPanel, setShowPensionPanel] = useState(false);

  const tMarginal = useMemo(() => {
    const raw = formData.financial.annualFixedIncome ?? "";
    const n = raw.replace(/[^0-9.억만천]/g, "");
    let income = 0;
    const eok = n.match(/([0-9.]+)억/);
    const man = n.match(/([0-9.]+)만/);
    if (eok) income += parseFloat(eok[1]) * 1e8;
    if (man) income += parseFloat(man[1]) * 1e4;
    if (!eok && !man) income = parseFloat(n.replace(/[^0-9.]/g, "")) || 0;
    if (income > 1_000_000_000) return 0.45;
    if (income > 500_000_000)   return 0.42;
    if (income > 300_000_000)   return 0.40;
    if (income > 150_000_000)   return 0.38;
    if (income > 88_000_000)    return 0.35;
    if (income > 50_000_000)    return 0.24;
    if (income > 14_000_000)    return 0.15;
    return 0.06;
  }, [formData.financial.annualFixedIncome]);
  const [summary, setSummary] = useState<FinancialIncomeSummary | null>(null);
  const [newSummary, setNewSummary] = useState<FinancialIncomeSummary | null>(null);
  // 좌우 동일 시나리오 인덱스 공유 — 같은 위기 시나리오를 나란히 비교
  const [selectedScenario, setSelectedScenario] = useState(0);

  const printRef = useRef<HTMLDivElement>(null);
  const [showReportOptions, setShowReportOptions] = useState(false);
  const [reportMode, setReportMode] = useState<ReportMode>("normal");
  const [reportSections, setReportSections] = useState<ReportSectionToggles>({
    stress: true,
    health: true,
    taxIncome: true,
    holdings: true,
  });

  // 고객 전환 시 Supabase에서 직접 로드 (localStorage 타이밍 문제 방지)
  useEffect(() => {
    if (!selectedCustomer) return;
    const wasReset = sessionStorage.getItem(FINANCIAL_INCOME_RESET_KEY) === '1';
    if (wasReset) {
      setSummary(null);
      loadTaxSummaries(selectedCustomer).then(({ newSummary }) => {
        if (newSummary) {
          setNewSummary(newSummary as FinancialIncomeSummary);
        } else {
          try {
            const local = localStorage.getItem(NEW_PORTFOLIO_INCOME_STORAGE_KEY);
            if (local) setNewSummary(JSON.parse(local));
          } catch {}
        }
      });
      return;
    }
    loadTaxSummaries(selectedCustomer).then(({ currentSummary, newSummary }) => {
      if (currentSummary) {
        setSummary(currentSummary as FinancialIncomeSummary);
      } else {
        try {
          const local = localStorage.getItem(FINANCIAL_INCOME_STORAGE_KEY);
          if (local) setSummary(JSON.parse(local));
        } catch {}
      }
      if (newSummary) {
        setNewSummary(newSummary as FinancialIncomeSummary);
      } else {
        try {
          const local = localStorage.getItem(NEW_PORTFOLIO_INCOME_STORAGE_KEY);
          if (local) setNewSummary(JSON.parse(local));
        } catch {}
      }
    });
  }, [selectedCustomer]);

  // 같은 고객 내에서 TAB2/TAB3 변경 시 이벤트로 실시간 반영
  useEffect(() => {
    const loadCurrent = () => {
      try {
        const stored = localStorage.getItem(FINANCIAL_INCOME_STORAGE_KEY);
        if (stored) setSummary(JSON.parse(stored));
      } catch {}
    };
    const loadNew = () => {
      try {
        const stored = localStorage.getItem(NEW_PORTFOLIO_INCOME_STORAGE_KEY);
        if (stored) setNewSummary(JSON.parse(stored));
      } catch {}
    };
    window.addEventListener("financial-income-updated", loadCurrent);
    window.addEventListener("new-financial-income-updated", loadNew);
    return () => {
      window.removeEventListener("financial-income-updated", loadCurrent);
      window.removeEventListener("new-financial-income-updated", loadNew);
    };
  }, []);

  // 같은 ticker가 양쪽 모두 있을 때 기존 포트폴리오 배당률을 신규 포트폴리오 기준으로 통일
  // 이유: 두 포트폴리오는 서로 다른 시점에 Yahoo Finance를 조회하여 주가 변동만큼 수익률이 미세하게 달라짐
  const normalizedSummary = useMemo<FinancialIncomeSummary | null>(() => {
    if (!summary || !newSummary) return summary;
    // 신규 포트폴리오의 ticker → yieldRate 맵 구성
    const yieldMap = new Map<string, number>();
    for (const item of newSummary.breakdown) {
      if (item.ticker && item.yieldRate > 0 && item.incomeType.startsWith("배당")) {
        yieldMap.set(item.ticker, item.yieldRate);
      }
    }
    if (yieldMap.size === 0) return summary;
    // 기존 포트폴리오 breakdown에서 매칭 ticker의 yieldRate + income 조정
    let dividendDiff = 0;
    const adjustedBreakdown = summary.breakdown.map(item => {
      if (!item.ticker || !item.incomeType.startsWith("배당")) return item;
      const newRate = yieldMap.get(item.ticker);
      if (newRate == null || Math.abs(newRate - item.yieldRate) < 0.00005) return item;
      const newAnnual = Math.round(item.value * newRate);
      const withholdingFactor = item.annualIncome > 0 ? item.netIncome / item.annualIncome : 1;
      dividendDiff += newAnnual - item.annualIncome;
      return { ...item, yieldRate: newRate, annualIncome: newAnnual, netIncome: Math.round(newAnnual * withholdingFactor) };
    });
    if (dividendDiff === 0) return summary;
    return {
      ...summary,
      breakdown: adjustedBreakdown,
      dividendIncome: summary.dividendIncome + dividendDiff,
      totalFinancialIncome: summary.totalFinancialIncome + dividendDiff,
    };
  }, [summary, newSummary]);

  const leftData = data;
  const rightData = newPortfolioAnalysisResult;

  const leftAssets: PortfolioAsset[] = Array.isArray(leftData?.enrichedAssets)
    ? (leftData!.enrichedAssets as PortfolioAsset[])
    : [];

  // 잔류 종목의 현재가를 기존 포트폴리오 enriched 데이터에서 보완
  // TAB2-5 매도 확정 이후 rebalancingSellAssets에는 0수량 종목이 포함됨
  const enrichedRemainingAssets = useMemo(() => {
    const map = new Map(leftAssets.map(a => [`${a.name ?? ""}::${a.ticker ?? ""}`, a]));
    return rebalancingSellAssets.map(a => {
      const enriched = map.get(`${a.name ?? ""}::${a.ticker ?? ""}`);
      return {
        ...a,
        current_price: enriched?.current_price ?? a.current_price,
        current_value: enriched?.current_value ?? a.current_value,
      };
    });
  }, [rebalancingSellAssets, leftAssets]); // eslint-disable-line react-hooks/exhaustive-deps

  // TAB3 분석 결과가 있으면 그것을 우선 사용;
  // 없으면 TAB2-5 매도 후 잔여 자산(enrichedRemainingAssets, amount>0만)을 베이스라인으로 사용
  const rightAssets: PortfolioAsset[] = useMemo(() => {
    if (Array.isArray(rightData?.enrichedAssets) && rightData!.enrichedAssets.length > 0) {
      return rightData!.enrichedAssets as PortfolioAsset[];
    }
    // TAB2-5 매도 후 잔여 포트폴리오를 TAB4 우측 패널 베이스라인으로 사용
    return enrichedRemainingAssets.filter(a => a.amount > 0);
  }, [rightData, enrichedRemainingAssets]);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const leftStressResult = (leftData as any)?.stressResult;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rightStressResult = (rightData as any)?.stressResult;

  const leftAfterTaxReturn = useMemo(
    () => summary ? calcAfterTaxReturn(summary, leftAssets, false) : null,
    [summary, leftAssets] // eslint-disable-line react-hooks/exhaustive-deps
  );

  // rightAssets에 잔류 자산이 이미 포함(TAB3 분석 시) 또는 rightAssets 자체가 잔류 자산(fallback)이므로
  // enrichedRemainingAssets를 별도 합산하면 이중 계산 발생 — rightAssets 단독 사용
  const rightAfterTaxReturn = useMemo(
    () => newSummary ? calcAfterTaxReturn(newSummary, rightAssets) : null,
    [newSummary, rightAssets] // eslint-disable-line react-hooks/exhaustive-deps
  );

  

  return (
    <div className="space-y-6">

{/* ── 절세 제안 전략 모달 ── */}
{showPensionPanel && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setShowPensionPanel(false)}>
          <div
            className="relative w-full max-w-6xl max-h-[92vh] overflow-y-auto rounded-2xl bg-white shadow-2xl"
            onClick={e => e.stopPropagation()}
          >
            {/* 모달 헤더 */}
            <div className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-200 bg-white px-5 py-3">
              <div className="flex items-center gap-2 text-rose-700">
                <Sparkles size={15} />
                <span className="text-sm font-bold">절세 제안 전략</span>
              </div>
              <button
                type="button"
                onClick={() => setShowPensionPanel(false)}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 transition"
              >
                <X size={18} />
              </button>
            </div>
            {/* 본문 */}
            <div className="p-4">
              <PensionTaxPanel tMarginal={tMarginal} alwaysOpen />
            </div>
          </div>
        </div>
      )}

      {showReportOptions && (
        <ReportOptionsModal
          sections={reportSections}
          setSections={setReportSections}
          onClose={() => setShowReportOptions(false)}
          customerName={selectedCustomerProfile?.name || selectedCustomerProfile?.fallbackName || "고객"}
          leftData={leftData}
          rightData={rightData}
          leftAssets={leftAssets}
          rightAssets={rightAssets}
          leftAfterTaxReturn={leftAfterTaxReturn}
          rightAfterTaxReturn={rightAfterTaxReturn}
          summary={summary}
          newSummary={newSummary}
          marginalTaxRate={tMarginal}
          mode={reportMode}
          setMode={setReportMode}
        />
      )}

      {/* ── 페이지 헤더 + PDF 버튼 ── */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-samsung text-white">
            <GitCompare size={20} />
          </div>
          <div>
            <p className="text-xs font-bold uppercase tracking-wide text-slate-500">포트폴리오 비교 분석</p>
            <h1 className="text-lg font-bold text-navy">기존 포트폴리오 vs 신규 포트폴리오</h1>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setShowReportOptions(true)}
          disabled={!leftData && !rightData}
          className="inline-flex items-center gap-2 rounded-lg border border-samsung bg-white px-4 py-2.5 text-sm font-bold text-samsung shadow-soft transition hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Download size={16} />
          포트폴리오 제안서 PDF 생성
        </button>
      </div>

      {/* ── PDF 캡처 영역 ── */}
      <div ref={printRef} className="space-y-6 bg-white">
        <div className="grid grid-cols-1 gap-x-6 gap-y-4 lg:grid-cols-2">

          {/* ── 헤더 행 ── */}
          <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2.5 shadow-soft">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-samsung text-xs font-bold text-white">A</span>
            <span className="text-sm font-bold text-navy">기존 포트폴리오</span>
          </div>
          <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2.5 shadow-soft">
            <span className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold text-white ${rightAssets.length > 0 ? "bg-emerald-500" : "bg-slate-300"}`}>B</span>
            <span className={`text-sm font-bold ${rightAssets.length > 0 ? "text-navy" : "text-slate-400"}`}>
              {rightData
                ? "신규 포트폴리오 (리밸런싱 완료)"
                : rightAssets.length > 0
                ? "매도 후 잔여 포트폴리오"
                : "신규 포트폴리오 (준비 중)"}
            </span>
          </div>

          {/*
            ── 핵심 이슈 배너 행 ──
            두 셀 모두 항상 렌더링되므로 CSS Grid가 행 높이를 양쪽 중 최댓값으로 통일.
          */}
          <div className="flex flex-col">
            {leftData?.portfolioIssueSummary && leftData.healthResult && (
              <PortfolioIssueBanner healthResult={leftData.healthResult} stressResult={leftStressResult} />
            )}
          </div>
          <div className="flex flex-col">
            {rightData?.portfolioIssueSummary && rightData.healthResult && (
              <PortfolioIssueBanner healthResult={rightData.healthResult} stressResult={rightStressResult} />
            )}
          </div>

          {/* ── 자산군별 비중 분포 행 ── */}
          {leftData ? (
            <ResultCard icon={<PieChartIcon />} title="자산군별 비중 분포" accent="slate">
              <InteractiveDonutWithTable assets={leftAssets} />
            </ResultCard>
          ) : (
            <div className="flex min-h-[480px] flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-slate-300 bg-slate-50 px-6 text-center">
              <WalletCards size={32} className="text-slate-300" />
              <p className="text-sm font-semibold text-slate-400">2번 탭에서 자산을 입력하고 분석 실행을 눌러주세요.</p>
            </div>
          )}
          {rightAssets.length > 0 ? (
            <ResultCard icon={<PieChartIcon />} title="자산군별 비중 분포" accent="slate">
              <InteractiveDonutWithTable
                assets={rightAssets}
                initialAssets={leftAssets}
                showRebalancing={leftAssets.length > 0}
              />
            </ResultCard>
          ) : (
            <NewPortfolioPlaceholder />
          )}

          {/*
            ── 핵심 지표 요약 행 ──
            quantResult 유무와 무관하게 래퍼 div가 항상 존재하여 그리드 셀 확보.
          */}
          <div className="flex flex-col">
            {leftData?.quantResult && (
              <ResultCard icon={<TrendingUp size={18} />} title="핵심 지표 요약" accent="green">
                <div className="grid grid-cols-2 gap-3">
                  <MetricCard label="세후 수익률" value={fmtPct(leftAfterTaxReturn ?? leftData.quantResult.performance.afterTaxExpectedReturn)} sub="세후 연환산 기대수익" />
                  <MetricCard label="샤프 비율" value={fmt(leftData.quantResult.performance.sharpeRatio)} sub="위험 대비 초과수익" />
                  <MetricCard label="소르티노 비율" value={fmt(leftData.quantResult.performance.sortinoRatio)} sub="하방 리스크 방어력" />
                  <MetricCard label="최대 낙폭(MDD)" value={fmtPct(Math.abs(leftData.quantResult.risk.mdd))} sub="최고점 대비 최악 하락" />
                  <MetricCard label="연환산 변동성" value={fmtPct(leftData.quantResult.risk.volatility)} sub="연간 가격 흔들림 폭" />
                  <MetricCard label="시장 베타" value={fmt(leftData.quantResult.sensitivity.beta)} sub="시장 민감도" />
                </div>
              </ResultCard>
            )}
          </div>
          <div className="flex flex-col">
            {rightData?.quantResult && (
              <ResultCard icon={<TrendingUp size={18} />} title="핵심 지표 요약" accent="green">
                <div className="grid grid-cols-2 gap-3">
                  <MetricCard label="세후 수익률" value={fmtPct(rightAfterTaxReturn ?? rightData.quantResult.performance.afterTaxExpectedReturn)} sub="세후 연환산 기대수익" />
                  <MetricCard label="샤프 비율" value={fmt(rightData.quantResult.performance.sharpeRatio)} sub="위험 대비 초과수익" />
                  <MetricCard label="소르티노 비율" value={fmt(rightData.quantResult.performance.sortinoRatio)} sub="하방 리스크 방어력" />
                  <MetricCard label="최대 낙폭(MDD)" value={fmtPct(Math.abs(rightData.quantResult.risk.mdd))} sub="최고점 대비 최악 하락" />
                  <MetricCard label="연환산 변동성" value={fmtPct(rightData.quantResult.risk.volatility)} sub="연간 가격 흔들림 폭" />
                  <MetricCard label="시장 베타" value={fmt(rightData.quantResult.sensitivity.beta)} sub="시장 민감도" />
                </div>
              </ResultCard>
            )}
          </div>

          {/*
            ── 스트레스 테스트 – 3대 위기 시나리오 행 ──
            좌우가 selectedScenario 상태를 공유하여 같은 위기를 나란히 비교.
            래퍼 div는 stressResult 유무와 무관하게 항상 존재하여 격자 행 정렬 유지.
          */}
          <div className="flex flex-col">
            {leftStressResult && (
              <ResultCard icon={<AlertTriangle size={18} />} title="스트레스 테스트 – 3대 위기 시나리오" accent="red">
                <StressTestCard
                  stressResult={leftStressResult}
                  selectedScenario={selectedScenario}
                  onSelectScenario={setSelectedScenario}
                />
              </ResultCard>
            )}
          </div>
          <div className="flex flex-col">
            {rightStressResult && (
              <ResultCard icon={<AlertTriangle size={18} />} title="스트레스 테스트 – 3대 위기 시나리오" accent="red">
                <StressTestCard
                  stressResult={rightStressResult}
                  selectedScenario={selectedScenario}
                  onSelectScenario={setSelectedScenario}
                />
              </ResultCard>
            )}
          </div>

        </div>

        {/* ── 세금 점검 비교 ── */}
        <div className="space-y-3">
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">

            <div className="flex flex-col gap-2">
              {summary && (
                <>
                  <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 shadow-soft">
                    <span className="flex h-5 w-5 items-center justify-center rounded-full bg-samsung text-[10px] font-bold text-white">A</span>
                    <span className="text-xs font-bold text-navy">기존 포트폴리오 세금 점검</span>
                  </div>
                  <FinancialIncomeGauge summary={normalizedSummary} hideCapitalGains={true} />
                </>
              )}
            </div>

            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 shadow-soft">
                <div className="flex items-center gap-2">
                  <span className={`flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold text-white ${newSummary ? "bg-emerald-500" : "bg-slate-300"}`}>B</span>
                  <span className={`text-xs font-bold ${newSummary ? "text-navy" : "text-slate-400"}`}>신규 포트폴리오 세금 점검</span>
                </div>
                <button
                  type="button"
                  onClick={() => setShowPensionPanel(true)}
                  className="flex items-center gap-1.5 rounded-lg bg-rose-50 border border-rose-200 px-2.5 py-1 text-[11px] font-bold text-rose-700 hover:bg-rose-100 transition shrink-0"
                >
                  <Sparkles size={11} /> 절세 제안 전략
                </button>
              </div>
              {newSummary ? (
                <FinancialIncomeGauge summary={newSummary} />
              ) : (
                <div className="flex min-h-[180px] flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 text-center">
                  <p className="text-xs font-semibold text-slate-400">
                    TAB2 또는 TAB3에서 리밸런싱 확정 후<br />신규 세금 점검이 표시됩니다.
                  </p>
                </div>
              )}
            </div>

          </div>
        </div>

      </div>
    </div>
  );
}

// ── 스트레스 테스트 카드 내부 뷰 ─────────────────────────────────────────────
// selectedScenario / onSelectScenario를 props로 받아 좌우 패널이 동일 인덱스 공유
function StressTestCard({
  stressResult,
  selectedScenario,
  onSelectScenario,
}: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  stressResult: any;
  selectedScenario: number;
  onSelectScenario: (idx: number) => void;
}) {
  return (
    <div className="flex flex-col flex-1 gap-4">
      {/* 시나리오 탭 버튼 — 시계열 연대기 순(2018→2020→2022) */}
      <div className="flex flex-wrap gap-2">
        {STRESS_SCENARIO_ORDER.map(({ key, period, desc }, idx) => {
          const sc = stressResult[key];
          const isSelected = selectedScenario === idx;
          return (
            <button
              key={key}
              type="button"
              onClick={() => onSelectScenario(idx)}
              className={`rounded-lg border px-3 py-2 text-left text-xs font-bold transition ${
                isSelected
                  ? "border-red-300 bg-red-50 text-red-800"
                  : "border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50"
              }`}
            >
              <span className="block font-extrabold">{period}</span>
              <span className={`block text-[10px] font-normal ${isSelected ? "text-red-500" : "text-slate-400"}`}>{desc}</span>
              <span className={`block text-xs font-bold ${isSelected ? "text-red-600" : "text-slate-400"}`}>
                {sc ? `${(sc.lossRate * 100).toFixed(1)}%` : "—"}
              </span>
            </button>
          );
        })}
      </div>

      {/* 선택된 시나리오 막대 그래프 */}
      {(() => {
        const sc = stressResult[STRESS_SCENARIO_ORDER[selectedScenario].key];
        return sc ? <StressScenarioBar scenario={sc} /> : (
          <p className="text-sm text-slate-400">시나리오 데이터가 없습니다.</p>
        );
      })()}

      {/* 리스크 유형 태그 — 항상 카드 하단 고정 */}
      {Array.isArray(stressResult.riskTypes) && stressResult.riskTypes.length > 0 && (
        <div className="flex flex-wrap gap-2 mt-auto">
          {stressResult.riskTypes.map((rt: string) => (
            <span
              key={rt}
              className="rounded-full border border-red-200 bg-red-50 px-3 py-1 text-xs font-bold text-red-800"
            >
              {rt}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

// ── PDF 제안서 옵션 선택 모달 ───────────────────────────────────────────────
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function ReportOptionsModal({
  sections,
  setSections,
  onClose,
  customerName,
  leftData,
  rightData,
  leftAssets,
  rightAssets,
  leftAfterTaxReturn,
  rightAfterTaxReturn,
  summary,
  newSummary,
  marginalTaxRate,
  mode,
  setMode,
}: {
  sections: ReportSectionToggles;
  setSections: (s: ReportSectionToggles) => void;
  onClose: () => void;
  customerName: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  leftData: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  rightData: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  leftAssets: any[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  rightAssets: any[];
  leftAfterTaxReturn: number | null;
  rightAfterTaxReturn: number | null;
  summary: FinancialIncomeSummary | null;
  newSummary: FinancialIncomeSummary | null;
  marginalTaxRate?: number;
  mode: ReportMode;
  setMode: (m: ReportMode) => void;
}) {
  const toggle = (key: keyof ReportSectionToggles) => {
    setSections({ ...sections, [key]: !sections[key] });
  };

  const today = new Date().toLocaleDateString("ko-KR", { year: "numeric", month: "long", day: "numeric" });
  
  const leftSide = leftData
    ? {
        label: "기존 포트폴리오",
        quantResult: leftData.quantResult,
        stressResult: (leftData as any).stressResult,
        healthResult: leftData.healthResult,
        enrichedAssets: leftAssets,
        afterTaxReturn: leftAfterTaxReturn,
        portfolioIssueSummary: leftData.portfolioIssueSummary,
      }
    : null;

  const rightSide = rightData || rightAssets.length > 0
    ? {
        label: rightData ? "신규 포트폴리오" : "매도 후 잔여 포트폴리오",
        quantResult: rightData?.quantResult,
        stressResult: (rightData as any)?.stressResult,
        healthResult: rightData?.healthResult,
        enrichedAssets: rightAssets,
        afterTaxReturn: rightAfterTaxReturn,
        portfolioIssueSummary: rightData?.portfolioIssueSummary,
      }
    : null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-2xl bg-white shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
          <h3 className="text-base font-bold text-navy">제안서 PDF 옵션 선택</h3>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-600">✕</button>
        </div>

        <div className="px-6 py-5">
          <div>
          <p className="mb-3 text-xs font-bold text-slate-500 uppercase tracking-wide">보고서 형식</p>
            <div className="mb-4 flex gap-3">
              {([
                { value: "normal", label: "포트폴리오 제안서", desc: "기본 형식 · 일반 크기" },
                { value: "easy", label: "포트폴리오 제안서 (쉬운 설명 버전)", desc: "쉬운 설명 + 용어 각주 · 큰 글자" },
              ] as const).map((opt) => (
                <label key={opt.value} className={`flex-1 cursor-pointer rounded-lg border-2 px-3 py-2.5 transition ${mode === opt.value ? "border-samsung bg-blue-50" : "border-slate-200 hover:border-slate-300"}`}>
                  <input type="radio" name="reportMode" value={opt.value} checked={mode === opt.value} onChange={() => setMode(opt.value)} className="sr-only" />
                  <p className={`text-xs font-bold ${mode === opt.value ? "text-samsung" : "text-slate-600"}`}>{opt.label}</p>
                  <p className="mt-0.5 text-[10px] text-slate-400">{opt.desc}</p>
                </label>
              ))}
            </div>
            <p className="mb-3 text-xs font-bold text-slate-500 uppercase tracking-wide">포함할 항목 선택</p>
            <div className="space-y-2.5">
              {OPTIONAL_SECTIONS.map((opt) => (
                <label key={opt.key} className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2.5 cursor-pointer hover:bg-slate-50">
                  <input
                    type="checkbox"
                    checked={sections[opt.key]}
                    onChange={() => toggle(opt.key)}
                    className="h-4 w-4 rounded border-slate-300 text-samsung focus:ring-samsung"
                  />
                  <span className="text-sm font-semibold text-navy">{opt.label}</span>
                </label>
              ))}
            </div>
          </div>
        </div>

        <div className="flex gap-3 border-t border-slate-100 px-6 py-4">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-bold text-slate-600 hover:bg-slate-50"
          >
            취소
          </button>
          <PDFDownloadLinkClient
            customerName={customerName}
            reportDate={today}
            sections={sections}
            left={leftSide}
            right={rightSide}
            leftTaxSummary={summary}
            rightTaxSummary={newSummary}
            marginalTaxRate={marginalTaxRate}
            mode={mode}
            onGenerated={onClose} 
          />
        </div>
      </div>
    </div>
  );
}

// ── PDFDownloadLink는 클라이언트에서만 동작 + 동적 import로 SSR 방지 ─────────
function PDFDownloadLinkClient(props: {
  customerName: string;
  reportDate: string;
  sections: ReportSectionToggles;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  left: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  right: any;
  leftTaxSummary: FinancialIncomeSummary | null;
  rightTaxSummary: FinancialIncomeSummary | null;
  marginalTaxRate?: number;
  mode?: ReportMode;
  onGenerated: () => void;
}) {
  const [PDFDownloadLink, setPDFDownloadLink] = useState<any>(null);

  useEffect(() => {
    import("@react-pdf/renderer").then((mod) => {
      setPDFDownloadLink(() => mod.PDFDownloadLink);
    });
  }, []);

  if (!PDFDownloadLink) {
    return (
      <button
        type="button"
        disabled
        className="flex-1 rounded-xl bg-samsung px-4 py-2.5 text-sm font-bold text-white opacity-60"
      >
        준비 중...
      </button>
    );
  }

  return (
    <PDFDownloadLink
      document={
        <PortfolioReportPdf
          customerName={props.customerName}
          reportDate={props.reportDate}
          sections={props.sections}
          left={props.left}
          right={props.right}
          leftTaxSummary={props.leftTaxSummary}
          rightTaxSummary={props.rightTaxSummary}
          marginalTaxRate={props.marginalTaxRate}
          mode={props.mode}
        />
      }
      fileName={`${props.customerName}_포트폴리오_제안서_${props.reportDate.replace(/[^0-9]/g, "")}.pdf`}
      className="flex-1 rounded-xl bg-samsung px-4 py-2.5 text-center text-sm font-bold text-white hover:bg-samsung/90"
      
    >
      {({ loading }: { loading: boolean }) => (loading ? "생성 중..." : "PDF 다운로드")}
    </PDFDownloadLink>
  );
}
