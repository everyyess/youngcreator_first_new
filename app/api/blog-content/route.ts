import { NextRequest, NextResponse } from "next/server";
import { safeRemoteFetch } from "@/lib/safeRemoteFetch";

export const runtime = "nodejs";
export const maxDuration = 20;

function decodeHtmlEntities(value: string) {
  return value
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&middot;/g, "·")
    .replace(/&hellip;/g, "…");
}

function stripBlock(html: string, tag: string): string {
  return html.replace(new RegExp(`<${tag}[^>]*>[\\s\\S]*?<\\/${tag}>`, "gi"), "");
}

function htmlFragmentToText(fragment: string): string {
  let body = fragment;
  body = stripBlock(body, "script");
  body = stripBlock(body, "style");
  body = stripBlock(body, "nav");
  body = stripBlock(body, "footer");
  body = stripBlock(body, "header");
  body = body.replace(/<br\s*\/?>/gi, "\n");
  body = body.replace(/<\/p>/gi, "\n");
  body = body.replace(/<\/div>/gi, "\n");
  body = body.replace(/<[^>]+>/g, "");
  body = decodeHtmlEntities(body);

  // 연속된 줄바꿈을 한 번으로 압축, 각 줄 앞뒤 공백 제거
  return body
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .join("\n");
}

// <article> 태그 우선 추출
function extractArticleTag(html: string): string | null {
  const m = html.match(/<article[^>]*>([\s\S]*?)<\/article>/i);
  return m ? m[1] : null;
}

// 본문으로 추정되는 흔한 id/class 패턴을 가진 <div>를 중첩 깊이를 세어가며
// 끝까지(짝이 맞는 </div>까지) 추출한다 (네이버블로그, 티스토리, velog 등).
const CONTENT_DIV_OPEN_RE =
  /<div[^>]+(?:id|class)="[^"]*\b(?:postViewArea|entry-content|post-content|article-content|tt_article_useless_p_margin|se-main-container)\b[^"]*"[^>]*>/i;

function extractByCommonSelectors(html: string): string | null {
  const openMatch = html.match(CONTENT_DIV_OPEN_RE);
  if (!openMatch || openMatch.index === undefined) return null;

  const startIdx = openMatch.index + openMatch[0].length;
  let depth = 1;
  const tagRe = /<div[^>]*>|<\/div\s*>/gi;
  tagRe.lastIndex = startIdx;
  let m: RegExpExecArray | null;
  while ((m = tagRe.exec(html)) !== null) {
    if (m[0].slice(0, 2).toLowerCase() === "</") {
      depth -= 1;
      if (depth === 0) {
        const fragment = html.slice(startIdx, m.index);
        return fragment.length > 200 ? fragment : null;
      }
    } else {
      depth += 1;
    }
  }
  return null;
}

// 가장 <p> 태그가 밀집된 영역을 본문으로 추정 (최후 수단)
const FALLBACK_NOISE = [
  "구독하기", "댓글", "공유하기", "이전 글", "다음 글", "Copyright", "All rights reserved",
  "쿠키", "개인정보", "이용약관",
];

function fallbackExtract(html: string): string {
  const paras = [...html.matchAll(/<p[^>]*>([\s\S]{20,}?)<\/p>/g)].map((m) => m[1].replace(/<[^>]+>/g, ""));
  const texts = paras
    .map((p) => decodeHtmlEntities(p).trim())
    .filter((t) => t.length > 20 && !FALLBACK_NOISE.some((n) => t.includes(n)));
  if (texts.length > 0) return texts.join("\n\n");

  const og = html.match(/<meta[^>]+property="og:description"[^>]+content="([^"]*)"/i);
  if (og) return decodeHtmlEntities(og[1]);
  return "";
}

function extractTitle(html: string): string {
  const og = html.match(/<meta[^>]+property="og:title"[^>]+content="([^"]*)"/i);
  if (og) return decodeHtmlEntities(og[1]);
  const title = html.match(/<title>([^<]*)<\/title>/i);
  if (title) return decodeHtmlEntities(title[1]);
  return "";
}

function extractSiteName(html: string): string {
  const og = html.match(/<meta[^>]+property="og:site_name"[^>]+content="([^"]*)"/i);
  if (og) return decodeHtmlEntities(og[1]);
  return "";
}

// 네이버 블로그 글 주소(blog.naver.com/{blogId}/{logNo})는 실제로는 빈 프레임셋이고
// 본문은 iframe(#mainFrame)이 불러오는 PostView.naver 페이지에 있다.
// 서버에서 fetch하면 iframe 내부는 절대 따라가지 않으므로, 본문이 있는
// PostView.naver URL로 직접 바꿔서 요청해야 한다.
function resolveNaverBlogUrl(rawUrl: string): string {
  try {
    const u = new URL(rawUrl);
    if (!/(^|\.)blog\.naver\.com$/.test(u.hostname)) return rawUrl;
    if (/PostView\.naver/i.test(u.pathname)) return rawUrl;

    const m = u.pathname.match(/^\/([^/]+)\/(\d+)\/?$/);
    if (m) {
      const [, blogId, logNo] = m;
      return `https://blog.naver.com/PostView.naver?blogId=${blogId}&logNo=${logNo}`;
    }
    return rawUrl;
  } catch {
    return rawUrl;
  }
}

// 그 외 프레임셋 기반 블로그(거의 항상 <iframe id="mainFrame">)에 대한 범용 폴백:
// 본문 추출에 실패하면 페이지 내 iframe을 한 번 따라가서 재시도한다.
function findFrameSrc(html: string, baseUrl: string): string | null {
  const m = html.match(/<iframe[^>]+id=["']mainFrame["'][^>]*src=["']([^"']+)["']/i)
    ?? html.match(/<iframe[^>]+src=["']([^"']+)["'][^>]*id=["']mainFrame["']/i);
  if (!m) return null;
  try {
    return new URL(m[1], baseUrl).toString();
  } catch {
    return null;
  }
}

function extractArticleBody(html: string): string {
  const article = extractArticleTag(html);
  if (article) {
    const text = htmlFragmentToText(article);
    if (text.length > 50) return text;
  }
  const common = extractByCommonSelectors(html);
  if (common) {
    const text = htmlFragmentToText(common);
    if (text.length > 50) return text;
  }
  return fallbackExtract(html);
}

async function fetchHtml(url: string): Promise<{ html: string; status: number } | null> {
  try {
    const res = await safeRemoteFetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.8",
      },
      signal: AbortSignal.timeout(12_000),
    });
    if (!res.ok) return { html: "", status: res.status };
    return { html: await res.text(), status: res.status };
  } catch {
    return null;
  }
}

export async function GET(req: NextRequest) {
  const rawUrl = req.nextUrl.searchParams.get("url") ?? "";
  if (!rawUrl || !/^https?:\/\//.test(rawUrl)) {
    return NextResponse.json({ error: "유효하지 않은 URL입니다." }, { status: 400 });
  }

  const url = resolveNaverBlogUrl(rawUrl);

  const fetched = await fetchHtml(url);
  if (!fetched) {
    return NextResponse.json({ error: "페이지를 불러오는 중 오류가 발생했습니다." }, { status: 500 });
  }
  if (!fetched.html) {
    return NextResponse.json({ error: `페이지 로드 실패 (${fetched.status})` }, { status: 502 });
  }

  let html = fetched.html;
  let content = extractArticleBody(html);

  // 프레임셋 기반 페이지(본문이 비어있고 iframe만 있는 경우)면 iframe을 따라가 재시도
  if (!content) {
    const frameSrc = findFrameSrc(html, url);
    if (frameSrc) {
      const framed = await fetchHtml(frameSrc);
      if (framed?.html) {
        html = framed.html;
        content = extractArticleBody(html);
      }
    }
  }

  if (!content) {
    return NextResponse.json({ error: "본문을 추출하지 못했습니다. 본문을 직접 붙여넣어 주세요." }, { status: 404 });
  }

  return NextResponse.json({
    content,
    title: extractTitle(html),
    siteName: extractSiteName(html),
  });
}
