import "server-only";

export type ReportTone = "normal" | "positive" | "negative" | "keyword";

export type ReportSpan = {
  text: string;
  tone?: ReportTone;
};

export type ReportSource = {
  title: string;
  publisher: string;
  publishedAt: string;
  url: string;
  summary: string;
};

export type ReportNewsStatus = "available" | "none" | "unavailable";

export type ReportNewsBlock = {
  status: ReportNewsStatus;
  message: string;
  items: ReportSource[];
};

export type ReportNarrativePoint = {
  text: string;
  spans: ReportSpan[];
  sources: ReportSource[];
};

export type MarketReportNarrative = {
  indexOverview: ReportNarrativePoint;
  news: ReportNewsBlock;
  sectors: {
    positive?: ReportNarrativePoint;
    negative?: ReportNarrativePoint;
    message?: string;
  };
  stocks: {
    positive?: ReportNarrativePoint;
    negative?: ReportNarrativePoint;
    message?: string;
  };
  sources: ReportSource[];
};

type Market = "us" | "kr";

type Move = {
  label: string;
  symbol?: string;
  value: number | null;
  changePercent: number | null;
  asOf: string | null;
  status: "available" | "unavailable";
};

type FeedConfig = {
  url: string;
  publisher: string;
};

type ParsedNewsItem = {
  title: string;
  publisher: string;
  publishedAt: string;
  url: string;
  content: string;
};

const importantKeywords = [
  "FOMC", "Fed rate", "Federal Reserve rate", "monetary", "minutes", "Powell", "rate cut", "rate hike", "interest rate", "yield", "Treasury yield", "CPI", "inflation", "jobs", "employment", "payroll", "GDP", "PCE", "tariff", "policy", "stocks", "stock market", "market today", "oil", "crude", "dollar", "Apple", "Nvidia", "Tesla", "AI", "semiconductor", "S&P", "Nasdaq", "Dow", "Wall Street",
  "금리", "금통위", "통화정책", "한국은행", "물가", "고용", "환율", "정부", "정책", "증시", "코스피", "코스닥", "채권", "외국인", "유가", "원달러", "삼성전자", "SK하이닉스", "반도체", "AI",
];

const lowImpactNewsKeywords = [
  "enforcement", "former employee", "application by", "approval of application", "termination of enforcement", "consent order", "banking application", "regulatory action",
  "제재", "임직원", "인사", "입찰", "채용",
];

const marketReactionKeywords = [
  "stocks", "stock market", "Wall Street", "S&P", "Nasdaq", "Dow", "Treasury yields", "yields", "rates hit", "market falls", "market rises", "rally", "selloff", "dollar", "oil", "crude",
  "증시", "코스피", "코스닥", "외국인 순매수", "외국인 순매도", "채권금리 급등", "채권금리 하락", "급락", "급등", "상승 마감", "하락 마감", "강세", "약세",
];

const trustedPublisherKeywords = [
  "Reuters", "Bloomberg", "CNBC", "Yahoo Finance", "MarketWatch", "Wall Street Journal", "Associated Press", "Federal Reserve", "BLS", "BEA", "U.S. Treasury",
  "연합뉴스", "한국경제", "매일경제", "이데일리", "머니투데이", "서울경제", "한국은행", "기획재정부", "금융위원회", "한국거래소",
];

const sectorKeywords: Record<string, string[]> = {
  Technology: ["technology", "tech", "AI", "semiconductor", "chip", "software", "cloud"],
  Financials: ["bank", "banks", "financial", "yield", "credit"],
  Energy: ["oil", "crude", "energy", "OPEC"],
  "Health Care": ["health", "pharma", "drug", "biotech"],
  Industrials: ["industrial", "manufacturing", "transport", "aerospace"],
  "Consumer Discretionary": ["consumer", "retail", "auto", "housing"],
  "Communication Services": ["communication", "media", "advertising", "streaming"],
  "Consumer Staples": ["staples", "food", "beverage"],
  Utilities: ["utilities", "utility", "power", "electricity"],
  "Real Estate": ["real estate", "reit", "property", "mortgage"],
  Materials: ["materials", "chemical", "mining", "steel"],
};

function addDaysIso(dateText: string, days: number) {
  const date = new Date(`${dateText}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function googleNewsUrl(query: string, market: Market, reportDate: string) {
  const after = reportDate;
  const before = addDaysIso(reportDate, 1);
  const params = new URLSearchParams({
    q: `${query} after:${after} before:${before}`,
    hl: market === "us" ? "en-US" : "ko",
    gl: market === "us" ? "US" : "KR",
    ceid: market === "us" ? "US:en" : "KR:ko",
  });
  return `https://news.google.com/rss/search?${params.toString()}`;
}

function newsFeeds(market: Market, reportDate: string): FeedConfig[] {
  if (market === "us") {
    return [
      { url: googleNewsUrl("S&P 500 Nasdaq Dow stock market Treasury yields dollar oil Fed Nvidia Tesla Apple", market, reportDate), publisher: "Google News" },
      { url: googleNewsUrl("Wall Street stocks market today Fed rates CPI jobs oil dollar", market, reportDate), publisher: "Google News" },
      { url: googleNewsUrl("US stock market September Fed Treasury yield crude oil dollar Nvidia Apple Tesla", market, reportDate), publisher: "Google News" },
      { url: "https://feeds.finance.yahoo.com/rss/2.0/headline?s=%5EGSPC,%5EIXIC,%5EDJI,AAPL,NVDA,TSLA&region=US&lang=en-US", publisher: "Yahoo Finance" },
      { url: "https://www.cnbc.com/id/100003114/device/rss/rss.html", publisher: "CNBC" },
    ];
  }
  return [
    { url: googleNewsUrl("코스피 코스닥 증시 원달러 환율 금리 유가 삼성전자 SK하이닉스 반도체", market, reportDate), publisher: "Google News" },
    { url: googleNewsUrl("한국 증시 마감 코스피 코스닥 외국인 기관 환율 채권금리", market, reportDate), publisher: "Google News" },
    { url: googleNewsUrl("한국은행 금리 환율 유가 반도체 삼성전자 SK하이닉스", market, reportDate), publisher: "Google News" },
    { url: "https://www.yna.co.kr/rss/economy.xml", publisher: "연합뉴스" },
    { url: "https://www.mk.co.kr/rss/30000001/", publisher: "매일경제" },
    { url: "https://www.hankyung.com/feed/finance", publisher: "한국경제" },
  ];
}

function decodeXml(text: string) {
  return text
    .replace(/<!\[CDATA\[(.*?)\]\]>/gs, "$1")
    .replace(/&nbsp;/g, " ")
    .replace(/&middot;/g, "·")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractTag(xml: string, tag: string) {
  const match = xml.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return match ? decodeXml(match[1]) : "";
}

function extractSource(itemXml: string, fallbackPublisher: string) {
  const sourceMatch = itemXml.match(/<source[^>]*>([\s\S]*?)<\/source>/i);
  return sourceMatch ? decodeXml(sourceMatch[1]) : fallbackPublisher;
}

function normalizeGoogleTitle(title: string, publisher: string) {
  if (publisher !== "Google News") return title;
  return title.replace(/\s-\s[^-]+$/, "").trim() || title;
}

function parseRss(xml: string, feed: FeedConfig): ParsedNewsItem[] {
  const itemRegex = /<item[\s\S]*?<\/item>/gi;
  const items = xml.match(itemRegex) || [];
  return items.map((itemXml) => {
    const source = extractSource(itemXml, feed.publisher);
    const rawTitle = extractTag(itemXml, "title");
    const description = extractTag(itemXml, "description");
    const content = extractTag(itemXml, "content:encoded") || extractTag(itemXml, "summary") || description;
    const publishedAt = extractTag(itemXml, "pubDate") || extractTag(itemXml, "dc:date");
    const link = extractTag(itemXml, "link");
    return {
      title: normalizeGoogleTitle(rawTitle, feed.publisher),
      publisher: source || feed.publisher,
      publishedAt: publishedAt ? new Date(publishedAt).toISOString() : "",
      url: link,
      content,
    };
  }).filter((item) => item.title && item.url && item.publishedAt);
}

function isImportantNews(item: ParsedNewsItem) {
  const haystack = `${item.title} ${item.content} ${item.publisher}`.toLowerCase();
  if (lowImpactNewsKeywords.some((keyword) => haystack.includes(keyword.toLowerCase()))) return false;
  return importantKeywords.some((keyword) => haystack.includes(keyword.toLowerCase()));
}

function scoreNews(item: ParsedNewsItem) {
  const haystack = `${item.title} ${item.content} ${item.publisher}`.toLowerCase();
  let score = 0;
  for (const keyword of importantKeywords) if (haystack.includes(keyword.toLowerCase())) score += 1;
  for (const keyword of marketReactionKeywords) if (haystack.includes(keyword.toLowerCase())) score += 3;
  if (trustedPublisherKeywords.some((publisher) => item.publisher.includes(publisher))) score += 2;
  if (item.publisher.includes("Federal Reserve") || item.publisher.includes("BLS") || item.publisher.includes("한국은행")) score -= 1;
  if (/stock|stocks|market|wall street|nasdaq|s&p|dow|증시|코스피|코스닥|환율|금리|유가/i.test(haystack)) score += 4;
  return score;
}

async function fetchFeed(feed: FeedConfig): Promise<ParsedNewsItem[]> {
  const response = await fetch(feed.url, { cache: "no-store", headers: { "User-Agent": "SodaPop-MarketReport/1.0" } });
  if (!response.ok) throw new Error(`${feed.publisher} RSS HTTP ${response.status}`);
  return parseRss(await response.text(), feed);
}

function extractMeta(html: string, name: string) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const patterns = [
    new RegExp(`<meta[^>]+property=["']${escaped}["'][^>]+content=["']([^"']+)["'][^>]*>`, "i"),
    new RegExp(`<meta[^>]+name=["']${escaped}["'][^>]+content=["']([^"']+)["'][^>]*>`, "i"),
    new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+property=["']${escaped}["'][^>]*>`, "i"),
    new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+name=["']${escaped}["'][^>]*>`, "i"),
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match?.[1]) return decodeXml(match[1]);
  }
  return "";
}

function extractFirstParagraph(html: string) {
  const paragraphs = html.match(/<p[\s\S]*?<\/p>/gi) || [];
  return paragraphs.map(decodeXml).find((text) => text.length > 80) || "";
}

function extractOriginalUrlFromGoogleHtml(html: string) {
  let decoded = html;
  try {
    decoded = decodeURIComponent(html);
  } catch {
    decoded = html;
  }
  const candidates = [
    ...decoded.matchAll(/https?:\/\/(?!news\.google\.com|www\.google\.com|accounts\.google\.com)[^"'<>\s\\]+/gi),
  ].map((match) => match[0].replace(/\\u003d/g, "=").replace(/\\u0026/g, "&"));
  return candidates.find((url) => !/gstatic|googleusercontent|schema\.org|w3\.org/i.test(url)) || "";
}

async function fetchUrlText(url: string) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 4500);
  try {
    const response = await fetch(url, { cache: "no-store", redirect: "follow", signal: controller.signal, headers: { "User-Agent": "Mozilla/5.0 SodaPop-MarketReport/1.0" } });
    if (!response.ok) return { url, text: "" };
    return { url: response.url || url, text: await response.text() };
  } catch {
    return { url, text: "" };
  } finally {
    clearTimeout(timeoutId);
  }
}

async function fetchArticleContent(item: ParsedNewsItem) {
  const first = await fetchUrlText(item.url);
  let articleUrl = first.url;
  let html = first.text;
  if (/news\.google\.com/i.test(item.url) && html) {
    const originalUrl = extractOriginalUrlFromGoogleHtml(html);
    if (originalUrl) {
      const original = await fetchUrlText(originalUrl);
      articleUrl = original.url || originalUrl;
      html = original.text || html;
    }
  }
  const extracted = html ? extractMeta(html, "og:description") || extractMeta(html, "description") || extractFirstParagraph(html) : "";
  return { url: articleUrl, content: extracted || item.content };
}

function hasKorean(text: string) {
  return /[가-힣]/.test(text);
}

function normalizeText(text: string) {
  return decodeXml(text).replace(/["'“”‘’]/g, "").replace(/\s+/g, " ").trim();
}

function isTitleOnlyContent(item: ParsedNewsItem, content: string) {
  const cleanContent = normalizeText(content).toLowerCase();
  const cleanTitle = normalizeText(item.title).toLowerCase();
  if (cleanContent.length < 45) return true;
  if (!cleanContent || cleanContent === cleanTitle) return true;
  if (cleanContent.includes(cleanTitle) && cleanContent.length < cleanTitle.length + 60) return true;
  const withoutTitle = cleanContent.replace(cleanTitle, "").replace(item.publisher.toLowerCase(), "").trim();
  return withoutTitle.length < 35;
}

function trimKoreanSentence(text: string) {
  const cleaned = normalizeText(text);
  const sentences = cleaned.split(/(?<=[.!?。]|다\.|요\.)\s+/).filter(Boolean);
  const first = sentences[0] || cleaned;
  return first.length > 140 ? `${first.slice(0, 137).trim()}...` : first;
}

function summarizeEnglishToKorean(text: string, publisher: string) {
  const lower = text.toLowerCase();
  const cleaned = normalizeText(text);
  const hasYield = lower.includes("treasury") || lower.includes("yield") || lower.includes("bond");
  const hasOil = lower.includes("oil") || lower.includes("crude");
  const hasInflation = lower.includes("inflation") || lower.includes("consumer price") || lower.includes("cpi");
  const hasMiddleEast = lower.includes("middle east") || lower.includes("iran") || lower.includes("geopolitical");
  const hasStocks = lower.includes("stock") || lower.includes("wall street") || lower.includes("nasdaq") || lower.includes("s&p") || lower.includes("dow");

  if (hasMiddleEast && hasOil && hasYield) return "중동 지역 긴장으로 유가가 오르자 인플레이션 우려가 다시 커졌고, 미 국채금리 상승이 위험자산 투자심리에 부담으로 작용했다.";
  if (hasOil && hasInflation && hasYield) return "유가 상승이 인플레이션 우려를 자극하면서 글로벌 채권금리와 미 국채금리가 함께 뛰었다는 내용이 보도됐다.";
  if (hasStocks && hasYield) return "미국 증시는 국채금리 상승 부담을 소화하는 과정에서 주요 지수와 기술주 중심으로 약세 압력이 나타났다는 내용이 보도됐다.";
  if (hasStocks && lower.includes("apple")) return "미국 증시는 전반적으로 약세였지만 애플 등 일부 대형주의 움직임이 지수 하락폭을 제한했다는 내용이 보도됐다.";
  if (hasStocks && (lower.includes("nvidia") || lower.includes("ai") || lower.includes("semiconductor"))) return "AI와 반도체 관련 대형주의 등락이 기술주 투자심리와 나스닥 흐름에 영향을 줬다는 내용이 보도됐다.";
  if (hasStocks && (lower.includes("fed") || lower.includes("rate"))) return "미국 증시는 연준의 금리 경로와 경제지표를 둘러싼 기대 변화가 투자심리에 영향을 줬다는 내용이 보도됐다.";
  if (hasStocks && hasOil) return "미국 증시는 유가 상승과 에너지 관련 재료를 반영하면서 업종별 흐름이 엇갈렸다는 내용이 보도됐다.";
  if (hasStocks) return "미국 증시는 주요 지수와 대형주 흐름을 중심으로 투자심리가 변화했다는 내용이 보도됐다.";
  if (hasInflation) return "물가 관련 지표와 인플레이션 우려는 향후 금리 전망을 가늠하는 핵심 재료로 제시됐다.";
  if (lower.includes("employment") || lower.includes("payroll") || lower.includes("jobs")) return "고용 관련 지표는 노동시장 강도와 연준의 정책 판단을 가늠할 수 있는 주요 재료로 제시됐다.";
  if (hasYield) return "미 국채금리 관련 소식은 장기금리와 위험자산 투자심리에 영향을 줄 수 있는 재료로 다뤄졌다.";
  if (hasOil) return "유가 관련 소식은 에너지 업종과 인플레이션 기대에 영향을 줄 수 있는 재료로 다뤄졌다.";
  if (cleaned.length > 90) return `${publisher} 보도는 ${cleaned.slice(0, 90).trim()}... 내용을 다뤘다.`;
  return "";
}

async function toReportSource(item: ParsedNewsItem, market: Market): Promise<ReportSource | null> {
  const article = await fetchArticleContent(item);
  if (isTitleOnlyContent(item, article.content)) {
    console.info("[market-news] skipped item without usable article summary", { market, publisher: item.publisher, publishedAt: item.publishedAt, title: item.title });
    return null;
  }
  const summaryInput = `${item.title}. ${article.content}`;
  const summary = hasKorean(article.content) ? trimKoreanSentence(article.content) : summarizeEnglishToKorean(summaryInput, item.publisher);
  if (!summary || isTitleOnlyContent(item, summary)) {
    console.info("[market-news] skipped item after summary validation", { market, publisher: item.publisher, publishedAt: item.publishedAt, title: item.title });
    return null;
  }
  return { title: item.title, publisher: item.publisher, publishedAt: item.publishedAt, url: article.url || item.url, summary };
}

function marketTimeZone(market: Market) {
  return market === "us" ? "America/New_York" : "Asia/Seoul";
}

function dateInTimeZone(iso: string, timeZone: string) {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${map.year}-${map.month}-${map.day}`;
}

function isNewsOnTargetDate(item: ParsedNewsItem, market: Market, reportDate: string) {
  return dateInTimeZone(item.publishedAt, marketTimeZone(market)) === reportDate;
}

// ─── Trading-day helpers ───────────────────────────────────────────────────

function isWeekendDate(dateText: string) {
  const dow = new Date(dateText + "T00:00:00.000Z").getUTCDay();
  return dow === 0 || dow === 6;
}

function _nthWeekday(year: number, mo: number, dow: number, n: number) {
  const d = new Date(Date.UTC(year, mo, 1));
  let cnt = 0;
  while (d.getUTCMonth() === mo) {
    if (d.getUTCDay() === dow && ++cnt === n) return d.toISOString().slice(0, 10);
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return "";
}

function _lastWeekday(year: number, mo: number, dow: number) {
  const d = new Date(Date.UTC(year, mo + 1, 0));
  while (d.getUTCDay() !== dow) d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

function _observed(year: number, mo: number, day: number) {
  const d = new Date(Date.UTC(year, mo, day));
  const wd = d.getUTCDay();
  if (wd === 6) d.setUTCDate(d.getUTCDate() - 1);
  else if (wd === 0) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

function _easterSunday(year: number) {
  const a = year % 19, b = Math.floor(year / 100), c = year % 100;
  const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31) - 1;
  const dayN = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(year, month, dayN));
}

function isUsNewsHoliday(dateText: string) {
  const y = Number(dateText.slice(0, 4));
  const gfDate = new Date(_easterSunday(y));
  gfDate.setUTCDate(gfDate.getUTCDate() - 2);
  const goodFri = gfDate.toISOString().slice(0, 10);
  const holidays = new Set([
    _observed(y, 0, 1),            // New Year's Day
    _nthWeekday(y, 0, 1, 3),       // MLK Day
    _nthWeekday(y, 1, 1, 3),       // Presidents' Day
    goodFri,                        // Good Friday
    _lastWeekday(y, 4, 1),          // Memorial Day
    _observed(y, 5, 19),            // Juneteenth
    _observed(y, 6, 4),             // Independence Day
    _nthWeekday(y, 8, 1, 1),        // Labor Day
    _nthWeekday(y, 10, 4, 4),       // Thanksgiving
    _observed(y, 11, 25),           // Christmas
  ]);
  return holidays.has(dateText);
}

function isUsNewsDay(dateText: string) {
  return !isWeekendDate(dateText) && !isUsNewsHoliday(dateText);
}

// KRX 휴장일 (정적 목록: 2025–2027)
const krHolidaySet = new Set([
  // 2025
  "2025-01-01", "2025-01-28", "2025-01-29", "2025-01-30",
  "2025-03-01", "2025-05-05", "2025-05-06", "2025-06-06",
  "2025-08-15", "2025-10-03", "2025-10-05", "2025-10-06",
  "2025-10-07", "2025-10-08", "2025-10-09", "2025-12-25", "2025-12-31",
  // 2026
  "2026-01-01", "2026-01-27", "2026-01-28", "2026-01-29",
  "2026-03-02",  // 삼일절 대체 (3/1 일요일)
  "2026-05-05",  // 어린이날
  "2026-05-25",  // 부처님오신날 대체 (5/24 일요일)
  "2026-09-24", "2026-09-25", "2026-09-26",
  "2026-10-09", "2026-12-25", "2026-12-31",
  // 2027 (예상)
  "2027-01-01", "2027-02-16", "2027-02-17", "2027-02-18",
  "2027-03-01", "2027-05-05", "2027-10-01", "2027-10-02",
  "2027-10-03", "2027-10-04", "2027-10-09", "2027-12-25", "2027-12-31",
]);

function isKrNewsDay(dateText: string) {
  return !isWeekendDate(dateText) && !krHolidaySet.has(dateText);
}

// ─── Alpha Vantage (US news) ───────────────────────────────────────────────

function _formatAlphaDateTime(value: string) {
  // "20240101T060000" → ISO
  if (!value || value.length < 8) return "";
  const yr = value.slice(0, 4), mo = value.slice(4, 6), dy = value.slice(6, 8);
  const hh = value.slice(9, 11) || "00", mm = value.slice(11, 13) || "00";
  return `${yr}-${mo}-${dy}T${hh}:${mm}:00Z`;
}

type RawNewsItem = { title: string; url: string; publishedAt: string; publisher: string; summary: string };

async function _fetchAlphaVantageNews(reportDate: string): Promise<{ items: RawNewsItem[]; error?: string }> {
  const apiKey = process.env.ALPHA_VANTAGE_API_KEY?.trim();
  if (!apiKey) return { items: [], error: "ALPHA_VANTAGE_API_KEY 미설정" };
  try {
    const timeFrom = reportDate.replace(/-/g, "") + "T0000";
    const timeTo = addDaysIso(reportDate, 1).replace(/-/g, "") + "T0600";
    const url = new URL("https://www.alphavantage.co/query");
    ([["function", "NEWS_SENTIMENT"], ["topics", "financial_markets,economy_macro,earnings,ipo,mergers_and_acquisitions"],
    ["time_from", timeFrom], ["time_to", timeTo], ["sort", "RELEVANCE"], ["limit", "50"], ["apikey", apiKey],
    ] as [string, string][]).forEach(([k, v]) => url.searchParams.set(k, v));

    const res = await fetch(url.toString(), { cache: "no-store" });
    if (!res.ok) return { items: [], error: `Alpha Vantage HTTP ${res.status}` };
    const data = await res.json() as Record<string, unknown>;
    if (data.Note || data.Information) return { items: [], error: String(data.Note ?? data.Information) };

    const feed = Array.isArray(data.feed) ? (data.feed as Array<Record<string, unknown>>) : [];
    const items: RawNewsItem[] = feed
      .map((item) => ({
        title: String(item.title || ""),
        url: String(item.url || ""),
        publishedAt: _formatAlphaDateTime(String(item.time_published || "")),
        publisher: String(item.source || "Alpha Vantage"),
        summary: String(item.summary || ""),
      }))
      .filter((item) => item.title && item.url && item.publishedAt);
    return { items };
  } catch (err) {
    return { items: [], error: err instanceof Error ? err.message : "Alpha Vantage 오류" };
  }
}

// ─── Finnhub (US news) ────────────────────────────────────────────────────

async function _fetchFinnhubNews(reportDate: string): Promise<{ items: RawNewsItem[]; error?: string }> {
  const apiKey = process.env.FINNHUB_API_KEY?.trim();
  if (!apiKey) return { items: [], error: "FINNHUB_API_KEY 미설정" };
  try {
    const url = new URL("https://finnhub.io/api/v1/news");
    url.searchParams.set("category", "general");
    url.searchParams.set("token", apiKey);

    const res = await fetch(url.toString(), { cache: "no-store" });
    if (!res.ok) return { items: [], error: `Finnhub HTTP ${res.status}` };
    const data = await res.json() as unknown;
    const feed = Array.isArray(data) ? (data as Array<Record<string, unknown>>) : [];

    const items: RawNewsItem[] = feed
      .filter((item) => {
        const ts = Number(item.datetime);
        if (!Number.isFinite(ts)) return false;
        return dateInTimeZone(new Date(ts * 1000).toISOString(), "America/New_York") === reportDate;
      })
      .map((item) => ({
        title: String(item.headline || ""),
        url: String(item.url || ""),
        publishedAt: new Date(Number(item.datetime) * 1000).toISOString(),
        publisher: String(item.source || "Finnhub"),
        summary: String(item.summary || ""),
      }))
      .filter((item) => item.title && item.url);
    return { items };
  } catch (err) {
    return { items: [], error: err instanceof Error ? err.message : "Finnhub 오류" };
  }
}

// ─── NAVER API HUB (KR news) ──────────────────────────────────────────────

function _stripHtml(text: string) {
  return text
    .replace(/<b>/gi, "").replace(/<\/b>/gi, "")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

function _publisherFromUrl(url: string) {
  try {
    const host = new URL(url).hostname.replace("www.", "");
    const map: Record<string, string> = {
      "yna.co.kr": "연합뉴스", "hankyung.com": "한국경제", "mk.co.kr": "매일경제",
      "edaily.co.kr": "이데일리", "mt.co.kr": "머니투데이", "sedaily.com": "서울경제",
      "fnnews.com": "파이낸셜뉴스", "inews24.com": "아이뉴스24", "biz.chosun.com": "조선비즈",
      "thebell.co.kr": "더벨", "news.naver.com": "네이버뉴스",
    };
    return map[host] || host;
  } catch { return "뉴스"; }
}

async function _fetchNaverHubNews(reportDate: string): Promise<{ items: RawNewsItem[]; error?: string }> {
  const clientId = process.env.NAVER_API_HUB_CLIENT_ID?.trim();
  const clientSecret = process.env.NAVER_API_HUB_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) return { items: [], error: "NAVER API HUB 키 미설정" };

  const queries = [
    "코스피 코스닥 증시 마감",
    "원달러 환율 채권금리 외국인 순매수",
    "삼성전자 SK하이닉스 반도체 주가",
  ];
  const seenTitles = new Set<string>();
  const allItems: RawNewsItem[] = [];
  let lastError: string | undefined;

  for (const query of queries) {
    try {
      const url = new URL("https://naverapihub.apigw.ntruss.com/search/v1/news");

      url.searchParams.set("query", query);
      url.searchParams.set("display", "20");
      url.searchParams.set("start", "1");
      url.searchParams.set("sort", "date");

      const res = await fetch(url.toString(), {
        headers: {
          "X-NCP-APIGW-API-KEY-ID": clientId,
          "X-NCP-APIGW-API-KEY": clientSecret,
        },
        cache: "no-store",
      });
      if (!res.ok) { lastError = `NAVER HTTP ${res.status}`; continue; }
      const data = await res.json() as Record<string, unknown>;
      const items = Array.isArray(data.items) ? (data.items as Array<Record<string, unknown>>) : [];

      for (const item of items) {
        const pubDateStr = String(item.pubDate || "");
        const publishedAt = pubDateStr ? new Date(pubDateStr).toISOString() : "";
        if (!publishedAt) continue;
        if (dateInTimeZone(publishedAt, "Asia/Seoul") !== reportDate) continue;
        const rawTitle = _stripHtml(String(item.title || ""));
        const articleUrl = String(item.originallink || item.link || "");
        if (!rawTitle || !articleUrl || seenTitles.has(rawTitle)) continue;
        seenTitles.add(rawTitle);
        allItems.push({
          title: rawTitle,
          url: articleUrl,
          publishedAt,
          publisher: _publisherFromUrl(articleUrl),
          summary: _stripHtml(String(item.description || "")),
        });
      }
    } catch (err) {
      lastError = err instanceof Error ? err.message : "NAVER 오류";
    }
  }

  if (!allItems.length && lastError) return { items: [], error: lastError };
  return { items: allItems };
}

// ─── Scoring & deduplication ──────────────────────────────────────────────

const _usImpactKw = [
  "fed ", "federal reserve", "fomc", "powell", "rate cut", "rate hike", "interest rate",
  "inflation", "cpi", "pce", "consumer price",
  "jobs", "payroll", "nonfarm", "employment", "unemployment",
  "gdp", "recession", "earnings", "tariff", "trade war",
  "s&p", "nasdaq", "dow", "treasury yield", "10-year", "oil", "crude",
  "nvidia", "apple", "microsoft", "meta", "alphabet", "amazon", "tesla",
  "ai ", "semiconductor", "chip",
];

const _krImpactKw = [
  "코스피", "코스닥", "증시",
  "외국인", "기관", "순매수", "순매도",
  "삼성전자", "sk하이닉스", "반도체",
  "한국은행", "금통위", "기준금리",
  "원달러", "원·달러", "환율",
  "급등", "급락", "상승", "하락",
  "마감", "종가"
];

function _scoreUs(title: string, summary: string) {
  const hay = `${title} ${summary}`.toLowerCase();
  let score = 0;

  // 미국 증시 전체 흐름
  if (/s&p ?500|nasdaq|dow|wall street|u\.?s\.? stocks?|us stocks?|american stocks?/.test(hay)) {
    score += 5;
  }

  // Fed·금리·미 국채
  if (/federal reserve|\bfed\b|powell|interest rate|rate cut|rate hike|treasury|treasuries|bond yield|10-year yield|2-year yield|30-year yield/.test(hay)) {
    score += 5;
  }

  // 미국 핵심 경제지표
  if (/inflation|\bcpi\b|\bpce\b|payroll|jobs report|unemployment|gdp|retail sales|consumer spending/.test(hay)) {
    score += 4;
  }

  // 미국 증시에 영향력이 큰 대형 기술주·반도체
  if (/nvidia|apple|microsoft|amazon|alphabet|google|meta|tesla|broadcom|semiconductor|chip stocks?/.test(hay)) {
    score += 3;
  }

  // 유가·지정학 등 글로벌 위험요인
  if (/oil prices?|crude oil|middle east|geopolitical|war|iran|israel/.test(hay)) {
    score += 3;
  }

  // 실제 시장 움직임
  if (/rally|surge|plunge|soar|tumble|crash|spike|selloff|rise|fall/.test(hay)) {
    score += 2;
  }

  // 미국 시장 연결고리가 없는 해외 개별기업 뉴스는 강하게 감점
  const hasUsMarketContext =
    /s&p ?500|nasdaq|dow|wall street|u\.?s\.? stocks?|us stocks?|federal reserve|\bfed\b|treasury|treasuries|nvidia|apple|microsoft|amazon|alphabet|google|meta|tesla/.test(hay);

  if (!hasUsMarketContext && /india|indian|china|chinese|japan|japanese|european/.test(hay)) {
    score -= 6;
  }

  return score;
}

function _scoreKr(title: string, summary: string) {
  const hay = `${title} ${summary}`.toLowerCase();

  let score = 0;

  // 국내 증시 자체를 다룬 기사 우선
  if (/코스피|코스닥|국내 증시/.test(hay)) score += 4;

  // 당일 시장 수급
  if (/외국인|기관|순매수|순매도/.test(hay)) score += 3;

  // 시장 영향력이 큰 국내 핵심 종목/업종
  if (/삼성전자|sk하이닉스|반도체/.test(hay)) score += 3;

  // 국내 시장 핵심 매크로
  if (/한국은행|금통위|기준금리|원.?달러|환율/.test(hay)) score += 3;

  // 실제 시장 움직임
  if (/급등|급락|상승|하락|강세|약세/.test(hay)) score += 2;

  if (/마감|종가/.test(hay)) score += 2;

  // ELS/ELB 상품 판매 기사 등은 제외
  if (/els|elb|공모|모집|청약/.test(hay)) score -= 6;

  // 해외 시장 단독 기사 감점
  if (/일본 국채|일본은행|닛케이/.test(hay) &&
    !/코스피|코스닥|국내 증시/.test(hay)) {
    score -= 6;
  }

  return score;
}

function _isSimilarTitle(a: string, b: string) {
  const ca = a.toLowerCase().replace(/[^a-z0-9가-힣]/g, "");
  const cb = b.toLowerCase().replace(/[^a-z0-9가-힣]/g, "");
  if (ca === cb) return true;
  const shorter = ca.length <= cb.length ? ca : cb;
  const longer = ca.length > cb.length ? ca : cb;
  return shorter.length >= 15 && longer.includes(shorter.slice(0, Math.floor(shorter.length * 0.75)));
}

// ─── Korean summary builders ──────────────────────────────────────────────

function _summarizeUs(title: string, summary: string): string {
  const text = `${title} ${summary}`
    .replace(/\s+/g, " ")
    .trim();

  const lower = text.toLowerCase();

  // 미 국채금리
  if (/treasury|treasuries|10-year yield|2-year yield|30-year yield|bond yield/.test(lower)) {
    if (/highest|rise|rose|rising|surge|jump|climb/.test(lower)) {
      return "미 국채금리가 상승하며 주식시장에 부담으로 작용했어요.";
    }

    if (/fall|fell|decline|drop|lower/.test(lower)) {
      return "미 국채금리가 하락하며 주식시장 투자심리에 영향을 미쳤어요.";
    }

    return "미 국채금리 움직임이 미국 증시의 주요 변수로 작용했어요.";
  }

  // 연준·금리
  if (/federal reserve|\bfed\b|fomc|powell|rate cut|rate hike|interest rate/.test(lower)) {
    return "연준의 통화정책과 금리 전망을 둘러싼 변화가 미국 증시의 주요 변수로 부각됐어요.";
  }

  // 물가
  if (/inflation|\bcpi\b|\bpce\b|consumer price/.test(lower)) {
    return "미국 물가 관련 지표가 향후 금리 경로를 가늠할 핵심 변수로 주목받았어요.";
  }

  // 고용
  if (/payroll|jobs report|employment|unemployment|labor market/.test(lower)) {
    return "미국 고용 관련 지표가 경기와 향후 금리 전망을 판단할 주요 재료로 작용했어요.";
  }

  // 정부 셧다운·예산
  if (/government shutdown|shutdown|spending measure|spending bill|funding bill|government funding/.test(lower)) {
    return "미국 정부 셧다운을 둘러싼 예산 협상이 시장의 주요 불확실성으로 부각됐어요.";
  }

  // 지정학
  if (/middle east|geopolitical|iran|israel|war|conflict|tension/.test(lower)) {
    return "지정학적 리스크가 부각되며 안전자산 선호가 강해지고 미국 증시에 부담으로 작용했어요.";
  }

  // 유가
  if (/oil|crude|opec|energy price/.test(lower)) {
    return "국제유가 움직임이 인플레이션 우려와 에너지 업종을 통해 미국 증시에 영향을 미쳤어요.";
  }

  // 대형 기술주·반도체
  if (/nvidia|apple|microsoft|amazon|alphabet|google|meta|broadcom|semiconductor|chip stocks?/.test(lower)) {
    return "미국 대형 기술주와 반도체 관련 소식이 기술주 투자심리에 영향을 미쳤어요.";
  }

  // 미국 증시 전체
  if (/s&p ?500|nasdaq|dow|wall street|u\.?s\.? stocks?|us stocks?/.test(lower)) {
    if (/fall|fell|drop|decline|plunge|tumble|selloff|lower/.test(lower)) {
      return "미국 주요 증시가 하락하며 위험자산 투자심리가 약화됐어요.";
    }

    if (/rise|rose|rally|gain|surge|higher|climb/.test(lower)) {
      return "미국 주요 증시가 상승하며 위험자산 투자심리가 개선됐어요.";
    }

    return "미국 주요 증시의 움직임이 시장 투자심리에 영향을 미쳤어요.";
  }

  // 미국 정부·재정·예산
  if (/congress|house|senate|government funding|spending measure|spending bill|budget|fiscal/.test(lower)) {
    return "미국 정부의 예산·재정 관련 논의가 금융시장의 주요 변수로 부각됐어요.";
  }

  // 달러·환율
  if (/dollar|dollar index|dxy|currency|foreign exchange/.test(lower)) {
    return "달러 가치의 움직임이 미국 금융시장과 투자심리에 영향을 미쳤어요.";
  }

  // 미국 경기·소비
  if (/consumer|retail sales|economic growth|economy|economic data|business activity/.test(lower)) {
    return "미국 경기와 소비 관련 소식이 향후 경기 전망을 판단할 주요 재료로 작용했어요.";
  }

  // 분류되지 않는 기사는 기본 요약 사용
  return "미국 금융시장 관련 주요 소식이 투자심리에 영향을 미쳤어요.";
}


function _summarizeKr(title: string, description: string): string {
  const cleanTitle = title
    .replace(/^\[[^\]]+\]\s*/g, "")
    .replace(/\s+/g, " ")
    .trim();

  const cleanDescription = description
    .replace(/\s+/g, " ")
    .trim();

  const sentences = cleanDescription
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => {
      if (!sentence) return false;

      const isByline =
        /\|\s*.*기자\s*\|/.test(sentence) ||
        /^[가-힣A-Za-z]+\s*=\s*/.test(sentence);

      const isListLike =
        /^[-•·]/.test(sentence) ||
        sentence.split(" - ").length >= 3;

      return !isByline && !isListLike;
    });

  const importantSentence = sentences.find((sentence) =>
    /코스피|코스닥|증시|외국인|기관|순매수|순매도|금리|환율|반도체|삼성전자|SK하이닉스|유가/.test(sentence)
  );

  let result = importantSentence || cleanTitle;

  // "이는", "이날"처럼 앞 문맥이 필요한 표현 제거
  result = result
    .replace(/^(이는|이날|이에|이로 인해|이 때문에)\s*/g, "")
    .trim();

  // 기사 제목의 말줄임표를 자연스럽게 정리
  result = result
    .replace(/…+/g, " ")
    .replace(/\.\.\.+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  // 완결형 문장으로 마무리
  if (!/[.!?]$/.test(result)) {
    if (/마감$/.test(result)) {
      result = result.replace(/마감$/, "마감했다.");
    } else if (/최고$/.test(result)) {
      result = result.replace(/최고$/, "최고치를 기록했다.");
    } else if (/급락$/.test(result)) {
      result = result.replace(/급락$/, "급락했다.");
    } else if (/급등$/.test(result)) {
      result = result.replace(/급등$/, "급등했다.");
    } else if (/하락$/.test(result)) {
      result = result.replace(/하락$/, "하락했다.");
    } else if (/상승$/.test(result)) {
      result = result.replace(/상승$/, "상승했다.");
    } else {
      result += ".";
    }
  }

  if (result.length > 120) {
    result = result.slice(0, 117).trimEnd() + "...";
  }

  return result;
}


// ─── Market-specific fetchers ─────────────────────────────────────────────

async function fetchUsNews(reportDate: string): Promise<ReportNewsBlock> {
  if (!isUsNewsDay(reportDate)) {
    return { status: "none", message: "전일 미국 증시는 휴장했습니다.", items: [] };
  }

  const [avResult, fhResult] = await Promise.all([
    _fetchAlphaVantageNews(reportDate),
    _fetchFinnhubNews(reportDate),
  ]);
  console.info("[market-news][us] api results", {
    reportDate,
    avCount: avResult.items.length, avError: avResult.error,
    fhCount: fhResult.items.length, fhError: fhResult.error,
  });

  if (!avResult.items.length && !fhResult.items.length) {
    return { status: "unavailable", message: "주요 시장 뉴스를 불러오지 못했습니다.", items: [] };
  }

  // Merge & deduplicate by title similarity
  const merged: RawNewsItem[] = [];
  for (const item of [...avResult.items, ...fhResult.items]) {
    if (!merged.some((m) => _isSimilarTitle(m.title, item.title))) merged.push(item);
  }

  // Score and filter
  const scored = merged
    .map((item) => ({ item, score: _scoreUs(item.title, item.summary) }))
    .filter((s) => s.score >= 4)
    .sort((a, b) => b.score - a.score);

  if (!scored.length) {
    return { status: "none", message: "시장 방향성에 영향을 줄 만한 주요 이벤트가 없었어요.", items: [] };
  }

  // Build Korean summaries with deduplication
  const items: ReportSource[] = [];
  const summarySeen = new Set<string>();
  for (const { item } of scored) {
    if (items.length >= 5) break;
    const summary = _summarizeUs(item.title, item.summary);
    if (
      !summary ||
      summary === "미국 금융시장 관련 주요 소식이 투자심리에 영향을 미쳤어요." ||
      summarySeen.has(summary)
    ) continue;
    summarySeen.add(summary);
    items.push({ title: item.title, publisher: item.publisher, publishedAt: item.publishedAt, url: item.url, summary });
  }

  if (!items.length) {
    return { status: "none", message: "시장 방향성에 영향을 줄 만한 주요 이벤트가 없었어요.", items: [] };
  }
  return { status: "available", message: "", items: items.slice(0, 5) };
}

async function fetchKrNews(reportDate: string): Promise<ReportNewsBlock> {
  if (!isKrNewsDay(reportDate)) {
    return { status: "none", message: "오늘 국내 증시는 휴장했습니다.", items: [] };
  }

  const naverResult = await _fetchNaverHubNews(reportDate);
  console.info("[market-news][kr] naver result", {
    reportDate, count: naverResult.items.length, error: naverResult.error,
  });

  if (!naverResult.items.length && naverResult.error) {
    return { status: "unavailable", message: "주요 시장 뉴스를 불러오지 못했습니다.", items: [] };
  }

  const scored = naverResult.items
    .map((item) => ({ item, score: _scoreKr(item.title, item.summary) }))
    .filter((s) => {
      const text = `${s.item.title} ${s.item.summary}`.toLowerCase();

      const isDomesticMarket =
        /코스피|코스닥|국내 증시|외국인|기관|순매수|순매도|삼성전자|sk하이닉스|반도체|한국은행|금통위|원.?달러|환율/.test(text);

      return s.score >= 2 && isDomesticMarket;
    })
    .sort((a, b) => b.score - a.score);

  if (!scored.length) {
    return { status: "none", message: "시장 방향성에 영향을 줄 만한 주요 이벤트가 없었어요.", items: [] };
  }

  const items: ReportSource[] = [];

  function isSimilarNews(a: string, b: string) {
    const importantKeywords = [
      "코스피",
      "코스닥",
      "외국인",
      "기관",
      "순매수",
      "순매도",
      "삼성전자",
      "SK하이닉스",
      "반도체",
      "금리",
      "환율",
      "유가",
      "한국은행",
      "기준금리",
      "급등",
      "급락",
      "상승",
      "하락",
    ];

    const sharedKeywords = importantKeywords.filter(
      (keyword) => a.includes(keyword) && b.includes(keyword)
    );

    // 핵심 키워드가 2개 이상 겹치면 같은 이슈로 판단
    if (sharedKeywords.length >= 2) {
      return true;
    }

    const wordsA = new Set(
      a
        .replace(/[^가-힣A-Za-z0-9\s]/g, " ")
        .split(/\s+/)
        .filter((w) => w.length >= 2)
    );

    const wordsB = new Set(
      b
        .replace(/[^가-힣A-Za-z0-9\s]/g, " ")
        .split(/\s+/)
        .filter((w) => w.length >= 2)
    );

    if (!wordsA.size || !wordsB.size) {
      return false;
    }

    let overlap = 0;

    for (const word of wordsA) {
      if (wordsB.has(word)) {
        overlap++;
      }
    }

    return overlap / Math.min(wordsA.size, wordsB.size) >= 0.3;
  }


  for (const { item } of scored) {
    if (items.length >= 5) break;

    const summary = _summarizeKr(item.title, item.summary);
    if (!summary) continue;

    const duplicated = items.some((existing) =>
      isSimilarNews(
        `${item.title} ${summary}`,
        `${existing.title} ${existing.summary}`
      )
    );

    if (duplicated) continue;

    items.push({
      title: item.title,
      publisher: item.publisher,
      publishedAt: item.publishedAt,
      url: item.url,
      summary,
    });
  }

  if (!items.length) {
    return { status: "none", message: "시장 방향성에 영향을 줄 만한 주요 이벤트가 없었어요.", items: [] };
  }
  return { status: "available", message: "", items: items.slice(0, 5) };
}

// ─── fetchNews dispatcher ─────────────────────────────────────────────────

async function fetchNews(market: Market, reportDate: string): Promise<ReportNewsBlock> {
  return market === "us" ? fetchUsNews(reportDate) : fetchKrNews(reportDate);
}

function formatPercent(value: number | null) {
  if (value == null) return "조회 불가";
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
}

function toneForPercent(value: number | null): ReportTone {
  if (value == null) return "normal";
  if (value > 0) return "positive";
  if (value < 0) return "negative";
  return "normal";
}

function directionFromMoves(moves: Move[]) {
  const available = moves.filter((item) => item.changePercent != null);
  const positive = available.filter((item) => (item.changePercent ?? 0) > 0).length;
  const negative = available.filter((item) => (item.changePercent ?? 0) < 0).length;
  if (positive > negative) return "상승 우위";
  if (negative > positive) return "하락 우위";
  return "혼조";
}

function marketLabel(market: Market) {
  return market === "us" ? "미국 주요 지수" : "국내 주요 지수";
}

function pickMarketCauseSource(news: ReportNewsBlock) {
  if (news.status !== "available") return undefined;
  return news.items.find((item) => {
    const haystack = `${item.title} ${item.summary}`.toLowerCase();
    return marketReactionKeywords.some((keyword) => haystack.includes(keyword.toLowerCase()));
  });
}

function buildIndexOverview(market: Market, indices: Move[], news: ReportNewsBlock): ReportNarrativePoint {
  const available = indices.filter((item) => item.status === "available" && item.changePercent != null && (market === "kr" || item.label !== "SOX"));
  if (!available.length) {
    return { text: `${marketLabel(market)}를 조회하지 못했어요.`, spans: [{ text: `${marketLabel(market)}를 조회하지 못했어요.` }], sources: [] };
  }

  const direction = directionFromMoves(available);
  const spans: ReportSpan[] = [
    { text: `${marketLabel(market)}는 ${direction}였어요. ` },
  ];
  available.forEach((item, index) => {
    spans.push({ text: `${item.label} ` });
    spans.push({ text: formatPercent(item.changePercent), tone: toneForPercent(item.changePercent) });
    spans.push({ text: index === available.length - 1 ? "를 기록했어요." : ", " });
  });
  return { text: spans.map((span) => span.text).join(""), spans, sources: [] };
}

function strongestWeakest(moves: Move[]) {
  const available = moves.filter((item) => item.changePercent != null);
  if (available.length < 2) return null;
  const sorted = [...available].sort((a, b) => (b.changePercent ?? 0) - (a.changePercent ?? 0));
  if (sorted[0].label === sorted[sorted.length - 1].label) return null;
  return { strongest: sorted[0], weakest: sorted[sorted.length - 1] };
}

function keywordsForMove(move: Move) {
  const base = [move.label, move.symbol || ""].filter(Boolean);
  return [...base, ...(sectorKeywords[move.label] || [])].map((item) => item.toLowerCase());
}

function findMoveSource(move: Move, newsItems: ReportSource[]) {
  const keywords = keywordsForMove(move);
  return newsItems.find((item) => {
    const haystack = `${item.title} ${item.summary}`.toLowerCase();
    return keywords.some((keyword) => keyword && haystack.includes(keyword));
  });
}

function topicLabel(label: string) {
  const last = label.charCodeAt(label.length - 1);
  if (last >= 0xac00 && last <= 0xd7a3) return label + (((last - 0xac00) % 28) === 0 ? "는" : "은");
  return label + (/a$/i.test(label) ? "는" : "은");
}

function buildMoveSentence(move: Move, newsItems: ReportSource[], kind: "sector" | "stock"): ReportNarrativePoint {
  const source = findMoveSource(move, newsItems);
  const isPositive = (move.changePercent ?? 0) >= 0;
  const directionText = kind === "sector" ? (isPositive ? "강세" : "약세") : (isPositive ? "상승" : "하락");
  const noun = kind === "sector" ? `${move.label} 업종은` : topicLabel(move.label);
  const spans: ReportSpan[] = source ? [
    { text: source.summary, tone: "keyword" },
    { text: ` ${noun} ` },
    { text: formatPercent(move.changePercent), tone: toneForPercent(move.changePercent) },
    { text: kind === "sector" ? ` ${directionText}를 보였어요.` : ` ${directionText}했어요.` },
  ] : [
    { text: `${noun} ` },
    { text: formatPercent(move.changePercent), tone: toneForPercent(move.changePercent) },
    { text: kind === "sector" ? ` ${directionText}를 보였어요.` : ` ${directionText}했어요.` },
  ];
  return { text: spans.map((span) => span.text).join(""), spans, sources: source ? [source] : [] };
}

export async function buildMarketNarrative(params: { market: Market; reportDate: string; indices: Move[]; sectors: Move[]; stocks: Move[] }): Promise<MarketReportNarrative> {
  const news = await fetchNews(params.market, params.reportDate);
  const sectorPair = strongestWeakest(params.sectors);
  const stockPair = strongestWeakest(params.stocks);
  const narrative: MarketReportNarrative = {
    indexOverview: buildIndexOverview(params.market, params.indices, news),
    news,
    sectors: sectorPair ? {
      positive: buildMoveSentence(sectorPair.strongest, news.items, "sector"),
      negative: buildMoveSentence(sectorPair.weakest, news.items, "sector"),
    } : { message: "강세/약세 업종 비교는 2개 이상 조회된 경우에만 표시됩니다." },
    stocks: stockPair ? {
      positive: buildMoveSentence(stockPair.strongest, news.items, "stock"),
      negative: buildMoveSentence(stockPair.weakest, news.items, "stock"),
    } : { message: "주요 강세/약세 종목 비교는 2개 이상 조회된 경우에만 표시됩니다." },
    sources: [],
  };

  const sourceMap = new Map<string, ReportSource>();
  for (const source of [
    ...narrative.indexOverview.sources,
    ...narrative.news.items,
    ...(narrative.sectors.positive?.sources || []),
    ...(narrative.sectors.negative?.sources || []),
    ...(narrative.stocks.positive?.sources || []),
    ...(narrative.stocks.negative?.sources || []),
  ]) {
    sourceMap.set(`${source.title}|${source.publisher}|${source.url}`, source);
  }
  narrative.sources = Array.from(sourceMap.values());
  return narrative;
}

export function narrativeToBullets(narrative: MarketReportNarrative) {
  const bullets = [narrative.indexOverview.text];
  if (narrative.news.status === "available") bullets.push(...narrative.news.items.slice(0, 3).map((item) => `주요 뉴스: ${item.summary}`));
  else bullets.push(narrative.news.message);
  if (narrative.sectors.positive) bullets.push(narrative.sectors.positive.text);
  if (narrative.sectors.negative) bullets.push(narrative.sectors.negative.text);
  if (narrative.sectors.message) bullets.push(narrative.sectors.message);
  if (narrative.stocks.positive) bullets.push(narrative.stocks.positive.text);
  if (narrative.stocks.negative) bullets.push(narrative.stocks.negative.text);
  if (narrative.stocks.message) bullets.push(narrative.stocks.message);
  return bullets;
}




