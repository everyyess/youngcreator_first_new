"use client";

import { TrendingUp } from "lucide-react";
import type { PortfolioAnalysisResult, PortfolioAsset } from "../CustomerContext";
import {
  DonutChart,
  fmt,
  fmtPct,
  MetricCard,
  PieChartIcon,
  PortfolioIssueBanner,
  ResultCard,
} from "../PortfolioResultComponents";

export default function RebalancedPortfolioColumn({ data }: { data: PortfolioAnalysisResult }) {
  const enrichedAssets: PortfolioAsset[] = Array.isArray(data.enrichedAssets)
    ? (data.enrichedAssets as PortfolioAsset[])
    : [];
  const { portfolioIssueSummary, quantResult, healthResult } = data;
  const stressResult = (data as typeof data & { stressResult?: unknown }).stressResult;

  return (
    <div className="space-y-5">
      {/* 포트폴리오 핵심 이슈 */}
      {portfolioIssueSummary && healthResult && (
        <PortfolioIssueBanner healthResult={healthResult} stressResult={stressResult} />
      )}

      {/* 자산군별 비중 분포 도넛 차트 */}
      <ResultCard icon={<PieChartIcon />} title="자산군별 비중 분포" accent="slate">
        <DonutChart assets={enrichedAssets} />
      </ResultCard>

      {/* 핵심 지표 요약 */}
      {quantResult && (
        <ResultCard icon={<TrendingUp size={18} />} title="핵심 지표 요약" accent="green">
          <div className="grid grid-cols-2 gap-3">
            <MetricCard label="세후 기대수익률" value={fmtPct(quantResult.performance.afterTaxExpectedReturn)} sub="세후 연환산 기대수익" />
            <MetricCard label="샤프 비율" value={fmt(quantResult.performance.sharpeRatio)} sub="위험 대비 초과수익" />
            <MetricCard label="소르티노 비율" value={fmt(quantResult.performance.sortinoRatio)} sub="하방 리스크 방어력" />
            <MetricCard label="최대 낙폭(MDD)" value={fmtPct(Math.abs(quantResult.risk.mdd))} sub="최고점 대비 최악 하락" />
            <MetricCard label="연환산 변동성" value={fmtPct(quantResult.risk.volatility)} sub="연간 가격 흔들림 폭" />
            <MetricCard label="시장 베타" value={fmt(quantResult.sensitivity.beta)} sub="시장 민감도" />
          </div>
        </ResultCard>
      )}
    </div>
  );
}
