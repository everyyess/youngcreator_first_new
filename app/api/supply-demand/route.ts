import { NextRequest, NextResponse } from "next/server";
import { unstable_cache } from "next/cache";

const KIS_BASE = "https://openapi.koreainvestment.com:9443";

// ── Token cache (Vercel Data Cache로 인스턴스 간 공유) ─────────────────────
// 로컬: 인-메모리 캐시로도 충분하지만 Vercel 서버리스는 인스턴스마다 메모리가 분리됨.
// unstable_cache는 Vercel Data Cache(분산)에 저장되어 모든 인스턴스가 동일 토큰을 사용.
// KIS는 앱키당 토큰 1개만 유효 → 인스턴스마다 새 토큰을 발급하면 이전 토큰이 무효화됨.

const _fetchToken = unstable_cache(
  async (): Promise<string> => {
    const res = await fetch(`${KIS_BASE}/oauth2/tokenP`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        grant_type: "client_credentials",
        appkey: process.env.KIS_APP_KEY,
        appsecret: process.env.KIS_APP_SECRET,
      }),
    });
    const data = await res.json();
    if (!data.access_token) {
      throw new Error(`KIS 토큰 발급 실패: ${JSON.stringify(data).slice(0, 200)}`);
    }
    return data.access_token as string;
  },
  ["kis-access-token"],
  { revalidate: 82800 },  // 23시간 — KIS 토큰 유효기간 24시간보다 1시간 여유
);

async function getToken(): Promise<string> {
  return _fetchToken();
}

// ── Data cache ─────────────────────────────────────────────────────────────

const dataCache = new Map<string, { data: unknown; ts: number }>();
const CACHE_TTL = 30 * 60 * 1000;

function getCached(key: string) {
  const e = dataCache.get(key);
  return e && Date.now() - e.ts < CACHE_TTL ? e.data : null;
}
function setCache(key: string, data: unknown) {
  dataCache.set(key, { data, ts: Date.now() });
}

// ── KIS fetchers ───────────────────────────────────────────────────────────

// 종목별 투자자 일별 동향 — TR: FHKST01010900
async function fetchStockInvestor(token: string, ticker: string, market = "J") {
  const res = await fetch(
    `${KIS_BASE}/uapi/domestic-stock/v1/quotations/inquire-investor?fid_cond_mrkt_div_code=${market}&fid_input_iscd=${ticker}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        appkey: process.env.KIS_APP_KEY!,
        appsecret: process.env.KIS_APP_SECRET!,
        tr_id: "FHKST01010900",
        custtype: "P",
        "Content-Type": "application/json; charset=utf-8",
      },
      cache: "no-store",
    }
  );
  return await res.json();
}

// 종목 현재가 — TR: FHKST01010100
async function fetchStockPrice(token: string, ticker: string, market = "J") {
  const res = await fetch(
    `${KIS_BASE}/uapi/domestic-stock/v1/quotations/inquire-price?fid_cond_mrkt_div_code=${market}&fid_input_iscd=${ticker}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        appkey: process.env.KIS_APP_KEY!,
        appsecret: process.env.KIS_APP_SECRET!,
        tr_id: "FHKST01010100",
        custtype: "P",
        "Content-Type": "application/json; charset=utf-8",
      },
      cache: "no-store",
    }
  );
  return await res.json();
}

// Yahoo Finance — 시총 조회 (yfinance가 내부적으로 사용하는 API)
async function fetchYahooMarketCaps(tickers: string[], suffix: string) {
  const symbols = tickers.map((t) => `${t}${suffix}`).join(",");
  const url = `https://query2.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(symbols)}&fields=symbol,marketCap`;
  const res = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/125.0.0.0 Safari/537.36",
      "Accept": "application/json",
    },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Yahoo Finance HTTP ${res.status}`);
  const data = await res.json();
  return (data.quoteResponse?.result ?? []) as { symbol: string; marketCap?: number }[];
}

// ── Route ──────────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const type    = sp.get("type")    ?? "investor";
  const ticker  = sp.get("ticker")  ?? "069500";
  const market  = sp.get("market")  ?? "J";
  const nocache = sp.get("nocache") === "1";

  // type=marketcap: Yahoo Finance로 시총 순위 조회
  if (type === "marketcap") {
    const tickers = (sp.get("tickers") ?? "").split(",").filter(Boolean);
    const suffix  = sp.get("suffix") ?? ".KS";
    const ck = `marketcap-${tickers.join("-")}-${suffix}`;
    if (!nocache) {
      const cached = getCached(ck);
      if (cached) return NextResponse.json({ ...(cached as object), _cached: true });
    }
    try {
      const results = await fetchYahooMarketCaps(tickers, suffix);
      // 시총 내림차순 정렬 후 ticker만 추출 (suffix 제거)
      const ranked = results
        .filter((r) => r.marketCap != null && r.marketCap > 0)
        .sort((a, b) => (b.marketCap ?? 0) - (a.marketCap ?? 0))
        .map((r) => ({ ticker: r.symbol.replace(suffix, ""), marketCap: r.marketCap ?? 0 }));
      const payload = { ranked };
      setCache(ck, payload);
      return NextResponse.json(payload);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[supply-demand/marketcap]", msg);
      return NextResponse.json({ ranked: [], error: msg });
    }
  }

  const cacheKey = `${type}-${ticker}-${market}`;
  if (!nocache) {
    const cached = getCached(cacheKey);
    if (cached) return NextResponse.json({ ...(cached as object), _cached: true });
  }

  try {
    const token = await getToken();
    let data;
    if (type === "price") {
      data = await fetchStockPrice(token, ticker, market);
    } else {
      data = await fetchStockInvestor(token, ticker, market);
    }
    // 성공 응답만 캐시 (레이트리밋/오류 응답은 캐시 금지)
    const d = data as Record<string, unknown>;
    if (!d.rt_cd || d.rt_cd === "0") setCache(cacheKey, data);
    return NextResponse.json(data);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[supply-demand]", msg);
    return NextResponse.json({ rt_cd: "E", msg1: msg }, { status: 500 });
  }
}
