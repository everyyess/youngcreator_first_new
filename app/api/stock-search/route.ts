import { NextRequest, NextResponse } from "next/server";

const HEADERS = { "User-Agent": "Mozilla/5.0" };

const marketCache = new Map<string, { suffix: string; ts: number }>();
const CACHE_TTL = 24 * 60 * 60 * 1000;

export interface StockSearchItem {
  code: string;
  name: string;
  ticker: string;
  market: "domestic" | "overseas";
}

async function resolveKoreanSuffix(code: string): Promise<string> {
  const hit = marketCache.get(code);
  if (hit && Date.now() - hit.ts < CACHE_TTL) return hit.suffix;

  try {
    const res = await fetch(
      `https://m.stock.naver.com/api/stock/${code}/basic`,
      { headers: HEADERS, signal: AbortSignal.timeout(4000) }
    );
    if (res.ok) {
      const data = (await res.json()) as {
        stockExchangeType?: { code?: string };
      };
      const mktCode = data.stockExchangeType?.code ?? "";
      const suffix = mktCode.includes("KOSDAQ") ? ".KQ" : ".KS";
      marketCache.set(code, { suffix, ts: Date.now() });
      return suffix;
    }
  } catch { /* fallback */ }

  marketCache.set(code, { suffix: ".KS", ts: Date.now() });
  return ".KS";
}

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("q")?.trim() ?? "";
  if (!q) return NextResponse.json({ items: [] });

  try {
    const res = await fetch(
      `https://ac.stock.naver.com/ac?q=${encodeURIComponent(q)}&target=stock`,
      { headers: HEADERS, signal: AbortSignal.timeout(5000) }
    );
    if (!res.ok) return NextResponse.json({ items: [] });

    const raw = (await res.json()) as { items?: { code: string; name: string }[] };
    const rawItems = (raw.items ?? []).slice(0, 6);

    const results: StockSearchItem[] = await Promise.all(
      rawItems.map(async (item) => {
        const isDomestic = /^\d{6}$/.test(item.code);
        if (isDomestic) {
          const suffix = await resolveKoreanSuffix(item.code);
          return {
            code: item.code,
            name: item.name,
            ticker: `${item.code}${suffix}`,
            market: "domestic" as const,
          };
        }
        return {
          code: item.code,
          name: item.name,
          ticker: item.code,
          market: "overseas" as const,
        };
      })
    );

    return NextResponse.json({ items: results });
  } catch (e) {
    return NextResponse.json({ error: String(e), items: [] });
  }
}
