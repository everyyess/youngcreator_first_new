/**
 * /api/options-chain
 * GET: ?ticker=XXX → Yahoo Finance v7 옵션 체인 수집 + 지표 계산 결과 반환
 * - v7 /finance/options: 만기별 콜·풋 OI, 거래량, IV
 * - v8 /finance/chart: HV 계산용 일봉 (3개월)
 * - v10 quoteSummary: 어닝 날짜
 * - 30분 서버 메모리 캐시
 */

export const runtime = "nodejs";

import {
  computeOptionsResult,
  type OptionsChainResponse,
  type RawExpiry,
} from "../../../utils/optionIndicators";

const BROWSER_HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  Accept: "application/json, text/plain, */*",
  "Accept-Language": "en-US,en;q=0.9",
  Referer: "https://finance.yahoo.com/",
  Origin: "https://finance.yahoo.com",
};

// ── Yahoo Finance Crumb 인증 (v7 options API 401 대응) ───────────────────────

interface YahooCrumb {
  crumb: string;
  cookie: string;
  ts: number;
}
let crumbCache: YahooCrumb | null = null;
const CRUMB_TTL_MS = 50 * 60 * 1000;

async function getYahooCrumb(): Promise<YahooCrumb | null> {
  if (crumbCache && Date.now() - crumbCache.ts < CRUMB_TTL_MS) return crumbCache;
  try {
    // Step 1: Yahoo consent 엔드포인트로 A1/A3/GUC 쿠키 획득 (JS 없이 작동)
    const r1 = await fetch(
      "https://guce.yahoo.com/consent?brandType=nonEu&gcrumb=test&country=US",
      {
        headers: {
          "User-Agent": BROWSER_HEADERS["User-Agent"],
          Accept: "text/html,application/xhtml+xml",
          "Accept-Language": "en-US,en;q=0.9",
        },
        redirect: "follow",
      },
    );

    // Node 18+ undici의 getSetCookie() 사용 (Set-Cookie 헤더 배열 반환)
    const rawCookies: string[] =
      (r1.headers as unknown as { getSetCookie?: () => string[] }).getSetCookie?.() ?? [];

    const cookieStr = rawCookies
      .map((c) => c.split(";")[0].trim())
      .filter(Boolean)
      .join("; ");

    if (!cookieStr) return null;

    // Step 2: crumb 토큰 획득
    const r2 = await fetch("https://query2.finance.yahoo.com/v1/test/getcrumb", {
      headers: { ...BROWSER_HEADERS, Cookie: cookieStr },
    });
    if (!r2.ok) return null;
    const crumb = (await r2.text()).trim();
    if (!crumb || crumb.startsWith("<") || crumb.length > 30) return null;

    crumbCache = { crumb, cookie: cookieStr, ts: Date.now() };
    return crumbCache;
  } catch {
    return null;
  }
}

const cache = new Map<string, { data: OptionsChainResponse; ts: number }>();
const CACHE_TTL_MS = 30 * 60 * 1000;
const MAX_EXPIRIES = 18;

// ── Yahoo Finance 내부 타입 ──────────────────────────────────────────

interface YFOption {
  strike: number;
  volume?: number;
  openInterest?: number;
  impliedVolatility?: number;
}

interface YFExpiryChain {
  expirationDate: number;
  calls: YFOption[];
  puts: YFOption[];
}

interface YFOptionsResult {
  expirationDates?: number[];
  quote?: { regularMarketPrice?: number };
  options?: YFExpiryChain[];
}

// ── 데이터 패치 헬퍼 ────────────────────────────────────────────────

async function fetchWithTimeout(
  url: string,
  headers: Record<string, string> = BROWSER_HEADERS,
  ms = 12_000,
): Promise<Response> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { headers, signal: controller.signal });
  } finally {
    clearTimeout(id);
  }
}

async function fetchOptionsPage(ticker: string, date?: number): Promise<YFOptionsResult | null> {
  const auth = await getYahooCrumb();
  const qs = new URLSearchParams();
  if (date != null) qs.set("date", String(date));
  if (auth?.crumb) qs.set("crumb", auth.crumb);
  const qstr = qs.toString() ? `?${qs}` : "";

  const headers: Record<string, string> = {
    ...BROWSER_HEADERS,
    ...(auth?.cookie ? { Cookie: auth.cookie } : {}),
  };

  for (const host of ["https://query2.finance.yahoo.com", "https://query1.finance.yahoo.com"]) {
    const url = `${host}/v7/finance/options/${encodeURIComponent(ticker)}${qstr}`;
    try {
      const res = await fetchWithTimeout(url, headers);
      if (!res.ok) {
        if (res.status === 401 || res.status === 403) crumbCache = null;
        continue;
      }
      const j = (await res.json()) as { optionChain?: { result?: YFOptionsResult[] } };
      const result = j?.optionChain?.result?.[0];
      if (result) return result;
    } catch { continue; }
  }
  return null;
}

async function fetchHVPrices(ticker: string): Promise<number[]> {
  const end = Math.floor(Date.now() / 1000);
  const start = end - 110 * 24 * 3600;
  const url =
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}` +
    `?period1=${start}&period2=${end}&interval=1d`;
  try {
    const res = await fetchWithTimeout(url, BROWSER_HEADERS, 8_000);
    if (!res.ok) return [];
    const j = (await res.json()) as {
      chart?: {
        result?: {
          indicators?: {
            adjclose?: { adjclose?: (number | null)[] }[];
            quote?: { close?: (number | null)[] }[];
          };
        }[];
      };
    };
    const r = j?.chart?.result?.[0];
    const arr =
      r?.indicators?.adjclose?.[0]?.adjclose ??
      r?.indicators?.quote?.[0]?.close ??
      [];
    return arr.filter((v): v is number => v != null && !isNaN(v));
  } catch {
    return [];
  }
}

async function fetchEarnings(ticker: string): Promise<{ date: string; dte: number } | null> {
  const url =
    `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(ticker)}` +
    `?modules=calendarEvents`;
  try {
    const res = await fetchWithTimeout(url, BROWSER_HEADERS, 6_000);
    if (!res.ok) return null;
    const j = (await res.json()) as {
      quoteSummary?: {
        result?: {
          calendarEvents?: {
            earnings?: { earningsDate?: { raw: number }[] };
          };
        }[];
      };
    };
    const dates =
      j?.quoteSummary?.result?.[0]?.calendarEvents?.earnings?.earningsDate ?? [];
    const todaySec = Date.now() / 1000;
    const future = dates.map((d) => d.raw).filter((d) => d > todaySec).sort((a, b) => a - b);
    if (!future.length) return null;
    return {
      date: new Date(future[0] * 1000).toISOString().slice(0, 10),
      dte: Math.round((future[0] - todaySec) / 86400),
    };
  } catch {
    return null;
  }
}

function toRawExpiry(ch: YFExpiryChain): RawExpiry {
  return {
    expirationDate: ch.expirationDate,
    calls: (ch.calls ?? []).map((c) => ({
      strike: c.strike,
      volume: c.volume ?? 0,
      openInterest: c.openInterest ?? 0,
      iv: c.impliedVolatility ?? 0,
    })),
    puts: (ch.puts ?? []).map((p) => ({
      strike: p.strike,
      volume: p.volume ?? 0,
      openInterest: p.openInterest ?? 0,
      iv: p.impliedVolatility ?? 0,
    })),
  };
}

// ── 라우트 핸들러 ────────────────────────────────────────────────────

export async function GET(request: Request): Promise<Response> {
  const { searchParams } = new URL(request.url);
  const ticker = searchParams.get("ticker")?.trim().toUpperCase();

  if (!ticker) {
    return Response.json({ error: "ticker 파라미터가 필요합니다." }, { status: 400 });
  }

  // 한국 거래소 티커(.KS/.KQ/.KL) 조기 차단 — Yahoo Finance 옵션 체인 없음
  if (/\.(KS|KQ|KL)$/i.test(ticker)) {
    return Response.json(
      { error: `'${ticker}'는 한국 주식입니다. 옵션 분석은 미국 상장 종목만 지원합니다.` },
      { status: 404 },
    );
  }

  // 캐시 확인
  const cached = cache.get(ticker);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
    return Response.json(cached.data);
  }

  // Step 1: 초기 요청 (만기 날짜 목록 + 첫 번째 만기 체인)
  let initial: YFOptionsResult | null;
  try {
    initial = await fetchOptionsPage(ticker);
  } catch {
    return Response.json({ error: "Yahoo Finance 연결 실패" }, { status: 502 });
  }

  if (!initial) {
    return Response.json(
      { error: `'${ticker}' 데이터를 가져올 수 없습니다.` },
      { status: 502 },
    );
  }

  const spot = initial.quote?.regularMarketPrice ?? 0;
  const allExpDates = initial.expirationDates ?? [];

  if (!allExpDates.length) {
    return Response.json(
      {
        error: `'${ticker}'의 상장 옵션이 없습니다. 미국 주식 티커인지 확인하세요. (한국 주식·채권·현금은 옵션 분석 대상이 아닙니다.)`,
      },
      { status: 404 },
    );
  }

  // Step 2: 1년 이내 만기만 필터, 최대 MAX_EXPIRIES
  const todaySec = Date.now() / 1000;
  const cutoff = todaySec + 366 * 86400;
  const filteredExps = allExpDates
    .filter((ts) => ts >= todaySec && ts <= cutoff)
    .slice(0, MAX_EXPIRIES);

  const firstExpTs = initial.options?.[0]?.expirationDate;
  const remainingExps = filteredExps.filter((ts) => ts !== firstExpTs);

  // Step 3: HV·어닝·나머지 만기 체인 병렬 패치
  const allResults = await Promise.all([
    fetchHVPrices(ticker),
    fetchEarnings(ticker),
    ...remainingExps.map((ts) =>
      fetchOptionsPage(ticker, ts).then((r) => r?.options?.[0] ?? null),
    ),
  ]);

  const hvPrices = allResults[0] as number[];
  const earnings = allResults[1] as { date: string; dte: number } | null;
  const extraChains = allResults.slice(2) as (YFExpiryChain | null)[];

  // 체인 조합
  const allChains: RawExpiry[] = [];
  if (initial.options?.[0]) allChains.push(toRawExpiry(initial.options[0]));
  for (const ch of extraChains) {
    if (ch) allChains.push(toRawExpiry(ch));
  }

  if (!allChains.length) {
    return Response.json(
      { error: `'${ticker}' 옵션 체인 데이터를 가져올 수 없습니다.` },
      { status: 404 },
    );
  }

  const data = computeOptionsResult(ticker, spot, allChains, hvPrices, earnings);
  cache.set(ticker, { data, ts: Date.now() });
  return Response.json(data);
}
