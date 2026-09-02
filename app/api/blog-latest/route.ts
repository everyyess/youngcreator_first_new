import { NextRequest, NextResponse } from 'next/server';
import { safeRemoteFetch } from "@/lib/safeRemoteFetch";
import { isTodayKst } from '@/lib/recentFilter';
import { getInsightSupabase, insightDbUnavailable } from "@/lib/supabaseInsightDb";

export const runtime = 'nodejs';

type FeedInput = { feedUrl: string; feedName: string };

export type LatestPost = {
  feedUrl: string;
  feedName: string;
  postUrl: string;
  title: string;
  publishedAt: string;
};

function decodeXmlEntities(s: string) {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .trim();
}

function pickTag(block: string, tag: string): string {
  const re = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'i');
  const m = block.match(re);
  return m ? decodeXmlEntities(m[1]) : '';
}

function pickAtomLink(block: string): string {
  // <link href="..." /> (Atom) — prefer rel="alternate" or first link
  const links = [...block.matchAll(/<link\b([^>]*)\/?>(?:<\/link>)?/gi)];
  for (const m of links) {
    const attrs = m[1];
    const hrefM = attrs.match(/href="([^"]*)"/);
    if (!hrefM) continue;
    const relM = attrs.match(/rel="([^"]*)"/);
    if (!relM || relM[1] === 'alternate') return hrefM[1];
  }
  if (links.length > 0) {
    const hrefM = links[0][1].match(/href="([^"]*)"/);
    if (hrefM) return hrefM[1];
  }
  return '';
}

// 네이버 블로그는 일반 블로그 주소(blog.naver.com/{blogId})로 RSS를 제공하지 않는다.
// 사용자가 흔히 붙여넣는 블로그 홈 주소를 실제 RSS 주소(rss.blog.naver.com/{blogId}.xml)로 변환한다.
function resolveFeedUrl(rawUrl: string): string {
  try {
    const u = new URL(rawUrl);
    if (/(^|\.)blog\.naver\.com$/.test(u.hostname)) {
      const m = u.pathname.match(/^\/([^/]+)\/?$/);
      if (m) return `https://rss.blog.naver.com/${m[1]}.xml`;
    }
    return rawUrl;
  } catch {
    return rawUrl;
  }
}

async function fetchLatestPosts(feed: FeedInput, limit = 10): Promise<LatestPost[]> {
  try {
    const res = await safeRemoteFetch(resolveFeedUrl(feed.feedUrl), {
      headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml' },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return [];
    const xml = await res.text();

    const isAtom = /<feed[\s>]/i.test(xml) && /<entry[\s>]/i.test(xml);
    const blocks = isAtom
      ? xml.match(/<entry>[\s\S]*?<\/entry>/g) ?? []
      : xml.match(/<item>[\s\S]*?<\/item>/g) ?? [];

    const posts: LatestPost[] = [];
    for (const block of blocks.slice(0, limit)) {
      const title = pickTag(block, 'title');
      const postUrl = isAtom ? pickAtomLink(block) : pickTag(block, 'link');
      if (!postUrl) continue;
      const published = isAtom
        ? (pickTag(block, 'published') || pickTag(block, 'updated'))
        : (pickTag(block, 'pubDate') || pickTag(block, 'dc:date'));

      posts.push({
        feedUrl: feed.feedUrl,
        feedName: feed.feedName,
        postUrl,
        title: title || postUrl,
        publishedAt: published ? new Date(published).toISOString() : '',
      });
    }
    return posts;
  } catch {
    return [];
  }
}

export async function POST(req: NextRequest) {
  const { feeds = [], perFeed = 10, from, to, keyword } = (await req.json()) as {
    feeds?: FeedInput[]; perFeed?: number; from?: string; to?: string; keyword?: string;
  };
  if (feeds.length === 0) return NextResponse.json({ posts: [] });

  // 기간이 지정되거나 검색어가 있으면(과거/전체 검색) 각 피드가 제공하는 만큼 더 깊이 조회 — RSS 자체 한도까지만 가능
  const wide = Boolean(from || to || (keyword && keyword.trim()));
  const results = await Promise.all(feeds.map((f) => fetchLatestPosts(f, wide ? Math.max(perFeed, 100) : perFeed)));
  const flat = results.flat();

  const db = getInsightSupabase(req);
  if (!db) return NextResponse.json(insightDbUnavailable(), { status: 401 });
  const { data: deletedRows } = await db.from("deleted_blog_posts").select("post_url");
  const deletedUrls = new Set((deletedRows ?? []).map((row) => String(row.post_url)));

  const posts = (wide
    ? flat.filter((p) => {
        if (deletedUrls.has(p.postUrl)) return false;
        if (!p.publishedAt) return true;
        const d = p.publishedAt.slice(0, 10);
        if (from && d < from) return false;
        if (to && d > to) return false;
        return true;
      })
    : flat.filter((p) => !deletedUrls.has(p.postUrl) && isTodayKst(p.publishedAt))
  ).sort((a, b) => (a.publishedAt < b.publishedAt ? 1 : -1));
  return NextResponse.json({ posts });
}
