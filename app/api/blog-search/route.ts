import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 20;

export type BlogSearchPost = {
  title: string;
  url: string;
  bloggerName: string;
  description: string;
  postedAt: string; // yyyy-mm-dd
};

function stripTags(html: string): string {
  return html
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
}

function toIsoDate(yyyymmdd: string): string {
  const m = yyyymmdd.match(/^(\d{4})(\d{2})(\d{2})$/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : yyyymmdd;
}

// 네이버 오픈API 블로그 검색 (공식) — developers.naver.com에서 발급받은 Client ID/Secret 필요
export async function GET(req: NextRequest) {
  const query = req.nextUrl.searchParams.get("query")?.trim() ?? "";
  const display = Math.min(100, Math.max(1, parseInt(req.nextUrl.searchParams.get("display") ?? "30", 10) || 30));
  // start: 결과 페이징 시작 위치(네이버 제약: start + display - 1 <= 1000)
  const start = Math.min(1000, Math.max(1, parseInt(req.nextUrl.searchParams.get("start") ?? "1", 10) || 1));
  if (!query) {
    return NextResponse.json({ error: "검색어를 입력하세요." }, { status: 400 });
  }

  const clientId = process.env.NAVER_CLIENT_ID;
  const clientSecret = process.env.NAVER_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return NextResponse.json(
      { error: "네이버 오픈API의 API키를 등록해주세요! (NAVER_CLIENT_ID, NAVER_CLIENT_SECRET)", missingApiKey: true },
      { status: 503 },
    );
  }

  const params = new URLSearchParams({ query, display: String(display), start: String(start), sort: "date" });
  try {
    const res = await fetch(`https://openapi.naver.com/v1/search/blog.json?${params.toString()}`, {
      headers: { "X-Naver-Client-Id": clientId, "X-Naver-Client-Secret": clientSecret },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return NextResponse.json({ error: `네이버 블로그 검색 실패 (HTTP ${res.status}) ${text.slice(0, 200)}` }, { status: 502 });
    }
    const data = (await res.json()) as {
      items?: Array<{ title: string; link: string; description: string; bloggername: string; postdate: string }>;
    };
    const posts: BlogSearchPost[] = (data.items ?? []).map((it) => ({
      title: stripTags(it.title),
      url: it.link,
      bloggerName: stripTags(it.bloggername),
      description: stripTags(it.description),
      postedAt: toIsoDate(it.postdate),
    }));
    return NextResponse.json({ posts });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "검색 중 오류가 발생했습니다." },
      { status: 500 },
    );
  }
}

