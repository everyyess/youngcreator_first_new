import { NextRequest, NextResponse } from "next/server";
import { unstable_cache } from "next/cache";

// ── KRX URLs ───────────────────────────────────────────────────────────────

const KRX_BASE   = "https://data.krx.co.kr";
const LOGIN_PAGE = `${KRX_BASE}/contents/MDC/COMS/client/MDCCOMS001.cmd`;
const LOGIN_JSP  = `${KRX_BASE}/contents/MDC/COMS/client/view/login.jsp?site=mdc`;
const LOGIN_URL  = `${KRX_BASE}/contents/MDC/COMS/client/MDCCOMS001D1.cmd`;
const DATA_URL   = `${KRX_BASE}/comm/bldAttendant/getJsonData.cmd`;
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

// ── KRX 상수 ──────────────────────────────────────────────────────────────

const MARKET_ID: Record<string, string> = { KOSPI: "STK", KOSDAQ: "KSQ" };

// pykrx wrap.py의 investor2invstTpCd 정확한 매핑
// bld: MDCSTAT02401 (투자자별 순매수 종목 순위)
// 기관합계: MDCSTAT02401에서 직접 지원 안 됨 → 7050(연기금등)으로 근사
const INVESTOR_CODE: Record<string, number> = {
  "기관합계": 7050,  // 연기금등(7050)으로 근사 - MDCSTAT02401에 기관합계 코드 없음
  "금융투자": 1000,
  "보험":     2000,
  "투신":     3000,
  "은행":     3100,
  "사모":     4000,
  "기타금융": 5000,
  "연기금":   6000,
  "연기금등": 7050,
  "기타법인": 7100,
  "개인":     8000,
  "외국인":   9000,
  "기타외국인": 9001,
  "전체":     9999,
};

// ── 인-메모리 데이터 캐시 ─────────────────────────────────────────────────

const cache = new Map<string, { data: unknown; ts: number }>();
const CACHE_TTL = 30 * 60 * 1000;

function getCached(key: string) {
  const e = cache.get(key);
  return e && Date.now() - e.ts < CACHE_TTL ? e.data : null;
}
function setCache(key: string, data: unknown) {
  cache.set(key, { data, ts: Date.now() });
}

// ── 쿠키 유틸 ────────────────────────────────────────────────────────────

function parseCookies(header: string | null): Map<string, string> {
  const map = new Map<string, string>();
  if (!header) return map;
  for (const part of header.split(",")) {
    const seg = part.split(";")[0].trim();
    const eq = seg.indexOf("=");
    if (eq > 0) map.set(seg.slice(0, eq).trim(), seg.slice(eq + 1).trim());
  }
  return map;
}

function mergeCookieHeaders(res: Response, existing: Map<string, string>): Map<string, string> {
  const merged = new Map(existing);
  // Node.js fetch: getSetCookie()는 배열, 없으면 get()으로 폴백
  const newCookies = typeof (res.headers as unknown as { getSetCookie?: () => string[] }).getSetCookie === "function"
    ? (res.headers as unknown as { getSetCookie: () => string[] }).getSetCookie()
    : [res.headers.get("set-cookie") ?? ""];
  for (const raw of newCookies) {
    if (!raw) continue;
    for (const [k, v] of parseCookies(raw)) merged.set(k, v);
  }
  return merged;
}

function cookieString(map: Map<string, string>): string {
  return [...map.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
}

// ── KRX 로그인 (세션 취득) ─────────────────────────────────────────────────

async function loginKrx(): Promise<string> {
  const krxId = process.env.KRX_ID;
  const krxPw = process.env.KRX_PW;
  if (!krxId || !krxPw) throw new Error("KRX_ID / KRX_PW 환경 변수 미설정");

  let cookies = new Map<string, string>();

  // 1단계: 초기 JSESSIONID 발급
  const r1 = await fetch(LOGIN_PAGE, { headers: { "User-Agent": UA }, redirect: "follow" });
  cookies = mergeCookieHeaders(r1, cookies);

  // 2단계: 로그인 JSP iframe 초기화
  const r2 = await fetch(LOGIN_JSP, {
    headers: { "User-Agent": UA, "Referer": LOGIN_PAGE, "Cookie": cookieString(cookies) },
    redirect: "follow",
  });
  cookies = mergeCookieHeaders(r2, cookies);

  // 3단계: 로그인 POST
  const loginPayload = new URLSearchParams({
    mbrNm: "", telNo: "", di: "", certType: "",
    mbrId: krxId, pw: krxPw,
  });

  const doLogin = async (extraPayload?: string) => {
    const body = extraPayload ? `${loginPayload.toString()}&${extraPayload}` : loginPayload.toString();
    const res = await fetch(LOGIN_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": UA,
        "Referer": LOGIN_PAGE,
        "Cookie": cookieString(cookies),
      },
      body,
    });
    cookies = mergeCookieHeaders(res, cookies);
    return res.json() as Promise<{ _error_code?: string; _error_message?: string }>;
  };

  let loginData = await doLogin();

  // CD011 = 중복 로그인 → skipDup=Y 재전송
  if (loginData._error_code === "CD011") {
    loginData = await doLogin("skipDup=Y");
  }

  if (loginData._error_code !== "CD001") {
    throw new Error(`KRX 로그인 실패 (${loginData._error_code ?? "unknown"}): ${loginData._error_message ?? ""}`);
  }

  // 4단계: 통계 페이지 워밍업 (Referer 설정)
  const r4 = await fetch(STAT_PAGE, {
    headers: { "User-Agent": UA, "Referer": LOGIN_PAGE, "Cookie": cookieString(cookies) },
    redirect: "follow",
  });
  cookies = mergeCookieHeaders(r4, cookies);

  return cookieString(cookies);
}

// Vercel Data Cache로 인스턴스 간 세션 공유 (50분 캐시, KRX 세션 1시간 유효)
const getKrxSession = unstable_cache(loginKrx, ["krx-session"], { revalidate: 3000 });

// ── 날짜 계산 ──────────────────────────────────────────────────────────────

function recentTradingDate(): string {
  const kst = new Date(Date.now() + 9 * 3600 * 1000);
  let d = new Date(Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth(), kst.getUTCDate()));
  // 16시 이전이면 하루 전 (당일 데이터 미확정)
  if (kst.getUTCHours() < 16) d.setUTCDate(d.getUTCDate() - 1);
  // 주말 건너뜀
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
      ticker:  (r.ISU_SRT_CD ?? "").replace(/\s/g, "") || (r.ISU_CD ?? "").slice(-6),
      name:    (r.ISU_ABBRV ?? r.ISU_NM ?? "").trim(),
      net_qty: parseInt((r.NETBID_TRDVOL ?? "0").replace(/,/g, ""), 10) || 0,
      net_amt: Math.round((parseInt((r.NETBID_TRDVAL ?? "0").replace(/,/g, ""), 10) || 0) / 100_000_000),
    }))
    .filter((r) => /^\d{6}$/.test(r.ticker) && r.name.length > 0);
}

async function fetchKrxNetPurchases(
  market: string,
  investor: string,
  date: string,
): Promise<KrxRow[]> {
  const mktId     = MARKET_ID[market] ?? "STK";
  const invstTpCd = INVESTOR_CODE[investor];

  if (invstTpCd == null) {
    throw new Error(`지원하지 않는 투자자 유형: ${investor}. 지원: ${Object.keys(INVESTOR_CODE).join(", ")}`);
  }

  const cookies = await getKrxSession();

  // 로그인 세션으로 직접 getJsonData.cmd 호출 (OTP 불필요)
  // pykrx Post.read() → krxs.session.post(url, headers, data) 동일 방식
  const dataRes = await fetch(DATA_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": UA,
      "Referer": "https://data.krx.co.kr/contents/MDC/MDI/outerLoader/index.cmd",
      "X-Requested-With": "XMLHttpRequest",
      "Cookie": cookies,
    },
    body: new URLSearchParams({
      bld:       "dbms/MDC/STAT/standard/MDCSTAT02401",
      strtDd:    date,
      endDd:     date,
      mktId,
      invstTpCd: String(invstTpCd),
    }).toString(),
  });

  if (!dataRes.ok) throw new Error(`KRX 데이터 조회 실패: HTTP ${dataRes.status}`);

  const json = await dataRes.json() as { output?: Record<string, string>[] };
  const rows = parseKrxRows(json.output ?? []);

  if (rows.length === 0) throw new Error("당일 수급 데이터 없음 (장 마감 16:00 이후 확정)");

  return rows;
}

// ── Route ──────────────────────────────────────────────────────────────────

type Result = { ok: boolean; date: string; buy_top?: KrxRow[]; sell_top?: KrxRow[]; error?: string };

export async function GET(req: NextRequest) {
  const sp      = req.nextUrl.searchParams;
  const type    = sp.get("type")    ?? "ranking";
  const market  = sp.get("market")  ?? "KOSPI";
  const investor = sp.get("investor") ?? "외국인";
  const topN    = parseInt(sp.get("top_n") ?? "10");
  const nocache = sp.get("nocache") === "1";
  const smart   = sp.get("smart")   === "1";
  const date    = recentTradingDate();

  // 환경변수 체크
  if (!process.env.KRX_ID || !process.env.KRX_PW) {
    return NextResponse.json({ ok: false, error: "KRX_ID / KRX_PW 환경 변수 미설정" }, { status: 503 });
  }

  // ── type=orgsubtype: 시총상위 탭의 세부 기관별 tickerMap ──────────────────
  if (type === "orgsubtype") {
    const ck = `orgsubtype-${market}-${investor}-${date}`;
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

  // ── 스마트머니: 외국인·기관 동시 순매수 교집합 ───────────────────────────
  const cacheKey = smart ? `smart-${market}-${topN}-${date}` : `${market}-${investor}-${topN}-${date}`;
  if (!nocache) {
    const cached = getCached(cacheKey);
    if (cached) return NextResponse.json({ ...(cached as object), _cached: true });
  }

  try {
    if (smart) {
      const [frgnRows, orgnRows] = await Promise.all([
        fetchKrxNetPurchases(market, "외국인",  date),
        fetchKrxNetPurchases(market, "기관합계", date),  // 연기금등(7050)으로 매핑
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

    // ── 일반 투자자별 순매수/순매도 순위 ──────────────────────────────────────

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
