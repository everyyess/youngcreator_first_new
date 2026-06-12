// ─── Korean number parsing utility ───────────────────────────────────────────

export const parseKoreanNumber = (str: string): number => {
  if (!str) return 0;
  const n = str.replace(/[^0-9.억만천]/g, "");
  let result = 0;
  const eok = n.match(/([0-9.]+)억/);
  const man = n.match(/([0-9.]+)만/);
  if (eok) result += parseFloat(eok[1]) * 1e8;
  if (man) result += parseFloat(man[1]) * 1e4;
  if (!eok && !man) result = parseFloat(n.replace(/[^0-9.]/g, "")) || 0;
  return result;
};

// ─── Portfolio quantitative analysis (pure async function) ───────────────────

const FOREIGN_CLASSES = new Set(["해외주식", "해외채권", "달러"]);

export interface PortfolioAssetInput {
  name: string;
  asset_class: string;
  theme: string;
  country: string;
  buy_price: number | null;
  amount: number;
  amount_type: "quantity" | "value";
  is_hedged: boolean;        // 항상 false — 환노출 고정
  needs_review: boolean;
  review_reason?: string | null;
  current_price?: number;
  current_value?: number;
  weight?: number;
  gain?: number;
  price_source?: string;
  _rawAmount?: string;
  ticker?: string;           // Yahoo Finance 티커 — 설정 시 이름 해석(Gemini) 생략
  productType?: string;      // 통합 상품유형 (국내주식|해외주식|국내채권|해외채권|국내ETF|해외ETF|예적금/현금)
  bond_yield?: number | null;    // 채권 수익률(%) — 채권 유형일 때만
  bond_maturity?: number | null; // 채권 만기(년) — 채권 유형일 때만
}

export interface RunAnalysisResult {
  enrichedAssets: PortfolioAssetInput[];
  portfolioIssueSummary: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  quantResult: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  stressResult: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  healthResult: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tlhResult: any;
}

export const runAnalysis = async (
  assets: PortfolioAssetInput[],
  {
    tMarginal = 0.38,
    expectedInterestIncome = "0",
    expectedDividendIncome = "0",
  }: {
    tMarginal?: number;
    expectedInterestIncome?: string;
    expectedDividendIncome?: string;
  } = {}
): Promise<RunAnalysisResult | null> => {
  if (!assets.length) return null;

  // ── Step 0-a: 실시간 원/달러 환율 조회 (KRW=X) ──
  let currentExchangeRate = 1380;
  try {
    const fxRes = await fetch(`/api/proxy-finance?assetName=${encodeURIComponent("KRW=X")}`);
    if (fxRes.ok) {
      const fxJson = await fxRes.json();
      const fxResult = fxJson?.chart?.result?.[0];
      const fxMeta = fxResult?.meta;
      // regularMarketPrice 우선 (실시간), 없으면 마지막 월봉 종가
      let latestFx: number | null = null;
      if (typeof fxMeta?.regularMarketPrice === "number" && fxMeta.regularMarketPrice > 0) {
        latestFx = fxMeta.regularMarketPrice;
      } else {
        const fxCloses: (number | null)[] = fxResult?.indicators?.quote?.[0]?.close ?? [];
        latestFx = fxCloses.filter((v): v is number => v != null && !Number.isNaN(v)).at(-1) ?? null;
      }
      if (typeof latestFx === "number" && latestFx > 0) {
        currentExchangeRate = latestFx;
      }
    }
  } catch {
    console.warn("실시간 환율 로드 실패. 기본 환율 1380을 적용합니다.");
  }

  // ── Step 0-b: quantity 자산에 실시간 현재가 자동 조회 ──
  // current_price 는 항상 원화(KRW) 로 정규화하여 저장한다.
  // 통화 판단: Yahoo Finance meta.currency === "USD" 이면 환율을 곱해 원화로 환산.
  // 이 방식은 FOREIGN_CLASSES 열거 없이도 금·암호화폐·해외ETF 등을 자동 처리한다.
  const enrichedAssets = await Promise.all(
    assets.map(async (a) => {
      if (
        a.amount_type !== "quantity" ||
        !a.name ||
        (a.current_price != null && a.current_price > 0)
      ) {
        return a;
      }
      try {
        const TICKER_RE = /^[\w.\-=^]+$/;
        const queryParam =
          a.ticker?.trim() && TICKER_RE.test(a.ticker.trim())
            ? a.ticker.trim()
            : a.name;
        const res = await fetch(`/api/proxy-finance?assetName=${encodeURIComponent(queryParam)}`);
        if (!res.ok) return a;
        const json = await res.json();
        const result = json?.chart?.result?.[0];
        const meta = result?.meta;

        // regularMarketPrice 우선 사용 → 당일 실시간 가격 (adjclose 오파싱 방지)
        // 없으면 월봉 quote.close 마지막 값으로 폴백 (adjclose 사용 안 함)
        let lastPrice: number | null = null;
        if (typeof meta?.regularMarketPrice === "number" && meta.regularMarketPrice > 0) {
          lastPrice = meta.regularMarketPrice;
        } else {
          const closes: (number | null)[] = result?.indicators?.quote?.[0]?.close ?? [];
          lastPrice = closes.filter((v): v is number => v != null && !Number.isNaN(v)).at(-1) ?? null;
        }

        if (typeof lastPrice === "number" && lastPrice > 0) {
          // meta.currency 로 달러 자산 판단 → USD 이면 원화로 변환
          const isUsd = (meta?.currency ?? "USD") === "USD";
          const priceKrw = isUsd ? lastPrice * currentExchangeRate : lastPrice;
          const cvKrw = a.amount * priceKrw;
          return { ...a, current_price: priceKrw, current_value: cvKrw };
        }
      } catch {
        /* 조회 실패 시 기존 값 유지 */
      }
      return a;
    })
  );

  // 자산 총액이 0원이면 분석 불가
  const totalCheck = enrichedAssets.reduce((s, a) => {
    const v =
      a.current_value ??
      (a.amount_type === "quantity" ? (a.current_price ?? 0) * a.amount : a.amount ?? 0);
    return s + v;
  }, 0);
  if (totalCheck === 0) return null;

  const {
    runQuantAnalysis,
    runStressTest,
    portfolioHealthCheck,
    generateTLHRecommendations,
    financialIncomeTaxCalculation,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } = await import("../utils/quantEngine.js") as any;

  // ── Step 1: 총 자산 가치 계산 ──
  const totalValue = enrichedAssets.reduce((s, a) => {
    const v =
      a.current_value ??
      (a.amount_type === "quantity" ? (a.current_price ?? 0) * a.amount : a.amount ?? 0);
    return s + v;
  }, 0);

  // ── Step 2: 비중(w_i) 및 평가손익 계산 ──
  const assetsWithWeights = enrichedAssets.map((a) => {
    const value =
      a.current_value ??
      (a.amount_type === "quantity" ? (a.current_price ?? 0) * a.amount : a.amount ?? 0);
    const weight = totalValue > 0 ? value / totalValue : 0;

    let gain = a.gain ?? 0;
    if (!gain && a.buy_price != null && a.buy_price > 0 && a.amount > 0) {
      if (a.amount_type === "quantity" && a.current_price != null && a.current_price > 0) {
        gain = (a.current_price - a.buy_price) * a.amount;
      } else if (a.amount_type === "value" && a.current_price != null && a.current_price > 0) {
        const inferredQty = a.amount / a.buy_price;
        gain = inferredQty * (a.current_price - a.buy_price);
      }
    }

    return { ...a, weight, current_value: value, gain };
  });

  // ── Step 3: quantEngine 입력 형식 변환 ──
  const quantInput = assetsWithWeights.map((a) => ({
    name: a.name,
    weight: a.weight ?? 0,
    value: a.current_value ?? 0,
    gain: a.gain ?? 0,
    _meta: {
      asset_class: a.asset_class,
      theme: a.theme,
      country: a.country,
      is_hedged: a.is_hedged,
      isHedging: a.is_hedged,         // quantEngine isHedging 필드 alias
      productType: a.productType ?? '',
      ticker: a.ticker ?? '',
      buy_price: a.buy_price,
      current_price: a.current_price,
      amount: a.amount,
      amount_type: a.amount_type,
    },
  }));

  // ── Step 4: quantEngine 호출 ──
  const qr = await runQuantAnalysis(quantInput, tMarginal);
  const sr = runStressTest(quantInput, totalValue);

  const userInterest = parseKoreanNumber(expectedInterestIncome);
  const userDividend = parseKoreanNumber(expectedDividendIncome);
  const financialIncomeTaxForHealth =
    userInterest > 0 || userDividend > 0
      ? financialIncomeTaxCalculation(userInterest, userDividend, tMarginal)
      : qr.tax.financialIncome;

  const hr = portfolioHealthCheck(
    {
      diversificationScore: assetsWithWeights.length <= 1 ? 0 : qr.risk.diversificationScore,
      volatility: qr.risk.volatility,
      sharpeRatio: qr.performance.sharpeRatio,
      mdd: qr.risk.mdd,
      financialIncomeTax: financialIncomeTaxForHealth,
    },
    quantInput,
    tMarginal
  );

  const tlhResult = generateTLHRecommendations(quantInput, tMarginal);

  // ── Step 5: 포트폴리오 이슈 요약 텍스트 생성 ──
  let portfolioIssueSummary = "";
  const hasPortfolioIssues = hr.badge !== "Hold" || (sr.riskTypes?.length ?? 0) > 0;
  if (hasPortfolioIssues) {
    const blufParts: string[] = [];
    if (hr.summary) blufParts.push(hr.summary);
    if ((sr.riskTypes?.length ?? 0) > 0 && sr.diagnosis) blufParts.push(sr.diagnosis);
    portfolioIssueSummary = blufParts.join("  •  ");
  }

  return { enrichedAssets: assetsWithWeights, portfolioIssueSummary, quantResult: qr, stressResult: sr, healthResult: hr, tlhResult };
};
