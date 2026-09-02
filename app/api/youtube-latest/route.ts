import { NextRequest, NextResponse } from 'next/server';
import { isTodayKst } from '@/lib/recentFilter';
import { getInsightSupabase, insightDbUnavailable } from "@/lib/supabaseInsightDb";

export const runtime = 'nodejs';

type ChannelInput = { channelId: string; channelName: string };

export type LatestVideo = {
  channelId: string;
  channelName: string;
  videoId: string;
  title: string;
  publishedAt: string;
  thumbnailUrl: string;
  videoUrl: string;
  viewCount?: number;
};

// Resolve @handle or other forms to a UC... channel ID
async function resolveToChannelId(rawId: string): Promise<string | null> {
  if (/^UC[a-zA-Z0-9_-]{22}$/.test(rawId)) return rawId;

  const url = rawId.startsWith('http')
    ? rawId
    : rawId.startsWith('@')
      ? `https://www.youtube.com/${rawId}`
      : `https://www.youtube.com/@${rawId}`;

  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0', 'Accept-Language': 'ko-KR,ko;q=0.9' },
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) return null;
    const html = await res.text();

    // Look for channelId in the page HTML
    const m = html.match(/"channelId":"(UC[a-zA-Z0-9_-]{22})"/);
    if (m) return m[1];

    const m2 = html.match(/\/channel\/(UC[a-zA-Z0-9_-]{22})/);
    if (m2) return m2[1];
  } catch {}

  return null;
}

function decodeXmlEntities(s: string) {
  return s
    .replace(/&amp;/g, '&') // 이중 인코딩(&amp;quot; 등)을 먼저 풀어 아래 치환이 잡을 수 있게 한다
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)));
}

const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY;

type YtVideoStats = { id?: string; statistics?: { viewCount?: string } };

/** videoId → 조회수. videos.list는 최대 50개 id를 1유닛에 처리하는 저렴한 엔드포인트라 항상 붙여도 부담 없다. */
async function fetchViewCounts(videoIds: string[]): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  if (!YOUTUBE_API_KEY || videoIds.length === 0) return map;
  const chunks: string[][] = [];
  for (let i = 0; i < videoIds.length; i += 50) chunks.push(videoIds.slice(i, i + 50));
  await Promise.all(chunks.map(async (chunk) => {
    try {
      const params = new URLSearchParams({ key: YOUTUBE_API_KEY!, id: chunk.join(','), part: 'statistics' });
      const res = await fetch(`https://www.googleapis.com/youtube/v3/videos?${params.toString()}`, {
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) return;
      const data = (await res.json()) as { items?: YtVideoStats[] };
      for (const it of data.items ?? []) {
        if (it.id && it.statistics?.viewCount) map.set(it.id, parseInt(it.statistics.viewCount, 10));
      }
    } catch {}
  }));
  return map;
}

type YtSearchItem = {
  id?: { videoId?: string };
  snippet?: { title?: string; publishedAt?: string };
};

/**
 * 기간/키워드 지정 검색 — YouTube Data API v3 search.list 사용.
 * RSS(fetchLatestVideos)와 달리 채널당 최근 15개 제한이 없고, publishedAfter/publishedBefore로
 * 서버가 직접 날짜를 필터링해주므로 몇 달 전 영상도 정확히 조회된다.
 */
async function searchChannelVideos(ch: ChannelInput, keyword: string, from?: string, to?: string): Promise<LatestVideo[]> {
  let channelId = ch.channelId;
  if (!/^UC[a-zA-Z0-9_-]{22}$/.test(channelId)) {
    const resolved = await resolveToChannelId(channelId);
    if (!resolved) return [];
    channelId = resolved;
  }

  const params = new URLSearchParams({
    key: YOUTUBE_API_KEY!,
    channelId,
    part: 'snippet',
    type: 'video',
    order: 'date',
    maxResults: '50',
  });
  if (keyword.trim()) params.set('q', keyword.trim());
  if (from) params.set('publishedAfter', `${from}T00:00:00Z`);
  if (to) params.set('publishedBefore', `${to}T23:59:59Z`);

  try {
    const res = await fetch(`https://www.googleapis.com/youtube/v3/search?${params.toString()}`, {
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return [];
    const data = (await res.json()) as { items?: YtSearchItem[] };
    return (data.items ?? [])
      .filter((it) => it.id?.videoId)
      .map((it) => {
        const videoId = it.id!.videoId!;
        return {
          channelId: ch.channelId,
          channelName: ch.channelName,
          videoId,
          title: decodeXmlEntities(it.snippet?.title ?? ''),
          publishedAt: it.snippet?.publishedAt ?? '',
          thumbnailUrl: `https://img.youtube.com/vi/${videoId}/mqdefault.jpg`,
          videoUrl: `https://www.youtube.com/watch?v=${videoId}`,
        };
      });
  } catch {
    return [];
  }
}

type YtPlaylistItem = {
  snippet?: { resourceId?: { videoId?: string }; title?: string; publishedAt?: string };
};

const PLAYLIST_ITEMS_MAX_PAGES = 10;

/**
 * 키워드 없이 기간만 지정된 검색 — playlistItems.list(업로드 재생목록) 사용.
 * search.list(100유닛)보다 훨씬 저렴(페이지당 1유닛)하다. 업로드 재생목록은 최신순으로 정렬되므로
 * from보다 오래된 영상을 만나면 그 뒤는 더 오래된 영상뿐이라 페이징을 조기 종료한다.
 */
async function fetchChannelUploadsInRange(ch: ChannelInput, from?: string, to?: string): Promise<LatestVideo[]> {
  let channelId = ch.channelId;
  if (!/^UC[a-zA-Z0-9_-]{22}$/.test(channelId)) {
    const resolved = await resolveToChannelId(channelId);
    if (!resolved) return [];
    channelId = resolved;
  }
  const playlistId = channelId.replace(/^UC/, 'UULF');

  const videos: LatestVideo[] = [];
  let pageToken: string | undefined;
  try {
    for (let page = 0; page < PLAYLIST_ITEMS_MAX_PAGES; page++) {
      const params = new URLSearchParams({
        key: YOUTUBE_API_KEY!,
        playlistId,
        part: 'snippet',
        maxResults: '50',
      });
      if (pageToken) params.set('pageToken', pageToken);

      const res = await fetch(`https://www.googleapis.com/youtube/v3/playlistItems?${params.toString()}`, {
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) break;
      const data = (await res.json()) as { items?: YtPlaylistItem[]; nextPageToken?: string };
      const items = data.items ?? [];

      let hitOlderThanFrom = false;
      for (const it of items) {
        const videoId = it.snippet?.resourceId?.videoId;
        const publishedAt = it.snippet?.publishedAt;
        if (!videoId || !publishedAt) continue;
        const d = publishedAt.slice(0, 10);
        if (from && d < from) { hitOlderThanFrom = true; continue; }
        if (to && d > to) continue;
        videos.push({
          channelId: ch.channelId,
          channelName: ch.channelName,
          videoId,
          title: decodeXmlEntities(it.snippet?.title ?? ''),
          publishedAt,
          thumbnailUrl: `https://img.youtube.com/vi/${videoId}/mqdefault.jpg`,
          videoUrl: `https://www.youtube.com/watch?v=${videoId}`,
        });
      }

      // 업로드 재생목록은 최신순 정렬 — from보다 오래된 영상이 나오면 이후는 전부 더 오래된 영상뿐이므로 중단
      if (hitOlderThanFrom) break;
      pageToken = data.nextPageToken;
      if (!pageToken) break;
    }
  } catch {
    return videos;
  }
  return videos;
}

async function fetchLatestVideos(ch: ChannelInput, limit = 8): Promise<LatestVideo[]> {
  let rssChannelId = ch.channelId;

  if (!/^UC[a-zA-Z0-9_-]{22}$/.test(rssChannelId)) {
    const resolved = await resolveToChannelId(rssChannelId);
    if (!resolved) return [];
    rssChannelId = resolved;
  }

  try {
    const playlistId = rssChannelId.replace(/^UC/, 'UULF');
    const rssUrl = `https://www.youtube.com/feeds/videos.xml?playlist_id=${playlistId}`;
    const res = await fetch(rssUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) return [];
    const xml = await res.text();

    const entries = xml.match(/<entry>[\s\S]*?<\/entry>/g) ?? [];
    const videos: LatestVideo[] = [];

    for (const entry of entries.slice(0, limit)) {
      const videoId = (entry.match(/<yt:videoId>([^<]+)<\/yt:videoId>/) ?? [])[1] ?? '';
      if (!videoId) continue;

      const rawTitle = (entry.match(/<title>([^<]+)<\/title>/) ?? [])[1] ?? '';
      const published = (entry.match(/<published>([^<]+)<\/published>/) ?? [])[1] ?? '';

      videos.push({
        // 원래 요청에 쓰인 channelId(=구독 채널 DB의 channel_id)를 그대로 돌려줘야
        // 프론트에서 채널별 필터링이 매칭된다 (RSS 조회용 UC... ID와 다를 수 있음)
        channelId: ch.channelId,
        channelName: ch.channelName,
        videoId,
        title: decodeXmlEntities(rawTitle),
        publishedAt: published,
        thumbnailUrl: `https://img.youtube.com/vi/${videoId}/mqdefault.jpg`,
        videoUrl: `https://www.youtube.com/watch?v=${videoId}`,
      });
    }

    return videos;
  } catch {
    return [];
  }
}

export async function POST(req: NextRequest) {
  const { channels = [], perChannel = 8, from, to, keyword } = (await req.json()) as {
    channels?: ChannelInput[]; perChannel?: number; from?: string; to?: string; keyword?: string;
  };
  if (channels.length === 0) return NextResponse.json({ videos: [] });
  if (!YOUTUBE_API_KEY) {
    // RSS 기반 기본 목록만 제공 — 검색·조회수 기능 미지원 플래그를 함께 반환
    const results = await Promise.all(channels.map((ch) => fetchLatestVideos(ch, perChannel)));
    return NextResponse.json({ videos: results.flat(), youtubeApiKeyMissing: true });
  }

  // 기간이 지정되거나 검색어가 있으면(과거/전체 검색) — YouTube Data API 키가 있으면 서버가 직접 날짜/키워드를
  // 필터링해 정확히 조회한다. 키워드가 있으면 search.list(100유닛), 키워드 없이 기간만 있으면 훨씬 저렴한
  // playlistItems.list(페이지당 1유닛)를 쓴다. 키가 없으면 RSS로 대체하되, RSS는 채널당 최근 15개로 제한되어
  // 그보다 오래된 영상은 채널이 그 사이 새 영상을 많이 올리지 않은 경우에만 조회된다.
  const hasKeyword = Boolean(keyword && keyword.trim());
  const wide = Boolean(from || to || hasKeyword);
  let flat: LatestVideo[];
  if (wide && YOUTUBE_API_KEY && hasKeyword) {
    const results = await Promise.all(channels.map((ch) => searchChannelVideos(ch, keyword ?? '', from, to)));
    flat = results.flat();
  } else if (wide && YOUTUBE_API_KEY) {
    const results = await Promise.all(channels.map((ch) => fetchChannelUploadsInRange(ch, from, to)));
    flat = results.flat();
  } else {
    const results = await Promise.all(channels.map((ch) => fetchLatestVideos(ch, wide ? Math.max(perChannel, 15) : perChannel)));
    flat = results.flat();
    if (wide && keyword && keyword.trim()) {
      const kw = keyword.trim().toLowerCase();
      flat = flat.filter((v) => v.title.toLowerCase().includes(kw));
    }
  }

  const db = getInsightSupabase(req);
  if (!db) return NextResponse.json(insightDbUnavailable(), { status: 401 });
  const { data: deletedRows } = await db.from("deleted_youtube_videos").select("video_id");
  const deletedVideoIds = new Set((deletedRows ?? []).map((row) => String(row.video_id)));

  const videosBase = (wide
    ? flat.filter((v) => {
        if (deletedVideoIds.has(v.videoId)) return false;
        if (!v.publishedAt) return false;
        const d = v.publishedAt.slice(0, 10);
        if (from && d < from) return false;
        if (to && d > to) return false;
        return true;
      })
    : flat.filter((v) => !deletedVideoIds.has(v.videoId) && isTodayKst(v.publishedAt))
  ).sort((a, b) => (a.publishedAt < b.publishedAt ? 1 : -1));

  // 조회수 부착 — videos.list는 최대 50개씩 1유닛이라 항상 붙여도 쿼터 부담이 적다
  const viewCounts = await fetchViewCounts(videosBase.map((v) => v.videoId));
  const videos = viewCounts.size > 0
    ? videosBase.map((v) => ({ ...v, viewCount: viewCounts.get(v.videoId) }))
    : videosBase;

  return NextResponse.json({ videos });
}
