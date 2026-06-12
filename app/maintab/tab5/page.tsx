"use client";

import { GitCompare } from "lucide-react";
import {
  ComparisonLeftColumn,
  NewPortfolioPlaceholder,
  usePortfolioResult,
} from "../PortfolioResultComponents";
import { useCustomerContext } from "../CustomerContext";
import RebalancedPortfolioColumn from "./RebalancedPortfolioColumn";

export default function Tab5Page() {
  const data = usePortfolioResult();
  const { newPortfolioAnalysisResult } = useCustomerContext();

  return (
    <div className="space-y-6">
      {/* 페이지 헤더 */}
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-samsung text-white">
          <GitCompare size={20} />
        </div>
        <div>
          <p className="text-xs font-bold uppercase tracking-wide text-slate-500">포트폴리오 비교 분석</p>
          <h1 className="text-lg font-bold text-navy">기존 포트폴리오 vs 신규 포트폴리오</h1>
        </div>
      </div>

      {/* 2분할 Grid */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">

        {/* 좌측: 기존 포트폴리오 요약 */}
        <div className="space-y-4">
          <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2.5 shadow-soft">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-samsung text-xs font-bold text-white">A</span>
            <span className="text-sm font-bold text-navy">기존 포트폴리오</span>
          </div>
          <ComparisonLeftColumn data={data} />
        </div>

        {/* 우측: 신규 포트폴리오 */}
        <div className="space-y-4">
          <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2.5 shadow-soft">
            <span className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold text-white ${newPortfolioAnalysisResult ? "bg-emerald-500" : "bg-slate-300"}`}>B</span>
            <span className={`text-sm font-bold ${newPortfolioAnalysisResult ? "text-navy" : "text-slate-400"}`}>
              {newPortfolioAnalysisResult ? "신규 포트폴리오 (리밸런싱 완료)" : "신규 포트폴리오 (준비 중)"}
            </span>
          </div>
          {newPortfolioAnalysisResult
            ? <RebalancedPortfolioColumn data={newPortfolioAnalysisResult} />
            : <NewPortfolioPlaceholder />
          }
        </div>

      </div>
    </div>
  );
}
