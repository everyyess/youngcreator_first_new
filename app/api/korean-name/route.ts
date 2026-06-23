import { NextRequest, NextResponse } from "next/server";

const cache = new Map<string, { name: string; ts: number }>();
const TTL = 24 * 60 * 60 * 1000;
const HEADERS = { "User-Agent": "Mozilla/5.0" };

// 네이버 자동완성 API — 국내·해외 모두 한국어명 반환
async function naverAutoComplete(query: string): Promise<string | null> {
  const res = await fetch(
    `https://ac.stock.naver.com/ac?q=${encodeURIComponent(query)}&target=stock`,
    { headers: HEADERS, signal: AbortSignal.timeout(5_000) }
  );
  if (!res.ok) return null;
  const data = (await res.json()) as { items?: { code: string; name: string }[] };
  const items = data.items ?? [];
  const exact = items.find(i => i.code.toUpperCase() === query.toUpperCase());
  return (exact ?? items[0])?.name ?? null;
}

export async function GET(req: NextRequest) {
  const ticker = req.nextUrl.searchParams.get("ticker")?.trim();
  if (!ticker) return NextResponse.json({ error: "ticker required" }, { status: 400 });

  const hit = cache.get(ticker);
  if (hit && Date.now() - hit.ts < TTL) return NextResponse.json({ name: hit.name });

  const isKorean = /\.(KS|KQ)$/i.test(ticker);

  // ── 국내주식: 네이버 금융 모바일 API (가장 정확한 한국어 정식명) ──────────
  if (isKorean) {
    const code = ticker.replace(/\.(KS|KQ)$/i, "");
    try {
      const res = await fetch(
        `https://m.stock.naver.com/api/stock/${code}/basic`,
        { headers: HEADERS, signal: AbortSignal.timeout(5_000) }
      );
      if (res.ok) {
        const data = (await res.json()) as { stockName?: string; corporateName?: string };
        const name = data.stockName ?? data.corporateName ?? "";
        if (name) {
          cache.set(ticker, { name, ts: Date.now() });
          return NextResponse.json({ name });
        }
      }
    } catch { /* 폴백 */ }
  }

  // ── 국내 폴백·해외 공통: 네이버 자동완성 ────────────────────────────────
  const searchQuery = isKorean ? ticker.replace(/\.(KS|KQ)$/i, "") : ticker;
  try {
    const name = await naverAutoComplete(searchQuery);
    if (name) {
      cache.set(ticker, { name, ts: Date.now() });
      return NextResponse.json({ name });
    }
  } catch { /* 폴백 */ }

  // ── 최종 폴백: 티커 그대로 반환 ─────────────────────────────────────────
  return NextResponse.json({ name: ticker });
}
