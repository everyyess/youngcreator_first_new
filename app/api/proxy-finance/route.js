/**
 * /api/proxy-finance
 * GET: ?assetName=...&productType=... → 동적 금융 인덱싱 파이프라인 → Yahoo Finance 시계열 반환
 *
 * 분기 구조 (정적 하드코딩 완전 제거):
 *   KR (국내주식/국내ETF) : Yahoo v7 Autocomplete (lang=ko, region=KR) → .KS/.KQ 확정 → Yahoo v8 chart
 *   US (해외주식/해외ETF) : Yahoo v1 Search (region=US)                → 심볼 확정    → Yahoo v8 chart
 *   미지정               : Yahoo v1 Search                             → 심볼 확정    → Yahoo v8 chart
 */

export const runtime = 'nodejs';

// ── 포괄적 검색어 차단 사전 (UX 가드 — 티커 매핑 아님) ─────────────────────
const AMBIGUOUS_KEYWORDS = new Map([
  ['삼성',  "'삼성전자', '삼성SDI', '삼성바이오로직스'"],
  ['현대',  "'현대차', '현대모비스', '현대건설'"],
  ['sk',    "'SK하이닉스', 'SK이노베이션', 'SK텔레콤'"],
  ['lg',    "'LG전자', 'LG에너지솔루션', 'LG화학'"],
  ['한화',  "'한화에어로스페이스', '한화솔루션', '한화오션'"],
  ['롯데',  "'롯데쇼핑', '롯데케미칼', '롯데칠성'"],
  ['cj',    "'CJ제일제당', 'CJ CGV', 'CJ ENM'"],
  ['gs',    "'GS리테일', 'GS건설'"],
  ['두산',  "'두산에너빌리티', '두산밥캣', '두산로보틱스'"],
  ['포스코', "'POSCO홀딩스', '포스코퓨처엠', '포스코DX'"],
  ['코오롱', "'코오롱인더', '코오롱글로벌'"],
  ['신한',  "'신한지주', '신한라이프'"],
  ['하나',  "'하나금융지주', '하나은행'"],
  ['kb',    "'KB금융', 'KB증권'"],
]);

// ── 티커 패턴 기반 메타데이터 추론 ────────────────────────────────────────
function inferMetaFromTicker(ticker) {
  if (!ticker) return { assetClass: '해외주식', productType: '주식형', country: '미국' };
  const t = ticker.toUpperCase();
  if (t.endsWith('.KS') || t.endsWith('.KQ'))
    return { assetClass: '국내주식', productType: '주식형', country: '한국' };
  if (t.endsWith('=F'))
    return { assetClass: '금', productType: 'ETF', country: '미국' };
  if (t.endsWith('=X'))
    return { assetClass: '달러', productType: '외화', country: '미국' };
  if (t.includes('-USD') || t.includes('-BTC'))
    return { assetClass: '해외주식', productType: '암호화폐', country: '미국' };
  if (t.startsWith('^'))
    return { assetClass: '해외주식', productType: 'ETF', country: '미국' };
  if (t.endsWith('.T'))
    return { assetClass: '해외주식', productType: '주식형', country: '일본' };
  if (t.endsWith('.HK') || t.endsWith('.SS') || t.endsWith('.SZ'))
    return { assetClass: '해외주식', productType: '주식형', country: '중국' };
  return { assetClass: '해외주식', productType: '주식형', country: '미국' };
}

// ── 공통 브라우저 헤더 ─────────────────────────────────────────────────────
const BROWSER_HEADERS = {
  'User-Agent':      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept':          'application/json, text/plain, */*',
  'Accept-Language': 'en-US,en;q=0.9',
  'Referer':         'https://finance.yahoo.com/',
  'Origin':          'https://finance.yahoo.com',
};

// ── 타임아웃 유틸 ─────────────────────────────────────────────────────────
async function fetchWithTimeout(url, options, timeoutMs = 8_000) {
  const controller = new AbortController();
  const timeoutId  = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    clearTimeout(timeoutId);
    return res;
  } catch (err) {
    clearTimeout(timeoutId);
    if (err.name === 'AbortError') {
      const timeoutErr = new Error('외부 금융 서버 응답이 지연되고 있습니다.');
      timeoutErr.isTimeout = true;
      throw timeoutErr;
    }
    throw err;
  }
}

// ── 안전한 JSON 파싱 유틸 ──────────────────────────────────────────────────
async function safeJson(res) {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

// ── 영문 알파벳 → 한글 발음 변환 맵 (회사명 ASCII 접두사 처리용) ───────────
// 예: "HD현대" → "에이치디현대",  "SK하이닉스" → "에스케이하이닉스"
const ALPHA_SOUND = {
  A:'에이', B:'비',   C:'씨',    D:'디',   E:'이',    F:'에프', G:'지', H:'에이치',
  I:'아이', J:'제이', K:'케이',  L:'엘',   M:'엠',    N:'엔',   O:'오', P:'피',
  Q:'큐',   R:'알',   S:'에스',  T:'티',   U:'유',    V:'브이', W:'더블유',
  X:'엑스', Y:'와이', Z:'지',
};

// 종목명 정규화: (주), 주식회사, 공백 제거 → 소문자 비교
function normKorName(name) {
  return String(name ?? '')
    .replace(/\s*주식회사\s*/g, '')
    .replace(/\(주\)/g, '')
    .replace(/\s+/g, '')
    .toLowerCase();
}

// 검색어 후보 목록 생성
//   순수 한글 → [원본]
//   ASCII+한글 혼합 → [원본, 음가변환형]   예: "HD현대" → ["HD현대","에이치디현대"]
function buildKRQueries(assetName) {
  const queries = [assetName.trim()];
  const m = assetName.trim().match(/^([A-Za-z]+)([가-힯].*)$/);
  if (m) {
    const phonetic = m[1].toUpperCase().split('').map(c => ALPHA_SOUND[c] ?? c).join('');
    const korForm  = phonetic + m[2];
    if (korForm !== queries[0]) queries.push(korForm);
  }
  return queries;
}

// Yahoo v7 autocomplete 거래소 코드 → 티커 접미사
// KSC = Korea Stock Exchange (KOSPI) → .KS  /  KOE = KOSDAQ → .KQ
const KR_EXCH_SUFFIX = { KSC: '.KS', KOE: '.KQ' };

// ── Yahoo Finance v7 Autocomplete — 국내 마켓 동적 티커 조회 ─────────────
// 엔드포인트: https://query1.finance.yahoo.com/v7/finance/autocomplete?query=...&lang=ko&region=KR
// lang=ko&region=KR 파라미터로 한글 종목명 직접 검색 지원
// 응답 예: { ResultSet: { Result: [{ symbol:"005930.KS", name:"삼성전자(주)", exch:"KSC" }] } }
async function fetchTickerFromKRYahoo(assetName) {
  if (!assetName?.trim()) return null;

  const queries = buildKRQueries(assetName);
  let fallbackSymbol = null;

  for (const query of queries) {
    const url =
      `https://query1.finance.yahoo.com/v7/finance/autocomplete` +
      `?query=${encodeURIComponent(query)}&lang=ko&region=KR`;

    let res;
    try {
      res = await fetchWithTimeout(url, { headers: BROWSER_HEADERS }, 8_000);
    } catch (netErr) {
      if (netErr.isTimeout) throw netErr;
      console.warn(`[proxy-finance] KR Yahoo AC 네트워크 오류 (${query}): ${netErr?.message}`);
      continue;
    }

    if (res.status === 429) {
      const err = new Error('요청이 너무 많습니다. 잠시 후 다시 시도해주세요.');
      err.isRateLimit = true;
      throw err;
    }

    if (!res.ok) {
      console.warn(`[proxy-finance] KR Yahoo AC HTTP ${res.status} (${query})`);
      continue;
    }

    const json = await safeJson(res);
    const results = (json?.ResultSet?.Result ?? []).filter(x => KR_EXCH_SUFFIX[x.exch]);
    if (!results.length) continue;

    // ── [1순위] 종목명 정규화 완전 일치 ────────────────────────────────────
    // "(주)", "주식회사" 등 법인 표기를 제거한 순수 명칭으로 비교
    const normQ = normKorName(query);
    const exact = results.find(x => normKorName(x.name) === normQ);
    if (exact) {
      console.log(`[proxy-finance] KR Yahoo 확정 (정확일치): '${assetName}' → '${exact.symbol}'`);
      return exact.symbol;
    }

    // ── [2순위] 첫 번째 KR 거래소 결과를 폴백으로 보관 ─────────────────────
    if (!fallbackSymbol) fallbackSymbol = results[0].symbol;
  }

  if (fallbackSymbol) {
    console.log(`[proxy-finance] KR Yahoo 확정 (폴백): '${assetName}' → '${fallbackSymbol}'`);
  } else {
    console.warn(`[proxy-finance] KR Yahoo 결과 없음: '${assetName}'`);
  }
  return fallbackSymbol ?? null;
}

// ── Yahoo Finance Search API — 해외 마켓 동적 티커 조회 ──────────────────
async function fetchTickerFromYahoo(query) {
  if (!query?.trim()) return null;

  const searchUrl =
    `https://query1.finance.yahoo.com/v1/finance/search` +
    `?q=${encodeURIComponent(query)}&lang=en-US&region=US&quotesCount=6&newsCount=0`;

  let res;
  try {
    res = await fetchWithTimeout(searchUrl, { headers: BROWSER_HEADERS }, 8_000);
  } catch (netErr) {
    if (netErr.isTimeout) throw netErr;
    console.warn(`[proxy-finance] Yahoo Search 네트워크 오류 (${query}): ${netErr?.message}`);
    return null;
  }

  if (res.status === 429) {
    const err = new Error('요청이 너무 많습니다. 잠시 후 다시 시도해주세요.');
    err.isRateLimit = true;
    throw err;
  }

  if (!res.ok) {
    console.warn(`[proxy-finance] Yahoo Search HTTP ${res.status} (${query}) — null 반환`);
    return null;
  }

  const json = await safeJson(res);
  if (!json) {
    console.warn(`[proxy-finance] Yahoo Search JSON 파싱 실패 (${query}) — null 반환`);
    return null;
  }

  const allQuotes = json?.quotes ?? [];
  const VALID_QUOTE_TYPES = new Set([
    'EQUITY', 'ETF', 'INDEX', 'CURRENCY', 'CRYPTOCURRENCY', 'FUTURE', 'MUTUALFUND',
  ]);
  const quotes = allQuotes.filter(q => VALID_QUOTE_TYPES.has(q.quoteType));

  if (quotes.length === 0) {
    console.warn(`[proxy-finance] Yahoo Search 결과 없음: '${query}'`);
    return null;
  }

  const symbol = String(quotes[0].symbol).trim();
  console.log(`[proxy-finance] Yahoo Search 확정: '${query}' → '${symbol}'`);
  return symbol;
}

// ── Route Handler ──────────────────────────────────────────────────────────
export async function GET(request) {
  const { searchParams } = new URL(request.url);

  // ── 역사적 기간 직접 조회 모드 ─────────────────────────────────────────
  const directTicker   = searchParams.get('ticker')?.trim();
  const startDateParam = searchParams.get('startDate')?.trim();
  const endDateParam   = searchParams.get('endDate')?.trim();

  if (directTicker && startDateParam && endDateParam) {
    const period1 = Math.floor(new Date(startDateParam).getTime() / 1000);
    const period2 = Math.floor(new Date(endDateParam).getTime()   / 1000);
    if (!Number.isFinite(period1) || !Number.isFinite(period2) || period2 <= period1) {
      return Response.json({ error: '유효하지 않은 날짜 범위입니다.' }, { status: 400 });
    }
    // 일별 데이터 — MDD 역산 정확도를 위해 1d 간격 사용
    const histUrl =
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(directTicker)}` +
      `?period1=${period1}&period2=${period2}&interval=1d&events=history`;
    let histRes;
    try {
      histRes = await fetchWithTimeout(histUrl, { headers: BROWSER_HEADERS }, 10_000);
    } catch (err) {
      console.warn(`[proxy-finance] 역사적 조회 네트워크 실패 (${directTicker}): ${err?.message}`);
      return Response.json({ ticker: directTicker, closes: [], chart: { result: [] } }, { status: 200 });
    }
    if (histRes.status === 429)
      return Response.json({ error: '요청이 너무 많습니다. 잠시 후 다시 시도해주세요.', ticker: directTicker }, { status: 429 });
    if (!histRes.ok) {
      console.warn(`[proxy-finance] 역사적 조회 HTTP ${histRes.status} (${directTicker}) — 빈 데이터 반환`);
      return Response.json({ ticker: directTicker, closes: [], chart: { result: [] } }, { status: 200 });
    }
    const histJson = await safeJson(histRes);
    if (!histJson) {
      console.warn(`[proxy-finance] 역사적 조회 JSON 파싱 실패 (${directTicker}) — 빈 데이터 반환`);
      return Response.json({ ticker: directTicker, closes: [], chart: { result: [] } }, { status: 200 });
    }
    const histCloses = histJson?.chart?.result?.[0]?.indicators?.quote?.[0]?.close ?? [];
    if (histCloses.filter(Boolean).length < 2) {
      console.warn(`[proxy-finance] 역사적 조회 데이터 없음 (${directTicker}) — 빈 데이터 반환`);
      return Response.json({ ticker: directTicker, closes: [], chart: { result: [] } }, { status: 200 });
    }
    return Response.json({ ticker: directTicker, ...histJson });
  }

  // ── 자산명 + 상품유형 파싱 ─────────────────────────────────────────────
  const assetName       = searchParams.get('assetName')?.trim();
  const userProductType = searchParams.get('productType')?.trim() || null;

  if (!assetName || assetName.trim() === '') {
    return Response.json({ error: '검색할 자산명을 입력해주세요.' }, { status: 400 });
  }

  // ── 마켓 분기 결정 (productType 0순위 고정) ────────────────────────────
  // KR → Naver Finance AC 동적 조회 (Yahoo 오토컴플릿 완전 우회)
  // US → Yahoo Autocomplete 직행
  // null → Yahoo Autocomplete 폴백
  const KR_TYPES = new Set(['국내주식', '국내ETF']);
  const US_TYPES = new Set(['해외주식', '해외ETF']);
  const forcedMarket = KR_TYPES.has(userProductType) ? 'KR'
    : US_TYPES.has(userProductType) ? 'US'
    : null;

  // 정규화: 소문자 + 공백 제거 (UX 가드 조회 전용)
  const normalizedInput = assetName.toLowerCase().replace(/\s+/g, '');

  // ── 포괄적 검색어 조기 차단 ────────────────────────────────────────────
  const ambiguousExamples = AMBIGUOUS_KEYWORDS.get(normalizedInput);
  if (ambiguousExamples) {
    return Response.json(
      { error: `입력하신 '${assetName}'은(는) 여러 계열사가 존재합니다. ${ambiguousExamples}처럼 정확한 종목명을 입력해주세요.`, assetName },
      { status: 400 }
    );
  }

  // ── [KR 경로] Yahoo v7 Autocomplete (lang=ko) → 6자리코드.KS/.KQ 확정 ──
  // 국내주식/국내ETF: Yahoo KR 자동완성 검색 → US Autocomplete 완전 우회
  let ticker = null;

  if (forcedMarket === 'KR') {
    try {
      ticker = await fetchTickerFromKRYahoo(assetName);
    } catch (naverErr) {
      if (naverErr.isTimeout)
        return Response.json({ error: naverErr.message, assetName }, { status: 504 });
      if (naverErr.isRateLimit)
        return Response.json({ error: naverErr.message, assetName }, { status: 429 });
      console.error('[proxy-finance] KR Yahoo AC 예외:', naverErr?.message);
      return Response.json({ error: '국내 종목 검색 중 오류가 발생했습니다.', assetName }, { status: 500 });
    }

    if (!ticker) {
      return Response.json(
        { error: `'${assetName}'의 국내 티커(KOSPI/KOSDAQ)를 찾을 수 없습니다. 정확한 종목명을 입력해주세요.`, assetName },
        { status: 404 }
      );
    }
  }

  // ── [US·미지정 경로] Yahoo Finance Search API ──────────────────────────
  // 해외주식/해외ETF 또는 상품유형 미선택: Yahoo 오토컴플릿으로 나스닥/NYSE 심볼 탐색
  if (!ticker) {
    try {
      ticker = await fetchTickerFromYahoo(assetName);
    } catch (searchErr) {
      if (searchErr.isTimeout)
        return Response.json({ error: searchErr.message, assetName }, { status: 504 });
      if (searchErr.isRateLimit)
        return Response.json({ error: searchErr.message, assetName }, { status: 429 });
      console.warn('[proxy-finance] Yahoo Search 예외:', searchErr?.message);
      return Response.json({ error: '티커 검색 중 오류가 발생했습니다.', assetName }, { status: 500 });
    }

    if (!ticker) {
      return Response.json(
        { error: `'${assetName}'에 해당하는 티커를 찾을 수 없습니다.`, assetName },
        { status: 404 }
      );
    }
  }

  // ── 티커 기반 메타데이터 추론 ──────────────────────────────────────────
  let assetMeta = inferMetaFromTicker(ticker);

  // userProductType 0순위 고정 — 추론 결과가 덮을 수 없음
  if (userProductType) {
    assetMeta = { ...assetMeta, productType: userProductType };
  }

  // ── KR 최종 유효성 검증 ────────────────────────────────────────────────
  // KR 카테고리임에도 비KR 심볼이 남아 있으면 강제 차단 (안전망)
  if (forcedMarket === 'KR') {
    const KR_FINAL_RE = /^\d{6}\.(KS|KQ)$/;
    if (!KR_FINAL_RE.test(ticker)) {
      console.error(`[proxy-finance] KR 최종 유효성 실패: '${ticker}'`);
      return Response.json(
        { error: `국내 자산 검색에서 유효하지 않은 티커가 도출됐습니다('${ticker}'). 종목명을 확인해주세요.`, assetName },
        { status: 400 }
      );
    }
  }

  // ── Yahoo Finance v8 차트 API (CORS 우회) ─────────────────────────────
  const endTs   = Math.floor(Date.now() / 1000);
  const startTs = endTs - 3 * 365 * 24 * 3600;
  const yahooUrl =
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}` +
    `?period1=${startTs}&period2=${endTs}&interval=1mo&events=dividends%7Chistory`;

  let chartRes;
  try {
    chartRes = await fetchWithTimeout(yahooUrl, { headers: BROWSER_HEADERS }, 8_000);
  } catch (fetchErr) {
    if (fetchErr.isTimeout)
      return Response.json({ error: fetchErr.message, ticker }, { status: 504 });
    console.error(`[proxy-finance] Yahoo Finance fetch 실패 (${ticker}):`, fetchErr?.message);
    return Response.json({ error: fetchErr.message, ticker }, { status: 502 });
  }

  if (chartRes.status === 429) {
    console.warn(`[proxy-finance] Yahoo Chart 429 Rate Limit (${ticker})`);
    return Response.json({ error: '요청이 너무 많습니다. 잠시 후 다시 시도해주세요.', ticker }, { status: 429 });
  }

  if (!chartRes.ok) {
    console.error(`[proxy-finance] Yahoo Finance HTTP ${chartRes.status} (${ticker})`);
    return Response.json({ error: `Yahoo Finance HTTP ${chartRes.status}`, ticker }, { status: 502 });
  }

  const yahooJson = await safeJson(chartRes);
  if (!yahooJson) {
    console.error(`[proxy-finance] Chart JSON 파싱 실패 (${ticker}): HTML 응답 추정`);
    return Response.json({ error: '금융 데이터 파싱 중 오류가 발생했습니다.', ticker }, { status: 502 });
  }

  if (yahooJson.chart?.error) {
    const msg = yahooJson.chart.error.description ?? '야후 파이낸스 오류';
    console.error(`[proxy-finance] Chart API 오류 (${ticker}):`, msg);
    return Response.json({ error: msg, ticker }, { status: 404 });
  }

  const closes = yahooJson.chart?.result?.[0]?.indicators?.quote?.[0]?.close ?? [];
  if (closes.length === 0) {
    console.error(`[proxy-finance] 빈 데이터 (${ticker}): 상장폐지 또는 거래정지 종목으로 추정`);
    return Response.json({ error: '거래가 정지되거나 상장 폐지된 종목입니다.', ticker }, { status: 404 });
  }

  // ── 배당수익률 계산 (events.dividends) ────────────────────────────────
  const meta = yahooJson.chart?.result?.[0]?.meta ?? {};
  const regularMarketPrice = typeof meta.regularMarketPrice === 'number' ? meta.regularMarketPrice : 0;

  const rawDividends = yahooJson.chart?.result?.[0]?.events?.dividends ?? {};
  const oneYearAgo   = Math.floor(Date.now() / 1000) - 365 * 24 * 3600;

  const eventsTrailingRate = Object.values(rawDividends).reduce((sum, entry) => {
    const ts  = typeof entry.date   === 'number' ? entry.date   : 0;
    const amt = typeof entry.amount === 'number' ? entry.amount : 0;
    return ts >= oneYearAgo ? sum + amt : sum;
  }, 0);

  const eventsDividendYield =
    eventsTrailingRate > 0 && regularMarketPrice > 0
      ? eventsTrailingRate / regularMarketPrice
      : 0;

  // ── quoteSummary API로 더 정확한 배당 데이터 조회 ─────────────────────
  const quoteSummaryUrls = [
    `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(ticker)}?modules=summaryDetail`,
    `https://query1.finance.yahoo.com/v11/finance/quoteSummary/${encodeURIComponent(ticker)}?modules=summaryDetail`,
    `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?modules=summaryDetail`,
  ];

  let summaryDividendYield = 0;
  let summaryTrailingRate  = 0;

  for (const url of quoteSummaryUrls) {
    try {
      const summaryRes = await fetchWithTimeout(url, { headers: BROWSER_HEADERS }, 5_000);
      if (!summaryRes.ok) continue;
      const summaryJson = await summaryRes.json();
      const detail = summaryJson?.quoteSummary?.result?.[0]?.summaryDetail;
      if (!detail) continue;
      const dy   = detail.dividendYield?.raw;
      const tadr = detail.trailingAnnualDividendRate?.raw;
      if (typeof dy   === 'number') summaryDividendYield = dy;
      if (typeof tadr === 'number') summaryTrailingRate  = tadr;
      break;
    } catch {
      // 다음 URL 시도
    }
  }

  const dividendYield              = summaryDividendYield > 0 ? summaryDividendYield : eventsDividendYield;
  const trailingAnnualDividendRate = summaryTrailingRate  > 0 ? summaryTrailingRate  : eventsTrailingRate;

  // officialName: Yahoo meta.shortName → longName 순 폴백
  const officialName =
    (typeof meta.shortName === 'string' && meta.shortName.trim()) ? meta.shortName.trim()
    : (typeof meta.longName  === 'string' && meta.longName.trim())  ? meta.longName.trim()
    : null;

  // userProductType 0순위 최후 보루
  const finalMeta = userProductType
    ? { ...assetMeta, productType: userProductType }
    : assetMeta;

  return Response.json({ ticker, officialName, ...finalMeta, dividendYield, trailingAnnualDividendRate, ...yahooJson });
}
