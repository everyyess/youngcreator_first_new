"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Bell, ExternalLink, Loader2, RefreshCw, Sparkles, X } from "lucide-react";
import { useCustomerContext } from "../CustomerContext";
import type { DartDisclosure, DartDisclosuresResponse } from "../../api/dart-disclosures/route";
import StockSearchBox from "./StockSearchBox";

// ── 타입 ─────────────────────────────────────────────────────────────────────

type DartTab = "contracts" | "stakes" | "insiders" | "earnings" | "agreements";
type Market = "domestic" | "overseas";

type StockEntry = { displayName: string; ticker: string; searchKey: string };

type TabMeta = { id: DartTab; label: string; desc: string; emptyMsg: string };

// ── 탭 정의 ───────────────────────────────────────────────────────────────────

const DART_TABS: TabMeta[] = [
  {
    id: "earnings",
    label: "실적 공시",
    desc: "📋 잠정실적·분기보고서·반기보고서·사업보고서 — 최근 5년간 실적 및 정기보고서를 확인합니다.",
    emptyMsg: "최근 5년간 실적·정기보고 공시가 없습니다.",
  },
  {
    id: "stakes",
    label: "지분 공시",
    desc: "📋 주식등의대량보유상황보고서 — 5% 이상 보유 기관·투자자의 지분 변동을 확인합니다.",
    emptyMsg: "최근 2년간 대량보유 지분 공시가 없습니다.",
  },
  {
    id: "insiders",
    label: "내부자 거래 공시",
    desc: "📋 임원·주요주주 특정증권 소유상황 — 경영진·대주주의 자사주 매매 동향을 파악합니다.",
    emptyMsg: "최근 2년간 임원·주요주주 소유상황 공시가 없습니다.",
  },
  {
    id: "agreements",
    label: "중요 계약 체결",
    desc: "📋 회사채·대출 실행, M&A, MOU, 법적 합의, 라이선스 등 주요 계약 공시를 확인합니다.",
    emptyMsg: "최근 2년간 중요 계약(수주 외) 공시가 없습니다.",
  },
  {
    id: "contracts",
    label: "수주 공시",
    desc: "📋 단일판매·공급계약체결 — 중소·중견기업의 수주 동향 파악에 활용하세요.",
    emptyMsg: "최근 2년간 수주(단일판매·공급계약) 공시가 없습니다.",
  },
];

const SEC_TABS: TabMeta[] = [
  {
    id: "earnings",
    label: "실적 공시",
    desc: "📋 10-K (Annual) · 10-Q (Quarterly) — SEC에 제출된 연간·분기보고서를 확인합니다.",
    emptyMsg: "최근 5년간 10-K/10-Q 보고서가 없습니다.",
  },
  {
    id: "stakes",
    label: "지분 공시",
    desc: "📋 SC 13G / SC 13D — 5% 이상 보유 기관의 대량보유 공시를 확인합니다.",
    emptyMsg: "최근 2년간 SC 13G/13D 공시가 없습니다.",
  },
  {
    id: "insiders",
    label: "내부자 거래 공시",
    desc: "📋 Form 4 — 임원·주요주주의 자사주 매매 내역을 확인합니다.",
    emptyMsg: "최근 2년간 Form 4 내부자 거래 공시가 없습니다.",
  },
  {
    id: "agreements",
    label: "중요 계약 체결",
    desc: "📋 8-K Item 1.01 — 회사채·대출 실행, 법적 합의, 부동산 임대, 라이선스, M&A·MOU 등 주요 계약 공시를 확인합니다.",
    emptyMsg: "최근 2년간 중요 계약(수주 외) 공시가 없습니다.",
  },
  {
    id: "contracts",
    label: "수주 공시",
    desc: "📋 8-K Item 1.01 — 판매·공급계약 등 실질적인 수주 관련 공시를 확인합니다.",
    emptyMsg: "최근 2년간 수주·공급계약 공시가 없습니다.",
  },
];

// ── 유틸 ─────────────────────────────────────────────────────────────────────

function ago3dStr(): string {
  const d = new Date();
  d.setDate(d.getDate() - 3);
  return [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, "0"),
    String(d.getDate()).padStart(2, "0"),
  ].join(".");
}

// ── Gemini 요약 패널 ──────────────────────────────────────────────────────────

type SummaryState = {
  item: DartDisclosure;
  loading: boolean;
  summary: string | null;
  error: string | null;
};

function renderSummary(text: string) {
  return text.split("\n").map((line, i) => {
    const trimmed = line.trim();
    const isSectionHeader = /^\*\*[^*]+\*\*$/.test(trimmed);
    const isEmpty = trimmed === "";
    const parts = line.split(/(\*\*[^*]+\*\*)/g);
    return (
      <p
        key={i}
        className={`leading-relaxed ${
          isEmpty
            ? "h-3"
            : isSectionHeader
            ? "mt-5 mb-1 first:mt-0"
            : "my-0.5"
        }`}
      >
        {parts.map((part, j) =>
          part.startsWith("**") && part.endsWith("**") ? (
            <strong key={j} className="text-slate-800">{part.slice(2, -2)}</strong>
          ) : (
            <span key={j}>{part}</span>
          )
        )}
      </p>
    );
  });
}

function SummaryPanel({
  state,
  onClose,
  viewerLabel = "DART 원문 보기",
}: {
  state: SummaryState;
  onClose: () => void;
  viewerLabel?: string;
}) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div
        ref={panelRef}
        className="relative z-10 flex h-full w-full max-w-lg flex-col bg-white shadow-2xl"
      >
        <div className="flex items-start justify-between border-b border-slate-200 px-5 py-4">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <Sparkles size={15} className="shrink-0 text-violet-500" />
              <span className="text-[11px] font-bold uppercase tracking-wide text-violet-500">
                Gemini AI 요약
              </span>
            </div>
            <p className="text-[14px] font-bold text-slate-800 leading-snug line-clamp-2">
              {state.item.title}
            </p>
            <div className="mt-1 flex flex-wrap gap-x-2 text-[11px] text-slate-400">
              {state.item.date && <span>{state.item.date}</span>}
              {state.item.company && <span className="font-medium text-slate-500">{state.item.company}</span>}
              {state.item.reporter && <span>{state.item.reporter}</span>}
            </div>
          </div>
          <button
            onClick={onClose}
            className="ml-3 shrink-0 rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
          >
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {state.loading && (
            <div className="flex flex-col items-center justify-center gap-3 py-20 text-slate-400">
              <Loader2 size={28} className="animate-spin text-violet-400" />
              <p className="text-[13px]">공시 원문을 읽고 요약 중입니다…</p>
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
            <div className="text-[15px] text-slate-700">
              {renderSummary(state.summary)}
            </div>
          )}
        </div>

        <div className="border-t border-slate-200 px-5 py-3 flex gap-2">
          <a
            href={state.item.url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-4 py-2.5 text-[13px] font-semibold text-slate-600 hover:bg-slate-100 transition"
          >
            <ExternalLink size={13} />
            {viewerLabel}
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

// ── 공시 목록 컴포넌트 ────────────────────────────────────────────────────────

function DisclosureList({
  items,
  emptyMsg,
  onItemClick,
  hideCompany = false,
}: {
  items: DartDisclosure[];
  emptyMsg: string;
  onItemClick: (item: DartDisclosure) => void;
  hideCompany?: boolean;
}) {
  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-14 text-center">
        <div className="mb-2 text-3xl">📭</div>
        <p className="text-[14px] font-semibold text-slate-600">공시 없음</p>
        <p className="mt-1 text-[12px] text-slate-400">{emptyMsg}</p>
      </div>
    );
  }

  return (
    <div className="divide-y divide-slate-100">
      {items.map((d, i) => (
        <button
          key={d.rcpNo}
          type="button"
          onClick={() => onItemClick(d)}
          className="group w-full flex items-start gap-3 px-1 py-3.5 text-left transition hover:bg-slate-50 rounded-lg"
        >
          <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-slate-100 text-[10px] font-bold text-slate-500 group-hover:bg-[#2f2f9d] group-hover:text-white transition">
            {i + 1}
          </span>
          <div className="flex-1 min-w-0">
            <p className="text-[13px] font-semibold text-slate-800 group-hover:text-[#2f2f9d] leading-snug truncate">
              {d.title || "공시 제목 없음"}
            </p>
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-slate-400">
              {d.date && <span>{d.date}</span>}
              {!hideCompany && d.company && <span className="font-medium text-slate-500">{d.company}</span>}
              {d.reporter && (
                <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500">
                  {d.reporter}
                </span>
              )}
            </div>
          </div>
          <div className="mt-1 shrink-0 flex items-center gap-1 text-[10px] font-medium text-slate-300 group-hover:text-violet-400 transition">
            <Sparkles size={12} />
            <span>AI 요약</span>
          </div>
        </button>
      ))}
    </div>
  );
}

// ── 메인 컴포넌트 ─────────────────────────────────────────────────────────────

export default function DartAnalysisTab() {
  const { portfolioAssets } = useCustomerContext();

  // 국내주식 (DART, SK하이닉스 최우선)
  const domesticStocks = useMemo<StockEntry[]>(() => {
    const seen = new Set<string>();
    return portfolioAssets
      .filter((a) => {
        if (a.productType !== "국내주식" && a.asset_class !== "국내주식") return false;
        if (!a.name) return false;
        const key = a.ticker ?? a.name;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .map((a) => {
        const numericTicker = (a.ticker ?? "").match(/^(\d{6})/)?.[1] ?? "";
        return {
          displayName: a.name,
          ticker: a.ticker ?? "",
          searchKey: numericTicker || a.name,
        };
      })
      .sort((a, b) => {
        const aH = /^000660/.test(a.searchKey), bH = /^000660/.test(b.searchKey);
        if (aH && !bH) return -1;
        if (!aH && bH) return 1;
        return 0;
      });
  }, [portfolioAssets]);

  // 해외주식 (SEC EDGAR — ticker 필수, 미국 증시 상장 종목)
  const overseasStocks = useMemo<StockEntry[]>(() => {
    const seen = new Set<string>();
    return portfolioAssets
      .filter((a) => {
        if (a.productType !== "해외주식" && a.asset_class !== "해외주식") return false;
        if (!a.ticker) return false;
        const base = a.ticker.split(".")[0].toUpperCase();
        if (!base || seen.has(base)) return false;
        seen.add(base);
        return true;
      })
      .map((a) => ({
        displayName: a.name,
        ticker: a.ticker ?? "",
        searchKey: a.ticker!.split(".")[0].toUpperCase(),
      }));
  }, [portfolioAssets]);

  // 시장 선택 (국내 우선, 국내 없으면 해외 자동 선택)
  const [market, setMarket] = useState<Market>("domestic");

  useEffect(() => {
    if (domesticStocks.length === 0 && overseasStocks.length > 0) {
      setMarket("overseas");
    }
  }, [domesticStocks, overseasStocks]);

  const activeStocks = market === "domestic" ? domesticStocks : overseasStocks;
  const activeTabs = market === "domestic" ? DART_TABS : SEC_TABS;

  // 한국어 종목명 캐시 (국내주식 전용)
  const [koreanNames, setKoreanNames] = useState<Record<string, string>>({});
  const fetchedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    for (const s of domesticStocks) {
      if (!s.ticker || fetchedRef.current.has(s.ticker)) continue;
      fetchedRef.current.add(s.ticker);
      fetch(`/api/korean-name?ticker=${encodeURIComponent(s.ticker)}`)
        .then(r => r.json())
        .then((d: { name?: string }) => {
          if (d.name && s.ticker)
            setKoreanNames(prev => ({ ...prev, [s.ticker]: d.name! }));
        })
        .catch(() => {});
    }
  }, [domesticStocks]);

  const [selectedStock, setSelectedStock] = useState<StockEntry | null>(null);
  const [activeTab, setActiveTab] = useState<DartTab>("earnings");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<DartDisclosuresResponse | null>(null);
  const [summaryState, setSummaryState] = useState<SummaryState | null>(null);

  // 시장 전환 시 상태 초기화
  const handleMarketChange = (m: Market) => {
    if (m === market) return;
    setMarket(m);
    setSelectedStock(null);
    setData(null);
    setError(null);
    setActiveTab("earnings");
  };

  // 첫 번째 종목 자동 선택
  useEffect(() => {
    if (activeStocks.length > 0 && !selectedStock) {
      setSelectedStock(activeStocks[0]);
    }
  }, [activeStocks, selectedStock]);

  // AI 요약 (DART / SEC 자동 라우팅)
  const openSummary = (item: DartDisclosure) => {
    // 서버에서 미리 주입된 요약이 있으면 API 호출 없이 즉시 표시
    if (item.preloadedSummary) {
      setSummaryState({ item, loading: false, summary: item.preloadedSummary, error: null });
      return;
    }
    const endpoint = market === "domestic" ? "/api/dart-summary" : "/api/sec-summary";
    setSummaryState({ item, loading: true, summary: null, error: null });
    fetch(`${endpoint}?rcpNo=${encodeURIComponent(item.rcpNo)}&title=${encodeURIComponent(item.title)}`)
      .then(r => r.json() as Promise<{ summary?: string; error?: string }>)
      .then(d => {
        setSummaryState(prev => prev ? {
          ...prev,
          loading: false,
          summary: d.summary ?? null,
          error: d.error ?? null,
        } : null);
      })
      .catch(e => {
        setSummaryState(prev => prev ? {
          ...prev,
          loading: false,
          error: e instanceof Error ? e.message : "요약 실패",
        } : null);
      });
  };

  // 데이터 로드 (새로고침 버튼)
  const loadData = (stock: StockEntry, refresh = false) => {
    if (!stock) return;
    setLoading(true);
    setError(null);
    setData(null);

    const endpoint = market === "domestic" ? "/api/dart-disclosures" : "/api/sec-filings";
    const params = new URLSearchParams({ ticker: stock.searchKey, company: stock.displayName });
    if (refresh) params.set("refresh", "1");

    fetch(`${endpoint}?${params}`)
      .then((r) => {
        if (!r.ok) return r.json().then((j: { error?: string }) => { throw new Error(j.error ?? `HTTP ${r.status}`); });
        return r.json() as Promise<DartDisclosuresResponse>;
      })
      .then((d) => { setData(d); })
      .catch((e: Error) => { setError(e.message); })
      .finally(() => { setLoading(false); });
  };

  // 종목·시장 변경 시 자동 로드
  useEffect(() => {
    if (!selectedStock) return;
    let cancelled = false;

    setLoading(true);
    setError(null);
    setData(null);

    const endpoint = market === "domestic" ? "/api/dart-disclosures" : "/api/sec-filings";
    const params = new URLSearchParams({ ticker: selectedStock.searchKey, company: selectedStock.displayName });

    fetch(`${endpoint}?${params}`)
      .then((r) => {
        if (!r.ok) return r.json().then((j: { error?: string }) => { throw new Error(j.error ?? `HTTP ${r.status}`); });
        return r.json() as Promise<DartDisclosuresResponse>;
      })
      .then((d) => { if (!cancelled) setData(d); })
      .catch((e: Error) => { if (!cancelled) setError(e.message); })
      .finally(() => { if (!cancelled) setLoading(false); });

    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedStock?.searchKey, market]);

  // 탭 메타 (최근 3일 공시 여부 포함)
  const sortedTabMeta = useMemo(() => {
    const threshold = ago3dStr();
    return activeTabs.map((t) => {
      const items = data ? data[t.id] : [];
      const hasRecent = items.some((item) => item.date >= threshold);
      return { ...t, hasRecent };
    });
  }, [data, activeTabs]);

  const currentItems = data ? data[activeTab] : [];
  const activeMeta = sortedTabMeta.find((t) => t.id === activeTab) ?? activeTabs[0];
  const isOverseas = market === "overseas";
  const sourceLabel = isOverseas ? "SEC EDGAR" : "DART 전자공시";

  return (
    <div className="space-y-4">
      {/* ── 시장 선택 (국내·해외 모두 있을 때만 표시) ──────────────────────── */}
      {domesticStocks.length > 0 && overseasStocks.length > 0 && (
        <div className="flex gap-1 rounded-lg border border-slate-200 bg-slate-50 p-1">
          <button
            onClick={() => handleMarketChange("domestic")}
            className={`flex-1 rounded-md py-2 text-[13px] font-semibold transition ${
              market === "domestic"
                ? "bg-white text-[#2f2f9d] shadow-sm"
                : "text-slate-500 hover:text-slate-700"
            }`}
          >
            국내주식 · DART
          </button>
          <button
            onClick={() => handleMarketChange("overseas")}
            className={`flex-1 rounded-md py-2 text-[13px] font-semibold transition ${
              market === "overseas"
                ? "bg-white text-[#2f2f9d] shadow-sm"
                : "text-slate-500 hover:text-slate-700"
            }`}
          >
            해외주식 · SEC
          </button>
        </div>
      )}

      {/* ── 종목 선택 바 ──────────────────────────────────────────────────── */}
      {activeStocks.length > 0 && (
        <div className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
            분석 종목 선택
          </div>
          <div className="flex flex-wrap gap-2">
            {activeStocks.map((s) => {
              const isSelected = selectedStock?.searchKey === s.searchKey;
              const label = isOverseas
                ? s.displayName
                : (koreanNames[s.ticker] || s.displayName);
              return (
                <button
                  key={s.searchKey}
                  onClick={() => {
                    if (isSelected) return;
                    setSelectedStock(s);
                    setActiveTab("earnings");
                  }}
                  className={`rounded-lg border px-3.5 py-2 text-[13px] font-semibold transition ${
                    isSelected
                      ? "border-[#2f2f9d] bg-[#2f2f9d] text-white shadow-sm"
                      : "border-slate-200 bg-slate-50 text-slate-600 hover:border-slate-300 hover:bg-slate-100"
                  }`}
                >
                  {label}
                  {s.ticker && (
                    <span className={`ml-1.5 text-[10px] font-normal ${isSelected ? "text-blue-200" : "text-slate-400"}`}>
                      {s.ticker}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* ── 비보유 종목 검색 ───────────────────────────────────────────────── */}
      <StockSearchBox
        market={market}
        onSelect={(item) => {
          setSelectedStock({
            displayName: item.name,
            ticker: item.ticker,
            searchKey: item.code,
          });
          setActiveTab("earnings");
        }}
      />

      {/* ── 공시 패널 ─────────────────────────────────────────────────────── */}
      {selectedStock && (
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          {/* 헤더 */}
          <div className="mb-4 flex items-center justify-between">
            <div>
              <p className="text-[15px] font-bold text-slate-800">
                {data?.company ?? (isOverseas ? selectedStock.displayName : (koreanNames[selectedStock.ticker] ?? selectedStock.displayName))}
              </p>
              <p className="text-[12px] text-slate-400">
                {sourceLabel} · 최신순 10건
                {selectedStock.ticker && ` · ${isOverseas ? "Ticker" : "종목코드"} ${selectedStock.ticker}`}
              </p>
            </div>
            <button
              onClick={() => loadData(selectedStock, true)}
              disabled={loading}
              className="flex items-center gap-1.5 rounded-md border border-slate-200 px-2.5 py-1.5 text-[12px] text-slate-500 hover:bg-slate-50 disabled:opacity-50"
            >
              <RefreshCw size={13} className={loading ? "animate-spin" : ""} />
              새로고침
            </button>
          </div>

          {/* 서브탭 */}
          <div className="mb-4 flex gap-1 overflow-x-auto rounded-lg border border-slate-200 bg-slate-50 p-1">
            {sortedTabMeta.map((t) => (
              <button
                key={t.id}
                onClick={() => setActiveTab(t.id)}
                className={`relative shrink-0 rounded-md px-4 py-2 text-[13px] font-semibold transition ${
                  activeTab === t.id
                    ? "bg-white text-[#2f2f9d] shadow-sm"
                    : "text-slate-500 hover:text-slate-700"
                }`}
              >
                {t.hasRecent && (
                  <span className="absolute right-1 top-1 h-2 w-2 rounded-full bg-red-500" />
                )}
                <span>{t.label}</span>
                {data && (
                  <span
                    className={`ml-1.5 rounded-full px-1.5 py-0.5 text-[10px] font-bold ${
                      activeTab === t.id
                        ? "bg-[#eef0ff] text-[#2f2f9d]"
                        : "bg-slate-200 text-slate-500"
                    }`}
                  >
                    {data[t.id].length}
                  </span>
                )}
              </button>
            ))}
          </div>

          {/* 탭 설명 */}
          <p className="mb-3 text-[11px] text-slate-400">
            {activeMeta.desc}
            {" — 클릭하면 "}
            {sourceLabel}
            {" 원문이 새 창으로 열립니다."}
          </p>

          {/* 로딩 */}
          {loading && (
            <div className="flex items-center justify-center gap-2 py-14 text-slate-400">
              <Loader2 size={20} className="animate-spin" />
              <span className="text-[13px]">{sourceLabel}에서 공시를 불러오는 중...</span>
            </div>
          )}

          {/* 에러 */}
          {!loading && error && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-4">
              <div className="flex items-center gap-2 text-red-700">
                <AlertTriangle size={16} />
                <span className="text-[13px] font-semibold">데이터 로드 실패</span>
              </div>
              <p className="mt-1 text-[12px] text-red-600">{error}</p>
              <button
                onClick={() => loadData(selectedStock, true)}
                className="mt-2 flex items-center gap-1.5 rounded border border-red-300 px-3 py-1.5 text-[12px] text-red-600 hover:bg-red-100"
              >
                <RefreshCw size={12} /> 다시 시도
              </button>
            </div>
          )}

          {/* 공시 목록 */}
          {!loading && !error && data && (
            <DisclosureList
              items={currentItems}
              emptyMsg={activeMeta.emptyMsg}
              onItemClick={openSummary}
              hideCompany={activeTab === "earnings"}
            />
          )}
        </div>
      )}

      {/* 면책 */}
      <p className="px-1 text-[11px] text-slate-400">
        공시를 클릭하면 Gemini AI가 {sourceLabel} 원문을 요약합니다. 데이터는 30분간 캐싱됩니다.
        {isOverseas && " · 미국 증시 상장 종목(SEC 등록 기업)만 지원됩니다."}
      </p>

      {/* Gemini 요약 패널 */}
      {summaryState && (
        <SummaryPanel
          state={summaryState}
          onClose={() => setSummaryState(null)}
          viewerLabel={isOverseas ? "SEC 원문 보기" : "DART 원문 보기"}
        />
      )}
    </div>
  );
}
