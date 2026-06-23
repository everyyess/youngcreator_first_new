/**
 * /api/proxy-finance
 * GET: ?assetName=...&productType=... → 동적 금융 인덱싱 파이프라인 → Yahoo Finance 시계열 반환
 *
 * 분기 구조:
 *   KR (국내주식/국내ETF) : Gemini → krCode+market → 직접 조립 (.KS/.KQ) → Yahoo v8 chart
 *                          Gemini 실패 시 Yahoo v7 Autocomplete (lang=ko) 폴백
 *   US (해외주식/해외ETF) : Gemini → isListed 검사 → false면 404 차단
 *                          true면 englishName으로 Yahoo v1 Search → Yahoo v8 chart
 *   미지정               : Yahoo v1 Search 직행 → Yahoo v8 chart
 */

import { resolveTickerWithGemini } from '@/utils/geminiTicker';
import krAssetMaster from './kr-asset-master.json';

export const runtime = 'nodejs';


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

// ── officialName 결정 — 마스터 데이터셋(Single Source of Truth) 우선 참조 ─────
// 1순위: kr-asset-master.json에 티커가 존재하면 외부 API 응답값을 무시하고 공식 명칭 반환
// 2순위: 미등재 티커(해외 자산 등)는 Yahoo chartMeta.shortName → longName 순 폴백
function resolveOfficialName(ticker, chartMeta) {
  const masterName = (krAssetMaster)[ticker];
  if (masterName) return masterName;
  if (typeof chartMeta?.shortName === 'string' && chartMeta.shortName.trim())
    return chartMeta.shortName.trim();
  if (typeof chartMeta?.longName === 'string' && chartMeta.longName.trim())
    return chartMeta.longName.trim();
  return null;
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
// Yahoo v7 AC type 코드 매핑: 'S'=주식(EQUITY), 'E'=ETF
// productType 지정 시 해당 type 외 결과는 교차 오염 방지를 위해 제외한다.
const KR_AC_TYPE_MAP = new Map([['국내주식', 'S'], ['국내ETF', 'E']]);

async function fetchTickerFromKRYahoo(assetName, productType = null) {
  if (!assetName?.trim()) return null;

  const requiredAcType = productType ? (KR_AC_TYPE_MAP.get(productType) ?? null) : null;
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
    // KRX 거래소 필터 후 productType 기반 type 필터 적용 (교차 오염 방지)
    const allKR   = (json?.ResultSet?.Result ?? []).filter(x => KR_EXCH_SUFFIX[x.exch]);
    const results = requiredAcType ? allKR.filter(x => x.type === requiredAcType) : allKR;
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
// productType → Yahoo quoteType 필터 매핑
// 주식 경로에서 ETF가 오염되지 않도록, productType 지정 시 엄격한 단일 quoteType만 채택한다.
const YAHOO_STOCK_TYPES = new Set(['국내주식', '해외주식']);
const YAHOO_ETF_TYPES   = new Set(['국내ETF',  '해외ETF']);

async function fetchTickerFromYahoo(query, productType = null) {
  if (!query?.trim()) return null;

  // 공백 제거 정규화를 제거 — "Meta Platforms"→"MetaPlatforms", "JPMorgan Chase"→"JPMorganChase" 처럼
  // 다중 단어 회사명이 깨지는 문제를 방지. Yahoo Finance는 공백 포함 쿼리를 잘 처리함.
  const normalizedQuery = query.trim();

  const searchUrl =
    `https://query1.finance.yahoo.com/v1/finance/search` +
    `?q=${encodeURIComponent(normalizedQuery)}&lang=en-US&region=US&quotesCount=6&newsCount=0`;

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

  // ── 2중 시맨틱 가드라인 (quoteType + 이름 텍스트 교차검증) ─────────────────
  // Layer 1: Yahoo quoteType 메타데이터 필터
  // Layer 2: shortname/longname에서 \bETF\b 단어 단독 출현 감지
  //   주식 경로 — quoteType=EQUITY 이면서 이름에 ETF 없는 항목만 채택
  //               (Yahoo 오분류: quoteType=EQUITY 이지만 실제 ETF인 케이스 차단)
  //   ETF 경로  — quoteType=ETF 이거나 이름에 ETF 포함된 항목 우선 채택
  //   미지정    — 기존 VALID_QUOTE_TYPES 범위 유지 (KRW=X 등 통화·지수 포함)
  const ETF_NAME_RE = /\bETF\b/i;
  const quoteName = (q) => String(q.shortname ?? q.longname ?? '');

  let quotes;
  if (productType && YAHOO_STOCK_TYPES.has(productType)) {
    // [Layer 1] quoteType === 'EQUITY'  [Layer 2] 이름에 ETF 미포함
    quotes = allQuotes.filter(q =>
      q.quoteType === 'EQUITY' && !ETF_NAME_RE.test(quoteName(q))
    );
    if (quotes.length === 0) {
      console.warn(`[proxy-finance] Yahoo Search 유효 EQUITY 없음 (${productType}): '${query}'`);
      return null;
    }
  } else if (productType && YAHOO_ETF_TYPES.has(productType)) {
    // [Layer 1] quoteType === 'ETF'  [Layer 2] 이름에 ETF 포함 항목도 포함
    quotes = allQuotes.filter(q =>
      q.quoteType === 'ETF' || ETF_NAME_RE.test(quoteName(q))
    );
    if (quotes.length === 0) {
      console.warn(`[proxy-finance] Yahoo Search 유효 ETF 없음 (${productType}): '${query}'`);
      return null;
    }
  } else {
    const VALID_QUOTE_TYPES = new Set([
      'EQUITY', 'ETF', 'INDEX', 'CURRENCY', 'CRYPTOCURRENCY', 'FUTURE', 'MUTUALFUND',
    ]);
    quotes = allQuotes.filter(q => VALID_QUOTE_TYPES.has(q.quoteType));
    if (quotes.length === 0) {
      console.warn(`[proxy-finance] Yahoo Search 결과 없음: '${query}'`);
      return null;
    }

    // productType 미지정 시 미국 거래소(순수 티커, 도트 없음) 우선 선택
    // 예: 'LILY.WA'(바르샤바) 대신 'LLY'(NYSE) 반환
    const usPrimary = quotes.find(q =>
      (q.quoteType === 'EQUITY' || q.quoteType === 'ETF') && !String(q.symbol).includes('.')
    );
    if (usPrimary) {
      console.log(`[proxy-finance] Yahoo Search 미국 거래소 우선 선택: '${query}' → '${usPrimary.symbol}'`);
      return String(usPrimary.symbol).trim();
    }
  }

  const symbol = String(quotes[0].symbol).trim();
  console.log(`[proxy-finance] Yahoo Search 확정 (${productType ?? '미지정'}): '${query}' → '${symbol}'`);
  return symbol;
}

// ── Naver 통합검색 웹 크롤링 — Gemini·Yahoo AC 모두 실패 시 최후 폴백 ────────
// 엔드포인트: search.naver.com 통합검색 ('{종목명} 주가' 쿼리)
// 증권 위젯 HTML에서 finance.naver.com/item/main.naver?code=XXXXXX 패턴을 추출하고,
// 코드 주변 ±1500자 컨텍스트의 "KOSDAQ" 문자열로 시장 접미사(.KQ/.KS)를 결정한다.
// ※ finance.naver.com/search/searchList.naver 는 폐기됨(404) — 사용 불가.
async function fetchTickerByWebScraping(assetName) {
  if (!assetName?.trim()) return null;

  const searchUrl =
    `https://search.naver.com/search.naver` +
    `?where=nexearch&query=${encodeURIComponent(assetName.trim() + ' 주가')}&sm=top_hty&fbm=0`;

  let res;
  try {
    res = await fetchWithTimeout(searchUrl, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
          '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept':          'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7',
        'Referer':         'https://finance.naver.com/',
      },
    }, 10_000);
  } catch (err) {
    if (err?.isTimeout) throw err;
    console.warn(`[proxy-finance] Naver 크롤링 네트워크 오류 (${assetName}): ${err?.message}`);
    return null;
  }

  if (!res.ok) {
    console.warn(`[proxy-finance] Naver 크롤링 HTTP ${res.status} (${assetName})`);
    return null;
  }

  let html;
  try {
    html = await res.text();
  } catch (err) {
    console.warn(`[proxy-finance] Naver 크롤링 HTML 읽기 실패 (${assetName}): ${err?.message}`);
    return null;
  }

  // Naver 증권 위젯: <a href="https://finance.naver.com/item/main.naver?code=XXXXXX">
  const ITEM_RE   = /\/item\/main\.naver\?code=(\d{6})/;
  const itemMatch = ITEM_RE.exec(html);
  if (!itemMatch) {
    console.warn(`[proxy-finance] Naver 크롤링 종목코드 없음: '${assetName}'`);
    return null;
  }

  const code = itemMatch[1];
  // 코드 주변 ±1500자: <em class="t_nm">XXXXXX...(KOSDAQ|KOSPI)</em> 포함
  const idx    = html.indexOf(itemMatch[0]);
  const ctx    = html.slice(Math.max(0, idx - 1500), idx + 1500);
  const suffix = /코스닥|KOSDAQ/i.test(ctx) ? '.KQ' : '.KS';
  const ticker = `${code}${suffix}`;
  console.log(`[proxy-finance] Naver 크롤링 성공: '${assetName}' → '${ticker}'`);
  return ticker;
}

// ── Naver Finance 배당수익률 조회 (국내 종목 전용) ───────────────────────────
// 1차: api.finance.naver.com JSON API (가장 빠름)
// 2차: finance.naver.com/item/main.naver HTML 스크래핑 (폴백)
// 반환: 연간 배당수익률 소수 (예: 0.025 = 2.5%), 실패 시 0
async function fetchNaverDividend(krCode) {
  if (!krCode || !/^\d{6}$/.test(krCode)) return 0;

  const NAVER_HEADERS = {
    'User-Agent':      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Accept':          'text/html,application/xhtml+xml,application/json,*/*;q=0.8',
    'Accept-Language': 'ko-KR,ko;q=0.9',
    'Referer':         'https://finance.naver.com/',
  };

  // 1차: Naver Finance JSON API
  try {
    const apiUrl = `https://api.finance.naver.com/service/itemSummary.nhn?itemcode=${krCode}`;
    const res = await fetchWithTimeout(apiUrl, { headers: NAVER_HEADERS }, 5_000);
    if (res.ok) {
      const data = await safeJson(res);
      const pct = parseFloat(data?.dividend ?? 0);
      if (pct > 0 && pct < 50) {
        console.log(`[proxy-finance] Naver JSON 배당수익률 (${krCode}): ${pct}%`);
        return pct / 100;
      }
    }
  } catch { /* 2차로 폴백 */ }

  // 2차: Naver Finance HTML 스크래핑
  try {
    const htmlUrl = `https://finance.naver.com/item/main.naver?code=${krCode}`;
    const res = await fetchWithTimeout(htmlUrl, { headers: NAVER_HEADERS }, 8_000);
    if (!res.ok) return 0;
    const html = await res.text();

    // 패턴 A: <th scope="row">배당수익률</th><td ...>2.58</td>
    const matchA = /배당수익률[^<]*<\/[^>]+>\s*<td[^>]*>\s*([0-9]+\.?[0-9]*)\s*<\/td>/i.exec(html);
    // 패턴 B: 배당수익률 뒤 숫자+% 형식 (어떤 태그든)
    const matchB = /배당수익률[^0-9]*([0-9]+\.?[0-9]*)\s*%/i.exec(html);
    const raw = matchA ?? matchB;
    if (raw) {
      const pct = parseFloat(raw[1]);
      if (pct > 0 && pct < 50) {
        console.log(`[proxy-finance] Naver HTML 배당수익률 (${krCode}): ${pct}%`);
        return pct / 100;
      }
    }
  } catch { /* 실패 무시 */ }

  return 0;
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

  // ── [KR 경로] Gemini → krCode 직접 조립 → Yahoo v7 AC 폴백 ──────────────
  let ticker = null;
  let resolvedKoreanName = null; // Gemini에서 얻은 한국어 종목명

  if (forcedMarket === 'KR') {
    // [0순위] assetName이 이미 유효한 KRX 티커 형식이면 해석 체인 전체 생략
    // 예: "143460.KS" → Gemini·Yahoo AC 실패 위험 없이 즉시 사용
    const KR_TICKER_DIRECT_RE = /^\d{6}\.(KS|KQ)$/;
    if (KR_TICKER_DIRECT_RE.test(assetName)) {
      ticker = assetName;
      console.log(`[proxy-finance] KR 직접 티커 확정: '${assetName}'`);
    }

    // [1순위] Gemini: 6자리 krCode + market → 티커 직접 조립 (Yahoo AC 완전 우회)
    let geminiMetaKR = null;
    if (!ticker) try {
      geminiMetaKR = await resolveTickerWithGemini(assetName, userProductType);
    } catch (geminiErr) {
      console.warn('[proxy-finance] Gemini 예외 (KR), Yahoo AC 폴백:', geminiErr?.message);
    }

    if (!ticker && geminiMetaKR?.krCode && (geminiMetaKR.market === 'KOSPI' || geminiMetaKR.market === 'KOSDAQ')) {
      const paddedCode = String(geminiMetaKR.krCode).padStart(6, '0');
      const suffix = geminiMetaKR.market === 'KOSDAQ' ? '.KQ' : '.KS';
      ticker = `${paddedCode}${suffix}`;
      console.log(`[proxy-finance] Gemini KR 직접 조립: '${assetName}' → '${ticker}'`);
    }
    if (geminiMetaKR?.koreanName) resolvedKoreanName = geminiMetaKR.koreanName;

    // [2순위] Gemini 실패/불명 → Yahoo v7 Autocomplete 폴백
    if (!ticker) {
      try {
        ticker = await fetchTickerFromKRYahoo(assetName, userProductType);
      } catch (krErr) {
        if (krErr.isTimeout)
          return Response.json({ error: krErr.message, assetName }, { status: 504 });
        if (krErr.isRateLimit)
          return Response.json({ error: krErr.message, assetName }, { status: 429 });
        console.error('[proxy-finance] KR Yahoo AC 예외:', krErr?.message);
        return Response.json({ error: '국내 종목 검색 중 오류가 발생했습니다.', assetName }, { status: 500 });
      }
    }

    // [3순위] Naver 증권 웹 크롤링 폴백 — Gemini·Yahoo AC 모두 실패 시
    if (!ticker) {
      try {
        ticker = await fetchTickerByWebScraping(assetName);
        if (ticker) console.log(`[proxy-finance] Naver 크롤링 확정: '${assetName}' → '${ticker}'`);
      } catch (crawlErr) {
        if (crawlErr?.isTimeout)
          return Response.json({ error: crawlErr.message, assetName }, { status: 504 });
        console.warn('[proxy-finance] Naver 크롤링 예외:', crawlErr?.message);
      }
    }

    if (!ticker) {
      return Response.json(
        { error: `'${assetName}'의 국내 티커(KOSPI/KOSDAQ)를 찾을 수 없습니다. 정확한 종목명을 입력해주세요.`, assetName },
        { status: 404 }
      );
    }
  }

  // ── [US·미지정 경로] Gemini → KR 판별 우선, 아니면 Yahoo Search ──────────
  if (!ticker) {
    let searchQuery = assetName;
    // 한글 포함 여부 — Gemini 실패 시 KR 경로 폴백 판단에 사용
    const hasKorean = /[가-힣]/.test(assetName);

    // Gemini 호출 (US·미지정 모두) — KR/US 자동 판별
    let geminiMeta = null;
    try {
      geminiMeta = await resolveTickerWithGemini(assetName, userProductType);
    } catch (geminiErr) {
      console.warn('[proxy-finance] Gemini 예외 (US/미지정):', geminiErr?.message);
    }

    // [1] Gemini가 KR 종목으로 확인 → KR 티커 직접 조립
    if (geminiMeta?.krCode && (geminiMeta.market === 'KOSPI' || geminiMeta.market === 'KOSDAQ')) {
      const paddedCode = String(geminiMeta.krCode).padStart(6, '0');
      const suffix = geminiMeta.market === 'KOSDAQ' ? '.KQ' : '.KS';
      ticker = `${paddedCode}${suffix}`;
      if (geminiMeta.koreanName) resolvedKoreanName = geminiMeta.koreanName;
      console.log(`[proxy-finance] Gemini 미지정→KR 확정: '${assetName}' → '${ticker}'`);
    } else {
      // 비상장 기업 차단 (Gemini 명시 시만)
      if (geminiMeta?.isListed === false) {
        return Response.json(
          { error: `'${assetName}'은(는) 주식 시장에 상장되지 않은 기업입니다. 상장 종목명을 입력해주세요.`, assetName },
          { status: 404 }
        );
      }

      if (geminiMeta?.englishName) searchQuery = geminiMeta.englishName;
      if (geminiMeta?.koreanName)  resolvedKoreanName = geminiMeta.koreanName;

      // [2] 한글 이름 → Gemini 실패·미지정 시 Yahoo KR AC + Naver 크롤링 폴백
      //     ("삼성전자" 처럼 한글로 입력해도 KR 티커를 찾을 수 있도록)
      if (hasKorean && !ticker) {
        try {
          ticker = await fetchTickerFromKRYahoo(assetName, userProductType);
        } catch (krErr) {
          if (krErr.isTimeout)
            return Response.json({ error: krErr.message, assetName }, { status: 504 });
          if (krErr.isRateLimit)
            return Response.json({ error: krErr.message, assetName }, { status: 429 });
          console.warn('[proxy-finance] KR Yahoo AC 폴백 예외 (미지정):', krErr?.message);
        }
        if (!ticker) {
          try {
            ticker = await fetchTickerByWebScraping(assetName);
          } catch { /* 폴백 실패 무시 */ }
        }
      }

      // [3] 그래도 없으면 Yahoo US Search (영문 이름·해외 종목 처리)
      if (!ticker) {
        try {
          ticker = await fetchTickerFromYahoo(searchQuery, userProductType);
        } catch (searchErr) {
          if (searchErr.isTimeout)
            return Response.json({ error: searchErr.message, assetName }, { status: 504 });
          if (searchErr.isRateLimit)
            return Response.json({ error: searchErr.message, assetName }, { status: 429 });
          console.warn('[proxy-finance] Yahoo Search 예외:', searchErr?.message);
          return Response.json({ error: '티커 검색 중 오류가 발생했습니다.', assetName }, { status: 500 });
        }
      }

      if (!ticker) {
        return Response.json(
          { error: `'${assetName}'에 해당하는 티커를 찾을 수 없습니다.`, assetName },
          { status: 404 }
        );
      }
    }
  }

  // ── 티커 기반 메타데이터 추론 ──────────────────────────────────────────
  let assetMeta = inferMetaFromTicker(ticker);

  // ── 국내 종목: 네이버 모바일 API로 한국어 공식명 보강 ─────────────────────
  const isKoreanTicker = ticker.endsWith('.KS') || ticker.endsWith('.KQ');

  if (isKoreanTicker) {
    const code = ticker.replace(/\.(KS|KQ)$/i, '');
    try {
      const naverRes = await fetchWithTimeout(
        `https://m.stock.naver.com/api/stock/${code}/basic`,
        { headers: { 'User-Agent': 'Mozilla/5.0' } },
        5_000
      );
      if (naverRes.ok) {
        const naverData = await naverRes.json();
        const naverKoreanName = naverData.stockName ?? naverData.corporateName ?? null;
        if (naverKoreanName) resolvedKoreanName = naverKoreanName;
      }
    } catch { /* 폴백 */ }
  }

  // userProductType 0순위 고정 — 추론 결과가 덮을 수 없음
  if (userProductType) {
    assetMeta = { ...assetMeta, productType: userProductType };
  }

  // ── KR 최종 유효성 검증 ────────────────────────────────────────────────
  // KR 카테고리임에도 비KR 심볼이 남아 있으면 강제 차단 (안전망).
  // Gemini·Yahoo AC·Naver 크롤링 3단 폴백을 모두 통과한 후이므로
  // 이 시점의 ticker 는 반드시 6자리.KS/.KQ 형식이어야 한다.
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

  // ── 메타데이터 최종 확정 (차트 성패와 무관하게 선제 확정) ─────────────────
  const finalMeta = userProductType
    ? { ...assetMeta, productType: userProductType }
    : assetMeta;

  // 차트 실패 시 재사용할 기본 200 OK 구조 — 티커·메타 보장, 시계열 비움
  const EMPTY_RESULT = {
    ticker,
    officialName: null,
    ...finalMeta,
    dividendYield:              0,
    trailingAnnualDividendRate: 0,
    closes: [],
    chart: { result: [] },
  };

  // ── Yahoo Finance v8 차트 블록 (전체 격리 try-catch) ─────────────────────
  // 최근 상장·거래정지·404·네트워크 오류 등 어떤 예외도 상위로 전파하지 않는다.
  // 차트 실패 = 정상 누락 → 200 OK + EMPTY_RESULT (DB 저장 허용)
  try {
    const endTs   = Math.floor(Date.now() / 1000);
    const startTs = endTs - 3 * 365 * 24 * 3600;
    const yahooUrl =
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}` +
      `?period1=${startTs}&period2=${endTs}&interval=1mo&events=dividends%7Chistory`;

    const chartRes = await fetchWithTimeout(yahooUrl, { headers: BROWSER_HEADERS }, 8_000);

    // 429는 재시도 가능한 오류 — 차트 실패가 아니므로 즉시 반환
    if (chartRes.status === 429) {
      return Response.json({ error: '요청이 너무 많습니다. 잠시 후 다시 시도해주세요.', ticker }, { status: 429 });
    }

    // HTTP 오류 → 빈 결과 반환
    if (!chartRes.ok) {
      console.warn(`[proxy-finance] Yahoo Chart HTTP ${chartRes.status} (${ticker}) — 빈 시계열로 처리`);
      return Response.json(EMPTY_RESULT, { status: 200 });
    }

    const yahooJson = await safeJson(chartRes);

    // JSON 파싱 실패 또는 API 수준 에러 → 빈 결과 반환
    if (!yahooJson || yahooJson?.chart?.error) {
      const errMsg = yahooJson?.chart?.error?.description ?? 'JSON 파싱 실패';
      console.warn(`[proxy-finance] Chart 데이터 오류 (${ticker}): ${errMsg} — 빈 시계열로 처리`);
      return Response.json(EMPTY_RESULT, { status: 200 });
    }

    // ── 시계열 · 메타 안전 추출 (Optional Chaining 전체 적용) ──────────────
    const closes    = yahooJson?.chart?.result?.[0]?.indicators?.quote?.[0]?.close ?? [];
    const chartMeta = yahooJson?.chart?.result?.[0]?.meta ?? {};

    // 빈 시계열 → regularMarketPrice(현재가)는 chartMeta에 남아 있으므로 yahooJson 포함 반환
    if (closes.length === 0) {
      console.warn(`[proxy-finance] 빈 시계열 (${ticker}) — 현재가 포함 200 OK 반환`);
      const partialName = resolveOfficialName(ticker, chartMeta);
      return Response.json({
        ...EMPTY_RESULT,
        officialName: partialName,
        ...yahooJson,
        ticker,              // ...yahooJson 이후 명시 고정 — 최상단 ticker 필드 보장
        closes: [],          // yahooJson spread 후 명시 덮어쓰기로 빈 배열 보장
      }, { status: 200 });
    }

    // ── 배당수익률 계산 (주기 감지 → 연간화) ───────────────────────────────
    const regularMarketPrice =
      typeof chartMeta?.regularMarketPrice === 'number' ? chartMeta.regularMarketPrice : 0;

    const rawDividends  = yahooJson?.chart?.result?.[0]?.events?.dividends ?? {};
    const nowTs      = Math.floor(Date.now() / 1000);
    const oneYearAgo = nowTs - 365 * 24 * 3600;

    // 지난 12개월 실제 지급 합산 (trailing 12-month)
    // date = ex-dividend date (Yahoo 기준). 미래 예정 배당 제외(e.date <= nowTs).
    // 분기/연간 여부와 무관하게 실제 지급된 배당금만 더함 — 추정·연간화 없음
    const recentEvents = Object.values(rawDividends)
      .filter(e => typeof e?.date === 'number' && typeof e?.amount === 'number' && e.amount > 0 && e.date >= oneYearAgo && e.date <= nowTs);
    const annualDividendPerShare = recentEvents.reduce((s, e) => s + e.amount, 0);

    const eventsDividendYield =
      annualDividendPerShare > 0 && regularMarketPrice > 0
        ? annualDividendPerShare / regularMarketPrice
        : 0;
    const eventsTrailingRate = annualDividendPerShare;

    // ── quoteSummary API로 더 정확한 배당 데이터 조회 ───────────────────
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
        // 실제 응답 필드 확인용 — 배포 전 제거 예정
        console.log(`[proxy-finance] summaryDetail keys (${ticker}):`, Object.keys(detail));
        console.log(`[proxy-finance] summaryDetail dividend fields (${ticker}):`, JSON.stringify({
          dividendYield:              detail?.dividendYield,
          trailingAnnualDividendYield: detail?.trailingAnnualDividendYield,
          dividendRate:               detail?.dividendRate,
          trailingAnnualDividendRate: detail?.trailingAnnualDividendRate,
        }));
        // dividendYield.raw = trailingAnnualDividendYield (TTM, 연간 소수)
        // trailingAnnualDividendRate.raw = TTM 주당 배당금 합산
        const dy   = detail?.dividendYield?.raw;
        const tadr = detail?.trailingAnnualDividendRate?.raw;
        if (typeof dy   === 'number') summaryDividendYield = dy;
        if (typeof tadr === 'number') summaryTrailingRate  = tadr;
        break;
      } catch {
        // 다음 URL 시도
      }
    }

    // ── Naver Finance 배당수익률 (국내 종목 폴백) ────────────────────────
    // Yahoo 배당 데이터가 없거나 0인 KR 종목에 한해 Naver에서 추가 조회
    const isKrTicker = ticker.endsWith('.KS') || ticker.endsWith('.KQ');
    const krCode = isKrTicker ? ticker.split('.')[0] : null;
    let naverDividendYield = 0;
    if (isKrTicker && krCode) {
      const yahooBest = summaryDividendYield > 0 ? summaryDividendYield : eventsDividendYield;
      if (yahooBest === 0) {
        naverDividendYield = await fetchNaverDividend(krCode);
      }
    }

    // 최종 배당수익률: quoteSummary > events 연간화 > Naver Finance
    const dividendYield =
      summaryDividendYield > 0 ? summaryDividendYield
      : eventsDividendYield  > 0 ? eventsDividendYield
      : naverDividendYield;
    const trailingAnnualDividendRate = summaryTrailingRate > 0 ? summaryTrailingRate : eventsTrailingRate;

    // officialName 결정 우선순위:
    //   KR 종목 → Naver/Gemini 한국어명 우선 → kr-asset-master.json → Yahoo meta 폴백
    //   US 종목 → Gemini 한국어명 있으면 "한국어명(TICKER)" 포맷 → 없으면 Yahoo meta 폴백
    let officialName = resolveOfficialName(ticker, chartMeta);
    if (resolvedKoreanName) {
      if (forcedMarket === 'US') {
        const baseTicker = ticker.split('.')[0];
        officialName = `${resolvedKoreanName}(${baseTicker})`;
      } else {
        // KR·미지정: Naver/Gemini 한국어명이 Yahoo 영문명보다 우선
        officialName = resolvedKoreanName;
      }
    }

    return Response.json({ ticker, officialName, ...finalMeta, dividendYield, trailingAnnualDividendRate, ...yahooJson });

  } catch (blockErr) {
    // 예상치 못한 TypeError 등 블록 내 모든 예외를 포획 — 500 크래시 원천 차단
    if (blockErr.isTimeout) {
      return Response.json({ error: blockErr.message, ticker }, { status: 504 });
    }
    console.error(`[proxy-finance] 차트 블록 예외 (${ticker}):`, blockErr?.message ?? blockErr);
    return Response.json(EMPTY_RESULT, { status: 200 });
  }
}
