"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, FileText, Loader2, RefreshCw } from "lucide-react";
import { useCustomerContext } from "../CustomerContext";
import StockSearchBox from "./StockSearchBox";

interface StockEntry {
  displayName: string;
  ticker: string;
  searchKey: string;
}

type Market = "domestic" | "overseas";

interface DartDisclosure {
  rcpNo: string;
  company: string;
  title: string;
  date: string;
  reporter?: string;
  url?: string;
  preloadedSummary?: string;
  __category?: "contracts" | "stakes";
}

interface DartAnalysisTabProps {
  selectedStock?: { ticker: string; name: string } | null;
  onStockChange?: (stock: { ticker: string; name: string } | null) => void;
}

const tabDefs = [
  { id: "contracts", label: "계약 공시" },
  { id: "stakes", label: "지분/주주 공시" },
] as const;
type DartTab = (typeof tabDefs)[number]["id"];

export default function DartAnalysisTab({ selectedStock: sharedStock, onStockChange }: DartAnalysisTabProps = {}) {
  const { portfolioAssets } = useCustomerContext();

  const [market, setMarket] = useState<Market>("domestic");
  const [selectedStock, setSelectedStock] = useState<StockEntry | null>(null);
  const [activeTab, setActiveTab] = useState<DartTab>("contracts");

  const [disclosures, setDisclosures] = useState<DartDisclosure[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [summaries, setSummaries] = useState<Record<string, { loading: boolean; text?: string; error?: string }>>({});

  const activeStocks = useMemo<StockEntry[]>(() => {
    const isKorean = (ticker: string) => /^\d{6}(\.(KS|KQ|KN))?$/i.test(ticker);
    return (portfolioAssets ?? [])
      .filter((a) => a.ticker && a.ticker.trim() !== "" && isKorean(a.ticker))
      .map((a) => ({
        displayName: a.name,
        ticker: a.ticker!,
        searchKey: a.ticker!.replace(/\.(KS|KQ|KN)$/i, ""),
      }));
  }, [portfolioAssets]);

  const appliedSharedTickerRef = useRef<string | null>(null);

  useEffect(() => {
    if (!sharedStock) return;
    if (appliedSharedTickerRef.current === sharedStock.ticker) return;
    appliedSharedTickerRef.current = sharedStock.ticker;

    setMarket("domestic");
    setSelectedStock({
      displayName: sharedStock.name,
      ticker: sharedStock.ticker,
      searchKey: sharedStock.ticker,
    });
    setActiveTab("contracts");
  }, [sharedStock]);

  useEffect(() => {
    if (appliedSharedTickerRef.current) return;
    if (activeStocks.length > 0 && !selectedStock) {
      setSelectedStock(activeStocks[0]);
    }
  }, [activeStocks, selectedStock]);

  useEffect(() => {
    if (!selectedStock) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setDisclosures([]);

    fetch(`/api/dart-disclosures?ticker=${encodeURIComponent(selectedStock.searchKey)}`)
      .then(async (r) => {
        if (!r.ok) {
          const j = await r.json().catch(() => ({}));
          throw new Error(j.error ?? `HTTP ${r.status}`);
        }
        return r.json();
      })
      .then((data: { company?: string; contracts?: DartDisclosure[]; stakes?: DartDisclosure[] }) => {
        if (cancelled) return;
        const contracts = (data.contracts ?? []).map((d) => ({ ...d, __category: "contracts" as const }));
        const stakes = (data.stakes ?? []).map((d) => ({ ...d, __category: "stakes" as const }));
        setDisclosures([...contracts, ...stakes]);
      })
      .catch((e: Error) => {
        if (!cancelled) setError(e.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [selectedStock]);

  const selectAsset = (s: StockEntry) => {
    if (s.searchKey === selectedStock?.searchKey) return;
    appliedSharedTickerRef.current = s.searchKey;
    setSelectedStock(s);
    setActiveTab("contracts");
    onStockChange?.({ ticker: s.searchKey, name: s.displayName });
  };

  const handleSearchSelect = (item: { name: string; ticker: string; code: string }) => {
    appliedSharedTickerRef.current = item.code;
    setSelectedStock({
      displayName: item.name,
      ticker: item.ticker,
      searchKey: item.code,
    });
    setActiveTab("contracts");
    onStockChange?.({ ticker: item.code, name: item.name });
  };

  const filteredDisclosures = useMemo(() => {
    return disclosures.filter((d) => d.__category === activeTab);
  }, [disclosures, activeTab]);

  const handleDisclosureClick = (d: DartDisclosure) => {
    if (d.preloadedSummary) {
      setSummaries((prev) => ({ ...prev, [d.rcpNo]: { loading: false, text: d.preloadedSummary } }));
      return;
    }
    setSummaries((prev) => ({ ...prev, [d.rcpNo]: { loading: true } }));
    fetch(`/api/dart-summary?rcept_no=${encodeURIComponent(d.rcpNo)}`)
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
        return j as { summary: string };
      })
      .then((data) => {
        setSummaries((prev) => ({ ...prev, [d.rcpNo]: { loading: false, text: data.summary } }));
      })
      .catch((e: Error) => {
        setSummaries((prev) => ({ ...prev, [d.rcpNo]: { loading: false, error: e.message } }));
      });
  };

  return (
    <div className="space-y-4">
      {activeStocks.length > 0 && (
        <div className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
          <div className="mb-2 text-[11px] font-semibold text-slate-400 uppercase tracking-wide">보유 종목</div>
          <div className="flex flex-wrap gap-2">
            {activeStocks.map((s) => {
              const isSelected = selectedStock?.searchKey === s.searchKey;
              return (
                <button
                  key={s.searchKey}
                  onClick={() => selectAsset(s)}
                  className={`rounded-lg border px-3.5 py-2 text-[13px] font-semibold transition ${
                    isSelected
                      ? "border-[#2f2f9d] bg-[#2f2f9d] text-white shadow-sm"
                      : "border-slate-200 bg-slate-50 text-slate-600 hover:border-slate-300 hover:bg-slate-100"
                  }`}
                >
                  {s.displayName}
                </button>
              );
            })}
          </div>
        </div>
      )}

      <StockSearchBox market={market} onSelect={handleSearchSelect} />

      {selectedStock && (
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <div className="text-[15px] font-bold text-slate-800">{selectedStock.displayName}</div>
              <div className="text-[12px] text-slate-400">{selectedStock.searchKey}</div>
            </div>
          </div>

          <div className="mb-4 flex gap-1 overflow-x-auto rounded-lg border border-slate-200 bg-slate-50 p-1">
            {tabDefs.map((t) => (
              <button
                key={t.id}
                onClick={() => setActiveTab(t.id)}
                className={`shrink-0 rounded-md px-3.5 py-1.5 text-[13px] font-semibold transition ${
                  activeTab === t.id ? "bg-white text-[#2f2f9d] shadow-sm" : "text-slate-500 hover:text-slate-700"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          {loading && (
            <div className="flex items-center justify-center gap-2 py-16 text-slate-400">
              <Loader2 size={22} className="animate-spin" />
              <span className="text-[14px]">공시 목록 불러오는 중...</span>
            </div>
          )}

          {!loading && error && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-4">
              <div className="flex items-center gap-2 text-red-700">
                <AlertTriangle size={18} />
                <span className="font-semibold">데이터 로드 실패</span>
              </div>
              <p className="mt-1 text-[13px] text-red-600">{error}</p>
              <button
                onClick={() => { setError(null); setSelectedStock((s) => (s ? { ...s } : s)); }}
                className="mt-3 flex items-center gap-1.5 rounded-md border border-red-300 px-3 py-1.5 text-[13px] text-red-600 hover:bg-red-100"
              >
                <RefreshCw size={14} /> 다시 시도
              </button>
            </div>
          )}

          {!loading && !error && filteredDisclosures.length === 0 && (
            <div className="rounded-lg border border-dashed border-slate-200 p-8 text-center text-[13px] text-slate-400">
              해당 카테고리의 공시가 없습니다.
            </div>
          )}

          {!loading && !error && filteredDisclosures.length > 0 && (
            <div className="space-y-2">
              {filteredDisclosures.map((d) => {
                const summary = summaries[d.rcpNo];
                return (
                  <div key={d.rcpNo} className="overflow-hidden rounded-lg border border-slate-200">
                    <button
                      onClick={() => handleDisclosureClick(d)}
                      className="flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-slate-50"
                    >
                      <FileText size={16} className="mt-0.5 shrink-0 text-slate-400" />
                      <div className="min-w-0 flex-1">
                        <div className="text-[13px] font-semibold text-slate-700">{d.title}</div>
                        <div className="mt-0.5 text-[11px] text-slate-400">
                          {d.date} {d.reporter ? `· ${d.reporter}` : ""}
                        </div>
                      </div>
                    </button>
                    {summary && (
                      <div className="border-t border-slate-100 bg-slate-50 px-4 py-3">
                        {summary.loading && (
                          <div className="flex items-center gap-2 text-[12px] text-slate-400">
                            <Loader2 size={14} className="animate-spin" /> AI 요약 생성 중...
                          </div>
                        )}
                        {summary.error && (
                          <div className="text-[12px] text-red-500">요약 실패: {summary.error}</div>
                        )}
                        {summary.text && (
                          <div className="whitespace-pre-wrap text-[12px] leading-relaxed text-slate-600">
                            {summary.text}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      <p className="px-1 text-[11px] text-slate-400">
        공시를 클릭하면 Gemini AI가 DART 전자공시 원문을 요약합니다. 데이터는 30분간 캐싱됩니다.
      </p>
    </div>
  );
}