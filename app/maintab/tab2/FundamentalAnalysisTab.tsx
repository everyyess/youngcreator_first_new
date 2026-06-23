"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle, BookOpen, ExternalLink, Globe, Loader2, Send, Sparkles, X,
} from "lucide-react";
import { usePortfolioResult } from "../PortfolioResultComponents";
import type { PortfolioAsset } from "../CustomerContext";
import type { NaverReport } from "../../api/naver-reports/route";
import type { TelegramMessage, TelegramSearchResponse } from "../../api/telegram-search/route";
import StockSearchBox from "./StockSearchBox";

// ─── 서브탭 타입 ─────────────────────────────────────────────────────────────

type FundamentalTab = "naver" | "telegram";

// ─── 유틸 ────────────────────────────────────────────────────────────────────

function calcUpside(current: number | undefined, targetStr: string): string {
  if (!current || targetStr === "-") return "-";
  const target = parseFloat(targetStr.replace(/,/g, ""));
  if (isNaN(target) || current === 0) return "-";
  const pct = ((target - current) / current) * 100;
  return pct >= 0 ? `+${pct.toFixed(1)}%` : `${pct.toFixed(1)}%`;
}

function fmtPrice(str: string): string {
  const n = parseInt(str.replace(/,/g, ""), 10);
  return isNaN(n) ? str : n.toLocaleString("ko-KR");
}

// ─── Gemini 마크다운 렌더 ─────────────────────────────────────────────────────
// **헤더** → 섹션 제목, "- 항목" → 불릿, **굵게** → bold

function parseBold(line: string) {
  return line.split(/(\*\*[^*]+\*\*)/g).map((part, j) =>
    part.startsWith("**") && part.endsWith("**") ? (
      <strong key={j} className="text-slate-800 font-semibold">{part.slice(2, -2)}</strong>
    ) : (
      <span key={j}>{part}</span>
    )
  );
}

function renderSummary(text: string) {
  return text.split("\n").map((line, i) => {
    const trimmed = line.trim();

    // 빈 줄
    if (trimmed === "") return <div key={i} className="my-1.5" />;

    // 섹션 헤더: 줄 전체가 **...** (예: **📌 핵심 요약**)
    if (trimmed.startsWith("**") && trimmed.endsWith("**") && trimmed.length > 4) {
      const content = trimmed.slice(2, -2);
      return (
        <p key={i} className="mt-5 mb-1.5 text-[13px] font-bold text-slate-800 first:mt-0">
          {content}
        </p>
      );
    }

    // 불릿 포인트: "- " 로 시작
    if (trimmed.startsWith("- ")) {
      return (
        <div key={i} className="flex items-start gap-2 my-0.5 ml-1">
          <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-slate-400" />
          <p className="leading-relaxed text-slate-700">{parseBold(trimmed.slice(2))}</p>
        </div>
      );
    }

    // 일반 텍스트
    return (
      <p key={i} className="leading-relaxed my-0.5 text-slate-700">
        {parseBold(line)}
      </p>
    );
  });
}

// ─── 세로 구분선 ──────────────────────────────────────────────────────────────

function Sep() {
  return <span className="mx-2 h-3 w-px shrink-0 self-center bg-slate-200" />;
}

// ─── 중요도 배지 ──────────────────────────────────────────────────────────────

function ImportanceBadge({ label }: { label: string }) {
  if (label.includes("긴급")) {
    return (
      <span className="inline-flex items-center rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-bold text-red-700">
        ⚠️ 긴급
      </span>
    );
  }
  if (label.includes("중요")) {
    return (
      <span className="inline-flex items-center rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-bold text-blue-700">
        🔵 중요
      </span>
    );
  }
  return (
    <span className="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-500">
      🟡 일반
    </span>
  );
}

// ─── 텔레그램 상세 패널 ──────────────────────────────────────────────────────

type TelegramDetailState = { msg: TelegramMessage; summary: string };

function highlightStockName(text: string, stockName: string): React.ReactNode[] {
  if (!stockName) return [text];
  const parts = text.split(new RegExp(`(${stockName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "g"));
  return parts.map((part, i) =>
    part === stockName
      ? <mark key={i} style={{ background: "#facc15", color: "inherit", borderRadius: "2px", padding: "0 1px" }}>{part}</mark>
      : part
  );
}

function TelegramDetailPanel({ state, stockName, onClose }: { state: TelegramDetailState; stockName: string; onClose: () => void }) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);


  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="relative z-10 flex h-full w-full max-w-lg flex-col bg-white shadow-2xl">
        {/* 헤더 */}
        <div className="flex items-start justify-between border-b border-slate-200 px-5 py-4">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1.5">
              <ImportanceBadge label={state.msg.importance} />
              <span className="text-[12px] text-slate-400">{state.msg.date}</span>
            </div>
            <p className="text-[14px] font-bold text-slate-800 leading-snug">{state.msg.channel}</p>
          </div>
          <button onClick={onClose} className="ml-3 shrink-0 rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700">
            <X size={18} />
          </button>
        </div>

        {/* 본문 */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {/* AI 요약 박스 (Gemini 요약 있을 때만) */}
          {!!state.summary && (
            <div className="rounded-lg border border-[#2f2f9d]/20 bg-[#eef0ff] px-4 py-3">
              <div className="flex items-center gap-1.5 mb-1.5">
                <Sparkles size={12} className="text-[#2f2f9d]" />
                <span className="text-[10px] font-bold uppercase tracking-wide text-[#2f2f9d]">Gemini AI 요약</span>
              </div>
              <p className="text-[13px] leading-relaxed text-[#2f2f9d]/90">{state.summary}</p>
            </div>
          )}
          {/* 원문 */}
          <div>
            <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-slate-400">원문</p>
            <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-slate-700">{highlightStockName(state.msg.text, stockName)}</p>
          </div>
        </div>

        {/* 하단 버튼 */}
        <div className="border-t border-slate-200 px-5 py-3 flex gap-2">
          <a
            href={state.msg.link}
            target="_blank"
            rel="noopener noreferrer"
            className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-4 py-2.5 text-[13px] font-semibold text-slate-600 hover:bg-slate-100 transition"
          >
            <Send size={13} />
            텔레그램 원문 보기
          </a>
          <button
            onClick={onClose}
            className="rounded-lg bg-[#2f2f9d] px-4 py-2.5 text-[13px] font-semibold text-white hover:bg-[#26268a] transition"
          >
            닫기
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── 텔레그램 검색 패널 ───────────────────────────────────────────────────────

const PAGE_SIZE = 3;

function TelegramSearchPanel({
  stockName,
  ticker,
  isOverseas,
}: {
  stockName: string;
  ticker: string;
  isOverseas: boolean;
}) {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<TelegramSearchResponse | null>(null);
  const [summaries, setSummaries] = useState<Record<number, string>>({});
  const [loadingIdxs, setLoadingIdxs] = useState<Set<number>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [detailPanel, setDetailPanel] = useState<TelegramDetailState | null>(null);
  const prevKey = useRef("");

  useEffect(() => {
    if (!stockName) return;
    const key = `${stockName}|${ticker}`;
    if (key === prevKey.current) return;
    prevKey.current = key;

    setLoading(true);
    setResult(null);
    setSummaries({});
    setLoadingIdxs(new Set());
    setError(null);
    setVisibleCount(PAGE_SIZE);
    setDetailPanel(null);

    const params = new URLSearchParams({ keyword: stockName });
    if (isOverseas && ticker && ticker.toLowerCase() !== stockName.toLowerCase()) {
      params.set("keyword2", ticker);
    }

    fetch(`/api/telegram-search?${params}`)
      .then(async r => {
        const text = await r.text();
        if (!text) throw new Error("서버에서 빈 응답이 반환됐습니다.");
        return JSON.parse(text) as TelegramSearchResponse;
      })
      .then(async (data: TelegramSearchResponse) => {
        if (data.error) throw new Error(data.error);
        setResult(data);
        setSummaries({});

        // 텔레그램 검색과 분리된 새 요청으로 첫 PAGE_SIZE개 즉시 요약
        const firstIdxs = Array.from({ length: Math.min(PAGE_SIZE, data.messages.length) }, (_, i) => i);
        if (firstIdxs.length === 0) return;

        setLoadingIdxs(new Set(firstIdxs));
        try {
          const texts = firstIdxs.map(i => data.messages[i].text);
          const res = await fetch("/api/telegram-summarize", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ texts, keyword: stockName }),
          });
          const s = (await res.json()) as { summaries?: (string | null)[] };
          if (s.summaries) {
            const next: Record<number, string> = {};
            // null 이면 저장하지 않음 → 카드가 "원문을 클릭해 확인하세요." 표시
            firstIdxs.forEach((msgIdx, j) => {
              const v = s.summaries![j];
              if (v) next[msgIdx] = v;
            });
            setSummaries(next);
          }
        } catch { /* 실패 시 카드에서 원문 클릭 유도 */ }
        finally { setLoadingIdxs(new Set()); }
      })
      .catch(e => setError(e instanceof Error ? e.message : "검색 실패"))
      .finally(() => setLoading(false));
  }, [stockName, ticker, isOverseas]);

  // 더보기: 요약 먼저 → 그 다음 카드 노출
  const loadMore = async () => {
    if (!result) return;
    const nextCount = Math.min(visibleCount + PAGE_SIZE, result.messages.length);
    const newIdxs = Array.from({ length: nextCount - visibleCount }, (_, i) => visibleCount + i)
      .filter(i => !summaries[i] && !result.messages[i]?.summary);

    if (newIdxs.length === 0) {
      setVisibleCount(nextCount);
      return;
    }

    // 로딩 표시 먼저, 동시에 카드 노출
    setLoadingIdxs(new Set(newIdxs));
    setVisibleCount(nextCount);

    try {
      const texts = newIdxs.map(i => result.messages[i].text);
      const res = await fetch("/api/telegram-summarize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ texts, keyword: stockName }),
      });
      const data = (await res.json()) as { summaries?: (string | null)[] };
      if (data.summaries) {
        setSummaries(prev => {
          const next = { ...prev };
          newIdxs.forEach((msgIdx, j) => {
            const v = data.summaries![j];
            if (v) next[msgIdx] = v;
          });
          return next;
        });
      }
    } catch { /* 실패 시 원문 폴백 */ }
    finally { setLoadingIdxs(new Set()); }
  };

  const getSummary = (msg: TelegramMessage, i: number) =>
    summaries[i] || msg.summary || "";

  const visibleMessages = result?.messages.slice(0, visibleCount) ?? [];
  const hasMore = result ? visibleCount < result.messages.length : false;
  const isSummarizing = loadingIdxs.size > 0;

  return (
    <div className="space-y-3">
      {loading && (
        <div className="flex flex-col items-center justify-center gap-2 py-14 text-slate-400">
          <Loader2 size={22} className="animate-spin" />
          <p className="text-[13px]">
            전체 채널에서 &ldquo;{stockName}&rdquo;
            {isOverseas && ticker !== stockName ? ` · "${ticker}"` : ""} 수집 중…
          </p>
          <p className="text-[11px] text-slate-300">채널 수에 따라 최대 수분 소요될 수 있습니다</p>
        </div>
      )}

      {!loading && error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4">
          <div className="flex items-center gap-2 text-red-700">
            <AlertTriangle size={16} />
            <span className="text-[13px] font-semibold">검색 실패</span>
          </div>
          <p className="mt-1 text-[12px] text-red-600">{error}</p>
        </div>
      )}

      {!loading && result && (
        <>
          {/* 메타 + 연관어 */}
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
            <span className="text-[12px] text-slate-500">
              &ldquo;{result.keyword}&rdquo; · {result.collected_at}
            </span>
            {result.top_related.length > 0 && (
              <>
                <span className="text-slate-300">|</span>
                <span className="text-[11px] text-slate-400">연관어:</span>
                {result.top_related.map(r => (
                  <span key={r.word} className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[11px] font-medium text-slate-600">
                    {r.word} <span className="text-slate-300">{r.count}</span>
                  </span>
                ))}
              </>
            )}
          </div>

          {result.messages.length === 0 && (
            <div className="py-10 text-center text-slate-400">
              <Send size={24} className="mx-auto mb-2 opacity-30" />
              <p className="text-[14px]">{result.summary ?? "최근 3일 내 관련 메시지가 없습니다."}</p>
            </div>
          )}

          {/* 메시지 카드 목록 */}
          {visibleMessages.length > 0 && (
            <div className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white">
              {visibleMessages.map((msg, i) => {
                const isLoading = loadingIdxs.has(i);
                const summary = getSummary(msg, i);
                return (
                  <button
                    key={i}
                    type="button"
                    onClick={() => setDetailPanel({ msg, summary })}
                    className="group w-full flex flex-col gap-2 px-4 py-4 text-left transition hover:bg-slate-50 first:rounded-t-xl last:rounded-b-xl"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <ImportanceBadge label={msg.importance} />
                      <span className="text-[12px] font-semibold text-slate-700">{msg.channel}</span>
                      <span className="text-[11px] text-slate-400">{msg.date}</span>
                      <span className="ml-auto text-[11px] text-slate-300 group-hover:text-[#2f2f9d] transition">
                        상세 보기 →
                      </span>
                    </div>
                    {isLoading ? (
                      <div className="flex items-center gap-1.5 text-[12px] text-slate-400">
                        <Loader2 size={13} className="animate-spin" />
                        AI 요약 중…
                      </div>
                    ) : summary ? (
                      <p className="whitespace-pre-wrap text-[12px] leading-relaxed text-slate-600">{summary}</p>
                    ) : (
                      <p className="text-[12px] text-slate-400 italic">원문을 클릭해 확인하세요.</p>
                    )}
                  </button>
                );
              })}
            </div>
          )}

          {/* 더보기 버튼 */}
          {hasMore && (
            <button
              type="button"
              onClick={loadMore}
              disabled={isSummarizing}
              className="w-full rounded-lg border border-slate-200 bg-slate-50 py-2.5 text-[13px] font-semibold text-slate-600 hover:bg-slate-100 disabled:opacity-60 transition"
            >
              {isSummarizing ? (
                <span className="flex items-center justify-center gap-1.5">
                  <Loader2 size={13} className="animate-spin" /> AI 요약 중…
                </span>
              ) : (
                "더보기"
              )}
            </button>
          )}
        </>
      )}

      <p className="text-[11px] text-slate-400">
        📋 연결된 텔레그램 계정 전체 채널에서 수집 · Gemini AI 요약 — 이 정보는 투자 조언이 아닙니다.
      </p>

      {/* 상세 패널 */}
      {detailPanel && (
        <TelegramDetailPanel state={detailPanel} stockName={stockName} onClose={() => setDetailPanel(null)} />
      )}
    </div>
  );
}

// ─── Gemini 요약 슬라이드 패널 ───────────────────────────────────────────────

type SummaryState = {
  report: NaverReport;
  currentPrice: number | undefined;
  loading: boolean;
  summary: string | null;
  error: string | null;
};

function SummaryPanel({
  state,
  onClose,
}: {
  state: SummaryState;
  onClose: () => void;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const { report, currentPrice } = state;

  const upside = calcUpside(currentPrice, report.targetPrice);
  const upsidePositive = upside.startsWith("+");
  const hasTarget = report.targetPrice !== "-";
  const hasOpinion = report.investmentOpinion !== "-";

  // ESC 키로 닫기
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      {/* 배경 딤 */}
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />

      {/* 슬라이드 패널 */}
      <div
        ref={panelRef}
        className="relative z-10 flex h-full w-full max-w-lg flex-col bg-white shadow-2xl"
      >
        {/* 헤더 */}
        <div className="flex items-start justify-between border-b border-slate-200 px-5 py-4">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <Sparkles size={15} className="shrink-0 text-violet-500" />
              <span className="text-[11px] font-bold uppercase tracking-wide text-violet-500">
                Gemini AI 요약
              </span>
            </div>
            <p className="text-[14px] font-bold text-slate-800 leading-snug line-clamp-2">
              {report.title}
            </p>
            {/* 메타 정보 */}
            <div className="mt-1.5 flex flex-wrap items-center gap-x-1.5 text-[12px] text-slate-500">
              <span>{report.date}</span>
              {report.broker && (
                <>
                  <Sep />
                  <span>{report.broker}</span>
                </>
              )}
              {hasTarget && (
                <>
                  <Sep />
                  <span>목표가 {fmtPrice(report.targetPrice)}원</span>
                </>
              )}
              {upside !== "-" && (
                <>
                  <Sep />
                  <span className={`font-semibold ${upsidePositive ? "text-red-500" : "text-blue-500"}`}>
                    {upside}
                  </span>
                </>
              )}
              {hasOpinion && (
                <>
                  <Sep />
                  <span>{report.investmentOpinion}</span>
                </>
              )}
            </div>
          </div>
          <button
            onClick={onClose}
            className="ml-3 shrink-0 rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
          >
            <X size={18} />
          </button>
        </div>

        {/* 콘텐츠 */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {state.loading && (
            <div className="flex flex-col items-center justify-center gap-3 py-20 text-slate-400">
              <Loader2 size={28} className="animate-spin text-violet-400" />
              <p className="text-[13px]">PDF를 읽고 요약 중입니다…</p>
              <p className="text-[11px] text-slate-300">최대 30초 소요될 수 있습니다</p>
            </div>
          )}

          {!state.loading && state.error && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-4">
              <div className="flex items-center gap-2 text-red-700 font-semibold text-[13px] mb-1">
                <AlertTriangle size={15} /> 요약 실패
              </div>
              <p className="text-[12px] text-red-600">{state.error}</p>
            </div>
          )}

          {!state.loading && state.summary && (
            <div className="text-[14px] text-slate-700">
              {renderSummary(state.summary)}
            </div>
          )}
        </div>

        {/* 하단 버튼 */}
        <div className="border-t border-slate-200 px-5 py-3 flex gap-2">
          {report.pdfUrl && (
            <a
              href={report.pdfUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-4 py-2.5 text-[13px] font-semibold text-slate-600 hover:bg-slate-100 transition"
            >
              <ExternalLink size={13} />
              PDF 원문 보기
            </a>
          )}
          <button
            onClick={onClose}
            className="rounded-lg bg-[#2f2f9d] px-4 py-2.5 text-[13px] font-semibold text-white hover:bg-[#26268a] transition"
          >
            닫기
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── 리포트 카드 ─────────────────────────────────────────────────────────────

function ReportCard({
  report,
  currentPrice,
  index,
  onClick,
}: {
  report: NaverReport;
  currentPrice: number | undefined;
  index: number;
  onClick: () => void;
}) {
  const upside = calcUpside(currentPrice, report.targetPrice);
  const upsidePositive = upside.startsWith("+");
  const hasTarget = report.targetPrice !== "-";
  const hasOpinion = report.investmentOpinion !== "-";

  return (
    <button
      type="button"
      onClick={onClick}
      className="group w-full flex items-start gap-3 rounded-lg border border-slate-200 bg-white px-4 py-3.5 text-left transition hover:border-slate-300 hover:bg-slate-50 hover:shadow-sm"
    >
      {/* 순번 */}
      <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-slate-100 text-[10px] font-bold text-slate-500 group-hover:bg-[#2f2f9d] group-hover:text-white transition">
        {index + 1}
      </span>

      {/* 내용 */}
      <div className="flex-1 min-w-0">
        <p className="text-[13px] font-semibold text-slate-800 group-hover:text-[#2f2f9d] leading-snug truncate">
          {report.title}
        </p>

        {/* 메타 줄: 고정 너비 + 가운데 정렬 */}
        <div className="mt-1.5 flex items-center text-[12px] text-slate-500 overflow-hidden">
          <span className="w-[64px] shrink-0 flex justify-center tabular-nums">{report.date}</span>
          <Sep />
          <span className="w-[90px] shrink-0 flex justify-center truncate">{report.broker}</span>
          <Sep />
          <span className="w-[135px] shrink-0 flex justify-center tabular-nums">
            {hasTarget ? `목표가 ${fmtPrice(report.targetPrice)}원` : "–"}
          </span>
          <Sep />
          <span
            className={`w-[52px] shrink-0 flex justify-center font-semibold tabular-nums ${
              upside !== "-"
                ? upsidePositive ? "text-red-500" : "text-blue-500"
                : "text-slate-300"
            }`}
          >
            {upside !== "-" ? upside : "–"}
          </span>
          <Sep />
          <span className="w-[86px] shrink-0 flex justify-center">
            {hasOpinion ? report.investmentOpinion : <span className="text-slate-300">–</span>}
          </span>
        </div>
      </div>

      {/* AI 요약 힌트 */}
      <div className="mt-1 shrink-0 flex items-center gap-1 text-[10px] font-medium text-slate-300 group-hover:text-violet-400 transition">
        <Sparkles size={12} />
        <span>AI 요약</span>
      </div>
    </button>
  );
}

// ─── 유틸 ────────────────────────────────────────────────────────────────────

function isDomestic(ticker: string) {
  return /\.(KS|KQ)$/i.test(ticker);
}

// ─── 메인 컴포넌트 ────────────────────────────────────────────────────────────

export default function FundamentalAnalysisTab() {
  const portfolioData = usePortfolioResult();

  // 국내 + 해외 주식 모두 포함 (ticker 있는 것)
  const allStocks = useMemo<PortfolioAsset[]>(() => {
    if (!portfolioData) return [];
    const seen = new Set<string>();
    return (portfolioData.enrichedAssets ?? []).filter((a) => {
      if (!a.ticker || a.ticker.trim() === "") return false;
      if (!(a.asset_class === "국내주식" || a.asset_class === "해외주식" || (a.asset_class ?? "").includes("주식"))) return false;
      if (seen.has(a.ticker)) return false;
      seen.add(a.ticker);
      return true;
    });
  }, [portfolioData]);

  const domesticList  = useMemo(() => allStocks.filter(a =>  isDomestic(a.ticker!)), [allStocks]);
  // 국내 먼저, 해외 나중 정렬
  const sortedStocks = useMemo(() => [
    ...allStocks.filter(a =>  isDomestic(a.ticker!)),
    ...allStocks.filter(a => !isDomestic(a.ticker!)),
  ], [allStocks]);

  // 한국어 종목명 맵 { ticker → koreanName }
  const [koreanNames, setKoreanNames] = useState<Record<string, string>>({});
  const fetchedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    for (const s of allStocks) {
      if (!s.ticker || fetchedRef.current.has(s.ticker)) continue;
      fetchedRef.current.add(s.ticker);
      fetch(`/api/korean-name?ticker=${encodeURIComponent(s.ticker)}`)
        .then(r => r.json())
        .then((d: { name?: string }) => {
          if (d.name && s.ticker)
            setKoreanNames(prev => ({ ...prev, [s.ticker!]: d.name! }));
        })
        .catch(() => {});
    }
  }, [allStocks]);

  const kName = (a: PortfolioAsset) => koreanNames[a.ticker!] || a.name;

  const [activeTab, setActiveTab] = useState<FundamentalTab>("naver");
  const [selectedTicker, setSelectedTicker] = useState("");
  const [selectedName, setSelectedName]     = useState("");  // 원본
  const [selectedCurrentPrice, setSelectedCurrentPrice] = useState<number | undefined>();
  const [loading, setLoading]   = useState(false);
  const [reports, setReports]   = useState<NaverReport[]>([]);
  const [error, setError]       = useState<string | null>(null);
  const [summaryState, setSummaryState] = useState<SummaryState | null>(null);

  // 표시용 이름 (한국어 우선)
  const resolvedName = koreanNames[selectedTicker] || selectedName;

  const openSummary = (report: NaverReport) => {
    setSummaryState({ report, currentPrice: selectedCurrentPrice, loading: true, summary: null, error: null });
    if (!report.pdfUrl) {
      setSummaryState(prev => prev ? { ...prev, loading: false, error: "PDF URL이 없어 요약할 수 없습니다." } : null);
      return;
    }
    const params = new URLSearchParams({ pdfUrl: report.pdfUrl, title: report.title });
    fetch(`/api/naver-reports/summarize?${params}`)
      .then(r => r.json() as Promise<{ summary?: string; error?: string }>)
      .then(d => setSummaryState(prev => prev ? { ...prev, loading: false, summary: d.summary ?? null, error: d.error ?? null } : null))
      .catch(e => setSummaryState(prev => prev ? { ...prev, loading: false, error: e instanceof Error ? e.message : "요약 실패" } : null));
  };

  // 첫 종목 자동 선택 (국내 우선)
  useEffect(() => {
    if (allStocks.length > 0 && !selectedTicker) {
      const first = domesticList[0] ?? allStocks[0];
      setSelectedTicker(first.ticker!);
      setSelectedName(first.name);
      setSelectedCurrentPrice(first.current_price);
    }
  }, [allStocks, domesticList, selectedTicker]); // eslint-disable-line react-hooks/exhaustive-deps

  // 네이버 리포트 로드 (국내 종목만)
  useEffect(() => {
    if (!selectedTicker || !isDomestic(selectedTicker)) {
      setReports([]); setError(null); setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true); setReports([]); setError(null);
    fetch(`/api/naver-reports?ticker=${encodeURIComponent(selectedTicker)}&name=${encodeURIComponent(resolvedName)}`)
      .then(r => r.json())
      .then((data: { reports?: NaverReport[]; error?: string }) => {
        if (cancelled) return;
        if (data.error) throw new Error(data.error);
        setReports(data.reports ?? []);
      })
      .catch((e: Error) => { if (!cancelled) setError(e.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  // resolvedName이 바뀔 때마다 재실행되지 않도록 ticker만 의존
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedTicker]);

  const selectAsset = (a: PortfolioAsset) => {
    if (a.ticker === selectedTicker) return;
    setSelectedTicker(a.ticker!);
    setSelectedName(a.name);
    setSelectedCurrentPrice(a.current_price);
  };

  const selectedIsDomestic = isDomestic(selectedTicker);
  const naverCode = selectedTicker.replace(/\.(KS|KQ)$/i, "");

  // ── 종목 버튼 렌더 헬퍼
  const StockButton = ({ a }: { a: PortfolioAsset }) => (
    <button
      key={a.ticker}
      onClick={() => selectAsset(a)}
      className={`rounded-lg border px-3.5 py-2 text-[13px] font-semibold transition ${
        selectedTicker === a.ticker
          ? "border-[#2f2f9d] bg-[#2f2f9d] text-white shadow-sm"
          : "border-slate-200 bg-slate-50 text-slate-600 hover:border-slate-300 hover:bg-slate-100"
      }`}
    >
      {kName(a)}
      <span className={`ml-1.5 text-[10px] font-normal ${selectedTicker === a.ticker ? "text-blue-200" : "text-slate-400"}`}>
        {a.ticker}
      </span>
    </button>
  );

  return (
    <div className="space-y-4">
      {/* 종목 선택 */}
      {sortedStocks.length > 0 && (
        <div className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
            분석 종목 선택
          </div>
          <div className="flex flex-wrap gap-2">
            {sortedStocks.map(a => <StockButton key={a.ticker} a={a} />)}
          </div>
        </div>
      )}

      {/* 비보유 종목 검색 */}
      <StockSearchBox
        market="all"
        onSelect={(item) => {
          setSelectedTicker(item.ticker);
          setSelectedName(item.name);
          setSelectedCurrentPrice(undefined);
        }}
      />

      {/* 메인 패널 */}
      {selectedTicker && (
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          {/* 헤더 */}
          <div className="mb-4 flex items-center justify-between">
            <div>
              <p className="text-[15px] font-bold text-slate-800">{resolvedName}</p>
              <p className="text-[12px] text-slate-400">
                {activeTab === "naver" ? "네이버 증권 리서치 리포트 · 최신 순 · 클릭하면 AI 요약" : "텔레그램 채널 · 국내·해외 증시 정보"}
                {` · 종목코드 ${selectedTicker}`}
              </p>
            </div>
            {activeTab === "naver" && selectedIsDomestic && (
              <a
                href={`https://finance.naver.com/research/company_list.naver?search_type=1&stock_code=${naverCode}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 rounded-md border border-slate-200 px-2.5 py-1.5 text-[12px] text-slate-500 hover:bg-slate-50 transition"
              >
                <ExternalLink size={13} />
                네이버 증권
              </a>
            )}
          </div>

          {/* 서브탭 */}
          <div className="mb-4 flex gap-1 overflow-x-auto rounded-lg border border-slate-200 bg-slate-50 p-1">
            <button
              type="button"
              onClick={() => setActiveTab("naver")}
              className={`relative shrink-0 flex items-center gap-1.5 rounded-md px-4 py-2 text-[13px] font-semibold transition ${
                activeTab === "naver" ? "bg-white text-[#2f2f9d] shadow-sm" : "text-slate-500 hover:text-slate-700"
              }`}
            >
              <BookOpen size={13} />
              네이버 리포트
              {reports.length > 0 && (
                <span className={`ml-1 rounded-full px-1.5 py-0.5 text-[10px] font-bold ${activeTab === "naver" ? "bg-[#eef0ff] text-[#2f2f9d]" : "bg-slate-200 text-slate-500"}`}>
                  {reports.length}
                </span>
              )}
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("telegram")}
              className={`relative shrink-0 flex items-center gap-1.5 rounded-md px-4 py-2 text-[13px] font-semibold transition ${
                activeTab === "telegram" ? "bg-white text-[#2f2f9d] shadow-sm" : "text-slate-500 hover:text-slate-700"
              }`}
            >
              <Send size={13} />
              텔레그램
            </button>
          </div>

          {/* ── 네이버 리포트 콘텐츠 ── */}
          {activeTab === "naver" && (
            <>
              {/* 해외 종목 선택 시 안내 */}
              {!selectedIsDomestic ? (
                <div className="flex flex-col items-center justify-center py-14 text-center">
                  <Globe size={32} className="mb-3 text-slate-300" />
                  <p className="text-[15px] font-semibold text-slate-600">국내 종목 전용 서비스</p>
                  <p className="mt-2 text-[13px] text-slate-400">
                    네이버 리포트는 KOSPI·KOSDAQ 국내 상장 종목만 지원합니다.<br />
                    해외 종목 정보는 <span className="font-semibold text-[#2f2f9d]">텔레그램</span> 탭을 이용해 주세요.
                  </p>
                  <button
                    type="button"
                    onClick={() => setActiveTab("telegram")}
                    className="mt-4 flex items-center gap-1.5 rounded-lg bg-[#2f2f9d] px-5 py-2.5 text-[13px] font-semibold text-white hover:bg-[#26268a] transition"
                  >
                    <Send size={14} />
                    텔레그램으로 이동
                  </button>
                </div>
              ) : (
                <>
                  {loading && (
                    <div className="flex items-center justify-center gap-2 py-16 text-slate-400">
                      <Loader2 size={22} className="animate-spin" />
                      <span className="text-[14px]">리포트 불러오는 중… (10~20초 소요)</span>
                    </div>
                  )}
                  {!loading && error && (
                    <div className="rounded-lg border border-red-200 bg-red-50 p-4">
                      <div className="flex items-center gap-2 text-red-700">
                        <AlertTriangle size={18} />
                        <span className="font-semibold">데이터 로드 실패</span>
                      </div>
                      <p className="mt-1 text-[13px] text-red-600">{error}</p>
                    </div>
                  )}
                  {!loading && !error && reports.length === 0 && (
                    <div className="py-10 text-center text-slate-400">
                      <BookOpen size={28} className="mx-auto mb-2 opacity-40" />
                      <p className="text-[14px]">최근 리포트가 없습니다.</p>
                    </div>
                  )}
                  {!loading && !error && reports.length > 0 && (
                    <div className="space-y-2">
                      {reports.map((report, i) => (
                        <ReportCard
                          key={i}
                          report={report}
                          currentPrice={selectedCurrentPrice}
                          index={i}
                          onClick={() => openSummary(report)}
                        />
                      ))}
                    </div>
                  )}
                  <p className="mt-3 text-[11px] text-slate-400">
                    📋 리포트를 클릭하면 Gemini AI가 PDF를 요약합니다. — 이 정보는 투자 조언이 아닙니다.
                  </p>
                </>
              )}
            </>
          )}

          {/* ── 텔레그램 콘텐츠 ── */}
          {activeTab === "telegram" && (
            <TelegramSearchPanel
              stockName={resolvedName}
              ticker={selectedTicker}
              isOverseas={!selectedIsDomestic}
            />
          )}
        </div>
      )}

      {/* Gemini 요약 패널 */}
      {summaryState && (
        <SummaryPanel state={summaryState} onClose={() => setSummaryState(null)} />
      )}
    </div>
  );
}
