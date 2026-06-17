import { NextRequest, NextResponse } from "next/server";

const KIS_BASE = "https://openapi.kis.or.kr";

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
const CACHE_TTL = 30 * 60 * 1000;

function getCached(key: string) {
  const e = dataCache.get(key);
  if (e && Date.now() - e.ts < CACHE_TTL) return e.data;
  return null;
}
function setCache(key: string, data: unknown) {
  dataCache.set(key, { data, ts: Date.now() });
}

function kisHeaders(token: string, trId: string) {
  return {
    Authorization: `Bearer ${token}`,
    appkey: process.env.KIS_APP_KEY!,
    appsecret: process.env.KIS_APP_SECRET!,
    tr_id: trId,
    custtype: "P",
    "Content-Type": "application/json; charset=utf-8",
  };
}

// 시장 전체 투자자 일별 매매 현황 — TR: FHKST03030100
async function fetchMarketTrend(token: string, market: string) {
  const params = new URLSearchParams({
    FID_COND_MRKT_DIV_CODE: market === "KOSDAQ" ? "Q" : "J",
    FID_COND_SCR_DIV_CODE: "16197",
    FID_INPUT_ISCD: market === "KOSDAQ" ? "1001" : "0001",
    FID_DIV_CLS_CODE: "0",
    FID_BLNG_CLS_CODE: "0",
    FID_TRGT_CLS_CODE: "",
    FID_TRGT_EXLS_CLS_CODE: "",
    FID_INPUT_PRICE_1: "",
    FID_INPUT_PRICE_2: "",
    FID_VOL_CNT: "",
    FID_INPUT_DATE_1: "",
  });
  const res = await fetch(
    `${KIS_BASE}/uapi/domestic-stock/v1/quotations/foreign-institution-total?${params}`,
    { headers: kisHeaders(token, "FHKST03030100"), cache: "no-store" }
  );
  return await res.json();
}

// 투자자별 순매수/순매도 상위 종목 순위 — TR: FHPST02320000
async function fetchInvestorRanking(
  token: string,
  market: string,
  investorType: string,
  direction: string
) {
  // FID_BLNG_CLS_CODE: 1=개인, 2=외국인, 3=기관계, 4=금융투자, 5=보험, ...
  const blngMap: Record<string, string> = {
    individual: "1",
    foreign: "2",
    institution: "3",
  };
  const params = new URLSearchParams({
    FID_COND_MRKT_DIV_CODE: market === "KOSDAQ" ? "Q" : "J",
    FID_COND_SCR_DIV_CODE: "20132",
    FID_INPUT_ISCD: "0000",
    FID_DIV_CLS_CODE: direction === "sell" ? "1" : "0",
    FID_BLNG_CLS_CODE: blngMap[investorType] ?? "2",
    FID_TRGT_CLS_CODE: "111111111",
    FID_TRGT_EXLS_CLS_CODE: "000000000",
    FID_INPUT_PRICE_1: "",
    FID_INPUT_PRICE_2: "",
    FID_VOL_CNT: "",
    FID_INPUT_DATE_1: "",
  });
  const res = await fetch(
    `${KIS_BASE}/uapi/domestic-stock/v1/ranking/investor-trend-estimate?${params}`,
    { headers: kisHeaders(token, "FHPST02320000"), cache: "no-store" }
  );
  return await res.json();
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const type = sp.get("type") ?? "ranking";
  const market = sp.get("market") ?? "KOSPI";
  const investor = sp.get("investor") ?? "foreign";
  const direction = sp.get("direction") ?? "buy";
  const nocache = sp.get("nocache") === "1";

  const cacheKey = `${type}-${market}-${investor}-${direction}`;
  if (!nocache) {
    const cached = getCached(cacheKey);
    if (cached) return NextResponse.json({ ...(cached as object), _cached: true });
  }

  try {
    const token = await getToken();
    const data =
      type === "market"
        ? await fetchMarketTrend(token, market)
        : await fetchInvestorRanking(token, market, investor, direction);

    setCache(cacheKey, data);
    return NextResponse.json(data);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[supply-demand]", msg);
    return NextResponse.json({ rt_cd: "E", msg1: msg }, { status: 500 });
  }
}
