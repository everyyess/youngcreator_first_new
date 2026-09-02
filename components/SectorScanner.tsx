"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowDownRight, ArrowUpRight, Flame, Plus, RefreshCw, Snowflake, Star, X } from "lucide-react";
import type { ScannerResponse, ScannerSector, ScannerStock, StockFinancials } from "@/app/api/sector-scanner/route";
import { sectorsForMarket } from "@/app/api/sector-scanner/sectorMaster";
import { loadCustomStocks, saveCustomStocks, scannerUrl, type CustomStock } from "@/lib/sectorScannerCustomStocks";

/**
 * 섹터 스캐너 — 실시간 섹터 등락률 랭킹 (국내/해외)
 *  - 60초 자동 새로고침 (토글)
 *  - 섹터 클릭 → 구성 종목을 등락률/시총/거래대금/매출액/영업이익 기준 정렬
 */

type Market = "domestic" | "global";
type SortKey = "change" | "marketCap" | "tradingValue" | "revenue" | "opIncome";

const SORT_OPTIONS: { key: SortKey; label: string; needsFinancials?: boolean }[] = [
  { key: "change",       label: "등락률" },
  { key: "marketCap",    label: "시가총액" },
  { key: "tradingValue", label: "거래대금" },
  { key: "revenue",      label: "매출액", needsFinancials: true },
  { key: "opIncome",     label: "영업이익", needsFinancials: true },
];

function fmtChange(v: number | null): string {
  if (v === null) return "-";
  return `${v >= 0 ? "+" : ""}${v.toFixed(2)}%`;
}

function fmtBig(v: number | null, currency: string): string {
  if (v === null || !Number.isFinite(v)) return "-";
  const abs = Math.abs(v);
  const sign = v < 0 ? "-" : "";
  if (currency === "KRW") {
    if (abs >= 1e12) return `${sign}${(abs / 1e12).toFixed(1)}조`;
    if (abs >= 1e8) return `${sign}${Math.round(abs / 1e8).toLocaleString("ko-KR")}억`;
    return `${sign}${Math.round(abs).toLocaleString("ko-KR")}`;
  }
  if (abs >= 1e12) return `${sign}$${(abs / 1e12).toFixed(2)}T`;
  if (abs >= 1e9) return `${sign}$${(abs / 1e9).toFixed(1)}B`;
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(0)}M`;
  return `${sign}$${Math.round(abs).toLocaleString()}`;
}

function fmtPrice(v: number | null, currency: string): string {
  if (v === null) return "-";
  if (currency === "KRW") return `${Math.round(v).toLocaleString("ko-KR")}원`;
  return `$${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function changeColor(v: number | null): string {
  if (v === null) return "text-[#94A8A0]";
  if (v > 0) return "text-red-500";
  if (v < 0) return "text-blue-600";
  return "text-[#5F7A70]";
}

export default function SectorScanner() {
  const [market, setMarket] = useState<Market>("domestic");
  const [data, setData] = useState<ScannerResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [selectedSectorId, setSelectedSectorId] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("change");
  // 섹터별 재무 상세 캐시: `${market}:${sectorId}:${관심종목수}` → symbol → financials
  const [financials, setFinancials] = useState<Record<string, Record<string, StockFinancials>>>({});
  const [financialsLoading, setFinancialsLoading] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  // ── 관심 종목 (시총 상위 외 사용자 추가 종목) ──────────────────────────────
  const [customStocks, setCustomStocks] = useState<CustomStock[]>([]);
  const [customLoaded, setCustomLoaded] = useState(false);
  const [customPanelOpen, setCustomPanelOpen] = useState(false);
  const [newSymbol, setNewSymbol] = useState("");
  const [newSectorId, setNewSectorId] = useState("");
  const customStocksRef = useRef<CustomStock[]>([]);
  customStocksRef.current = customStocks;

  useEffect(() => {
    setCustomStocks(loadCustomStocks());
    setCustomLoaded(true);
  }, []);
  useEffect(() => {
    if (customLoaded) saveCustomStocks(customStocks);
  }, [customStocks, customLoaded]);

  const load = useCallback(async (mkt: Market, silent = false) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    if (!silent) setLoading(true);
    try {
      const res = await fetch(scannerUrl(mkt, customStocksRef.current), { signal: controller.signal });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "섹터 데이터를 불러오지 못했습니다.");
      setData(json as ScannerResponse);
      setError("");
    } catch (e) {
      if ((e as Error).name === "AbortError") return;
      setError(e instanceof Error ? e.message : "오류가 발생했습니다.");
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!customLoaded) return;
    setSelectedSectorId(null);
    void load(market);
  }, [market, load, customLoaded]);

  // 관심 종목 변경 시 재조회
  const customCount = customStocks.filter((s) => s.market === market).length;
  useEffect(() => {
    if (!customLoaded) return;
    void load(market, true);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customCount]);

  const marketSectors = sectorsForMarket(market);
  const marketCustomStocks = customStocks.filter((s) => s.market === market);

  // ── 종목명/티커 자동완성 (네이버 종목 검색) ────────────────────────────────
  type Suggestion = { code: string; name: string; ticker: string; market: "domestic" | "overseas" };
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [addingSymbol, setAddingSymbol] = useState(false);
  const [addError, setAddError] = useState("");

  useEffect(() => {
    const q = newSymbol.trim();
    if (q.length < 1) { setSuggestions([]); return; }
    const timer = setTimeout(() => {
      fetch(`/api/stock-search?q=${encodeURIComponent(q)}`)
        .then((res) => res.json())
        .then((json: { items?: Suggestion[] }) => {
          const wanted = market === "domestic" ? "domestic" : "overseas";
          setSuggestions((json.items ?? []).filter((i) => i.market === wanted).slice(0, 5));
        })
        .catch(() => setSuggestions([]));
    }, 300);
    return () => clearTimeout(timer);
  }, [newSymbol, market]);

  /** 심볼 확정 → 섹터 자동 분류 → 관심 종목 등록 */
  const addResolvedStock = async (symbol: string, name?: string) => {
    const upper = symbol.trim().toUpperCase();
    if (!upper) return;
    if (customStocks.some((s) => s.symbol === upper && s.market === market)) {
      setNewSymbol(""); setSuggestions([]); return;
    }
    setAddingSymbol(true);
    setAddError("");
    try {
      let sectorId = newSectorId; // 수동 선택 시 우선
      let resolvedName = name;
      if (!sectorId) {
        const res = await fetch(`/api/sector-scanner?market=${market}&classify=${encodeURIComponent(upper)}`);
        const json = await res.json() as { sectorId?: string | null; name?: string | null };
        sectorId = json.sectorId ?? "";
        resolvedName = resolvedName ?? json.name ?? undefined;
      }
      // 이름이 영문(야후)뿐이면 한국어 종목명으로 교체 시도
      if (!resolvedName || !/[가-힣]/.test(resolvedName)) {
        try {
          const kr = await fetch(`/api/korean-name?ticker=${encodeURIComponent(upper)}`).then((r) => r.json()) as { name?: string };
          if (kr.name && kr.name !== upper) resolvedName = kr.name;
        } catch {}
      }
      if (!sectorId) {
        // 자동 분류 실패 — 첫 섹터로 배정하고 사용자에게 알림
        sectorId = marketSectors[0]?.id ?? "";
        setAddError(`'${resolvedName ?? upper}'의 업종을 자동 인식하지 못해 '${marketSectors[0]?.name}'에 배정했습니다. 필요하면 삭제 후 섹터를 직접 선택해 다시 추가하세요.`);
      }
      setCustomStocks((prev) => [...prev, { symbol: upper, sectorId, market, name: resolvedName }]);
      setNewSymbol("");
      setSuggestions([]);
      setNewSectorId("");
    } finally {
      setAddingSymbol(false);
    }
  };

  /** 입력값으로 추가 — 자동완성 1위 매치 우선, 없으면 심볼로 간주 */
  const addCustomStock = () => {
    if (suggestions.length > 0) {
      void addResolvedStock(suggestions[0].ticker, suggestions[0].name);
    } else {
      void addResolvedStock(newSymbol);
    }
  };

  const removeCustomStock = (symbol: string) => {
    setCustomStocks((prev) => prev.filter((s) => !(s.symbol === symbol && s.market === market)));
  };

  useEffect(() => {
    if (!autoRefresh) return;
    const id = setInterval(() => void load(market, true), 60_000);
    return () => clearInterval(id);
  }, [autoRefresh, market, load]);

  // 재무 정렬 선택 시 상세 lazy 로드
  const finKey = `${market}:${selectedSectorId ?? ""}:${customCount}`;
  useEffect(() => {
    const needsFin = SORT_OPTIONS.find((o) => o.key === sortKey)?.needsFinancials;
    if (!needsFin || !selectedSectorId || financials[finKey]) return;
    let cancelled = false;
    setFinancialsLoading(true);
    fetch(`${scannerUrl(market, customStocksRef.current)}&details=${selectedSectorId}`)
      .then((res) => res.json())
      .then((json: { financials?: StockFinancials[] }) => {
        if (cancelled || !json.financials) return;
        setFinancials((prev) => ({
          ...prev,
          [finKey]: Object.fromEntries(json.financials!.map((f) => [f.symbol, f])),
        }));
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setFinancialsLoading(false); });
    return () => { cancelled = true; };
  }, [sortKey, selectedSectorId, market, finKey, financials]);

  const selectedSector: ScannerSector | null =
    data?.sectors.find((s) => s.id === selectedSectorId) ?? null;

  const sortedStocks = useMemo(() => {
    if (!selectedSector) return [];
    const fin = financials[finKey] ?? {};
    const value = (s: ScannerStock): number => {
      switch (sortKey) {
        case "change":       return s.changePercent ?? -Infinity;
        case "marketCap":    return s.marketCap ?? -Infinity;
        case "tradingValue": return s.tradingValue ?? -Infinity;
        case "revenue":      return fin[s.symbol]?.totalRevenue ?? -Infinity;
        case "opIncome":     return fin[s.symbol]?.operatingIncome ?? -Infinity;
      }
    };
    return [...selectedSector.stocks].sort((a, b) => value(b) - value(a));
  }, [selectedSector, sortKey, financials, finKey]);

  const asOfLabel = data ? new Date(data.asOf).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "";
  const topSector = data?.sectors[0];
  const bottomSector = data?.sectors[data.sectors.length - 1];

  return (
    <div className="flex flex-col gap-5">
      {/* ── 헤더 카드 ── */}
      <section className="rounded-card border border-[#DDE8E5] bg-white p-5 shadow-card">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary text-white">
              <Flame size={22} />
            </span>
            <div>
              <h2 className="text-lg font-black text-[#0D2318]">섹터 스캐너</h2>
              <p className="text-xs font-semibold text-[#7A9488]">
                국내 및 글로벌 시장의 업종별 실시간 등락 현황과 주도 테마를 스캔합니다
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <div className="flex rounded-btn bg-[#F0F5F4] p-1">
              {(["domestic", "global"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMarket(m)}
                  className={`rounded-lg px-3 py-1.5 text-sm font-bold transition ${
                    market === m ? "bg-primary text-white shadow-soft" : "text-[#4B6358] hover:text-primary"
                  }`}
                >
                  {m === "domestic" ? "국내 시장" : "해외 시장"}
                </button>
              ))}
            </div>

            <button
              type="button"
              onClick={() => setCustomPanelOpen((v) => !v)}
              className={`flex items-center gap-1.5 rounded-btn border px-3 py-2 text-sm font-bold transition ${
                customPanelOpen || marketCustomStocks.length > 0
                  ? "border-primary bg-primary-50 text-primary"
                  : "border-[#DDE8E5] bg-white text-[#4B6358] hover:border-primary hover:text-primary"
              }`}
            >
              <Star size={13} />
              관심 종목{marketCustomStocks.length > 0 ? ` ${marketCustomStocks.length}` : ""}
            </button>

            <label className="flex cursor-pointer items-center gap-1.5 text-xs font-bold text-[#5F7A70]">
              <input type="checkbox" checked={autoRefresh} onChange={(e) => setAutoRefresh(e.target.checked)} className="accent-[#005B52]" />
              60초 자동 갱신
            </label>

            <button
              type="button"
              onClick={() => void load(market)}
              disabled={loading}
              className="flex items-center gap-1.5 rounded-btn border border-[#DDE8E5] bg-white px-3 py-2 text-sm font-bold text-[#4B6358] transition hover:border-primary hover:text-primary disabled:opacity-50"
            >
              <RefreshCw size={13} className={loading ? "animate-spin" : ""} />
              새로고침
            </button>
          </div>
        </div>
      </section>

      {/* ── 메인 콘텐츠 영역 ── */}
      <div className="rounded-xl border border-[#DDE8E5] bg-white p-6 shadow-sm overflow-hidden flex flex-col gap-4">
        {asOfLabel && (
          <div className="flex items-center justify-between border-b border-[#F0F7F4] pb-2">
            <span className="text-xs font-bold text-[#5F7A70]">업종 분류 및 등락 현황</span>
            <span className="text-[11px] font-semibold text-[#94A8A0]">{asOfLabel} 기준</span>
          </div>
        )}

      {/* 관심 종목 관리 패널 */}
      {customPanelOpen && (
        <div className="rounded-card border border-[#DDE8E5] bg-white p-4 shadow-card">
          <p className="text-[13px] font-black text-[#0D2318]">관심 종목 추가</p>
          <p className="mt-0.5 text-[11px] font-semibold text-[#94A8A0]">
            시총 상위가 아니어도 스크리닝에 포함할 종목을 추가합니다.
            <span className="font-black"> 종목명(국내는 한글, 해외는 영어)이나 티커</span>를 입력하면 자동으로 종목을 찾아 섹터까지 배정합니다.
          </p>
          <div className="mt-3 flex flex-wrap items-start gap-2">
            <div className="relative">
              <input
                type="text"
                value={newSymbol}
                onChange={(e) => setNewSymbol(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") addCustomStock(); }}
                placeholder={market === "domestic" ? "예: 한화오션, 알테오젠, 042660" : "예: Palantir, PLTR"}
                className="w-56 rounded-input border border-[#DDE8E5] px-3 py-2 text-sm font-bold text-[#0D2318] placeholder:font-semibold placeholder:text-[#B9CCC4] focus:border-primary focus:ring-2 focus:ring-primary/15"
              />
              {suggestions.length > 0 && (
                <div className="absolute left-0 top-full z-20 mt-1 w-72 overflow-hidden rounded-btn border border-[#DDE8E5] bg-white shadow-popup">
                  {suggestions.map((s) => (
                    <button
                      key={s.ticker}
                      type="button"
                      onClick={() => void addResolvedStock(s.ticker, s.name)}
                      className="flex w-full items-center justify-between px-3 py-2 text-left text-sm transition hover:bg-primary-50"
                    >
                      <span className="font-bold text-[#0D2318]">{s.name}</span>
                      <span className="text-[11px] font-semibold text-[#94A8A0]">{s.ticker}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <select
              value={newSectorId}
              onChange={(e) => setNewSectorId(e.target.value)}
              className="rounded-input border border-[#DDE8E5] bg-white px-2.5 py-2 text-sm font-bold text-[#33493F] focus:border-primary"
              title="비워두면 업종 정보로 자동 배정합니다"
            >
              <option value="">섹터 자동 인식</option>
              {marketSectors.map((s) => <option key={s.id} value={s.id}>{s.name} (수동)</option>)}
            </select>
            <button
              type="button"
              onClick={addCustomStock}
              disabled={!newSymbol.trim() || addingSymbol}
              className="flex items-center gap-1 rounded-btn bg-primary px-3.5 py-2 text-xs font-black text-white transition hover:bg-primary-light disabled:opacity-40"
            >
              {addingSymbol ? <RefreshCw size={13} className="animate-spin" /> : <Plus size={13} />}
              {addingSymbol ? "인식 중…" : "추가"}
            </button>
          </div>
          {addError && (
            <p className="mt-2 text-[11px] font-bold text-accent-dark">{addError}</p>
          )}
          {marketCustomStocks.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {marketCustomStocks.map((s) => {
                const sectorName = marketSectors.find((x) => x.id === s.sectorId)?.name ?? s.sectorId;
                return (
                  <span key={s.symbol} className="flex items-center gap-1.5 rounded-full border border-primary/30 bg-primary-50 px-2.5 py-1 text-[11px] font-bold text-primary">
                    <Star size={10} />
                    {s.name ?? s.symbol}
                    <span className="font-semibold text-primary-400">{sectorName}</span>
                    <button type="button" onClick={() => removeCustomStock(s.symbol)} className="opacity-50 transition hover:opacity-100">
                      <X size={11} />
                    </button>
                  </span>
                );
              })}
            </div>
          )}
        </div>
      )}

      {error && (
        <div className="rounded-btn border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-600">{error}</div>
      )}

      {/* 최고/최저 하이라이트 */}
      {topSector && bottomSector && (
        <div className="grid grid-cols-2 gap-4">
          <div className="flex items-center gap-3 rounded-card border border-red-100 bg-red-50/40 p-4 shadow-card">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-red-100 text-red-500"><Flame size={18} /></span>
            <div className="min-w-0">
              <p className="text-[11px] font-bold text-[#7A9488]">지금 가장 뜨거운 섹터</p>
              <p className="truncate text-sm font-black text-[#0D2318]">
                {topSector.name} <span className={`ml-1 ${changeColor(topSector.changePercent)}`}>{fmtChange(topSector.changePercent)}</span>
              </p>
              <p className="truncate text-[11px] font-semibold text-[#94A8A0]">주도주 {topSector.topGainer ?? "-"}</p>
            </div>
          </div>
          <div className="flex items-center gap-3 rounded-card border border-blue-100 bg-blue-50/40 p-4 shadow-card">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-100 text-blue-500"><Snowflake size={18} /></span>
            <div className="min-w-0">
              <p className="text-[11px] font-bold text-[#7A9488]">지금 가장 차가운 섹터</p>
              <p className="truncate text-sm font-black text-[#0D2318]">
                {bottomSector.name} <span className={`ml-1 ${changeColor(bottomSector.changePercent)}`}>{fmtChange(bottomSector.changePercent)}</span>
              </p>
              <p className="truncate text-[11px] font-semibold text-[#94A8A0]">최약체 {bottomSector.topLoser ?? "-"}</p>
            </div>
          </div>
        </div>
      )}

      {/* 섹터 그리드 */}
      {!data && loading ? (
        <div className="flex min-h-48 items-center justify-center text-sm font-bold text-[#94A8A0]">섹터 데이터 로딩 중…</div>
      ) : data ? (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-4">
          {data.sectors.map((sector, rank) => {
            const selected = sector.id === selectedSectorId;
            const up = (sector.changePercent ?? 0) >= 0;
            return (
              <button
                key={sector.id}
                type="button"
                onClick={() => setSelectedSectorId(selected ? null : sector.id)}
                className={`group flex flex-col gap-1.5 rounded-card border p-3.5 text-left transition ${
                  selected
                    ? "border-primary bg-primary-50 shadow-soft"
                    : "border-[#DDE8E5] bg-white shadow-card hover:border-primary/50 hover:shadow-soft"
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-black text-[#94A8A0]">#{rank + 1}</span>
                  {up
                    ? <ArrowUpRight size={14} className="text-red-500" />
                    : <ArrowDownRight size={14} className="text-blue-600" />}
                </div>
                <p className="text-sm font-black text-[#0D2318]">{sector.name}</p>
                <p className={`text-lg font-black tabular-nums leading-none ${changeColor(sector.changePercent)}`}>
                  {fmtChange(sector.changePercent)}
                </p>
                <p className="truncate text-[10px] font-semibold text-[#94A8A0]">
                  {up ? `주도 ${sector.topGainer ?? "-"}` : `부진 ${sector.topLoser ?? "-"}`}
                </p>
              </button>
            );
          })}
        </div>
      ) : null}

      {/* 선택 섹터 상세 */}
      {selectedSector && (
        <div className="rounded-card border border-[#DDE8E5] bg-white p-5 shadow-card">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-base font-black text-[#0D2318]">
                {selectedSector.name}
                <span className={`ml-2 text-sm ${changeColor(selectedSector.changePercent)}`}>{fmtChange(selectedSector.changePercent)}</span>
              </h3>
              <p className="text-[11px] font-semibold text-[#94A8A0]">구성 종목 {selectedSector.stocks.length}개 · 기준을 선택해 정렬하세요</p>
            </div>
            <div className="flex rounded-btn bg-[#F0F5F4] p-1">
              {SORT_OPTIONS.map((opt) => (
                <button
                  key={opt.key}
                  type="button"
                  onClick={() => setSortKey(opt.key)}
                  className={`rounded-lg px-3 py-1.5 text-[11px] font-bold transition ${
                    sortKey === opt.key ? "bg-primary text-white" : "text-[#4B6358] hover:text-primary"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {financialsLoading && (sortKey === "revenue" || sortKey === "opIncome") && (
            <p className="mb-3 text-xs font-semibold text-primary-400">재무 데이터 로딩 중…</p>
          )}

          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="border-b border-[#DDE8E5] text-left text-[11px] font-bold text-[#94A8A0]">
                  <th className="py-2 pr-3">순위</th>
                  <th className="py-2 pr-3">종목</th>
                  <th className="py-2 pr-3 text-right">현재가</th>
                  <th className="py-2 pr-3 text-right">등락률</th>
                  <th className="py-2 pr-3 text-right">시가총액</th>
                  <th className="py-2 pr-3 text-right">거래대금</th>
                  <th className="py-2 pr-3 text-right">매출액 (TTM)</th>
                  <th className="py-2 text-right">영업이익</th>
                </tr>
              </thead>
              <tbody>
                {sortedStocks.map((stock, i) => {
                  const fin = financials[finKey]?.[stock.symbol];
                  const finCurrency = fin?.financialCurrency ?? stock.currency;
                  return (
                    <tr key={stock.symbol} className="border-b border-[#F0F7F4] font-semibold text-[#1C3329] transition hover:bg-[#F6FAF8]">
                      <td className="py-2.5 pr-3 text-xs font-black text-[#94A8A0]">{i + 1}</td>
                      <td className="py-2.5 pr-3">
                        <span className="font-bold">{stock.name}</span>
                        <span className="ml-1.5 text-[10px] font-semibold text-[#94A8A0]">{stock.symbol}</span>
                        {stock.isCustom && (
                          <span className="ml-1.5 inline-flex items-center gap-0.5 rounded-full bg-primary-50 px-1.5 py-0.5 text-[9px] font-black text-primary align-middle">
                            <Star size={8} /> 관심
                          </span>
                        )}
                      </td>
                      <td className="py-2.5 pr-3 text-right tabular-nums">{fmtPrice(stock.price, stock.currency)}</td>
                      <td className={`py-2.5 pr-3 text-right font-black tabular-nums ${changeColor(stock.changePercent)}`}>{fmtChange(stock.changePercent)}</td>
                      <td className="py-2.5 pr-3 text-right tabular-nums">{fmtBig(stock.marketCap, stock.currency)}</td>
                      <td className="py-2.5 pr-3 text-right tabular-nums">{fmtBig(stock.tradingValue, stock.currency)}</td>
                      <td className="py-2.5 pr-3 text-right tabular-nums">{fin ? fmtBig(fin.totalRevenue, finCurrency) : "-"}</td>
                      <td className="py-2.5 text-right tabular-nums">{fin ? fmtBig(fin.operatingIncome, finCurrency) : "-"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {!financials[finKey] && (
            <p className="mt-3 text-[11px] font-semibold text-[#94A8A0]">
              매출액·영업이익은 &lsquo;매출액&rsquo; 또는 &lsquo;영업이익&rsquo; 정렬 선택 시 로드됩니다.
            </p>
          )}
        </div>
      )}
      </div>
    </div>
  );
}
