import { NextRequest, NextResponse } from "next/server";

const KIS_BASE = "https://openapi.koreainvestment.com:9443";

let tokenCache: { token: string; expiresAt: number } | null = null;

async function getToken(): Promise<string> {
  if (tokenCache && tokenCache.expiresAt > Date.now()) return tokenCache.token;

  const res = await fetch(`${KIS_BASE}/oauth2/tokenP`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      grant_type: "client_credentials",
      appkey: process.env.KIS_APP_KEY,
      appsecret: process.env.KIS_APP_SECRET,
    }),
    cache: "no-store",
  });

  const data = await res.json();
  if (!data.access_token) {
    throw new Error(`KIS 토큰 발급 실패: ${JSON.stringify(data).slice(0, 300)}`);
  }
  tokenCache = {
    token: data.access_token,
    expiresAt: Date.now() + ((data.expires_in ?? 86400) - 300) * 1000,
  };
  return tokenCache.token;
}

const dataCache = new Map<string, { data: unknown; ts: number }>();
const CACHE_TTL = 30 * 60 * 1000; // 30분

function getCached(key: string) {
  const e = dataCache.get(key);
  if (e && Date.now() - e.ts < CACHE_TTL) return e.data;
  return null;
}
function setCache(key: string, data: unknown) {
  dataCache.set(key, { data, ts: Date.now() });
}

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

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const type = sp.get("type") ?? "investor";
  const ticker = sp.get("ticker") ?? "069500";
  const market = sp.get("market") ?? "J";
  const nocache = sp.get("nocache") === "1";

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
    setCache(cacheKey, data);
    return NextResponse.json(data);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[supply-demand]", msg);
    return NextResponse.json({ rt_cd: "E", msg1: msg }, { status: 500 });
  }
}
