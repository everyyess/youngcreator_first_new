"use client";

import { useEffect, useState } from "react";

// TAB3-1(리밸런싱-주식)의 WeeklyTopPicksCard·AiStockPicksCard와 같은 데이터 소스를 그대로 재사용한다.
// 둘 다 특정 고객과 무관한 전사 공용/실시간 스캐너 데이터라, 분석실 쪽에서 별도 전달 없이 바로 조회할 수 있다.

export interface WeeklyPickLite { name: string }
export interface AiPickLite { symbol: string; name: string }

type ScannerStock = { symbol: string; name: string; changePercent: number | null };
type ScannerSector = { changePercent: number | null; stocks: ScannerStock[] };
type ScannerResponse = { sectors?: ScannerSector[] };

const TOP_SECTOR_COUNT = 5;
const STOCKS_PER_SECTOR = 2;
const MAX_AI_PICKS = 12;

function flattenTopSectors(data: ScannerResponse | null): AiPickLite[] {
  if (!data?.sectors) return [];
  const topSectors = [...data.sectors]
    .filter((s) => s.changePercent !== null)
    .sort((a, b) => (b.changePercent ?? 0) - (a.changePercent ?? 0))
    .slice(0, TOP_SECTOR_COUNT);
  return topSectors.flatMap((sector) =>
    [...sector.stocks]
      .filter((s) => s.changePercent !== null)
      .sort((a, b) => (b.changePercent ?? 0) - (a.changePercent ?? 0))
      .slice(0, STOCKS_PER_SECTOR)
      .map((s) => ({ symbol: s.symbol, name: s.name }))
  );
}

// includeGlobalAi=false면 AI 추천은 국내 섹터만 조회한다(예: 공시 분석은 국내 상장사만 다뤄서
// 해외 종목을 추천해봤자 조회할 공시 자체가 없다).
export function useRecommendedPicks(includeGlobalAi: boolean = true) {
  const [weeklyPicks, setWeeklyPicks] = useState<WeeklyPickLite[]>([]);
  const [aiPicks, setAiPicks] = useState<AiPickLite[]>([]);

  useEffect(() => {
    let alive = true;
    fetch("/api/weekly-picks")
      .then((r) => r.json())
      .then((data) => {
        if (!alive) return;
        const saved = Array.isArray(data?.picks) ? (data.picks as WeeklyPickLite[]) : [];
        setWeeklyPicks(saved);
      })
      .catch(() => { /* 저장된 리스트가 없으면 빈 상태 유지 */ });
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    let alive = true;
    const requests = [fetch("/api/sector-scanner?market=domestic").then((r) => r.json()).catch(() => null)];
    if (includeGlobalAi) requests.push(fetch("/api/sector-scanner?market=global").then((r) => r.json()).catch(() => null));
    Promise.all(requests).then((results) => {
      if (!alive) return;
      const merged = results.flatMap((r) => flattenTopSectors(r as ScannerResponse | null));
      setAiPicks(merged.slice(0, MAX_AI_PICKS));
    }).catch(() => {});
    return () => { alive = false; };
  }, [includeGlobalAi]);

  return { weeklyPicks, aiPicks };
}
