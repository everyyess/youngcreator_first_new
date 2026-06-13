"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FileUp, Loader2, Plus, RefreshCw, Sparkles, X } from "lucide-react";
import {
  useCustomerContext,
  parseKrwAmount,
  saveAnalysisResult,
} from "../CustomerContext";
import type { PortfolioAsset } from "../CustomerContext";
import {
  calcFinancialIncomeSummary,
  FINANCIAL_INCOME_STORAGE_KEY,
  type AssetForIncomeCalc,
} from "./FinancialIncomeGauge";

// ─────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────

const ASSET_CLASSES = [
  "국내주식", "해외주식", "국내채권", "해외채권", "금", "리츠", "달러", "기타",
];

const PRODUCT_TYPES = [
  "주식형", "ETF", "채권형", "리츠", "달러", "금", "예금", "암호화폐",
];

const UNIFIED_PRODUCT_TYPES = [
  "국내주식", "해외주식", "국내채권", "해외채권",
  "국내ETF", "해외ETF",
] as const;

const COUNTRIES = ["국내", "미국", "일본", "중국", "유럽", "기타"];

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

// AssetRow 에서 채권 여부 판별에 사용 (기존 로직 유지)
const BOND_TYPES = new Set<string>(["국내채권", "해외채권"]);

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
  if (assetClass === "금")      return "금";
  if (assetClass === "리츠")    return "리츠";
  if (productType === "외화")   return "외화";
  if (productType === "암호화폐") return "암호화폐";
  return isEtf ? "해외ETF" : "해외주식";
}

// dividendYield를 포함한 확장 타입 (로컬 캐스팅용)
interface PortfolioAssetEnriched extends PortfolioAsset {
  dividendYield?: number;
  trailingAnnualDividendRate?: number;
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function ExistingPortfolioTab() {
  const {
    formData, selectedCustomer,
    portfolioAssets, isPortfolioLoaded,
    addPortfolioRow: addRow,
    removePortfolioRow: removeRow,
    updatePortfolioRow: updateRow,
    setAnalysisResult,
    setPortfolioDirty,
    pushToRebalancingSell,
  } = useCustomerContext();

  const [portfolioIsRunning, setPortfolioIsRunning] = useState(false);
  const [portfolioStatusMsg, setPortfolioStatusMsg] = useState("");
  const [portfolioErrorMsg, setPortfolioErrorMsg] = useState("");
  const [analysisComplete, setAnalysisComplete] = useState(false);

  const [editingTickerIdx, setEditingTickerIdx] = useState<number | null>(null);
  const [inferringIdx, setInferringIdx] = useState<number | null>(null);
  const [toastMsg, setToastMsg] = useState("");

  const fileInputRef = useRef<HTMLInputElement>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
        setPortfolioStatusMsg("분석 결과 저장 중...");
        await saveAnalysisResult(selectedCustomer, result);
        setAnalysisResult(result);
        pushToRebalancingSell();
        setPortfolioDirty(false);
        try {
          localStorage.setItem("portfolio-result-v1", JSON.stringify(result));
          window.dispatchEvent(new CustomEvent("portfolio-result-updated"));
        } catch {}

        // 금융소득 게이지 계산:
        // enrichedAssets에서 현재가/배당을 가져오되, bond_yield/buy_price 등 원본
        // 입력값은 반드시 original assets[i] 에서 읽어야 enrichedAssets 변환 중
        // 유실되지 않음.
        const assetsForCalc: AssetForIncomeCalc[] = result.enrichedAssets.map((enriched, i) => {
          const orig = assets[i] as PortfolioAsset & { bond_yield?: number | null };
          const ae = enriched as PortfolioAssetEnriched;

          // 채권수익률: 원본 입력값 우선 (enrichedAssets에서 유실될 수 있음)
          const bondYield = orig?.bond_yield ?? (enriched as unknown as Record<string, unknown>).bond_yield as number | null | undefined;
          const interestRate = bondYield != null && bondYield > 0 ? bondYield / 100 : undefined;

          // 채권은 name 입력 불가 → orig.productType으로 폴백
          const isBondOrig = orig?.productType === "국내채권" || orig?.productType === "해외채권";
          const resolvedName = enriched.name || orig?.name || (isBondOrig ? (orig?.productType ?? "채권") : "");

          return {
            name: resolvedName,
            ticker: enriched.ticker ?? orig?.ticker ?? "",
            asset_class: enriched.asset_class || orig?.asset_class,
            productType: enriched.productType || orig?.productType,
            country: enriched.country || orig?.country,
            current_price: enriched.current_price,
            current_value: enriched.current_value,
            amount: enriched.amount ?? orig?.amount,
            amount_type: (enriched.amount_type ?? orig?.amount_type ?? "quantity") as "quantity" | "value",
            // 채권 원금 계산을 위해 원본 buy_price 사용
            buy_price: orig?.buy_price ?? enriched.buy_price,
            dividendYield: ae.dividendYield,
            trailingAnnualDividendRate: ae.trailingAnnualDividendRate,
            interestRate,
          };
        });
        const summary = calcFinancialIncomeSummary(assetsForCalc, tMarginal);
        try {
          localStorage.setItem(FINANCIAL_INCOME_STORAGE_KEY, JSON.stringify(summary));
          window.dispatchEvent(new CustomEvent("financial-income-updated"));
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
    [tMarginal, formData.rrttllu.expectedInterestIncome, formData.rrttllu.expectedDividendIncome, selectedCustomer, setAnalysisResult, setPortfolioDirty, pushToRebalancingSell]
  );

  // ── 토스트 ────────────────────────────────────────────────────────────────

  const showToast = useCallback((msg: string) => {
    setToastMsg(msg);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToastMsg(""), 3000);
  }, []);

  // ── 지능형 추론 (Gemini AI + 배당 데이터) ────────────────────────────────

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

        const geminiAssetClass  = typeof data.assetClass  === "string" ? data.assetClass  : "";
        const geminiProductType = typeof data.productType === "string" ? data.productType : "";
        const unifiedType = geminiAssetClass
          ? toUnifiedProductType(geminiAssetClass, geminiProductType)
          : undefined;

        // 배당 데이터 추출
        const dividendYield =
          typeof data.dividendYield === "number" && data.dividendYield > 0
            ? data.dividendYield : undefined;
        const trailingAnnualDividendRate =
          typeof data.trailingAnnualDividendRate === "number" && data.trailingAnnualDividendRate > 0
            ? data.trailingAnnualDividendRate : undefined;

        updateRow(idx, {
          ticker,
          ...(unifiedType ? {
            productType: unifiedType,
            asset_class: deriveAssetClass(unifiedType),
            country:     deriveCountry(unifiedType),
          } : {}),
          ...(!unifiedType && data.country ? { country: data.country as string } : {}),
          is_hedged: false,
          // dividendYield는 PortfolioAsset에 없지만 런타임에 저장됨 (portfolioLogic에서 읽음)
          ...(dividendYield != null ? { dividendYield } : {}),
          ...(trailingAnnualDividendRate != null ? { trailingAnnualDividendRate } : {}),
        } as Partial<PortfolioAsset>);

        const yieldMsg = dividendYield != null
          ? ` · 배당수익률 ${(dividendYield * 100).toFixed(2)}%`
          : "";
        showToast(`'${name}' → ${ticker}${yieldMsg} 자동 완성`);
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
  const isBond = BOND_TYPES.has(a.productType ?? "");

  const handleProductTypeChange = (val: string) => {
    onUpdate(idx, {
      productType: val,
      asset_class: deriveAssetClass(val),
      country:     deriveCountry(val),
      is_hedged:   false,
      ...(!BOND_TYPES.has(val) ? { bond_yield: null, bond_maturity: null } : {}),
      // 채권은 종목명 입력 불가이므로 상품유형명을 name으로 저장
      // (calcFinancialIncomeSummary가 name=""인 자산을 스킵하기 때문에 필수)
      ...(BOND_TYPES.has(val) ? { name: val } : {}),
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
            placeholder={isBond ? (a.productType ?? "채권") : "종목명"}
            value={isBond ? (a.name || a.productType || "") : a.name}
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

      {/* 티커 */}
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

      {/* 통합 상품유형 */}
      <td className="px-3 py-2">
        <select
          className="h-9 rounded border border-slate-200 px-2 text-xs text-navy"
          value={a.productType ?? ""}
          onChange={(e) => handleProductTypeChange(e.target.value)}
        >
          <option value="">선택</option>
          {UNIFIED_PRODUCT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
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

      {/* 채권수익률(%) */}
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

      {/* 만기(년) */}
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
