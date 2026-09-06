"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, Scale, Search, TrendingDown, TrendingUp } from "lucide-react";
import type { DebateLogRow, DebateResult } from "@/app/api/insight-debate/route";
import type { InsightItem } from "@/app/api/insight-db/route";
import { topTags } from "./insightAggregates";

type Stage = "idle" | "opening" | "rebuttal" | "synthesis" | "done";

const STAGE_LABEL: Record<"opening" | "rebuttal" | "synthesis", string> = {
  opening: "① 강세/약세 논거 생성 중",
  rebuttal: "② 반박 중",
  synthesis: "③ 종합 판단 중",
};

function frameLabels(tagType: DebateResult["tagType"]) {
  return tagType === "macro"
    ? { bull: "우호적 영향", bear: "비우호적 영향" }
    : { bull: "강세 논거", bear: "약세 논거" };
}

export default function InsightDebateTab() {
  const [keyword, setKeyword] = useState("");
  const [tagOptions, setTagOptions] = useState<string[]>([]);
  const [stage, setStage] = useState<Stage>("idle");
  const [result, setResult] = useState<DebateResult | null>(null);
  const [error, setError] = useState("");
  const [history, setHistory] = useState<DebateLogRow[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);

  useEffect(() => {
    fetch("/api/insight-db")
      .then((r) => r.json())
      .then((json: { items?: InsightItem[] }) => {
        const ranks = topTags(json.items ?? [], 200);
        setTagOptions(ranks.map((r) => r.name));
      })
      .catch(() => {});
  }, []);

  const loadHistory = useCallback(() => {
    setHistoryLoading(true);
    fetch("/api/insight-debate?limit=50")
      .then((r) => r.json())
      .then((json: { debates?: DebateLogRow[] }) => setHistory(json.debates ?? []))
      .catch(() => {})
      .finally(() => setHistoryLoading(false));
  }, []);
  useEffect(() => { loadHistory(); }, [loadHistory]);

  const running = stage !== "idle" && stage !== "done";

  const runDebate = async () => {
    const kw = keyword.trim();
    if (!kw || running) return;
    setError("");
    setResult(null);
    setStage("opening");
    const rebuttalTimer = setTimeout(() => setStage("rebuttal"), 6000);
    const synthesisTimer = setTimeout(() => setStage("synthesis"), 14000);
    try {
      const res = await fetch("/api/insight-debate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keyword: kw }),
      });
      const json = (await res.json()) as DebateResult & { error?: string };
      if (!res.ok || json.error) {
        setError(json.error ?? "토론 생성에 실패했습니다.");
        setStage("idle");
        return;
      }
      setResult(json);
      setStage("done");
      loadHistory();
    } catch (e) {
      setError(e instanceof Error ? e.message : "토론 생성 요청 실패");
      setStage("idle");
    } finally {
      clearTimeout(rebuttalTimer);
      clearTimeout(synthesisTimer);
    }
  };

  return (
    <div className="flex h-full min-h-0 gap-4 p-4">
      <div className="flex min-w-0 flex-1 flex-col gap-4 overflow-y-auto">
        <div className="flex items-center gap-2 rounded-card border border-[#DDE8E5] bg-white p-3 shadow-soft">
          <div className="relative flex-1">
            <Search size={13} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#94A8A0]" />
            <input
              type="text" list="insight-debate-tags" value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") void runDebate(); }}
              placeholder="종목·산업·매크로 키워드 (예: 삼성전자, 2차전지, 금리)"
              className="w-full rounded-input border border-[#DDE8E5] py-2 pl-8 pr-3 text-[13px] font-semibold text-[#0D2318] placeholder:text-[#B9CCC4] focus:border-primary focus:ring-2 focus:ring-primary/15"
            />
            <datalist id="insight-debate-tags">
              {tagOptions.map((t) => <option key={t} value={t} />)}
            </datalist>
          </div>
          <button
            type="button" onClick={() => void runDebate()} disabled={!keyword.trim() || running}
            className="flex shrink-0 items-center gap-1.5 rounded-btn bg-primary px-4 py-2 text-xs font-black text-white transition hover:bg-primary-light disabled:opacity-50"
          >
            {running ? <Loader2 size={13} className="animate-spin" /> : <Scale size={13} />}
            분석 실행
          </button>
        </div>

        {running && (
          <p className="text-center text-[12px] font-bold text-[#5F7A70]">
            {STAGE_LABEL[stage as "opening" | "rebuttal" | "synthesis"]}…
          </p>
        )}
        {error && (
          <p className="rounded-card border border-red-200 bg-red-50 p-3 text-[12px] font-semibold text-red-600">{error}</p>
        )}

        {result && (
          <>
            <div className="grid grid-cols-2 gap-4">
              {(["bull", "bear"] as const).map((side) => {
                const labels = frameLabels(result.tagType);
                const label = side === "bull" ? labels.bull : labels.bear;
                const opening = side === "bull" ? result.bullOpening : result.bearOpening;
                const rebuttal = side === "bull" ? result.bullRebuttal : result.bearRebuttal;
                const Icon = side === "bull" ? TrendingUp : TrendingDown;
                return (
                  <div key={side} className="rounded-card border border-[#DDE8E5] bg-white p-4 shadow-soft">
                    <div className="mb-2 flex items-center gap-1.5">
                      <Icon size={14} className="text-[#5F7A70]" />
                      <span className="text-[13px] font-black text-[#0D2318]">{label}</span>
                    </div>
                    <p className="mb-1 text-[11px] font-bold uppercase tracking-wide text-[#94A8A0]">1차 논거</p>
                    <p className="mb-3 text-[13px] leading-relaxed text-[#33493F]">{opening}</p>
                    <p className="mb-1 text-[11px] font-bold uppercase tracking-wide text-[#94A8A0]">반박</p>
                    <p className="text-[13px] leading-relaxed text-[#33493F]">{rebuttal}</p>
                  </div>
                );
              })}
            </div>

            <div className="rounded-card border-l-4 border-primary bg-white p-4 shadow-soft">
              <div className="mb-2 flex items-center gap-2">
                <span className="rounded-full bg-[#EEF4F1] px-2.5 py-1 text-[12px] font-black text-primary">{result.verdict}</span>
                <span className="text-[11px] font-bold text-[#94A8A0]">확신도 {result.confidence}</span>
              </div>
              <p className="mb-2 text-[13px] leading-relaxed text-[#33493F]">{result.rationale}</p>
              <p className="text-[13px] leading-relaxed text-[#5F7A70]">{result.watchpoints}</p>
            </div>
          </>
        )}

        {!result && !running && !error && (
          <p className="py-10 text-center text-[13px] font-semibold text-[#94A8A0]">
            종목·산업·매크로 키워드를 입력하고 분석 실행을 눌러보세요.
          </p>
        )}
      </div>

      <div className="w-64 shrink-0 overflow-y-auto rounded-card border border-[#DDE8E5] bg-white shadow-soft">
        <div className="border-b border-[#F0F7F4] px-3 py-2.5">
          <span className="text-[13px] font-black text-[#0D2318]">최근 분석 이력</span>
        </div>
        {historyLoading ? (
          <p className="py-8 text-center text-[12px] font-semibold text-[#94A8A0]">불러오는 중…</p>
        ) : history.length === 0 ? (
          <p className="px-3 py-8 text-center text-[12px] font-semibold text-[#94A8A0]">분석 이력이 없습니다.</p>
        ) : (
          history.map((h) => (
            <button
              key={h.id} type="button"
              onClick={() => { setResult({ ...h, dateFrom: h.dateFrom ?? "", dateTo: h.dateTo ?? "" }); setStage("done"); setError(""); setKeyword(h.keyword); }}
              className="flex w-full flex-col items-start gap-0.5 border-b border-[#F0F7F4] px-3 py-2.5 text-left transition hover:bg-[#F6FAF8]"
            >
              <span className="text-[12px] font-bold text-[#1C3329]">{h.keyword}</span>
              <span className="text-[11px] font-semibold text-[#94A8A0]">{h.verdict} · {h.createdAt.slice(0, 10)}</span>
            </button>
          ))
        )}
      </div>
    </div>
  );
}
