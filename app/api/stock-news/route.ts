/**
 * /api/stock-news  GET ?ticker=X
 * 국내 주식(.KS/.KQ): 네이버 금융 모바일 API → HTML 스크래핑 폴백
 * 해외 주식: Yahoo Finance RSS 피드 → 검색 API 폴백
 * 반환: { items: [{ title, preview, url }] }  최대 3건
 */

export const runtime = 'nodejs';

export interface StockNewsItem {
  title: string;
  preview: string;
  url: string;
}

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

function withTimeout(url: string, init: RequestInit = {}, ms = 8000): Promise<Response> {
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(), ms);
  return fetch(url, { ...init, signal: ctrl.signal }).finally(() => clearTimeout(id));
}

// HTML 태그 제거 + HTML 특수 엔티티 디코딩
function cleanText(raw: string): string {
  return raw
    .replace(/<[^>]*>/g, '')           // <b>, </b> 등 태그 전량 제거
    .replace(/&ldquo;/gi, '“')    // "
    .replace(/&rdquo;/gi, '”')    // "
    .replace(/&lsquo;/gi, '‘')    // '
    .replace(/&rsquo;/gi, '’')    // '
    .replace(/&hellip;/gi, '…')   // …
    .replace(/&middot;/gi, '·')   // ·
    .replace(/&ndash;/gi, '–')    // –
    .replace(/&mdash;/gi, '—')    // —
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/gi, '"')
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(Number(code)))
    .trim();
}

// 네이버 내부 상대 경로 → 절대 URL 보정
function resolveNaverUrl(href: string): string {
  if (!href) return '';
  if (href.startsWith('http')) return href;
  return `https://finance.naver.com${href.startsWith('/') ? '' : '/'}${href}`;
}

// 네이버 모바일 뉴스 API 파싱 공통 헬퍼
async function fetchNaverMobileNews(code: string, category: string): Promise<StockNewsItem[]> {
  try {
    const res = await withTimeout(
      `https://m.stock.naver.com/api/news/list?category=${category}&symbol=${code}&page=0&pageSize=3`,
      {
        headers: {
          'User-Agent': UA,
          Referer: 'https://m.stock.naver.com/',
          Accept: 'application/json',
        },
      },
    );
    if (!res.ok) return [];
    const json = (await res.json()) as {
      articles?: Array<{
        title?: string;
        description?: string;
        url?: string;
        link?: string;
        articleUrl?: string;
        officeName?: string;
        articleId?: string;
        officeId?: string;
      }>;
    };
    return (json.articles ?? [])
      .slice(0, 3)
      .map((a) => {
        const rawUrl = a.url ?? a.link ?? a.articleUrl ?? '';
        const resolvedUrl = rawUrl
          ? resolveNaverUrl(rawUrl)
          : a.articleId && a.officeId
            ? `https://n.news.naver.com/mnews/article/${a.officeId}/${a.articleId}`
            : '';
        return {
          title: cleanText(a.title ?? ''),
          preview: cleanText(a.description ?? ''),
          url: resolvedUrl,
        };
      })
      .filter((a) => a.title);
  } catch {
    return [];
  }
}

// ── 국내 주식/ETF 뉴스 ─────────────────────────────────────────────────────────

async function fetchKoreanNews(code: string): Promise<StockNewsItem[]> {
  // 1단계: 네이버 모바일 스톡 뉴스 API (category=stock 우선, ETF이면 etf 폴백)
  let items = await fetchNaverMobileNews(code, 'stock');
  if (items.length === 0) {
    items = await fetchNaverMobileNews(code, 'etf');
  }
  if (items.length > 0) return items;

  // 2단계: 네이버 파이낸스 HTML 스크래핑 (EUC-KR 디코딩)
  try {
    const res = await withTimeout(
      `https://finance.naver.com/item/news_news.naver?code=${code}`,
      {
        headers: {
          'User-Agent': UA,
          Accept: 'text/html',
          'Accept-Language': 'ko-KR,ko;q=0.9',
          Referer: 'https://finance.naver.com/',
        },
      },
    );
    if (!res.ok) return [];
    const buf = await res.arrayBuffer();
    const html = new TextDecoder('euc-kr').decode(buf);

    // <td class="title"><a href="...">제목</a></td> 패턴으로 href + 텍스트 동시 추출
    const pattern = /<td[^>]*class=["']title["'][^>]*>[\s\S]*?<a\s+href="([^"]*)"[^>]*>([^<]+)<\/a>/g;
    let m: RegExpExecArray | null;
    while ((m = pattern.exec(html)) !== null && items.length < 3) {
      const title = cleanText(m[2]);
      if (title) {
        items.push({
          title,
          preview: '',
          url: resolveNaverUrl(m[1]),
        });
      }
    }
    return items;
  } catch {}

  return [];
}

// ── 해외 주식 뉴스 ─────────────────────────────────────────────────────────────

async function fetchForeignNews(ticker: string): Promise<StockNewsItem[]> {
  // 1단계: Yahoo Finance RSS 피드 (description + link 포함)
  try {
    const rssUrl = `https://feeds.finance.yahoo.com/rss/2.0/headline?s=${encodeURIComponent(ticker)}&region=US&lang=en-US`;
    const res = await withTimeout(rssUrl, {
      headers: { 'User-Agent': UA, Accept: 'application/rss+xml, text/xml' },
    });
    if (res.ok) {
      const xml = await res.text();

      const itemPattern = /<item>([\s\S]*?)<\/item>/g;
      const titlePattern = /<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/;
      const descPattern  = /<description>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/description>/;
      const linkPattern  = /<link>([\s\S]*?)<\/link>|<guid[^>]*>(https?:\/\/[^<]+)<\/guid>/;

      const items: StockNewsItem[] = [];
      let m: RegExpExecArray | null;
      while ((m = itemPattern.exec(xml)) !== null && items.length < 3) {
        const block = m[1];
        const titleMatch = titlePattern.exec(block);
        const descMatch  = descPattern.exec(block);
        const linkMatch  = linkPattern.exec(block);
        const title   = cleanText(titleMatch?.[1] ?? '');
        const preview = cleanText(descMatch?.[1] ?? '');
        const url     = (linkMatch?.[1] ?? linkMatch?.[2] ?? '').trim();
        if (title) items.push({ title, preview, url });
      }
      if (items.length > 0) return items;
    }
  } catch {}

  // 2단계: Yahoo Finance 검색 API (link 필드 활용)
  try {
    const res = await withTimeout(
      `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(ticker)}&newsCount=3&enableFuzzyQuery=false`,
      {
        headers: {
          'User-Agent': UA,
          Accept: 'application/json',
          'Accept-Language': 'en-US,en;q=0.9',
        },
      },
    );
    if (res.ok) {
      const json = (await res.json()) as {
        news?: Array<{ title?: string; publisher?: string; link?: string }>;
      };
      return (json.news ?? [])
        .slice(0, 3)
        .map((n) => ({
          title: cleanText(n.title ?? ''),
          preview: n.publisher ? `출처: ${n.publisher}` : '',
          url: n.link ?? '',
        }))
        .filter((n) => n.title);
    }
  } catch {}

  return [];
}

// ── 테마 키워드 기반 네이버 뉴스 검색 (국내 자산 테마 폴백) ──────────────────────
// 티커 기반 뉴스가 없을 때 섹터 키워드(예: '바이오')로 네이버 뉴스 검색 대체.
// <a class="news_tit" href="URL">제목</a> 패턴 추출 (속성 순서 무관).

async function fetchNaverKeywordNews(keyword: string): Promise<StockNewsItem[]> {
  if (!keyword) return [];
  console.log(`[stock-news] fetchNaverKeywordNews 진입 — keyword: "${keyword}"`);

  // ── 1티어: 네이버 통합검색 뉴스 탭 (UTF-8 쿼리 네이티브 지원) ─────────────────
  try {
    const url =
      `https://search.naver.com/search.naver?where=news` +
      `&query=${encodeURIComponent(keyword)}`;
    const res = await withTimeout(url, {
      headers: {
        'User-Agent': UA,
        Accept: 'text/html,application/xhtml+xml',
        'Accept-Language': 'ko-KR,ko;q=0.9',
        Referer: 'https://finance.naver.com/',
      },
    }, 8000);
    if (!res.ok) {
      console.error(`[stock-news] 1티어 HTTP ${res.status} — keyword: "${keyword}"`);
    } else {
      const html = await res.text();
      const items: StockNewsItem[] = [];
      // <a class="news_tit" href="URL"><mark>검색어</mark>포함 제목</a> 모두 포착
      const anchorRE = /<a\b([^>]+)>([\s\S]*?)<\/a>/g;
      for (const [, attrs, rawText] of html.matchAll(anchorRE)) {
        if (!attrs.includes('news_tit')) continue;
        const hrefMatch = /href="([^"]+)"/.exec(attrs);
        if (!hrefMatch) continue;
        const title = cleanText(rawText.replace(/<[^>]*>/g, ''));
        if (title) {
          items.push({ title, preview: '', url: hrefMatch[1] });
          if (items.length >= 3) break;
        }
      }
      if (items.length > 0) {
        console.log(`[stock-news] 1티어 완료 — keyword: "${keyword}", 결과: ${items.length}건`);
        return items;
      }
      console.log(`[stock-news] 1티어 0건 — 2티어 진입`);
    }
  } catch (err) {
    console.error(`[stock-news] 1티어 예외 — keyword: "${keyword}"`, err);
  }

  // ── 2티어: 네이버 금융 뉴스 검색 (EUC-KR 디코딩, 봇 차단 우회 대안) ────────────
  try {
    const url2 = `https://finance.naver.com/news/news_search.naver?q=${encodeURIComponent(keyword)}`;
    const res2 = await withTimeout(url2, {
      headers: {
        'User-Agent': UA,
        Accept: 'text/html,application/xhtml+xml',
        'Accept-Language': 'ko-KR,ko;q=0.9',
        Referer: 'https://finance.naver.com/',
      },
    }, 8000);
    if (!res2.ok) {
      console.error(`[stock-news] 2티어 HTTP ${res2.status} — keyword: "${keyword}"`);
    } else {
      const buf = await res2.arrayBuffer();
      const html2 = new TextDecoder('euc-kr').decode(buf);
      const items2: StockNewsItem[] = [];
      const titleRE = /<td[^>]*class=["']title["'][^>]*>[\s\S]*?<a\s+href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/g;
      for (const [, href, rawText] of html2.matchAll(titleRE)) {
        const title = cleanText(rawText.replace(/<[^>]*>/g, ''));
        if (title) {
          items2.push({ title, preview: '', url: resolveNaverUrl(href) });
          if (items2.length >= 3) break;
        }
      }
      if (items2.length > 0) {
        console.log(`[stock-news] 2티어 완료 — keyword: "${keyword}", 결과: ${items2.length}건`);
        return items2;
      }
      console.log(`[stock-news] 2티어 0건 — 3티어 진입`);
    }
  } catch (err) {
    console.error(`[stock-news] 2티어 예외 — keyword: "${keyword}"`, err);
  }

  // ── 3티어: 네이버 모바일 시장 전체 뉴스 (특정 종목 하드코딩 없음) ────────────────
  // 모든 키워드 검색이 차단·실패한 경우 국내 금융 시장 공통 뉴스를 최종 보루로 제공.
  try {
    const items3 = await fetchNaverMobileNews('', 'market');
    console.log(`[stock-news] 3티어 완료 — market 뉴스 ${items3.length}건`);
    return items3;
  } catch (err) {
    console.error(`[stock-news] 3티어 예외`, err);
    return [];
  }
}

// ── 테마 키워드 기반 야후 파이낸스 뉴스 검색 (해외 자산 테마 폴백) ────────────────
// 티커 기반 뉴스가 없을 때 섹터 키워드(예: 'Healthcare Biotech Pharma')로 전환.

async function fetchYahooKeywordNews(keyword: string): Promise<StockNewsItem[]> {
  if (!keyword) return [];
  try {
    const res = await withTimeout(
      `https://query1.finance.yahoo.com/v1/finance/search` +
      `?q=${encodeURIComponent(keyword)}&newsCount=3&enableFuzzyQuery=false`,
      {
        headers: {
          'User-Agent': UA,
          Accept: 'application/json',
          'Accept-Language': 'en-US,en;q=0.9',
        },
      },
    );
    if (!res.ok) return [];
    const json = (await res.json()) as {
      news?: Array<{ title?: string; publisher?: string; link?: string }>;
    };
    return (json.news ?? [])
      .slice(0, 3)
      .map((n) => ({
        title: cleanText(n.title ?? ''),
        preview: n.publisher ? `출처: ${n.publisher}` : '',
        url: n.link ?? '',
      }))
      .filter((n) => n.title);
  } catch {
    return [];
  }
}

// ── GET 핸들러 ────────────────────────────────────────────────────────────────

export async function GET(request: Request): Promise<Response> {
  const { searchParams } = new URL(request.url);
  const ticker = (searchParams.get('ticker') ?? '').trim();
  const keyword = (searchParams.get('keyword') ?? '').trim(); // 섹터/테마 키워드 (선택)
  if (!ticker) return Response.json({ items: [] });

  const isKr = ticker.endsWith('.KS') || ticker.endsWith('.KQ');
  let items: StockNewsItem[];

  try {
    if (isKr) {
      const code = ticker.replace(/\.(KS|KQ)$/, '');
      items = await fetchKoreanNews(code);
    } else {
      items = await fetchForeignNews(ticker);
    }
  } catch {
    items = [];
  }

  // 테마 레벨 뉴스 폴백: 티커 기반 결과 없고 keyword 제공 시 섹터 뉴스로 보완
  if (items.length === 0 && keyword) {
    try {
      items = isKr
        ? await fetchNaverKeywordNews(keyword)
        : await fetchYahooKeywordNews(keyword);
    } catch {
      // 폴백 실패 — 아래 플레이스홀더로 처리
    }
  }

  if (items.length === 0) {
    items = [{ title: '최신 뉴스 제공 준비 중', preview: '실시간 금융 뉴스를 수집하는 중입니다.', url: '' }];
  }

  return Response.json({ items });
}
