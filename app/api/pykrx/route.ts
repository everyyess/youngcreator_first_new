import { NextRequest, NextResponse } from "next/server";

// ── Cache ─────────────────────────────────────────────────────────────────

const cache = new Map<string, { data: unknown; ts: number }>();
const CACHE_TTL = 30 * 60 * 1000;

function getCached(key: string) {
  const e = cache.get(key);
  return e && Date.now() - e.ts < CACHE_TTL ? e.data : null;
}
function setCache(key: string, data: unknown) {
  cache.set(key, { data, ts: Date.now() });
}

// ── KRX constants ──────────────────────────────────────────────────────────

const MARKET_ID: Record<string, string> = { KOSPI: "STK", KOSDAQ: "KSQ" };

// pykrx 호환 투자자 코드 (MDCSTAT02203 기준)
const INVESTOR_CODE: Record<string, string> = {
  "외국인":  "2",
  "개인":    "1",
  "기관합계": "9000",
  "금융투자": "1000",
  "보험":    "2000",
  "투신":    "3000",
  "사모":    "4000",
  "은행":    "5000",
  "기타금융": "6000",
  "연기금":  "7000",
  "기타법인": "8000",
};

function recentTradingDate(): string {
  const kst = new Date(Date.now() + 9 * 3600 * 1000);
  let d = new Date(Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth(), kst.getUTCDate()));
  if (kst.getUTCHours() < 16) d.setUTCDate(d.getUTCDate() - 1);
  while (d.getUTCDay() === 0 || d.getUTCDay() === 6) d.setUTCDate(d.getUTCDate() - 1);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}${m}${day}`;
}

// ── KRX 데이터 조회 ────────────────────────────────────────────────────────

type KrxRow = { ticker: string; name: string; net_qty: number; net_amt: number };

function parseKrxRows(rows: Record<string, string>[]): KrxRow[] {
  return rows
    .map((r) => ({
      // ISU_SRT_CD = 6자리 단축코드, ISU_CD = 전체 표준코드(KR7...)
      ticker:  (r.ISU_SRT_CD ?? "").trim() || (r.ISU_CD ?? "").trim().slice(-6),
      name:    (r.ISU_ABBRV ?? r.ISU_NM ?? "").trim(),
      net_qty: parseInt((r.NETBID_TRDVOL ?? "0").replace(/,/g, ""), 10) || 0,
      net_amt: parseInt((r.NETBID_TRDVAL ?? "0").replace(/,/g, ""), 10) || 0,
    }))
    .filter((r) => /^\d{6}$/.test(r.ticker) && r.name.length > 0);
}

async function fetchKrxNetPurchases(market: string, investor: string, date: string): Promise<KrxRow[]> {
  const mktId     = MARKET_ID[market] ?? "STK";
  const invstTpCd = INVESTOR_CODE[investor] ?? "2";
  const bldParams = {
    bld:       "dbms/MDC/STAT/standard/MDCSTAT02203",
    trdDd:     date,
    mktId,
    invstTpCd,
  };

  const authKey = process.env.KRX_AUTH_KEY;

  // ① KRX OpenAPI (인증키 있을 때 우선 사용)
  if (authKey) {
    try {
      const otpRes = await fetch("https://openapi.krx.co.kr/contents/COM/GenerateOTP.cmd", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          auth:    authKey,
          baseUrl: "http://openapi.krx.co.kr/contents/COM/GetJsonData.cmd",
          ...bldParams,
        }).toString(),
      });
      const otp = (await otpRes.text()).trim();

      const dataRes = await fetch("http://openapi.krx.co.kr/contents/COM/GetJsonData.cmd", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ code: otp }).toString(),
      });
      const json = await dataRes.json() as Record<string, unknown>;
      const rows = ((json.output ?? json.OutBlock_1 ?? []) as Record<string, string>[]);
      const parsed = parseKrxRows(rows);
      if (parsed.length > 0) return parsed;
    } catch {
      // OpenAPI 실패 시 공개 포털로 폴백
    }
  }

  // ② 공개 KRX 데이터 포털 (OTP 2-step 방식)
  const otpRes = await fetch("https://data.krx.co.kr/contents/COM/GenerateOTP.cmd", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      "Referer":    "https://data.krx.co.kr",
    },
    body: new URLSearchParams(bldParams).toString(),
  });
  const otp = (await otpRes.text()).trim();
  if (!otp) throw new Error("KRX OTP 발급 실패");

  const dataRes = await fetch("https://data.krx.co.kr/comm/bldAttendant/getJsonData.cmd", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      "Referer":    "https://data.krx.co.kr",
    },
    body: new URLSearchParams({ code: otp }).toString(),
  });
  if (!dataRes.ok) throw new Error(`KRX 서버 오류: ${dataRes.status}`);

  const json = await dataRes.json() as { OutBlock_1?: Record<string, string>[] };
  return parseKrxRows(json.OutBlock_1 ?? []);
}

// ── Route ──────────────────────────────────────────────────────────────────

type Row    = KrxRow;
type Result = { ok: boolean; date: string; buy_top?: Row[]; sell_top?: Row[]; error?: string };

export async function GET(req: NextRequest) {
  const sp       = req.nextUrl.searchParams;
  const type     = sp.get("type")     ?? "ranking";
  const market   = sp.get("market")   ?? "KOSPI";
  const investor = sp.get("investor") ?? "외국인";
  const topN     = parseInt(sp.get("top_n") ?? "10");
  const nocache  = sp.get("nocache") === "1";
  const smart    = sp.get("smart")   === "1";

  const date = recentTradingDate();

  // type=orgsubtype: 세부 기관별 종목 순매수 tickerMap 반환 (시총상위 탭용)
  if (type === "orgsubtype") {
    const ck = `orgsubtype-${market}-${investor}`;
    if (!nocache) {
      const cached = getCached(ck);
      if (cached) return NextResponse.json({ ...(cached as object), _cached: true });
    }
    try {
      const rows = await fetchKrxNetPurchases(market, investor, date);
      const tickerMap: Record<string, { net_amt: number; net_qty: number }> = {};
      for (const r of rows) tickerMap[r.ticker] = { net_amt: r.net_amt, net_qty: r.net_qty };
      const payload = { ok: true, tickerMap };
      setCache(ck, payload);
      return NextResponse.json(payload);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return NextResponse.json({ ok: false, error: msg, tickerMap: {} });
    }
  }

  const cacheKey = smart ? `smart-${market}-${topN}` : `${market}-${investor}-${topN}`;
  if (!nocache) {
    const cached = getCached(cacheKey);
    if (cached) return NextResponse.json({ ...(cached as object), _cached: true });
  }

  try {
    if (smart) {
      const [frgnRows, orgnRows] = await Promise.all([
        fetchKrxNetPurchases(market, "외국인",  date),
        fetchKrxNetPurchases(market, "기관합계", date),
      ]);
      const frgnMap = new Map(frgnRows.map((r) => [r.ticker, r.net_amt]));
      const smartList = orgnRows
        .filter((r) => r.net_amt > 0 && (frgnMap.get(r.ticker) ?? 0) > 0)
        .sort((a, b) => b.net_amt - a.net_amt)
        .slice(0, topN)
        .map((r) => ({ ...r, frgn_amt: frgnMap.get(r.ticker) ?? 0, orgn_amt: r.net_amt }));
      const result = { ok: true, date, market, data: smartList };
      setCache(cacheKey, result);
      return NextResponse.json(result);
    }

    const rows = await fetchKrxNetPurchases(market, investor, date);
    const byDesc = [...rows].sort((a, b) => b.net_amt - a.net_amt);
    const byAsc  = [...rows].sort((a, b) => a.net_amt - b.net_amt);
    const result: Result & { market: string; investor: string; count: number } = {
      ok:       true,
      date,
      market,
      investor,
      count:    rows.length,
      buy_top:  byDesc.slice(0, topN),
      sell_top: byAsc.slice(0, topN),
    };
    setCache(cacheKey, result);
    return NextResponse.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[pykrx]", msg);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
