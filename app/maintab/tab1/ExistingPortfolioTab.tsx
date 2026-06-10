"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FileUp, Loader2, Plus, RefreshCw, Sparkles, X } from "lucide-react";
import { useCustomerContext } from "../CustomerContext";
import type { PortfolioAsset } from "../CustomerContext";

// ─── Constants ───────────────────────────────────────────────────────────────

const ASSET_CLASSES = [
  "국내주식", "해외주식", "국내채권", "해외채권", "금", "리츠", "현금", "달러",
];

const PRODUCT_TYPES = [
  "개별주식", "ETF", "채권", "리츠", "펀드", "현금", "외화", "암호화폐",
];

const COUNTRIES = ["한국", "미국", "일본", "중국", "유럽", "기타"];

const PORTFOLIO_INPUT_KEY = "portfolio-input-assets-v1";

const EMPTY_ASSET: PortfolioAsset = {
  name: "",
  asset_class: "해외주식",
  theme: "기타",
  country: "미국",
  buy_price: null,
  amount: 0,
  amount_type: "quantity",
  is_hedged: false,
  needs_review: false,
  ticker: "",
  productType: "ETF",
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function parseKoreanAmount(str: string): number {
  if (!str) return 0;
  const n = str.replace(/[^0-9.억만천]/g, "");
  let result = 0;
  const eok = n.match(/([0-9.]+)억/);
  const man = n.match(/([0-9.]+)만/);
  if (eok) result += parseFloat(eok[1]) * 1e8;
  if (man) result += parseFloat(man[1]) * 1e4;
  if (!eok && !man) result = parseFloat(n.replace(/[^0-9.]/g, "")) || 0;
  return result;
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function ExistingPortfolioTab() {
  const { formData } = useCustomerContext();

  const [portfolioAssets, setPortfolioAssets] = useState<PortfolioAsset[]>([]);
  // isLoaded 는 State → 다음 렌더까지 반영이 지연됨 = save effect의 초기 [] 덮어쓰기 차단 키
  const [isLoaded, setIsLoaded] = useState(false);
  const [portfolioIsRunning, setPortfolioIsRunning] = useState(false);
  const [portfolioStatusMsg, setPortfolioStatusMsg] = useState("");
  const [portfolioErrorMsg, setPortfolioErrorMsg] = useState("");
  const [analysisComplete, setAnalysisComplete] = useState(false);

  // 티커 셀 더블클릭 인라인 편집
  const [editingTickerIdx, setEditingTickerIdx] = useState<number | null>(null);

  // Gemini 자동완성 추론 중 행 인덱스
  const [inferringIdx, setInferringIdx] = useState<number | null>(null);

  // 토스트 메시지
  const [toastMsg, setToastMsg] = useState("");

  const fileInputRef = useRef<HTMLInputElement>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── 영속화 ────────────────────────────────────────────────────────────────
  //
  // 경쟁 조건 방지 구조:
  //   1) 마운트 effect(deps=[]) → localStorage 복원 후 setIsLoaded(true) 예약
  //   2) 저장 effect(deps=[portfolioAssets, isLoaded]) → isLoaded가 false면 즉시 return
  //
  // isLoaded는 State이므로 같은 커밋 배치 내 save effect가 실행될 때 아직 false 유지됨.
  // 따라서 초기 [] 가 localStorage 를 덮어쓰는 일이 원천 차단된다.

  // (1) 마운트 시 복원
  useEffect(() => {
    try {
      const stored = localStorage.getItem(PORTFOLIO_INPUT_KEY);
      if (stored) {
        const parsed = JSON.parse(stored) as PortfolioAsset[];
        if (Array.isArray(parsed) && parsed.length > 0) {
          setPortfolioAssets(parsed);
        }
      }
    } catch {}
    setIsLoaded(true); // State 업데이트 → 다음 렌더에서야 반영
  }, []);

  // (2) 변경 시 실시간 저장 — isLoaded=false(초기 렌더 배치) 구간은 건너뜀
  useEffect(() => {
    if (!isLoaded) return;
    try {
      localStorage.setItem(PORTFOLIO_INPUT_KEY, JSON.stringify(portfolioAssets));
    } catch {}
  }, [portfolioAssets, isLoaded]);

  // ── 한계세율 추정 ─────────────────────────────────────────────────────────

  const tMarginal = useMemo(() => {
    const total = parseKoreanAmount(formData.financial.totalAssets);
    if (total >= 5e9) return 0.45;
    if (total >= 3e9) return 0.40;
    if (total >= 1.2e9) return 0.35;
    return 0.38;
  }, [formData.financial.totalAssets]);

  // ── 분석 실행 ─────────────────────────────────────────────────────────────

  const triggerAnalysis = useCallback(
    async (assets: PortfolioAsset[]) => {
      if (!assets.length) return;
      setPortfolioIsRunning(true);
      setPortfolioErrorMsg("");
      setPortfolioStatusMsg("환율 조회 중...");
      try {
        const { runAnalysis } = await import("@/lib/portfolioLogic");
        setPortfolioStatusMsg("실시간 시세 조회 중...");
        const result = await runAnalysis(assets, {
          tMarginal,
          expectedInterestIncome: formData.rrttllu.expectedInterestIncome,
          expectedDividendIncome: formData.rrttllu.expectedDividendIncome,
        });
        if (!result) {
          setPortfolioStatusMsg("");
          setPortfolioErrorMsg("자산 총액이 0원입니다. 수량과 매수단가를 입력해 주세요.");
          return;
        }
        try {
          localStorage.setItem("portfolio-result-v1", JSON.stringify(result));
          window.dispatchEvent(new CustomEvent("portfolio-result-updated"));
        } catch {}
        setAnalysisComplete(true);
        setPortfolioStatusMsg("");
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "분석 오류가 발생했습니다.";
        setPortfolioErrorMsg(msg);
        setPortfolioStatusMsg("");
      } finally {
        setPortfolioIsRunning(false);
      }
    },
    [tMarginal, formData.rrttllu.expectedInterestIncome, formData.rrttllu.expectedDividendIncome]
  );

  // ── 행 조작 ───────────────────────────────────────────────────────────────

  const addRow = () => setPortfolioAssets((prev) => [...prev, { ...EMPTY_ASSET }]);
  const removeRow = (i: number) => setPortfolioAssets((prev) => prev.filter((_, idx) => idx !== i));
  const updateRow = useCallback(
    (i: number, patch: Partial<PortfolioAsset>) =>
      setPortfolioAssets((prev) => prev.map((a, idx) => (idx === i ? { ...a, ...patch } : a))),
    []
  );

  // ── 토스트 ────────────────────────────────────────────────────────────────

  const showToast = useCallback((msg: string) => {
    setToastMsg(msg);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToastMsg(""), 3000);
  }, []);

  // ── 지능형 추론 (Gemini AI 연동) ─────────────────────────────────────────

  const handleSmartInference = useCallback(
    async (idx: number, name: string) => {
      if (!name.trim()) return;
      setInferringIdx(idx);
      showToast(`'${name}' 분석 중...`);

      try {
        const res = await fetch(`/api/proxy-finance?assetName=${encodeURIComponent(name)}`);
        const data = await res.json();

        if (!res.ok) {
          showToast(data?.error ?? `오류 (${res.status})`);
          return;
        }

        const ticker = typeof data.ticker === "string" && data.ticker ? data.ticker : "";
        if (!ticker) {
          showToast(`'${name}'의 티커를 찾을 수 없습니다. 수동으로 입력해주세요.`);
          return;
        }

        updateRow(idx, {
          ticker,
          ...(data.assetClass  ? { asset_class: data.assetClass  as string } : {}),
          ...(data.productType ? { productType: data.productType as string } : {}),
          ...(data.country     ? { country:     data.country     as string } : {}),
        });
        showToast(`'${name}' → ${ticker} 자동 완성`);
      } catch (err) {
        console.warn("[SmartInference] API 오류:", err);
        showToast("네트워크 오류가 발생했습니다. 수동으로 입력해주세요.");
      } finally {
        setInferringIdx(null);
      }
    },
    [showToast, updateRow]
  );

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="space-y-5">
      <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-soft">

        {/* 헤더 */}
        <div className="mb-4 flex items-start gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-samsung">
            <FileUp size={18} />
          </div>
          <div>
            <p className="text-xs font-bold uppercase tracking-normal text-slate-500">정량 분석 엔진</p>
            <h2 className="mt-1 text-lg font-bold text-navy">자산 입력 및 분석 실행</h2>
          </div>
        </div>

        <input ref={fileInputRef} type="file" accept=".pdf" className="hidden" />

        {/* 액션 버튼 */}
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            disabled={portfolioIsRunning || !portfolioAssets.length}
            onClick={() => triggerAnalysis(portfolioAssets)}
            className="flex items-center gap-2 rounded-lg bg-samsung px-4 py-2.5 text-sm font-bold text-white transition hover:bg-[#1b35bd] disabled:opacity-50"
          >
            {portfolioIsRunning ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
            분석 실행
          </button>
          <button
            type="button"
            onClick={addRow}
            className="flex items-center gap-2 rounded-lg border border-slate-200 px-4 py-2.5 text-sm font-bold text-slate-600 transition hover:bg-slate-50"
          >
            <Plus size={16} />
            자산 추가
          </button>
        </div>

        {/* 상태 메시지 */}
        {portfolioStatusMsg && (
          <p className="mt-3 rounded-lg bg-blue-50 px-4 py-2.5 text-sm font-semibold text-blue-800">
            <Loader2 size={14} className="mr-2 inline animate-spin" />
            {portfolioStatusMsg}
          </p>
        )}
        {portfolioErrorMsg && (
          <p className="mt-3 rounded-lg bg-red-50 px-4 py-2.5 text-sm font-semibold text-red-700">
            오류: {portfolioErrorMsg}
          </p>
        )}

        {/* Gemini 토스트 */}
        {toastMsg && (
          <div className="mt-3 flex items-center gap-2 rounded-lg border border-violet-200 bg-violet-50 px-4 py-2.5 text-sm font-semibold text-violet-800">
            <Sparkles size={14} className="shrink-0 text-violet-500" />
            {toastMsg}
          </div>
        )}

        {/* 자산 입력 테이블 */}
        {portfolioAssets.length > 0 ? (
          <div className="mt-4 overflow-x-auto rounded-lg border border-slate-200">
            <table className="w-full text-sm">
              <thead className="border-b border-slate-200 bg-slate-50">
                <tr>
                  {[
                    "종목명",
                    "티커",
                    "상품유형",
                    "투자국가",
                    "자산군",
                    "수량(주/개)",
                    "매수단가(원화)",
                    "환헤지",
                    "",
                  ].map((h) => (
                    <th
                      key={h}
                      className="whitespace-nowrap px-3 py-2.5 text-left text-xs font-bold text-slate-500"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {portfolioAssets.map((a, i) => (
                  <AssetRow
                    key={i}
                    idx={i}
                    asset={a}
                    isInferring={inferringIdx === i}
                    editingTicker={editingTickerIdx === i}
                    onUpdate={updateRow}
                    onRemove={removeRow}
                    onInfer={handleSmartInference}
                    onStartEditTicker={() => setEditingTickerIdx(i)}
                    onEndEditTicker={() => setEditingTickerIdx(null)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="mt-4 rounded-lg border border-dashed border-slate-300 p-8 text-center">
            <FileUp size={32} className="mx-auto mb-3 text-slate-300" />
            <p className="text-sm font-semibold text-slate-400">
              자산을 추가하여 포트폴리오 분석을 시작하세요.
            </p>
          </div>
        )}

        {analysisComplete && !portfolioIsRunning && (
          <div className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2.5">
            <p className="text-sm font-semibold text-emerald-800">
              분석 완료 — <span className="font-bold">분산 및 위험 분석</span> 탭 또는{" "}
              <span className="font-bold">4. 포트폴리오 비교</span> 탭에서 결과를 확인하세요.
            </p>
          </div>
        )}
      </section>
    </div>
  );
}

// ─── AssetRow (행 분리로 재렌더 최소화) ──────────────────────────────────────

interface AssetRowProps {
  idx: number;
  asset: PortfolioAsset;
  isInferring: boolean;
  editingTicker: boolean;
  onUpdate: (i: number, patch: Partial<PortfolioAsset>) => void;
  onRemove: (i: number) => void;
  onInfer: (idx: number, name: string) => void;
  onStartEditTicker: () => void;
  onEndEditTicker: () => void;
}

function AssetRow({
  idx, asset: a, isInferring, editingTicker,
  onUpdate, onRemove, onInfer, onStartEditTicker, onEndEditTicker,
}: AssetRowProps) {
  return (
    <tr className="bg-white hover:bg-slate-50">

      {/* 종목명 + 자동완성 버튼 */}
      <td className="px-3 py-2">
        <div className="flex items-center gap-1">
          <input
            className="h-9 w-28 rounded border border-slate-200 px-2 text-xs text-navy"
            placeholder="종목명"
            value={a.name}
            onChange={(e) => onUpdate(idx, { name: e.target.value })}
            onBlur={(e) => {
              if (e.target.value.trim()) onInfer(idx, e.target.value.trim());
            }}
          />
          <button
            type="button"
            title="Gemini AI 자동 완성"
            disabled={isInferring || !a.name.trim()}
            onClick={() => onInfer(idx, a.name)}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded border border-violet-200 bg-violet-50 text-violet-500 transition hover:bg-violet-100 disabled:opacity-40"
          >
            {isInferring
              ? <Loader2 size={13} className="animate-spin" />
              : <Sparkles size={13} />}
          </button>
        </div>
      </td>

      {/* 티커 — 더블클릭으로 인라인 편집 */}
      <td className="px-3 py-2">
        {editingTicker ? (
          <input
            autoFocus
            className="h-9 w-28 rounded border border-blue-300 bg-blue-50 px-2 text-xs font-mono text-navy outline-none"
            value={a.ticker ?? ""}
            onChange={(e) => onUpdate(idx, { ticker: e.target.value })}
            onBlur={onEndEditTicker}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === "Escape") onEndEditTicker(); }}
          />
        ) : (
          <span
            title="더블클릭으로 직접 수정"
            onDoubleClick={onStartEditTicker}
            className="flex h-9 min-w-[96px] cursor-pointer select-none items-center rounded px-2 font-mono text-xs text-slate-700 hover:bg-slate-100"
          >
            {a.ticker || <span className="text-slate-300">—</span>}
          </span>
        )}
      </td>

      {/* 상품유형 */}
      <td className="px-3 py-2">
        <select
          className="h-9 rounded border border-slate-200 px-2 text-xs text-navy"
          value={a.productType ?? ""}
          onChange={(e) => onUpdate(idx, { productType: e.target.value })}
        >
          <option value="">선택</option>
          {PRODUCT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
      </td>

      {/* 투자국가 */}
      <td className="px-3 py-2">
        <select
          className="h-9 rounded border border-slate-200 px-2 text-xs text-navy"
          value={a.country}
          onChange={(e) => onUpdate(idx, { country: e.target.value })}
        >
          {COUNTRIES.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      </td>

      {/* 자산군 */}
      <td className="px-3 py-2">
        <select
          className="h-9 rounded border border-slate-200 px-2 text-xs text-navy"
          value={a.asset_class}
          onChange={(e) => onUpdate(idx, { asset_class: e.target.value })}
        >
          {ASSET_CLASSES.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      </td>

      {/* 수량(주/개) */}
      <td className="px-3 py-2">
        <input
          type="number"
          className="h-9 w-24 rounded border border-slate-200 px-2 text-xs text-navy"
          placeholder="수량"
          value={a.amount || ""}
          onChange={(e) => {
            const qty = Number(e.target.value);
            onUpdate(idx, { amount: qty, amount_type: "quantity" });
          }}
        />
      </td>

      {/* 매수단가(원화) */}
      <td className="px-3 py-2">
        <input
          type="number"
          className="h-9 w-24 rounded border border-slate-200 px-2 text-xs text-navy"
          value={a.buy_price ?? ""}
          placeholder="—"
          onChange={(e) => onUpdate(idx, { buy_price: e.target.value ? Number(e.target.value) : null })}
        />
      </td>

      {/* 환헤지 */}
      <td className="px-3 py-2 text-center">
        <input
          type="checkbox"
          checked={a.is_hedged}
          onChange={(e) => onUpdate(idx, { is_hedged: e.target.checked })}
          className="h-4 w-4 accent-samsung"
        />
      </td>

      {/* 삭제 */}
      <td className="px-3 py-2">
        <button
          type="button"
          onClick={() => onRemove(idx)}
          className="flex h-8 w-8 items-center justify-center rounded border border-slate-200 text-slate-400 hover:border-red-200 hover:text-red-600"
        >
          <X size={14} />
        </button>
      </td>
    </tr>
  );
}
