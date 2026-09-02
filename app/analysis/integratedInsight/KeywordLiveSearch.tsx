"use client";

// 태그 트렌드 — 실시간 검색 패널
// Supabase 저장분이 아니라 소스를 라이브로 조회해 키워드 언급 횟수를 집계한다.
//  · 유튜브·블로그·리포트는 RSS/스크래핑 특성상 실시간성이 낮아 조회 대상에서 제외
//  · 텔레그램: 채널별로 선택한 범위(15분/30분/1시간) 이내 게시글만 대상 (서버가 정확한 epoch로 필터)
//  · 뉴스: 한경 키워드 검색 로직은 그대로 두되(당일 기준 조회), 선택한 범위로 결과를 다시 좁혀 집계
// 여러 키워드를 등록하면 언급 추이를 하나의 그래프에 겹쳐서 비교할 수 있다 (최대 3개 — 매 키워드가
// 실제 외부 API 호출 2건을 유발하므로 응답성을 위해 DB 뷰(최대 5개)보다 낮게 제한).

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, ExternalLink, Loader2, Search, X } from "lucide-react";
import {
  CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import type { TelegramSearchResponse } from "@/app/api/telegram-search/route";
import type { HankyungArticle } from "@/app/api/hankyung-articles/route";
import { KEYWORD_COLORS } from "./insightAggregates";

type LiveSource = "telegram" | "news";
const LIVE_SOURCE_ORDER: LiveSource[] = ["telegram", "news"];
const LIVE_SOURCE_COLORS: Record<LiveSource, string> = { telegram: "#0EA5E9", news: "#1D4ED8" };
const LIVE_SOURCE_LABELS: Record<LiveSource, string> = { telegram: "텔레그램", news: "뉴스" };

type LiveRange = "15m" | "30m" | "60m";
const RANGES: { key: LiveRange; label: string; minutes: number }[] = [
  { key: "15m", label: "15분", minutes: 15 },
  { key: "30m", label: "30분", minutes: 30 },
  { key: "60m", label: "1시간", minutes: 60 },
];
const BUCKET_MS = 5 * 60_000; // 차트는 5분 단위로 집계
const MAX_KEYWORDS = 3;

type LiveItem = {
  source: LiveSource;
  ts: number;        // epoch ms — 버킷/정렬용 (텔레그램·뉴스 모두 KST 보정된 절대 시각)
  date: string;       // 표시용
  title: string;
  url: string | null;
  meta: string;
};

type SourceState = {
  status: "idle" | "loading" | "done" | "error" | "unavailable";
  count: number;
  note: string;
  items: LiveItem[];
};

const IDLE: SourceState = { status: "idle", count: 0, note: "", items: [] };
const EMPTY_ENTRY: Record<LiveSource, SourceState> = { telegram: IDLE, news: IDLE };
const RECENT_KEY = "keyword-live-recent:v1";

/** KST 기준 오늘 (yyyy-mm-dd) — 한경 검색은 일 단위 쿼리만 지원 */
function kstToday(): string {
  return new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
}

function fmtClock(ts: number): string {
  return new Intl.DateTimeFormat("ko-KR", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Seoul" }).format(new Date(ts));
}

type TipPayload = { name?: string | number; value?: number; color?: string };
function ChartTip({ active, label, payload }: { active?: boolean; label?: string; payload?: TipPayload[] }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-[#DDE8E5] bg-white px-3 py-2 shadow-popup">
      <p className="mb-1 text-[10px] font-black text-[#94A8A0]">{label}</p>
      <div className="flex flex-col gap-0.5">
        {payload.map((p, i) => (
          <div key={i} className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full" style={{ background: p.color }} />
            <span className="text-[11px] font-bold text-[#33493F]">{p.name}</span>
            <span className="ml-auto pl-3 text-[11px] font-black tabular-nums text-[#0D2318]">{p.value}건</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function KeywordLiveSearch() {
  const [input, setInput] = useState("");
  const [range, setRange] = useState<LiveRange>("15m");
  const [keywords, setKeywords] = useState<{ name: string; slot: number }[]>([]);
  const [results, setResults] = useState<Record<string, Record<LiveSource, SourceState>>>({});
  const [recent, setRecent] = useState<string[]>([]);

  const seqRef = useRef<Record<string, number>>({}); // 키워드별 요청 순번 — 오래된 응답 무시

  useEffect(() => {
    try {
      const raw = localStorage.getItem(RECENT_KEY);
      if (raw) setRecent((JSON.parse(raw) as string[]).slice(0, 8));
    } catch {}
  }, []);

  const setSourceState = useCallback((kw: string, seq: number, src: LiveSource, next: SourceState) => {
    if (seq !== (seqRef.current[kw] ?? 0)) return;
    setResults((prev) => ({ ...prev, [kw]: { ...(prev[kw] ?? EMPTY_ENTRY), [src]: next } }));
  }, []);

  const runSearch = useCallback((kw: string, rangeKey: LiveRange) => {
    const minutes = RANGES.find((r) => r.key === rangeKey)!.minutes;
    const seq = (seqRef.current[kw] ?? 0) + 1;
    seqRef.current[kw] = seq;
    const rangeLabel = RANGES.find((r) => r.key === rangeKey)!.label;

    setResults((prev) => ({ ...prev, [kw]: { telegram: { ...IDLE, status: "loading" }, news: { ...IDLE, status: "loading" } } }));

    // ── 텔레그램: 서버가 windowMinutes로 채널별 정확한 시간창 필터링 ──────────
    void (async () => {
      try {
        const res = await fetch(`/api/telegram-search?keyword=${encodeURIComponent(kw)}&windowMinutes=${minutes}`);
        const data = (await res.json()) as TelegramSearchResponse & { error?: string };
        if (!res.ok || data.error) {
          setSourceState(kw, seq, "telegram", { status: res.status === 503 ? "unavailable" : "error", count: 0, note: data.error ?? "조회 실패", items: [] });
          return;
        }
        const items: LiveItem[] = (data.messages ?? []).map((m) => ({
          source: "telegram", ts: m.ts ?? (Date.parse(m.date) || Date.now()), date: m.date,
          title: (m.summary || m.text || "").slice(0, 120), url: m.link || null, meta: m.channel,
        }));
        setSourceState(kw, seq, "telegram", { status: "done", count: items.length, note: "", items });
      } catch {
        setSourceState(kw, seq, "telegram", { status: "error", count: 0, note: "조회 실패", items: [] });
      }
    })();

    // ── 뉴스: 기존 당일 검색 로직 유지, 선택 범위로 재필터링 ──────────────────
    void (async () => {
      try {
        const today = kstToday();
        const res = await fetch(`/api/hankyung-search?query=${encodeURIComponent(kw)}&startDate=${today}&endDate=${today}&page=1`);
        const data = (await res.json()) as { articles?: HankyungArticle[]; total?: number; error?: string };
        if (!res.ok || data.error) {
          setSourceState(kw, seq, "news", { status: "error", count: 0, note: data.error ?? "조회 실패", items: [] });
          return;
        }
        const cutoff = Date.now() - minutes * 60_000;
        const items: LiveItem[] = (data.articles ?? [])
          .filter((a) => a.ts != null && a.ts >= cutoff)
          .map((a) => ({ source: "news", ts: a.ts!, date: a.time, title: a.title, url: a.url, meta: "한국경제" }));
        setSourceState(kw, seq, "news", {
          status: "done", count: items.length,
          note: `당일 ${data.total ?? data.articles?.length ?? 0}건 중 최근 ${rangeLabel}`,
          items,
        });
      } catch {
        setSourceState(kw, seq, "news", { status: "error", count: 0, note: "조회 실패", items: [] });
      }
    })();
  }, [setSourceState]);

  const addKeyword = useCallback((raw: string) => {
    const kw = raw.trim();
    if (!kw) return;
    const already = keywords.some((k) => k.name === kw);
    if (already) {
      runSearch(kw, range);
    } else {
      if (keywords.length >= MAX_KEYWORDS) return;
      const used = new Set(keywords.map((k) => k.slot));
      let slot = 0;
      while (used.has(slot)) slot++;
      setKeywords((prev) => [...prev, { name: kw, slot }]);
      runSearch(kw, range);
    }
    setRecent((prev) => {
      const next = [kw, ...prev.filter((k) => k !== kw)].slice(0, 8);
      try { localStorage.setItem(RECENT_KEY, JSON.stringify(next)); } catch {}
      return next;
    });
    setInput("");
  }, [keywords, range, runSearch]);

  const removeKeyword = useCallback((kw: string) => {
    setKeywords((prev) => prev.filter((k) => k.name !== kw));
    setResults((prev) => {
      const next = { ...prev };
      delete next[kw];
      return next;
    });
  }, []);

  const changeRange = useCallback((rangeKey: LiveRange) => {
    setRange(rangeKey);
    for (const k of keywords) runSearch(k.name, rangeKey);
  }, [keywords, runSearch]);

  const atMax = keywords.length >= MAX_KEYWORDS;
  const anyLoading = keywords.some((k) => LIVE_SOURCE_ORDER.some((s) => results[k.name]?.[s]?.status === "loading"));
  const rangeLabel = RANGES.find((r) => r.key === range)!.label;

  // ── 비교 차트: 5분 버킷 × 키워드별 텔레그램+뉴스 합산 언급 수 ────────────────
  const chartData = useMemo(() => {
    if (!keywords.length) return [];
    const minutes = RANGES.find((r) => r.key === range)!.minutes;
    const numBuckets = minutes / 5;
    const now = Date.now();
    return Array.from({ length: numBuckets }, (_, i) => {
      const start = now - (numBuckets - i) * BUCKET_MS;
      const end = start + BUCKET_MS;
      const row: Record<string, number | string> = { bucket: fmtClock(end) };
      for (const k of keywords) {
        const entry = results[k.name];
        const all = entry ? [...entry.telegram.items, ...entry.news.items] : [];
        row[k.name] = all.filter((it) => it.ts >= start && it.ts < end).length;
      }
      return row;
    });
  }, [keywords, results, range]);

  // ── 통합 매칭 피드 (전체 키워드 · 최신순) ────────────────────────────────────
  const feed = useMemo(() => {
    const rows: (LiveItem & { keyword: string; slot: number })[] = [];
    for (const k of keywords) {
      const entry = results[k.name];
      if (!entry) continue;
      for (const it of [...entry.telegram.items, ...entry.news.items]) rows.push({ ...it, keyword: k.name, slot: k.slot });
    }
    return rows.sort((a, b) => b.ts - a.ts).slice(0, 50);
  }, [keywords, results]);

  return (
    <div className="flex flex-col gap-4">
      {/* 검색 입력 행 */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[220px] flex-1 sm:max-w-md">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#94A8A0]" />
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !atMax) addKeyword(input); }}
            placeholder={atMax ? `최대 ${MAX_KEYWORDS}개까지 비교할 수 있어요` : "키워드 입력 후 Enter (비교 시 여러 개 추가)"}
            disabled={atMax}
            className="w-full rounded-btn border border-[#DDE8E5] bg-white py-2 pl-9 pr-3 text-sm font-bold text-[#0D2318] placeholder:text-[#B9CCC4] focus:border-primary focus:outline-none disabled:bg-[#F6FAF8]"
          />
        </div>
        <div className="flex rounded-btn bg-[#F0F5F4] p-1">
          {RANGES.map((r) => (
            <button key={r.key} type="button" onClick={() => changeRange(r.key)}
              className={`rounded-lg px-3 py-1 text-xs font-bold transition ${range === r.key ? "bg-primary text-white shadow-soft" : "text-[#4B6358] hover:text-primary"}`}>
              {r.label}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => addKeyword(input)}
          disabled={atMax || !input.trim()}
          className="flex items-center gap-1.5 rounded-btn bg-primary px-4 py-2 text-xs font-black text-white transition hover:bg-primary-light disabled:cursor-not-allowed disabled:opacity-50"
        >
          {anyLoading ? <Loader2 size={13} className="animate-spin" /> : <Search size={13} />}
          추가
        </button>
      </div>

      {/* 최근 검색어 */}
      {recent.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[10px] font-black text-[#94A8A0]">최근 검색</span>
          {recent.map((k) => (
            <button key={k} type="button" onClick={() => addKeyword(k)} disabled={atMax && !keywords.some((e) => e.name === k)}
              className="rounded-full border border-[#DDE8E5] bg-white px-2.5 py-0.5 text-[11px] font-bold text-[#4B6358] transition hover:border-primary hover:text-primary disabled:cursor-not-allowed disabled:opacity-40">
              {k}
            </button>
          ))}
        </div>
      )}

      {/* 활성 키워드 칩 */}
      {keywords.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          {keywords.map((k) => (
            <span key={k.name} className="flex items-center gap-1.5 rounded-full border border-[#DDE8E5] bg-white px-2.5 py-1 text-[11px] font-black text-[#1C3329]">
              <span className="h-2 w-2 rounded-full" style={{ background: KEYWORD_COLORS[k.slot] }} />
              {k.name}
              <button type="button" onClick={() => removeKeyword(k.name)} className="text-[#B9CCC4] hover:text-red-500"><X size={11} /></button>
            </span>
          ))}
          {atMax && <span className="text-[10px] font-bold text-[#94A8A0]">최대 {MAX_KEYWORDS}개까지 비교할 수 있습니다</span>}
        </div>
      )}

      {!keywords.length ? (
        <div className="rounded-card border border-dashed border-[#CBE3DE] bg-[#F9FCFB] px-4 py-14 text-center">
          <p className="text-sm font-black text-[#33493F]">키워드를 입력하면 텔레그램·뉴스를 실시간으로 조회합니다</p>
          <p className="mt-1 text-xs font-bold text-[#94A8A0]">여러 키워드를 추가하면 언급 추이를 한 그래프에 겹쳐 비교할 수 있어요 (최대 {MAX_KEYWORDS}개)</p>
        </div>
      ) : (
        <>
          {/* 비교 차트 */}
          <section className="rounded-card border border-[#DDE8E5] bg-white p-4 shadow-card">
            <div className="mb-2 flex items-center justify-between">
              <p className="text-[13px] font-black tracking-tight text-[#0D2318]">키워드 언급 추이 (최근 {rangeLabel} · 5분 단위)</p>
              <span className="text-[10px] font-bold text-[#94A8A0]">텔레그램+뉴스 합산</span>
            </div>
            <div className="h-[220px] w-full">
              <ResponsiveContainer width="99%" height="100%" minWidth={1} minHeight={1}>
                <LineChart data={chartData} margin={{ top: 8, right: 12, left: -18, bottom: 0 }}>
                  <CartesianGrid vertical={false} stroke="#EEF4F2" />
                  <XAxis dataKey="bucket" tick={{ fontSize: 10, fill: "#94A8A0", fontWeight: 700 }} tickLine={false} axisLine={{ stroke: "#DDE8E5" }} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 10, fill: "#94A8A0", fontWeight: 700 }} tickLine={false} axisLine={false} />
                  <Tooltip content={<ChartTip />} cursor={{ stroke: "#B9CCC4", strokeDasharray: "3 3" }} />
                  {keywords.map((k) => (
                    <Line key={k.name} type="monotone" dataKey={k.name} name={k.name}
                      stroke={KEYWORD_COLORS[k.slot]} strokeWidth={2} dot={{ r: 3 }}
                      activeDot={{ r: 4, strokeWidth: 2, stroke: "#fff" }} isAnimationActive={false} />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </div>
          </section>

          {/* 키워드별 요약 */}
          <section className="rounded-card border border-[#DDE8E5] bg-white p-3 shadow-card">
            <div className="mb-2 border-b border-[#F0F7F4] pb-2">
              <p className="text-[13px] font-black tracking-tight text-[#0D2318]">키워드별 언급 요약 · {rangeLabel}</p>
            </div>
            <div className="flex flex-col gap-1.5">
              {keywords.map((k) => {
                const entry = results[k.name] ?? EMPTY_ENTRY;
                const total = LIVE_SOURCE_ORDER.reduce((sum, s) => sum + (entry[s].status === "done" ? entry[s].count : 0), 0);
                const loading = LIVE_SOURCE_ORDER.some((s) => entry[s].status === "loading");
                return (
                  <div key={k.name} className="flex flex-wrap items-center gap-3 rounded-lg border border-[#EEF4F2] bg-[#FAFCFB] px-3 py-2">
                    <span className="flex items-center gap-1.5 text-xs font-black text-[#1C3329]">
                      <span className="h-2 w-2 rounded-full" style={{ background: KEYWORD_COLORS[k.slot] }} />
                      {k.name}
                    </span>
                    <span className="text-lg font-black text-primary">
                      {loading ? <Loader2 size={16} className="animate-spin text-[#94A8A0]" /> : `${total}건`}
                    </span>
                    {LIVE_SOURCE_ORDER.map((s) => (
                      <span key={s} className="flex items-center gap-1 text-[11px] font-bold text-[#5F7A70]">
                        <span className="h-1.5 w-1.5 rounded-full" style={{ background: LIVE_SOURCE_COLORS[s] }} />
                        {LIVE_SOURCE_LABELS[s]}{" "}
                        {entry[s].status === "loading" ? (
                          <Loader2 size={11} className="animate-spin text-[#B9CCC4]" />
                        ) : entry[s].status === "done" ? (
                          `${entry[s].count}건`
                        ) : (
                          <span className="flex items-center gap-0.5 text-[#94A8A0]"><AlertCircle size={10} />불가</span>
                        )}
                      </span>
                    ))}
                    {(entry.telegram.note || entry.news.note) && (
                      <span className="ml-auto truncate text-[10px] font-bold text-[#B9CCC4]" title={entry.telegram.note || entry.news.note}>
                        {entry.news.note || entry.telegram.note}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          </section>

          {/* 통합 매칭 피드 */}
          <section className="rounded-card border border-[#DDE8E5] bg-white p-3 shadow-card">
            <div className="mb-2 flex items-center justify-between border-b border-[#F0F7F4] pb-2">
              <p className="text-[13px] font-black tracking-tight text-[#0D2318]">매칭 자료</p>
              <p className="text-[10px] font-bold text-[#94A8A0]">{feed.length}건 표시 (최신순)</p>
            </div>
            {feed.length ? (
              <div className="flex max-h-[420px] flex-col gap-1 overflow-y-auto pr-1">
                {feed.map((it, i) => (
                  <a key={`${it.keyword}-${it.source}-${i}`} href={it.url ?? undefined} target="_blank" rel="noreferrer"
                    className={`flex w-full items-center gap-2 rounded-lg border border-[#EEF4F2] bg-white px-2.5 py-1.5 text-left transition ${it.url ? "hover:border-[#CBE3DE] hover:bg-[#F6FAF8]" : "cursor-default"}`}>
                    <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: KEYWORD_COLORS[it.slot] }} title={it.keyword} />
                    <span className="w-12 shrink-0 text-[10px] font-black" style={{ color: LIVE_SOURCE_COLORS[it.source] }}>
                      {LIVE_SOURCE_LABELS[it.source]}
                    </span>
                    <span className="w-[104px] shrink-0 text-[10px] font-bold tabular-nums text-[#94A8A0]">{it.date}</span>
                    <span className="min-w-0 flex-1 truncate text-xs font-black text-[#1C3329]">{it.title}</span>
                    {it.meta && <span className="hidden shrink-0 text-[10px] font-bold text-[#94A8A0] md:inline">{it.meta}</span>}
                    {it.url && <ExternalLink size={11} className="shrink-0 text-[#B9CCC4]" />}
                  </a>
                ))}
              </div>
            ) : anyLoading ? (
              <p className="rounded-btn bg-[#F6FAF8] px-3 py-8 text-center text-xs font-bold text-[#94A8A0]">
                <Loader2 size={13} className="mr-1.5 inline animate-spin" /> 소스별 조회 중…
              </p>
            ) : (
              <p className="rounded-btn bg-[#F6FAF8] px-3 py-8 text-center text-xs font-bold text-[#94A8A0]">
                해당 기간에 매칭된 자료가 없습니다.
              </p>
            )}
          </section>
        </>
      )}
    </div>
  );
}
