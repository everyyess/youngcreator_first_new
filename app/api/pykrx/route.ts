import { NextRequest, NextResponse } from "next/server";
import { exec } from "child_process";
import { promisify } from "util";
import path from "path";

const execAsync = promisify(exec);

// ── Cache ─────────────────────────────────────────────────────────────────

const cache = new Map<string, { data: unknown; ts: number }>();
const CACHE_TTL = 30 * 60 * 1000; // 30분

function getCached(key: string) {
  const e = cache.get(key);
  return e && Date.now() - e.ts < CACHE_TTL ? e.data : null;
}
function setCache(key: string, data: unknown) {
  cache.set(key, { data, ts: Date.now() });
}

// ── pykrx 실행 ─────────────────────────────────────────────────────────────

const SCRIPT = path.join(process.cwd(), "scripts", "pykrx_investor.py");

async function runPykrx(params: Record<string, unknown>): Promise<unknown> {
  // 파라미터를 환경 변수로 전달 (Windows 따옴표 호환성)
  const { stdout, stderr } = await execAsync(
    `python "${SCRIPT}"`,
    {
      timeout: 60000,
      env: {
        ...process.env,
        PYTHONIOENCODING: "utf-8",
        KRX_ID:        process.env.KRX_ID ?? "",
        KRX_PW:        process.env.KRX_PW ?? "",
        PYKRX_PARAMS:  JSON.stringify(params),
      },
    }
  );
  if (stderr && stderr.trim() && !stderr.toLowerCase().includes("krx")) {
    console.warn("[pykrx stderr]", stderr.trim().slice(0, 300));
  }
  // pykrx 로그인 메시지가 stdout에 섞이므로 마지막 JSON 라인만 추출
  const jsonLine = stdout
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.startsWith("{"))
    .pop();
  if (!jsonLine) throw new Error(`pykrx 출력 없음: ${stdout.slice(0, 200)}`);
  const parsed = JSON.parse(jsonLine);
  if (!parsed.ok) throw new Error(parsed.error ?? "pykrx 오류");
  return parsed;
}

// ── Route ──────────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const sp       = req.nextUrl.searchParams;
  const type     = sp.get("type") ?? "ranking";       // ranking | orgsubtype
  const market   = sp.get("market")   ?? "KOSPI";    // KOSPI | KOSDAQ
  const investor = sp.get("investor") ?? "외국인";   // 외국인 | 기관합계 | 개인 | 연기금 | 금융투자 | 사모 | 보험 | 투신
  const topN     = parseInt(sp.get("top_n") ?? "10");
  const nocache  = sp.get("nocache") === "1";

  // 스마트머니: 외국인+기관 동시 순매수 교집합
  const smart = sp.get("smart") === "1";

  if (!process.env.KRX_ID || !process.env.KRX_PW) {
    return NextResponse.json({ ok: false, error: "KRX_ID / KRX_PW 환경 변수 미설정" }, { status: 500 });
  }

  // type=orgsubtype: 세부 기관별 종목 순매수 조회 (시총상위 탭용)
  // ?type=orgsubtype&market=KOSPI&investor=연기금&top_n=999
  if (type === "orgsubtype") {
    const ck = `orgsubtype-${market}-${investor}`;
    if (!nocache) {
      const cached = getCached(ck);
      if (cached) return NextResponse.json({ ...(cached as object), _cached: true });
    }
    try {
      const data = await runPykrx({ market, investor, top_n: 999 }) as { buy_top?: { ticker: string; net_amt: number; net_qty: number }[] };
      // ticker → {net_amt, net_qty} 맵 형태로 반환
      const tickerMap: Record<string, { net_amt: number; net_qty: number }> = {};
      for (const r of data.buy_top ?? []) {
        tickerMap[r.ticker] = { net_amt: r.net_amt, net_qty: r.net_qty };
      }
      const payload = { ok: true, tickerMap };
      setCache(ck, payload);
      return NextResponse.json(payload);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return NextResponse.json({ ok: false, error: msg, tickerMap: {} });
    }
  }

  const cacheKey = smart
    ? `smart-${market}-${topN}`
    : `${market}-${investor}-${topN}`;

  if (!nocache) {
    const cached = getCached(cacheKey);
    if (cached) return NextResponse.json({ ...(cached as object), _cached: true });
  }

  try {
    if (smart) {
      // 외국인·기관 동시 순매수 교집합
      const [frgnRes, orgnRes] = await Promise.all([
        runPykrx({ market, investor: "외국인",  top_n: 50 }) as Promise<PykrxResult>,
        runPykrx({ market, investor: "기관합계", top_n: 50 }) as Promise<PykrxResult>,
      ]);
      const frgnTickers = new Set((frgnRes.buy_top ?? []).map((r: Row) => r.ticker));
      const smartList = (orgnRes.buy_top ?? [])
        .filter((r: Row) => frgnTickers.has(r.ticker))
        .slice(0, topN)
        .map((r: Row) => ({
          ...r,
          frgn_amt: (frgnRes.buy_top ?? []).find((f: Row) => f.ticker === r.ticker)?.net_amt ?? 0,
          orgn_amt: r.net_amt,
        }));
      const result = { ok: true, date: frgnRes.date, market, data: smartList };
      setCache(cacheKey, result);
      return NextResponse.json(result);
    }

    const data = await runPykrx({ market, investor, top_n: topN });
    setCache(cacheKey, data);
    return NextResponse.json(data);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[pykrx]", msg);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

// ── Types (내부용) ─────────────────────────────────────────────────────────

type Row = { ticker: string; name: string; net_qty: number; net_amt: number };
type PykrxResult = { ok: boolean; date: string; buy_top?: Row[]; sell_top?: Row[]; error?: string };
