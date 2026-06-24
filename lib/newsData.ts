export type NewsCategory = "economy" | "industry";

export type NewsArticle = {
  title: string;
  summary: string;
  time: string;
  source: string;
  link: string;
};

const FEED_CANDIDATES: Record<NewsCategory, string[]> = {
  economy: [
    "https://www.hankyung.com/feed/economy",
    "https://www.hankyung.com/economy/feed",
    "https://www.hankyung.com/feed/all-news",
  ],
  industry: [
    "https://www.hankyung.com/feed/industry",
    "https://www.hankyung.com/industry/feed",
    "https://www.hankyung.com/feed/all-news",
  ],
};

function decodeXml(value: string) {
  return value
    .replace(/<!\[CDATA\[(.*?)\]\]>/gs, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
}

function tagValue(item: string, tag: string) {
  const match = item.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return match ? decodeXml(match[1]).replace(/<[^>]+>/g, "").trim() : "";
}

function parseRss(xml: string): NewsArticle[] {
  return Array.from(xml.matchAll(/<item[\s\S]*?<\/item>/gi))
    .slice(0, 8)
    .map((match) => {
      const item = match[0];
      const pubDate = tagValue(item, "pubDate");
      const parsedDate = pubDate ? new Date(pubDate) : null;
      return {
        title: tagValue(item, "title"),
        summary: tagValue(item, "description").slice(0, 120),
        time: parsedDate && !Number.isNaN(parsedDate.getTime())
          ? new Intl.DateTimeFormat("ko-KR", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(parsedDate)
          : "",
        source: "한국경제",
        link: tagValue(item, "link"),
      };
    })
    .filter((article) => article.title && article.link);
}

export async function fetchHankyungNews(category: NewsCategory): Promise<NewsArticle[]> {
  for (const url of FEED_CANDIDATES[category]) {
    try {
      const response = await fetch(url, { next: { revalidate: 60 * 10 } });
      if (!response.ok) continue;
      const articles = parseRss(await response.text());
      if (articles.length) return articles;
    } catch {}
  }
  return [];
}
