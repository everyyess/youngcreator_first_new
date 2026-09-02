import { NextRequest, NextResponse } from "next/server";
import type { HankyungArticle } from "@/app/api/hankyung-articles/route";

export const runtime = "nodejs";
export const maxDuration = 20;

function decodeHtmlEntities(value: string) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&middot;/g, "·")
    .replace(/&lsquo;/g, "‘")
    .replace(/&rsquo;/g, "’")
    .replace(/&ldquo;/g, "“")
    .replace(/&rdquo;/g, "”")
    .replace(/&hellip;/g, "…")
    .replace(/&mdash;/g, "—")
    .replace(/&ndash;/g, "–")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
}

function stripTags(html: string): string {
  return decodeHtmlEntities(html.replace(/<[^>]+>/g, "")).trim();
}

function toIsoDate(dateTime: string): string | null {
  const m = dateTime.match(/(\d{4})\.(\d{2})\.(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

/** 한경 검색 결과의 "yyyy.mm.dd hh:mm"(KST 벽시계 기준)을 서버 타임존과 무관하게 정확한 epoch ms로 변환 */
function toEpochKst(dateTime: string): number | null {
  const m = dateTime.match(/(\d{4})\.(\d{2})\.(\d{2})\s+(\d{1,2}):(\d{2})/);
  if (!m) return null;
  const [, y, mo, d, h, min] = m;
  return Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h) - 9, Number(min));
}

function formatKoreanDateTime(dateTime: string): string {
  const m = dateTime.match(/(\d{4})\.(\d{2})\.(\d{2})\s+(\d{1,2}):(\d{2})/);
  if (!m) return dateTime.trim();
  const [, y, mo, d, h, min] = m;
  const date = new Date(Number(y), Number(mo) - 1, Number(d), Number(h), Number(min));
  return new Intl.DateTimeFormat("ko-KR", {
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: true,
    timeZone: "Asia/Seoul",
  }).format(date);
}

type SearchApiResult = {
  articles: HankyungArticle[];
  total: number;
  hasMore: boolean;
};

function parseSearchResults(html: string, page: number): SearchApiResult {
  const articles: HankyungArticle[] = [];
  const seen = new Set<string>();

  for (const liMatch of html.matchAll(/<li>([\s\S]*?)<\/li>/g)) {
    const block = liMatch[1];
    const linkMatch = block.match(/<a href="(https:\/\/www\.hankyung\.com\/article\/[^"]+)"[^>]*>\s*<em class="tit"/);
    const titleMatch = block.match(/<em class="tit"([^>]*)>([\s\S]*?)<\/em>/);
    if (!linkMatch || !titleMatch) continue;

    const url = linkMatch[1];
    if (seen.has(url)) continue;
    seen.add(url);

    const dateMatch = block.match(/<span class="date_time">([^<]+)<\/span>/);
    const dateTime = dateMatch ? dateMatch[1].trim() : "";
    // 한경 프리미엄(유료) 기사는 <em class="tit" data-pm="P9P">로 표시됨
    const premium = /data-pm="P9P"/.test(titleMatch[1]);

    articles.push({
      title: stripTags(titleMatch[2]),
      url,
      category: "search",
      time: dateTime ? formatKoreanDateTime(dateTime) : "",
      published_date: dateTime ? toIsoDate(dateTime) : null,
      ts: dateTime ? toEpochKst(dateTime) : null,
      ...(premium ? { premium: true } : {}),
    });
  }

  const totalMatch = html.match(/([\d,]+)\s*건/);
  const total = totalMatch ? parseInt(totalMatch[1].replace(/,/g, ""), 10) : articles.length;
  const hasMore = articles.length > 0 && page * 10 < total;

  return { articles, total, hasMore };
}

export async function GET(req: NextRequest) {
  const query = req.nextUrl.searchParams.get("query")?.trim() ?? "";
  // 하위 호환: 기존 단일 date 파라미터도 계속 지원
  const singleDate = req.nextUrl.searchParams.get("date") ?? "";
  const startDate = req.nextUrl.searchParams.get("startDate") || singleDate;
  const endDate = req.nextUrl.searchParams.get("endDate") || singleDate;
  const page = Math.max(1, parseInt(req.nextUrl.searchParams.get("page") ?? "1", 10) || 1);

  if (!query) {
    return NextResponse.json({ error: "검색어를 입력하세요." }, { status: 400 });
  }

  const params = new URLSearchParams({ query, page: String(page) });
  if (startDate || endDate) {
    params.set("period", "SPECIFIC");
    if (startDate) params.set("sdate", startDate.replaceAll("-", ""));
    if (endDate) params.set("edate", endDate.replaceAll("-", ""));
  }

  try {
    const res = await fetch(`https://search.hankyung.com/search/news?${params.toString()}`, {
      headers: {
        // 주의: Chrome UA 문자열을 사칭하면 한경 WAF가 TLS 지문 불일치로 403을 반환한다
        // (2026-07 확인). UA를 보내지 않는 요청(node 기본)은 정상 통과하므로 UA를 넣지 않는다.
        "Referer": "https://www.hankyung.com/",
        "Accept-Language": "ko-KR,ko;q=0.9",
      },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      return NextResponse.json({ error: `검색 요청 실패 (HTTP ${res.status})` }, { status: 502 });
    }
    const html = await res.text();
    const result = parseSearchResults(html, page);
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "검색 중 오류가 발생했습니다." },
      { status: 500 },
    );
  }
}

