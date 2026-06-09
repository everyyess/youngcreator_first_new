/**
 * /api/proxy-finance
 * GET: ?assetName=... → 정적 딕셔너리 → Gemini AI → Yahoo Search API → Yahoo Finance 시계열 반환
 *
 * 브라우저의 CORS 제약을 우회하는 Next.js App Router 서버 프록시.
 * 1단계: 정적 티커 딕셔너리 (즉시 반환)
 * 2단계: Gemini AI 티커 변환 (한글·약어 입력 시 자동 활성화)
 * 3단계: Yahoo Finance Autocomplete Search API 로 티커 자동 완성
 * 4단계: Yahoo Finance v8 차트 API 로 월봉 시계열 반환
 */

export const runtime = 'nodejs';

import { resolveTickerWithGemini } from '../../../utils/geminiTicker.js';

// ── 1단계: 정적 Fallback 딕셔너리 ─────────────────────────────
// Yahoo Search API 가 한글로 매칭하기 어려운 원자재·지수·암호화폐를 하드코딩
// 키는 모두 소문자 + 공백 제거 형태로 정규화 (normalizedInput 조회와 1:1 매칭)
const FALLBACK_TICKER_MAP = {
  // 국내 주식 / ETF
  '삼성전자':           '005930.KS',
  '카카오':             '035720.KS',
  '카카오코프':         '035720.KS',
  '맥쿼리인프라':       '088980.KS',
  'tiger미국나스닥100': '133690.KS',
  // 미국 주식
  'nvda':               'NVDA',
  'nvidia':             'NVDA',
  'nvdia':              'NVDA',    // 오타 방어
  // 원자재 선물 – 한글 검색 시 Yahoo Search 매칭 불안정
  '국제금':             'GC=F',
  '금':                 'GC=F',
  '국제원유':           'CL=F',
  '원유':               'CL=F',
  '천연가스':           'NG=F',
  // 암호화폐
  '비트코인':           'BTC-USD',
  '이더리움':           'ETH-USD',
  // 지수 – 'S&P500' / 'S&P 500' 정규화 시 동일 키이므로 하나로 통합
  's&p500':             '^GSPC',
  '나스닥':             '^IXIC',
  // 환율 – 원/달러 실시간 조회
  'krw=x':              'KRW=X',
  'usdkrw':             'KRW=X',
  '달러환율':           'KRW=X',
};

// ── 포괄적 검색어 차단 사전 ──────────────────────────────────
// 계열사가 많은 그룹사 명칭 입력 시 단일 종목으로 강제 매칭되는 오류를 방지합니다.
// 키: 정규화 입력값(소문자 + 공백 제거), 값: 사용자에게 안내할 구체적 종목명 예시
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

// ── 한글 포함 여부 판별 — Gemini 호출 게이트 ─────────────────
// Hangul 음절(AC00-D7AF) + 자모(1100-11FF, 3130-318F) 범위
function hasKorean(str) {
  return /[가-힯ᄀ-ᇿ㄰-㆏]/.test(str);
}

// ── 공통 브라우저 헤더 – 봇 차단(403) 우회 ───────────────────
const BROWSER_HEADERS = {
  'User-Agent':      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
  'Accept':          'application/json, text/plain, */*',
  'Accept-Language': 'en-US,en;q=0.9',
};

// ── 타임아웃 유틸: AbortController 기반 ──────────────────────
/**
 * 지정된 시간 안에 응답이 없으면 요청을 중단(abort)하고
 * isTimeout=true 플래그가 달린 Error 를 throw 합니다.
 *
 * @param {string}      url
 * @param {RequestInit} options
 * @param {number}      timeoutMs  (기본 8000ms)
 * @returns {Promise<Response>}
 * @throws {Error} isTimeout=true
 */
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

// ── 안전한 JSON 파싱 유틸 ─────────────────────────────────────
/**
 * 야후 서버가 HTML(점검·차단 페이지)을 반환할 때 res.json() 이 터지는 것을 방지.
 * 파싱 실패 시 null 을 반환합니다.
 *
 * @param {Response} res
 * @returns {Promise<object|null>}
 */
async function safeJson(res) {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

// ── 2단계: Yahoo Finance Search API 티커 자동 완성 ─────────────
/**
 * 자산명(한글/영문 무관)을 Yahoo Finance Search API 로 조회하여
 * 유효한 quoteType 중 최상단 결과의 symbol 을 반환합니다.
 *
 * @param {string} query  원본 사용자 입력값 (검색 정확도를 위해 정규화 전 값 사용)
 * @returns {Promise<string>} Yahoo Finance ticker symbol
 * @throws {Error} isTimeout / isRateLimit / isParseError / notFound
 *
 * 검증 예시:
 *   fetchTickerFromYahoo('카카오')  → '035720.KS'
 *   fetchTickerFromYahoo('테슬라')  → 'TSLA'
 */
async function fetchTickerFromYahoo(query) {
  const searchUrl = `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(query)}`;

  // ① 타임아웃 fetch
  let res;
  try {
    res = await fetchWithTimeout(searchUrl, { headers: BROWSER_HEADERS }, 8_000);
  } catch (netErr) {
    if (netErr.isTimeout) throw netErr;   // 504 로 상위 핸들러에 전파
    console.error(`[proxy-finance] Yahoo Search 네트워크 오류 (${query}):`, netErr?.message);
    const err = new Error(`Yahoo Search 요청 실패: ${netErr?.message}`);
    err.notFound = true;
    throw err;
  }

  // ② 429 Rate Limit 명시 처리
  if (res.status === 429) {
    console.warn(`[proxy-finance] Yahoo Search 429 Rate Limit (${query})`);
    const err = new Error('요청이 너무 많습니다. 잠시 후 다시 시도해주세요.');
    err.isRateLimit = true;
    throw err;
  }

  if (!res.ok) {
    console.error(`[proxy-finance] Yahoo Search HTTP ${res.status} (${query})`);
    const err = new Error(`Yahoo Search HTTP ${res.status}`);
    err.notFound = true;
    throw err;
  }

  // ③ 안전한 JSON 파싱
  const json = await safeJson(res);
  if (!json) {
    console.error(`[proxy-finance] Yahoo Search JSON 파싱 실패 (${query}): HTML 응답 추정`);
    const err = new Error('금융 데이터 파싱 중 오류가 발생했습니다.');
    err.isParseError = true;
    throw err;
  }

  const allQuotes = json?.quotes ?? [];

  // 유효한 자산 유형만 필터링 – 뉴스·관련 없는 항목 제외
  const VALID_QUOTE_TYPES = new Set([
    'EQUITY', 'ETF', 'INDEX', 'CURRENCY', 'CRYPTOCURRENCY', 'FUTURE', 'MUTUALFUND',
  ]);
  const quotes = allQuotes.filter(q => VALID_QUOTE_TYPES.has(q.quoteType));

  if (quotes.length === 0) {
    console.error(`[proxy-finance] 티커 미발견: '${query}' 유효 자산 없음 (전체 ${allQuotes.length}건)`);
    const err = new Error(`'${query}'에 해당하는 티커를 찾을 수 없습니다.`);
    err.notFound = true;
    throw err;
  }

  return String(quotes[0].symbol).trim();
}

// ── Route Handler ─────────────────────────────────────────────
export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const assetName = searchParams.get('assetName')?.trim();

  if (!assetName || assetName.trim() === '') {
    return Response.json(
      { error: '검색할 자산명을 입력해주세요.' },
      { status: 400 }
    );
  }

  // 정규화: 소문자 + 공백 제거 → 딕셔너리 조회 전용
  // (Yahoo Search 호출엔 원본 assetName 전달 – 검색 정확도 유지)
  const normalizedInput = assetName.toLowerCase().replace(/\s+/g, '');

  // ── 포괄적 검색어 Early Return ────────────────────────────────
  // 그룹사 대표 명칭이 입력되면 하위 로직 실행 전에 즉시 차단합니다.
  const ambiguousExamples = AMBIGUOUS_KEYWORDS.get(normalizedInput);
  if (ambiguousExamples) {
    return Response.json(
      {
        error: `입력하신 '${assetName}'은(는) 여러 계열사가 존재합니다. ${ambiguousExamples}처럼 정확한 종목명을 입력해주세요.`,
        assetName,
      },
      { status: 400 }
    );
  }

  // 1순위: 정적 딕셔너리 (정규화 키로 조회)
  let ticker = FALLBACK_TICKER_MAP[normalizedInput] ?? null;

  // 2순위: Gemini AI 티커 변환 (한글/약어 입력이고 정적 딕셔너리 미매칭 시)
  if (!ticker && hasKorean(assetName)) {
    const geminiTicker = await resolveTickerWithGemini(assetName);
    if (geminiTicker) ticker = geminiTicker;
  }

  // 3순위: Yahoo Finance Search API
  if (!ticker) {
    try {
      ticker = await fetchTickerFromYahoo(assetName);
    } catch (searchErr) {
      if (searchErr.isTimeout)
        return Response.json({ error: searchErr.message, assetName }, { status: 504 });
      if (searchErr.isRateLimit)
        return Response.json({ error: searchErr.message, assetName }, { status: 429 });
      if (searchErr.isParseError)
        return Response.json({ error: searchErr.message, assetName }, { status: 502 });
      if (searchErr.notFound)
        return Response.json({ error: searchErr.message, assetName }, { status: 404 });
      // 예상치 못한 오류 – 원본 문자열로 마지막 fallback
      console.warn('[proxy-finance] Yahoo Search 예외, 원본 사용:', searchErr?.message);
      ticker = assetName.toUpperCase().replace(/\s+/g, '');
    }
  }

  // 3단계: Yahoo Finance v8 시계열 fetch (CORS 우회)
  const endTs   = Math.floor(Date.now() / 1000);
  const startTs = endTs - 3 * 365 * 24 * 3600;
  const yahooUrl =
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}` +
    `?period1=${startTs}&period2=${endTs}&interval=1mo&events=history`;

  // ① 타임아웃 fetch
  let chartRes;
  try {
    chartRes = await fetchWithTimeout(yahooUrl, { headers: BROWSER_HEADERS }, 8_000);
  } catch (fetchErr) {
    if (fetchErr.isTimeout)
      return Response.json({ error: fetchErr.message, ticker }, { status: 504 });
    console.error(`[proxy-finance] Yahoo Finance fetch 실패 (${ticker}):`, fetchErr?.message);
    return Response.json({ error: fetchErr.message, ticker }, { status: 502 });
  }

  // ② 429 Rate Limit 명시 처리
  if (chartRes.status === 429) {
    console.warn(`[proxy-finance] Yahoo Chart 429 Rate Limit (${ticker})`);
    return Response.json(
      { error: '요청이 너무 많습니다. 잠시 후 다시 시도해주세요.', ticker },
      { status: 429 }
    );
  }

  if (!chartRes.ok) {
    console.error(`[proxy-finance] Yahoo Finance HTTP ${chartRes.status} (${ticker})`);
    return Response.json(
      { error: `Yahoo Finance HTTP ${chartRes.status}`, ticker },
      { status: 502 }
    );
  }

  // ③ 안전한 JSON 파싱
  const yahooJson = await safeJson(chartRes);
  if (!yahooJson) {
    console.error(`[proxy-finance] Chart JSON 파싱 실패 (${ticker}): HTML 응답 추정`);
    return Response.json(
      { error: '금융 데이터 파싱 중 오류가 발생했습니다.', ticker },
      { status: 502 }
    );
  }

  // 데이터 무결성 검증 – 상장폐지/거래정지 종목 크래시 방지
  if (yahooJson.chart?.error) {
    const msg = yahooJson.chart.error.description ?? '야후 파이낸스 오류';
    console.error(`[proxy-finance] Chart API 오류 (${ticker}):`, msg);
    return Response.json({ error: msg, ticker }, { status: 404 });
  }

  const closes = yahooJson.chart?.result?.[0]?.indicators?.quote?.[0]?.close ?? [];
  if (closes.length === 0) {
    console.error(`[proxy-finance] 빈 데이터 (${ticker}): 상장폐지 또는 거래정지 종목으로 추정`);
    return Response.json(
      { error: '거래가 정지되거나 상장 폐지된 종목입니다.', ticker },
      { status: 404 }
    );
  }

  return Response.json({ ticker, ...yahooJson });
}
