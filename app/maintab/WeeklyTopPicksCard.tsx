"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Camera, FileText, Loader2, Star } from "lucide-react";

export interface WeeklyPick {
  name: string;
  recommendedDate: string | null;
  returnPct: number | null;
  thesis: string | null;
  isNew: boolean;
  isNonCoverage: boolean;
}

interface Props {
  isCustomerView: boolean;
  onAdd: (pick: { name: string; ticker: string; isGlobal: boolean }) => void;
}

// pick.name → { value, loading } — Yahoo Finance regularMarketChangePercent(전일 대비 등락률)
type ChangeState = { value: number | null; loading: boolean };

export function WeeklyTopPicksCard({ isCustomerView, onAdd }: Props) {
  const [picks, setPicks] = useState<WeeklyPick[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [resolvingName, setResolvingName] = useState<string | null>(null);
  const [changePercents, setChangePercents] = useState<Record<string, ChangeState>>({});

  const pdfInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);

  // 마운트 시 서버에 저장된 최신 리스트(전사 공용) 로드
  useEffect(() => {
    let alive = true;
    fetch("/api/weekly-picks")
      .then((r) => r.json())
      .then((data) => {
        if (!alive) return;
        const saved = Array.isArray(data?.picks) ? (data.picks as WeeklyPick[]) : [];
        if (saved.length > 0) setPicks(saved);
      })
      .catch(() => { /* 저장된 리스트가 없으면 빈 상태 유지 */ });
    return () => { alive = false; };
  }, []);

  // picks 목록이 바뀔 때마다 종목별 실시간 등락률(전일 대비) 조회 — 리포트에 찍힌 "추천일 대비"
  // 정적 수치 대신, 오늘 기준 실제 시세 변동을 보여준다. 종목별로 독립적으로 채워짐(일부 실패해도 나머지는 표시).
  useEffect(() => {
    let alive = true;
    const targets = picks.filter((p) => !(p.name in changePercents));
    if (targets.length === 0) return;

    setChangePercents((prev) => {
      const next = { ...prev };
      for (const p of targets) next[p.name] = { value: null, loading: true };
      return next;
    });

    targets.forEach((p) => {
      fetch(`/api/proxy-finance?assetName=${encodeURIComponent(p.name)}`)
        .then((r) => r.json())
        .then((data) => {
          if (!alive) return;
          const pct = data?.chart?.result?.[0]?.meta?.regularMarketChangePercent;
          setChangePercents((prev) => ({
            ...prev,
            [p.name]: { value: typeof pct === "number" ? pct : null, loading: false },
          }));
        })
        .catch(() => {
          if (!alive) return;
          setChangePercents((prev) => ({ ...prev, [p.name]: { value: null, loading: false } }));
        });
    });

    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [picks]);

  const uploadFile = useCallback(async (file: File) => {
    setLoading(true);
    setError("");
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/weekly-picks-ocr", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error ?? `업로드 실패 (${res.status})`);
        return;
      }
      const newPicks = Array.isArray(data.picks) ? (data.picks as WeeklyPick[]) : [];
      if (newPicks.length === 0) {
        setError("리포트에서 '주간 추천 종목' 표를 찾지 못했습니다.");
        return;
      }
      setPicks(newPicks);

      // 전사 공용 저장 — 실패해도 화면 표시는 그대로 유지, 안내만 표시
      try {
        const saveRes = await fetch("/api/weekly-picks", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ picks: newPicks }),
        });
        if (!saveRes.ok) {
          const saveData = await saveRes.json().catch(() => null);
          setError(`목록은 표시됐지만 저장에 실패했습니다: ${saveData?.error ?? saveRes.status}`);
        }
      } catch {
        setError("목록은 표시됐지만 서버 저장 중 네트워크 오류가 발생했습니다.");
      }
    } catch {
      setError("네트워크 오류가 발생했습니다.");
    } finally {
      setLoading(false);
    }
  }, []);

  const handlePdfChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (file) void uploadFile(file);
  }, [uploadFile]);

  const handleImageChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (file) void uploadFile(file);
  }, [uploadFile]);

  const handleAddClick = useCallback(async (pick: WeeklyPick) => {
    setResolvingName(pick.name);
    try {
      const res = await fetch(`/api/proxy-finance?assetName=${encodeURIComponent(pick.name)}`);
      const data = await res.json();
      const ticker = typeof data?.ticker === "string" ? data.ticker : "";
      if (!res.ok || !ticker) {
        setError(`'${pick.name}'의 티커를 찾을 수 없습니다.`);
        return;
      }
      const isGlobal = !ticker.endsWith(".KS") && !ticker.endsWith(".KQ");
      onAdd({ name: pick.name, ticker, isGlobal });
    } catch {
      setError(`'${pick.name}' 조회 중 오류가 발생했습니다.`);
    } finally {
      setResolvingName(null);
    }
  }, [onAdd]);

  return (
    <div className="rounded-xl border border-slate-200 bg-white shadow-soft">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
        <div className="flex items-center gap-2">
          <Star size={16} className="text-amber-500" />
          <span className="text-sm font-bold text-navy">자사 추천 종목</span>
          <span className="text-[10px] text-slate-400">삼성증권 주간 투자 전략 · 등락률은 전일 대비(실시간)</span>
        </div>
        {!isCustomerView && (
          <div className="flex items-center gap-2">
            <input
              ref={pdfInputRef}
              type="file"
              accept="application/pdf"
              className="hidden"
              onChange={handlePdfChange}
            />
            <input
              ref={imageInputRef}
              type="file"
              accept="image/jpeg,image/jpg,image/png,image/webp"
              className="hidden"
              onChange={handleImageChange}
            />
            <button
              type="button"
              disabled={loading}
              onClick={() => imageInputRef.current?.click()}
              className="flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-bold text-slate-600 transition hover:bg-slate-50 disabled:opacity-50"
            >
              {loading ? <Loader2 size={14} className="animate-spin" /> : <Camera size={14} />}
              스크린샷으로 추가
            </button>
            <button
              type="button"
              disabled={loading}
              onClick={() => pdfInputRef.current?.click()}
              className="flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-bold text-slate-600 transition hover:bg-slate-50 disabled:opacity-50"
            >
              {loading ? <Loader2 size={14} className="animate-spin" /> : <FileText size={14} />}
              PDF로 추가
            </button>
          </div>
        )}
      </div>

      {error && (
        <p className="mx-4 mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs font-semibold text-red-700">
          {error}
        </p>
      )}

      {loading ? (
        <div className="flex items-center justify-center gap-2 py-10 text-sm text-slate-400">
          <Loader2 size={16} className="animate-spin" />
          리포트에서 추천 종목 분석 중…
        </div>
      ) : picks.length === 0 ? (
        <div className="py-10 text-center text-sm text-slate-400">
          추천 종목이 없습니다.
        </div>
      ) : (
        <div className="divide-y divide-slate-50">
          {picks.map((pick) => (
            <div key={pick.name} className="flex items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="truncate text-sm font-bold text-slate-800">{pick.name}</span>
                  {pick.isNew && (
                    <span className="rounded-full bg-red-100 px-1.5 py-0.5 text-[9px] font-bold text-red-600">NEW</span>
                  )}
                  {pick.isNonCoverage && (
                    <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[9px] font-bold text-slate-500">비커버리지</span>
                  )}
                  {pick.recommendedDate && (
                    <span className="text-[10px] text-slate-400">{pick.recommendedDate} 추천</span>
                  )}
                  {(() => {
                    const c = changePercents[pick.name];
                    if (!c || (c.loading && c.value === null)) {
                      return c?.loading ? <Loader2 size={10} className="animate-spin text-slate-300" /> : null;
                    }
                    if (c.value === null) return null; // 티커 조회 실패 — 조용히 생략(정적 returnPct로 폴백 안 함)
                    return (
                      <span className={`text-[10px] font-semibold ${c.value >= 0 ? "text-red-500" : "text-sky-500"}`}>
                        {c.value >= 0 ? "▲" : "▼"} {Math.abs(c.value).toFixed(1)}%
                      </span>
                    );
                  })()}
                </div>
                {pick.thesis && (
                  <p className="mt-0.5 truncate text-xs text-slate-500">{pick.thesis}</p>
                )}
              </div>
              {!isCustomerView && (
                <button
                  type="button"
                  disabled={resolvingName === pick.name}
                  onClick={() => handleAddClick(pick)}
                  className="shrink-0 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-bold text-emerald-700 transition hover:bg-emerald-100 disabled:opacity-50"
                >
                  {resolvingName === pick.name ? <Loader2 size={14} className="animate-spin" /> : "담기"}
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
