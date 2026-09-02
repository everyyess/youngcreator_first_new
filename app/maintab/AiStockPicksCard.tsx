"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, Sparkles } from "lucide-react";

type ScannerStock = {
  symbol: string;
  name: string;
  price: number | null;
  changePercent: number | null;
  marketCap: number | null;
  currency: string;
};

type ScannerSector = {
  id: string;
  name: string;
  changePercent: number | null;
  stocks: ScannerStock[];
};

type ScannerResponse = {
  market: "domestic" | "global";
  sectors: ScannerSector[];
};

interface FlatPick {
  symbol: string;
  name: string;
  sectorName: string;
  changePercent: number | null;
  currency: string;
}

const TOP_SECTOR_COUNT = 5; // 등락률 상위 섹터 개수
const STOCKS_PER_SECTOR = 2; // 섹터당 뽑을 대표(상승률 1위) 종목 수
const MAX_PICKS = 8;

interface Props {
  isCustomerView: boolean;
  onAdd: (pick: { name: string; ticker: string; isGlobal: boolean }) => void;
}

export function AiStockPicksCard({ isCustomerView, onAdd }: Props) {
  const [market, setMarket] = useState<"domestic" | "global">("domestic");
  const [picks, setPicks] = useState<FlatPick[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [addingSymbol, setAddingSymbol] = useState<string | null>(null);

  const load = useCallback(async (m: "domestic" | "global") => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/sector-scanner?market=${m}`);
      const data = (await res.json()) as ScannerResponse & { error?: string };
      if (!res.ok) {
        setError(data?.error ?? `조회 실패 (${res.status})`);
        setPicks([]);
        return;
      }
      const topSectors = [...data.sectors]
        .filter((s) => s.changePercent !== null)
        .sort((a, b) => (b.changePercent ?? 0) - (a.changePercent ?? 0))
        .slice(0, TOP_SECTOR_COUNT);

      const flat: FlatPick[] = topSectors.flatMap((sector) =>
        [...sector.stocks]
          .filter((s) => s.changePercent !== null && s.price !== null)
          .sort((a, b) => (b.changePercent ?? 0) - (a.changePercent ?? 0))
          .slice(0, STOCKS_PER_SECTOR)
          .map((s) => ({
            symbol: s.symbol,
            name: s.name,
            sectorName: sector.name,
            changePercent: s.changePercent,
            currency: s.currency,
          }))
      );
      flat.sort((a, b) => (b.changePercent ?? 0) - (a.changePercent ?? 0));
      setPicks(flat.slice(0, MAX_PICKS));
    } catch {
      setError("네트워크 오류가 발생했습니다.");
      setPicks([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(market);
  }, [market, load]);

  const handleAddClick = useCallback((pick: FlatPick) => {
    setAddingSymbol(pick.symbol);
    const isGlobal = !pick.symbol.endsWith(".KS") && !pick.symbol.endsWith(".KQ");
    onAdd({ name: pick.name, ticker: pick.symbol, isGlobal });
    setAddingSymbol(null);
  }, [onAdd]);

  return (
    <div className="rounded-xl border border-slate-200 bg-white shadow-soft">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
        <div className="flex items-center gap-2">
          <Sparkles size={16} className="text-violet-500" />
          <span className="text-sm font-bold text-navy">AI 추천 종목</span>
          <span className="text-[10px] text-slate-400">실시간 섹터 강세 스캐너 · 등락률은 전일 대비</span>
        </div>
        <div className="flex overflow-hidden rounded-lg border border-slate-200 text-xs font-bold">
          <button
            type="button"
            onClick={() => setMarket("domestic")}
            className={`px-3 py-1.5 transition ${market === "domestic" ? "bg-samsung text-white" : "bg-white text-slate-500 hover:bg-slate-50"}`}
          >
            국내
          </button>
          <button
            type="button"
            onClick={() => setMarket("global")}
            className={`px-3 py-1.5 transition ${market === "global" ? "bg-samsung text-white" : "bg-white text-slate-500 hover:bg-slate-50"}`}
          >
            해외
          </button>
        </div>
      </div>

      {error && (
        <p className="mx-4 mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs font-semibold text-red-700">
          {error}
        </p>
      )}

      {loading ? (
        <div className="flex items-center justify-center gap-2 py-10 text-sm text-slate-400">
          <Loader2 size={16} className="animate-spin" />
          섹터 데이터 분석 중…
        </div>
      ) : picks.length === 0 ? (
        <div className="py-10 text-center text-sm text-slate-400">
          추천 종목이 없습니다.
        </div>
      ) : (
        <div className="divide-y divide-slate-50">
          {picks.map((pick) => (
            <div key={pick.symbol} className="flex items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="truncate text-sm font-bold text-slate-800">{pick.name}</span>
                  <span className="rounded border border-gray-200 bg-gray-50 px-1.5 py-0.5 font-mono text-[10px] text-gray-500">
                    {pick.symbol}
                  </span>
                  <span className="rounded-full bg-violet-50 px-1.5 py-0.5 text-[9px] font-bold text-violet-600">
                    {pick.sectorName}
                  </span>
                  {pick.changePercent !== null && (
                    <span className={`text-[10px] font-semibold ${pick.changePercent >= 0 ? "text-red-500" : "text-sky-500"}`}>
                      {pick.changePercent >= 0 ? "▲" : "▼"} {Math.abs(pick.changePercent).toFixed(1)}%
                    </span>
                  )}
                </div>
              </div>
              {!isCustomerView && (
                <button
                  type="button"
                  disabled={addingSymbol === pick.symbol}
                  onClick={() => handleAddClick(pick)}
                  className="shrink-0 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-bold text-emerald-700 transition hover:bg-emerald-100 disabled:opacity-50"
                >
                  담기
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
