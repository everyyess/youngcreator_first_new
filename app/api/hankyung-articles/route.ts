import { isEconomicNews, rssNewsText } from "@/lib/economicNewsFilter";
import { NextRequest, NextResponse } from "next/server";
import { getInsightSupabase, insightDbUnavailable } from "@/lib/supabaseInsightDb";
import { safeRemoteFetch } from "@/lib/safeRemoteFetch";

type CategoryId = "economy" | "financial" | "opinion" | "international" | "realestate";

export type HankyungArticle = {
  title: string;
  url: string;
  category: CategoryId | "search";
  time: string;
  published_date: string | null;
  premium?: boolean;
  ts?: number | null;
};

type ArticleList = Record<CategoryId, HankyungArticle[]>;

const feeds: ReadonlyArray<readonly [CategoryId, string]> = [
  ["economy", "https://www.hankyung.com/feed/economy"],
  ["financial", "https://www.hankyung.com/feed/financial-market"],
  ["opinion", "https://www.hankyung.com/feed/opinion"],
  ["international", "https://www.hankyung.com/feed/international"],
  ["realestate", "https://www.hankyung.com/feed/realestate"],
];

const decode = (value: string) =>
  value
    .replace(/<!\[CDATA\[|\]\]>/g, "")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .trim();

export async function GET(req: NextRequest) {
  if (!getInsightSupabase(req)) {
    return NextResponse.json(insightDbUnavailable(), { status: 401 });
  }

  const category = req.nextUrl.searchParams.get("category");
  const selected = category
    ? feeds.filter(([id]) => id === category)
    : feeds;
  const articles: ArticleList = {
    economy: [],
    financial: [],
    opinion: [],
    international: [],
    realestate: [],
  };

  await Promise.all(
    selected.map(async ([id, url]) => {
      try {
        const response = await safeRemoteFetch(url, {
          signal: AbortSignal.timeout(10_000),
          headers: { "User-Agent": "Mozilla/5.0" },
        });
        if (!response.ok) return;

        const xml = await response.text();
        for (const match of xml.matchAll(/<item[^>]*>([\s\S]*?)<\/item>/gi)) {
          const item = match[1];
          const title = decode(item.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "");
          const link = decode(item.match(/<link[^>]*>([\s\S]*?)<\/link>/i)?.[1] ?? "");
          const published = decode(
            item.match(/<pubDate[^>]*>([\s\S]*?)<\/pubDate>/i)?.[1] ?? "",
          );
          const date = new Date(published);
          if (!title || !link) continue;
          const description = rssNewsText(item, "description") || rssNewsText(item, "content:encoded");
          if (!isEconomicNews({ title, description })) continue;

          articles[id].push({
            title,
            url: link,
            category: id,
            time: Number.isNaN(date.getTime())
              ? ""
              : date.toLocaleTimeString("ko-KR", {
                  timeZone: "Asia/Seoul",
                  hour: "2-digit",
                  minute: "2-digit",
                  hour12: false,
                }),
            published_date: Number.isNaN(date.getTime())
              ? null
              : date.toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" }),
            ts: Number.isNaN(date.getTime()) ? null : date.getTime(),
          });
        }
        articles[id].sort((a, b) => (b.ts ?? 0) - (a.ts ?? 0));
        articles[id] = articles[id].slice(0, 40);
      } catch {
        articles[id] = [];
      }
    }),
  );

  return NextResponse.json({ articles });
}
