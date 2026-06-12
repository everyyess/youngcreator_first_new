"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CheckCircle2, FileUp, Loader2, Plus, RotateCcw, Sparkles, X } from "lucide-react";
import type { PortfolioAsset } from "./CustomerContext";

// ─── Constants ───────────────────────────────────────────────────────────────

const ASSET_CLASSES = [
  "국내주식", "해외주식", "국내채권", "해외채권", "금", "리츠", "현금", "달러",
];

const PRODUCT_TYPES = [
  "개별주식", "ETF", "채권", "리츠", "펀드", "현금", "외화", "암호화폐",
];

const COUNTRIES = ["한국", "미국", "일본", "중국", "유럽", "기타"];

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

// ─── Props ───────────────────────────────────────────────────────────────────

interface RebalancingPortfolioInputProps {
  seedStorageKey: string;
  storageKey: string;
  sectionTitle: string;
  sectionBadge: string;
  noticeBanner?: string;
  confirmSuccessMessage: string;
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function RebalancingPortfolioInput({
  seedStorageKey,
  storageKey,
  sectionTitle,
  sectionBadge,
  noticeBanner,
  confirmSuccessMessage,
}: RebalancingPortfolioInputProps) {
  const [portfolioAssets, setPortfolioAssets] = useState<PortfolioAsset[]>([]);
  const [isLoaded, setIsLoaded] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [editingTickerIdx, setEditingTickerIdx] = useState<number | null>(null);
  const [inferringIdx, setInferringIdx] = useState<number | null>(null);
  const [toastMsg, setToastMsg] = useState("");
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── 영속화 ────────────────────────────────────────────────────────────────
  // 자신의 storageKey에 데이터가 있으면 그것을 사용, 없으면 seedStorageKey에서 복사

  useEffect(() => {
    try {
      const stored = localStorage.getItem(storageKey);
      if (stored) {
        const parsed = JSON.parse(stored) as PortfolioAsset[];
        if (Array.isArray(parsed) && parsed.length > 0) {
          setPortfolioAssets(parsed);
          setIsLoaded(true);
          return;
        }
      }
      // 자신의 key가 없으면 seed key에서 복사 (한 번만)
      const seed = localStorage.getItem(seedStorageKey);
      if (seed) {
        const parsed = JSON.parse(seed) as PortfolioAsset[];
        if (Array.isArray(parsed) && parsed.length > 0) {
          setPortfolioAssets(parsed);
        }
      }
    } catch {}
    setIsLoaded(true);
  }, [storageKey, seedStorageKey]);

  // 변경 시 자신의 storageKey에만 저장 (seed key는 절대 건드리지 않음)
  useEffect(() => {
    if (!isLoaded) return;
    try {
      localStorage.setItem(storageKey, JSON.stringify(portfolioAssets));
    } catch {}
    setConfirmed(false);
  }, [portfolioAssets, isLoaded, storageKey]);

  // ── 초기화 — seed key에서 다시 복사 ──────────────────────────────────────

  const handleReset = useCallback(() => {
    try {
      const seed = localStorage.getItem(seedStorageKey);
      if (seed) {
        const parsed = JSON.parse(seed) as PortfolioAsset[];
        if (Array.isArray(parsed)) {
          setPortfolioAssets(parsed);
        }
      }
    } catch {}
  }, [seedStorageKey]);

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

  // ── Gemini AI 자동 추론 ───────────────────────────────────────────────────

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
      {/* 안내 배너 */}
      {noticeBanner && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          {noticeBanner}
        </div>
      )}

      <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-soft">
        {/* 헤더 */}
        <div className="mb-4 flex items-start gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-samsung">
            <FileUp size={18} />
          </div>
          <div>
            <p className="text-xs font-bold uppercase tracking-normal text-slate-500">{sectionBadge}</p>
            <h2 className="mt-1 text-lg font-bold text-navy">{sectionTitle}</h2>
          </div>
        </div>

        {/* 액션 버튼 */}
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => setConfirmed(true)}
            className="flex items-center gap-2 rounded-lg bg-samsung px-4 py-2.5 text-sm font-bold text-white transition hover:bg-[#1b35bd]"
          >
            <CheckCircle2 size={16} />
            리밸런싱 확정
          </button>
          <button
            type="button"
            onClick={addRow}
            className="flex items-center gap-2 rounded-lg border border-slate-200 px-4 py-2.5 text-sm font-bold text-slate-600 transition hover:bg-slate-50"
          >
            <Plus size={16} />
            자산 추가
          </button>
          <button
            type="button"
            onClick={handleReset}
            title="원본 데이터로 초기화"
            className="flex items-center gap-2 rounded-lg border border-amber-200 px-4 py-2.5 text-sm font-bold text-amber-600 transition hover:bg-amber-50"
          >
            <RotateCcw size={16} />
            초기화
          </button>
        </div>

        {/* Gemini 토스트 */}
        {toastMsg && (
          <div className="mt-3 flex items-center gap-2 rounded-lg border border-violet-200 bg-violet-50 px-4 py-2.5 text-sm font-semibold text-violet-800">
            <Sparkles size={14} className="shrink-0 text-violet-500" />
            {toastMsg}
          </div>
        )}

        {/* 확정 완료 배너 */}
        {confirmed && (
          <div className="mt-3 flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-sm font-semibold text-emerald-800">
            <CheckCircle2 size={15} className="shrink-0 text-emerald-600" />
            {confirmSuccessMessage}
          </div>
        )}

        {/* 자산 입력 테이블 */}
        {portfolioAssets.length > 0 ? (
          <div className="mt-4 overflow-x-auto rounded-lg border border-slate-200">
            <table className="w-full text-sm">
              <thead className="border-b border-slate-200 bg-slate-50">
                <tr>
                  {["종목명", "티커", "상품유형", "투자국가", "자산군", "수량(주/개)", "매수단가(원화)", "환헤지", ""].map((h) => (
                    <th key={h} className="whitespace-nowrap px-3 py-2.5 text-left text-xs font-bold text-slate-500">
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
              자산을 추가하거나 초기화 버튼으로 기존 포트폴리오를 불러오세요.
            </p>
          </div>
        )}
      </section>
    </div>
  );
}

// ─── AssetRow ─────────────────────────────────────────────────────────────────

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
      <td className="px-3 py-2">
        <div className="flex items-center gap-1">
          <input
            className="h-9 w-28 rounded border border-slate-200 px-2 text-xs text-navy"
            placeholder="종목명"
            value={a.name}
            onChange={(e) => onUpdate(idx, { name: e.target.value })}
            onBlur={(e) => { if (e.target.value.trim()) onInfer(idx, e.target.value.trim()); }}
          />
          <button
            type="button"
            title="Gemini AI 자동 완성"
            disabled={isInferring || !a.name.trim()}
            onClick={() => onInfer(idx, a.name)}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded border border-violet-200 bg-violet-50 text-violet-500 transition hover:bg-violet-100 disabled:opacity-40"
          >
            {isInferring ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />}
          </button>
        </div>
      </td>

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

      <td className="px-3 py-2">
        <select
          className="h-9 rounded border border-slate-200 px-2 text-xs text-navy"
          value={a.country}
          onChange={(e) => onUpdate(idx, { country: e.target.value })}
        >
          {COUNTRIES.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      </td>

      <td className="px-3 py-2">
        <select
          className="h-9 rounded border border-slate-200 px-2 text-xs text-navy"
          value={a.asset_class}
          onChange={(e) => onUpdate(idx, { asset_class: e.target.value })}
        >
          {ASSET_CLASSES.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      </td>

      <td className="px-3 py-2">
        <input
          type="number"
          className="h-9 w-24 rounded border border-slate-200 px-2 text-xs text-navy"
          placeholder="수량"
          value={a.amount || ""}
          onChange={(e) => onUpdate(idx, { amount: Number(e.target.value), amount_type: "quantity" })}
        />
      </td>

      <td className="px-3 py-2">
        <input
          type="number"
          className="h-9 w-24 rounded border border-slate-200 px-2 text-xs text-navy"
          value={a.buy_price ?? ""}
          placeholder="—"
          onChange={(e) => onUpdate(idx, { buy_price: e.target.value ? Number(e.target.value) : null })}
        />
      </td>

      <td className="px-3 py-2 text-center">
        <input
          type="checkbox"
          checked={a.is_hedged}
          onChange={(e) => onUpdate(idx, { is_hedged: e.target.checked })}
          className="h-4 w-4 accent-samsung"
        />
      </td>

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
