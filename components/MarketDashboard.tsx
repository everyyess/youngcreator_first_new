"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { CalendarDays, ExternalLink, Newspaper, RefreshCw } from "lucide-react";
import type { MarketIndexItem } from "@/lib/marketData";
import type { HeatmapItem } from "@/lib/marketHeatmap";
import type { MarketCalendarEvent } from "@/lib/calendarData";
import type { NewsArticle, NewsCategory } from "@/lib/newsData";

type LoadState<T> = {
  data: T;
  loading: boolean;
  error: string;
};

type TreemapRect<T> = T & {
  x: number;
  y: number;
  width: number;
  height: number;
};

const emptyIndices: LoadState<MarketIndexItem[]> = { data: [], loading: true, error: "" };
const emptyCalendar: LoadState<MarketCalendarEvent[]> = { data: [], loading: true, error: "" };
const emptyNews: LoadState<NewsArticle[]> = { data: [], loading: true, error: "" };
const emptyHeatmap: LoadState<HeatmapItem[]> = { data: [], loading: true, error: "" };
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

function heatmapColor(value: number) {
  if (value >= 2) return "#166534";
  if (value >= 1) return "#15803d";
  if (value >= 0.5) return "#16a34a";
  if (value > 0.2) return "#86efac";
  if (value <= -2) return "#991b1b";
  if (value <= -1) return "#b91c1c";
  if (value <= -0.5) return "#dc2626";
  if (value < -0.2) return "#fca5a5";
  return "#94a3b8";
}

function heatmapTilePadding(width: number, height: number) {
  return width >= 120 && height >= 70 ? 8 : 4;
}

function heatmapSymbolFontSize(width: number, height: number, symbol: string) {
  const padding = heatmapTilePadding(width, height);
  const usableWidth = Math.max(4, width - padding * 2);
  const usableHeight = Math.max(4, height - padding * 2);
  const byWidth = usableWidth / Math.max(symbol.length * 0.82, 1);
  const byHeight = usableHeight / 1.35;
  return Math.max(5, Math.min(24, Math.floor(Math.min(byWidth, byHeight))));
}

function fitsHeatmapText(width: number, text: string, fontSize: number, padding: number) {
  return text.length * fontSize * 0.72 <= Math.max(0, width - padding * 2);
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

const MARKET_FLAG_CODES: Record<string, string> = {
  "미국": "us", "영국": "gb", "한국": "kr", "일본": "jp", "중국": "cn",
  "캐나다": "ca", "호주": "au", "뉴질랜드": "nz", "스위스": "ch",
  "유로존": "eu", "유럽": "eu",
  "독일": "de", "프랑스": "fr", "이탈리아": "it", "스페인": "es",
  "네덜란드": "nl", "벨기에": "be", "스웨덴": "se", "노르웨이": "no",
  "덴마크": "dk", "싱가포르": "sg", "인도": "in", "브라질": "br", "멕시코": "mx",
};

function importanceStars(value: MarketCalendarEvent["importance"]) {
  if (value === "high") return "★★★";
  if (value === "medium") return "★★☆";
  return "★☆☆";
}

function calendarDisplayText(event: MarketCalendarEvent) {
  if (event.market === "유로존") {
    const euroCountries = ["독일", "프랑스", "벨기에", "이탈리아", "스페인", "네덜란드"];
    const country = euroCountries.find((item) => event.title.startsWith(item));
    if (country) {
      return {
        market: country,
        title: event.title.slice(country.length).trim(),
      };
    }
    if (event.title.startsWith("유럽중앙은행")) return { market: "유럽", title: event.title };
  }

  return {
    market: event.market,
    title: event.title.startsWith(event.market) ? event.title.slice(event.market.length).trim() : event.title,
  };
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

function splitTreemap<T extends { weight: number }>(items: T[], x = 0, y = 0, width = 100, height = 100): TreemapRect<T>[] {
  const ordered = [...items].filter((item) => item.weight > 0).sort((a, b) => b.weight - a.weight);
  const total = ordered.reduce((sum, item) => sum + item.weight, 0);
  if (!ordered.length || total <= 0 || width <= 0 || height <= 0) return [];
  if (ordered.length === 1) return [{ ...ordered[0], x, y, width, height }];

  const half = total / 2;
  let running = 0;
  let splitIndex = 0;
  for (let index = 0; index < ordered.length - 1; index += 1) {
    const next = running + ordered[index].weight;
    if (Math.abs(half - next) > Math.abs(half - running) && index > 0) break;
    running = next;
    splitIndex = index + 1;
    if (running >= half) break;
  }

  const first = ordered.slice(0, Math.max(1, splitIndex));
  const second = ordered.slice(Math.max(1, splitIndex));
  const ratio = first.reduce((sum, item) => sum + item.weight, 0) / total;

  if (width >= height) {
    const firstWidth = width * ratio;
    return [
      ...splitTreemap(first, x, y, firstWidth, height),
      ...splitTreemap(second, x + firstWidth, y, width - firstWidth, height),
    ];
  }

  const firstHeight = height * ratio;
  return [
    ...splitTreemap(first, x, y, width, firstHeight),
    ...splitTreemap(second, x, y + firstHeight, width, height - firstHeight),
  ];
}

function toTreemapStyle(rect: { x: number; y: number; width: number; height: number }) {
  const left = Math.max(0, Math.min(100, rect.x));
  const top = Math.max(0, Math.min(100, rect.y));
  const width = Math.max(0, Math.min(100 - left, rect.width));
  const height = Math.max(0, Math.min(100 - top, rect.height));
  return { left: `${left}%`, top: `${top}%`, width: `${width}%`, height: `${height}%` };
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
      <div className="mb-3 flex items-center gap-3">
        <p className="text-[15px] font-black uppercase tracking-normal text-blue-700">Market Index</p>
      </div>
      {state.error ? (
        <div className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-3 text-sm font-bold text-slate-500">주요 지표를 불러오지 못했습니다.</div>
      ) : (
        <div className="flex w-full min-w-0 max-w-full items-stretch overflow-hidden rounded-lg border border-slate-100">
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
      <p className="mt-1.5 text-right text-[10px] font-black text-slate-400">최근 갱신: {formatRefreshTime(refreshedAt)}</p>
    </section>
  );
}

function TreemapHeatmapPanel({ state }: { state: LoadState<HeatmapItem[]> }) {
  const sectors = useMemo(() => {
    const grouped = state.data.reduce<Record<string, HeatmapItem[]>>((acc, item) => {
      acc[item.sector] = [...(acc[item.sector] ?? []), item];
      return acc;
    }, {});
    return Object.entries(grouped).map(([sector, items]) => ({
      sector,
      weight: items.reduce((sum, item) => sum + item.weight, 0),
      items,
    }));
  }, [state.data]);
  const sectorRects = useMemo(() => splitTreemap(sectors), [sectors]);

  const containerRef = useRef<HTMLDivElement>(null);
  const [canvasSize, setCanvasSize] = useState({ w: 600, h: 380 });

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver(() => {
      const { width, height } = el.getBoundingClientRect();
      if (width > 0 && height > 0) setCanvasSize({ w: Math.floor(width), h: Math.floor(height) });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <section className="flex w-full min-w-0 max-w-full flex-col overflow-hidden rounded-xl border border-blue-100 bg-white p-3 shadow-sm" style={{ height: 520 }}>
      <div className="mb-3 flex shrink-0 items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-black text-navy">미국 대형주 히트맵</p>
          <p className="truncate text-[11px] font-bold text-slate-400">S&P 500 · 1 Day Performance · Market Cap</p>
        </div>
        <span className="shrink-0 rounded-full bg-blue-50 px-2 py-1 text-[11px] font-black text-blue-700">Treemap</span>
      </div>
      <div ref={containerRef} className="relative min-h-0 flex-1 overflow-hidden rounded-xl border border-slate-800 bg-slate-950 shadow-inner">
        {state.loading ? (
          <div className="flex h-full items-center justify-center text-sm font-black text-slate-300">히트맵 데이터를 불러오는 중입니다.</div>
        ) : state.error || !sectorRects.length ? (
          <div className="flex h-full items-center justify-center text-sm font-black text-slate-300">히트맵 데이터를 불러오지 못했습니다.</div>
        ) : sectorRects.map((sector) => {
          const itemRects = splitTreemap(sector.items, 0, 0, 100, 100);
          return (
            <div key={sector.sector} className="absolute overflow-hidden border border-slate-950 bg-slate-900" style={toTreemapStyle(sector)}>
              <div className="absolute min-h-0 overflow-hidden" style={{ left: 0, right: 0, top: 0, bottom: 0 }}>
                {itemRects.map((item) => {
                  const tileWidth = (sector.width / 100) * (item.width / 100) * canvasSize.w;
                  const tileHeight = (sector.height / 100) * (item.height / 100) * canvasSize.h;
                  const percentText = `${item.changePercent > 0 ? "+" : ""}${item.changePercent.toFixed(2)}%`;
                  const padding = heatmapTilePadding(tileWidth, tileHeight);
                  const symbolFontSize = heatmapSymbolFontSize(tileWidth, tileHeight, item.symbol);
                  const percentFontSize = Math.max(7, Math.min(18, Math.floor(symbolFontSize * 0.62)));
                  const showSymbol = symbolFontSize >= 6 && tileHeight >= padding * 2 + symbolFontSize && fitsHeatmapText(tileWidth, item.symbol, symbolFontSize, padding);
                  const showFull = showSymbol && tileHeight >= padding * 2 + symbolFontSize + percentFontSize + 4 && fitsHeatmapText(tileWidth, percentText, percentFontSize, padding);
                  return (
                    <div
                      key={item.symbol}
                      className="absolute flex flex-col items-center justify-center overflow-hidden border border-slate-950/45 text-center text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.18)]"
                      style={{ ...toTreemapStyle(item), backgroundColor: heatmapColor(item.changePercent), boxSizing: "border-box", padding }}
                      title={`${item.name} ${item.changePercent > 0 ? "+" : ""}${item.changePercent.toFixed(2)}%`}
                    >
                      {showSymbol ? <span className="whitespace-nowrap font-black leading-none drop-shadow-sm" style={{ fontSize: symbolFontSize }}>{item.symbol}</span> : null}
                      {showFull ? <span className="mt-1 whitespace-nowrap font-black leading-none drop-shadow-sm" style={{ fontSize: percentFontSize }}>{percentText}</span> : null}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function CalendarPanel({ state }: { state: LoadState<MarketCalendarEvent[]> }) {
  return (
    <section className="flex w-full min-w-0 max-w-full flex-col overflow-hidden rounded-xl border border-blue-100 bg-white p-3 shadow-sm" style={{ height: 520 }}>
      <div className="mb-3 flex shrink-0 items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <CalendarDays size={17} className="text-blue-600" />
          <p className="text-sm font-black text-navy">주요 일정</p>
        </div>
        <span className="shrink-0 text-[10px] font-black text-slate-400">한국 시간 (KST)</span>
      </div>
      {state.loading ? (
        <div className="flex min-h-0 flex-1 items-center justify-center rounded-lg bg-slate-50 px-3 py-8 text-center text-sm font-bold text-slate-400">일정 데이터를 불러오는 중입니다.</div>
      ) : state.error ? (
        <div className="flex min-h-0 flex-1 items-center justify-center rounded-lg bg-slate-50 px-3 py-8 text-center text-sm font-bold text-slate-400">일정 데이터를 불러오지 못했습니다.</div>
      ) : state.data.length ? (
        <div className="grid min-h-0 flex-1 auto-rows-max gap-2 overflow-y-auto pr-1">
          {state.data.map((event) => {
            const display = calendarDisplayText(event);
            return (
              <div key={event.id} className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2">
                <div className="mb-1 flex items-center gap-1.5">
                  <span className="text-[11px] font-black text-slate-500">{event.date}</span>
                  <span className="text-[11px] font-bold text-slate-400">{event.time}</span>
                  <span className="ml-auto rounded-full border border-blue-100 bg-white px-2 py-0.5 text-[10px] font-black text-blue-700">{importanceStars(event.importance)}</span>
                </div>
                <div className="flex items-center gap-1.5 overflow-hidden">
                  {MARKET_FLAG_CODES[display.market] ? (
                    <img
                      src={`https://flagcdn.com/w20/${MARKET_FLAG_CODES[display.market]}.png`}
                      alt={display.market}
                      title={display.market}
                      className="shrink-0 h-[14px] w-auto rounded-[2px] shadow-sm"
                    />
                  ) : (
                    <span className="shrink-0 rounded-full bg-white px-2 py-0.5 text-[10px] font-black text-blue-700">{display.market}</span>
                  )}
                  <span className="line-clamp-2 text-sm font-black text-slate-800">{display.title}</span>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 items-center justify-center rounded-lg bg-slate-50 px-3 py-8 text-center text-sm font-bold text-slate-400">불러올 일정이 없습니다.</div>
      )}
    </section>
  );
}

function NewsPanel({ state, category, setCategory }: { state: LoadState<NewsArticle[]>; category: NewsCategory; setCategory: (category: NewsCategory) => void }) {
  return (
    <section className="w-full min-w-0 max-w-full overflow-hidden rounded-xl border border-blue-100 bg-white p-3 shadow-sm">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Newspaper size={17} className="text-blue-600" />
          <p className="text-sm font-black text-navy">한국경제신문 주요 기사</p>
        </div>
        <div className="grid grid-cols-2 rounded-lg border border-slate-200 bg-slate-50 p-1">
          {(["economy", "industry"] as NewsCategory[]).map((item) => (
            <button key={item} type="button" onClick={() => setCategory(item)} className={`rounded-md px-4 py-1.5 text-xs font-black transition ${category === item ? "bg-blue-600 text-white shadow-sm" : "text-slate-500 hover:bg-white"}`}>
              {item === "economy" ? "경제" : "산업"}
            </button>
          ))}
        </div>
      </div>
      {state.loading ? (
        <div className="rounded-lg bg-slate-50 px-3 py-8 text-center text-sm font-bold text-slate-400">기사를 불러오는 중입니다.</div>
      ) : state.error ? (
        <div className="rounded-lg bg-slate-50 px-3 py-8 text-center text-sm font-bold text-slate-400">기사 데이터를 불러오지 못했습니다.</div>
      ) : state.data.length ? (
        <div className="grid gap-2 md:grid-cols-2">
          {state.data.slice(0, 6).map((article) => (
            <a key={article.link} href={article.link} target="_blank" rel="noreferrer" className="group rounded-lg border border-slate-100 bg-slate-50 px-3 py-3 transition hover:border-blue-200 hover:bg-blue-50">
              <div className="flex items-start gap-2">
                <p className="line-clamp-2 flex-1 text-sm font-black leading-5 text-slate-800 group-hover:text-blue-800">{article.title}</p>
                <ExternalLink size={14} className="mt-0.5 shrink-0 text-slate-400 group-hover:text-blue-600" />
              </div>
              <p className="mt-2 text-[11px] font-black text-slate-400">{article.time}</p>
            </a>
          ))}
        </div>
      ) : (
        <div className="rounded-lg bg-slate-50 px-3 py-8 text-center text-sm font-bold text-slate-400">표시할 기사가 없습니다.</div>
      )}
    </section>
  );
}

export default function MarketDashboard() {
  const [indices, setIndices] = useState(emptyIndices);
  const [indicesRefreshedAt, setIndicesRefreshedAt] = useState<Date | null>(null);
  const [calendar, setCalendar] = useState(emptyCalendar);
  const [heatmap, setHeatmap] = useState(emptyHeatmap);
  const [newsCategory, setNewsCategory] = useState<NewsCategory>("economy");
  const [news, setNews] = useState(emptyNews);

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

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const response = await fetch("/api/market/calendar");
        const body = await response.json();
        if (!cancelled) setCalendar({ data: body.data ?? [], loading: false, error: response.ok ? "" : body.error ?? "error" });
      } catch {
        if (!cancelled) setCalendar({ data: [], loading: false, error: "error" });
      }
    }
    load();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const response = await fetch("/api/market/heatmap");
        const body = await response.json();
        if (!cancelled) setHeatmap({ data: body.data ?? [], loading: false, error: response.ok ? "" : body.error ?? "error" });
      } catch {
        if (!cancelled) setHeatmap({ data: [], loading: false, error: "error" });
      }
    }
    load();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setNews((prev) => ({ ...prev, loading: true, error: "" }));
    async function load() {
      try {
        const response = await fetch(`/api/market/news?category=${newsCategory}`);
        const body = await response.json();
        if (!cancelled) setNews({ data: body.data ?? [], loading: false, error: response.ok ? "" : body.error ?? "error" });
      } catch {
        if (!cancelled) setNews({ data: [], loading: false, error: "error" });
      }
    }
    load();
    return () => { cancelled = true; };
  }, [newsCategory]);

  return (
    <div className="flex w-full min-w-0 max-w-full flex-1 flex-col gap-4">
      <IndexStrip state={indices} refreshedAt={indicesRefreshedAt} />
      <div className="grid w-full min-w-0 items-stretch gap-4 overflow-hidden" style={{ gridTemplateColumns: "minmax(0, 65fr) minmax(0, 35fr)" }}>
        <TreemapHeatmapPanel state={heatmap} />
        <CalendarPanel state={calendar} />
      </div>
      <NewsPanel state={news} category={newsCategory} setCategory={setNewsCategory} />
    </div>
  );
}
