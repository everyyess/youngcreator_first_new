/**
 * /api/price
 * GET: ?ticker=TSLA  또는  ?ticker=KRW%3DX
 * Yahoo Finance v8 chart meta에서 regularMarketPrice만 추출해 반환.
 * proxy-finance와 달리 시계열 없이 최근 7일 일봉만 요청 → 응답 경량화.
 */

export const runtime = 'nodejs';

const BROWSER_HEADERS = {
  'User-Agent':      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept':          'application/json, text/plain, */*',
  'Accept-Language': 'en-US,en;q=0.9',
  'Referer':         'https://finance.yahoo.com/',
};

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const ticker = searchParams.get('ticker')?.trim();

  if (!ticker) {
    return Response.json({ error: '티커를 입력해주세요.' }, { status: 400 });
  }

  const now  = Math.floor(Date.now() / 1000);
  const from = now - 7 * 24 * 3600;
  const url  =
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}` +
    `?period1=${from}&period2=${now}&interval=1d`;

  let res;
  try {
    const controller = new AbortController();
    const tid = setTimeout(() => controller.abort(), 6_000);
    res = await fetch(url, { headers: BROWSER_HEADERS, signal: controller.signal });
    clearTimeout(tid);
  } catch {
    return Response.json({ error: '시세 조회 시간 초과' }, { status: 504 });
  }

  if (!res.ok) {
    return Response.json({ error: `Yahoo Finance HTTP ${res.status}`, ticker }, { status: 502 });
  }

  let json;
  try { json = await res.json(); } catch {
    return Response.json({ error: '응답 파싱 실패', ticker }, { status: 502 });
  }

  const meta = json?.chart?.result?.[0]?.meta;
  if (!meta) {
    return Response.json({ error: '시세 데이터 없음', ticker }, { status: 404 });
  }

  return Response.json({
    ticker,
    regularMarketPrice: meta.regularMarketPrice ?? null,
    currency:           meta.currency           ?? null,
  });
}
