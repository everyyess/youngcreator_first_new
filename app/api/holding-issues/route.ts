import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  fetchKoreanNews,
  fetchForeignNews,
  type StockNewsItem,
} from "../stock-news/route";
import {
  fetchDartCached,
  type DartDisclosure,
} from "../dart-disclosures/route";

export const runtime = "nodejs";

const PRICE_ISSUE_THRESHOLD = 5;

const YAHOO_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  Accept: "application/json, text/plain, */*",
  "Accept-Language": "en-US,en;q=0.9",
};

type PortfolioAsset = {
  name?: string;
  ticker?: string;
  productType?: string;
  country?: string;
  amount?: number;
};

type CustomerRow = {
  id: string;
  name?: string | null;
  profile?: unknown;
  customer_data?: unknown;
  data?: unknown;
  app_data?: unknown;
  state?: unknown;
};

type Holder = {
  customerId: string;
  customerName: string;
  birthDate?: string;
};

type HoldingGroup = {
  ticker: string;
  name: string;
  market: "kr" | "us";
  holders: Holder[];
};

type PriceIssue = HoldingGroup & {
  issueType: "price";
  changePercent: number;
  previousClose: number;
  latestClose: number;
  previousDate: string;
  latestDate: string;
  summary: string;
};

function getObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : null;
}

function getCustomerName(row: CustomerRow): string {
  if (typeof row.name === "string" && row.name.trim()) {
    return row.name.trim();
  }

  const directProfile = getObject(row.profile);

  if (typeof directProfile?.name === "string" && directProfile.name.trim()) {
    return directProfile.name.trim();
  }

  const bundledData =
    getObject(row.customer_data) ??
    getObject(row.data) ??
    getObject(row.app_data) ??
    getObject(row.state);

  const bundledProfile = getObject(bundledData?.profile);

  if (
    typeof bundledProfile?.name === "string" &&
    bundledProfile.name.trim()
  ) {
    return bundledProfile.name.trim();
  }

  return "이름 없음";
}

function detectMarket(ticker: string): "kr" | "us" | null {
  const normalized = ticker.trim().toUpperCase();

  if (/^\d{6}\.(KS|KQ)$/.test(normalized)) {
    return "kr";
  }

  if (/^[A-Z][A-Z0-9.-]{0,9}$/.test(normalized)) {
    return "us";
  }

  return null;
}

async function fetchYahooDailyPrices(
  ticker: string,
): Promise<
  {
    date: string;
    close: number;
  }[]
> {
  try {
    const period2 = Math.floor(Date.now() / 1000);
    const period1 = period2 - 10 * 24 * 60 * 60;

    const url =
      `https://query1.finance.yahoo.com/v8/finance/chart/` +
      `${encodeURIComponent(ticker)}` +
      `?period1=${period1}` +
      `&period2=${period2}` +
      `&interval=1d` +
      `&events=history` +
      `&includePrePost=false`;

    const response = await fetch(url, {
      headers: YAHOO_HEADERS,
      signal: AbortSignal.timeout(12000),
      cache: "no-store",
    });

    if (!response.ok) {
      return [];
    }

    const json = (await response.json()) as {
      chart?: {
        result?: Array<{
          timestamp?: number[];
          indicators?: {
            quote?: Array<{
              close?: (number | null)[];
            }>;
          };
        }>;
      };
    };

    const result = json.chart?.result?.[0];

    if (!result?.timestamp?.length) {
      return [];
    }

    const closes = result.indicators?.quote?.[0]?.close ?? [];

    return result.timestamp
      .map((timestamp, index) => ({
        date: new Date(timestamp * 1000).toISOString().slice(0, 10),
        close: closes[index],
      }))
      .filter(
        (
          item,
        ): item is {
          date: string;
          close: number;
        } => typeof item.close === "number" && Number.isFinite(item.close),
      );
  } catch {
    return [];
  }
}

async function detectPriceIssue(
  holding: HoldingGroup,
): Promise<PriceIssue | null> {
  const prices = await fetchYahooDailyPrices(holding.ticker);

  if (prices.length < 2) {
    return null;
  }

  const previous = prices[prices.length - 2];
  const latest = prices[prices.length - 1];

  if (!previous.close) {
    return null;
  }

  const changePercent =
    ((latest.close - previous.close) / previous.close) * 100;

  if (Math.abs(changePercent) < PRICE_ISSUE_THRESHOLD) {
    return null;
  }

  const direction = changePercent >= 0 ? "급등" : "급락";

  return {
    ...holding,
    issueType: "price",
    changePercent: Number(changePercent.toFixed(2)),
    previousClose: previous.close,
    latestClose: latest.close,
    previousDate: previous.date,
    latestDate: latest.date,
    summary: `${holding.name}이(가) 전 거래일 대비 ${Math.abs(
      changePercent,
    ).toFixed(2)}% ${direction}했습니다.`,
  };
}

type NewsIssue = HoldingGroup & {
  issueType: "news";
  title: string;
  url: string;
  source?: string;
  publishedAt?: string;
  summary: string;
};

type DisclosureIssue = HoldingGroup & {
  issueType: "disclosure";
  title: string;
  url: string;
  publishedAt: string;
  source: "DART";
  summary: string;
};

function getDartToday(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  })
    .format(new Date())
    .replace(/-/g, ".");
}

async function detectDisclosureIssues(
  holding: HoldingGroup,
): Promise<DisclosureIssue[]> {
  if (holding.market !== "kr") {
    return [];
  }

  try {
    const code = holding.ticker.replace(/\.(KS|KQ)$/i, "");
    const data = await fetchDartCached(code);

    const disclosures: DartDisclosure[] = [
      ...data.contracts,
      ...data.stakes,
      ...data.insiders,
      ...data.earnings,
      ...data.agreements,
    ];

    const today = getDartToday();
    const seen = new Set<string>();
    const results: DisclosureIssue[] = [];

    for (const disclosure of disclosures) {
      if (disclosure.date !== today) continue;
      if (seen.has(disclosure.rcpNo)) continue;

      seen.add(disclosure.rcpNo);

      results.push({
        ...holding,
        issueType: "disclosure",
        title: disclosure.title,
        url: disclosure.url,
        publishedAt: disclosure.date,
        source: "DART",
        summary: disclosure.title,
      });

      if (results.length >= 3) {
        break;
      }
    }

    return results;
  } catch (error) {
    console.warn(
      `[holding-issues] DART failed for ${holding.ticker}:`,
      error,
    );
    return [];
  }
}
const IMPORTANT_NEWS_KEYWORDS_KR = [
  "실적",
  "영업이익",
  "매출",
  "가이던스",
  "전망",
  "배당",
  "특별배당",
  "자사주",
  "자기주식",
  "소각",
  "주주환원",
  "수주",
  "공급계약",
  "계약",
  "인수",
  "합병",
  "분할",
  "유상증자",
  "무상증자",
  "전환사채",
  "신주",
  "최대주주",
  "지분",
  "투자",
  "증설",
  "공장",
  "규제",
  "제재",
  "소송",
  "리콜",
  "승인",
  "허가",
  "임상",
];

const IMPORTANT_NEWS_KEYWORDS_US = [
  "earnings",
  "revenue",
  "profit",
  "guidance",
  "forecast",
  "dividend",
  "special dividend",
  "buyback",
  "repurchase",
  "shareholder return",
  "acquisition",
  "acquire",
  "merger",
  "spin-off",
  "contract",
  "order",
  "deal",
  "investment",
  "factory",
  "plant",
  "capex",
  "lawsuit",
  "regulator",
  "antitrust",
  "probe",
  "investigation",
  "approval",
  "recall",
  "offering",
  "issuance",
  "stake",
];

function normalizeKoreanNewsDate(value?: string): string | null {
  if (!value) return null;

  const match = value.match(
    /(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})/,
  );

  if (!match) return null;

  const [, year, month, day] = match;

  return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
}

function getKoreanToday(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function getNewYorkDate(value: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(value);
}

function titleMentionsHolding(holding: HoldingGroup, title: string): boolean {
  const normalizedTitle = title.toLowerCase();

  const aliases: Record<string, string[]> = {
    NAVER: ["naver", "네이버"],
    LG에너지솔루션: ["lg에너지솔루션", "lg엔솔"],
  };

  const candidates = aliases[holding.name] ?? [holding.name];

  return candidates.some((candidate) =>
    normalizedTitle.includes(candidate.toLowerCase()),
  );
}

function isImportantNews(
  item: StockNewsItem,
  market: "kr" | "us",
): boolean {
  const text = `${item.title} ${item.preview}`.toLowerCase();

  const keywords =
    market === "kr"
      ? IMPORTANT_NEWS_KEYWORDS_KR
      : IMPORTANT_NEWS_KEYWORDS_US;

  return keywords.some((keyword) =>
    text.includes(keyword.toLowerCase()),
  );
}

const GEMINI_MODELS = [
  "gemini-3.1-flash-lite",
  "gemini-1.5-flash",
  "gemini-2.5-flash-lite",
  "gemini-2.5-flash",
] as const;

async function isDirectlyRelevantHoldingNews(
  holding: HoldingGroup,
  item: StockNewsItem,
): Promise<boolean> {
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    return true;
  }

  const titleHasHoldingName = titleMentionsHolding(holding, item.title);

  const prompt = `당신은 증권사 PB를 위한 보유종목 뉴스 필터입니다.

보유종목: ${holding.name}
티커: ${holding.ticker}
기사 제목: ${item.title}
기사 내용: ${item.preview || "없음"}

이 기사가 "${holding.name}" 보유 고객에게 알려줄 만한
해당 기업의 직접적이고 중요한 이슈인지 판단하세요.

포함:
- 해당 기업의 실적, 매출, 이익, 전망
- 수주, 공급계약, 투자, 인수합병
- 배당, 자사주, 주주환원
- 경영진, 지배구조, 규제, 소송
- 해당 기업의 사업이나 주가에 직접적인 영향을 줄 수 있는 중요한 사건
- 기사 제목에 ${holding.name}이 직접 등장하고, 해당 기업 자체의 중요한 사건인 경우
- 제목에 보유종목명이 직접 등장하지 않는 경우에는 해당 기업의 실적·사업·계약·투자·경영에 직접적이고 중대한 영향이 기사 내용상 명확할 때만 YES
- 단순 수혜·피해 가능성, 업종 영향, 거래관계, 시장 전반 영향, 여러 기업 중 하나로 언급된 경우는 NO
- 기업명은 정확히 구분하세요. 삼성전기, 삼성전자, 삼성SDS처럼 같은 그룹 또는 비슷한 이름의 다른 회사는 서로 다른 기업입니다.

제외:
- ${holding.name}이 기사에서 단순 비교 대상으로만 언급됨
- 여러 기업을 나열하면서 이름만 잠깐 등장함
- 경쟁사나 계열사가 기사의 실질적인 주인공이고 ${holding.name}과의 관련성이 부수적임
- 업종이나 시장 전반 기사에서 ${holding.name}이 예시로만 등장함

반드시 YES 또는 NO 중 하나만 출력하세요.`;

  const requestBody = {
    contents: [
      {
        parts: [{ text: prompt }],
      },
    ],
    generationConfig: {
      temperature: 0,
      maxOutputTokens: 5,
    },
  };

  for (const model of GEMINI_MODELS) {
    try {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(requestBody),
          signal: AbortSignal.timeout(12000),
        },
      );

      if (!response.ok) continue;

      const data = (await response.json()) as {
        candidates?: Array<{
          content?: {
            parts?: Array<{ text?: string }>;
          };
        }>;
      };

      const result =
        data.candidates?.[0]?.content?.parts?.[0]?.text
          ?.trim()
          .toUpperCase();

      if (result?.startsWith("YES")) return true;
      if (result?.startsWith("NO")) return false;
    } catch {
      continue;
    }
  }

  return true;
}
async function summarizeEnglishHoldingNews(
  holding: HoldingGroup,
  item: StockNewsItem,
): Promise<string | null> {
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    console.warn("[holding-issues] GEMINI_API_KEY missing");
    return null;
  }

  type GeminiData = {
    candidates?: Array<{
      content?: {
        parts?: Array<{ text?: string }>;
      };
      finishReason?: string;
    }>;
    error?: {
      message?: string;
    };
  };

  async function requestGemini(prompt: string): Promise<string | null> {
    const requestBody = {
      contents: [
        {
          parts: [{ text: prompt }],
        },
      ],
      generationConfig: {
        temperature: 0.1,
        maxOutputTokens: 180,
      },
    };

    for (const model of GEMINI_MODELS) {
      try {
        const geminiUrl =
          `https://generativelanguage.googleapis.com/v1beta/models/` +
          `${model}:generateContent?key=${apiKey}`;

        const response = await fetch(geminiUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(requestBody),
          signal: AbortSignal.timeout(12000),
        });

        if (!response.ok) {
          const errorText = await response.text();

          console.warn(
            `[holding-issues] Gemini ${model} failed: ${response.status} ${errorText.slice(0, 300)}`,
          );

          continue;
        }

        const data = (await response.json()) as GeminiData;

        const result =
          data.candidates?.[0]?.content?.parts?.[0]?.text
            ?.replace(/^["'“”]+|["'“”]+$/g, "")
            .replace(/\s+/g, " ")
            .trim();

        if (!result) {
          console.warn(
            `[holding-issues] Gemini ${model} returned empty result`,
          );
          continue;
        }

        if (!/[가-힣]/.test(result)) {
          console.warn(
            `[holding-issues] Gemini ${model} returned non-Korean result: ${result.slice(0, 200)}`,
          );
          continue;
        }

        return result;
      } catch {
        continue;
      }
    }

    return null;
  }

  // 1차: PB가 바로 읽을 수 있는 구체적인 한 줄 요약
  const summaryPrompt = `당신은 PB를 위한 해외 보유종목 뉴스 요약 어시스턴트입니다.

종목명: ${holding.name}
티커: ${holding.ticker}
기사 제목: ${item.title}
추가 정보: ${item.preview || "없음"}

위 뉴스의 핵심 내용을 한국어 한 문장으로 요약하세요.

규칙:
- 기사에서 실제로 말하는 구체적인 사건, 변화, 비교 대상을 반드시 살리세요.
- "관련 뉴스가 나왔습니다", "주요 뉴스입니다", "실적 관련 소식입니다"처럼 내용 없는 문장은 금지합니다.
- 기사 제목에 비교 대상이 있으면 비교 대상을 모두 포함하세요.
- 숫자나 기업명이 있으면 가능한 한 유지하세요.
- 추측하거나 새로운 사실을 만들지 마세요.
- 100자 이내의 자연스러운 한국어 한 문장만 출력하세요.`;

  const summary = await requestGemini(summaryPrompt);

  if (summary) {
    return summary;
  }

  // 2차: 요약이 실패하면 제목 자체를 충실하게 한국어로 번역
  const translationPrompt = `다음 영문 금융 뉴스 제목을 자연스러운 한국어 한 문장으로 번역하세요.

종목명: ${holding.name}
영문 제목: ${item.title}

규칙:
- 원문의 구체적인 의미를 빠뜨리지 마세요.
- 기업명과 비교 대상은 그대로 유지하세요.
- "관련 뉴스가 나왔습니다" 같은 일반적인 표현으로 바꾸지 마세요.
- 원문에 없는 내용을 추가하지 마세요.
- 번역문 한 문장만 출력하세요.`;

  return requestGemini(translationPrompt);
}
function normalizeNewsTitleForDedup(title: string): string {
  return title
    .toLowerCase()
    .replace(/[“”"'‘’]/g, "")
    .replace(/[^a-z0-9가-힣\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function getNewsTitleTokens(title: string): string[] {
  const stopWords = new Set([
    "관련",
    "가능",
    "전망",
    "주요",
    "뉴스",
    "보도",
    "오늘",
    "올해",
    "연내",
    "대한",
    "통해",
    "위해",
    "the",
    "and",
    "for",
    "with",
    "from",
    "this",
    "that",
  ]);

  return normalizeNewsTitleForDedup(title)
    .split(" ")
    .map((token) => token.trim())
    .filter(
      (token) =>
        token.length >= 2 &&
        !stopWords.has(token),
    );
}

function tokenOverlapRatio(a: string, b: string): number {
  const left = new Set(getNewsTitleTokens(a));
  const right = new Set(getNewsTitleTokens(b));

  if (left.size === 0 || right.size === 0) {
    return 0;
  }

  let overlap = 0;

  for (const token of left) {
    if (right.has(token)) {
      overlap += 1;
    }
  }

  return overlap / Math.min(left.size, right.size);
}

function isSimilarNewsTitle(a: string, b: string): boolean {
  const left = normalizeNewsTitleForDedup(a).replace(/\s/g, "");
  const right = normalizeNewsTitleForDedup(b).replace(/\s/g, "");

  if (!left || !right) return false;
  if (left === right) return true;

  const shorter = left.length <= right.length ? left : right;
  const longer = left.length > right.length ? left : right;

  if (
    shorter.length >= 12 &&
    longer.includes(
      shorter.slice(0, Math.floor(shorter.length * 0.6)),
    )
  ) {
    return true;
  }

  return tokenOverlapRatio(a, b) >= 0.55;
}

function dedupeNewsItems(items: StockNewsItem[]): StockNewsItem[] {
  const result: StockNewsItem[] = [];

  for (const item of items) {
    const duplicated = result.some((existing) =>
      isSimilarNewsTitle(existing.title, item.title),
    );

    if (!duplicated) {
      result.push(item);
    }
  }

  return result;
}
async function detectNewsIssues(
  holding: HoldingGroup,
  latestPriceDate?: string,
): Promise<NewsIssue[]> {
  let news: StockNewsItem[] = [];

  try {
    if (holding.market === "kr") {
      const code = holding.ticker.replace(/\.(KS|KQ)$/i, "");
      news = await fetchKoreanNews(code);
    } else {
      news = await fetchForeignNews(holding.ticker);
    }
  } catch {
    return [];
  }

  const filtered = news.filter((item) => {
    if (!item.publishedAt) return false;

    if (holding.market === "kr") {
      const publishedDate = normalizeKoreanNewsDate(item.publishedAt);
      return publishedDate === getKoreanToday() && titleMentionsHolding(holding, item.title);
    }

    const publishedDate = new Date(item.publishedAt);

    if (Number.isNaN(publishedDate.getTime())) return false;

    const targetDate =
      latestPriceDate ??
      getNewYorkDate(
        new Date(Date.now() - 24 * 60 * 60 * 1000),
      );

    return (
      getNewYorkDate(publishedDate) === targetDate &&
      isImportantNews(item, "us")
    );
  });
  const deduped = dedupeNewsItems(filtered);

  if (holding.market === "kr") {
    const relevanceCandidates = deduped.slice(0, 10);

    const relevanceResults = await mapWithConcurrency(
      relevanceCandidates,
      2,
      async (item) => ({
        item,
        relevant: await isDirectlyRelevantHoldingNews(
          holding,
          item,
        ),
      }),
    );

    return relevanceResults
      .filter(({ relevant }) => relevant)
      .slice(0, 3)
      .map(({ item }) => ({
        ...holding,
        issueType: "news" as const,
        title: item.title,
        url: item.url,
        source: item.source,
        publishedAt: item.publishedAt,
        summary: item.title,
      }));
  }

  const candidates = deduped.slice(0, 3);

  const summarized: (NewsIssue | null)[] = await mapWithConcurrency(
    candidates,
    2,
    async (item) => {
      const summary = await summarizeEnglishHoldingNews(
        holding,
        item,
      );

      if (!summary) {
        return null;
      }

      return {
        ...holding,
        issueType: "news" as const,
        title: item.title,
        url: item.url,
        source: item.source,
        publishedAt: item.publishedAt,
        summary,
      } satisfies NewsIssue;
    },
  );

  return summarized.filter(
    (item): item is NewsIssue => item !== null,
  );
}
async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;

  async function worker() {
    while (true) {
      const currentIndex = nextIndex++;

      if (currentIndex >= items.length) {
        return;
      }

      results[currentIndex] = await mapper(items[currentIndex]);
    }
  }

  await Promise.all(
    Array.from(
      { length: Math.min(concurrency, items.length) },
      () => worker(),
    ),
  );

  return results;
}

export async function GET(request: Request) {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !serviceRoleKey) {
      return NextResponse.json(
        { error: "Supabase environment variables are missing." },
        { status: 500 },
      );
    }

    const url = new URL(request.url);
    const pbId = (url.searchParams.get("pbId") ?? "").trim();
    const pbEmployeeId = (url.searchParams.get("pbEmployeeId") ?? "").trim();

    if (!pbId && !pbEmployeeId) {
      return NextResponse.json(
        { error: "PB identifier is required." },
        { status: 400 },
      );
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey);

    let customerQuery = supabase.from("customers").select("*");

    if (pbId) {
      customerQuery = customerQuery.eq("pb_id", pbId);
    } else {
      customerQuery = customerQuery.eq("pb_employee_id", pbEmployeeId);
    }

    const { data: customers, error: customerError } =
      await customerQuery;

    if (customerError) {
      throw new Error(customerError.message);
    }

    const customerIds = ((customers ?? []) as CustomerRow[])
      .map((customer) => String(customer.id))
      .filter(Boolean);

    if (customerIds.length === 0) {
      return NextResponse.json({
        holdingCount: 0,
        issueCount: 0,
        thresholdPercent: PRICE_ISSUE_THRESHOLD,
        items: [],
      });
    }

    const { data: portfolios, error: portfolioError } =
      await supabase
        .from("rebalancing_state")
        .select("customer_id,portfolio_assets")
        .in("customer_id", customerIds);

    if (portfolioError) {
      throw new Error(portfolioError.message);
    }

    const customerNameById = new Map<string, string>(
      ((customers ?? []) as CustomerRow[]).map((customer) => [
        String(customer.id),
        getCustomerName(customer),
      ]),
    );

    const { data: authProfiles, error: authProfilesError } = await supabase
      .from("auth_profiles")
      .select("customer_id,birth_date")
      .in("customer_id", customerIds);

    if (authProfilesError) {
      throw new Error(authProfilesError.message);
    }

    const customerBirthDateById = new Map<string, string>(
      (authProfiles ?? [])
        .filter((profile) => profile.customer_id)
        .map((profile) => [
          String(profile.customer_id),
          typeof profile.birth_date === "string"
            ? profile.birth_date.trim()
            : "",
        ]),
    );

    const groups = new Map<string, HoldingGroup>();

    for (const row of portfolios ?? []) {
      const customerId = String(row.customer_id ?? "");

      if (!customerId) continue;

      const customerName =
        customerNameById.get(customerId) ?? "이름 없음";
      const birthDate = customerBirthDateById.get(customerId) ?? "";

      const assets = Array.isArray(row.portfolio_assets)
        ? (row.portfolio_assets as PortfolioAsset[])
        : [];

      for (const asset of assets) {
        const ticker = (asset.ticker ?? "").trim();
        const name = (asset.name ?? "").trim();

        if (!ticker) continue;

        const market = detectMarket(ticker);

        if (!market) continue;

        const normalizedTicker = ticker.toUpperCase();
        const key = `${market}:${normalizedTicker}`;

        const existing = groups.get(key);

        if (existing) {
          const alreadyExists = existing.holders.some(
            (holder) => holder.customerId === customerId,
          );

          if (!alreadyExists) {
            existing.holders.push({
              customerId,
              customerName,
              birthDate,
            });
          }

          continue;
        }

        groups.set(key, {
          ticker: normalizedTicker,
          name: name || normalizedTicker,
          market,
          holders: [
            {
              customerId,
              customerName,
              birthDate,
            },
          ],
        });
      }
    }

    const holdings = Array.from(groups.values());

    console.log("[holding-issues] customers:", customerIds.length);
    console.log("[holding-issues] portfolios:", (portfolios ?? []).length);
    console.log("[holding-issues] holdings:", holdings.length);

    const priceDetected = await mapWithConcurrency(
      holdings,
      6,
      detectPriceIssue,
    );

    const priceIssues = priceDetected.filter(
      (issue): issue is PriceIssue => issue !== null,
    );

    const latestPriceDateByTicker = new Map(
      priceIssues.map((issue) => [
        `${issue.market}:${issue.ticker}`,
        issue.latestDate,
      ]),
    );

    const newsDetected = await mapWithConcurrency(
      holdings,
      4,
      async (holding) =>
        detectNewsIssues(
          holding,
          latestPriceDateByTicker.get(
            `${holding.market}:${holding.ticker}`,
          ),
        ),
    );

    const newsIssues = newsDetected.flat();

    const disclosureDetected = await mapWithConcurrency(
      holdings,
      3,
      async (holding) => detectDisclosureIssues(holding),
    );

    const disclosureIssues = disclosureDetected.flat();

    console.log("[holding-issues] priceIssues:", priceIssues.length);
    console.log("[holding-issues] newsIssues:", newsIssues.length);
    console.log(
      "[holding-issues] disclosureIssues:",
      disclosureIssues.length,
    );

    const issues = [
      ...priceIssues,
      ...newsIssues,
      ...disclosureIssues,
    ].sort((a, b) => {
      if (a.issueType === "price" && b.issueType !== "price") {
        return -1;
      }

      if (a.issueType !== "price" && b.issueType === "price") {
        return 1;
      }

      if (a.issueType === "price" && b.issueType === "price") {
        return (
          Math.abs(b.changePercent) -
          Math.abs(a.changePercent)
        );
      }

      return 0;
    });

    return NextResponse.json({
      holdingCount: holdings.length,
      issueCount: issues.length,
      thresholdPercent: PRICE_ISSUE_THRESHOLD,
      items: issues,
    });
  } catch (error) {
    console.error("holding-issues GET failed", error);

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to load holding issues.",
      },
      { status: 500 },
    );
  }
}