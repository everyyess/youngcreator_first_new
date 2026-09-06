import { isEconomicNews, rssNewsText } from "@/lib/economicNewsFilter";
import { safeRemoteFetch } from "@/lib/safeRemoteFetch";

export type LiveInsightCandidate = {
  title: string;
  url: string;
  category: string;
  publishedDate: string | null;
  meta: string;
  summary?: string;
  itemName?: string;
};

type NewsCategory = "economy" | "financial" | "opinion" | "international" | "realestate";

const NEWS_FEEDS: ReadonlyArray<readonly [NewsCategory, string]> = [
  ["economy", "https://www.hankyung.com/feed/economy"],
  ["financial", "https://www.hankyung.com/feed/financial-market"],
  ["opinion", "https://www.hankyung.com/feed/opinion"],
  ["international", "https://www.hankyung.com/feed/international"],
  ["realestate", "https://www.hankyung.com/feed/realestate"],
];

const NEWS_LABEL: Record<NewsCategory, string> = {
  economy: "경제",
  financial: "금융",
  opinion: "오피니언",
  international: "국제",
  realestate: "부동산",
};

const NAVER = "https://finance.naver.com";
const REPORT_LIST_PATH = {
  company: "company_list.naver",
  industry: "industry_list.naver",
  invest: "invest_list.naver",
  economy: "economy_list.naver",
} as const;
const REPORT_LABEL: Record<keyof typeof REPORT_LIST_PATH, string> = {
  company: "종목분석",
  industry: "산업분석",
  invest: "투자정보",
  economy: "경제분석",
};
const NAVER_HEADERS = {
  "User-Agent": "Mozilla/5.0",
  "Accept-Language": "ko-KR,ko;q=0.9",
  Referer: NAVER,
};

const decodeXml = (value: string) =>
  value
    .replace(/<!\[CDATA\[|\]\]>/g, "")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&middot;|&#183;|&#xB7;/gi, "·")
    .replace(/&#39;/g, "'")
    .trim();

const stripHtml = (value: string) =>
  value
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&middot;|&#183;|&#xB7;/gi, "·")
    .replace(/&#39;/g, "'")
    .trim();

const absoluteNaverUrl = (value: string) => {
  try {
    return new URL(value, NAVER).toString();
  } catch {
    return "";
  }
};

async function loadNewsFeed(category: NewsCategory, url: string): Promise<LiveInsightCandidate[]> {
  try {
    const response = await safeRemoteFetch(url, {
      signal: AbortSignal.timeout(10_000),
      headers: { "User-Agent": "Mozilla/5.0" },
      cache: "no-store",
    });
    if (!response.ok) return [];
    const xml = await response.text();
    const items: LiveInsightCandidate[] = [];
    for (const match of xml.matchAll(/<item[^>]*>([\s\S]*?)<\/item>/gi)) {
      const item = match[1];
      const title = decodeXml(item.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "");
      const link = decodeXml(item.match(/<link[^>]*>([\s\S]*?)<\/link>/i)?.[1] ?? "");
      const published = decodeXml(item.match(/<pubDate[^>]*>([\s\S]*?)<\/pubDate>/i)?.[1] ?? "");
      const date = new Date(published);
      if (!title || !link) continue;
      const description = rssNewsText(item, "description") || rssNewsText(item, "content:encoded");
      if (!isEconomicNews({ title, description })) continue;
      items.push({
        title,
        url: link,
        category,
        publishedDate: Number.isNaN(date.getTime())
          ? null
          : date.toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" }),
        meta: NEWS_LABEL[category],
        summary: description.slice(0, 1_200),
      });
    }
    return items.slice(0, 40);
  } catch {
    return [];
  }
}

async function loadReportCategory(
  category: keyof typeof REPORT_LIST_PATH,
): Promise<LiveInsightCandidate[]> {
  try {
    const response = await safeRemoteFetch(
      `${NAVER}/research/${REPORT_LIST_PATH[category]}?page=1`,
      { headers: NAVER_HEADERS, cache: "no-store", signal: AbortSignal.timeout(10_000) },
    );
    if (!response.ok) return [];
    const html = new TextDecoder("euc-kr").decode(await response.arrayBuffer());
    const items: LiveInsightCandidate[] = [];
    for (const match of html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
      const cells = [...match[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((value) => value[1]);
      const hasItem = category === "company" || category === "industry";
      const [item, titleCell, broker, , date] = hasItem
        ? [cells[0], cells[1], cells[2], cells[3], cells[4]]
        : ["", cells[0], cells[1], cells[2], cells[3]];
      const anchor = titleCell?.match(/href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
      const dateText = stripHtml(date ?? "");
      if (!anchor || !/^\d{2}\.\d{2}\.\d{2}$/.test(dateText)) continue;
      items.push({
        title: stripHtml(anchor[2]),
        url: absoluteNaverUrl(anchor[1]),
        category,
        publishedDate: dateText,
        meta: [stripHtml(broker ?? ""), REPORT_LABEL[category]].filter(Boolean).join(" · "),
        itemName: stripHtml(item ?? ""),
      });
    }
    return items.slice(0, 20);
  } catch {
    return [];
  }
}

let cache: {
  expiresAt: number;
  news: LiveInsightCandidate[];
  reports: LiveInsightCandidate[];
} | null = null;

/** 뉴스·리포트의 현재 목록을 읽기 전용으로 수집한다. 외부 요청은 5분간 캐시한다. */
export async function loadLiveInsightSources(): Promise<{
  news: LiveInsightCandidate[];
  reports: LiveInsightCandidate[];
}> {
  if (cache && cache.expiresAt > Date.now()) {
    return { news: cache.news, reports: cache.reports };
  }

  const [newsGroups, reportGroups] = await Promise.all([
    Promise.all(NEWS_FEEDS.map(([category, url]) => loadNewsFeed(category, url))),
    Promise.all(
      (Object.keys(REPORT_LIST_PATH) as Array<keyof typeof REPORT_LIST_PATH>)
        .map((category) => loadReportCategory(category)),
    ),
  ]);

  const unique = (items: LiveInsightCandidate[]) => {
    const seen = new Set<string>();
    return items.filter((item) => {
      if (!item.url || seen.has(item.url)) return false;
      seen.add(item.url);
      return true;
    });
  };

  const news = unique(newsGroups.flat())
    .sort((a, b) => (b.publishedDate ?? "").localeCompare(a.publishedDate ?? ""))
    .slice(0, 120);
  const reports = unique(reportGroups.flat()).slice(0, 80);
  cache = { expiresAt: Date.now() + 5 * 60_000, news, reports };
  return { news, reports };
}
