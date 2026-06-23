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
import type { FinancialIncomeSummary, TLHData } from "../tab1/FinancialIncomeGauge";
import { PortfolioReportPdf, OPTIONAL_SECTIONS, type ReportSectionToggles, type ReportMode } from "./PortfolioReportPdf";

const SCENARIO_KEYS = STRESS_SCENARIO_ORDER.map((s) => s.key);

interface MetricSnapshot {
  afterTaxReturn: number | null;
  sharpe: number | null;
  sortino: number | null;
  mdd: number | null;
  volatility: number | null;
  beta: number | null;
}

// ── 동적 PB 코멘트 생성 (API 없이 지표 비교 기반) ──
function generatePdfComment(left: MetricSnapshot, right: MetricSnapshot): string {
  const lines: string[] = [];

  const rDiff = (left.afterTaxReturn != null && right.afterTaxReturn != null) ? right.afterTaxReturn - left.afterTaxReturn : null;
  const mDiff = (left.mdd != null && right.mdd != null) ? right.mdd - left.mdd : null;
  const sDiff = (left.sharpe != null && right.sharpe != null) ? right.sharpe - left.sharpe : null;
  const vDiff = (left.volatility != null && right.volatility != null) ? right.volatility - left.volatility : null;

  if (rDiff != null) {
    if (rDiff >= 0) {
      lines.push(`세후 수익률이 ${(rDiff * 100).toFixed(1)}%p 개선되어 실질 투자 효율이 높아졌습니다.`);
    } else {
      lines.push(`세후 수익률은 ${Math.abs(rDiff * 100).toFixed(1)}%p 낮아졌으나, 안정성을 높이는 방향으로 재편한 결과로 장기적으로 회복 여지가 있습니다.`);
    }
  }

  if (mDiff != null) {
    if (mDiff <= 0) {
      lines.push(`최대 낙폭(MDD)이 ${Math.abs(mDiff * 100).toFixed(1)}%p 축소되어 하락장 방어력이 강화되었습니다.`);
    } else {
      lines.push(`최대 낙폭(MDD)은 ${(mDiff * 100).toFixed(1)}%p 확대되었으나, 수익 추구를 위한 위험 자산 편입에 따른 것으로 분산 구조 내에서 관리 가능한 수준입니다.`);
    }
  }

  if (sDiff != null) {
    if (sDiff >= 0) {
      lines.push(`샤프 비율이 ${sDiff.toFixed(2)} 상승하여 위험 대비 수익 효율이 개선되었습니다.`);
    } else {
      lines.push(`샤프 비율은 ${Math.abs(sDiff).toFixed(2)} 하락했으나, 변동성 확대 구간에서 일시적으로 나타나는 현상으로 포트폴리오 방향성 자체는 유효합니다.`);
    }
  }

  if (vDiff != null) {
    if (vDiff <= 0) {
      lines.push(`포트폴리오 변동성이 ${Math.abs(vDiff * 100).toFixed(1)}%p 감소하여 안정성이 높아졌습니다.`);
    } else {
      lines.push(`변동성은 ${(vDiff * 100).toFixed(1)}%p 증가했으나, 성장성 높은 자산 편입에 따른 자연스러운 결과이며 장기 보유 시 유리하게 작용할 수 있습니다.`);
    }
  }

  return lines.join(" ");
}

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
  const [selectedScenario, setSelectedScenario] = useState(0);
  const printRef = useRef<HTMLDivElement>(null);
  const [showReportOptions, setShowReportOptions] = useState(false);
  const [reportMode, setReportMode] = useState<ReportMode>("normal");
  const [reportSections, setReportSections] = useState<ReportSectionToggles>({
    stress: true, health: true, taxIncome: true, holdings: true,
  });

  useEffect(() => {
    if (!selectedCustomer) return;
    const wasReset = sessionStorage.getItem(FINANCIAL_INCOME_RESET_KEY) === '1';
    if (wasReset) {
      setSummary(null);
      loadTaxSummaries(selectedCustomer).then(({ newSummary }) => {
        if (newSummary) setNewSummary(newSummary as FinancialIncomeSummary);
        else { try { const l = localStorage.getItem(NEW_PORTFOLIO_INCOME_STORAGE_KEY); if (l) setNewSummary(JSON.parse(l)); } catch {} }
      });
      return;
    }
    loadTaxSummaries(selectedCustomer).then(({ currentSummary, newSummary }) => {
      if (currentSummary) setSummary(currentSummary as FinancialIncomeSummary);
      else { try { const l = localStorage.getItem(FINANCIAL_INCOME_STORAGE_KEY); if (l) setSummary(JSON.parse(l)); } catch {} }
      if (newSummary) setNewSummary(newSummary as FinancialIncomeSummary);
      else { try { const l = localStorage.getItem(NEW_PORTFOLIO_INCOME_STORAGE_KEY); if (l) setNewSummary(JSON.parse(l)); } catch {} }
    });
  }, [selectedCustomer]);

  useEffect(() => {
    const loadCurrent = () => { try { const s = localStorage.getItem(FINANCIAL_INCOME_STORAGE_KEY); if (s) setSummary(JSON.parse(s)); } catch {} };
    const loadNew = () => { try { const s = localStorage.getItem(NEW_PORTFOLIO_INCOME_STORAGE_KEY); if (s) setNewSummary(JSON.parse(s)); } catch {} };
    window.addEventListener("financial-income-updated", loadCurrent);
    window.addEventListener("new-financial-income-updated", loadNew);
    return () => { window.removeEventListener("financial-income-updated", loadCurrent); window.removeEventListener("new-financial-income-updated", loadNew); };
  }, []);

  const leftData = data;
  const rightData = newPortfolioAnalysisResult;
  const leftAssets: PortfolioAsset[] = Array.isArray(leftData?.enrichedAssets) ? (leftData!.enrichedAssets as PortfolioAsset[]) : [];

  const enrichedRemainingAssets = useMemo(() => {
    const map = new Map(leftAssets.map(a => [`${a.name ?? ""}::${a.ticker ?? ""}`, a]));
    return rebalancingSellAssets.map(a => {
      const enriched = map.get(`${a.name ?? ""}::${a.ticker ?? ""}`);
      return { ...a, current_price: enriched?.current_price ?? a.current_price, current_value: enriched?.current_value ?? a.current_value };
    });
  }, [rebalancingSellAssets, leftAssets]); // eslint-disable-line react-hooks/exhaustive-deps

  const rightAssets: PortfolioAsset[] = useMemo(() => {
    if (Array.isArray(rightData?.enrichedAssets) && rightData!.enrichedAssets.length > 0) return rightData!.enrichedAssets as PortfolioAsset[];
    return enrichedRemainingAssets.filter(a => a.amount > 0);
  }, [rightData, enrichedRemainingAssets]);

  const tlhData = useMemo<TLHData | undefined>(() => {
    if (!rightAssets.length) return undefined;
    return {
      assets: rightAssets.map((a) => ({ name: a.name ?? "", ticker: a.ticker ?? "", buy_price: a.buy_price, current_price: a.current_price, amount: a.amount, amount_type: a.amount_type ?? "quantity", productType: a.productType })),
      netCapitalGains: newSummary?.netCapitalGains ?? 0,
      capitalGainsTax: newSummary?.foreignCapitalGainsTax ?? 0,
    };
  }, [rightAssets, newSummary]); // eslint-disable-line react-hooks/exhaustive-deps

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const leftStressResult = (leftData as any)?.stressResult;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rightStressResult = (rightData as any)?.stressResult;

  const leftAfterTaxReturn = useMemo(() => summary ? calcAfterTaxReturn(summary, leftAssets, false) : null, [summary, leftAssets]); // eslint-disable-line react-hooks/exhaustive-deps
  const rightAfterTaxReturn = useMemo(() => newSummary ? calcAfterTaxReturn(newSummary, rightAssets) : null, [newSummary, rightAssets]); // eslint-disable-line react-hooks/exhaustive-deps

  const leftMetrics = useMemo<MetricSnapshot>(() => ({
    afterTaxReturn: leftAfterTaxReturn ?? leftData?.quantResult?.performance?.afterTaxExpectedReturn ?? null,
    sharpe: leftData?.quantResult?.performance?.sharpeRatio ?? null,
    sortino: leftData?.quantResult?.performance?.sortinoRatio ?? null,
    mdd: leftData?.quantResult?.risk?.mdd != null ? Math.abs(leftData.quantResult.risk.mdd) : null,
    volatility: leftData?.quantResult?.risk?.volatility ?? null,
    beta: leftData?.quantResult?.sensitivity?.beta ?? null,
  }), [leftData, leftAfterTaxReturn]);

  const rightMetrics = useMemo<MetricSnapshot>(() => ({
    afterTaxReturn: rightAfterTaxReturn ?? rightData?.quantResult?.performance?.afterTaxExpectedReturn ?? null,
    sharpe: rightData?.quantResult?.performance?.sharpeRatio ?? null,
    sortino: rightData?.quantResult?.performance?.sortinoRatio ?? null,
    mdd: rightData?.quantResult?.risk?.mdd != null ? Math.abs(rightData.quantResult.risk.mdd) : null,
    volatility: rightData?.quantResult?.risk?.volatility ?? null,
    beta: rightData?.quantResult?.sensitivity?.beta ?? null,
  }), [rightData, rightAfterTaxReturn]);

  return (
    <div className="space-y-6">

      {showPensionPanel && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setShowPensionPanel(false)}>
          <div className="relative w-full max-w-4xl max-h-[92vh] overflow-y-auto rounded-2xl bg-white shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-200 bg-white px-5 py-3">
              <div className="flex items-center gap-2 text-rose-700">
                <Sparkles size={15} />
                <span className="text-sm font-bold">절세 제안 전략</span>
              </div>
              <button type="button" onClick={() => setShowPensionPanel(false)} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 transition">
                <X size={18} />
              </button>
            </div>
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
          leftMetrics={leftMetrics}
          rightMetrics={rightMetrics}
        />
      )}

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

      <div ref={printRef} className="space-y-6 bg-white">
        <div className="grid grid-cols-1 gap-x-6 gap-y-4 lg:grid-cols-2">

          <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2.5 shadow-soft">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-samsung text-xs font-bold text-white">A</span>
            <span className="text-sm font-bold text-navy">기존 포트폴리오</span>
          </div>
          <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2.5 shadow-soft">
            <span className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold text-white ${rightAssets.length > 0 ? "bg-emerald-500" : "bg-slate-300"}`}>B</span>
            <span className={`text-sm font-bold ${rightAssets.length > 0 ? "text-navy" : "text-slate-400"}`}>
              {rightData ? "신규 포트폴리오 (리밸런싱 완료)" : rightAssets.length > 0 ? "매도 후 잔여 포트폴리오" : "신규 포트폴리오 (준비 중)"}
            </span>
          </div>

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
              <InteractiveDonutWithTable assets={rightAssets} initialAssets={leftAssets} showRebalancing={leftAssets.length > 0} />
            </ResultCard>
          ) : (
            <NewPortfolioPlaceholder />
          )}

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

          <div className="flex flex-col">
            {leftStressResult && (
              <ResultCard icon={<AlertTriangle size={18} />} title="스트레스 테스트 – 3대 위기 시나리오" accent="red">
                <StressTestCard stressResult={leftStressResult} selectedScenario={selectedScenario} onSelectScenario={setSelectedScenario} />
              </ResultCard>
            )}
          </div>
          <div className="flex flex-col">
            {rightStressResult && (
              <ResultCard icon={<AlertTriangle size={18} />} title="스트레스 테스트 – 3대 위기 시나리오" accent="red">
                <StressTestCard stressResult={rightStressResult} selectedScenario={selectedScenario} onSelectScenario={setSelectedScenario} />
              </ResultCard>
            )}
          </div>

        </div>

        <div className="space-y-3">
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <div className="flex flex-col gap-2">
              {summary && (
                <>
                  <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 shadow-soft">
                    <span className="flex h-5 w-5 items-center justify-center rounded-full bg-samsung text-[10px] font-bold text-white">A</span>
                    <span className="text-xs font-bold text-navy">기존 포트폴리오 세금 점검</span>
                  </div>
                  <FinancialIncomeGauge summary={summary} hideCapitalGains={true} />
                </>
              )}
            </div>
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 shadow-soft">
                <div className="flex items-center gap-2">
                  <span className={`flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold text-white ${newSummary ? "bg-emerald-500" : "bg-slate-300"}`}>B</span>
                  <span className={`text-xs font-bold ${newSummary ? "text-navy" : "text-slate-400"}`}>신규 포트폴리오 세금 점검</span>
                </div>
                <button type="button" onClick={() => setShowPensionPanel(true)} className="flex items-center gap-1.5 rounded-lg bg-rose-50 border border-rose-200 px-2.5 py-1 text-[11px] font-bold text-rose-700 hover:bg-rose-100 transition shrink-0">
                  <Sparkles size={11} /> 절세 제안 전략
                </button>
              </div>
              {newSummary ? (
                <FinancialIncomeGauge summary={newSummary} tlhData={tlhData} />
              ) : (
                <div className="flex min-h-[180px] flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 text-center">
                  <p className="text-xs font-semibold text-slate-400">TAB2 또는 TAB3에서 리밸런싱 확정 후<br />신규 세금 점검이 표시됩니다.</p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function StressTestCard({ stressResult, selectedScenario, onSelectScenario }: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  stressResult: any; selectedScenario: number; onSelectScenario: (idx: number) => void;
}) {
  return (
    <div className="flex flex-col flex-1 gap-4">
      <div className="flex flex-wrap gap-2">
        {STRESS_SCENARIO_ORDER.map(({ key, period, desc }, idx) => {
          const sc = stressResult[key];
          const isSelected = selectedScenario === idx;
          return (
            <button key={key} type="button" onClick={() => onSelectScenario(idx)}
              className={`rounded-lg border px-3 py-2 text-left text-xs font-bold transition ${isSelected ? "border-red-300 bg-red-50 text-red-800" : "border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50"}`}>
              <span className="block font-extrabold">{period}</span>
              <span className={`block text-[10px] font-normal ${isSelected ? "text-red-500" : "text-slate-400"}`}>{desc}</span>
              <span className={`block text-xs font-bold ${isSelected ? "text-red-600" : "text-slate-400"}`}>
                {sc ? `${(sc.lossRate * 100).toFixed(1)}%` : "—"}
              </span>
            </button>
          );
        })}
      </div>
      {(() => {
        const sc = stressResult[STRESS_SCENARIO_ORDER[selectedScenario].key];
        return sc ? <StressScenarioBar scenario={sc} /> : <p className="text-sm text-slate-400">시나리오 데이터가 없습니다.</p>;
      })()}
      {Array.isArray(stressResult.riskTypes) && stressResult.riskTypes.length > 0 && (
        <div className="flex flex-wrap gap-2 mt-auto">
          {stressResult.riskTypes.map((rt: string) => (
            <span key={rt} className="rounded-full border border-red-200 bg-red-50 px-3 py-1 text-xs font-bold text-red-800">{rt}</span>
          ))}
        </div>
      )}
    </div>
  );
}

function ReportOptionsModal({
  sections, setSections, onClose, customerName,
  leftData, rightData, leftAssets, rightAssets,
  leftAfterTaxReturn, rightAfterTaxReturn,
  summary, newSummary, marginalTaxRate, mode, setMode,
  leftMetrics, rightMetrics,
}: {
  sections: ReportSectionToggles; setSections: (s: ReportSectionToggles) => void;
  onClose: () => void; customerName: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  leftData: any; rightData: any; leftAssets: any[]; rightAssets: any[];
  leftAfterTaxReturn: number | null; rightAfterTaxReturn: number | null;
  summary: FinancialIncomeSummary | null; newSummary: FinancialIncomeSummary | null;
  marginalTaxRate?: number; mode: ReportMode; setMode: (m: ReportMode) => void;
  leftMetrics: MetricSnapshot; rightMetrics: MetricSnapshot;
}) {
  const toggle = (key: keyof ReportSectionToggles) => setSections({ ...sections, [key]: !sections[key] });
  const today = new Date().toLocaleDateString("ko-KR", { year: "numeric", month: "long", day: "numeric" });

  const leftSide = leftData ? {
    label: "기존 포트폴리오", quantResult: leftData.quantResult,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    stressResult: (leftData as any).stressResult, healthResult: leftData.healthResult,
    enrichedAssets: leftAssets, afterTaxReturn: leftAfterTaxReturn,
    portfolioIssueSummary: leftData.portfolioIssueSummary,
  } : null;

  const rightSide = rightData || rightAssets.length > 0 ? {
    label: rightData ? "신규 포트폴리오" : "매도 후 잔여 포트폴리오",
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    quantResult: rightData?.quantResult, stressResult: (rightData as any)?.stressResult,
    healthResult: rightData?.healthResult, enrichedAssets: rightAssets,
    afterTaxReturn: rightAfterTaxReturn, portfolioIssueSummary: rightData?.portfolioIssueSummary,
  } : null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-2xl bg-white shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
          <h3 className="text-base font-bold text-navy">제안서 PDF 옵션 선택</h3>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-600">✕</button>
        </div>
        <div className="px-6 py-5">
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
                <input type="checkbox" checked={sections[opt.key]} onChange={() => toggle(opt.key)} className="h-4 w-4 rounded border-slate-300 text-samsung focus:ring-samsung" />
                <span className="text-sm font-semibold text-navy">{opt.label}</span>
              </label>
            ))}
          </div>
        </div>
        <div className="flex gap-3 border-t border-slate-100 px-6 py-4">
          <button type="button" onClick={onClose} className="flex-1 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-bold text-slate-600 hover:bg-slate-50">취소</button>
          <PDFDownloadLinkClient
            customerName={customerName} reportDate={today} sections={sections}
            left={leftSide} right={rightSide}
            leftTaxSummary={summary} rightTaxSummary={newSummary}
            marginalTaxRate={marginalTaxRate} mode={mode} onGenerated={onClose}
            leftMetrics={leftMetrics} rightMetrics={rightMetrics}
          />
        </div>
      </div>
    </div>
  );
}

function PDFDownloadLinkClient(props: {
  customerName: string; reportDate: string; sections: ReportSectionToggles;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  left: any; right: any;
  leftTaxSummary: FinancialIncomeSummary | null; rightTaxSummary: FinancialIncomeSummary | null;
  marginalTaxRate?: number; mode?: ReportMode; onGenerated: () => void;
  leftMetrics: MetricSnapshot; rightMetrics: MetricSnapshot;
}) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [PDFDownloadLink, setPDFDownloadLink] = useState<any>(null);
  const aiComment = (props.left && props.right)
    ? generatePdfComment(props.leftMetrics, props.rightMetrics)
    : "";

  useEffect(() => {
    import("@react-pdf/renderer").then((mod) => setPDFDownloadLink(() => mod.PDFDownloadLink));
  }, []);

  if (!PDFDownloadLink) {
    return (
      <button type="button" disabled className="flex-1 rounded-xl bg-samsung px-4 py-2.5 text-sm font-bold text-white opacity-60">
        준비 중...
      </button>
    );
  }

  return (
    <PDFDownloadLink
      document={
        <PortfolioReportPdf
          customerName={props.customerName} reportDate={props.reportDate}
          sections={props.sections} left={props.left} right={props.right}
          leftTaxSummary={props.leftTaxSummary} rightTaxSummary={props.rightTaxSummary}
          marginalTaxRate={props.marginalTaxRate} mode={props.mode}
          aiComment={aiComment}
        />
      }
      fileName={`${props.customerName}_포트폴리오_제안서_${props.reportDate.replace(/[^0-9]/g, "")}.pdf`}
      className="flex-1 rounded-xl bg-samsung px-4 py-2.5 text-center text-sm font-bold text-white hover:bg-samsung/90"
    >
      {({ loading }: { loading: boolean }) => (loading ? "생성 중..." : "PDF 다운로드")}
    </PDFDownloadLink>
  );
}