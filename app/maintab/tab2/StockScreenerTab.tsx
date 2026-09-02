"use client";

import { useEffect, useMemo, useRef, useState } from "react";

interface StockRow {
  ticker: string;
  name: string;
  price: number;
  changePct?: number;
  volume?: number;
  tradingValue?: number;
  disparity20d?: number;
  dividendYield?: number;
  highLowGapPct?: number;
}

type ConditionId =
  | "volumeTop"
  | "valueTop"
  | "riseRate"
  | "fallRate"
  | "nearHigh"
  | "nearLow"
  | "disparity"
  | "dividendTop";

interface ConditionDef {
  id: ConditionId;
  label: string;
  apiType: string;
  sortValue: (row: StockRow) => number;
  columnLabel: string;
  displayValue: (row: StockRow) => string;
}

const conditionDefs: ConditionDef[] = [
  {
    id: "volumeTop",
    label: "거래량 상위",
    apiType: "volume",
    sortValue: (row) => row.volume ?? 0,
    columnLabel: "거래량",
    displayValue: (row) => (row.volume !== undefined ? row.volume.toLocaleString() : "-"),
  },
  {
    id: "valueTop",
    label: "거래대금 상위",
    apiType: "value",
    sortValue: (row) => row.tradingValue ?? 0,
    columnLabel: "거래대금(억)",
    displayValue: (row) => (row.tradingValue !== undefined ? row.tradingValue.toLocaleString() : "-"),
  },
  {
    id: "riseRate",
    label: "상승률 상위",
    apiType: "rise",
    sortValue: (row) => row.changePct ?? -9999,
    columnLabel: "등락률",
    displayValue: (row) =>
      row.changePct !== undefined ? `${row.changePct >= 0 ? "+" : ""}${row.changePct.toFixed(2)}%` : "-",
  },
  {
    id: "fallRate",
    label: "하락률 상위",
    apiType: "fall",
    sortValue: (row) => -(row.changePct ?? 9999),
    columnLabel: "등락률",
    displayValue: (row) =>
      row.changePct !== undefined ? `${row.changePct >= 0 ? "+" : ""}${row.changePct.toFixed(2)}%` : "-",
  },
  {
    id: "nearHigh",
    label: "52주 신고가 근접",
    apiType: "nearHigh",
    sortValue: (row) => -(row.highLowGapPct ?? -9999),
    columnLabel: "고점대비",
    displayValue: (row) => (row.highLowGapPct !== undefined ? `${row.highLowGapPct.toFixed(1)}%` : "-"),
  },
  {
    id: "nearLow",
    label: "52주 신저가 근접",
    apiType: "nearLow",
    sortValue: (row) => row.highLowGapPct ?? 9999,
    columnLabel: "저점대비",
    displayValue: (row) => (row.highLowGapPct !== undefined ? `${row.highLowGapPct.toFixed(1)}%` : "-"),
  },
  {
    id: "disparity",
    label: "20일선 이격도 상위",
    apiType: "disparity",
    sortValue: (row) => Math.abs(row.disparity20d ?? 0),
    columnLabel: "이격도",
    displayValue: (row) => (row.disparity20d !== undefined ? `${row.disparity20d.toFixed(1)}%` : "-"),
  },
  {
    id: "dividendTop",
    label: "배당수익률 상위",
    apiType: "dividend",
    sortValue: (row) => row.dividendYield ?? -9999,
    columnLabel: "배당수익률",
    displayValue: (row) => (row.dividendYield !== undefined ? `${row.dividendYield.toFixed(1)}%` : "-"),
  },
];

const REFRESH_INTERVAL_MS = 30_000;

interface StockScreenerTabProps {
  onSelectStock?: (ticker: string, name: string) => void;
}

export default function StockScreenerTab({ onSelectStock }: StockScreenerTabProps) {
  const [selected, setSelected] = useState<Set<ConditionId>>(new Set());
  const [baseCondition, setBaseCondition] = useState<ConditionId | null>(null);
  const [sortOverride, setSortOverride] = useState<ConditionId | "base" | null>(null);
  const [selectedTicker, setSelectedTicker] = useState<string | null>(null);

  const [apiData, setApiData] = useState<Record<string, StockRow[]>>({});
  const [lastUpdatedAt, setLastUpdatedAt] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);

  const toggleCondition = (id: ConditionId) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
        // 기준 조건을 해제하면 기준을 다시 지정해야 함
        if (baseCondition === id) {
          const remaining = Array.from(next);
          setBaseCondition(remaining.length > 0 ? remaining[0] : null);
        }
      } else {
        next.add(id);
        // 최초 선택이면 자동으로 기준 지정
        if (!baseCondition) setBaseCondition(id);
      }
      return next;
    });
    setSortOverride(null);
  };

  const activeConditions = conditionDefs.filter((c) => selected.has(c.id));
  const otherConditions = activeConditions.filter((c) => c.id !== baseCondition);
  const baseDef = conditionDefs.find((c) => c.id === baseCondition) ?? null;

  const neededApiTypes = useMemo(
    () => Array.from(new Set(activeConditions.map((c) => c.apiType))),
    [activeConditions],
  );
  const neededApiTypesKey = neededApiTypes.join(",");

  const fetchAll = useMemo(
    () => (types: string[]) => {
      if (types.length === 0) return;
      setLoading(true);
      setError(null);

      Promise.all(
        types.map(async (type) => {
          const res = await fetch(`/api/screener?type=${type}`, { cache: "no-store" });
          const json = await res.json();
          if (!json.ok) throw new Error(`${type}: ${json.error}`);
          return { type, rows: json.data as StockRow[] };
        }),
      )
        .then((results) => {
          setApiData((prev) => {
            const next = { ...prev };
            for (const r of results) next[r.type] = r.rows;
            return next;
          });
          setLastUpdatedAt(Date.now());
        })
        .catch((err) => {
          setError(err instanceof Error ? err.message : String(err));
        })
        .finally(() => {
          setLoading(false);
        });
    },
    [],
  );

  useEffect(() => {
    if (neededApiTypes.length === 0) return;
    fetchAll(neededApiTypes);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [neededApiTypesKey]);

  const neededApiTypesRef = useRef(neededApiTypes);
  neededApiTypesRef.current = neededApiTypes;

  useEffect(() => {
    if (!autoRefresh) return;
    const interval = window.setInterval(() => {
      if (neededApiTypesRef.current.length > 0) fetchAll(neededApiTypesRef.current);
    }, REFRESH_INTERVAL_MS);
    return () => window.clearInterval(interval);
  }, [autoRefresh, fetchAll]);

  const handleManualRefresh = () => {
    if (neededApiTypes.length > 0) fetchAll(neededApiTypes);
  };

  // 기준 리스트 전체(최대 30개) + 부가 조건 값 병합 (탈락 없음)
  const results = useMemo(() => {
    if (!baseDef) return [];
    const baseRows = apiData[baseDef.apiType];
    if (!baseRows) return [];

    const merged: StockRow[] = baseRows.map((row, idx) => {
      let combined = { ...row, __baseRank: idx } as StockRow & { __baseRank: number };
      for (const cond of otherConditions) {
        const rows = apiData[cond.apiType];
        if (!rows) continue;
        const match = rows.find((r) => r.ticker === row.ticker);
        if (match) combined = { ...combined, ...match, ticker: row.ticker, name: row.name };
      }
      return combined;
    });

    const sortKey = sortOverride ?? "base";
    if (sortKey === "base") {
      return merged.sort((a, b) => (a as { __baseRank: number }).__baseRank - (b as { __baseRank: number }).__baseRank);
    }
    const cond = conditionDefs.find((c) => c.id === sortKey);
    if (!cond) return merged;
    return [...merged].sort((a, b) => cond.sortValue(b) - cond.sortValue(a));
  }, [baseDef, otherConditions, apiData, sortOverride]);

  const isLoadingNeeded = neededApiTypes.some((t) => !apiData[t]) && loading;

  const handleRowClick = (row: StockRow) => {
    setSelectedTicker(row.ticker);
    sessionStorage.setItem("screenerSelectedTicker", row.ticker);
    sessionStorage.setItem("screenerSelectedName", row.name);
    window.location.href = "/analysis/tab1";
  };

  const secondsAgo = lastUpdatedAt ? Math.floor((Date.now() - lastUpdatedAt) / 1000) : null;

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <div className="mb-3 flex items-center justify-between">
          <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide">
            조건 선택 (여러 개 동시 선택 가능 · 실시간 KIS 데이터)
          </div>
          <label className="flex items-center gap-1.5 text-[11px] text-slate-500">
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={(e) => setAutoRefresh(e.target.checked)}
              className="h-3.5 w-3.5 accent-[#2f2f9d]"
            />
            30초 자동 갱신
          </label>
        </div>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {conditionDefs.map((c) => {
            const isActive = selected.has(c.id);
            const isBase = baseCondition === c.id;
            return (
              <div
                key={c.id}
                className={`flex items-center gap-2 rounded-lg border px-3 py-2.5 transition ${
                  isActive ? "border-[#2f2f9d] bg-[#2f2f9d]/5" : "border-slate-200 bg-white"
                }`}
              >
                <input
                  type="checkbox"
                  checked={isActive}
                  onChange={() => toggleCondition(c.id)}
                  className="h-4 w-4 accent-[#2f2f9d]"
                />
                <span className="flex-1 text-[13px] font-semibold text-slate-700">{c.label}</span>
                {isActive && activeConditions.length > 1 && (
                  <label className="flex items-center gap-1 text-[11px] font-semibold text-slate-500">
                    <input
                      type="radio"
                      name="baseCondition"
                      checked={isBase}
                      onChange={() => { setBaseCondition(c.id); setSortOverride(null); }}
                      className="h-3 w-3 accent-[#2f2f9d]"
                    />
                    기준
                  </label>
                )}
              </div>
            );
          })}
        </div>
        {activeConditions.length > 1 && (
          <p className="mt-2 text-[11px] text-slate-400">
            &ldquo;기준&rdquo;으로 지정한 조건의 종목이 전부 표시되며, 나머지 조건은 참고 컬럼으로 함께 나타납니다.
          </p>
        )}
      </div>

      {activeConditions.length > 0 && baseDef ? (
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="rounded-full bg-[#2f2f9d] px-2.5 py-1 text-[11px] font-semibold text-white">
                기준: {baseDef.label}
              </span>
              {otherConditions.map((c) => (
                <span key={c.id} className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-semibold text-slate-600">
                  {c.label}
                </span>
              ))}
            </div>
            <div className="flex items-center gap-2">
              {secondsAgo !== null && <span className="text-[11px] text-slate-400">{secondsAgo}초 전 갱신</span>}
              <button
                onClick={handleManualRefresh}
                disabled={loading}
                className="rounded border border-slate-200 px-2 py-1 text-[11px] font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50"
              >
                {loading ? "갱신 중..." : "새로고침"}
              </button>
              {activeConditions.length > 1 && (
                <>
                  <span className="text-[11px] text-slate-400">정렬</span>
                  <select
                    value={sortOverride ?? "base"}
                    onChange={(e) => setSortOverride(e.target.value === "base" ? null : (e.target.value as ConditionId))}
                    className="rounded border border-slate-200 px-2 py-1 text-[12px] text-slate-700"
                  >
                    <option value="base">기준 순위</option>
                    {activeConditions.map((c) => (
                      <option key={c.id} value={c.id}>{c.label}순</option>
                    ))}
                  </select>
                </>
              )}
              <span className="text-[12px] text-slate-400">{results.length}종목</span>
            </div>
          </div>

          {isLoadingNeeded ? (
            <div className="p-8 text-center text-[13px] text-slate-400">데이터 불러오는 중...</div>
          ) : error ? (
            <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-[13px] text-red-600">
              데이터 조회 실패: {error}
            </div>
          ) : results.length === 0 ? (
            <div className="rounded-lg border border-dashed border-slate-200 p-8 text-center text-[13px] text-slate-400">
              기준 조건에 해당하는 종목이 없습니다.
            </div>
          ) : (
            <div className="overflow-hidden rounded-lg border border-slate-200">
              <table className="w-full border-collapse text-[13px]">
                <thead>
                  <tr className="bg-slate-50 text-[12px] text-slate-500">
                    <th className="px-3 py-2 text-left font-medium">종목명</th>
                    <th className="px-3 py-2 text-left font-medium">현재가</th>
                    <th className="px-3 py-2 text-left font-medium">등락률</th>
                    {activeConditions
                      .filter((c) => c.id !== "riseRate" && c.id !== "fallRate")
                      .map((c) => (
                        <th key={c.id} className="px-3 py-2 text-left font-medium">
                          {c.columnLabel}
                          {c.id === baseCondition && <span className="ml-1 text-[10px] text-[#2f2f9d]">●기준</span>}
                        </th>
                      ))}
                  </tr>
                </thead>
                <tbody>
                  {results.map((row) => (
                    <tr
                      key={row.ticker}
                      onClick={() => handleRowClick(row)}
                      className={`cursor-pointer border-t border-slate-100 transition hover:bg-slate-50 ${
                        selectedTicker === row.ticker ? "bg-blue-50" : "bg-white"
                      }`}
                    >
                      <td className="px-3 py-2">
                        <div className="font-semibold text-slate-700">{row.name}</div>
                        <div className="text-[11px] text-slate-400">{row.ticker}</div>
                      </td>
                      <td className="px-3 py-2 text-slate-600">{row.price.toLocaleString()}원</td>
                      <td className={`px-3 py-2 font-semibold ${(row.changePct ?? 0) >= 0 ? "text-red-500" : "text-blue-500"}`}>
                        {row.changePct !== undefined ? (
                          <>{row.changePct >= 0 ? "+" : ""}{row.changePct.toFixed(2)}%</>
                        ) : (
                          <span className="text-slate-300">-</span>
                        )}
                      </td>
                      {activeConditions
                        .filter((c) => c.id !== "riseRate" && c.id !== "fallRate")
                        .map((c) => (
                          <td key={c.id} className="px-3 py-2 text-slate-600">{c.displayValue(row)}</td>
                        ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ) : (
        <div className="rounded-lg border border-dashed border-slate-200 bg-white/70 p-10 text-center text-[13px] text-slate-400">
          위에서 조건을 하나 이상 선택하면 해당 종목이 표시됩니다.
        </div>
      )}
    </div>
  );
}