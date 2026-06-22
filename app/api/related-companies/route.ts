/**
 * /api/related-companies  GET ?keyword=X&count=N&market=kr|en&etfName=Y
 *
 * 3단계 동적 구출 엔진
 * ─────────────────────────────────────────────────────────────────────────
 * [market=kr] 국내 3단계 체인
 *   1단계: Yahoo Finance /v1/finance/search → EQUITY 필터 → .KS/.KQ 안전장치
 *   2단계: 결과 0건 → 네이버 파이낸스 테마 검색 (sise_group_detail, EUC-KR 디코딩)
 *   3단계: 여전히 0건 → 현지화 Fallback 키워드('금융')로 네이버 테마 재검색
 *
 * [market=en] 글로벌 2단계 체인
 *   1단계: Yahoo Finance /v1/finance/search → EQUITY 필터 (전체 구문)
 *   2단계: 결과 0건 → keyword+etfName에서 핵심 명사 토큰 동적 추출 → 순차 재검색
 *          'financial' 하드코딩 제거 — 섹터별 정밀 동적 타겟팅
 *
 * 반환 필드: symbol, name, exchDisp, marketCap(KRW/USD), volume(거래량)
 * 특정 기업명·티커 하드코딩 금지 — 검색 결과는 전량 동적 API/크롤링 기반
 */

export const runtime = 'nodejs';

export interface RelatedCompanyItem {
  symbol: string;
  name: string;
  exchDisp: string;
  marketCap: number;  // 0 = 데이터 없음
  volume: number;     // 거래량, 0 = 데이터 없음
}

const BROWSER_HEADERS: Record<string, string> = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  Accept: 'application/json, text/plain, */*',
  'Accept-Language': 'en-US,en;q=0.9',
  Referer: 'https://finance.yahoo.com/',
  Origin: 'https://finance.yahoo.com',
};

const NAVER_HEADERS: Record<string, string> = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7',
  Referer: 'https://finance.naver.com/',
};

async function fetchWithTimeout(
  url: string,
  headers: Record<string, string> = BROWSER_HEADERS,
  ms = 8000,
): Promise<Response> {
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, { headers, signal: ctrl.signal });
    clearTimeout(id);
    return res;
  } catch (err) {
    clearTimeout(id);
    throw err;
  }
}

// ── 네이버 파이낸스 테마 목록 캐시 (1시간 TTL) ──────────────────────────
interface NaverTheme { no: string; name: string; }
let naverThemeCache: NaverTheme[] | null = null;
let naverThemeCacheTs = 0;
const THEME_CACHE_TTL_MS = 60 * 60 * 1000;

// sise_group.naver?type=theme EUC-KR HTML에서 265개 테마 목록 추출 + 캐시
async function getNaverThemes(): Promise<NaverTheme[]> {
  if (naverThemeCache && Date.now() - naverThemeCacheTs < THEME_CACHE_TTL_MS) {
    return naverThemeCache;
  }
  try {
    const res = await fetchWithTimeout(
      'https://finance.naver.com/sise/sise_group.naver?type=theme',
      NAVER_HEADERS,
      10000,
    );
    if (!res.ok) return naverThemeCache ?? [];
    const buf = await res.arrayBuffer();
    const html = new TextDecoder('euc-kr').decode(buf);
    const matches = [
      ...html.matchAll(/sise_group_detail\.naver\?type=theme&no=(\d+)">([^<]+)<\/a>/g),
    ];
    naverThemeCache = matches.map((m) => ({ no: m[1], name: m[2].trim() }));
    naverThemeCacheTs = Date.now();
    return naverThemeCache;
  } catch {
    return naverThemeCache ?? [];
  }
}

// ── 6자리 종목코드 → .KS(코스피) / .KQ(코스닥) 동적 판별 ────────────────────
// Yahoo Finance /v1/finance/search 로 코드 검색 → 응답 심볼에서 접미사 추출.
// 5초 타임아웃 내 응답 없거나 매칭 없으면 코스피(.KS)로 안전 기본값 반환.
async function resolveKrSuffix(code: string): Promise<'.KS' | '.KQ'> {
  try {
    const res = await fetchWithTimeout(
      `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(code)}&quotesCount=5&newsCount=0&listsCount=0`,
      BROWSER_HEADERS,
      5000,
    );
    if (!res.ok) return '.KS';
    const json = (await res.json()) as Record<string, unknown>;
    const quotes = (json?.quotes as Array<Record<string, unknown>> | undefined) ?? [];
    for (const q of quotes) {
      const sym = q.symbol as string | undefined;
      if (!sym) continue;
      if (sym === `${code}.KQ`) return '.KQ';
      if (sym === `${code}.KS`) return '.KS';
    }
    return '.KS';
  } catch {
    return '.KS';
  }
}

// ── [market=kr] 비주식 자산군 감지 → 네이버 테마 검색용 Fallback 키워드 ───────
function getKrEquityFallbackKeyword(keyword: string): string | null {
  const k = keyword.toLowerCase();
  const nonEquityPatterns = [
    '채권', 'bond', 'treasury',
    '외환', '달러', 'dollar', 'forex', 'currency',
    '금', 'gold', 'precious', 'silver',
    '농산물', 'agriculture', 'commodit',
    '에너지', 'crude', 'energy',
    'bitcoin', 'crypto', '비트코인', '암호화폐',
    'index', 's&p', '주식',
  ];
  if (!nonEquityPatterns.some((t) => k.includes(t))) return null;
  return '금융';
}

// ── [market=en] 한글 테마 키워드 → 영문 섹터 대표어 동적 매퍼 ──────────────────
// extractEnNounTokens 는 비ASCII 제거로 한글을 완전히 소거하므로,
// 한글 키워드 감지 시 먼저 영문 대표어로 변환하여 검색 품질을 보장한다.
// 정규식 패턴은 핵심 음절만 포함 — 특정 종목명·ETF명 하드코딩 금지.
const KR_EN_KEYWORD_MAP: Array<[RegExp, string]> = [
  [/원전|우라늄|핵에너지/,                'Uranium Nuclear Energy'],
  [/핀테크|페이먼트|결제/,                'Fintech Payment'],
  [/바이오|제약|생명공학/,                'Biotech Pharma'],
  [/반도체|칩|웨이퍼/,                   'Semiconductor Chip'],
  [/2차전지|배터리|리튬/,                 'Lithium Battery Electric'],
  [/클린에너지|태양광|풍력|신재생/,        'Clean Energy Solar Wind'],
  [/자율주행|모빌리티/,                   'Autonomous Driving Vehicle'],
  [/인공지능|머신러닝/,                   'Artificial Intelligence'],
  [/부동산|리츠|임대/,                    'Real Estate REIT'],
  [/헬스케어|의료|병원/,                  'Healthcare Medical'],
  [/암호화폐|가상화폐|블록체인/,           'Cryptocurrency Blockchain'],
  [/귀금속|금은|비철금속/,                'Gold Silver Mining'],
  [/농산물|곡물|사료/,                    'Agriculture Fertilizer'],
  [/에너지|석유|원유|정유/,               'Oil Gas Energy'],
  [/채권|국채|회사채/,                    'Treasury Bond Fixed Income'],
  [/달러|외환|환율/,                      'Global Banking Currency'],
  [/인프라|건설|건축/,                    'Infrastructure Engineering'],
  [/게임|엔터테인먼트|미디어/,             'Gaming Entertainment Media'],
  [/로봇|자동화/,                         'Robotics Automation'],
  [/우주|항공|방위/,                      'Aerospace Defense'],
];

function translateKrToEn(phrase: string): string {
  for (const [pattern, translation] of KR_EN_KEYWORD_MAP) {
    if (pattern.test(phrase)) return translation;
  }
  return phrase; // 매핑 없으면 원문 그대로 — extractEnNounTokens 가 이후 처리
}

// ── [market=en] Yahoo 검색 최적화: 영문 구문에서 핵심 명사 토큰 추출 ────────────
// ETF 공식명·섹터 키워드의 관사/관리사/ETF 접미어를 제거 후 의미 있는 단어만 반환
// 예: "Lithium Battery Electric Vehicle" → ["lithium", "battery", "electric", "vehicle"]
// 예: "Global X Lithium & Battery Tech ETF" → ["lithium", "battery"]
const EN_QUERY_STOP_WORDS = new Set([
  // ETF 브랜드·구조어
  'etf', 'fund', 'trust', 'index', 'global', 'ishares', 'spdr', 'vanguard',
  'blackrock', 'invesco', 'wisdomtree', 'direxion', 'proshares', 'xtrackers',
  // 관사·전치사
  'the', 'a', 'an', 'and', 'or', 'of', 'for', 'in', 'on', 'at', 'by', 'with',
  // 일반 자산 구조 용어 (너무 포괄적이어서 단독 검색 시 무의미)
  'tech', 'technology', 'market', 'markets', 'sector', 'stock', 'stocks',
  'short', 'long', 'term', 'ultra', 'pro', 'cap', 'large', 'small', 'mid',
  'equity', 'asset', 'income', 'fixed', 'management', 'investment',
  'international', 'developed', 'emerging', 'dividend', 'growth', 'value',
]);

function extractEnNounTokens(phrase: string): string[] {
  return phrase
    .split(/[\s&·,+\-\/()]+/)
    .map((t) => t.replace(/[^a-zA-Z]/g, '').toLowerCase())
    .filter((t) => t.length >= 4 && !EN_QUERY_STOP_WORDS.has(t));
}

// ── 네이버 한국어 시가총액 파싱 — "90조 7,657억" → KRW 수치 ─────────────────
// 쉼표·공백·단위 문자를 정규식으로 완전 제거 후 단위별 곱셈 합산
function parseKrMarketCap(raw: string): number {
  // 쉼표 완전 제거 후 단위 파싱
  const s = raw.replace(/,/g, '').trim();
  let v = 0;
  const jo  = /(\d+(?:\.\d+)?)조/.exec(s);
  const eok = /(\d+(?:\.\d+)?)억/.exec(s);
  const man = /(\d+(?:\.\d+)?)만/.exec(s);
  if (jo)  v += parseFloat(jo[1])  * 1_000_000_000_000;
  if (eok) v += parseFloat(eok[1]) * 100_000_000;
  if (man) v += parseFloat(man[1]) * 10_000;
  // 단위 없는 순수 숫자 fallback (억/조 단위 기표가 없는 경우)
  if (v === 0) {
    const digits = s.replace(/[^0-9.]/g, '');
    if (digits) v = parseFloat(digits);
  }
  return Number.isFinite(v) ? Math.round(v) : 0;
}

// ── 범용 수치 안전 파서 — 과학적 기수법(2.4e+12) 보존 + null·NaN 방어 ──
// number 타입은 정규식을 통과시키지 않고 바로 분기 — e/+/- 소거 버그 원천 차단.
// 문자열 경우 쉼표만 제거 후 parseFloat 위임 (기수법 표기 그대로 유지).
function safeNum(v: unknown): number {
  if (v == null) return 0;
  if (typeof v === 'number') {
    return Number.isFinite(v) && v > 0 ? Math.round(v) : 0;
  }
  // 쉼표 제거만 수행 — e, +, - 등 기수법 문자는 보존하여 parseFloat가 정확히 처리
  const n = parseFloat(String(v).replace(/,/g, ''));
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
}

// Yahoo Finance API는 v7(평탄 숫자)과 v10({"raw":숫자,"fmt":"..."}) 두 포맷을 혼용.
// 두 포맷을 모두 처리하여 NaN 유입을 완전 차단한다.
function extractRawValue(v: unknown): number {
  if (v == null) return 0;
  if (typeof v === 'object' && 'raw' in (v as object)) {
    return safeNum((v as Record<string, unknown>).raw);
  }
  return safeNum(v);
}

// ── Yahoo Finance Crumb 캐시 ──────────────────────────────────────────────────
// Yahoo Finance v7 API는 2024년부터 crumb 인증 필수.
// fc.yahoo.com → A3 쿠키 → getcrumb 순으로 획득 후 55분 캐싱.
interface YahooCrumb { cookie: string; crumb: string; ts: number }
let _yahooCrumb: YahooCrumb | null = null;
const CRUMB_TTL_MS = 55 * 60 * 1000;

async function getYahooCrumb(): Promise<YahooCrumb | null> {
  if (_yahooCrumb && Date.now() - _yahooCrumb.ts < CRUMB_TTL_MS) return _yahooCrumb;
  try {
    const fcRes = await fetchWithTimeout('https://fc.yahoo.com', {
      'User-Agent': BROWSER_HEADERS['User-Agent'],
      Accept: '*/*',
    }, 8000);
    const setCookie = fcRes.headers.get('set-cookie') ?? '';
    const m = setCookie.match(/A3=([^;]+)/);
    if (!m) return null;
    const cookie = `A3=${m[1]}`;
    const crumbRes = await fetchWithTimeout(
      'https://query1.finance.yahoo.com/v1/test/getcrumb',
      { ...BROWSER_HEADERS, Cookie: cookie },
      8000,
    );
    if (!crumbRes.ok) return null;
    const crumb = (await crumbRes.text()).trim();
    if (!crumb || crumb.startsWith('{')) return null;
    _yahooCrumb = { cookie, crumb, ts: Date.now() };
    return _yahooCrumb;
  } catch {
    return null;
  }
}

// ── Yahoo Finance 지표 조회 — crumb 인증 + v8 chart 폴백 ─────────────────────
// 1단계: crumb 인증 v7 배치 (marketCap + volume)
// 2단계: crumb 만료 or 실패 시 v8/chart 개별 병렬 (volume 전용)
async function fetchYahooQuoteMetrics(
  symbols: string[],
): Promise<Map<string, { marketCap: number; volume: number }>> {
  if (symbols.length === 0) return new Map();
  const metricsMap = new Map<string, { marketCap: number; volume: number }>();

  // 1단계: crumb 기반 v7 배치 — marketCap + volume 모두 수집
  const crumbInfo = await getYahooCrumb();
  if (crumbInfo) {
    for (const host of ['query1', 'query2']) {
      try {
        const url =
          `https://${host}.finance.yahoo.com/v7/finance/quote` +
          `?symbols=${symbols.map(encodeURIComponent).join(',')}` +
          `&crumb=${encodeURIComponent(crumbInfo.crumb)}`;
        const res = await fetchWithTimeout(
          url,
          { ...BROWSER_HEADERS, Cookie: crumbInfo.cookie },
          7000,
        );
        if (res.status === 401) { _yahooCrumb = null; continue; }
        if (!res.ok) continue;
        const json = (await res.json()) as Record<string, unknown>;
        const results =
          (
            (json?.quoteResponse as Record<string, unknown> | undefined)
              ?.result as Record<string, unknown>[] | undefined
          ) ?? [];
        for (const r of results) {
          const sym = r.symbol as string | undefined;
          if (!sym) continue;
          metricsMap.set(sym, {
            marketCap: extractRawValue(r.marketCap),
            volume:    extractRawValue(r.regularMarketVolume),
          });
        }
        if (metricsMap.size > 0) break;
      } catch {
        // 다음 도메인 시도
      }
    }
  }

  // 2단계: v7 실패한 심볼 — v8/chart 병렬 조회로 volume 보완
  // (v8/chart는 인증 불필요, marketCap 미지원 — volume만 채움)
  const needsVolume = symbols.filter((s) => !metricsMap.has(s));
  if (needsVolume.length > 0) {
    const settled = await Promise.allSettled(
      needsVolume.map(async (sym) => {
        try {
          const url =
            `https://query1.finance.yahoo.com/v8/finance/chart` +
            `/${encodeURIComponent(sym)}?interval=1d&range=1d`;
          const res = await fetchWithTimeout(url, BROWSER_HEADERS, 5000);
          if (!res.ok) return null;
          const json = (await res.json()) as Record<string, unknown>;
          const meta = (
            (json?.chart as Record<string, unknown>)
              ?.result as Record<string, unknown>[] | undefined
          )?.[0]?.meta as Record<string, unknown> | undefined;
          if (!meta) return null;
          return { sym, volume: safeNum(meta.regularMarketVolume) };
        } catch { return null; }
      }),
    );
    for (const r of settled) {
      if (r.status === 'fulfilled' && r.value) {
        const { sym, volume } = r.value;
        metricsMap.set(sym, { marketCap: 0, volume });
      }
    }
  }

  return metricsMap;
}

function parseEquityQuotes(
  quotes: Record<string, unknown>[],
  count: number,
): RelatedCompanyItem[] {
  return quotes
    .filter(
      (q) =>
        (q.quoteType as string | undefined) === 'EQUITY' &&
        typeof q.symbol === 'string' &&
        q.symbol.length > 0,
    )
    .slice(0, count)
    .map((q) => ({
      symbol: q.symbol as string,
      name:
        (q.shortname as string | undefined) ??
        (q.longname as string | undefined) ??
        (q.symbol as string),
      exchDisp: (q.exchDisp as string | undefined) ?? '',
      marketCap: safeNum(q.marketCap),
      volume:    safeNum(q.regularMarketVolume),
    }));
}

// market=kr 안전장치 — 시장 격리 가드
// etfFullName에 '코스닥'/'KOSDAQ' 포함 시 .KQ 전용 격리 (코스피 노이즈 완전 차단)
// 그 외에는 .KS/.KQ 통합 허용
function applyKrFilter(list: RelatedCompanyItem[], etfFullName?: string): RelatedCompanyItem[] {
  const kosdaqOnly = etfFullName ? /코스닥|kosdaq/i.test(etfFullName) : false;
  if (kosdaqOnly) {
    return list.filter((c) => c.symbol.endsWith('.KQ'));
  }
  return list.filter((c) => c.symbol.endsWith('.KS') || c.symbol.endsWith('.KQ'));
}

function decodeHtml(str: string): string {
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .trim();
}

/**
 * 네이버 파이낸스 테마 검색 크롤러 (market=kr 전용)
 *
 * 동작 흐름:
 * 1. sise_group.naver 테마 목록(EUC-KR, 1시간 캐시)에서 keyword 포함 테마 추출
 * 2. 매칭된 테마 최대 3개 상세 페이지를 병렬 조회
 * 3. sise_group_detail.naver (EUC-KR) 에서 </tr> 단위로 행 분할 → code/name/mktcap/vol 추출
 * 4. 6자리 코드를 Yahoo Finance 검색으로 .KS/.KQ 동적 판별 (병렬, 5s timeout)
 *    → 코스닥 부모 ETF 가드 적용 시 .KQ 종목만 생존 가능
 */
async function fetchNaverThemeStocks(keyword: string, count: number): Promise<RelatedCompanyItem[]> {
  try {
    const themes = await getNaverThemes();
    // 노이즈 테마 동적 배제: keyword 뒤에 인식·보안·생체 등 비관련 식별자가 붙은 테마 제거
    // 예) keyword="바이오" → "바이오인식"(생체인식) 배제, "바이오시밀러" 유지
    // keyword 자체가 해당 패턴을 포함하면 필터링 면제 (보안 키워드 검색 시 의도 보존)
    const THEME_NOISE_RE = /인식|보안|생체|접근|출입|방범/;
    const matched = themes
      .filter((t) => t.name.includes(keyword))
      .filter((t) => {
        const afterKeyword = t.name.slice(t.name.indexOf(keyword) + keyword.length);
        return !THEME_NOISE_RE.test(afterKeyword) || THEME_NOISE_RE.test(keyword);
      })
      .sort((a, b) => {
        // 정확 일치 최우선, 이후 이름 짧은 순(더 정밀한 테마)
        if (a.name === keyword && b.name !== keyword) return -1;
        if (b.name === keyword && a.name !== keyword) return 1;
        return a.name.length - b.name.length;
      })
      .slice(0, 3);
    if (matched.length === 0) return [];

    // 1단계: 상세 페이지에서 6자리 코드+메타 추출 (suffix 없는 중간 타입)
    type RawStock = { code: string; name: string; exchDisp: string; marketCap: number; volume: number };

    const detailFetches = await Promise.all(
      matched.map(async (theme): Promise<RawStock[]> => {
        try {
          const url =
            `https://finance.naver.com/sise/sise_group_detail.naver?type=theme&no=${theme.no}`;
          const res = await fetchWithTimeout(url, NAVER_HEADERS, 8000);
          if (!res.ok) return [];
          const buf = await res.arrayBuffer();
          const html = new TextDecoder('euc-kr').decode(buf);

          const stocks: RawStock[] = [];
          const rowBlocks = html.split('</tr>');
          for (const block of rowBlocks) {
            const codeMatch = /code=(\d{6})/.exec(block);
            if (!codeMatch) continue;
            const code = codeMatch[1];

            const afterCode = block.slice(block.indexOf(codeMatch[0]));
            const linkContentMatch = />([^]*?)<\/a>/.exec(afterCode);
            const name = linkContentMatch
              ? decodeHtml(linkContentMatch[1].replace(/<[^>]*>/g, '').trim())
              : code;
            if (!name) continue;

            const mcMatch =
              /<td[^>]*class="number[^"]*"[^>]*>([\s\S]*?(?:조|억)[\s\S]*?)<\/td>/.exec(block);
            const mcRaw = mcMatch ? mcMatch[1].replace(/<[^>]*>/g, '').trim() : '';
            const marketCap = mcRaw ? parseKrMarketCap(mcRaw) : 0;

            const plainNumCells = [
              ...block.matchAll(/<td[^>]*class="number[^"]*"[^>]*>([\d,]+)<\/td>/g),
            ];
            const volRaw = plainNumCells[1]?.[1] ?? '';
            const volume = volRaw ? Math.round(Number(volRaw.replace(/,/g, ''))) || 0 : 0;

            stocks.push({ code, name, exchDisp: 'Korea', marketCap, volume });
          }
          return stocks;
        } catch {
          return [];
        }
      }),
    );

    // 2단계: 중복 제거 후 최대 count*2개 수집 (suffix 판별 후 applyKrFilter가 줄일 수 있으므로 여유분 확보)
    const seen = new Set<string>();
    const rawList: RawStock[] = [];
    const oversample = Math.min(count * 2, 20);
    for (const batch of detailFetches) {
      for (const s of batch) {
        if (!seen.has(s.code)) {
          seen.add(s.code);
          rawList.push(s);
          if (rawList.length >= oversample) break;
        }
      }
      if (rawList.length >= oversample) break;
    }
    if (rawList.length === 0) return [];

    // 3단계: Yahoo Finance 검색으로 .KS/.KQ suffix 동적 판별 (병렬)
    const suffixes = await Promise.allSettled(rawList.map((s) => resolveKrSuffix(s.code)));
    return rawList.map((s, i) => ({
      symbol: `${s.code}${suffixes[i].status === 'fulfilled' ? suffixes[i].value : '.KS'}`,
      name: s.name,
      exchDisp: s.exchDisp,
      marketCap: s.marketCap,
      volume: s.volume,
    }));
  } catch {
    return [];
  }
}

export async function GET(request: Request): Promise<Response> {
  try {
  return await getHandler(request);
  } catch (err) {
    console.error('[/api/related-companies] Unhandled exception — returning empty companies:', err);
    return Response.json({ companies: [] });
  }
}

async function getHandler(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const keyword = url.searchParams.get('keyword');
  const count = Math.min(parseInt(url.searchParams.get('count') ?? '10', 10) || 10, 10);
  const market = (url.searchParams.get('market') ?? 'en') as 'kr' | 'en';
  // ETF 공식명 (선택) — 영문 토큰 추출 보조 소스
  const etfName = (url.searchParams.get('etfName') ?? '').trim();
  // ETF 영문 풀네임 (선택) — 원유 관련 ETF 감지 및 쿼리 정밀 타겟팅 소스
  const etfFullName = (url.searchParams.get('etfFullName') ?? '').trim();
  // 최우선 쿼리 (예: "정유") — subQuery가 있으면 기존 keyword보다 먼저 매칭 시도
  const subQuery = (url.searchParams.get('subQuery') ?? '').trim();

  if (!keyword || keyword.trim() === '') {
    return Response.json({ companies: [] });
  }

  const kw = keyword.trim();

  const buildYahooUrl = (q: string) =>
    `https://query1.finance.yahoo.com/v1/finance/search` +
    `?q=${encodeURIComponent(q)}&quotesCount=${count}&newsCount=0&listsCount=0`;

  const fetchEquity = async (q: string): Promise<RelatedCompanyItem[]> => {
    try {
      const res = await fetchWithTimeout(buildYahooUrl(q));
      if (!res.ok) return [];
      const json = (await res.json()) as Record<string, unknown>;
      const quotes = (json?.quotes as Record<string, unknown>[] | undefined) ?? [];
      return parseEquityQuotes(quotes, count);
    } catch {
      return [];
    }
  };

  let companies: RelatedCompanyItem[] = [];

  if (market === 'kr') {
    // ── 0단계(최우선): subQuery 직접 테마 매칭 (예: "정유" 우선 타겟팅) ─────
    // 시장 격리 가드 적용: 코스닥 부모라면 .KS 종목 전량 배제
    if (subQuery) {
      companies = applyKrFilter(await fetchNaverThemeStocks(subQuery, count), etfFullName);
    }

    // ── 국내 3단계 동적 구출 체인 ──────────────────────────────────────────
    // 1단계: Yahoo Finance EQUITY → 시장 격리 가드 (KOSDAQ/코스피 분리)
    if (companies.length === 0) {
      companies = applyKrFilter(await fetchEquity(kw), etfFullName);
    }

    // 2단계: 야후 결과 없으면 네이버 파이낸스 테마 검색 (EUC-KR 디코딩)
    // 시장 격리 가드 적용: 네이버는 6자리 코드를 .KS로 통일하므로
    // 코스닥 부모 ETF에 대해 .KS 결과를 여기서 완전히 배제한다
    if (companies.length === 0) {
      companies = applyKrFilter(await fetchNaverThemeStocks(kw, count), etfFullName);
    }

    // 3단계: 그래도 없으면 현지화 Fallback 키워드('금융')로 네이버 테마 재검색
    if (companies.length === 0) {
      const fallbackKw = getKrEquityFallbackKeyword(kw) ?? '금융';
      companies = applyKrFilter(await fetchNaverThemeStocks(fallbackKw, count), etfFullName);
    }
  } else {
    // ── [market=en] 글로벌 전용 파이프라인 ──────────────────────────────────
    // applyKrFilter / resolveKrSuffix / fetchNaverThemeStocks 는 여기서 절대 호출하지 않는다.
    // 한국 주식 접미사 검사(.KS/.KQ) 및 국내 시장 격리 가드는 market=kr 전용이며
    // 이 블록에서는 전량 배제된다. 글로벌 EQUITY만 반환한다.

    // etfFullName에서 원유 핵심 명사('Oil', 'Crude', 'Petroleum') 포착 시 정밀 타겟팅 활성화
    const oilMatch = etfFullName ? /\b(oil|crude|petroleum)\b/i.test(etfFullName) : false;

    // 한글 키워드 감지 시 영문 섹터 대표어로 변환 — 비ASCII 소거 문제 원천 차단
    const translatedKw = /[가-힣]/.test(kw) ? translateKrToEn(kw) : kw;

    // ── 0단계(최우선): subQuery 직접 Yahoo 매칭 ────────────────────────────
    if (subQuery) {
      companies = await fetchEquity(subQuery);
    }

    // ── 글로벌 3티어 하이브리드 검색 폴백 체인 ─────────────────────────────
    // 1티어: 정밀 쿼리 — oil 감지 시 'Crude Oil Major', 아니면 번역된 카테고리 키워드
    if (companies.length === 0) {
      companies = await fetchEquity(oilMatch ? 'Crude Oil Major' : translatedKw);
    }

    // 2티어: 1티어가 정밀 쿼리로 0건일 때 → 원래 광범위 카테고리 키워드로 재검색
    if (companies.length === 0 && oilMatch) {
      companies = await fetchEquity(translatedKw);
    }

    // 3티어: 핵심 명사 토큰 순차 재검색 → 모든 티어 실패 시에도 빈 배열로 안전 반환
    // oil 감지: ['oil', 'petroleum'] 고정 토큰 / 비oil: translatedKw·etfName·etfFullName 동적 추출
    if (companies.length === 0) {
      const baseTokens = oilMatch
        ? ['oil', 'petroleum']
        : extractEnNounTokens(translatedKw);
      const etfTokens    = etfName     ? extractEnNounTokens(etfName)     : [];
      const etfFnTokens  = (etfFullName && !oilMatch) ? extractEnNounTokens(etfFullName) : [];
      const seen = new Set<string>();
      const tokens: string[] = [];
      for (const t of [...baseTokens, ...etfTokens, ...etfFnTokens]) {
        if (!seen.has(t)) { seen.add(t); tokens.push(t); }
      }
      for (const token of tokens) {
        companies = await fetchEquity(token);
        if (companies.length > 0) break;
      }
    }
  }

  // ── Yahoo Finance v7/quote 배치 보강 ──────────────────────────────────────
  // /v1/finance/search 및 네이버 HTML 파싱은 marketCap·volume 미제공이 일반적.
  // 확보된 심볼 목록으로 quote API를 추가 호출하여 실측 정량 데이터로 덮어쓴다.
  // 보강 실패(rate limit·타임아웃)는 try-catch로 흡수 — 기존 값 그대로 반환
  if (companies.length > 0) {
    try {
      const metricsMap = await fetchYahooQuoteMetrics(companies.map((c) => c.symbol));
      if (metricsMap.size > 0) {
        companies = companies.map((c) => {
          const m = metricsMap.get(c.symbol);
          if (!m) return c;
          return {
            ...c,
            marketCap: m.marketCap > 0 ? m.marketCap : c.marketCap,
            volume:    m.volume    > 0 ? m.volume    : c.volume,
          };
        });
      }
    } catch (err) {
      console.error('[related-companies] fetchYahooQuoteMetrics error (non-fatal):', err);
    }
  }

  // 최종 출력 — TOP 10 강제 제한 + marketCap·volume 수치 보장
  // 네이버 테마 oversample(최대 20건) 경로를 포함하여 어떤 검색 경로를 거치더라도
  // 프론트엔드로는 반드시 10건 이하만 내보낸다.
  return Response.json({
    companies: companies.slice(0, 10).map((c) => ({
      ...c,
      marketCap: Number(c.marketCap) || 0,
      volume:    Number(c.volume)    || 0,
    })),
  });
}
