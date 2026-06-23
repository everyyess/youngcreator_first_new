/**
 * /api/etf-holdings  GET ?ticker=X
 * Yahoo Finance quoteSummary를 통해 ETF/종목의
 * - 투자 전략 설명 (assetProfile.longBusinessSummary)
 * - Top 5 구성 종목 및 편입 비중 (topHoldings.holdings)
 * - 각 구성 종목의 PER / EBITDA / 직전매출 (financialData, summaryDetail)
 * 을 반환한다.
 */

export const runtime = 'nodejs';

// ── 타입 ──────────────────────────────────────────────────────────────────────

interface HoldingItem {
  name: string;
  symbol: string | null;
  weight: number;
  per: number | null;
  ebitda: number | null;
  revenue: number | null;
}

// ── 헤더 ──────────────────────────────────────────────────────────────────────

const BROWSER_HEADERS: Record<string, string> = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  Accept: 'application/json, text/plain, */*',
  'Accept-Language': 'en-US,en;q=0.9',
  Referer: 'https://finance.yahoo.com/',
  Origin: 'https://finance.yahoo.com',
};

// ── 타임아웃 Fetch ──────────────────────────────────────────────────────────

async function fetchWithTimeout(url: string, ms = 7000): Promise<Response> {
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, { headers: BROWSER_HEADERS, signal: ctrl.signal });
    clearTimeout(id);
    return res;
  } catch (err) {
    clearTimeout(id);
    throw err;
  }
}

// ── GET 핸들러 ────────────────────────────────────────────────────────────────

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const ticker = url.searchParams.get('ticker');
  if (!ticker) {
    return Response.json({ error: 'ticker 파라미터가 필요합니다.' }, { status: 400 });
  }

  let strategy: string | null = null;
  const baseHoldings: { name: string; symbol: string | null; weight: number }[] = [];

  // ── 1단계: ETF/종목 자체 quoteSummary (topHoldings + assetProfile) ────────
  try {
    const qsUrl =
      `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(ticker)}` +
      `?modules=topHoldings%2CassetProfile`;

    const res = await fetchWithTimeout(qsUrl, 8000);
    if (res.ok) {
      const json = (await res.json()) as Record<string, unknown>;
      const result = (
        (json?.quoteSummary as Record<string, unknown>)?.result as
          | Record<string, unknown>[]
          | undefined
      )?.[0] ?? {};

      // 투자 전략 설명
      const longSummary = (
        result.assetProfile as Record<string, unknown> | undefined
      )?.longBusinessSummary as string | undefined;
      if (longSummary) {
        strategy =
          longSummary.length > 300
            ? longSummary.slice(0, 300) + '…'
            : longSummary;
      }

      // 구성 종목 Top 5
      const rawHoldings = (
        (result.topHoldings as Record<string, unknown> | undefined)
          ?.holdings as Record<string, unknown>[] | undefined
      ) ?? [];
      for (const h of rawHoldings.slice(0, 5)) {
        baseHoldings.push({
          name:
            (h.holdingName as string | undefined) ??
            (h.name as string | undefined) ??
            '',
          symbol: (h.symbol as string | undefined) ?? null,
          weight:
            ((h.holdingPercent as Record<string, unknown> | undefined)
              ?.raw as number | undefined) ?? 0,
        });
      }
    }
  } catch {
    // 네트워크/타임아웃 — 빈 결과 유지
  }

  // ── 2단계: 구성 종목별 밸류에이션 병렬 조회 ────────────────────────────────
  const holdings: HoldingItem[] = baseHoldings.map((h) => ({
    ...h,
    per: null,
    ebitda: null,
    revenue: null,
  }));

  await Promise.allSettled(
    baseHoldings.map(async (h, i) => {
      if (!h.symbol) return;
      const metricsUrl =
        `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(h.symbol)}` +
        `?modules=financialData%2CsummaryDetail`;
      try {
        const res = await fetchWithTimeout(metricsUrl, 5000);
        if (!res.ok) return;
        const json = (await res.json()) as Record<string, unknown>;
        const r =
          (
            (json?.quoteSummary as Record<string, unknown>)
              ?.result as Record<string, unknown>[] | undefined
          )?.[0] ?? {};
        const fd = r.financialData as Record<string, unknown> | undefined;
        const sd = r.summaryDetail as Record<string, unknown> | undefined;
        holdings[i] = {
          ...holdings[i],
          per:
            ((sd?.trailingPE as Record<string, unknown> | undefined)
              ?.raw as number | undefined) ?? null,
          ebitda:
            ((fd?.ebitda as Record<string, unknown> | undefined)
              ?.raw as number | undefined) ?? null,
          revenue:
            ((fd?.totalRevenue as Record<string, unknown> | undefined)
              ?.raw as number | undefined) ?? null,
        };
      } catch {
        // 개별 종목 조회 실패 시 무시
      }
    }),
  );

  return Response.json({ strategy, holdings });
}
