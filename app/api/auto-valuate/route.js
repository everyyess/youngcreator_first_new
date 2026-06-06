/**
 * /api/auto-valuate
 * POST: 자산 목록 → 하이브리드 수집 엔진 → 현재가 조회 → w_i 자동 계산
 *
 * Request:  { assets: PortfolioAsset[] }
 * Response: { assets: ValuatedAsset[], totalValue: number }
 *
 * 하이브리드 수집 전략:
 *  1순위 – Yahoo Finance v8 API (해외주식, ETF, 금, 원자재, 해외채권)
 *  2순위 – 국내 종목 티커 변환 후 Yahoo Finance (.KS/.KQ 접미사)
 *  3순위 – Mock 현재가 (국내채권, 환율, 부동산, 분류 불명)
 */

export const runtime = 'nodejs';

// ── 국내 주요 종목 티커 매핑 (Yahoo Finance .KS/.KQ) ─────────
const KR_TICKER_MAP = {
  '삼성전자':   '005930.KS',
  'SK하이닉스': '000660.KS',
  'LG에너지솔루션': '373220.KS',
  '현대차':     '005380.KS',
  '현대자동차': '005380.KS',
  'POSCO홀딩스': '005490.KS',
  'KB금융':     '105560.KS',
  '신한지주':   '055550.KS',
  '하나금융지주': '086790.KS',
  '우리금융지주': '316140.KS',
  'NAVER':      '035420.KS',
  '네이버':     '035420.KS',
  '카카오':     '035720.KS',
  '셀트리온':   '068270.KS',
  '삼성바이오로직스': '207940.KS',
  'LG화학':     '051910.KS',
  '기아':       '000270.KS',
  'LG전자':     '066570.KS',
  '삼성SDI':    '006400.KS',
  '카카오뱅크': '323410.KS',
};

// ── 해외 주요 티커 정규화 ─────────────────────────────────────
const TICKER_ALIASES = {
  '애플':   'AAPL', '마이크로소프트': 'MSFT', '구글': 'GOOGL',
  '아마존': 'AMZN', '메타':          'META',  '엔비디아':    'NVDA',
  '테슬라': 'TSLA', '넷플릭스':      'NFLX',  'AMD':         'AMD',
  '골드':   'GLD',  '금ETF':         'GLD',   '미국채10년':  'TLT',
  '미국채2년': 'SHY', '미국채':       'IEF',   '달러인덱스': 'UUP',
};

// ── 자산군별 Mock 현재가 기준 ─────────────────────────────────
const MOCK_PRICE_PROFILES = {
  '국내주식':  { base: 50_000,     noise: 0.03 },
  '해외주식':  { base: 200,        noise: 0.02 },   // USD 환산 전 원화 표시
  '국내채권':  { base: 10_000,     noise: 0.002 },
  '해외채권':  { base: 95,         noise: 0.005 },
  '금':        { base: 340_000,    noise: 0.015 },   // 1g 기준 원화
  '리츠':      { base: 5_000,      noise: 0.02 },
  '현금':      { base: 1,          noise: 0 },
  '달러':      { base: 1_320,      noise: 0.01 },    // USD/KRW
  '_default':  { base: 100_000,    noise: 0.025 },
};

// ── Yahoo Finance 현재가 조회 ─────────────────────────────────
async function fetchYahooCurrentPrice(ticker) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}` +
              `?interval=1d&range=5d`;
  try {
    const res  = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(5_000) });
    if (!res.ok) return null;
    const json = await res.json();
    const closes = json?.chart?.result?.[0]?.indicators?.quote?.[0]?.close ?? [];
    const last   = closes.filter(Boolean).at(-1);
    return typeof last === 'number' ? last : null;
  } catch {
    return null;
  }
}

// ── 티커 후보 목록 생성 ───────────────────────────────────────
function resolveTickers(asset) {
  const name    = asset.name?.trim() ?? '';
  const upper   = name.toUpperCase();
  const candidates = [];

  // 1. 국내 종목 매핑
  if (KR_TICKER_MAP[name]) candidates.push(KR_TICKER_MAP[name]);

  // 2. 해외 별칭 매핑
  if (TICKER_ALIASES[name]) candidates.push(TICKER_ALIASES[name]);

  // 3. 원본이 그대로 티커처럼 보이면 사용
  if (/^[A-Z0-9.^-]{1,10}$/.test(upper)) candidates.push(upper);

  // 4. 국내주식이면 .KS, .KQ 접미사 시도
  if (asset.asset_class === '국내주식' && /^\d{6}$/.test(name)) {
    candidates.push(`${name}.KS`, `${name}.KQ`);
  }

  return [...new Set(candidates)];
}

// ── Mock 현재가 생성 ─────────────────────────────────────────
function generateMockPrice(assetClass) {
  const profile = MOCK_PRICE_PROFILES[assetClass] ?? MOCK_PRICE_PROFILES['_default'];
  const noise   = (Math.random() - 0.5) * 2 * profile.noise;
  return +(profile.base * (1 + noise)).toFixed(2);
}

// ── 단일 자산 가치 평가 ───────────────────────────────────────
async function valuateSingleAsset(asset) {
  let currentPrice = null;
  let priceSource  = 'mock';

  // Yahoo Finance 시도
  const tickers = resolveTickers(asset);
  for (const ticker of tickers) {
    const price = await fetchYahooCurrentPrice(ticker);
    if (price !== null) {
      currentPrice = price;
      priceSource  = 'yahoo';
      break;
    }
  }

  // Fallback: Mock 현재가
  if (currentPrice === null) {
    currentPrice = generateMockPrice(asset.asset_class);
    priceSource  = 'mock';
  }

  // current_value 계산
  let currentValue;
  if (asset.amount_type === 'quantity') {
    // 보유수량 × 현재가
    currentValue = (asset.amount ?? 0) * currentPrice;
  } else {
    // 이미 금액(원) 기준이면 현재가 비율로 조정
    // (buy_price 대비 현재가 변동률 반영)
    if (asset.buy_price && asset.buy_price > 0 && priceSource === 'yahoo') {
      const priceRatio = currentPrice / asset.buy_price;
      currentValue     = (asset.amount ?? 0) * priceRatio;
    } else {
      currentValue = asset.amount ?? 0; // 변동 없이 원금 사용
    }
  }

  // 손익 계산
  let gain = 0;
  if (asset.buy_price && asset.buy_price > 0) {
    if (asset.amount_type === 'quantity') {
      gain = (currentPrice - asset.buy_price) * (asset.amount ?? 0);
    } else {
      gain = currentValue - (asset.amount ?? 0);
    }
  }

  return {
    ...asset,
    current_price: currentPrice,
    current_value: +currentValue.toFixed(0),
    gain:          +gain.toFixed(0),
    price_source:  priceSource,
  };
}

// ── 포트폴리오 비중 계산 ─────────────────────────────────────
function attachWeights(assets) {
  const total = assets.reduce((s, a) => s + (a.current_value ?? 0), 0);
  return assets.map(a => ({
    ...a,
    weight: total > 0 ? +((a.current_value ?? 0) / total).toFixed(6) : 0,
  }));
}

// ── Route Handler ─────────────────────────────────────────────
export async function POST(request) {
  try {
    const body   = await request.json();
    const assets = Array.isArray(body?.assets) ? body.assets : [];

    if (!assets.length) {
      return Response.json({ error: '자산 목록(assets)이 비어 있습니다.' }, { status: 400 });
    }

    // 전체 자산 병렬 가치 평가 (Yahoo Finance rate-limit 고려해 배치 처리)
    const BATCH_SIZE = 5;
    const valuated   = [];

    for (let i = 0; i < assets.length; i += BATCH_SIZE) {
      const batch   = assets.slice(i, i + BATCH_SIZE);
      const results = await Promise.all(batch.map(valuateSingleAsset));
      valuated.push(...results);
    }

    // 비중 부착
    const withWeights = attachWeights(valuated);
    const totalValue  = withWeights.reduce((s, a) => s + (a.current_value ?? 0), 0);

    return Response.json({
      assets:     withWeights,
      totalValue: +totalValue.toFixed(0),
      valuatedAt: new Date().toISOString(),
    });

  } catch (err) {
    console.error('[auto-valuate] 서버 오류:', err);
    return Response.json({ error: err?.message ?? '서버 내부 오류' }, { status: 500 });
  }
}
