/**
 * /api/ta-ohlcv
 * GET: ?ticker=XXX → Yahoo Finance v8 일봉 OHLCV 5년치 반환
 * 기술적 분석용 전용 엔드포인트 (proxy-finance 는 월봉만 제공하므로 별도 생성)
 */

export const runtime = 'nodejs';

const BROWSER_HEADERS: Record<string, string> = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  Accept: 'application/json, text/plain, */*',
  'Accept-Language': 'en-US,en;q=0.9',
  Referer: 'https://finance.yahoo.com/',
  Origin: 'https://finance.yahoo.com',
};

// 서버 내 메모리 캐시 (프로세스 재시작 전까지 유효, TTL 30분)
const cache = new Map<string, { data: OhlcvResponse; ts: number }>();
const CACHE_TTL_MS = 30 * 60 * 1000;

export interface OhlcvResponse {
  ticker: string;
  dates: string[];
  prices: number[];
  highs: number[];
  lows: number[];
  volumes: number[];
  currentPrice: number;
  prevClose: number;
}

async function fetchWithTimeout(
  url: string,
  options: RequestInit,
  timeoutMs = 10_000,
): Promise<Response> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    return res;
  } catch (err: unknown) {
    if ((err as Error).name === 'AbortError') {
      const e = new Error('Yahoo Finance 응답 시간 초과') as Error & { isTimeout: boolean };
      e.isTimeout = true;
      throw e;
    }
    throw err;
  } finally {
    clearTimeout(id);
  }
}

function cleanArray(arr: (number | null | undefined)[]): number[] {
  return arr.map((v) => (v == null || isNaN(v as number) ? 0 : (v as number)));
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const ticker = searchParams.get('ticker')?.trim();

  if (!ticker) {
    return Response.json({ error: 'ticker 파라미터가 필요합니다.' }, { status: 400 });
  }

  // 캐시 확인
  const cached = cache.get(ticker);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
    return Response.json(cached.data);
  }

  const endTs = Math.floor(Date.now() / 1000);
  const startTs = endTs - 5 * 365 * 24 * 3600;
  const url =
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}` +
    `?period1=${startTs}&period2=${endTs}&interval=1d&events=history`;

  let res: Response;
  try {
    res = await fetchWithTimeout(url, { headers: BROWSER_HEADERS }, 10_000);
  } catch (err: unknown) {
    const e = err as Error & { isTimeout?: boolean };
    if (e.isTimeout) return Response.json({ error: e.message }, { status: 504 });
    return Response.json({ error: '네트워크 오류가 발생했습니다.' }, { status: 500 });
  }

  if (res.status === 429)
    return Response.json({ error: '요청이 너무 많습니다. 잠시 후 다시 시도해주세요.' }, { status: 429 });
  if (!res.ok)
    return Response.json({ error: `Yahoo Finance 오류 (HTTP ${res.status})` }, { status: res.status });

  let json: unknown;
  try {
    json = await res.json();
  } catch {
    return Response.json({ error: '데이터 파싱 실패' }, { status: 502 });
  }

  const result = (json as { chart?: { result?: unknown[]; error?: unknown } }).chart?.result?.[0] as {
    meta?: { regularMarketPrice?: number; previousClose?: number };
    timestamp?: number[];
    indicators?: {
      quote?: { open?: number[]; high?: number[]; low?: number[]; close?: number[]; volume?: number[] }[];
      adjclose?: { adjclose?: number[] }[];
    };
  } | undefined;

  if (!result || !result.timestamp) {
    return Response.json({ error: `'${ticker}' 데이터를 찾을 수 없습니다.` }, { status: 404 });
  }

  const timestamps = result.timestamp;
  const quote = result.indicators?.quote?.[0] ?? {};
  const adjClose = result.indicators?.adjclose?.[0]?.adjclose ?? quote.close ?? [];

  const rawDates = timestamps.map((ts) => new Date(ts * 1000).toISOString().slice(0, 10));
  const rawPrices = cleanArray(adjClose as (number | null)[]);
  const rawHighs = cleanArray((quote.high ?? []) as (number | null)[]);
  const rawLows = cleanArray((quote.low ?? []) as (number | null)[]);
  const rawVolumes = cleanArray((quote.volume ?? []) as (number | null)[]);

  // 2022-01-01 이후 필터링
  const START_DATE = '2022-01-01';
  const startIdx = rawDates.findIndex((d) => d >= START_DATE);
  const idx = startIdx >= 0 ? startIdx : 0;

  let dates = rawDates.slice(idx);
  let prices = rawPrices.slice(idx);
  let highs = rawHighs.slice(idx);
  let lows = rawLows.slice(idx);
  let volumes = rawVolumes.slice(idx);

  if (dates.length === 0) {
    return Response.json({ error: '2022년 이후 데이터가 없습니다.' }, { status: 404 });
  }

  // trailing 0 제거: Yahoo Finance가 당일 미완성 데이터를 null(→0)로 반환하는 경우 방지
  let tail = prices.length - 1;
  while (tail > 0 && prices[tail] === 0) tail--;
  if (tail < prices.length - 1) {
    dates = dates.slice(0, tail + 1);
    prices = prices.slice(0, tail + 1);
    highs = highs.slice(0, tail + 1);
    lows = lows.slice(0, tail + 1);
    volumes = volumes.slice(0, tail + 1);
  }

  const currentPrice = result.meta?.regularMarketPrice ?? prices[prices.length - 1] ?? 0;
  const prevClose = result.meta?.previousClose ?? prices[prices.length - 2] ?? currentPrice;

  const data: OhlcvResponse = { ticker, dates, prices, highs, lows, volumes, currentPrice, prevClose };

  cache.set(ticker, { data, ts: Date.now() });

  return Response.json(data);
}
