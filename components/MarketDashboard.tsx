"use client";

import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import type { MarketIndexItem } from "@/lib/marketData";

type LoadState<T> = {
  data: T;
  loading: boolean;
  error: string;
};

const emptyIndices: LoadState<MarketIndexItem[]> = { data: [], loading: true, error: "" };
const MARKET_INDEX_CACHE_KEY = "market-dashboard:indices:v2";
const MARKET_INDEX_CACHE_TTL_MS = 5 * 60 * 1000;

type MarketIndexCache = {
  data: MarketIndexItem[];
  refreshedAt: string;
  cachedAt: number;
};

function formatNumber(value: number | null, digits = 2) {
  if (value == null) return "-";
  return value.toLocaleString("ko-KR", { maximumFractionDigits: digits, minimumFractionDigits: digits });
}

function directionClass(value: number | null) {
  if (value == null) return "text-slate-400";
  if (value > 0) return "text-red-600";
  if (value < 0) return "text-blue-600";
  return "text-slate-500";
}

function sparklineBaseY(values: number[]): number {
  if (values.length < 2) return 15;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  return 24 - ((values[0] - min) / range) * 18;
}

function sparklinePoints(values: number[]) {
  if (values.length < 2) return "0,16 120,16";
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  return values.map((value, index) => {
    const x = (index / Math.max(values.length - 1, 1)) * 120;
    const y = 24 - ((value - min) / range) * 18;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
}

function formatRefreshTime(value: Date | null) {
  if (!value) return "--:--";
  return new Intl.DateTimeFormat("ko-KR", { hour: "2-digit", minute: "2-digit", hour12: false }).format(value);
}

function msUntilNextFiveMinuteBoundary(now = new Date()) {
  const intervalMs = 5 * 60 * 1000;
  const current = now.getTime();
  return Math.ceil(current / intervalMs) * intervalMs - current;
}

function readMarketIndexCache(): MarketIndexCache | null {
  try {
    const raw = window.localStorage.getItem(MARKET_INDEX_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<MarketIndexCache>;
    if (!Array.isArray(parsed.data) || !parsed.refreshedAt || typeof parsed.cachedAt !== "number") return null;
    if (Date.now() - parsed.cachedAt > MARKET_INDEX_CACHE_TTL_MS) return null;
    return { data: parsed.data, refreshedAt: parsed.refreshedAt, cachedAt: parsed.cachedAt };
  } catch {
    return null;
  }
}

function writeMarketIndexCache(data: MarketIndexItem[], refreshedAt: Date) {
  try {
    window.localStorage.setItem(MARKET_INDEX_CACHE_KEY, JSON.stringify({
      data,
      refreshedAt: refreshedAt.toISOString(),
      cachedAt: Date.now(),
    }));
  } catch {
    // localStorage may be unavailable in private browsing or quota-limited contexts.
  }
}

function IndexStrip({ state, refreshedAt }: { state: LoadState<MarketIndexItem[]>; refreshedAt: Date | null }) {
  const [startIndex, setStartIndex] = useState(0);
  const items = state.data.length
    ? state.data
    : Array.from({ length: 10 }, (_, i) => ({ symbol: `${i}`, name: "조회 중", value: null, change: null, changePercent: null, sparkline: [], basis: "조회 중", asOf: null }));
  const visibleCount = 7;
  const maxStartIndex = Math.max(0, items.length - visibleCount);
  const safeStartIndex = Math.min(startIndex, maxStartIndex);
  const visibleItems = items.slice(safeStartIndex, safeStartIndex + visibleCount);

  useEffect(() => {
    if (startIndex > maxStartIndex) setStartIndex(maxStartIndex);
  }, [maxStartIndex, startIndex]);

  return (
    <section className="w-full min-w-0 max-w-full overflow-hidden rounded-xl border border-blue-100 bg-white px-3 pt-3 pb-2.5 shadow-sm">
      <div className="mb-3 flex items-center justify-between gap-3">
        <p className="text-[15px] font-black uppercase tracking-normal text-blue-700">Market Index</p>
        <p className="text-[10px] font-black text-slate-400">최근 갱신: {formatRefreshTime(refreshedAt)}</p>
      </div>
      {state.error ? (
        <div className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-3 text-sm font-bold text-slate-500">주요 지표를 불러오지 못했습니다.</div>
      ) : (
        <div className="mb-3 flex w-full min-w-0 max-w-full items-stretch overflow-hidden rounded-lg border border-slate-100">
          <button
            type="button"
            onClick={() => setStartIndex((value) => Math.max(0, value - 1))}
            disabled={safeStartIndex <= 0}
            className="w-9 shrink-0 border-r border-slate-100 bg-white text-sm font-black text-blue-700 transition hover:bg-blue-50 disabled:cursor-not-allowed disabled:text-slate-300 disabled:hover:bg-white"
            aria-label="이전 지표 보기"
          >
            &lt;
          </button>
          <div className="flex min-w-0 flex-1 flex-nowrap">
            {visibleItems.map((item) => (
              <div key={item.symbol} className="box-border flex min-w-0 flex-1 flex-col overflow-hidden border-r border-slate-100 px-1.5 pt-2.5 pb-2.5 last:border-r-0">
                <div className="flex min-w-0 shrink-0 items-center justify-between gap-1.5">
                  <p className="min-w-0 overflow-hidden whitespace-nowrap text-[11px] font-black leading-tight text-slate-700">{item.name}</p>
                  <p className={`shrink-0 text-[11px] font-black ${directionClass(item.changePercent)}`}>
                    {item.changePercent != null && item.changePercent > 0 ? "+" : ""}{formatNumber(item.changePercent, 2)}%
                  </p>
                  {state.loading ? <RefreshCw size={15} className="shrink-0 animate-spin text-blue-500" /> : null}
                </div>
                <p className="mt-1.5 shrink-0 whitespace-nowrap text-sm font-black tracking-normal text-navy">{formatNumber(item.value, item.symbol === "^TNX" ? 3 : 2)}</p>
                <div className={`mt-2 min-h-[26px] flex-1 rounded-md ${item.changePercent == null ? "bg-slate-100" : item.changePercent >= 0 ? "bg-red-50" : "bg-blue-50"}`}>
                  <svg viewBox="0 0 120 28" className={`h-full w-full ${directionClass(item.changePercent)}`} preserveAspectRatio="none" aria-hidden="true">
                    <line x1="0" y1={sparklineBaseY(item.sparkline)} x2="120" y2={sparklineBaseY(item.sparkline)} stroke="#cbd5e1" strokeWidth="0.8" strokeDasharray="3,2" />
                    <polyline points={sparklinePoints(item.sparkline)} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </div>
              </div>
            ))}
          </div>
          <button
            type="button"
            onClick={() => setStartIndex((value) => Math.min(maxStartIndex, value + 1))}
            disabled={safeStartIndex >= maxStartIndex}
            className="w-9 shrink-0 bg-white text-sm font-black text-blue-700 transition hover:bg-blue-50 disabled:cursor-not-allowed disabled:text-slate-300 disabled:hover:bg-white"
            aria-label="다음 지표 보기"
          >
            &gt;
          </button>
        </div>
      )}
    </section>
  );
}

function PlaceholderPanel({ title, heightClass }: { title: string; heightClass: string }) {
  return (
    <section className={`flex w-full min-w-0 max-w-full flex-col overflow-hidden rounded-xl border border-blue-100 bg-white p-3 shadow-sm ${heightClass}`}>
      <div className="mb-3 flex shrink-0 items-center justify-between gap-2">
        <p className="text-sm font-black text-navy">{title}</p>
      </div>
      <div className="flex min-h-0 flex-1 items-center justify-center rounded-lg border border-dashed border-slate-200 bg-slate-50 px-3 py-8 text-center text-sm font-bold text-slate-400">
        추후 기능이 추가될 예정입니다.
      </div>
    </section>
  );
}

export default function MarketDashboard() {
  const [indices, setIndices] = useState(emptyIndices);
  const [indicesRefreshedAt, setIndicesRefreshedAt] = useState<Date | null>(null);

  useEffect(() => {
    let cancelled = false;
    let intervalId: number | null = null;
    const cached = readMarketIndexCache();
    if (cached) {
      setIndices({ data: cached.data, loading: false, error: "" });
      setIndicesRefreshedAt(new Date(cached.refreshedAt));
    }

    async function load() {
      try {
        const response = await fetch("/api/market/indices");
        const body = await response.json();
        if (!cancelled) {
          if (response.ok && Array.isArray(body.data) && body.data.length) {
            const refreshedAt = new Date();
            setIndices({ data: body.data, loading: false, error: "" });
            setIndicesRefreshedAt(refreshedAt);
            writeMarketIndexCache(body.data, refreshedAt);
          } else {
            setIndices((prev) => prev.data.length ? { ...prev, loading: false, error: "" } : { data: [], loading: false, error: body.error ?? "error" });
          }
        }
      } catch {
        if (!cancelled) {
          setIndices((prev) => prev.data.length ? { ...prev, loading: false, error: "" } : { data: [], loading: false, error: "error" });
        }
      }
    }

    void load();
    const timeoutId = window.setTimeout(() => {
      void load();
      intervalId = window.setInterval(load, 5 * 60 * 1000);
    }, msUntilNextFiveMinuteBoundary());
    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
      if (intervalId) window.clearInterval(intervalId);
    };
  }, []);

  return (
    <div className="flex w-full min-w-0 max-w-full flex-1 flex-col gap-4">
      <IndexStrip state={indices} refreshedAt={indicesRefreshedAt} />
      <PlaceholderPanel title="시황 보고서 메일링" heightClass="min-h-[340px]" />
      <PlaceholderPanel title="섹터 스캐너" heightClass="min-h-[360px]" />
    </div>
  );
}
