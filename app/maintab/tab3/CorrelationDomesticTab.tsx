"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { useCustomerContext } from "../CustomerContext";

type Strategy = "conservative" | "balanced" | "aggressive";

const STRATEGIES: { id: Strategy; emoji: string; label: string; desc: string }[] = [
  { id: "conservative", emoji: "🛡️", label: "안전형",   desc: "변동성 최소화" },
  { id: "balanced",     emoji: "⚖️", label: "밸런스형", desc: "리스크/수익 균형" },
  { id: "aggressive",   emoji: "🔥", label: "공격형",   desc: "수익률 극대화" },
];

function scoreToStrategy(score: number): Strategy {
  if (score >= 70) return "aggressive";
  if (score >= 40) return "balanced";
  return "conservative";
}

function buildSrc(strategy: Strategy, k: number): string {
  return `/api/etf-correlation-domestic-html?strategy=${strategy}&k=${k}&_t=${Date.now()}`;
}

export default function CorrelationDomesticTab() {
  const { riskResult } = useCustomerContext();
  const initStrategy = scoreToStrategy(riskResult.score);

  const [strategy, setStrategy] = useState<Strategy>(initStrategy);
  const [k, setK] = useState(3);
  const [activeSrc, setActiveSrc] = useState(() => buildSrc(initStrategy, 3));
  const [loading, setLoading] = useState(true);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const kRef = useRef(k);
  useEffect(() => { kRef.current = k; }, [k]);

  useEffect(() => {
    const next = scoreToStrategy(riskResult.score);
    setStrategy(next);
    setLoading(true);
    setActiveSrc(buildSrc(next, kRef.current));
  }, [riskResult.score]);

  const handleApply = useCallback(() => {
    setLoading(true);
    setActiveSrc(buildSrc(strategy, k));
  }, [strategy, k]);

  return (
    <div className="rounded-lg border border-slate-200 bg-white shadow-soft overflow-hidden">
      {/* ── 컨트롤 바 ─────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-3 px-4 py-3 border-b border-slate-200 bg-slate-50">
        {/* 전략 선택 */}
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-slate-500 whitespace-nowrap">투자 성향</span>
          <div className="flex rounded-md overflow-hidden border border-slate-200">
            {STRATEGIES.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => setStrategy(s.id)}
                title={s.desc}
                className={`px-3 py-1.5 text-xs font-bold transition ${
                  strategy === s.id
                    ? "bg-[#2f2f9d] text-white"
                    : "bg-white text-slate-600 hover:bg-slate-100"
                }`}
              >
                {s.emoji} {s.label}
              </button>
            ))}
          </div>
        </div>

        {/* K 값 선택 */}
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-slate-500 whitespace-nowrap">추천 ETF 수 (K)</span>
          <div className="flex rounded-md overflow-hidden border border-slate-200">
            {[3, 4, 5].map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => setK(n)}
                className={`w-8 py-1.5 text-xs font-bold transition ${
                  k === n
                    ? "bg-[#2f2f9d] text-white"
                    : "bg-white text-slate-600 hover:bg-slate-100"
                }`}
              >
                {n}
              </button>
            ))}
          </div>
        </div>

        <button
          type="button"
          onClick={handleApply}
          className="ml-auto flex items-center gap-1.5 px-4 py-1.5 text-xs font-bold bg-blue-600 text-white rounded-md hover:bg-blue-700 active:scale-95 transition"
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
          분석 실행
        </button>

        <span className="text-xs text-slate-400">
          국내 KODEX ETF 30종목 · 30×30 상관행렬 · 섹터 다양성 제약
        </span>
      </div>

      {/* ── iframe 영역 ───────────────────────────────────────────────── */}
      <div className="relative" style={{ height: "1150px" }}>
        {/* 로딩 오버레이 */}
        {loading && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-white z-10 gap-3">
            <div className="w-10 h-10 rounded-full border-[3px] border-blue-200 border-t-blue-600 animate-spin" />
            <p className="text-sm font-semibold text-slate-600">ETF 상관관계 분석 중…</p>
            <p className="text-xs text-slate-400">30종목 × 6개 기간 Pearson 상관행렬 연산</p>
          </div>
        )}
        <iframe
          ref={iframeRef}
          key={activeSrc}
          src={activeSrc}
          className="w-full border-0"
          style={{ height: "1150px" }}
          onLoad={() => setLoading(false)}
          title="ETF 분산투자 최적화 (국내)"
          sandbox="allow-scripts"
        />
      </div>
    </div>
  );
}
