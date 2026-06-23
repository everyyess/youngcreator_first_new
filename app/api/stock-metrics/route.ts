/**
 * /api/stock-metrics  GET ?ticker=X
 * Yahoo Finance quoteSummary 4모듈 통합 조회 + crumb 인증.
 * financialData, summaryDetail, defaultKeyStatistics, price 모듈 교차 보완.
 * KRX 종목(.KS/.KQ) 부분 누락 시 dataNote='krx-partial' 마킹.
 */

export const runtime = 'nodejs';

export interface StockMetricsResult {
  price: number | null;
  per: number | null;
  pbr: number | null;  // Price-to-Book Ratio
  psr: number | null;  // Price-to-Sales Ratio (TTM)
  ebitda: number | null;
  revenue: number | null;
  currency: string;
  dataNote?: string; // 'krx-partial': KRX 공시 부분 누락
}

const BROWSER_HEADERS: Record<string, string> = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  Accept: 'application/json, text/plain, */*',
  'Accept-Language': 'en-US,en;q=0.9',
  Referer: 'https://finance.yahoo.com/',
  Origin: 'https://finance.yahoo.com',
};

// ── Yahoo Finance Crumb 인증 (v10 quoteSummary 401 대응) ─────────────────────

interface YahooCrumb { crumb: string; cookie: string; ts: number; }
let crumbCache: YahooCrumb | null = null;
const CRUMB_TTL_MS = 50 * 60 * 1000;

async function getYahooCrumb(): Promise<YahooCrumb | null> {
  if (crumbCache && Date.now() - crumbCache.ts < CRUMB_TTL_MS) return crumbCache;
  try {
    const r1 = await fetch(
      'https://guce.yahoo.com/consent?brandType=nonEu&gcrumb=test&country=US',
      {
        headers: {
          'User-Agent': BROWSER_HEADERS['User-Agent'],
          Accept: 'text/html,application/xhtml+xml',
          'Accept-Language': 'en-US,en;q=0.9',
        },
        redirect: 'follow',
      },
    );
    const rawCookies: string[] =
      (r1.headers as unknown as { getSetCookie?: () => string[] }).getSetCookie?.() ?? [];
    const cookieStr = rawCookies.map((c) => c.split(';')[0].trim()).filter(Boolean).join('; ');
    if (!cookieStr) return null;

    const r2 = await fetch('https://query2.finance.yahoo.com/v1/test/getcrumb', {
      headers: { ...BROWSER_HEADERS, Cookie: cookieStr },
    });
    if (!r2.ok) return null;
    const crumb = (await r2.text()).trim();
    if (!crumb || crumb.startsWith('<') || crumb.length > 30) return null;

    crumbCache = { crumb, cookie: cookieStr, ts: Date.now() };
    return crumbCache;
  } catch {
    return null;
  }
}

async function fetchWithTimeout(
  url: string,
  headers: Record<string, string>,
  ms = 9000,
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

// raw 값 추출 헬퍼 — {raw: number} 와 직접 number 모두 처리
function raw(obj: unknown, key: string): number | null {
  if (!obj || typeof obj !== 'object') return null;
  const v = (obj as Record<string, unknown>)[key];
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'object') {
    const r = ((v as Record<string, unknown>).raw) as number | undefined;
    return r !== undefined && Number.isFinite(r) ? r : null;
  }
  return null;
}

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const ticker = url.searchParams.get('ticker');
  if (!ticker) {
    return Response.json({ error: 'ticker 파라미터가 필요합니다.' }, { status: 400 });
  }

  const result: StockMetricsResult = {
    price: null, per: null, pbr: null, psr: null, ebitda: null, revenue: null, currency: 'USD',
  };

  try {
    // crumb 인증 취득 (50분 캐시) — 실패해도 인증 없이 계속 시도
    let auth: YahooCrumb | null = null;
    try { auth = await getYahooCrumb(); } catch { /* crumb 없이 진행 */ }

    const modules = 'financialData%2CsummaryDetail%2CdefaultKeyStatistics%2Cprice';
    const crumbParam = auth?.crumb ? `&crumb=${encodeURIComponent(auth.crumb)}` : '';
    const qsUrl =
      `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(ticker)}` +
      `?modules=${modules}${crumbParam}`;

    const reqHeaders: Record<string, string> = {
      ...BROWSER_HEADERS,
      ...(auth?.cookie ? { Cookie: auth.cookie } : {}),
    };

    let res = await fetchWithTimeout(qsUrl, reqHeaders, 9000);

    // 인증 만료 시 crumb 재취득 후 1회 재시도
    if ((res.status === 401 || res.status === 403) && auth) {
      crumbCache = null;
      let auth2: YahooCrumb | null = null;
      try { auth2 = await getYahooCrumb(); } catch { /* 재취득 실패 — 현재 결과 그대로 사용 */ }
      if (auth2) {
        const crumbParam2 = `&crumb=${encodeURIComponent(auth2.crumb)}`;
        const qsUrl2 =
          `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(ticker)}` +
          `?modules=${modules}${crumbParam2}`;
        res = await fetchWithTimeout(qsUrl2, { ...BROWSER_HEADERS, Cookie: auth2.cookie }, 9000);
      }
    }

    // 4xx / 5xx — 티커 불일치·ETF 전용 모듈 미지원 등 → 기본 result 반환 (크래시 방지)
    if (!res.ok) return Response.json(result);

    // JSON 파싱 실패 (malformed response) → 기본 result 반환
    let json: Record<string, unknown>;
    try {
      json = (await res.json()) as Record<string, unknown>;
    } catch {
      return Response.json(result);
    }

    const r =
      (
        (json?.quoteSummary as Record<string, unknown>)
          ?.result as Record<string, unknown>[] | undefined
      )?.[0] ?? {};

    const fd  = r.financialData         as Record<string, unknown> | undefined;
    const sd  = r.summaryDetail         as Record<string, unknown> | undefined;
    const dks = r.defaultKeyStatistics  as Record<string, unknown> | undefined;
    const pm  = r.price                 as Record<string, unknown> | undefined;

    // ── 통화 판별 (price 모듈 최우선 — KRX 신뢰도 보장) ────────────────────
    result.currency =
      (pm?.currency  as string | undefined) ??
      (sd?.currency  as string | undefined) ??
      (fd?.financialCurrency as string | undefined) ??
      'USD';

    // ── 현재가 크로스 파싱 ───────────────────────────────────────────────────
    result.price =
      raw(pm, 'regularMarketPrice') ??
      raw(fd, 'currentPrice') ??
      raw(sd, 'currentPrice') ??
      raw(sd, 'regularMarketPrice');

    // ── PER 크로스 파싱 ──────────────────────────────────────────────────────
    result.per =
      raw(sd,  'trailingPE') ??
      raw(sd,  'forwardPE')  ??
      raw(dks, 'forwardPE')  ??
      raw(dks, 'trailingPE');

    // ── PBR 크로스 파싱 ──────────────────────────────────────────────────────
    result.pbr = raw(dks, 'priceToBook') ?? raw(sd, 'priceToBook') ?? null;

    // ── PSR 크로스 파싱 (TTM) ────────────────────────────────────────────────
    result.psr =
      raw(sd,  'priceToSalesTrailing12Months') ??
      raw(dks, 'priceToSalesTrailing12Months') ??
      null;

    // ── EBITDA 크로스 파싱 — EV / (EV/EBITDA) 역산 포함 ───────────────────
    const ebitdaDirect = raw(fd, 'ebitda');
    if (ebitdaDirect !== null) {
      result.ebitda = ebitdaDirect;
    } else {
      const ev       = raw(dks, 'enterpriseValue');
      const evEbitda = raw(dks, 'enterpriseToEbitda');
      if (ev !== null && evEbitda !== null && evEbitda > 0) {
        result.ebitda = Math.round(ev / evEbitda);
      } else {
        result.ebitda = raw(dks, 'ebitda') ?? null;
      }
    }

    // ── 직전매출 크로스 파싱 — revenuePerShare × shares 역산 포함 ───────────
    const revenueDirect = raw(fd, 'totalRevenue');
    if (revenueDirect !== null) {
      result.revenue = revenueDirect;
    } else {
      const rps    = raw(dks, 'revenuePerShare');
      const shares = raw(dks, 'sharesOutstanding');
      if (rps !== null && shares !== null) {
        result.revenue = Math.round(rps * shares);
      }
    }

    // ── KRX 종목 공시 부분 누락 마킹 ────────────────────────────────────────
    const tkStr = String(ticker);
    if (
      (tkStr.endsWith('.KS') || tkStr.endsWith('.KQ')) &&
      (result.ebitda === null || result.revenue === null || result.per === null)
    ) {
      result.dataNote = 'krx-partial';
    }

  } catch {
    // 네트워크/타임아웃 — null 결과 반환
  }

  // 2티어 폴백: v10 실패·ETF 모듈 미지원(400/404) or price null → v8/chart로 보완
  // ETF 티커는 financialData 모듈이 없어 v10이 에러를 반환할 수 있음.
  // v8/chart 는 ETF 포함 모든 자산의 현재가·통화를 안정적으로 제공한다.
  if (result.price === null) {
    try {
      const chartUrl =
        `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}` +
        `?interval=1d&range=1d`;
      const chartRes = await fetchWithTimeout(chartUrl, BROWSER_HEADERS, 7000);
      if (chartRes.ok) {
        let chartJson: Record<string, unknown> = {};
        try { chartJson = (await chartRes.json()) as Record<string, unknown>; } catch { /* ignore */ }
        const meta = (
          (chartJson?.chart as Record<string, unknown>)
            ?.result as Record<string, unknown>[] | undefined
        )?.[0]?.meta as Record<string, unknown> | undefined;
        if (meta) {
          const chartPrice = meta.regularMarketPrice;
          if (typeof chartPrice === 'number' && Number.isFinite(chartPrice)) {
            result.price = chartPrice;
          }
          const chartCurrency = meta.currency;
          if (typeof chartCurrency === 'string' && chartCurrency) {
            result.currency = chartCurrency;
          }
        }
      }
    } catch {
      // v8 폴백 실패 — 기존 null 유지
    }
  }

  return Response.json(result);
}
