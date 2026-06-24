"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Camera, FileSpreadsheet, FileUp, Loader2, Plus, RefreshCw, Sparkles, Trash2, X } from "lucide-react";
import {
  useCustomerContext,
  parseKrwAmount,
  saveAnalysisResult,
} from "../CustomerContext";
import type { PortfolioAsset } from "../CustomerContext";
import { getUSDKRWRate } from "@/utils/fxCache";
import {
  calcFinancialIncomeSummary,
  FINANCIAL_INCOME_STORAGE_KEY,
  FINANCIAL_INCOME_RESET_KEY,
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
function fmtPrice(v: number): string {
  return v.toLocaleString("ko-KR", { maximumFractionDigits: 2 });
}
function effectivePriceOf(a: PortfolioAsset): number {
  const cp = Number(a.current_price);
  if (Number.isFinite(cp) && cp > 0) return cp;
  const bp = Number(a.buy_price);
  return Number.isFinite(bp) && bp > 0 ? bp : 0;
}

function effectiveValueOf(a: PortfolioAsset): number {
  return a.amount * effectivePriceOf(a);
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
    bulkAddPortfolioRows,
    removePortfolioRow: removeRow,
    updatePortfolioRow: updateRow,
    setAnalysisResult,
    setPortfolioDirty,
    resetPortfolioDerivedState,
    pushToRebalancingSell,
    clearSellHistory,
    saveTaxSummary,
  } = useCustomerContext();

  const [clearConfirm, setClearConfirm] = useState(false);

  // ── 가져오기(Import) 상태 ────────────────────────────────────────────────
  type ImportItem = {
    name: string;
    quantity: number | null;
    avgPrice: number | null;
    originalCurrency?: string;
    originalAvgPrice?: number;
    fxRate?: number;
  };
  const [importPreview, setImportPreview] = useState<ImportItem[] | null>(null);
  const [imageLoading, setImageLoading] = useState(false);
  const [csvLoading, setCsvLoading] = useState(false);
  const [importError, setImportError] = useState("");
  const [batchInferring, setBatchInferring] = useState(false);
  const [batchProgress, setBatchProgress] = useState({ done: 0, total: 0 });
  const imageInputRef = useRef<HTMLInputElement>(null);
  const csvInputRef = useRef<HTMLInputElement>(null);
  const pendingInferenceRef = useRef<{ start: number; count: number } | null>(null);

  const clearAllAssets = async () => {
    await resetPortfolioDerivedState();
    setClearConfirm(false);
  };

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

  // ── 배치 티커 자동완성 (가져오기 확정 후 순차 실행) ──────────────────────
  // portfolioAssets.length 변화 감지 → pendingInferenceRef에 예약된 범위 처리
  useEffect(() => {
    const pending = pendingInferenceRef.current;
    if (!pending) return;
    if (portfolioAssets.length < pending.start + pending.count) return;

    pendingInferenceRef.current = null;
    const { start, count } = pending;
    const snapshot = portfolioAssets.slice(start, start + count);

    let alive = true;
    const run = async () => {
      setBatchInferring(true);
      setBatchProgress({ done: 0, total: count });
      for (let i = 0; i < count; i++) {
        if (!alive) break;
        const name = snapshot[i]?.name?.trim();
        if (name) await handleSmartInference(start + i, name);
        if (alive) setBatchProgress({ done: i + 1, total: count });
      }
      if (alive) {
        setBatchInferring(false);
        showToast(`티커 자동 완성 완료 (${count}개)`);
      }
    };
    run();
    return () => { alive = false; };
  // handleSmartInference·showToast 는 useCallback으로 안정적이므로 생략
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [portfolioAssets.length]);

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
        clearSellHistory();
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
            buy_price: isBondOrig ? (orig?.buy_price ?? enriched.buy_price) : undefined,
            dividendYield: ae.dividendYield,
            trailingAnnualDividendRate: ae.trailingAnnualDividendRate,
            interestRate,
          };
        });
        const summary = calcFinancialIncomeSummary(assetsForCalc, tMarginal);
        try {
          localStorage.setItem(FINANCIAL_INCOME_STORAGE_KEY, JSON.stringify(summary));
          sessionStorage.removeItem(FINANCIAL_INCOME_RESET_KEY);
          window.dispatchEvent(new CustomEvent("financial-income-updated"));
        } catch {}
        saveTaxSummary('current', summary);

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
    [tMarginal, formData.rrttllu.expectedInterestIncome, formData.rrttllu.expectedDividendIncome, selectedCustomer, setAnalysisResult, setPortfolioDirty, clearSellHistory, pushToRebalancingSell]
  );

  // ── 토스트 ────────────────────────────────────────────────────────────────

  const showToast = useCallback((msg: string) => {
    setToastMsg(msg);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToastMsg(""), 3000);
  }, []);

  // ── 스크린샷 이미지 분석 (Gemini Vision) ─────────────────────────────────

  const handleImageFileChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (!files.length) return;
    setImageLoading(true);
    setImportError("");
    setImportPreview(null);
    try {
      const fd = new FormData();
      // 첫 번째는 "image", 이후는 "image1", "image2" ...
      files.forEach((f, i) => fd.append(i === 0 ? "image" : `image${i}`, f));
      const res = await fetch("/api/portfolio-ocr", { method: "POST", body: fd });
      const data = await res.json() as {
        assets?: { name: string; quantity: number | null; avgPrice: number | null; originalCurrency?: string; originalAvgPrice?: number; fxRate?: number }[];
        error?: string;
      };
      if (!res.ok) throw new Error(data.error ?? `오류 (${res.status})`);
      if (!data.assets?.length) throw new Error("이미지에서 종목을 찾을 수 없습니다. 보유 종목 화면인지 확인해주세요.");
      setImportPreview(data.assets.map(a => ({
        name: a.name,
        quantity: a.quantity,
        avgPrice: a.avgPrice,
        originalCurrency: a.originalCurrency,
        originalAvgPrice: a.originalAvgPrice,
        fxRate: a.fxRate,
      })));
    } catch (err) {
      setImportError(err instanceof Error ? err.message : "이미지 분석 중 오류가 발생했습니다.");
    } finally {
      setImageLoading(false);
    }
  }, []);

  // ── CSV / 엑셀 / PDF 파일 파싱 ───────────────────────────────────────────

  const handleCsvFileChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setCsvLoading(true);
    setImportError("");
    setImportPreview(null);

    const isPdf = file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");

    // PDF → Gemini OCR 경로 (Excel 변환 불필요)
    if (isPdf) {
      try {
        const fd = new FormData();
        fd.append("image", file);
        const res = await fetch("/api/portfolio-ocr", { method: "POST", body: fd });
        const data = await res.json() as { assets?: { name: string; quantity: number | null; avgPrice: number | null; originalCurrency?: string; originalAvgPrice?: number; fxRate?: number }[]; error?: string };
        if (!res.ok) throw new Error(data.error ?? `오류 (${res.status})`);
        if (!data.assets?.length) throw new Error("PDF에서 종목을 찾을 수 없습니다.");
        setImportPreview(data.assets.map(a => ({
          name: a.name, quantity: a.quantity, avgPrice: a.avgPrice,
          originalCurrency: a.originalCurrency, originalAvgPrice: a.originalAvgPrice, fxRate: a.fxRate,
        })));
      } catch (err) {
        setImportError(err instanceof Error ? err.message : "PDF 분석 중 오류가 발생했습니다.");
      } finally {
        setCsvLoading(false);
      }
      return;
    }

    // Excel / CSV 스마트 파싱
    try {
      const { read, utils } = await import("xlsx");
      const buffer = await file.arrayBuffer();
      const wb = read(buffer, { type: "array" });

      // 모든 시트를 순서대로 시도
      type RawRow = unknown[];
      let raw: RawRow[] = [];
      for (const sheetName of wb.SheetNames) {
        const ws = wb.Sheets[sheetName];
        const rows = utils.sheet_to_json<RawRow>(ws, { header: 1, defval: "" });
        if (rows.length > raw.length) raw = rows; // 가장 많은 데이터가 있는 시트 우선
      }
      if (!raw.length) throw new Error("파일에서 데이터를 찾을 수 없습니다.");

      const toStr = (v: unknown) => String(v ?? "").replace(/,/g, "").trim();
      const toNum = (v: unknown): number | null => {
        const n = parseFloat(toStr(v));
        return isFinite(n) && n > 0 ? n : null;
      };
      // 순수 숫자가 아닌 2자 이상 문자열 → 종목명 후보
      const looksLikeName = (s: string) =>
        s.length >= 1 && !/^-?[\d.]+$/.test(s) &&
        !/^(평가금액|투자비중|수수료|제세금|합계|총계|소계|대출일자|신용|매수|매도|현재가|손익|등락)/.test(s);

      const scan = raw.map(r => r.map(toStr));

      // ── 헤더 행 탐색 (최대 100행, 모든 시트 통합) ──────────────────────
      const IS_NAME_H  = (s: string) => /^(종목명|종목|name)$/i.test(s);
      const IS_QTY_H   = (s: string) => /보유잔고|잔고수량|보유수량|잔수량|수량|qty|quantity/i.test(s);
      const IS_PRICE_H = (s: string) => /평균단가|매수단가|매입단가|평균매입가|매입평균가/i.test(s);

      let nameHeaderRow = -1, nameCol = -1, qtyCol = -1, priceColA = -1;
      let priceHeaderRow = -1, priceColB = -1;

      for (let i = 0; i < Math.min(scan.length, 100); i++) {
        const row = scan[i];
        const ni = row.findIndex(IS_NAME_H);
        if (ni >= 0 && nameHeaderRow < 0) {
          nameHeaderRow = i;
          nameCol  = ni;
          qtyCol   = row.findIndex(IS_QTY_H);
          priceColA = row.findIndex(IS_PRICE_H); // 같은 행에 평균단가가 있을 수도 있음
        }
        // 별도 섹션에 있는 평균단가 헤더 탐색 (KB증권 등 2-테이블 구조)
        if (nameHeaderRow >= 0 && i > nameHeaderRow + 2) {
          const pi = row.findIndex(IS_PRICE_H);
          if (pi >= 0 && priceHeaderRow < 0) {
            priceHeaderRow = i;
            priceColB = pi;
          }
        }
      }

      if (nameHeaderRow < 0) {
        const sample = scan.slice(0, 5).map(r => r.filter(Boolean).slice(0, 6).join(" | ")).join(" / ");
        throw new Error(`'종목명' 컬럼을 찾을 수 없습니다.\n처음 5행 미리보기: ${sample}`);
      }

      // ── 종목명 + 수량 추출 ─────────────────────────────────────────────
      const nameItems: Array<{ name: string; quantity: number | null; avgPriceInline: number | null }> = [];
      const stopRow = priceHeaderRow > 0 ? priceHeaderRow : scan.length;

      for (let i = nameHeaderRow + 1; i < stopRow; i++) {
        const row = scan[i];
        const name = row[nameCol];
        if (!name || !looksLikeName(name)) continue;
        if (IS_NAME_H(name)) break; // 두 번째 종목명 헤더 행이 오면 중단
        nameItems.push({
          name,
          quantity: qtyCol >= 0 ? toNum(row[qtyCol]) : null,
          avgPriceInline: priceColA >= 0 ? toNum(row[priceColA]) : null,
        });
      }

      // ── 별도 섹션 평균단가 추출 (KB증권 page 5 스타일) ─────────────────
      const separatePrices: (number | null)[] = [];
      if (priceHeaderRow >= 0 && priceColB >= 0) {
        for (let i = priceHeaderRow + 1; i < scan.length; i++) {
          if (separatePrices.length >= nameItems.length) break;
          const row = scan[i];
          const firstCell = row[0];
          // 첫 셀이 비어 있거나 텍스트면 스킵 (소계 행 등)
          if (!firstCell || !/^\d/.test(firstCell)) continue;
          separatePrices.push(toNum(row[priceColB]));
        }
      }

      // ── 병합 ─────────────────────────────────────────────────────────
      const items = nameItems
        .map((item, idx) => ({
          name: item.name,
          quantity: item.quantity,
          avgPrice: item.avgPriceInline ?? separatePrices[idx] ?? null,
        }))
        .filter(item => item.name.length > 0);

      if (!items.length) throw new Error("유효한 종목 데이터가 없습니다.");
      setImportPreview(items);
    } catch (err) {
      setImportError(err instanceof Error ? err.message : "파일 파싱 중 오류가 발생했습니다.");
    } finally {
      setCsvLoading(false);
    }
  }, []);

  // ── 프리뷰 행 편집 / 삭제 ────────────────────────────────────────────────

  const removePreviewItem = useCallback((idx: number) => {
    setImportPreview(prev => prev ? prev.filter((_, i) => i !== idx) : null);
  }, []);

  const updatePreviewItem = useCallback((idx: number, field: "quantity" | "avgPrice", raw: string) => {
    const n = parseFloat(raw.replace(/,/g, ""));
    setImportPreview(prev =>
      prev
        ? prev.map((item, i) =>
            i === idx ? { ...item, [field]: raw === "" ? null : (isFinite(n) ? n : item[field]) } : item
          )
        : null
    );
  }, []);

  // ── 티커 없는 종목 전체 재조회 ───────────────────────────────────────────

  const retryMissingTickers = useCallback(async () => {
    const missing = portfolioAssets
      .map((a, i) => ({ a, i }))
      .filter(({ a }) => !a.ticker?.trim() && a.name?.trim());
    if (!missing.length) { showToast("티커가 없는 종목이 없습니다."); return; }
    setBatchInferring(true);
    setBatchProgress({ done: 0, total: missing.length });
    for (let j = 0; j < missing.length; j++) {
      const { a, i } = missing[j];
      await handleSmartInference(i, a.name.trim());
      setBatchProgress({ done: j + 1, total: missing.length });
    }
    setBatchInferring(false);
    showToast(`티커 재조회 완료 (${missing.length}개)`);
  // handleSmartInference·showToast는 useCallback으로 안정
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [portfolioAssets]);

  // ── 가져오기 확정 + 배치 티커 자동완성 예약 ──────────────────────────────

  const applyImport = useCallback(() => {
    if (!importPreview?.length) return;
    const startIdx = portfolioAssets.length;
    const count = importPreview.length;
    bulkAddPortfolioRows(
      importPreview.map(item => ({
        name: item.name,
        amount: item.quantity ?? 0,
        amount_type: "quantity" as const,
        buy_price: item.avgPrice ?? null,
      }))
    );
    pendingInferenceRef.current = { start: startIdx, count };
    setImportPreview(null);
    showToast(`${count}개 종목 추가 완료 — 티커 자동 완성을 시작합니다.`);
  }, [importPreview, portfolioAssets.length, bulkAddPortfolioRows, showToast]);

  // ── 지능형 추론 (Gemini AI + 배당 데이터) ────────────────────────────────

  const handleSmartInference = useCallback(
    async (idx: number, name: string) => {
      if (!name.trim()) return;
      setInferringIdx(idx);
      showToast(`'${name}' 분석 중...`);

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 15_000);

      try {
        let res: Response;
        try {
          res = await fetch(`/api/proxy-finance?assetName=${encodeURIComponent(name)}`, {
            signal: controller.signal,
          });
        } catch (fetchErr) {
          if ((fetchErr as Error).name === "AbortError") {
            showToast(`'${name}' 조회 시간이 초과됐습니다. 티커를 직접 입력해주세요.`);
          } else {
            showToast("네트워크 오류가 발생했습니다. 수동으로 입력해주세요.");
          }
          return;
        }

        let data: Record<string, unknown>;
        try {
          data = await res.json();
        } catch {
          showToast("서버 응답 파싱 오류. 수동으로 입력해주세요.");
          return;
        }

        if (!res.ok) {
          showToast((data?.error as string) ?? `오류 (${res.status}) — 티커를 직접 입력해주세요.`);
          return;
        }

        const ticker = typeof data.ticker === "string" && data.ticker ? data.ticker : "";
        if (!ticker) {
          showToast(`'${name}'의 티커를 찾을 수 없습니다. 종목명 더블클릭 후 수동 입력해주세요.`);
          return;
        }

        // 공식 사명 — Yahoo meta.shortName/longName → Gemini englishName 순 폴백
        const officialName = typeof data.officialName === "string" && data.officialName.trim()
          ? data.officialName.trim()
          : null;

        // 한국어 종목명 조회 (네이버 자동완성)
        let koreanName: string | null = null;
        try {
          const knRes = await fetch(`/api/korean-name?ticker=${encodeURIComponent(ticker)}`);
          if (knRes.ok) {
            const kn = await knRes.json() as { name?: string };
            if (kn.name && kn.name !== ticker) koreanName = kn.name;
          }
        } catch { /* 무시 */ }

        const geminiAssetClass  = typeof data.assetClass  === "string" ? data.assetClass  : "";
        const geminiProductType = typeof data.productType === "string" ? data.productType : "";
        const unifiedType = geminiAssetClass
          ? toUnifiedProductType(geminiAssetClass, geminiProductType)
          : undefined;

        const rawPrice: number | null =
          (data?.chart as Record<string, unknown>)?.result
            ? ((data.chart as { result?: Array<{ meta?: { regularMarketPrice?: number } }> })
                ?.result?.[0]?.meta?.regularMarketPrice ?? null)
            : null;
        const isBondAsset = BOND_TYPES.has(unifiedType ?? "");

        let currentPriceKRW: number | null = null;
        if (typeof rawPrice === "number" && rawPrice > 0 && !isBondAsset) {
          const isForeign = !ticker.endsWith(".KS") && !ticker.endsWith(".KQ");
          if (isForeign) {
            try {
              const rate = await getUSDKRWRate();
              if (rate) currentPriceKRW = Math.round(rawPrice * rate);
            } catch {
              // 환율 조회 실패 시 현재가 생략, 나머지는 정상 반영
            }
          } else {
            currentPriceKRW = Math.round(rawPrice);
          }
        }

        const dividendYield =
          typeof data.dividendYield === "number" && data.dividendYield > 0
            ? data.dividendYield : undefined;
        const trailingAnnualDividendRate =
          typeof data.trailingAnnualDividendRate === "number" && data.trailingAnnualDividendRate > 0
            ? data.trailingAnnualDividendRate : undefined;

        const resolvedName = koreanName ?? officialName;
        updateRow(idx, {
          ticker,
          // 한국어명 → 영문 공식명 → 입력값 순으로 이름 보정
          ...(resolvedName ? { name: resolvedName } : {}),
          ...(unifiedType ? {
            productType: unifiedType,
            asset_class: deriveAssetClass(unifiedType),
            country:     deriveCountry(unifiedType),
          } : {}),
          ...(!unifiedType && data.country ? { country: data.country as string } : {}),
          ...(currentPriceKRW !== null ? { current_price: currentPriceKRW } : {}),
          is_hedged: false,
          ...(dividendYield != null ? { dividendYield } : {}),
          ...(trailingAnnualDividendRate != null ? { trailingAnnualDividendRate } : {}),
        } as Partial<PortfolioAsset>);

        const displayName = koreanName ?? officialName ?? name;
        const priceStr = currentPriceKRW !== null
          ? ` / 현재가 ${currentPriceKRW.toLocaleString("ko-KR")}원`
          : "";
        const yieldMsg = dividendYield != null
          ? ` · 배당수익률 ${(dividendYield * 100).toFixed(2)}%`
          : "";
        showToast(`'${name}' → ${ticker} (${displayName}) 자동 완성${priceStr}${yieldMsg}`);
      } catch (err) {
        console.warn("[SmartInference] 예외:", err);
        showToast("오류가 발생했습니다. 티커 셀을 더블클릭하여 직접 입력해주세요.");
      } finally {
        clearTimeout(timeoutId);
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
        <input ref={imageInputRef} type="file" accept="image/jpeg,image/jpg,image/png,image/webp" multiple className="hidden" onChange={handleImageFileChange} />
        <input ref={csvInputRef} type="file" accept=".csv,.xlsx,.xls,.pdf" className="hidden" onChange={handleCsvFileChange} />

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
          {portfolioAssets.some(a => !a.ticker?.trim() && a.name?.trim()) && (
            <button
              type="button"
              disabled={batchInferring}
              onClick={retryMissingTickers}
              title="티커가 없는 종목의 정보를 일괄 재조회합니다"
              className="flex items-center gap-2 rounded-lg border border-violet-200 bg-violet-50 px-4 py-2.5 text-sm font-bold text-violet-600 transition hover:bg-violet-100 disabled:opacity-50"
            >
              {batchInferring
                ? <><Loader2 size={16} className="animate-spin" />{batchProgress.done}/{batchProgress.total} 조회 중…</>
                : <><Sparkles size={16} />티커 재조회 ({portfolioAssets.filter(a => !a.ticker?.trim() && a.name?.trim()).length}개)</>
              }
            </button>
          )}
          <button
            type="button"
            disabled={imageLoading}
            onClick={() => imageInputRef.current?.click()}
            title="여러 화면 동시 선택 가능 (예: 수량 화면 + 평균단가 화면)"
            className="flex items-center gap-2 rounded-lg border border-slate-200 px-4 py-2.5 text-sm font-bold text-slate-600 transition hover:bg-slate-50 disabled:opacity-50"
          >
            {imageLoading ? <Loader2 size={16} className="animate-spin" /> : <Camera size={16} />}
            스크린샷으로 추가
          </button>
          <button
            type="button"
            disabled={csvLoading}
            onClick={() => csvInputRef.current?.click()}
            className="flex items-center gap-2 rounded-lg border border-slate-200 px-4 py-2.5 text-sm font-bold text-slate-600 transition hover:bg-slate-50 disabled:opacity-50"
          >
            {csvLoading ? <Loader2 size={16} className="animate-spin" /> : <FileSpreadsheet size={16} />}
            PDF로 추가
          </button>
          {portfolioAssets.length > 0 && (
            clearConfirm ? (
              <div className="flex items-center gap-2">
                <span className="text-sm font-bold text-red-700">전체 삭제하시겠습니까?</span>
                <button type="button" onClick={clearAllAssets} className="flex items-center gap-1.5 rounded-lg bg-red-600 px-3 py-2.5 text-sm font-bold text-white transition hover:bg-red-700">
                  <Trash2 size={14} /> 삭제
                </button>
                <button type="button" onClick={() => setClearConfirm(false)} className="rounded-lg border border-slate-200 px-3 py-2.5 text-sm font-bold text-slate-600 transition hover:bg-slate-50">
                  취소
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setClearConfirm(true)}
                className="flex items-center gap-2 rounded-lg border border-red-200 px-4 py-2.5 text-sm font-bold text-red-600 transition hover:bg-red-50"
              >
                <Trash2 size={16} />
                전체 초기화
              </button>
            )
          )}
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

        {/* 배치 티커 자동완성 진행 표시 */}
        {batchInferring && (
          <div className="mt-3 rounded-lg border border-violet-200 bg-violet-50 px-4 py-3">
            <div className="mb-2 flex items-center justify-between text-sm font-semibold text-violet-800">
              <span className="flex items-center gap-2">
                <Loader2 size={14} className="animate-spin text-violet-500" />
                티커 자동 완성 중... {batchProgress.done} / {batchProgress.total}
              </span>
              <span className="text-xs text-violet-500">{Math.round((batchProgress.done / batchProgress.total) * 100)}%</span>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-violet-100">
              <div
                className="h-full rounded-full bg-violet-500 transition-all duration-300"
                style={{ width: `${(batchProgress.done / batchProgress.total) * 100}%` }}
              />
            </div>
          </div>
        )}

        {/* 가져오기 에러 */}
        {importError && (
          <div className="mt-3 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">
            <X size={14} className="mt-0.5 shrink-0 cursor-pointer hover:text-red-900" onClick={() => setImportError("")} />
            <span className="whitespace-pre-line">{importError}</span>
          </div>
        )}

        {/* 가져오기 프리뷰 패널 */}
        {importPreview && importPreview.length > 0 && (
          <div className="mt-4 rounded-lg border border-sky-200 bg-sky-50 p-4">
            <div className="mb-3 flex items-center justify-between">
              <div>
                <p className="text-xs font-bold uppercase tracking-wide text-sky-600">가져오기 미리보기</p>
                <p className="mt-0.5 text-sm font-semibold text-navy">
                  {importPreview.length}개 종목 감지됨 — 수정·삭제 후 확정하세요
                </p>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={applyImport}
                  className="flex items-center gap-2 rounded-lg bg-samsung px-4 py-2 text-sm font-bold text-white transition hover:bg-[#1b35bd]"
                >
                  <FileSpreadsheet size={14} />
                  확정
                </button>
                <button
                  type="button"
                  onClick={() => setImportPreview(null)}
                  className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-bold text-slate-600 transition hover:bg-slate-100"
                >
                  취소
                </button>
              </div>
            </div>
            <div className="overflow-x-auto rounded-lg border border-sky-200 bg-white">
              <table className="w-full text-sm">
                <thead className="border-b border-sky-100 bg-sky-50">
                  <tr>
                    <th className="px-3 py-2 text-left text-xs font-bold text-sky-700">#</th>
                    <th className="px-3 py-2 text-left text-xs font-bold text-sky-700">종목명</th>
                    <th className="px-3 py-2 text-left text-xs font-bold text-sky-700">수량</th>
                    <th className="px-3 py-2 text-left text-xs font-bold text-sky-700">매수단가(원)</th>
                    <th className="px-3 py-2 text-left text-xs font-bold text-sky-700"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {importPreview.map((item, i) => (
                    <tr key={i} className="group hover:bg-sky-50">
                      <td className="px-3 py-2 text-xs text-slate-400">{i + 1}</td>
                      <td className="px-3 py-2 text-sm font-semibold text-navy">{item.name}</td>
                      <td className="px-3 py-2">
                        <input
                          type="text"
                          inputMode="numeric"
                          className="h-8 w-24 rounded border border-slate-200 px-2 text-xs text-navy focus:border-sky-400 focus:outline-none"
                          value={item.quantity != null ? item.quantity.toLocaleString("ko-KR") : ""}
                          placeholder="—"
                          onChange={(e) => updatePreviewItem(i, "quantity", e.target.value)}
                        />
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex flex-col gap-0.5">
                          <input
                            type="text"
                            inputMode="numeric"
                            className="h-8 w-28 rounded border border-slate-200 px-2 text-xs text-navy focus:border-sky-400 focus:outline-none"
                            value={item.avgPrice != null ? item.avgPrice.toLocaleString("ko-KR") : ""}
                            placeholder="—"
                            onChange={(e) => updatePreviewItem(i, "avgPrice", e.target.value)}
                          />
                          {item.originalCurrency && item.originalAvgPrice != null && (
                            <span className="text-[10px] text-slate-400">
                              {item.originalCurrency} {item.originalAvgPrice.toLocaleString("en-US")}
                              {item.fxRate ? ` × ${Math.round(item.fxRate).toLocaleString("ko-KR")}` : ""}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-2">
                        <button
                          type="button"
                          onClick={() => removePreviewItem(i)}
                          className="flex h-7 w-7 items-center justify-center rounded border border-slate-200 text-slate-400 opacity-0 transition hover:border-red-200 hover:text-red-600 group-hover:opacity-100"
                          title="이 항목 제거"
                        >
                          <X size={13} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
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
                    "수량(주/개)",
                    "매수단가(원화)",
                    "현재가",
                    "비중(%)",
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
                {(() => {
                  const totalValue = portfolioAssets.reduce(
                    (sum, a) => sum + effectiveValueOf(a), 0
                  );
                  // 1차 정렬 기준: 자산군별 총 평가액 집계
                  const classTotals: Record<string, number> = {};
                  for (const a of portfolioAssets) {
                    const cls = a.productType ?? a.asset_class ?? "기타";
                    classTotals[cls] = (classTotals[cls] ?? 0) + effectiveValueOf(a);
                  }
                  return portfolioAssets
                    .map((a, i) => ({ a, i }))
                    .sort(({ a: a1 }, { a: a2 }) => {
                      const cls1 = a1.productType ?? a1.asset_class ?? "기타";
                      const cls2 = a2.productType ?? a2.asset_class ?? "기타";
                      // 1차: 자산군 총 비중 내림차순
                      const w1 = classTotals[cls1] ?? 0;
                      const w2 = classTotals[cls2] ?? 0;
                      if (w1 !== w2) return w2 - w1;
                      // 2차: 동일 자산군 내 개별 종목 평가액 내림차순
                      return effectiveValueOf(a2) - effectiveValueOf(a1);
                    })
                    .map(({ a, i }) => {
                      const assetValue = effectiveValueOf(a);
                      const weight = totalValue > 0 ? (assetValue / totalValue) * 100 : 0;
                      return (
                        <AssetRow
                          key={i}
                          idx={i}
                          asset={a}
                          weight={weight}
                          isInferring={inferringIdx === i}
                          editingTicker={editingTickerIdx === i}
                          onUpdate={updateRow}
                          onRemove={removeRow}
                          onInfer={handleSmartInference}
                          onStartEditTicker={() => setEditingTickerIdx(i)}
                          onEndEditTicker={() => setEditingTickerIdx(null)}
                        />
                      );
                    });
                })()}
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
  weight: number;
  isInferring: boolean;
  editingTicker: boolean;
  onUpdate: (i: number, patch: Partial<PortfolioAsset>) => void;
  onRemove: (i: number) => void;
  onInfer: (idx: number, name: string) => void;
  onStartEditTicker: () => void;
  onEndEditTicker: () => void;
}

function AssetRow({
  idx, asset: a, weight,
  isInferring, editingTicker,
  onUpdate, onRemove, onInfer, onStartEditTicker, onEndEditTicker,
}: AssetRowProps) {
  const isBond = BOND_TYPES.has(a.productType ?? "");

  // 채권수익률 로컬 문자열 상태 — "3." 같은 중간 입력값 보존
  const [bondYieldRaw, setBondYieldRaw] = useState<string>(
    a.bond_yield != null ? String(a.bond_yield) : ""
  );
  useEffect(() => {
    setBondYieldRaw(a.bond_yield != null ? String(a.bond_yield) : "");
  }, [a.bond_yield]);

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

      {/* 수량(주/개) — 채권 유형일 때 잠금 */}
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

      {/* 현재가 — current_price 우선, 없으면 buy_price 폴백 */}
      <td className="px-3 py-2">
        <div className="flex h-9 min-w-[80px] items-center rounded bg-slate-50 px-2 text-xs text-slate-600 select-none">
          {(() => {
            const ep = effectivePriceOf(a);
            return ep > 0
              ? fmtPrice(ep)
              : <span className="text-slate-300">—</span>;
          })()}
        </div>
      </td>

      {/* 비중(%) — 전체 자산 평가금액 대비 실시간 연산 */}
      <td className="px-3 py-2">
        <div className="flex h-9 min-w-[52px] items-center justify-end rounded bg-slate-50 px-2 text-xs font-semibold text-navy select-none">
          {weight > 0
            ? `${weight.toFixed(1)}%`
            : <span className="font-normal text-slate-300">—</span>}
        </div>
      </td>

      {/* 채권 수익률(%) — 채권 유형일 때만 활성화, 소수점 타이핑 맥락 보존 */}
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
          value={isBond ? bondYieldRaw : ""}
          disabled={!isBond}
          onChange={(e) => {
            let raw = e.target.value.replace(/[^0-9.]/g, "");
            const dotIdx = raw.indexOf(".");
            if (dotIdx !== -1) raw = raw.slice(0, dotIdx + 1) + raw.slice(dotIdx + 1).replace(/\./g, "");
            setBondYieldRaw(raw);
            const num = parseFloat(raw);
            onUpdate(idx, { bond_yield: raw && !isNaN(num) ? num : null });
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
