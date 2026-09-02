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

async function fetchNews(market: Market, reportDate: string): Promise<ReportNewsBlock> {
  const feeds = newsFeeds(market, reportDate);
  const results = await Promise.allSettled(feeds.map(fetchFeed));
  const failures = results
    .filter((result): result is PromiseRejectedResult => result.status === "rejected")
    .map((result) => result.reason instanceof Error ? result.reason.message : String(result.reason));
  const items = results
    .filter((result): result is PromiseFulfilledResult<ParsedNewsItem[]> => result.status === "fulfilled")
    .flatMap((result) => result.value);

  const targetItems = items.filter((item) => isNewsOnTargetDate(item, market, reportDate));
  console.info("[market-news] feed result", {
    market,
    reportDate,
    feeds: feeds.length,
    fetched: items.length,
    targetDateMatched: targetItems.length,
    failures: failures.slice(0, 3),
  });

  const seen = new Set<string>();
  const selected = targetItems
    .filter(isImportantNews)
    .filter((item) => {
      const key = `${item.title}|${item.publisher}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => {
      const scoreDiff = scoreNews(b) - scoreNews(a);
      if (scoreDiff !== 0) return scoreDiff;
      return (Date.parse(b.publishedAt) || 0) - (Date.parse(a.publishedAt) || 0);
    })
    .slice(0, 8);

  const enriched = (await Promise.all(selected.map((item) => toReportSource(item, market)))).filter((item): item is ReportSource => Boolean(item));
  const summarySeen = new Set<string>();
  const finalItems = enriched.filter((item) => {
    const key = item.summary.replace(/\s+/g, " ").trim();
    if (summarySeen.has(key)) return false;
    summarySeen.add(key);
    return true;
  }).slice(0, 5);
  if (finalItems.length) return { status: "available", message: "", items: finalItems };
  if (targetItems.length) return { status: "none", message: "대상 거래일의 주요 뉴스는 찾았지만 본문 요약에 사용할 수 있는 기사 내용이 부족했어요.", items: [] };
  if (items.length) return { status: "none", message: "오늘은 시장 방향성에 영향을 줄 만한 주요 이벤트가 없었어요.", items: [] };
  return { status: "unavailable", message: `뉴스 수집에 실패했어요.${failures.length ? " " + failures.slice(0, 2).join(" / ") : ""}`, items: [] };
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

  const leadSource = pickMarketCauseSource(news);
  const direction = directionFromMoves(available);
  const spans: ReportSpan[] = leadSource ? [
    { text: leadSource.summary, tone: "keyword" },
    { text: ` ${marketLabel(market)}는 ${direction}였어요. ` },
  ] : [
    { text: `${marketLabel(market)}는 ${direction}였어요. ` },
  ];
  available.forEach((item, index) => {
    spans.push({ text: `${item.label} ` });
    spans.push({ text: formatPercent(item.changePercent), tone: toneForPercent(item.changePercent) });
    spans.push({ text: index === available.length - 1 ? "를 기록했어요." : ", " });
  });
  return { text: spans.map((span) => span.text).join(""), spans, sources: leadSource ? [leadSource] : [] };
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




