"use client";

import { useEffect, useState } from "react";
import { GitCompare } from "lucide-react";
import {
  ComparisonLeftColumn,
  NewPortfolioPlaceholder,
  usePortfolioResult,
} from "../PortfolioResultComponents";
import { FinancialIncomeGauge } from "../tab1/FinancialIncomeGauge";
import type { FinancialIncomeSummary } from "../tab1/FinancialIncomeGauge";

export default function Tab4Page() {
  const data = usePortfolioResult();
  const [summary, setSummary] = useState<FinancialIncomeSummary | null>(null);

  useEffect(() => {
    const load = () => {
      try {
        const stored = localStorage.getItem("financial-income-summary-v1");
        if (stored) setSummary(JSON.parse(stored));
      } catch {}
    };
    load();
    window.addEventListener("financial-income-updated", load);
    return () => window.removeEventListener("financial-income-updated", load);
  }, []);

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
          <ComparisonLeftColumn data={data} afterAssets={<FinancialIncomeGauge summary={summary} />} />
        </div>

        {/* 우측: 신규 포트폴리오 */}
        <div className="space-y-4">
          <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2.5 shadow-soft">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-slate-300 text-xs font-bold text-white">B</span>
            <span className="text-sm font-bold text-slate-400">신규 포트폴리오 (준비 중)</span>
          </div>
          <NewPortfolioPlaceholder />
        </div>

      </div>

    </div>
  );
}
