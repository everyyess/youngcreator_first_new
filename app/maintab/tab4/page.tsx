"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const PDFDownloadLinkLazy = dynamic(
  () => import("@react-pdf/renderer").then((mod) => mod.PDFDownloadLink),
  { ssr: false },
) as any;
import { Activity, AlertTriangle, Download, GitCompare, Sparkles, TrendingUp, WalletCards, X } from "lucide-react";
import PensionTaxPanel from "../tab1/PensionTaxPanel";
import { useCustomerView } from "../CustomerViewContext";
import {
  fmt,
  fmtPct,
  HealthRadarChart,
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
import ProposalGenerator from "./ProposalGenerator";

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
  const { isCustomerView } = useCustomerView();
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
  const [showProposalGenerator, setShowProposalGenerator] = useState(false);
  const [reportMode, setReportMode] = useState<ReportMode>("easy");
  const [consultationProposal, setConsultationProposal] = useState<import("./PortfolioReportPdf").ConsultationProposalSections | undefined>(undefined);
  const [reportSections, setReportSections] = useState<ReportSectionToggles>({
    stress: true, health: true, taxIncome: true, holdings: true,
  });

  useEffect(() => { 
    if (!selectedCustomer) return;  
    // Clear stale state from previous customer immediately
    setSummary(null);
    setNewSummary(null);
    const wasReset = sessionStorage.getItem(FINANCIAL_INCOME_RESET_KEY) === '1';
    if (wasReset) {
      // 신규 포트폴리오만 리셋된 상태 — 기존(현재) 세금 점검은 그대로 로드해야 함
      loadTaxSummaries(selectedCustomer).then(({ currentSummary, newSummary }) => {
        if (currentSummary) setSummary(currentSummary as FinancialIncomeSummary);
        else { try { const l = localStorage.getItem(FINANCIAL_INCOME_STORAGE_KEY); if (l) setSummary(JSON.parse(l)); } catch {} }
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
    const loadCurrent = () => { try { const s = localStorage.getItem(FINANCIAL_INCOME_STORAGE_KEY); setSummary(s ? JSON.parse(s) : null); } catch {} };
    const loadNew = () => { try { const s = localStorage.getItem(NEW_PORTFOLIO_INCOME_STORAGE_KEY); setNewSummary(s ? JSON.parse(s) : null); } catch {} };
    window.addEventListener("financial-income-updated", loadCurrent);
    window.addEventListener("new-financial-income-updated", loadNew);
    return () => { window.removeEventListener("financial-income-updated", loadCurrent); window.removeEventListener("new-financial-income-updated", loadNew); };
  }, []);

  const leftData = data;
  const rightData = newPortfolioAnalysisResult;
  const leftAssets: PortfolioAsset[] = Array.isArray(leftData?.enrichedAssets) ? (leftData!.enrichedAssets as PortfolioAsset[]) : [];

  // B패널(신규 포트폴리오) 자산 목록 — 항상 "지금 리밸런싱 중인 실제 선택 상태"(rebalancingSellAssets)를
  // 기준으로 계산한다. 예전엔 rightData(직전에 완료된 runAnalysis 결과)가 있으면 그걸 통째로 우선 썼는데,
  // TAB3-2에서 상품을 담아도 새 runAnalysis()가 끝나기 전(디바운스+시세조회로 수십 초~1분 소요)까지는
  // 화면이 "담기 전" 상태로 멈춰 있는 것처럼 보이는 원인이었다. 이제는 매번 최신 선택 목록을 그대로 쓰고,
  // 가격만 가장 최근에 성공한 분석 결과(rightData, 없으면 leftData)에서 종목명 기준으로 보완한다.
  // 티커가 아닌 "이름"으로 매칭하는 이유: 리밸런싱에 막 담긴 원본 자산은 분석 실행 전이라 티커가 아직
  // 비어있을 수 있는데(자동완성은 분석 시점에 일어남), 티커까지 일치해야 매칭되게 하면 기존 보유 주식이
  // 가격 정보를 못 찾아 current_value=0으로 빠지고, 그 결과 도넛차트가 그 종목을 "가치 없음"으로 취급해
  // 상품(채권 등) 하나가 100%인 것처럼 보이는 왜곡이 생겼다.
  const rightAssets: PortfolioAsset[] = useMemo(() => {
    const priceByName = new Map<string, PortfolioAsset>();
    for (const a of leftAssets) if (a.name) priceByName.set(a.name, a);
    if (Array.isArray(rightData?.enrichedAssets)) {
      for (const a of rightData!.enrichedAssets as PortfolioAsset[]) if (a.name) priceByName.set(a.name, a);
    }
    return rebalancingSellAssets
      .filter((a) => a.amount > 0)
      .map((a) => {
        const priced = a.name ? priceByName.get(a.name) : undefined;
        const isBond = a.asset_class === "국내채권" || a.asset_class === "해외채권" || a.productType === "국내채권" || a.productType === "해외채권";
        return {
          ...a,
          current_price: a.current_price ?? priced?.current_price,
          current_value: a.current_value ?? priced?.current_value,
          // sector도 가격과 같은 이유로 보완 필요 — 안 하면 방금 담은 자산은 전부 "기타"로 잡혀
          // "보유 종목 섹터 비중" 도넛이 통째로 빈 화면("분석 실행 후 표시됩니다")이 된다.
          // 채권은 runAnalysis()가 항상 sector="채권"으로 통일해서 붙이므로, 아직 분석 전이라도
          // 여기서 미리 같은 값을 붙여주면 담자마자 바로 반영된다(주식·펀드는 실제 섹터 데이터를
          // 확보하는 분석 완료를 기다려야 하므로 그대로 둔다).
          sector: a.sector ?? priced?.sector ?? (isBond ? "채권" : undefined),
        };
      });
  }, [rebalancingSellAssets, rightData, leftAssets]);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const leftStressResult = (leftData as any)?.stressResult;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rightStressResult = (rightData as any)?.stressResult;

  // "세후 수익률"은 세금 점검(calcFinancialIncomeSummary)과 같은 이유로 펀드·랩어카운트를 뺀다 —
  // 이 상품들은 카탈로그에 실제 배당·이자 수익률 데이터가 없어(표시용 return1Y는 총수익률이지 배당률이
  // 아님) 세금 계산에서 사실상 반영되지 않는데, 세후 수익률에는 그대로 원금·평가금액이 섞여 들어가면
  // "세금은 안 잡히는데 수익률엔 잡히는" 앞뒤가 안 맞는 숫자가 나온다. 세금 점검에 실제로 찍히는
  // 상품(주식·채권·개별 상품)과 그 금액만 반영한다.
  const isFundOrWrap = (a: PortfolioAsset) => a.productType === "펀드" || a.productType === "랩어카운트";
  const leftAssetsForReturn = useMemo(() => leftAssets.filter((a) => !isFundOrWrap(a)), [leftAssets]);
  const rightAssetsForReturn = useMemo(() => rightAssets.filter((a) => !isFundOrWrap(a)), [rightAssets]);

  const leftAfterTaxReturn = useMemo(() => summary ? calcAfterTaxReturn(summary, leftAssetsForReturn, false) : null, [summary, leftAssetsForReturn]); // eslint-disable-line react-hooks/exhaustive-deps
  const rightAfterTaxReturn = useMemo(() => newSummary ? calcAfterTaxReturn(newSummary, rightAssetsForReturn) : null, [newSummary, rightAssetsForReturn]); // eslint-disable-line react-hooks/exhaustive-deps

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

      {/* 절세 제안 전략 — 2026-09-05 임시 비활성화(사용자 요청). 복구하려면 이 주석과 아래 트리거 버튼 주석을 해제할 것.
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
              <PensionTaxPanel tMarginal={tMarginal} alwaysOpen isCustomerView={isCustomerView} />
            </div>
          </div>
        </div>
      )}
      */}

<ProposalGenerator
        open={showProposalGenerator}
        onClose={() => setShowProposalGenerator(false)}
        onApproved={(sections) => {
          setConsultationProposal(sections);
          setShowProposalGenerator(false);
          setShowReportOptions(true);
        }}
        customerName={selectedCustomerProfile?.name || selectedCustomerProfile?.fallbackName || "고객"}
        leftData={leftData}
        rightData={rightData}
        leftAssets={leftAssets}
        rightAssets={rightAssets}
        leftMetrics={leftMetrics}
        rightMetrics={rightMetrics}
      />

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
          consultationProposal={consultationProposal}
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
          onClick={() => setShowProposalGenerator(true)}
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

          <div className="flex flex-col gap-4">
            {leftData?.portfolioIssueSummary && leftData.healthResult && (
              <PortfolioIssueBanner healthResult={leftData.healthResult} stressResult={leftStressResult} />
            )}
            {leftData?.healthResult?.items && (
              <ResultCard icon={<Activity size={18} />} title="진단 점수 시각화" accent="blue">
                <HealthRadarChart items={leftData.healthResult.items} badge={leftData.healthResult.badge} />
              </ResultCard>
            )}
          </div>
          <div className="flex flex-col gap-4">
            {rightData?.portfolioIssueSummary && rightData.healthResult && (
              <PortfolioIssueBanner healthResult={rightData.healthResult} stressResult={rightStressResult} />
            )}
            {rightData?.healthResult?.items && (
              <ResultCard icon={<Activity size={18} />} title="진단 점수 시각화" accent="blue">
                <HealthRadarChart items={rightData.healthResult.items} badge={rightData.healthResult.badge} />
              </ResultCard>
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
                  <MetricCard
                    label="세후 수익률"
                    value={fmtPct(leftAfterTaxReturn ?? leftData.quantResult.performance.afterTaxExpectedReturn)}
                    sub={leftAssets.some(isFundOrWrap) ? "세후 연환산 기대수익 · 펀드·랩어카운트는 제외(주식·채권만 반영)" : "세후 연환산 기대수익"}
                  />
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
                  <MetricCard
                    label="세후 수익률"
                    value={fmtPct(rightAfterTaxReturn ?? rightData.quantResult.performance.afterTaxExpectedReturn)}
                    sub={rightAssets.some(isFundOrWrap) ? "세후 연환산 기대수익 · 펀드·랩어카운트는 제외(주식·채권만 반영)" : "세후 연환산 기대수익"}
                  />
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
              <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 shadow-soft">
                <span className={`flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold text-white ${summary ? "bg-samsung" : "bg-slate-300"}`}>A</span>
                <span className={`text-xs font-bold ${summary ? "text-navy" : "text-slate-400"}`}>기존 포트폴리오 세금 점검</span>
              </div>
              {summary ? (
                <FinancialIncomeGauge summary={summary} hideCapitalGains={true} />
              ) : (
                <div className="flex min-h-[180px] flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 text-center">
                  <p className="text-xs font-semibold text-slate-400">TAB1에서 기존 포트폴리오 자산 입력 후<br />기존 세금 점검이 표시됩니다.</p>
                </div>
              )}
            </div>
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 shadow-soft">
                <div className="flex items-center gap-2">
                  <span className={`flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold text-white ${newSummary ? "bg-emerald-500" : "bg-slate-300"}`}>B</span>
                  <span className={`text-xs font-bold ${newSummary ? "text-navy" : "text-slate-400"}`}>신규 포트폴리오 세금 점검</span>
                </div>
                {/* 절세 제안 전략 트리거 버튼 — 2026-09-05 임시 비활성화(사용자 요청). 복구하려면 주석 해제.
                <button type="button" onClick={() => setShowPensionPanel(true)} className="flex items-center gap-1.5 rounded-lg bg-rose-50 border border-rose-200 px-2.5 py-1 text-[11px] font-bold text-rose-700 hover:bg-rose-100 transition shrink-0">
                  <Sparkles size={11} /> 절세 제안 전략
                </button>
                */}
              </div>
              {newSummary ? (
                <FinancialIncomeGauge summary={newSummary} />
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
  leftMetrics, rightMetrics, consultationProposal,
}: {
  sections: ReportSectionToggles; setSections: (s: ReportSectionToggles) => void;
  onClose: () => void; customerName: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  leftData: any; rightData: any; leftAssets: any[]; rightAssets: any[];
  leftAfterTaxReturn: number | null; rightAfterTaxReturn: number | null;
  summary: FinancialIncomeSummary | null; newSummary: FinancialIncomeSummary | null;
  marginalTaxRate?: number; mode: ReportMode; setMode: (m: ReportMode) => void;
  leftMetrics: MetricSnapshot; rightMetrics: MetricSnapshot;
  consultationProposal?: import("./PortfolioReportPdf").ConsultationProposalSections;
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
            consultationProposal={consultationProposal}
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
  consultationProposal?: import("./PortfolioReportPdf").ConsultationProposalSections;
}) {
  const aiComment = (props.left && props.right)
  ? generatePdfComment(props.leftMetrics, props.rightMetrics)
  : "";
const PDFDownloadLink = PDFDownloadLinkLazy;
if (!PDFDownloadLink) {
    return (
      <button type="button" disabled className="flex-1 rounded-xl bg-samsung px-4 py-2.5 text-sm font-bold text-white opacity-60">
        준비 중...
      </button>
    );
  }

  const pdfDocument = useMemo(
    () => (
      <PortfolioReportPdf
        customerName={props.customerName} reportDate={props.reportDate}
        sections={props.sections} left={props.left} right={props.right}
        leftTaxSummary={props.leftTaxSummary} rightTaxSummary={props.rightTaxSummary}
        marginalTaxRate={props.marginalTaxRate} mode={props.mode}
        aiComment={aiComment}
        consultationProposal={props.consultationProposal}
      />
    ),
    [
      props.customerName, props.reportDate, props.sections, props.left, props.right,
      props.leftTaxSummary, props.rightTaxSummary, props.marginalTaxRate, props.mode,
      aiComment, props.consultationProposal,
    ],
  );

  return (
    <PDFDownloadLink
      document={pdfDocument}
      fileName={`${props.customerName}_포트폴리오_제안서_${props.reportDate.replace(/[^0-9]/g, "")}.pdf`}
      className="flex-1 rounded-xl bg-samsung px-4 py-2.5 text-center text-sm font-bold text-white hover:bg-samsung/90"
    >
           {() => "PDF 다운로드"}
    </PDFDownloadLink>
  );
}