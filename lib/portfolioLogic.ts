// ─── 영어→한글 섹터 매핑 사전 ──────────────────────────────────────────────────
// Yahoo Finance assetProfile.sector / .industry 영어명 → 국내 실정 한글명

const SECTOR_EN_TO_KO: Record<string, string> = {
  // 대분류 섹터 (assetProfile.sector)
  Technology:                   "IT/기술",
  Healthcare:                   "헬스케어",
  Financials:                   "금융",
  "Financial Services":         "금융서비스",
  "Consumer Discretionary":     "소비재(경기민감)",
  "Consumer Cyclical":          "소비재(경기민감)",
  "Consumer Staples":           "소비재(필수)",
  "Consumer Defensive":         "소비재(필수)",
  Energy:                       "에너지",
  Materials:                    "소재",
  Industrials:                  "산업재",
  Utilities:                    "유틸리티",
  "Real Estate":                "부동산/리츠",
  "Communication Services":     "통신서비스",
  "Basic Materials":            "소재",
  // 세부 산업 (assetProfile.industry)
  Semiconductors:               "반도체",
  "Semiconductor Equipment":    "반도체장비",
  "Aerospace & Defense":        "방산",
  Defense:                      "방산",
  "Software—Application":       "소프트웨어",
  "Software—Infrastructure":    "소프트웨어",
  "Software - Application":     "소프트웨어",
  "Software - Infrastructure":  "소프트웨어",
  Biotechnology:                "바이오",
  "Drug Manufacturers—General": "제약",
  "Drug Manufacturers - General":"제약",
  "Medical Devices":            "의료기기",
  "Banks—Regional":             "은행",
  "Banks—Diversified":          "은행",
  "Banks - Regional":           "은행",
  "Banks - Diversified":        "은행",
  Insurance:                    "보험",
  "Asset Management":           "자산운용",
  "Oil & Gas E&P":              "에너지",
  "Oil & Gas Integrated":       "에너지",
  "Oil & Gas—E&P":              "에너지",
  Steel:                        "철강",
  "Auto Manufacturers":         "자동차",
  "Internet Content & Information":"인터넷/플랫폼",
  "Internet Retail":            "인터넷/플랫폼",
  "Specialty Retail":           "유통/소매",
  "Electronic Components":      "전자부품",
  "Consumer Electronics":       "전자제품",
  Marine:                       "조선",
  "Shipbuilding":               "조선",
  "Electrical Equipment":       "전기장비",
  "Electric Utilities":         "유틸리티",
  "Renewable Utilities":        "신재생에너지",
  "Diversified Industrials":    "복합산업재",
  "Capital Markets":            "자본시장",
  "Credit Services":            "금융서비스",
  "Industrial Distribution":    "산업재",
  "Specialty Chemicals":        "화학",
  Chemicals:                    "화학",
  "Agricultural Products":      "농업",
  "Food Distribution":          "식품유통",
  "Food Confectioners":         "식품",
  Restaurants:                  "외식",
  "Packaged Foods":             "식품",
  Telecommunications:           "통신",
  "Telecom Services":           "통신",
  "Wireless Telecom Services":  "통신",
};

// theme 한글 값 → 표준 한글 섹터명 폴백 매핑
const THEME_TO_SECTOR_KO: Record<string, string> = {
  기술주:     "IT/기술",
  반도체:     "반도체",
  방산:       "방산",
  방산주:     "방산",
  헬스케어:   "헬스케어",
  바이오:     "바이오",
  제약:       "제약",
  금융주:     "금융",
  은행:       "은행",
  에너지:     "에너지",
  원자재:     "소재",
  소비재:     "소비재(경기민감)",
  필수소비재: "소비재(필수)",
  산업재:     "산업재",
  조선:       "조선",
  유틸리티:   "유틸리티",
  통신:       "통신서비스",
  부동산:     "부동산/리츠",
  리츠:       "부동산/리츠",
  철강:       "철강",
  화학:       "화학",
  자동차:     "자동차",
  플랫폼:     "인터넷/플랫폼",
  인터넷:     "인터넷/플랫폼",
  "2차전지":  "2차전지",
  배터리:     "2차전지",
  우주:       "우주/항공",
  항공우주:   "우주/항공",
};

// 종목명·티커 키워드 → 섹터 매핑 (API 실패 시 최후 폴백)
// 패턴 순서: 긴 패턴 / 더 구체적인 패턴이 앞에 오도록 정렬
const KEYWORD_SECTOR_MAP: Array<[RegExp, string]> = [
  // ── 반도체 ─────────────────────────────────────────────
  [/hynix|하이닉스|sk.?hynix/i,                "반도체"],
  [/삼성전자|samsung.?electron/i,              "반도체"],
  [/micron|SEMICON|반도체|semiconductor/i,      "반도체"],
  [/nvda|nvidia/i,                              "반도체"],
  [/amd|advanced.?micro/i,                     "반도체"],
  [/tsmc|台積電/i,                              "반도체"],
  [/qualcomm|qcom/i,                            "반도체"],
  [/intel|intc/i,                               "반도체"],
  [/sandisk|sndisk|wdc|western.?digital/i,      "반도체"],
  [/kioxia/i,                                   "반도체"],
  // ── 2차전지 ────────────────────────────────────────────
  [/energy.?solution|에너지솔루션|LG.?ENS/i,   "2차전지"],
  [/삼성SDI|samsung.?sdi/i,                    "2차전지"],
  [/SK이노베이션|SKINO|sk.?innov/i,            "2차전지"],
  [/포스코퓨처엠|posco.?future/i,              "2차전지"],
  [/2차전지|배터리|battery|TIGER.*(2차|배터리)|KODEX.*(2차|배터리)/i, "2차전지"],
  // ── IT/기술 ────────────────────────────────────────────
  [/apple|aapl/i,                               "IT/기술"],
  [/삼성SDS|samsung.?sds/i,                    "IT/기술"],
  [/SK텔레콤|SKT|sk.?telecom/i,               "통신서비스"],
  [/KT(?!\w)|kt.?corp/i,                       "통신서비스"],
  [/LGU\+|lg.?uplus|lg유플러스/i,             "통신서비스"],
  // ── 소프트웨어 ─────────────────────────────────────────
  [/microsoft|msft/i,                           "소프트웨어"],
  [/salesforce|crm/i,                           "소프트웨어"],
  [/oracle|orcl/i,                              "소프트웨어"],
  [/adobe|adbe/i,                               "소프트웨어"],
  // ── 인터넷/플랫폼 ──────────────────────────────────────
  [/alphabet|googl|google/i,                    "인터넷/플랫폼"],
  [/meta.?(platform)?|facebook/i,              "인터넷/플랫폼"],
  [/amazon|amzn/i,                              "인터넷/플랫폼"],
  [/naver|NAVER/i,                              "인터넷/플랫폼"],
  [/kakao(?!bank|pay)/i,                        "인터넷/플랫폼"],
  [/coupang|쿠팡/i,                             "인터넷/플랫폼"],
  // ── 방산/우주 ──────────────────────────────────────────
  [/rocket.?lab|rklb/i,                        "우주/항공"],
  [/lockheed|lmt/i,                            "방산"],
  [/boeing|ba(?=\b)/i,                         "방산"],
  [/raytheon|rtx/i,                            "방산"],
  [/한화에어로|hanwha.?aero/i,                 "방산"],
  [/LIG넥스원|LIG.?nex/i,                     "방산"],
  [/현대로템|hyundai.?rotem/i,                 "방산"],
  [/방산|defense|defence/i,                    "방산"],
  [/KODEX.*방산|TIGER.*방산/i,                 "방산"],
  // ── 자동차 ─────────────────────────────────────────────
  [/tesla|tsla/i,                               "자동차"],
  [/현대차|hyundai.?motor/i,                   "자동차"],
  [/기아(?!타이거)|KIA.?motor/i,               "자동차"],
  [/GM|general.?motors/i,                      "자동차"],
  [/토요타|toyota/i,                            "자동차"],
  // ── 조선 ───────────────────────────────────────────────
  [/HD현대중공업|HHI|현대중공업/i,             "조선"],
  [/한국조선해양|korea.?shipbuild/i,           "조선"],
  [/삼성중공업|samsung.?heavy/i,              "조선"],
  [/대우조선|대우건설/i,                        "조선"],
  // ── 철강/소재 ──────────────────────────────────────────
  [/포스코|POSCO/i,                            "철강"],
  [/현대제철|hyundai.?steel/i,                 "철강"],
  // ── 금융/은행 ──────────────────────────────────────────
  [/카카오뱅크|kakaobank/i,                    "금융서비스"],
  [/KB금융|kb.?financial/i,                   "은행"],
  [/신한|shinhan/i,                            "은행"],
  [/하나금융|hana.?financial/i,               "은행"],
  [/우리금융|woori.?financial/i,              "은행"],
  [/berkshire|brk/i,                           "금융"],
  // ── 헬스케어/바이오 ────────────────────────────────────
  [/셀트리온|celltrion/i,                      "바이오"],
  [/삼성바이오|samsung.?bio/i,                 "바이오"],
  [/johnson.?\&.?johnson|jnj/i,               "헬스케어"],
  [/pfizer|pfe/i,                              "제약"],
  [/merck|mrk/i,                               "제약"],
  // ── 에너지 ─────────────────────────────────────────────
  [/exxon|xom/i,                               "에너지"],
  [/chevron|cvx/i,                             "에너지"],
  // ── 유통/소매 ──────────────────────────────────────────
  [/walmart|wmt/i,                             "유통/소매"],
  [/costco|cost/i,                             "유통/소매"],
  // ── ETF 섹터 패턴 ──────────────────────────────────────
  [/TIGER.*반도체|KODEX.*반도체|ACE.*반도체/i, "반도체"],
  [/TIGER.*바이오|KODEX.*바이오/i,             "바이오"],
  [/TIGER.*헬스케어|KODEX.*헬스케어/i,        "헬스케어"],
  [/TIGER.*에너지|KODEX.*에너지/i,            "에너지"],
  [/TIGER.*금융|KODEX.*금융/i,               "금융"],
  [/TIGER.*소비|KODEX.*소비/i,               "소비재(경기민감)"],
  [/TIGER.*미국S&P500|KODEX.*미국S&P500|SPY|IVV|VOO/i, "IT/기술"],
  [/TIGER.*나스닥|KODEX.*나스닥|QQQ/i,       "IT/기술"],
];

function resolveSectorByKeyword(name: string | undefined, ticker: string | undefined): string {
  const haystack = [name, ticker].filter(Boolean).join(" ");
  if (!haystack) return "";
  for (const [pattern, sector] of KEYWORD_SECTOR_MAP) {
    if (pattern.test(haystack)) return sector;
  }
  return "";
}

function resolveSectorKo(
  sectorEn: string | null | undefined,
  industryEn: string | null | undefined,
  theme: string | null | undefined,
  name?: string,
  ticker?: string,
): string {
  // 1순위: industry(세부) 영어 매핑
  if (industryEn) {
    const mapped = SECTOR_EN_TO_KO[industryEn];
    if (mapped) return mapped;
  }
  // 2순위: sector(대분류) 영어 매핑
  if (sectorEn) {
    const mapped = SECTOR_EN_TO_KO[sectorEn];
    if (mapped) return mapped;
    return sectorEn; // 매핑 없으면 영어 그대로
  }
  // 3순위: theme 한글 폴백
  if (theme) {
    const t = theme.trim();
    const mapped = THEME_TO_SECTOR_KO[t];
    if (mapped) return mapped;
    if (t && t !== "기타") return t;
  }
  // 4순위: 종목명/티커 키워드 기반 강력 폴백
  const fromKeyword = resolveSectorByKeyword(name, ticker);
  if (fromKeyword) return fromKeyword;
  return "";
}

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
  dividendYield?: number;              // Yahoo Finance 연간 배당수익률 (소수)
  trailingAnnualDividendRate?: number; // Yahoo Finance 주당 연간 배당금
  sector?: string;           // 한글 변환 섹터명 (Yahoo Finance assetProfile.sector/industry → 매핑)
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
      // 모든 조기 리턴 경로에서도 키워드 폴백 섹터를 적용하는 헬퍼
      const withKeywordSector = (asset: typeof a) => {
        if (asset.sector) return asset; // 이미 섹터 있으면 그대로
        const s = resolveSectorKo(null, null, asset.theme, asset.name, asset.ticker) || undefined;
        return s ? { ...asset, sector: s } : asset;
      };

      if (a.amount_type !== "quantity" || !a.name) return withKeywordSector(a);
      // 채권은 Yahoo Finance 조회 불가 — enrichedWithBonds 단계에서 buy_price × amount로 처리
      if (a.productType === '국내채권' || a.productType === '해외채권') return withKeywordSector(a);
      // 현재가와 배당수익률이 모두 있으면 API 재요청 생략 (sector 없으면 키워드 폴백)
      if (a.current_price != null && a.current_price > 0 && a.dividendYield != null) return withKeywordSector(a);

      try {
        const TICKER_RE = /^[\w.\-=^]+$/;
        const queryParam =
          a.ticker?.trim() && TICKER_RE.test(a.ticker.trim())
            ? a.ticker.trim()
            : a.name;
        const qp = new URLSearchParams({ assetName: queryParam });
        if (a.productType) qp.set('productType', a.productType);
        const res = await fetch(`/api/proxy-finance?${qp}`);
        if (!res.ok) return a;
        const json = await res.json();
        const result = json?.chart?.result?.[0];
        const meta = result?.meta;

        // 배당수익률 — proxy-finance 응답 최상단에 반환됨
        const dy   = typeof json.dividendYield === "number" && json.dividendYield > 0
          ? json.dividendYield : undefined;
        const tadr = typeof json.trailingAnnualDividendRate === "number" && json.trailingAnnualDividendRate > 0
          ? json.trailingAnnualDividendRate : undefined;

        // 섹터 — proxy-finance 응답의 sectorEn/industryEn → 한글 변환 (name/ticker 키워드 폴백 포함)
        const sectorEnVal   = typeof json.sectorEn   === "string" ? json.sectorEn   : null;
        const industryEnVal = typeof json.industryEn === "string" ? json.industryEn : null;
        const resolvedSector = resolveSectorKo(sectorEnVal, industryEnVal, a.theme, a.name, a.ticker) || undefined;

        // 현재가가 이미 있으면 배당 + 섹터 데이터만 보완하고 리턴
        if (a.current_price != null && a.current_price > 0) {
          return {
            ...a,
            current_value: a.amount * a.current_price,
            ...(dy             != null ? { dividendYield:              dy             } : {}),
            ...(tadr           != null ? { trailingAnnualDividendRate: tadr           } : {}),
            ...(resolvedSector != null ? { sector:                     resolvedSector } : {}),
          };
        }

        // regularMarketPrice 우선 사용 → 당일 실시간 가격
        let lastPrice: number | null = null;
        if (typeof meta?.regularMarketPrice === "number" && meta.regularMarketPrice > 0) {
          lastPrice = meta.regularMarketPrice;
        } else {
          const closes: (number | null)[] = result?.indicators?.quote?.[0]?.close ?? [];
          lastPrice = closes.filter((v): v is number => v != null && !Number.isNaN(v)).at(-1) ?? null;
        }

        if (typeof lastPrice === "number" && lastPrice > 0) {
          const isUsd = (meta?.currency ?? "USD") === "USD";
          const priceKrw = isUsd ? lastPrice * currentExchangeRate : lastPrice;
          const cvKrw = a.amount * priceKrw;
          return {
            ...a,
            current_price: priceKrw,
            current_value: cvKrw,
            ...(dy             != null ? { dividendYield:              dy             } : {}),
            ...(tadr           != null ? { trailingAnnualDividendRate: tadr           } : {}),
            ...(resolvedSector != null ? { sector:                     resolvedSector } : {}),
          };
        }
      } catch {
        /* API 조회 실패 — 키워드 기반 섹터 폴백만 적용하고 나머지 값 유지 */
      }
      // API 전체 실패 시에도 name/ticker 키워드로 섹터 추론 시도
      const fallbackSector = resolveSectorKo(null, null, a.theme, a.name, a.ticker) || undefined;
      return fallbackSector ? { ...a, sector: fallbackSector } : a;
    })
  );

  // ── Step 0-c: 실물 채권 cost-basis 폴백 ──
  // 채권(국내/해외)은 수량 × 매수단가로 평가금액을 산출한다.
  // amount_type·current_price 조건을 제거하여 Supabase 로드 데이터에서도 안전하게 처리한다.
  const enrichedWithBonds = enrichedAssets.map((a) => {
    const isBond = a.productType === '국내채권' || a.productType === '해외채권';
    if (!isBond) return a;
    const bp  = Number(a.buy_price);
    const amt = Number(a.amount);
    if (bp > 0 && amt > 0) {
      return { ...a, current_price: bp, current_value: amt * bp };
    }
    return a;
  });

  // ── Step 0-d: buy_price cost-basis 폴백 (전체 quantity 자산) ──
  // 최근 상장·거래정지·차트 데이터 공백으로 current_price가 0인 자산에 적용.
  // 매수단가(buy_price)가 입력된 경우 이를 현재가 대용으로 사용하여
  // totalCheck=0 → 분석 불가 상태를 방지한다.
  const enrichedFinal = enrichedWithBonds.map((a) => {
    if (
      a.amount_type === 'quantity' &&
      (a.current_price == null || a.current_price === 0) &&
      a.buy_price != null && a.buy_price > 0
    ) {
      const isUsdAsset = a.asset_class === '해외주식' || a.asset_class === '해외채권';
      const priceKrw   = isUsdAsset
        ? a.buy_price * currentExchangeRate
        : a.buy_price;
      return { ...a, current_price: priceKrw, current_value: a.amount * priceKrw };
    }
    return a;
  });

  // 자산 총액이 0원이면 분석 불가
  const totalCheck = enrichedFinal.reduce((s, a) => {
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
  const totalValue = enrichedFinal.reduce((s, a) => {
    const v =
      a.current_value ??
      (a.amount_type === "quantity" ? (a.current_price ?? 0) * a.amount : a.amount ?? 0);
    return s + v;
  }, 0);

  // ── Step 2: 비중(w_i) 및 평가손익 계산 ──
  const assetsWithWeights = enrichedFinal.map((a) => {
    const value =
      (a.current_value != null && a.current_value > 0)
        ? a.current_value
        : (a.amount_type === "quantity" ? (a.current_price ?? 0) * a.amount : a.amount ?? 0);
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
    productType: a.productType ?? '',
    asset_class: a.asset_class ?? '',
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
      bond_yield: a.bond_yield,
      bond_maturity: a.bond_maturity,
    },
  }));

  // ── Step 4: quantEngine 호출 ──
  const qr = await runQuantAnalysis(quantInput, tMarginal);
  const sr = await runStressTest(quantInput, totalValue);

  const userInterest = parseKoreanNumber(expectedInterestIncome);
  const userDividend = parseKoreanNumber(expectedDividendIncome);

  // ── 실소득 기반 금융소득 산출 (FinancialIncomeGauge.tsx 동일 수식) ─────────────
  // qr.tax.financialIncome 은 gain(자본 차익)을 이자·배당 대리값으로 사용하여
  // 자본 차익이 크면 금융소득을 대폭 과대 계상한다.
  // 대신 실제 수익률 데이터(dividendYield, bond_yield)에서 연간 소득을 직접 산출한다.
  const actualInterestIncome = assetsWithWeights.reduce((s, a) => {
    const isBond = a.productType === '국내채권' || a.productType === '해외채권';
    if (!isBond) return s;
    // 채권 원금: 수량 기준이면 매수단가 × 수량, 금액 기준이면 amount 그대로
    const principal = a.amount_type === 'quantity'
      ? (a.buy_price ?? 0) * a.amount
      : a.amount;
    // bond_yield 는 %(예: 5.0) 단위 → 소수 변환
    return s + principal * ((a.bond_yield ?? 0) / 100);
  }, 0);

  const actualDividendIncome = assetsWithWeights.reduce((s, a) => {
    const isBond = a.productType === '국내채권' || a.productType === '해외채권';
    if (isBond) return s;
    // dividendYield 는 Yahoo Finance 제공 소수값(예: 0.02 = 2%)
    const value = a.current_value
      ?? (a.amount_type === 'quantity' ? (a.current_price ?? 0) * a.amount : a.amount);
    return s + value * (a.dividendYield ?? 0);
  }, 0);

  const financialIncomeTaxForHealth =
    userInterest > 0 || userDividend > 0
      ? financialIncomeTaxCalculation(userInterest, userDividend, tMarginal)
      : financialIncomeTaxCalculation(actualInterestIncome, actualDividendIncome, tMarginal);

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
