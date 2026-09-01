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
  priority: number;
};

const DEFAULT_REASON = "뚜렷한 단일 재료는 확인되지 않았어요.";

const usFeeds: FeedConfig[] = [
  { url: "https://www.federalreserve.gov/feeds/press_all.xml", publisher: "Federal Reserve", priority: 3 },
  { url: "https://www.bls.gov/feed/bls_latest.rss", publisher: "BLS", priority: 3 },
  { url: "https://news.google.com/rss/search?q=Reuters%20CNBC%20MarketWatch%20US%20stocks%20Treasury%20yields%20Fed%20CPI%20jobs&hl=en-US&gl=US&ceid=US:en", publisher: "Google News", priority: 2 },
];

const krFeeds: FeedConfig[] = [
  { url: "https://www.bok.or.kr/portal/bbs/B0000552/news.rss?menuNo=200690", publisher: "한국은행", priority: 3 },
  { url: "https://www.bok.or.kr/portal/bbs/P0000559/news.rss?menuNo=200690", publisher: "한국은행", priority: 3 },
  { url: "https://news.google.com/rss/search?q=%ED%95%9C%EA%B5%AD%20%EC%A6%9D%EC%8B%9C%20%EC%BD%94%EC%8A%A4%ED%94%BC%20%EC%BD%94%EC%8A%A4%EB%8B%A5%20%EA%B8%88%EB%A6%AC%20%ED%99%98%EC%9C%A8%20%EC%8B%9C%ED%99%A9&hl=ko&gl=KR&ceid=KR:ko", publisher: "Google News", priority: 2 },
];

const importantKeywords = [
  "FOMC", "Fed rate", "Federal Reserve rate", "monetary", "minutes", "Powell", "rate cut", "rate hike", "interest rate", "yield", "Treasury yield", "CPI", "inflation", "jobs", "employment", "payroll", "GDP", "PCE", "tariff", "policy", "stocks", "stock market", "market today",
  "금리", "금통위", "통화정책", "한국은행", "물가", "고용", "환율", "정부", "정책", "증시", "코스피", "코스닥", "채권", "외국인",
];

const lowImpactNewsKeywords = [
  "enforcement", "former employee", "application by", "approval of application", "termination of enforcement", "consent order", "banking application", "regulatory action",
  "제재", "임직원", "인사", "입찰", "채용",
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

function decodeXml(text: string) {
  return text
    .replace(/<!\[CDATA\[(.*?)\]\]>/gs, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/<[^>]*>/g, "")
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

function parseRss(xml: string, feed: FeedConfig): ReportSource[] {
  const itemRegex = /<item[\s\S]*?<\/item>/gi;
  const items = xml.match(itemRegex) || [];
  return items.map((itemXml) => {
    const source = extractSource(itemXml, feed.publisher);
    const rawTitle = extractTag(itemXml, "title");
    const title = normalizeGoogleTitle(rawTitle, feed.publisher);
    const publishedAt = extractTag(itemXml, "pubDate") || extractTag(itemXml, "dc:date");
    const link = extractTag(itemXml, "link");
    return {
      title,
      publisher: source || feed.publisher,
      publishedAt: publishedAt ? new Date(publishedAt).toISOString() : "",
      url: link,
    };
  }).filter((item) => item.title && item.url);
}

function isImportantNews(item: ReportSource) {
  const haystack = `${item.title} ${item.publisher}`.toLowerCase();
  if (lowImpactNewsKeywords.some((keyword) => haystack.includes(keyword.toLowerCase()))) return false;
  return importantKeywords.some((keyword) => haystack.includes(keyword.toLowerCase()));
}

async function fetchFeed(feed: FeedConfig): Promise<ReportSource[]> {
  const response = await fetch(feed.url, { cache: "no-store", headers: { "User-Agent": "SodaPop-MarketReport/1.0" } });
  if (!response.ok) throw new Error(`${feed.publisher} RSS HTTP ${response.status}`);
  return parseRss(await response.text(), feed);
}

async function fetchNews(market: Market): Promise<ReportNewsBlock> {
  const feeds = market === "us" ? usFeeds : krFeeds;
  const results = await Promise.allSettled(feeds.map(fetchFeed));
  const failures = results
    .filter((result): result is PromiseRejectedResult => result.status === "rejected")
    .map((result) => result.reason instanceof Error ? result.reason.message : String(result.reason));
  const items = results
    .filter((result): result is PromiseFulfilledResult<ReportSource[]> => result.status === "fulfilled")
    .flatMap((result) => result.value);

  const seen = new Set<string>();
  const selected = items
    .filter(isImportantNews)
    .filter((item) => {
      const key = `${item.title}|${item.publisher}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => {
      const aOfficial = a.publisher.includes("Federal Reserve") || a.publisher.includes("BLS") || a.publisher.includes("한국은행") ? 1 : 0;
      const bOfficial = b.publisher.includes("Federal Reserve") || b.publisher.includes("BLS") || b.publisher.includes("한국은행") ? 1 : 0;
      if (aOfficial !== bOfficial) return bOfficial - aOfficial;
      return (Date.parse(b.publishedAt) || 0) - (Date.parse(a.publishedAt) || 0);
    })
    .slice(0, 5);

  if (selected.length) return { status: "available", message: "", items: selected };
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

function buildIndexOverview(market: Market, indices: Move[], news: ReportNewsBlock): ReportNarrativePoint {
  const available = indices.filter((item) => item.status === "available" && item.changePercent != null && (market === "kr" || item.label !== "SOX"));
  if (!available.length) {
    return { text: `${marketLabel(market)}를 조회하지 못했어요.`, spans: [{ text: `${marketLabel(market)}를 조회하지 못했어요.` }], sources: [] };
  }

  const leadSource = news.status === "available" ? news.items[0] : undefined;
  const direction = directionFromMoves(available);
  const spans: ReportSpan[] = leadSource ? [
    { text: leadSource.title, tone: "keyword" },
    { text: ` 이슈를 확인하는 가운데 ${marketLabel(market)}는 ${direction}였어요. ` },
  ] : [
    { text: DEFAULT_REASON, tone: "normal" },
    { text: ` ${marketLabel(market)}는 ${direction}였어요. ` },
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
    const title = item.title.toLowerCase();
    return keywords.some((keyword) => keyword && title.includes(keyword));
  });
}

function buildMoveSentence(move: Move, newsItems: ReportSource[], kind: "sector" | "stock"): ReportNarrativePoint {
  const source = findMoveSource(move, newsItems);
  const directionText = (move.changePercent ?? 0) >= 0 ? "강세" : "약세";
  const reason = source ? `${source.title} 이슈가 확인되며` : DEFAULT_REASON;
  const noun = kind === "sector" ? `${move.label} 업종은` : `${move.label}는`;
  const spans: ReportSpan[] = [
    { text: reason, tone: source ? "keyword" : "normal" },
    { text: ` ${noun} ` },
    { text: formatPercent(move.changePercent), tone: toneForPercent(move.changePercent) },
    { text: ` ${directionText}를 보였어요.` },
  ];
  return { text: spans.map((span) => span.text).join(""), spans, sources: source ? [source] : [] };
}

export async function buildMarketNarrative(params: { market: Market; reportDate: string; indices: Move[]; sectors: Move[]; stocks: Move[] }): Promise<MarketReportNarrative> {
  const news = await fetchNews(params.market);
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
  if (narrative.news.status === "available") bullets.push(...narrative.news.items.slice(0, 3).map((item) => `주요 뉴스: ${item.title}`));
  else bullets.push(narrative.news.message);
  if (narrative.sectors.positive) bullets.push(narrative.sectors.positive.text);
  if (narrative.sectors.negative) bullets.push(narrative.sectors.negative.text);
  if (narrative.sectors.message) bullets.push(narrative.sectors.message);
  if (narrative.stocks.positive) bullets.push(narrative.stocks.positive.text);
  if (narrative.stocks.negative) bullets.push(narrative.stocks.negative.text);
  if (narrative.stocks.message) bullets.push(narrative.stocks.message);
  return bullets;
}

