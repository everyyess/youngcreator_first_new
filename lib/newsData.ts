export type NewsCategory = "economy" | "industry";

export type NewsArticle = {
  title: string;
  summary: string;
  time: string;
  source: string;
  link: string;
};

const CATEGORY_SOURCES: Record<NewsCategory, { page: string; feeds: string[] }> = {
  economy: {
    page: "https://www.hankyung.com/economy",
    feeds: [
      "https://www.hankyung.com/feed/economy",
      "https://www.hankyung.com/economy/feed",
    ],
  },
  industry: {
    page: "https://www.hankyung.com/industry",
    feeds: [
      "https://www.hankyung.com/feed/industry",
      "https://www.hankyung.com/industry/feed",
    ],
  },
};

// 경제·산업과 무관한 카테고리의 URL 세그먼트 — 해당 패턴이 링크에 포함되면 제외
const BLOCKED_URL_SEGMENTS = [
  "/life/", "/beauty/", "/fashion/", "/health/", "/food/",
  "/realestate/", "/politics/", "/society/", "/culture/",
  "/sports/", "/entertainment/", "/travel/", "/opinion/", "/column/",
];

// RSS <category> 태그에 포함된 경우 제외할 한글 키워드
const BLOCKED_CATEGORY_SUBSTRINGS = [
  "뷰티", "패션", "라이프", "부동산", "정치", "사회", "문화",
  "스포츠", "연예", "건강", "여행", "오피니언", "칼럼",
];

function isArticleBlocked(link: string, categories: string[]): boolean {
  const lowerLink = link.toLowerCase();
  if (BLOCKED_URL_SEGMENTS.some((seg) => lowerLink.includes(seg))) return true;

  if (categories.length > 0) {
    const catText = categories.join(" ");
    if (BLOCKED_CATEGORY_SUBSTRINGS.some((sub) => catText.includes(sub))) return true;
  }

  return false;
}

function formatKoreanDateTime(dateInput: string | Date): string {
  const date = typeof dateInput === "string" ? new Date(dateInput) : dateInput;
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("ko-KR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
    timeZone: "Asia/Seoul",
  }).format(date);
}

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

function tagValue(item: string, tag: string): string {
  const match = item.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return match ? decodeXml(match[1]).replace(/<[^>]+>/g, "").trim() : "";
}

// RSS 아이템에서 <category> 태그를 모두 추출
function tagValues(item: string, tag: string): string[] {
  const results: string[] = [];
  for (const match of item.matchAll(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "gi"))) {
    const value = decodeXml(match[1]).replace(/<[^>]+>/g, "").trim();
    if (value) results.push(value);
  }
  return results;
}

function parseRss(xml: string): NewsArticle[] {
  const results: NewsArticle[] = [];

  for (const match of xml.matchAll(/<item[\s\S]*?<\/item>/gi)) {
    if (results.length >= 8) break;

    const item = match[0];
    const link = tagValue(item, "link");
    const categories = tagValues(item, "category");

    // 경제·산업 외 카테고리 필터링
    if (isArticleBlocked(link, categories)) continue;

    const title = tagValue(item, "title");
    if (!title || !link) continue;

    const pubDate = tagValue(item, "pubDate");
    results.push({
      title,
      summary: "",
      time: formatKoreanDateTime(pubDate),
      source: "한국경제",
      link,
    });
  }

  return results;
}

// 사이드바·관련기사 영역이 시작되기 전까지의 본문만 반환
function extractMainContent(html: string): string {
  const cutMarkers = [
    "관련기사",
    "많이 본 기사",
    "실시간 뉴스",
    "인기 기사",
    "주요 기사",
    "<aside",
    'id="aside',
    'class="aside',
    'id="sidebar',
    'class="sidebar',
    "이 기자의 다른 기사",
    "함께 읽으면 좋은",
  ];
  let cutAt = html.length;
  for (const marker of cutMarkers) {
    const idx = html.indexOf(marker);
    if (idx > 8000 && idx < cutAt) cutAt = idx;
  }
  return html.slice(0, cutAt);
}

function parseHankyungHtml(html: string): NewsArticle[] {
  const articles: NewsArticle[] = [];
  const seen = new Set<string>();

  // 사이드바 이전 본문 영역만 파싱
  const mainHtml = extractMainContent(html);

  // 한경 기사 URL 패턴: /article/숫자로 시작하는 식별자
  const anchorRegex = /<a\s[^>]*href="((?:https:\/\/www\.hankyung\.com)?\/article\/\d[\w-]*)"[^>]*>([\s\S]*?)<\/a>/gi;

  for (const match of mainHtml.matchAll(anchorRegex)) {
    const [fullMatch, rawLink, innerHtml] = match;
    const link = rawLink.startsWith("http") ? rawLink : `https://www.hankyung.com${rawLink}`;
    if (seen.has(link)) continue;

    const title = innerHtml.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
    if (title.length < 5) continue;

    seen.add(link);

    // 앵커 직후 400자 안에서 날짜 추출
    const after = mainHtml.slice((match.index ?? 0) + fullMatch.length, (match.index ?? 0) + fullMatch.length + 400);
    let time = "";
    const dateMatch = after.match(/(\d{4})[.\-](\d{1,2})[.\-](\d{1,2})[^\d]{0,5}(오전|오후)?\s*(\d{1,2}):(\d{2})/);
    if (dateMatch) {
      const [, year, month, day, ampm, hourRaw, minute] = dateMatch;
      let h = Number(hourRaw);
      if (ampm === "오후" && h < 12) h += 12;
      if (ampm === "오전" && h === 12) h = 0;
      const isoStr = `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}T${String(h).padStart(2, "0")}:${minute}:00+09:00`;
      time = formatKoreanDateTime(isoStr);
    }

    articles.push({ title, summary: "", time, source: "한국경제", link });
    if (articles.length >= 8) break;
  }

  return articles;
}

export async function fetchHankyungNews(category: NewsCategory): Promise<NewsArticle[]> {
  const { feeds, page } = CATEGORY_SOURCES[category];

  // 1차: 카테고리 전용 RSS 피드
  for (const url of feeds) {
    try {
      const response = await fetch(url, { next: { revalidate: 600 } });
      if (!response.ok) continue;
      const articles = parseRss(await response.text());
      if (articles.length) return articles;
    } catch {}
  }

  // 2차: 카테고리 HTML 페이지 직접 파싱 (RSS 실패 시)
  try {
    const response = await fetch(page, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; bot/1.0)" },
      next: { revalidate: 600 },
    });
    if (response.ok) {
      const articles = parseHankyungHtml(await response.text());
      if (articles.length) return articles;
    }
  } catch {}

  return [];
}
