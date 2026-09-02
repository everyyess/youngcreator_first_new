import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';

function extractVideoId(input: string): string | null {
  const patterns = [
    /[?&]v=([a-zA-Z0-9_-]{11})/,
    /youtu\.be\/([a-zA-Z0-9_-]{11})/,
    /embed\/([a-zA-Z0-9_-]{11})/,
    /shorts\/([a-zA-Z0-9_-]{11})/,
    /^([a-zA-Z0-9_-]{11})$/,
  ];
  for (const p of patterns) {
    const m = input.match(p);
    if (m) return m[1];
  }
  return null;
}

function decodeXmlEntities(s: string) {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/\n/g, ' ');
}

type CaptionTrack = { languageCode: string; baseUrl: string };

function pickTrack(tracks: CaptionTrack[]): CaptionTrack {
  return tracks.find(t => t.languageCode === 'ko') ?? tracks.find(t => t.languageCode === 'en') ?? tracks[0];
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// 유튜브 자막 서빙 엔드포인트는 순간적인 요청 폭주에 429를 반환하는 경우가 있어,
// 짧은 대기 후 한두 번 재시도하면 풀리는 케이스를 흡수한다.
async function fetchTranscriptFromTrack(track: CaptionTrack): Promise<string> {
  const backoffsMs = [0, 1500, 4000];
  for (const delay of backoffsMs) {
    if (delay) await sleep(delay);
    const xmlRes = await fetch(track.baseUrl, { signal: AbortSignal.timeout(10_000) });
    if (xmlRes.status === 429) continue;
    if (!xmlRes.ok) return '';
    const xml = await xmlRes.text();
    const parts = xml.match(/<text[^>]*>([^<]*)<\/text>/g) ?? [];
    return parts
      .map(p => decodeXmlEntities(p.replace(/<[^>]*>/g, '').trim()))
      .filter(Boolean)
      .join(' ');
  }
  return '';
}

// 웹 페이지 스크래핑이 차단될 때의 우회 경로: YouTube 내부(innertube) player API를
// ANDROID 클라이언트로 호출하면 봇 차단 없이 자막 트랙을 주는 경우가 많다.
async function fetchViaInnertube(videoId: string): Promise<{
  tracks: CaptionTrack[]; title: string; channelName: string; channelId: string;
} | null> {
  try {
    const res = await fetch(
      'https://www.youtube.com/youtubei/v1/player?key=AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'com.google.android.youtube/19.09.37 (Linux; U; Android 11) gzip',
        },
        body: JSON.stringify({
          context: {
            client: {
              clientName: 'ANDROID',
              clientVersion: '19.09.37',
              androidSdkVersion: 30,
              hl: 'ko',
              gl: 'KR',
            },
          },
          videoId,
        }),
        signal: AbortSignal.timeout(12_000),
      },
    );
    if (!res.ok) return null;
    const data = (await res.json()) as Record<string, unknown>;
    const vd = (data.videoDetails as Record<string, string> | undefined) ?? {};
    const captionRenderer = (
      (data.captions as Record<string, unknown> | undefined)
        ?.playerCaptionsTracklistRenderer as Record<string, unknown> | undefined
    ) ?? {};
    const tracks = (captionRenderer.captionTracks as CaptionTrack[] | undefined) ?? [];
    if (tracks.length === 0) return null;
    return {
      tracks,
      title: vd.title ?? '',
      channelName: vd.author ?? '',
      channelId: vd.channelId ?? '',
    };
  } catch {
    return null;
  }
}

// innertube 우회로 완결 응답을 만들 수 있으면 NextResponse, 아니면 null
async function tryInnertubeResponse(videoId: string): Promise<NextResponse | null> {
  const inner = await fetchViaInnertube(videoId);
  if (!inner) return null;
  const transcript = await fetchTranscriptFromTrack(pickTrack(inner.tracks));
  if (!transcript.trim()) return null;
  return NextResponse.json({
    transcript, title: inner.title, channelName: inner.channelName,
    channelId: inner.channelId, videoId, via: 'innertube',
  });
}

export async function GET(req: NextRequest) {
  const urlParam = req.nextUrl.searchParams.get('url') ?? '';
  const videoId = extractVideoId(urlParam);

  if (!videoId) {
    return NextResponse.json({ error: '유효하지 않은 YouTube URL입니다.' }, { status: 400 });
  }

  try {
    const pageRes = await fetch(`https://www.youtube.com/watch?v=${videoId}&hl=ko`, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
      signal: AbortSignal.timeout(15_000),
    });

    if (!pageRes.ok) {
      const viaInner = await tryInnertubeResponse(videoId);
      if (viaInner) return viaInner;
      return NextResponse.json(
        { error: `YouTube 페이지 로드 실패 (${pageRes.status})`, videoId, title: '', channelName: '', channelId: '', transcript: null },
        { status: 502 },
      );
    }

    const html = await pageRes.text();

    // Extract ytInitialPlayerResponse using brace-depth counter (more robust than regex)
    const startToken = 'var ytInitialPlayerResponse = ';
    const startIdx = html.indexOf(startToken);
    if (startIdx === -1) {
      const viaInner = await tryInnertubeResponse(videoId);
      if (viaInner) return viaInner;
      return NextResponse.json({
        error: '플레이어 데이터를 찾을 수 없습니다.',
        videoId, title: '', channelName: '', channelId: '', transcript: null,
      });
    }

    let depth = 0, i = startIdx + startToken.length, jsonStart = i;
    while (i < html.length) {
      const ch = html[i];
      if (ch === '{') { if (depth === 0) jsonStart = i; depth++; }
      else if (ch === '}') { depth--; if (depth === 0) break; }
      i++;
    }

    let playerResp: Record<string, unknown>;
    try {
      playerResp = JSON.parse(html.slice(jsonStart, i + 1)) as Record<string, unknown>;
    } catch {
      const viaInner = await tryInnertubeResponse(videoId);
      if (viaInner) return viaInner;
      return NextResponse.json({
        error: 'JSON 파싱 실패. 영상이 제한되어 있거나 로그인이 필요할 수 있습니다.',
        videoId, title: '', channelName: '', channelId: '', transcript: null,
      });
    }

    const vd = (playerResp.videoDetails as Record<string, string> | undefined) ?? {};
    const title = vd.title ?? '';
    const channelName = vd.author ?? '';
    const channelId = vd.channelId ?? '';

    const captionRenderer = (
      (playerResp.captions as Record<string, unknown> | undefined)
        ?.playerCaptionsTracklistRenderer as Record<string, unknown> | undefined
    ) ?? {};
    const tracks = (captionRenderer.captionTracks as Array<{ languageCode: string; baseUrl: string }> | undefined) ?? [];

    let transcript = '';
    if (tracks.length > 0) {
      transcript = await fetchTranscriptFromTrack(pickTrack(tracks));
    }

    // 웹 경로 실패(트랙 없음 또는 빈 응답 차단) 시 innertube ANDROID 클라이언트로 우회
    if (!transcript.trim()) {
      const inner = await fetchViaInnertube(videoId);
      if (inner) {
        transcript = await fetchTranscriptFromTrack(pickTrack(inner.tracks));
        if (transcript.trim()) {
          return NextResponse.json({
            transcript,
            title: title || inner.title,
            channelName: channelName || inner.channelName,
            channelId: channelId || inner.channelId,
            videoId,
            via: 'innertube',
          });
        }
      }
    }

    if (!transcript.trim()) {
      return NextResponse.json({
        error: tracks.length === 0
          ? '이 영상에는 자막이 없거나 YouTube가 자막 제공을 차단했습니다. 자막을 직접 붙여넣어 주세요.'
          : 'YouTube가 일시적으로 자막 요청을 차단했습니다 (429, 우회 시도 포함 실패). 네트워크에 따라 몇 분 후 다시 시도하면 풀릴 수 있습니다. 계속 실패하면 자막을 직접 붙여넣어 주세요.',
        videoId, title, channelName, channelId, transcript: null,
      });
    }

    return NextResponse.json({ transcript, title, channelName, channelId, videoId });
  } catch (e) {
    return NextResponse.json(
      { error: `오류: ${e instanceof Error ? e.message : String(e)}`, videoId, title: '', channelName: '', channelId: '', transcript: null },
      { status: 500 },
    );
  }
}

