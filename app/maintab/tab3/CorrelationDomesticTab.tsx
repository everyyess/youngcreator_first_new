"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import {
  useCustomerContext,
  type ConfirmedPairItem,
  type CorrelationAnalysisState,
  type CorrelationInnerViewTab,
  type CorrelationPeriodRange,
} from "../CustomerContext";
import { preferenceFromRiskScore, preferenceLabel, type PortfolioPreference } from "../riskPreference";

type Strategy = PortfolioPreference;

const STRATEGIES: { id: Strategy; emoji: string; label: string; desc: string }[] = [
  { id: "conservative", emoji: "🛡️", label: "안전형",   desc: "변동성 최소화" },
  { id: "balanced",     emoji: "⚖️", label: "밸런스형", desc: "리스크/수익 균형" },
  { id: "aggressive",   emoji: "🔥", label: "공격형",   desc: "수익률 극대화" },
];

function scoreToStrategy(score: number): Strategy {
  return preferenceFromRiskScore(score);
}

function buildSrc(strategy: Strategy, k: number, state?: CorrelationAnalysisState): string {
  const params = new URLSearchParams({
    strategy,
    k: String(k),
    _t: String(Date.now()),
  });
  if (state?.periodRange) params.set("period", state.periodRange);
  if (state?.lockedTicker) params.set("lockedTicker", state.lockedTicker);
  if (state?.innerViewTab) params.set("activeTab", state.innerViewTab);
  return `/api/etf-correlation-domestic-html?${params.toString()}`;
}

export default function CorrelationDomesticTab({
  savedState,
  onStateChange,
}: {
  savedState?: CorrelationAnalysisState;
  onStateChange?: (state: CorrelationAnalysisState) => void;
}) {
  const { riskResult, setConfirmedDomesticPair, selectedCustomer } = useCustomerContext();
  const initStrategy = scoreToStrategy(riskResult.score);
  const expectedStrategy = scoreToStrategy(riskResult.score);

  const [isMounted, setIsMounted] = useState(false);
  const [strategy, setStrategy] = useState<Strategy>(savedState?.strategy ?? initStrategy);
  const [k, setK] = useState(savedState?.k ?? 3);
  const [iframeHeight, setIframeHeight] = useState(600);
  // SSR에서 Date.now() 호출 방지: 초기값 빈 문자열, 클라이언트 마운트 후 실 src 주입
  const [activeSrc, setActiveSrc] = useState("");
  const [loading, setLoading] = useState(true);
  const [isConfirmingDomestic, setIsConfirmingDomestic] = useState(false);
  const [domesticConfirmed, setDomesticConfirmed] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const kRef = useRef(k);
  useEffect(() => { kRef.current = k; }, [k]);
  const prevMajorStateKey = useRef<string>("");
  const showMismatchWarning = strategy !== expectedStrategy;

  // 클라이언트 마운트 확인 후 최초 src 생성 (SSR 타임스탬프 불일치 방지)
  useEffect(() => {
    setIsMounted(true);
    setActiveSrc(buildSrc(savedState?.strategy ?? initStrategy, savedState?.k ?? k, savedState));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const handleHeightMessage = (event: MessageEvent) => {
      if (event.source !== iframeRef.current?.contentWindow) return;
      const msg = event.data as { type?: string; height?: number } | null;
      if (msg?.type === "iframe-height" && typeof msg.height === "number") {
        setIframeHeight(msg.height);
      }
    };
    window.addEventListener("message", handleHeightMessage);
    return () => window.removeEventListener("message", handleHeightMessage);
  }, []);

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.source !== iframeRef.current?.contentWindow) return;
      const message = event.data as { type?: string; state?: Partial<CorrelationAnalysisState> } | null;
      if (message?.type !== "domestic-correlation-state" || !message.state) return;
      onStateChange?.({
        ...savedState,
        strategy,
        k,
        periodRange: message.state.periodRange as CorrelationPeriodRange | undefined,
        lockedTicker: message.state.lockedTicker ?? null,
        innerViewTab: message.state.innerViewTab as CorrelationInnerViewTab | undefined,
      });
    };
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [strategy, k, savedState, onStateChange]);

  useEffect(() => {
    if (!isMounted) return;
    const nextStrategy = savedState?.strategy;
    const nextK = savedState?.k;
    const nextPeriod = savedState?.periodRange;
    const nextLockedTicker = savedState?.lockedTicker ?? "";
    const nextInnerViewTab = savedState?.innerViewTab ?? "";
    const majorKey = `${nextStrategy}|${nextK}|${nextPeriod}|${nextLockedTicker}|${nextInnerViewTab}`;
    if (majorKey === prevMajorStateKey.current) return;
    prevMajorStateKey.current = majorKey;
    if (nextStrategy && nextStrategy !== strategy) setStrategy(nextStrategy);
    if (typeof nextK === "number" && nextK !== k) setK(nextK);
    if (nextStrategy || typeof nextK === "number" || nextPeriod || nextLockedTicker || nextInnerViewTab) {
      setLoading(true);
      setActiveSrc(buildSrc(nextStrategy ?? strategy, nextK ?? k, savedState));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedState?.strategy, savedState?.k, savedState?.periodRange, savedState?.lockedTicker, savedState?.innerViewTab, isMounted]);

  // riskResult.score / 고객 변경 시 전략 동기화 — 마운트 완료 후 실행
  useEffect(() => {
    if (!isMounted) return;
    const next = scoreToStrategy(riskResult.score);
    if (next === strategy) return;
    setStrategy(next);
    setLoading(true);
    setActiveSrc(buildSrc(next, kRef.current, savedState));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [riskResult.score, selectedCustomer, isMounted]);

  const handleApply = useCallback(() => {
    setLoading(true);
    const nextState = { ...savedState, strategy, k };
    setActiveSrc(buildSrc(strategy, k, nextState));
    onStateChange?.(nextState);
  }, [strategy, k, savedState, onStateChange]);

  const handleConfirmDomestic = useCallback(async () => {
    setIsConfirmingDomestic(true);
    try {
      const iframeWin = iframeRef.current?.contentWindow ?? null;
      let capturedItems: ConfirmedPairItem[] | null = null;

      if (iframeWin) {
        const payload = await new Promise<{
          optimal: string[];
          weights: Record<string, number>;
          sectorMap: Record<string, string>;
        } | null>((resolve) => {
          const onMsg = (e: MessageEvent) => {
            if (e.source !== iframeWin) return;
            const msg = e.data as { type?: string } | null;
            if (msg?.type === "confirm-response") {
              window.removeEventListener("message", onMsg);
              resolve(e.data as { optimal: string[]; weights: Record<string, number>; sectorMap: Record<string, string> });
            }
          };
          window.addEventListener("message", onMsg);
          iframeWin.postMessage({ type: "request-confirm" }, "*");
          setTimeout(() => { window.removeEventListener("message", onMsg); resolve(null); }, 5000);
        });

        if (payload && payload.optimal.length > 0) {
          capturedItems = payload.optimal.map((ticker) => ({
            ticker,
            sector: payload.sectorMap[ticker] ?? ticker,
            weight: payload.weights[ticker] ?? 1 / payload.optimal.length,
            isGlobal: false,
          }));
        }
      }

      if (capturedItems) {
        setConfirmedDomesticPair(capturedItems);
        setDomesticConfirmed(true);
      } else {
        const params = new URLSearchParams({ strategy, k: String(k), format: "json", period: "1Y" });
        if (savedState?.lockedTicker) params.set("lockedTicker", savedState.lockedTicker);
        const res = await fetch(`/api/etf-correlation-domestic-html?${params.toString()}`);
        const data = await res.json() as {
          period: { optimal: string[]; capped_weights: Record<string, number> } | null;
          sectorMap: Record<string, string>;
        };
        if (data.period) {
          const items: ConfirmedPairItem[] = data.period.optimal.map((ticker) => ({
            ticker,
            sector: data.sectorMap[ticker] ?? ticker,
            weight: data.period!.capped_weights[ticker] ?? 1 / data.period!.optimal.length,
            isGlobal: false,
          }));
          setConfirmedDomesticPair(items);
          setDomesticConfirmed(true);
        }
      }
    } catch {}
    setIsConfirmingDomestic(false);
  }, [strategy, k, savedState?.lockedTicker, setConfirmedDomesticPair]);

  return (
    <div className="rounded-lg bg-white overflow-hidden">
      {/* ── 컨트롤 바 ─────────────────────────────────────────────────── */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-slate-200 bg-slate-50">
        {/* 전략 선택 */}
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-slate-500 whitespace-nowrap">투자 성향</span>
          <div className="flex rounded-md overflow-hidden border border-slate-200">
            {STRATEGIES.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => {
                  setStrategy(s.id);
                  onStateChange?.({ ...savedState, strategy: s.id, k });
                }}
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
                onClick={() => {
                  setK(n);
                  onStateChange?.({ ...savedState, strategy, k: n });
                }}
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

        {showMismatchWarning ? (
          <p className="basis-full text-xs font-bold text-red-600">
            ⚠ 고객 투자 성향 결과는 ‘{preferenceLabel(expectedStrategy)}’입니다. 현재 ‘{preferenceLabel(strategy)}’ 포트폴리오를 조회 중입니다.
          </p>
        ) : null}

        {/* 국내 조합 확정 버튼 */}
        <div className="ml-auto flex items-center gap-2">
          {domesticConfirmed && (
            <span className="text-xs font-bold text-emerald-600">
              ✓ 반영됨
            </span>
          )}
          <button
            type="button"
            onClick={handleConfirmDomestic}
            disabled={isConfirmingDomestic || loading}
            className="flex items-center gap-1.5 rounded-lg bg-[#2f2f9d] px-5 py-2 text-sm font-bold text-white transition hover:bg-[#252285] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isConfirmingDomestic ? (
              <>
                <svg className="h-3.5 w-3.5 animate-spin" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                </svg>
                확정 중…
              </>
            ) : (
              <>
                <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
                국내 조합 확정 → TAB3-3 반영
              </>
            )}
          </button>
        </div>
      </div>

      {/* ── iframe 영역 ───────────────────────────────────────────────── */}
      <div className="relative" style={{ height: loading ? "400px" : `${iframeHeight}px` }}>
        {/* 로딩 오버레이 */}
        {loading && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-white z-10 gap-3">
            <div className="w-10 h-10 rounded-full border-[3px] border-blue-200 border-t-blue-600 animate-spin" />
            <p className="text-sm font-semibold text-slate-600">ETF 상관관계 분석 중…</p>
            <p className="text-xs text-slate-400">30종목 × 6개 기간 Pearson 상관행렬 연산</p>
          </div>
        )}
        {/* 마운트 후 조건부 렌더링: SSR 단계에서 src 속성 불일치 원천 차단 */}
        {isMounted && (
          <iframe
            ref={iframeRef}
            key={activeSrc}
            src={activeSrc}
            className="w-full border-0"
            style={{ height: `${iframeHeight}px` }}
            scrolling="no"
            onLoad={() => setLoading(false)}
            title="ETF 분산투자 최적화 (국내)"
            sandbox="allow-scripts"
          />
        )}
      </div>

    </div>
  );
}
