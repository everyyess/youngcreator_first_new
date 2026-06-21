"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Download, GitCompare, Sparkles, TrendingUp, WalletCards, X } from "lucide-react";
import PensionTaxPanel from "../tab1/PensionTaxPanel";
import {
  DonutChart,
  fmt,
  fmtPct,
  MetricCard,
  NewPortfolioPlaceholder,
  PieChartIcon,
  PortfolioIssueBanner,
  ResultCard,
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

const SCENARIO_KEYS = ["scenario1", "scenario2", "scenario3", "scenario4"] as const;

export default function Tab4Page() {
  const data = usePortfolioResult();
  const { newPortfolioAnalysisResult, selectedCustomer, rebalancingSellAssets, formData } = useCustomerContext();
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
  const [pdfLoading, setPdfLoading] = useState(false);
  const printRef = useRef<HTMLDivElement>(null);

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

  const leftData = data;
  const rightData = newPortfolioAnalysisResult;

  const leftAssets: PortfolioAsset[] = Array.isArray(leftData?.enrichedAssets)
    ? (leftData!.enrichedAssets as PortfolioAsset[])
    : [];
  const rightAssets: PortfolioAsset[] = Array.isArray(rightData?.enrichedAssets)
    ? (rightData.enrichedAssets as PortfolioAsset[])
    : [];

  // B패널 TLH용 데이터 — 신규 포트폴리오 자산 + 현재 세금 요약
  const tlhData = useMemo<TLHData | undefined>(() => {
    if (!rightAssets.length) return undefined;
    return {
      assets: rightAssets.map((a) => ({
        name: a.name ?? "",
        ticker: a.ticker ?? "",
        buy_price: a.buy_price,
        current_price: a.current_price,
        amount: a.amount,
        amount_type: a.amount_type ?? "quantity",
        productType: a.productType,
      })),
      netCapitalGains: newSummary?.netCapitalGains ?? 0,
      capitalGainsTax: newSummary?.foreignCapitalGainsTax ?? 0,
    };
  }, [rightData, newSummary]); // eslint-disable-line react-hooks/exhaustive-deps
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const leftStressResult = (leftData as any)?.stressResult;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rightStressResult = (rightData as any)?.stressResult;

  const leftAfterTaxReturn = useMemo(
    () => summary ? calcAfterTaxReturn(summary, leftAssets, false) : null,
    [summary, leftAssets] // eslint-disable-line react-hooks/exhaustive-deps
  );

  // 잔류 종목의 현재가를 기존 포트폴리오 enriched 데이터에서 보완
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

  const rightAfterTaxReturn = useMemo(
    () => newSummary ? calcAfterTaxReturn(newSummary, [...enrichedRemainingAssets, ...rightAssets]) : null,
    [newSummary, enrichedRemainingAssets, rightAssets] // eslint-disable-line react-hooks/exhaustive-deps
  );

  // ── PDF 다운로드 ───────────────────────────────────────────────────────────
  const handleDownloadPdf = async () => {
    if (!printRef.current) return;
    setPdfLoading(true);
    try {
      const [{ default: html2canvas }, { jsPDF }] = await Promise.all([
        import("html2canvas"),
        import("jspdf"),
      ]);

      const canvas = await html2canvas(printRef.current, {
        scale: 2,
        useCORS: true,
        logging: false,
        backgroundColor: "#ffffff",
        // SVG 요소(도넛 차트) 정상 캡처를 위한 foreignObjectRendering
        allowTaint: false,
      });

      const imgData = canvas.toDataURL("image/jpeg", 0.92);
      const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });

      const pageW = pdf.internal.pageSize.getWidth();   // 210 mm
      const pageH = pdf.internal.pageSize.getHeight();  // 297 mm
      const margin = 8; // mm
      const contentW = pageW - margin * 2;
      const imgH = (canvas.height * contentW) / canvas.width;

      let remaining = imgH;
      let srcY = 0; // mm offset within the full image

      while (remaining > 0) {
        const sliceH = Math.min(remaining, pageH - margin * 2);
        // jsPDF addImage: (data, format, x, y, w, h, alias, compression, rotation)
        // Negative y offset lets us "scroll" through the image per page
        pdf.addImage(imgData, "JPEG", margin, margin - srcY, contentW, imgH);
        // Clip to page: use a white rectangle to mask overflow below the bottom margin
        pdf.setFillColor(255, 255, 255);
        pdf.rect(0, pageH - margin + 0.1, pageW, margin + 0.5, "F");
        // Also mask content above the top margin on subsequent pages
        if (srcY > 0) {
          pdf.rect(0, 0, pageW, margin - 0.1, "F");
        }
        srcY += sliceH;
        remaining -= sliceH;
        if (remaining > 0) pdf.addPage();
      }

      const today = new Date().toLocaleDateString("sv-SE");
      pdf.save(`포트폴리오_비교_분석_${today}.pdf`);
    } catch (err) {
      console.error("PDF 생성 실패", err);
    } finally {
      setPdfLoading(false);
    }
  };

  return (
    <div className="space-y-6">

      {/* ── 절세 제안 전략 모달 ── */}
      {showPensionPanel && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setShowPensionPanel(false)}>
          <div
            className="relative w-full max-w-4xl max-h-[92vh] overflow-y-auto rounded-2xl bg-white shadow-2xl"
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
          onClick={handleDownloadPdf}
          disabled={pdfLoading || (!leftData && !rightData)}
          className="inline-flex items-center gap-2 rounded-lg border border-samsung bg-white px-4 py-2.5 text-sm font-bold text-samsung shadow-soft transition hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Download size={16} />
          {pdfLoading ? "PDF 생성 중…" : "포트폴리오 비교안 PDF 다운로드"}
        </button>
      </div>

      {/* ── PDF 캡처 영역 ── */}
      <div ref={printRef} className="space-y-6 bg-white">

        {/*
          포트폴리오 구성 비교
          — 행(row) 단위 CSS Grid로 좌우 동일 성격 카드를 같은 가로 선상에 정렬
          — 핵심 이슈 배너 높이(위험 항목 개수·유무)가 달라도 각 행의 최대 높이로
            두 셀이 맞춰지므로 아래 카드들이 항상 같은 기준선에서 시작함
        */}
        <div className="grid grid-cols-1 gap-x-6 gap-y-4 lg:grid-cols-2">

          {/* ── 헤더 행 ── */}
          <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2.5 shadow-soft">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-samsung text-xs font-bold text-white">A</span>
            <span className="text-sm font-bold text-navy">기존 포트폴리오</span>
          </div>
          <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2.5 shadow-soft">
            <span className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold text-white ${rightData ? "bg-emerald-500" : "bg-slate-300"}`}>B</span>
            <span className={`text-sm font-bold ${rightData ? "text-navy" : "text-slate-400"}`}>
              {rightData ? "신규 포트폴리오 (리밸런싱 완료)" : "신규 포트폴리오 (준비 중)"}
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
              <DonutChart assets={leftAssets} />
            </ResultCard>
          ) : (
            <div className="flex min-h-[480px] flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-slate-300 bg-slate-50 px-6 text-center">
              <WalletCards size={32} className="text-slate-300" />
              <p className="text-sm font-semibold text-slate-400">2번 탭에서 자산을 입력하고 분석 실행을 눌러주세요.</p>
            </div>
          )}
          {rightData ? (
            <ResultCard icon={<PieChartIcon />} title="자산군별 비중 분포" accent="slate">
              <DonutChart assets={rightAssets} />
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
            ── 스트레스 테스트 – 4대 위기 시나리오 행 ──
            좌우가 selectedScenario 상태를 공유하여 같은 위기를 나란히 비교.
            래퍼 div는 stressResult 유무와 무관하게 항상 존재하여 격자 행 정렬 유지.
          */}
          <div className="flex flex-col">
            {leftStressResult && (
              <ResultCard icon={<AlertTriangle size={18} />} title="스트레스 테스트 – 4대 위기 시나리오" accent="red">
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
              <ResultCard icon={<AlertTriangle size={18} />} title="스트레스 테스트 – 4대 위기 시나리오" accent="red">
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
                <button
                  type="button"
                  onClick={() => setShowPensionPanel(true)}
                  className="flex items-center gap-1.5 rounded-lg bg-rose-50 border border-rose-200 px-2.5 py-1 text-[11px] font-bold text-rose-700 hover:bg-rose-100 transition shrink-0"
                >
                  <Sparkles size={11} /> 절세 제안 전략
                </button>
              </div>
              {newSummary ? (
                <FinancialIncomeGauge summary={newSummary} tlhData={tlhData} />
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
      {/* 시나리오 탭 버튼 */}
      <div className="flex flex-wrap gap-2">
        {SCENARIO_KEYS.map((key, idx) => {
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
              <span className="block">{sc?.label ?? `시나리오 ${idx + 1}`}</span>
              <span className={`block text-xs ${isSelected ? "text-red-600" : "text-slate-400"}`}>
                {sc ? `${(sc.lossRate * 100).toFixed(1)}%` : "—"}
              </span>
            </button>
          );
        })}
      </div>

      {/* 선택된 시나리오 막대 그래프 */}
      {(() => {
        const sc = stressResult[SCENARIO_KEYS[selectedScenario]];
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
