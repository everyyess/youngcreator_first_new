"use client";

import { useEffect, useState } from "react";
import { GitCompare } from "lucide-react";
import {
  ComparisonLeftColumn,
  NewPortfolioPlaceholder,
  usePortfolioResult,
} from "../PortfolioResultComponents";
import { useCustomerContext } from "../CustomerContext";
import RebalancedPortfolioColumn from "../tab5/RebalancedPortfolioColumn";
import {
  FinancialIncomeGauge,
  FINANCIAL_INCOME_STORAGE_KEY,
  NEW_PORTFOLIO_INCOME_STORAGE_KEY,
} from "../tab1/FinancialIncomeGauge";
import type { FinancialIncomeSummary } from "../tab1/FinancialIncomeGauge";

export default function Tab4Page() {
  const data = usePortfolioResult();
  const { newPortfolioAnalysisResult } = useCustomerContext();
  const [summary, setSummary] = useState<FinancialIncomeSummary | null>(null);
  const [newSummary, setNewSummary] = useState<FinancialIncomeSummary | null>(null);

  useEffect(() => {
    const load = () => {
      try {
        const stored = localStorage.getItem(FINANCIAL_INCOME_STORAGE_KEY);
        if (stored) setSummary(JSON.parse(stored));
      } catch {}
    };
    load();
    window.addEventListener("financial-income-updated", load);
    return () => window.removeEventListener("financial-income-updated", load);
  }, []);

  useEffect(() => {
    const load = () => {
      try {
        const stored = localStorage.getItem(NEW_PORTFOLIO_INCOME_STORAGE_KEY);
        if (stored) setNewSummary(JSON.parse(stored));
      } catch {}
    };
    load();
    window.addEventListener("new-financial-income-updated", load);
    return () => window.removeEventListener("new-financial-income-updated", load);
  }, []);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-samsung text-white">
          <GitCompare size={20} />
        </div>
        <div>
          <p className="text-xs font-bold uppercase tracking-wide text-slate-500">포트폴리오 비교 분석</p>
          <h1 className="text-lg font-bold text-navy">기존 포트폴리오 vs 신규 포트폴리오</h1>
        </div>
      </div>

      {/* 포트폴리오 구성 비교 */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">

        <div className="space-y-4">
          <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2.5 shadow-soft">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-samsung text-xs font-bold text-white">A</span>
            <span className="text-sm font-bold text-navy">기존 포트폴리오</span>
          </div>
          <ComparisonLeftColumn data={data} />
        </div>

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

      {/* 세금 점검 비교 — 기존 vs 신규 나란히 */}
      <div className="space-y-3">
        <div className="flex items-center gap-2 px-1">
          <span className="text-xs font-extrabold uppercase tracking-widest text-slate-400">
            금융소득종합과세 및 해외양도세 점검
          </span>
        </div>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">

          <div className="space-y-2">
            <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 shadow-soft">
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-samsung text-[10px] font-bold text-white">A</span>
              <span className="text-xs font-bold text-navy">기존 포트폴리오 세금 점검</span>
            </div>
            <FinancialIncomeGauge summary={summary} />
          </div>

          <div className="space-y-2">
            <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 shadow-soft">
              <span className={`flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold text-white ${newSummary ? "bg-emerald-500" : "bg-slate-300"}`}>B</span>
              <span className={`text-xs font-bold ${newSummary ? "text-navy" : "text-slate-400"}`}>신규 포트폴리오 세금 점검</span>
            </div>
            {newSummary ? (
              <FinancialIncomeGauge summary={newSummary} />
            ) : (
              <div className="flex min-h-[180px] flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-slate-200 bg-slate-50 text-center px-4">
                <p className="text-xs font-semibold text-slate-400">
                  TAB2 또는 TAB3에서 리밸런싱 확정 후<br />신규 세금 점검이 표시됩니다.
                </p>
              </div>
            )}
          </div>

        </div>
      </div>
    </div>
  );
}
