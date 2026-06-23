"use client";

import { useEffect, useMemo, useState } from "react";
import { CalendarDays, ExternalLink, Newspaper, RefreshCw } from "lucide-react";
import { heatmapItems, type HeatmapItem } from "@/lib/marketHeatmap";
import type { MarketIndexItem } from "@/lib/marketData";
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

function heatmapClass(value: number) {
  if (value >= 3) return "bg-red-700 text-white";
  if (value >= 1) return "bg-red-600 text-white";
  if (value > 0) return "bg-red-400 text-white";
  if (value <= -3) return "bg-blue-800 text-white";
  if (value <= -1) return "bg-blue-600 text-white";
  if (value < 0) return "bg-blue-400 text-white";
  return "bg-slate-600 text-white";
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
  const firstWeight = first.reduce((sum, item) => sum + item.weight, 0);
  const ratio = firstWeight / total;

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

function IndexStrip({ state, refreshedAt }: { state: LoadState<MarketIndexItem[]>; refreshedAt: Date | null }) {
  return (
    <section className="w-full min-w-0 max-w-full overflow-hidden rounded-xl border border-blue-100 bg-white p-2.5 shadow-sm">
      <div className="mb-2 flex items-center justify-between gap-3">
        <p className="text-xs font-black uppercase tracking-normal text-blue-700">Market Index</p>
        <p className="shrink-0 text-[11px] font-black text-slate-400">최근 갱신: {formatRefreshTime(refreshedAt)}</p>
      </div>
      {state.error ? (
        <div className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-3 text-sm font-bold text-slate-500">주요 지수를 불러오지 못했습니다.</div>
      ) : (
        <div className="flex w-full min-w-0 max-w-full flex-nowrap overflow-hidden rounded-lg border border-slate-100">
          {(state.data.length ? state.data : Array.from({ length: 7 }, (_, i) => ({ symbol: `${i}`, name: "조회 중", value: null, change: null, changePercent: null, sparkline: [], basis: "조회 중", asOf: null }))).map((item) => (
            <div key={item.symbol} className="box-border min-w-0 flex-none overflow-hidden border-r border-slate-100 px-1 py-2 last:border-r-0" style={{ width: "14.285714%" }}>
              <div className="flex min-w-0 items-center justify-between gap-1">
                <p className="min-w-0 text-[9px] font-black leading-tight text-slate-700">{item.name}</p>
                <p className={`shrink-0 text-[9px] font-black ${directionClass(item.changePercent)}`}>
                  {item.changePercent != null && item.changePercent > 0 ? "+" : ""}{formatNumber(item.changePercent, 2)}%
                </p>
                {state.loading ? <RefreshCw size={12} className="shrink-0 animate-spin text-blue-500" /> : null}
              </div>
              <p className="mt-1 whitespace-nowrap text-[11px] font-black tracking-normal text-navy">{formatNumber(item.value, item.symbol === "^TNX" ? 3 : 2)}</p>
              <div className={`mt-1.5 h-5 rounded-md ${item.changePercent == null ? "bg-slate-100" : item.changePercent >= 0 ? "bg-red-50" : "bg-blue-50"}`}>
                <svg viewBox="0 0 120 28" className={`h-full w-full ${directionClass(item.changePercent)}`} preserveAspectRatio="none" aria-hidden="true">
                  <polyline points={sparklinePoints(item.sparkline)} fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function HeatmapPanel() {
  const grouped = useMemo(() => {
    return heatmapItems.reduce<Record<string, HeatmapItem[]>>((acc, item) => {
      acc[item.sector] = [...(acc[item.sector] ?? []), item];
      return acc;
    }, {});
  }, []);

  return (
    <section className="min-h-[360px] w-full min-w-0 max-w-full overflow-hidden rounded-xl border border-blue-100 bg-white p-3 shadow-sm">
      <div className="mb-3 flex items-center justify-between">
        <p className="text-sm font-black text-navy">미국 대형주 히트맵</p>
        <span className="rounded-full bg-blue-50 px-2 py-1 text-[11px] font-black text-blue-700">1D</span>
      </div>
      <div className="grid h-[320px] grid-cols-2 gap-2 overflow-hidden lg:grid-cols-3">
        {Object.entries(grouped).map(([sector, items]) => (
          <div key={sector} className="min-h-0 rounded-lg border border-slate-100 bg-slate-50 p-1">
            <p className="mb-1 truncate px-1 text-[10px] font-black uppercase tracking-normal text-slate-500">{sector}</p>
            <div className="flex h-[calc(100%-20px)] flex-wrap gap-1">
              {items.map((item) => (
                <div
                  key={item.symbol}
                  className={`flex min-h-12 min-w-14 flex-col justify-center rounded-md border border-white/40 p-1 text-center shadow-sm ${heatmapClass(item.changePercent)}`}
                  style={{ flex: `${Math.max(item.weight, 3)} 1 ${Math.max(item.weight * 5, 42)}px` }}
                  title={`${item.name} ${item.changePercent.toFixed(2)}%`}
                >
                  <span className="truncate text-sm font-black leading-tight">{item.symbol}</span>
                  <span className="text-[11px] font-black leading-tight">{item.changePercent > 0 ? "+" : ""}{item.changePercent.toFixed(2)}%</span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
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

  return (
    <section className="min-h-[420px] w-full min-w-0 max-w-full overflow-hidden rounded-xl border border-blue-100 bg-white p-3 shadow-sm">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-black text-navy">미국 대형주 히트맵</p>
          <p className="truncate text-[11px] font-bold text-slate-400">S&P 500 · 1 Day Performance · Market Cap</p>
        </div>
        <span className="shrink-0 rounded-full bg-blue-50 px-2 py-1 text-[11px] font-black text-blue-700">Treemap</span>
      </div>
      <div className="relative h-[360px] overflow-hidden rounded-xl border border-slate-800 bg-slate-950 p-1 shadow-inner">
        {state.loading ? (
          <div className="flex h-full items-center justify-center text-sm font-black text-slate-300">
            히트맵 데이터를 불러오는 중입니다.
          </div>
        ) : state.error || !sectorRects.length ? (
          <div className="flex h-full items-center justify-center text-sm font-black text-slate-300">
            히트맵 데이터를 불러오지 못했습니다.
          </div>
        ) : sectorRects.map((sector) => {
          const itemRects = splitTreemap(sector.items, 0, 0, 100, 100);
          return (
            <div
              key={sector.sector}
              className="absolute overflow-hidden border border-slate-950 bg-slate-900"
              style={{ left: `${sector.x}%`, top: `${sector.y}%`, width: `${sector.width}%`, height: `${sector.height}%` }}
            >
              <div className="absolute inset-x-0 top-0 z-10 h-5 bg-slate-950/75 px-1.5 py-0.5">
                <p className="truncate text-[10px] font-black uppercase tracking-normal text-white">{sector.sector}</p>
              </div>
              <div className="absolute inset-x-0 bottom-0 top-5">
                {itemRects.map((item) => {
                  const area = item.width * item.height;
                  const showLargeLabel = area > 190;
                  const showSmallLabel = area > 60;
                  return (
                    <div
                      key={item.symbol}
                      className={`absolute flex flex-col items-center justify-center overflow-hidden border border-slate-950/45 p-1 text-center shadow-[inset_0_1px_0_rgba(255,255,255,0.18)] ${heatmapClass(item.changePercent)}`}
                      style={{ left: `${item.x}%`, top: `${item.y}%`, width: `${item.width}%`, height: `${item.height}%` }}
                      title={`${item.name} ${item.changePercent > 0 ? "+" : ""}${item.changePercent.toFixed(2)}%`}
                    >
                      {showSmallLabel ? (
                        <>
                          <span className={`${showLargeLabel ? "text-2xl" : "text-xs"} max-w-full truncate font-black leading-tight drop-shadow-sm`}>
                            {item.symbol}
                          </span>
                          <span className={`${showLargeLabel ? "text-base" : "text-[10px]"} max-w-full truncate font-black leading-tight drop-shadow-sm`}>
                            {item.changePercent > 0 ? "+" : ""}{item.changePercent.toFixed(2)}%
                          </span>
                        </>
                      ) : null}
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
  const importanceClass = {
    high: "bg-red-50 text-red-700 border-red-100",
    medium: "bg-amber-50 text-amber-700 border-amber-100",
    low: "bg-slate-50 text-slate-500 border-slate-100",
  };

  return (
    <section className="min-h-[360px] w-full min-w-0 max-w-full overflow-hidden rounded-xl border border-blue-100 bg-white p-3 shadow-sm">
      <div className="mb-3 flex items-center gap-2">
        <CalendarDays size={17} className="text-blue-600" />
        <p className="text-sm font-black text-navy">주요 일정</p>
      </div>
      {state.loading ? (
        <div className="rounded-lg bg-slate-50 px-3 py-8 text-center text-sm font-bold text-slate-400">일정 데이터를 불러오는 중입니다.</div>
      ) : state.error ? (
        <div className="rounded-lg bg-slate-50 px-3 py-8 text-center text-sm font-bold text-slate-400">일정 데이터를 불러오지 못했습니다.</div>
      ) : state.data.length ? (
        <div className="grid max-h-[310px] gap-2 overflow-y-auto pr-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {state.data.map((event) => (
            <div key={event.id} className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2">
              <div className="mb-1 flex items-center gap-1.5">
                <span className="text-[11px] font-black text-slate-500">{event.date}</span>
                <span className="text-[11px] font-bold text-slate-400">{event.time}</span>
                <span className="rounded-full bg-white px-2 py-0.5 text-[10px] font-black text-blue-700">{event.market}</span>
                <span className={`ml-auto rounded-full border px-2 py-0.5 text-[10px] font-black ${importanceClass[event.importance]}`}>{event.importance}</span>
              </div>
              <p className="line-clamp-2 text-sm font-black text-slate-800">{event.title}</p>
            </div>
          ))}
        </div>
      ) : (
        <div className="rounded-lg bg-slate-50 px-3 py-8 text-center text-sm font-bold text-slate-400">불러올 일정이 없습니다.</div>
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
          <p className="text-sm font-black text-navy">한경 기사</p>
        </div>
        <div className="grid grid-cols-2 rounded-lg border border-slate-200 bg-slate-50 p-1">
          {(["economy", "industry"] as NewsCategory[]).map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => setCategory(item)}
              className={`rounded-md px-4 py-1.5 text-xs font-black transition ${category === item ? "bg-blue-600 text-white shadow-sm" : "text-slate-500 hover:bg-white"}`}
            >
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
              {article.summary ? <p className="mt-1 line-clamp-2 text-xs font-semibold leading-5 text-slate-500">{article.summary}</p> : null}
              <p className="mt-2 text-[11px] font-black text-slate-400">{article.source} · {article.time || "방금 전"}</p>
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
    async function load() {
      try {
        const response = await fetch("/api/market/indices");
        const body = await response.json();
        if (!cancelled) {
          setIndices({ data: body.data ?? [], loading: false, error: response.ok ? "" : body.error ?? "error" });
          setIndicesRefreshedAt(new Date());
        }
      } catch {
        if (!cancelled) {
          setIndices({ data: [], loading: false, error: "error" });
          setIndicesRefreshedAt(new Date());
        }
      }
    }
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
    <div className="grid h-full min-h-[520px] w-full min-w-0 max-w-full gap-4 overflow-hidden">
      <IndexStrip state={indices} refreshedAt={indicesRefreshedAt} />
      <div className="grid min-w-0 max-w-full gap-4 overflow-hidden xl:grid-cols-[minmax(0,65fr)_minmax(0,35fr)]">
        <TreemapHeatmapPanel state={heatmap} />
        <CalendarPanel state={calendar} />
      </div>
      <NewsPanel state={news} category={newsCategory} setCategory={setNewsCategory} />
    </div>
  );
}
