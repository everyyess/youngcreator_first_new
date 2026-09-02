"use client";

// 통합 인사이트 — 태그 트렌드 뷰
// 5개 DB에서 언급된 키워드의 랭킹(TOP 20)과 일별 언급량 추이를 보여준다.
//  · 기본: 전체 언급량 일별 스택바 (소스별)
//  · 키워드 선택(최대 5개): 구글 트렌드식 시계열 오버레이 비교 + 관련 자료 피드
// 색상 팔레트는 dataviz validator 통과 세트 (흰 배경 기준, 인접쌍 CVD ΔE ≥ 16).

import { useEffect, useMemo, useState } from "react";
import {
  Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { Database, Flame, Info, Radio, X } from "lucide-react";
import type { InsightItem, InsightSource } from "@/app/api/insight-db/route";
import { allTags, KEYWORD_COLORS, topTags, type TagType } from "./insightAggregates";
import KeywordLiveSearch from "./KeywordLiveSearch";

// ── 색상 (validator 통과) ────────────────────────────────────────────────────
const SOURCE_ORDER: InsightSource[] = ["youtube", "blog", "telegram", "news", "report"];
const SOURCE_COLORS: Record<InsightSource, string> = {
  youtube: "#DC2626", blog: "#F59E0B", telegram: "#0EA5E9", news: "#1D4ED8", report: "#A21CAF",
};
const SOURCE_LABELS: Record<InsightSource, string> = {
  youtube: "유튜브", blog: "블로그", telegram: "텔레그램", news: "뉴스", report: "리포트",
};
const MAX_COMPARE = 5;

// ── 기간 필터 (자산유형 필터는 상단 InsightDbTab의 태그 분류 카드를 그대로 사용) ──
type PeriodKey = "1w" | "1m" | "3m" | "6m";
const PERIODS: { key: PeriodKey; label: string; days: number }[] = [
  { key: "1w", label: "1주", days: 7 },
  { key: "1m", label: "1개월", days: 30 },
  { key: "3m", label: "3개월", days: 90 },
  { key: "6m", label: "6개월", days: 180 },
];

const TYPE_DOT: Record<TagType, string> = { stock: "#5F7A70", theme: "#059669", macro: "#D97706" };
const TYPE_LABEL: Record<TagType, string> = { stock: "개별종목", theme: "산업·테마", macro: "매크로·경제" };

/** KST 기준 오늘로부터 offsetDays일 전 (yyyy-mm-dd) */
function kstDay(offsetDays = 0): string {
  return new Date(Date.now() + 9 * 3600_000 - offsetDays * 86400_000).toISOString().slice(0, 10);
}

function fmtTick(d: string): string {
  return `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;
}

// ── 커스텀 툴팁 ───────────────────────────────────────────────────────────────
type TipPayload = { name?: string | number; value?: number; color?: string; fill?: string };

function ChartTip({ active, label, payload }: { active?: boolean; label?: string; payload?: TipPayload[] }) {
  if (!active || !payload?.length) return null;
  const rows = payload.filter((p) => (p.value ?? 0) > 0);
  const total = payload.reduce((s, p) => s + (p.value ?? 0), 0);
  return (
    <div className="rounded-lg border border-[#DDE8E5] bg-white px-3 py-2 shadow-popup">
      <p className="mb-1 text-[10px] font-black text-[#94A8A0]">{label} · 총 {total}건</p>
      <div className="flex flex-col gap-0.5">
        {(rows.length ? rows : payload).map((p, i) => (
          <div key={i} className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full" style={{ background: p.color ?? p.fill }} />
            <span className="text-[11px] font-bold text-[#33493F]">{p.name}</span>
            <span className="ml-auto pl-3 text-[11px] font-black tabular-nums text-[#0D2318]">{p.value}건</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── 메인 뷰 ──────────────────────────────────────────────────────────────────
export default function KeywordTrendView({
  items,
  classifyMap,
  typeFilter,
  onOpenItem,
  activeTags = [],
  onTagClick,
}: {
  items: InsightItem[];                       // 상단 소스/날짜 필터가 적용된 풀
  classifyMap: Map<string, TagType>;
  typeFilter: "all" | TagType;                // 상단 자산유형 분류 카드(전체/개별종목/산업·테마/매크로·경제)와 공유
  onOpenItem: (it: InsightItem) => void;      // 상세 모달 열기 (부모 재사용)
  activeTags?: string[];
  onTagClick?: (tag: string, additive: boolean) => void;
}) {
  const [dataMode, setDataMode] = useState<"db" | "live">("db");
  const [period, setPeriod] = useState<PeriodKey>("1m");
  const [selected, setSelected] = useState<{ name: string; slot: number }[]>([]);

  useEffect(() => {
    setSelected((prev) => {
      // 1. activeTags에 없는 것은 selected에서 제외
      let next = prev.filter((s) => activeTags.includes(s.name));
      // 2. activeTags에 있는데 selected에 없는 것은 새로 추가
      const existingNames = new Set(next.map((s) => s.name));
      const toAdd = activeTags.filter((name) => !existingNames.has(name));
      
      if (toAdd.length > 0) {
        const usedSlots = new Set(next.map((s) => s.slot));
        for (const name of toAdd) {
          if (next.length >= MAX_COMPARE) break;
          let slot = 0;
          while (usedSlots.has(slot)) slot++;
          usedSlots.add(slot);
          next.push({ name, slot });
        }
      }
      return next;
    });
  }, [activeTags]);

  const days = PERIODS.find((p) => p.key === period)!.days;
  const cutoff = kstDay(days - 1);       // 오늘 포함 days일
  const prevCutoff = kstDay(days * 2 - 1);

  const curItems = useMemo(() => items.filter((it) => it.date >= cutoff), [items, cutoff]);
  const prevItems = useMemo(
    () => items.filter((it) => it.date >= prevCutoff && it.date < cutoff),
    [items, prevCutoff, cutoff],
  );

  // ── 랭킹 TOP 20 + 직전 동일 기간 대비 순위 변동 ──────────────────────────────
  const ranked = useMemo(() => {
    const ranks = topTags(curItems, Number.MAX_SAFE_INTEGER);
    const filtered = typeFilter === "all" ? ranks : ranks.filter((t) => classifyMap.get(t.name) === typeFilter);
    return filtered.slice(0, 20);
  }, [curItems, typeFilter, classifyMap]);

  const prevRankMap = useMemo(() => {
    const ranks = topTags(prevItems, Number.MAX_SAFE_INTEGER);
    const filtered = typeFilter === "all" ? ranks : ranks.filter((t) => classifyMap.get(t.name) === typeFilter);
    const m = new Map<string, number>();
    filtered.forEach((t, i) => m.set(t.name, i + 1));
    return m;
  }, [prevItems, typeFilter, classifyMap]);

  // 급상승 (최근 7일 언급 3회↑ & 직전 7일 대비 3배↑ — 기간 선택과 무관)
  const risingSet = useMemo(() => {
    const c7 = kstDay(6), c14 = kstDay(13);
    const recent = new Map<string, number>();
    const prior = new Map<string, number>();
    for (const it of items) {
      const bucket = it.date >= c7 ? recent : it.date >= c14 ? prior : null;
      if (!bucket) continue;
      for (const t of new Set(allTags(it))) bucket.set(t, (bucket.get(t) ?? 0) + 1);
    }
    const set = new Set<string>();
    for (const [t, c] of recent) {
      if (c >= 3 && c / Math.max(1, prior.get(t) ?? 0) >= 3) set.add(t);
    }
    return set;
  }, [items]);

  // 키워드별 소스 분포 (랭킹 미니바)
  const sourceDist = useMemo(() => {
    const m = new Map<string, Record<InsightSource, number>>();
    for (const it of curItems) {
      for (const t of new Set(allTags(it))) {
        let rec = m.get(t);
        if (!rec) {
          rec = { youtube: 0, blog: 0, telegram: 0, news: 0, report: 0 };
          m.set(t, rec);
        }
        rec[it.source]++;
      }
    }
    return m;
  }, [curItems]);

  const maxCount = ranked[0]?.count ?? 1;

  // ── 차트 데이터 (일별, 빈 날짜 0 채움) ────────────────────────────────────────
  const dates = useMemo(() => {
    const arr: string[] = [];
    for (let i = days - 1; i >= 0; i--) arr.push(kstDay(i));
    return arr;
  }, [days]);

  const overviewData = useMemo(() => {
    const byDate = new Map<string, Record<InsightSource, number>>();
    for (const d of dates) byDate.set(d, { youtube: 0, blog: 0, telegram: 0, news: 0, report: 0 });
    for (const it of curItems) {
      const rec = byDate.get(it.date);
      if (rec) rec[it.source]++;
    }
    return dates.map((d) => ({ date: d, ...byDate.get(d)! }));
  }, [dates, curItems]);

  const keywordData = useMemo(() => {
    if (!selected.length) return [];
    const names = selected.map((s) => s.name);
    const byDate = new Map<string, Record<string, number>>();
    for (const d of dates) byDate.set(d, Object.fromEntries(names.map((n) => [n, 0])));
    for (const it of curItems) {
      const rec = byDate.get(it.date);
      if (!rec) continue;
      const tags = new Set(allTags(it));
      for (const n of names) if (tags.has(n)) rec[n]++;
    }
    return dates.map((d) => ({ date: d, ...byDate.get(d)! }));
  }, [dates, curItems, selected]);

  // 색상 슬롯은 키워드에 고정 — 다른 키워드를 해제해도 남은 키워드 색이 바뀌지 않는다
  const toggleKeyword = (name: string) => {
    if (onTagClick) {
      onTagClick(name, true);
    } else {
      setSelected((prev) => {
        if (prev.some((s) => s.name === name)) return prev.filter((s) => s.name !== name);
        if (prev.length >= MAX_COMPARE) return prev;
        const used = new Set(prev.map((s) => s.slot));
        let slot = 0;
        while (used.has(slot)) slot++;
        return [...prev, { name, slot }];
      });
    }
  };

  // 선택 키워드 관련 자료 (OR 매칭, 최신순)
  const feed = useMemo(() => {
    if (!selected.length) return [];
    const names = new Set(selected.map((s) => s.name));
    return curItems
      .filter((it) => allTags(it).some((t) => names.has(t)))
      .sort((a, b) => b.date.localeCompare(a.date) || (b.createdAt || "").localeCompare(a.createdAt || ""))
      .slice(0, 30);
  }, [curItems, selected]);

  const periodLabel = PERIODS.find((p) => p.key === period)!.label;

  return (
    <div className="flex flex-col gap-4">
      {/* 필터 행: (DB 모드) 기간 · (공통) 데이터베이스/실시간 모드 전환 */}
      <div className="flex flex-wrap items-center gap-3">
        {dataMode === "db" && (
          <div className="flex rounded-btn bg-[#F0F5F4] p-1">
            {PERIODS.map((p) => (
              <button key={p.key} type="button" onClick={() => setPeriod(p.key)}
                className={`rounded-lg px-3 py-1 text-xs font-bold transition ${period === p.key ? "bg-primary text-white shadow-soft" : "text-[#4B6358] hover:text-primary"}`}>
                {p.label}
              </button>
            ))}
          </div>
        )}
        <div className="flex rounded-btn bg-[#F0F5F4] p-1">
          <button type="button" onClick={() => setDataMode("db")}
            className={`flex items-center gap-1.5 rounded-lg px-3 py-1 text-xs font-bold transition ${dataMode === "db" ? "bg-primary text-white shadow-soft" : "text-[#4B6358] hover:text-primary"}`}>
            <Database size={12} /> 데이터베이스
          </button>
          <button type="button" onClick={() => setDataMode("live")}
            className={`flex items-center gap-1.5 rounded-lg px-3 py-1 text-xs font-bold transition ${dataMode === "live" ? "bg-primary text-white shadow-soft" : "text-[#4B6358] hover:text-primary"}`}>
            <Radio size={12} /> 실시간
          </button>
        </div>
        {dataMode === "db" && (
          <span className="ml-auto flex items-center gap-1 text-[11px] font-bold text-[#94A8A0]">
            <Info size={12} />
            최근 {periodLabel} 자료 {curItems.length}건 · 랭킹 클릭 시 차트 비교 (최대 {MAX_COMPARE}개)
          </span>
        )}
      </div>

      {dataMode === "live" && <KeywordLiveSearch />}

      {dataMode === "db" && (<>

      <div className="grid gap-4 xl:grid-cols-[400px_1fr]">
        {/* ── 좌: 언급량 TOP 20 랭킹 ── */}
        <section className="rounded-card border border-[#DDE8E5] bg-white p-3 shadow-card">
          <div className="mb-2 flex items-center justify-between border-b border-[#F0F7F4] pb-2">
            <p className="text-[13px] font-black tracking-tight text-[#0D2318]">언급량 TOP 20</p>
            <p className="text-[10px] font-bold text-[#94A8A0]">순위 변동은 직전 {periodLabel} 대비</p>
          </div>
          {ranked.length ? (
            <div className="flex flex-col gap-1">
              {ranked.map((t, i) => {
                const sel = selected.find((s) => s.name === t.name);
                const prevRank = prevRankMap.get(t.name);
                const delta = prevRank == null ? null : prevRank - (i + 1);
                const dist = sourceDist.get(t.name);
                const ty = classifyMap.get(t.name) ?? "theme";
                const full = !sel && selected.length >= MAX_COMPARE;
                return (
                  <button key={t.name} type="button" onClick={() => toggleKeyword(t.name)} disabled={full}
                    className={`relative w-full overflow-hidden rounded-lg border px-2.5 py-1.5 text-left transition ${
                      sel ? "border-primary bg-[#F0F7F4]" : "border-transparent hover:border-[#DDE8E5] hover:bg-[#FAFCFB]"
                    } ${full ? "cursor-not-allowed opacity-45" : ""}`}>
                    {/* 언급량 배경 바 */}
                    <span className="absolute inset-y-0 left-0 rounded-lg bg-[#EAF4F0]" style={{ width: `${(t.count / maxCount) * 100}%` }} aria-hidden />
                    <span className="relative flex items-center gap-2">
                      <span className="w-5 shrink-0 text-right text-[11px] font-black text-[#94A8A0]">{i + 1}</span>
                      <span className="w-9 shrink-0 text-[10px] font-black">
                        {delta == null ? (
                          <span className="rounded bg-emerald-50 px-1 py-px text-emerald-700">NEW</span>
                        ) : delta > 0 ? (
                          <span className="text-red-500">▲{delta}</span>
                        ) : delta < 0 ? (
                          <span className="text-blue-500">▼{-delta}</span>
                        ) : (
                          <span className="text-[#B9CCC4]">—</span>
                        )}
                      </span>
                      <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: TYPE_DOT[ty] }} title={TYPE_LABEL[ty]} />
                      <span className="min-w-0 flex-1 truncate text-xs font-black text-[#1C3329]">{t.name}</span>
                      {risingSet.has(t.name) && <Flame size={11} className="shrink-0 text-red-500" aria-label="급상승" />}
                      {sel && <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: KEYWORD_COLORS[sel.slot] }} />}
                      <span className="w-8 shrink-0 text-right text-[11px] font-black tabular-nums text-[#33493F]">{t.count}</span>
                      <span className="flex h-1.5 w-14 shrink-0 overflow-hidden rounded-full bg-[#F0F5F4]" title="소스 분포">
                        {dist && SOURCE_ORDER.map((s) =>
                          dist[s] ? <span key={s} style={{ width: `${(dist[s] / t.count) * 100}%`, background: SOURCE_COLORS[s] }} /> : null,
                        )}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          ) : (
            <p className="rounded-btn bg-[#F6FAF8] px-3 py-8 text-center text-xs font-bold text-[#94A8A0]">해당 기간에 집계된 키워드가 없습니다.</p>
          )}
        </section>

        {/* ── 우: 시계열 차트 + 관련 자료 피드 ── */}
        <div className="flex min-w-0 flex-col gap-4">
          <section className="rounded-card border border-[#DDE8E5] bg-white p-4 shadow-card">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <p className="text-[13px] font-black tracking-tight text-[#0D2318]">
                {selected.length ? "키워드 언급량 비교 (일별)" : "전체 언급량 추이 (일별 · 소스별)"}
              </p>
              {/* 범례 */}
              {selected.length ? (
                <div className="flex flex-wrap items-center gap-1.5">
                  {selected.map((s) => (
                    <button key={s.name} type="button" onClick={() => toggleKeyword(s.name)}
                      className="group flex items-center gap-1.5 rounded-full border border-[#DDE8E5] bg-white px-2 py-0.5 text-[11px] font-black text-[#33493F] transition hover:border-red-200 hover:bg-red-50">
                      <span className="h-2 w-2 rounded-full" style={{ background: KEYWORD_COLORS[s.slot] }} />
                      {s.name}
                      <X size={10} className="text-[#B9CCC4] group-hover:text-red-500" />
                    </button>
                  ))}
                  <button type="button" onClick={() => setSelected([])}
                    className="rounded-full px-2 py-0.5 text-[11px] font-bold text-[#94A8A0] underline-offset-2 hover:underline">
                    모두 지우기
                  </button>
                </div>
              ) : (
                <div className="flex flex-wrap items-center gap-2.5">
                  {SOURCE_ORDER.map((s) => (
                    <span key={s} className="flex items-center gap-1 text-[11px] font-bold text-[#5F7A70]">
                      <span className="h-2 w-2 rounded-[3px]" style={{ background: SOURCE_COLORS[s] }} />
                      {SOURCE_LABELS[s]}
                    </span>
                  ))}
                </div>
              )}
            </div>

            <div className="h-[280px] w-full">
              <ResponsiveContainer width="99%" height="100%" minWidth={1} minHeight={1}>
                {selected.length ? (
                  <LineChart data={keywordData} margin={{ top: 8, right: 12, left: -18, bottom: 0 }}>
                    <CartesianGrid vertical={false} stroke="#EEF4F2" />
                    <XAxis dataKey="date" tickFormatter={fmtTick} tick={{ fontSize: 10, fill: "#94A8A0", fontWeight: 700 }}
                      tickLine={false} axisLine={{ stroke: "#DDE8E5" }} minTickGap={28} />
                    <YAxis allowDecimals={false} tick={{ fontSize: 10, fill: "#94A8A0", fontWeight: 700 }} tickLine={false} axisLine={false} />
                    <Tooltip content={<ChartTip />} cursor={{ stroke: "#B9CCC4", strokeDasharray: "3 3" }} />
                    {selected.map((s) => (
                      <Line key={s.name} type="monotone" dataKey={s.name} name={s.name}
                        stroke={KEYWORD_COLORS[s.slot]} strokeWidth={2} dot={false}
                        activeDot={{ r: 4, strokeWidth: 2, stroke: "#fff" }} isAnimationActive={false} />
                    ))}
                  </LineChart>
                ) : (
                  <BarChart data={overviewData} margin={{ top: 8, right: 12, left: -18, bottom: 0 }}>
                    <CartesianGrid vertical={false} stroke="#EEF4F2" />
                    <XAxis dataKey="date" tickFormatter={fmtTick} tick={{ fontSize: 10, fill: "#94A8A0", fontWeight: 700 }}
                      tickLine={false} axisLine={{ stroke: "#DDE8E5" }} minTickGap={28} />
                    <YAxis allowDecimals={false} tick={{ fontSize: 10, fill: "#94A8A0", fontWeight: 700 }} tickLine={false} axisLine={false} />
                    <Tooltip content={<ChartTip />} cursor={{ fill: "rgba(0,91,82,0.06)" }} />
                    {SOURCE_ORDER.map((s) => (
                      <Bar key={s} dataKey={s} name={SOURCE_LABELS[s]} stackId="m" fill={SOURCE_COLORS[s]}
                        stroke="#fff" strokeWidth={1} maxBarSize={26} isAnimationActive={false} />
                    ))}
                  </BarChart>
                )}
              </ResponsiveContainer>
            </div>
            {!selected.length && (
              <p className="mt-2 text-[11px] font-bold text-[#94A8A0]">
                좌측 랭킹에서 키워드를 클릭하면 이 차트가 키워드별 비교 모드로 전환됩니다.
              </p>
            )}
          </section>

          {/* 관련 자료 피드 */}
          {selected.length > 0 && (
            <section className="rounded-card border border-[#DDE8E5] bg-white p-3 shadow-card">
              <div className="mb-2 flex items-center justify-between border-b border-[#F0F7F4] pb-2">
                <p className="text-[13px] font-black tracking-tight text-[#0D2318]">선택 키워드 관련 자료</p>
                <p className="text-[10px] font-bold text-[#94A8A0]">{feed.length}건 (최근 {periodLabel})</p>
              </div>
              {feed.length ? (
                <div className="flex max-h-[320px] flex-col gap-1 overflow-y-auto pr-1">
                  {feed.map((it) => (
                    <button key={it.id} type="button" onClick={() => onOpenItem(it)}
                      className="flex w-full items-center gap-2 rounded-lg border border-[#EEF4F2] bg-white px-2.5 py-1.5 text-left transition hover:border-[#CBE3DE] hover:bg-[#F6FAF8]">
                      <span className="w-12 shrink-0 text-[10px] font-black" style={{ color: SOURCE_COLORS[it.source] }}>
                        {SOURCE_LABELS[it.source]}
                      </span>
                      <span className="w-[74px] shrink-0 text-[10px] font-bold tabular-nums text-[#94A8A0]">{it.date}</span>
                      <span className="min-w-0 shrink-0 truncate text-xs font-black text-[#1C3329]" style={{ maxWidth: "55%" }}>{it.title}</span>
                      {it.summary && <span className="hidden min-w-0 flex-1 truncate text-[11px] font-semibold text-[#94A8A0] md:inline">{it.summary}</span>}
                    </button>
                  ))}
                </div>
              ) : (
                <p className="rounded-btn bg-[#F6FAF8] px-3 py-6 text-center text-xs font-bold text-[#94A8A0]">해당 기간에 관련 자료가 없습니다.</p>
              )}
            </section>
          )}
        </div>
      </div>
      </>)}
    </div>
  );
}
