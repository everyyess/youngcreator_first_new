"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FileUp, Loader2, Plus, RefreshCw, Sparkles, X } from "lucide-react";
import { useCustomerContext, parseKrwAmount } from "../CustomerContext";
import type { PortfolioAsset } from "../CustomerContext";
import {
  FinancialIncomeGauge,
  calcFinancialIncomeSummary,
  extractDividendFromYahoo,
  FINANCIAL_INCOME_STORAGE_KEY,
  type FinancialIncomeSummary,
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

// ─────────────────────────────────────────────
// 확장 타입: 배당/이자 데이터 포함
// ─────────────────────────────────────────────
interface PortfolioAssetEnriched extends PortfolioAsset {
  dividendYield?: number;
  trailingAnnualDividendRate?: number;
  current_price?: number;
  current_value?: number;
}

// ─────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────
interface ExistingPortfolioTabProps {
  hideDividendColumn?: boolean;
}

export default function ExistingPortfolioTab({ hideDividendColumn = false }: ExistingPortfolioTabProps = {}) {
  const { formData } = useCustomerContext();

  const [portfolioAssets, setPortfolioAssets] = useState<PortfolioAssetEnriched[]>([]);
  const [isLoaded, setIsLoaded] = useState(false);
  const [portfolioIsRunning, setPortfolioIsRunning] = useState(false);
  const [portfolioStatusMsg, setPortfolioStatusMsg] = useState("");
  const [portfolioErrorMsg, setPortfolioErrorMsg] = useState("");
  const [analysisComplete, setAnalysisComplete] = useState(false);

  // 금융소득 요약
  const [financialSummary, setFinancialSummary] = useState<FinancialIncomeSummary | null>(null);

  const [editingTickerIdx, setEditingTickerIdx] = useState<number | null>(null);
  const [inferringIdx, setInferringIdx] = useState<number | null>(null);
  const [toastMsg, setToastMsg] = useState("");

  const fileInputRef = useRef<HTMLInputElement>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── LocalStorage 로드 ──────────────────────────
  useEffect(() => {
    try {
      const stored = localStorage.getItem(PORTFOLIO_INPUT_KEY);
      if (stored) {
        const parsed = JSON.parse(stored) as PortfolioAssetEnriched[];
        if (Array.isArray(parsed) && parsed.length > 0) setPortfolioAssets(parsed);
      }
      const storedSummary = localStorage.getItem(FINANCIAL_INCOME_STORAGE_KEY);
      if (storedSummary) setFinancialSummary(JSON.parse(storedSummary));
    } catch {}
    setIsLoaded(true);
  }, []);

  // ── 자산 변경 시 저장 ──────────────────────────
  useEffect(() => {
    if (!isLoaded) return;
    try {
      localStorage.setItem(PORTFOLIO_INPUT_KEY, JSON.stringify(portfolioAssets));
    } catch {}
  }, [portfolioAssets, isLoaded]);

  // ── 한계세율 ──────────────────────────────────
  const tMarginal = useMemo(() => {
    const parsed = parseKrwAmount(formData.financial.annualFixedIncome);
    if (parsed == null) return 0.385; // 기본값
    if (parsed > 500_000_000) return 0.495;
    if (parsed > 300_000_000) return 0.44;
    if (parsed > 150_000_000) return 0.418;
    if (parsed > 88_000_000) return 0.385;
    if (parsed > 50_000_000) return 0.264;
    if (parsed > 14_000_000) return 0.165;
    return 0.066;
  }, [formData.financial.annualFixedIncome]);

  // ── 금융소득 자동계산 ─────────────────────────
  useEffect(() => {
    if (!isLoaded) return;

    if (portfolioAssets.length === 0) {
      setFinancialSummary(null);
      localStorage.removeItem(FINANCIAL_INCOME_STORAGE_KEY);
      return;
    }

    const assetsForCalc: AssetForIncomeCalc[] = portfolioAssets.map((a) => ({
      name: a.name,
      ticker: a.ticker ?? "",
      asset_class: a.asset_class,
      productType: a.productType,
      country: a.country,
      current_price: a.current_price,
      current_value: a.current_value,
      amount: a.amount,
      amount_type: a.amount_type,
      buy_price: a.buy_price,
      dividendYield: a.dividendYield,
      trailingAnnualDividendRate: a.trailingAnnualDividendRate,
    }));

    const summary = calcFinancialIncomeSummary(assetsForCalc, tMarginal);
    setFinancialSummary(summary);

    try {
      localStorage.setItem(FINANCIAL_INCOME_STORAGE_KEY, JSON.stringify(summary));
      window.dispatchEvent(new CustomEvent("financial-income-updated"));
    } catch {}
  }, [portfolioAssets, isLoaded, tMarginal]);

  // ── 포트폴리오 분석 실행 ───────────────────────
  const triggerAnalysis = useCallback(
    async (assets: PortfolioAssetEnriched[]) => {
      if (!assets.length) return;
      setPortfolioIsRunning(true);
      setPortfolioErrorMsg("");
      setPortfolioStatusMsg("섹터 정보 확인 중..");
      try {
        const { runAnalysis } = await import("@/lib/portfolioLogic");
        setPortfolioStatusMsg("시장 가격 조회 중..");
        const result = await runAnalysis(assets, {
          tMarginal,
          expectedInterestIncome: formData.rrttllu.expectedInterestIncome,
          expectedDividendIncome: formData.rrttllu.expectedDividendIncome,
        });
        if (!result) {
          setPortfolioStatusMsg("");
          setPortfolioErrorMsg("보유 자산의 평가액이 0입니다. 종목명과 수량을 입력해 주세요.");
          return;
        }
        try {
          localStorage.setItem("portfolio-result-v1", JSON.stringify(result));
          window.dispatchEvent(new CustomEvent("portfolio-result-updated"));
        } catch {}

        // enrichedAssets에서 보완된 배당률·가격을 portfolioAssets에 병합 → 게이지 반영
        setPortfolioAssets((prev) =>
          prev.map((a, i) => {
            const enriched = result.enrichedAssets[i];
            if (!enriched) return a;
            return {
              ...a,
              current_price: enriched.current_price ?? a.current_price,
              current_value: enriched.current_value ?? a.current_value,
              ...(a.dividendYield == null && enriched.dividendYield != null
                ? { dividendYield: enriched.dividendYield }
                : {}),
              ...(a.trailingAnnualDividendRate == null && enriched.trailingAnnualDividendRate != null
                ? { trailingAnnualDividendRate: enriched.trailingAnnualDividendRate }
                : {}),
            };
          })
        );

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

  // ── 행 CRUD ────────────────────────────────────
  const addRow = () => setPortfolioAssets((prev) => [...prev, { ...EMPTY_ASSET }]);
  const removeRow = (i: number) =>
    setPortfolioAssets((prev) => prev.filter((_, idx) => idx !== i));
  const updateRow = useCallback(
    (i: number, patch: Partial<PortfolioAssetEnriched>) =>
      setPortfolioAssets((prev) =>
        prev.map((a, idx) => (idx === i ? { ...a, ...patch } : a))
      ),
    []
  );

  // ── 토스트 ─────────────────────────────────────
  const showToast = useCallback((msg: string) => {
    setToastMsg(msg);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToastMsg(""), 3000);
  }, []);

  // ── AI 자동 추론 (배당 데이터 포함) ──────────────
  const handleSmartInference = useCallback(
    async (idx: number, name: string) => {
      if (!name.trim()) return;
      setInferringIdx(idx);
      showToast(`'${name}' 분석 중..`);

      try {
        const res = await fetch(`/api/proxy-finance?assetName=${encodeURIComponent(name)}`);
        const data = await res.json();

        if (!res.ok) {
          showToast(data?.error ?? `오류 (${res.status})`);
          return;
        }

        const ticker = typeof data.ticker === "string" && data.ticker ? data.ticker : "";
        if (!ticker) {
          showToast(`'${name}'의 종목을 찾을 수 없습니다. 직접 입력해 주세요.`);
          return;
        }

        // 배당 데이터 추출
        const { dividendYield, trailingAnnualDividendRate } = extractDividendFromYahoo(data);

        // 현재가 추출
        const metaResult = data?.chart?.result?.[0]?.meta ?? {};
        const closes: (number | null)[] =
          data?.chart?.result?.[0]?.indicators?.quote?.[0]?.close ?? [];
        let current_price: number | undefined;
        if (typeof metaResult?.regularMarketPrice === "number" && metaResult.regularMarketPrice > 0) {
          current_price = metaResult.regularMarketPrice;
        } else {
          current_price =
            closes.filter((v): v is number => v != null && !Number.isNaN(v)).at(-1) ?? undefined;
        }

        // USD → KRW
        const isUsd = (metaResult?.currency ?? "USD") === "USD";
        const FX = 1380;
        const priceKrw = current_price != null ? (isUsd ? current_price * FX : current_price) : undefined;
        const qty = portfolioAssets[idx]?.amount ?? 1;
        const current_value = priceKrw != null ? priceKrw * qty : undefined;

        updateRow(idx, {
          ticker,
          ...(data.assetClass  ? { asset_class: data.assetClass  as string } : {}),
          ...(data.productType ? { productType:  data.productType as string } : {}),
          ...(data.country     ? { country:      data.country     as string } : {}),
          dividendYield,
          trailingAnnualDividendRate,
          current_price: priceKrw,
          current_value,
        });

        const yieldMsg = dividendYield != null && dividendYield > 0
          ? ` · 배당수익률 ${(dividendYield * 100).toFixed(2)}%`
          : "";
        showToast(`'${name}' → ${ticker} 자동 인식${yieldMsg}`);
      } catch (err) {
        console.warn("[SmartInference] API 오류:", err);
        showToast("네트워크 오류가 발생했습니다. 직접 입력해 주세요.");
      } finally {
        setInferringIdx(null);
      }
    },
    [showToast, updateRow, portfolioAssets]
  );

  // ── Render ─────────────────────────────────────
  return (
    <div className="space-y-5">

      {/* 자산 입력 섹션 */}

      <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-soft">
        <div className="mb-4 flex items-start gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-samsung">
            <FileUp size={18} />
          </div>
          <div>
            <p className="text-xs font-bold uppercase tracking-normal text-slate-500">기존 포트폴리오 분석</p>
            <h2 className="mt-1 text-lg font-bold text-navy">자산 입력 및 분석 실행</h2>
          </div>
        </div>

        <input ref={fileInputRef} type="file" accept=".pdf" className="hidden" />

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            disabled={portfolioIsRunning || !portfolioAssets.length}
            onClick={() => triggerAnalysis(portfolioAssets)}
            className="flex items-center gap-2 rounded-lg bg-samsung px-4 py-2.5 text-sm font-bold text-white transition hover:bg-[#1b35bd] disabled:opacity-50"
          >
            {portfolioIsRunning
              ? <Loader2 size={16} className="animate-spin" />
              : <RefreshCw size={16} />}
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

        {portfolioAssets.length > 0 ? (
          <div className="mt-4 overflow-x-auto rounded-lg border border-slate-200">
            <table className="w-full text-sm">
              <thead className="border-b border-slate-200 bg-slate-50">
                <tr>
                  {["종목명", "티커", "상품유형", "투자국가", "자산군", "수량", "매수단가(원)", ...(hideDividendColumn ? [] : ["배당수익률"]), "헤지", ""].map((h) => (
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
                    hideDividendColumn={hideDividendColumn}
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
              자산을 추가하면 배당·이자소득이 자동 계산됩니다.
            </p>
          </div>
        )}

        {analysisComplete && !portfolioIsRunning && (
          <div className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2.5">
            <p className="text-sm font-semibold text-emerald-800">
              분석 완료 —{" "}
              <span className="font-bold">보유현황 및 진단</span> 탭 또는{" "}
              <span className="font-bold">4. 포트폴리오 비교</span> 탭에서 결과를 확인하세요.
            </p>
          </div>
        )}
      </section>
    </div>
  );
}

// ─────────────────────────────────────────────
// AssetRow
// ─────────────────────────────────────────────
interface AssetRowProps {
  idx: number;
  asset: PortfolioAssetEnriched;
  isInferring: boolean;
  editingTicker: boolean;
  hideDividendColumn: boolean;
  onUpdate: (i: number, patch: Partial<PortfolioAssetEnriched>) => void;
  onRemove: (i: number) => void;
  onInfer: (idx: number, name: string) => void;
  onStartEditTicker: () => void;
  onEndEditTicker: () => void;
}

function AssetRow({
  idx, asset: a, isInferring, editingTicker, hideDividendColumn,
  onUpdate, onRemove, onInfer, onStartEditTicker, onEndEditTicker,
}: AssetRowProps) {
  return (
    <tr className="bg-white hover:bg-slate-50">

      {/* 종목명 + AI 버튼 */}
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
            title="AI 자동 인식"
            disabled={isInferring || !a.name.trim()}
            onClick={() => onInfer(idx, a.name)}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded border border-violet-200 bg-violet-50 text-violet-500 transition hover:bg-violet-100 disabled:opacity-40"
          >
            {isInferring ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />}
          </button>
        </div>
      </td>

      {/* 티커 */}
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

      {/* 수량 */}
      <td className="px-3 py-2">
        <input
          type="number"
          className="h-9 w-24 rounded border border-slate-200 px-2 text-xs text-navy"
          placeholder="수량"
          value={a.amount || ""}
          onChange={(e) => onUpdate(idx, { amount: Number(e.target.value), amount_type: "quantity" })}
        />
      </td>

      {/* 매수단가 */}
      <td className="px-3 py-2">
        <input
          type="number"
          className="h-9 w-24 rounded border border-slate-200 px-2 text-xs text-navy"
          value={a.buy_price ?? ""}
          placeholder="단가"
          onChange={(e) => onUpdate(idx, { buy_price: e.target.value ? Number(e.target.value) : null })}
        />
      </td>

      {/* 배당수익률 — AI 자동입력, 직접 수정 가능 */}
      {!hideDividendColumn && (
        <td className="px-3 py-2">
          <div className="flex items-center gap-1">
            <input
              type="number"
              step="0.01"
              className="h-9 w-20 rounded border border-slate-200 px-2 text-xs text-navy"
              value={a.dividendYield != null ? (a.dividendYield * 100).toFixed(2) : ""}
              placeholder=""
              onChange={(e) => onUpdate(idx, {
                dividendYield: e.target.value ? Number(e.target.value) / 100 : undefined,
              })}
            />
            <span className="text-xs text-slate-400">%</span>
          </div>
        </td>
      )}

      {/* 헤지 */}
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
