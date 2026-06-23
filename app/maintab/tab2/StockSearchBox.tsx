"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, Search, X } from "lucide-react";

export interface StockSearchItem {
  code: string;
  name: string;
  ticker: string;
  market: "domestic" | "overseas";
}

interface Props {
  onSelect: (item: StockSearchItem) => void;
  market?: "domestic" | "overseas" | "all";
  placeholder?: string;
}

export default function StockSearchBox({ onSelect, market = "all", placeholder }: Props) {
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<StockSearchItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [showDropdown, setShowDropdown] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const doSearch = async () => {
    const q = query.trim();
    if (!q) return;

    setLoading(true);
    setError(null);
    setShowDropdown(false);

    try {
      const res = await fetch(`/api/stock-search?q=${encodeURIComponent(q)}`);
      const data = (await res.json()) as { items?: StockSearchItem[]; error?: string };

      let items = data.items ?? [];
      if (market === "domestic") items = items.filter((i) => i.market === "domestic");
      if (market === "overseas") items = items.filter((i) => i.market === "overseas");

      if (items.length === 0) {
        const hint =
          market === "domestic"
            ? "국내 종목 검색 결과가 없습니다. 6자리 종목코드 또는 한국 기업명을 입력해주세요."
            : market === "overseas"
            ? "해외 종목 검색 결과가 없습니다. 영문 티커(예: AAPL, TSLA)를 입력해주세요."
            : "검색 결과가 없습니다.";
        setError(hint);
      } else if (items.length === 1) {
        onSelect(items[0]);
        setQuery(`${items[0].name}  (${items[0].ticker})`);
      } else {
        setResults(items);
        setShowDropdown(true);
      }
    } catch {
      setError("종목 검색 중 오류가 발생했습니다.");
    } finally {
      setLoading(false);
    }
  };

  const handleSelect = (item: StockSearchItem) => {
    onSelect(item);
    setQuery(`${item.name}  (${item.ticker})`);
    setShowDropdown(false);
    setResults([]);
    setError(null);
  };

  const handleClear = () => {
    setQuery("");
    setResults([]);
    setError(null);
    setShowDropdown(false);
  };

  const defaultPlaceholder =
    market === "domestic"
      ? "국내 종목명 또는 6자리 코드  (예: 삼성전자, 005930)"
      : market === "overseas"
      ? "해외 종목 티커  (예: AAPL, TSLA, NVDA)"
      : "종목명 또는 티커  (예: 삼성전자, AAPL)";

  return (
    <div ref={containerRef} className="rounded-lg border border-[#2f2f9d]/20 bg-[#f5f6ff] p-3 shadow-sm">
      <div className="mb-2 flex items-center gap-1.5">
        <Search size={11} className="text-[#2f2f9d]" />
        <span className="text-[11px] font-semibold uppercase tracking-wide text-[#2f2f9d]">
          비보유 종목 검색
        </span>
        <span className="text-[10px] text-slate-400 ml-1">— 종목명 또는 티커로 검색하면 해당 종목 분석을 바로 확인합니다</span>
      </div>

      <div className="relative flex gap-2">
        <div className="relative flex-1">
          <input
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setError(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") doSearch();
              if (e.key === "Escape") setShowDropdown(false);
            }}
            placeholder={placeholder ?? defaultPlaceholder}
            className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-3 pr-8 text-[13px] text-slate-700 placeholder-slate-400 focus:border-[#2f2f9d] focus:outline-none focus:ring-1 focus:ring-[#2f2f9d]/30 transition"
          />
          {query && (
            <button
              type="button"
              onClick={handleClear}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
            >
              <X size={13} />
            </button>
          )}
        </div>
        <button
          type="button"
          onClick={doSearch}
          disabled={loading || !query.trim()}
          className="flex items-center gap-1.5 rounded-lg bg-[#2f2f9d] px-3.5 py-2 text-[13px] font-semibold text-white hover:bg-[#26268a] disabled:opacity-50 transition"
        >
          {loading ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />}
          검색
        </button>
      </div>

      {/* 검색 결과 드롭다운 */}
      {showDropdown && results.length > 0 && (
        <div className="mt-1.5 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-lg">
          {results.map((item) => (
            <button
              key={item.ticker}
              type="button"
              onClick={() => handleSelect(item)}
              className="flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left hover:bg-slate-50 transition border-b border-slate-100 last:border-0"
            >
              <span className="text-[13px] font-semibold text-slate-800">{item.name}</span>
              <span
                className={`shrink-0 text-[11px] font-medium ${
                  item.market === "domestic" ? "text-blue-500" : "text-green-600"
                }`}
              >
                {item.ticker} &middot; {item.market === "domestic" ? "국내" : "해외"}
              </span>
            </button>
          ))}
        </div>
      )}

      {/* 에러 */}
      {error && !showDropdown && (
        <p className="mt-1.5 text-[12px] text-red-500">{error}</p>
      )}
    </div>
  );
}
