"use client";

import { useEffect, useRef, useState } from "react";
import { CheckCircle2, FileUp, Loader2, Plus, RotateCcw, Sparkles, X } from "lucide-react";
import type { PortfolioAsset } from "./CustomerContext";

// ─── Constants (탭 2-1 ExistingPortfolioTab 동일 사양) ───────────────────────

const UNIFIED_PRODUCT_TYPES = [
  "국내주식", "해외주식", "국내채권", "해외채권",
  "국내ETF", "해외ETF",
] as const;

const BOND_TYPES = new Set<string>(["국내채권", "해외채권"]);

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
  productType: "해외주식",
  bond_yield: null,
  bond_maturity: null,
};

// ─── Helpers (탭 2-1 ExistingPortfolioTab 완전 동일) ─────────────────────────

function fmtNum(v: number | null | undefined): string {
  if (v == null || v === 0) return "";
  return v.toLocaleString("ko-KR");
}
function fmtDec(v: number | null | undefined): string {
  if (v == null) return "";
  return v.toLocaleString("ko-KR", { maximumFractionDigits: 4 });
}

function deriveAssetClass(unifiedType: string): string {
  switch (unifiedType) {
    case "국내주식":    return "국내주식";
    case "해외주식":    return "해외주식";
    case "국내채권":    return "국내채권";
    case "해외채권":    return "해외채권";
    case "국내ETF":     return "국내주식";
    case "해외ETF":     return "해외주식";
    case "예적금/현금": return "현금";
    case "금":          return "금";
    case "리츠":        return "리츠";
    case "외화":        return "달러";
    case "암호화폐":    return "암호화폐";
    default:            return "해외주식";
  }
}

function deriveCountry(unifiedType: string): string {
  if (unifiedType.startsWith("국내") || unifiedType === "예적금/현금") return "한국";
  if (unifiedType === "외화" || unifiedType === "암호화폐") return "기타";
  if (unifiedType === "금" || unifiedType === "리츠") return "미국";
  return "미국";
}

function toUnifiedProductType(assetClass: string, productType: string): string {
  const isEtf = productType === "ETF";
  if (assetClass === "국내주식") return isEtf ? "국내ETF" : "국내주식";
  if (assetClass === "해외주식") return isEtf ? "해외ETF" : "해외주식";
  if (assetClass === "국내채권") return isEtf ? "국내ETF" : "국내채권";
  if (assetClass === "해외채권") return isEtf ? "해외ETF" : "해외채권";
  if (assetClass === "현금" || assetClass === "달러") return "예적금/현금";
  if (assetClass === "금")          return "금";
  if (assetClass === "리츠")        return "리츠";
  if (productType === "외화")       return "외화";
  if (productType === "암호화폐")   return "암호화폐";
  return isEtf ? "해외ETF" : "해외주식";
}

// ─── Props ───────────────────────────────────────────────────────────────────

interface RebalancingPortfolioInputProps {
  assets: PortfolioAsset[];
  seedAssets: PortfolioAsset[];
  onAssetsChange: (assets: PortfolioAsset[]) => void;
  onConfirm: () => void | Promise<void>;
  isConfirming?: boolean;
  sectionTitle: string;
  sectionBadge: string;
  noticeBanner?: string;
  confirmSuccessMessage: string;
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function RebalancingPortfolioInput({
  assets,
  seedAssets,
  onAssetsChange,
  onConfirm,
  isConfirming = false,
  sectionTitle,
  sectionBadge,
  noticeBanner,
  confirmSuccessMessage,
}: RebalancingPortfolioInputProps) {
  const [confirmed, setConfirmed] = useState(false);
  const [editingTickerIdx, setEditingTickerIdx] = useState<number | null>(null);
  const [inferringIdx, setInferringIdx] = useState<number | null>(null);
  const [toastMsg, setToastMsg] = useState("");
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 자산 목록 변경 시 확정 배너 숨기기
  const prevAssetsRef = useRef(assets);
  useEffect(() => {
    if (prevAssetsRef.current !== assets) {
      setConfirmed(false);
      prevAssetsRef.current = assets;
    }
  });

  // ── 행 조작 ───────────────────────────────────────────────────────────────

  const addRow = () => onAssetsChange([...assets, { ...EMPTY_ASSET }]);
  const removeRow = (i: number) => onAssetsChange(assets.filter((_, idx) => idx !== i));
  const updateRow = (i: number, patch: Partial<PortfolioAsset>) =>
    onAssetsChange(assets.map((a, idx) => (idx === i ? { ...a, ...patch } : a)));

  // ── 초기화 — seedAssets deep-copy ──────────────────────────────────────────

  const handleReset = () => {
    onAssetsChange(seedAssets.map(a => ({ ...a })));
  };

  // ── 토스트 ────────────────────────────────────────────────────────────────

  const showToast = (msg: string) => {
    setToastMsg(msg);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToastMsg(""), 3000);
  };

  // ── Gemini AI 자동 추론 — 탭 2-1 동일 매핑 파이프라인 ────────────────────

  const handleSmartInference = async (idx: number, name: string) => {
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
      const geminiAssetClass  = typeof data.assetClass  === "string" ? data.assetClass  : "";
      const geminiProductType = typeof data.productType === "string" ? data.productType : "";
      const unifiedType = geminiAssetClass
        ? toUnifiedProductType(geminiAssetClass, geminiProductType)
        : undefined;
      updateRow(idx, {
        ticker,
        ...(unifiedType ? {
          productType: unifiedType,
          asset_class: deriveAssetClass(unifiedType),
          country:     deriveCountry(unifiedType),
        } : {}),
        ...(!unifiedType && data.country ? { country: data.country as string } : {}),
        is_hedged: false,
      });
      showToast(`'${name}' → ${ticker} 자동 완성`);
    } catch (err) {
      console.warn("[SmartInference] API 오류:", err);
      showToast("네트워크 오류가 발생했습니다. 수동으로 입력해주세요.");
    } finally {
      setInferringIdx(null);
    }
  };

  // ── 확정 ──────────────────────────────────────────────────────────────────

  const handleConfirmClick = async () => {
    await onConfirm();
    setConfirmed(true);
  };

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
            disabled={isConfirming}
            onClick={handleConfirmClick}
            className="flex items-center gap-2 rounded-lg bg-samsung px-4 py-2.5 text-sm font-bold text-white transition hover:bg-[#1b35bd] disabled:opacity-50"
          >
            {isConfirming
              ? <Loader2 size={16} className="animate-spin" />
              : <CheckCircle2 size={16} />}
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

        {/* 자산 입력 테이블 — 탭 2-1과 동일한 8컬럼 구성 */}
        {assets.length > 0 ? (
          <div className="mt-4 overflow-x-auto rounded-lg border border-slate-200">
            <table className="w-full text-sm">
              <thead className="border-b border-slate-200 bg-slate-50">
                <tr>
                  {[
                    "종목명",
                    "티커",
                    "상품유형",
                    "투자국가",
                    "수량(주/개)",
                    "매수단가(원화)",
                    "채권수익률(%)",
                    "만기(년)",
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
                {assets.map((a, i) => (
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

// ─── AssetRow (탭 2-1 ExistingPortfolioTab AssetRow 완전 동일 사양) ──────────

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
  const isBond = BOND_TYPES.has(a.productType ?? "");

  const handleProductTypeChange = (val: string) => {
    onUpdate(idx, {
      productType: val,
      asset_class: deriveAssetClass(val),
      country:     deriveCountry(val),
      is_hedged:   false,
      ...(!BOND_TYPES.has(val) ? { bond_yield: null, bond_maturity: null } : {}),
    });
  };

  return (
    <tr className="bg-white hover:bg-slate-50">

      {/* 종목명 + Gemini 자동완성 버튼 */}
      <td className="px-3 py-2">
        <div className="flex items-center gap-1">
          <input
            className={[
              "h-9 w-28 rounded border px-2 text-xs text-navy",
              isBond
                ? "cursor-not-allowed border-slate-100 bg-slate-100 text-slate-400"
                : "border-slate-200",
            ].join(" ")}
            placeholder={isBond ? "채권(직접입력불가)" : "종목명"}
            value={isBond ? "" : a.name}
            disabled={isBond}
            onChange={(e) => onUpdate(idx, { name: e.target.value })}
            onBlur={(e) => {
              if (!isBond && e.target.value.trim()) onInfer(idx, e.target.value.trim());
            }}
          />
          <button
            type="button"
            title="Gemini AI 자동 완성"
            disabled={isBond || isInferring || !a.name.trim()}
            onClick={() => onInfer(idx, a.name)}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded border border-violet-200 bg-violet-50 text-violet-500 transition hover:bg-violet-100 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {isInferring
              ? <Loader2 size={13} className="animate-spin" />
              : <Sparkles size={13} />}
          </button>
        </div>
      </td>

      {/* 티커 — 채권일 때 disabled, 아니면 더블클릭 인라인 편집 */}
      <td className="px-3 py-2">
        {isBond ? (
          <span className="flex h-9 min-w-[96px] cursor-not-allowed items-center rounded bg-slate-100 px-2 font-mono text-xs text-slate-400">
            —
          </span>
        ) : editingTicker ? (
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

      {/* 통합 상품유형 (UNIFIED_PRODUCT_TYPES) */}
      <td className="px-3 py-2">
        <select
          className="h-9 rounded border border-slate-200 px-2 text-xs text-navy"
          value={a.productType ?? ""}
          onChange={(e) => handleProductTypeChange(e.target.value)}
        >
          <option value="">선택</option>
          {UNIFIED_PRODUCT_TYPES.map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
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

      {/* 수량(주/개) */}
      <td className="px-3 py-2">
        <input
          type="text"
          inputMode="numeric"
          className="h-9 w-24 rounded border border-slate-200 px-2 text-xs text-navy"
          placeholder="수량"
          value={fmtNum(a.amount)}
          onChange={(e) => {
            const raw = e.target.value.replace(/,/g, "");
            onUpdate(idx, { amount: raw ? Number(raw) : 0, amount_type: "quantity" });
          }}
        />
      </td>

      {/* 매수단가(원화) */}
      <td className="px-3 py-2">
        <input
          type="text"
          inputMode="numeric"
          className="h-9 w-24 rounded border border-slate-200 px-2 text-xs text-navy"
          value={fmtNum(a.buy_price)}
          placeholder="—"
          onChange={(e) => {
            const raw = e.target.value.replace(/,/g, "");
            onUpdate(idx, { buy_price: raw ? Number(raw) : null });
          }}
        />
      </td>

      {/* 채권수익률(%) — 채권 유형일 때만 활성화 */}
      <td className="px-3 py-2">
        <input
          type="text"
          inputMode="decimal"
          className={[
            "h-9 w-20 rounded border px-2 text-xs",
            isBond
              ? "border-slate-200 text-navy"
              : "cursor-not-allowed border-slate-100 bg-slate-100 text-slate-400",
          ].join(" ")}
          placeholder={isBond ? "예: 3.5" : "—"}
          value={isBond ? fmtDec(a.bond_yield) : ""}
          disabled={!isBond}
          onChange={(e) => {
            const raw = e.target.value.replace(/,/g, "");
            onUpdate(idx, { bond_yield: raw ? parseFloat(raw) : null });
          }}
        />
      </td>

      {/* 만기(년) — 채권 유형일 때만 활성화 */}
      <td className="px-3 py-2">
        <input
          type="text"
          inputMode="numeric"
          className={[
            "h-9 w-16 rounded border px-2 text-xs",
            isBond
              ? "border-slate-200 text-navy"
              : "cursor-not-allowed border-slate-100 bg-slate-100 text-slate-400",
          ].join(" ")}
          placeholder={isBond ? "예: 5" : "—"}
          value={isBond ? (a.bond_maturity != null ? a.bond_maturity.toLocaleString("ko-KR") : "") : ""}
          disabled={!isBond}
          onChange={(e) => {
            const raw = e.target.value.replace(/,/g, "");
            onUpdate(idx, { bond_maturity: raw ? Number(raw) : null });
          }}
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
