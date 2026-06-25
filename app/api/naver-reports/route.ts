import { NextRequest, NextResponse } from 'next/server';

// ─── 데모 데이터 (SK하이닉스 · 최상단 리포트 AI 요약만 즉시 반환) ───────────────

const DEMO_TICKER_CODE = "000660";
export const DEMO_NAVER_PDF_URL =
  "https://ssl.pstatic.net/imgstock/upload/research/company/1750435200001.pdf";

export const DEMO_NAVER_SUMMARY = `**📌 핵심 요약**
- SK하이닉스는 2025년 2분기부터 HBM4를 NVIDIA Blackwell Ultra 플랫폼에 단독 공급하며 AI 가속기 시장의 지배적 지위를 강화하고 있습니다. 2025년 연간 영업이익은 약 27조원으로 사상 최대치 달성이 전망됩니다.

**📊 주요 수치**
- 목표주가: 280,000원 (현재가 대비 **+23% 상승 여력**)
- 투자의견: **매수 (Buy)** 유지
- 2025년 매출 전망: 74조 2,000억원 (전년 대비 +47%)
- 2025년 영업이익 전망: 26조 9,000억원 (전년 대비 +73%)
- HBM 매출 비중: D램 전체의 **45%** 수준 (전년 28%)

**💡 투자 포인트**
- **HBM4 독점 공급**: NVIDIA GB300(Blackwell Ultra) 플랫폼에 HBM4 12단 단독 공급 계약 체결, 경쟁사 대비 약 6개월 기술 선점
- **AI 인프라 투자 사이클**: 글로벌 CSP(AWS·MS·구글·메타)의 2025년 데이터센터 CAPEX가 전년 대비 45% 증가하며 HBM·서버 D램 수요 견인
- **가격 협상력 강화**: HBM 시장점유율 55% 이상으로 수급 여건 우위, 2025년 HBM ASP 전년 대비 12~15% 상승 전망

**⚠️ 주요 리스크**
- 미국 반도체 수출 규제 확대 시 중국향 매출(전체의 약 23%) 급감 가능성
- 삼성전자 HBM4 양산 정상화 시점에 따른 HBM ASP 하방 압력`;

// ─── 실제 라우트 ──────────────────────────────────────────────────────────────

const NAVER_BASE = 'https://finance.naver.com';
const RESEARCH_BASE = `${NAVER_BASE}/research`;
const RESEARCH_LIST_URL = `${RESEARCH_BASE}/company_list.naver`;

const FETCH_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Referer': NAVER_BASE,
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'ko-KR,ko;q=0.9',
};

export type NaverReport = {
  title: string;
  date: string;
  broker: string;
  targetPrice: string;
  investmentOpinion: string;
  pdfUrl: string | null;
  summary: string;
};

// ─── EUC-KR 인코더 (TextDecoder 역방향 lookup) ───────────────────────────────
//
// Node.js는 TextEncoder('euc-kr')을 지원하지 않으나 TextDecoder('euc-kr')는 지원함.
// 0xA1~0xFE 범위의 2바이트 쌍(8836가지)을 EUC-KR로 디코딩해
// Unicode문자 → %XX%XX 맵을 런타임에 빌드한다.
// 한 번 빌드 후 모듈 스코프에 캐싱(~수 ms 소요).

let _eucKrMap: Map<string, string> | null | false = null; // null=미초기화, false=미지원

function getEucKrMap(): Map<string, string> | false {
  if (_eucKrMap !== null) return _eucKrMap as Map<string, string> | false;

  try {
    const decoder = new TextDecoder('euc-kr');
    const map = new Map<string, string>();

    for (let b1 = 0xa1; b1 <= 0xfe; b1++) {
      for (let b2 = 0xa1; b2 <= 0xfe; b2++) {
        const char = decoder.decode(new Uint8Array([b1, b2]));
        // 유효한 단일 문자이고 ASCII가 아닌 경우만 저장
        if (char.length === 1 && char !== '�' && char.charCodeAt(0) > 0x7f) {
          map.set(
            char,
            `%${b1.toString(16).toUpperCase().padStart(2, '0')}%${b2.toString(16).toUpperCase().padStart(2, '0')}`
          );
        }
      }
    }
    _eucKrMap = map;
    return map;
  } catch {
    _eucKrMap = false;
    return false;
  }
}

// 한국어 문자열 → EUC-KR percent-encoded 파라미터 문자열
// 예) "SK하이닉스" → "SK%C7%CF%C0%CC%B4%D0%BD%BA"
function toEucKrParam(text: string): string {
  const map = getEucKrMap();
  if (!map) return '';

  let result = '';
  for (const ch of text) {
    if (ch.charCodeAt(0) <= 0x7f) {
      result += encodeURIComponent(ch); // ASCII
    } else {
      const enc = map.get(ch);
      if (!enc) return ''; // EUC-KR에 없는 문자 → 실패
      result += enc;
    }
  }
  return result;
}

// ─── URL 경로 해결 ────────────────────────────────────────────────────────────

function resolveUrl(path: string): string {
  if (!path) return '';
  if (path.startsWith('http')) return path;
  if (path.startsWith('/')) return `${NAVER_BASE}${path}`;
  return `${RESEARCH_BASE}/${path}`;
}

// ─── HTML fetch (EUC-KR / UTF-8 자동 감지) ──────────────────────────────────

async function fetchHtml(url: string): Promise<{ html: string; ok: boolean }> {
  try {
    const res = await fetch(url, { headers: FETCH_HEADERS, cache: 'no-store' });
    if (!res.ok) return { html: '', ok: false };

    const buffer = await res.arrayBuffer();
    const ct = res.headers.get('content-type') ?? '';

    if (/charset=utf-8/i.test(ct)) {
      return { html: new TextDecoder('utf-8').decode(buffer), ok: true };
    }
    try {
      const decoded = new TextDecoder('euc-kr').decode(buffer);
      if (/[가-힣]/.test(decoded)) return { html: decoded, ok: true };
    } catch { /* fall through */ }
    return { html: new TextDecoder('utf-8').decode(buffer), ok: true };
  } catch {
    return { html: '', ok: false };
  }
}

// ─── 한국어 종목명 조회 ───────────────────────────────────────────────────────

async function getKorName(code: string): Promise<string> {
  const { html } = await fetchHtml(`${NAVER_BASE}/item/main.naver?code=${code}`);
  const m = html.match(/<title>\s*([^:<|\n\r(]+)/);
  return m ? m[1].trim() : '';
}

// ─── HTML 파싱 ────────────────────────────────────────────────────────────────

function extractText(html: string): string {
  return html.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').trim();
}

function extractCells(rowHtml: string): string[] {
  const cells: string[] = [];
  const re = /<td[^>]*>([\s\S]*?)<\/td>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(rowHtml)) !== null) cells.push(m[1]);
  return cells;
}

type RawRow = {
  title: string; date: string; broker: string;
  pdfUrl: string | null; detailUrl: string | null;
};

// keyword 검색 결과용 — 결과 페이지의 모든 행이 이미 해당 종목
function parseFilteredRows(html: string): RawRow[] {
  const results: RawRow[] = [];
  const trRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let m: RegExpExecArray | null;
  while ((m = trRe.exec(html)) !== null) {
    const cells = extractCells(m[1]);
    if (cells.length < 5) continue;
    if (extractText(cells[0]).length < 2) continue;

    const titleMatch = cells[1].match(/href="([^"]+)"[^>]*>\s*([^<]+)/);
    if (!titleMatch || !titleMatch[2].trim()) continue;

    const date = extractText(cells[4]);
    if (!date) continue;

    results.push({
      title: titleMatch[2].trim(),
      date,
      broker: extractText(cells[2]),
      pdfUrl: cells[3].match(/href="([^"]+)"/) ? resolveUrl(cells[3].match(/href="([^"]+)"/)![1]) : null,
      detailUrl: resolveUrl(titleMatch[1]),
    });
  }
  return results;
}

// 전체 목록용 — 종목코드로 필터링 (fallback)
function parseUnfilteredRows(html: string, code: string): RawRow[] {
  const results: RawRow[] = [];
  const trRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let m: RegExpExecArray | null;
  while ((m = trRe.exec(html)) !== null) {
    const cells = extractCells(m[1]);
    if (cells.length < 5) continue;
    if (!cells[0].includes(`code=${code}`)) continue;

    const titleMatch = cells[1].match(/href="([^"]+)"[^>]*>\s*([^<]+)/);
    if (!titleMatch || !titleMatch[2].trim()) continue;

    const date = extractText(cells[4]);
    if (!date) continue;

    results.push({
      title: titleMatch[2].trim(),
      date,
      broker: extractText(cells[2]),
      pdfUrl: cells[3].match(/href="([^"]+)"/) ? resolveUrl(cells[3].match(/href="([^"]+)"/)![1]) : null,
      detailUrl: resolveUrl(titleMatch[1]),
    });
  }
  return results;
}

// ─── 상세 페이지 → 목표가·투자의견 ──────────────────────────────────────────
// HTML 태그를 제거한 평문에서 정규식 매칭해야 올바르게 추출됨

async function fetchDetail(url: string): Promise<{
  targetPrice: string; investmentOpinion: string; summary: string;
}> {
  const { html, ok } = await fetchHtml(url);
  if (!ok || !html) return { targetPrice: '-', investmentOpinion: '-', summary: '' };

  // HTML 태그 제거 후 평문에서 추출 (태그가 섞이면 정규식 미매칭)
  const plain = html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ');

  const tpMatch = plain.match(/목표가\s*([\d,]+)/);
  const targetPrice = tpMatch ? tpMatch[1] : '-';

  const ioMatch = plain.match(
    /투자의견\s*(Buy|Sell|Hold|매수|매도|중립|Strong\s*Buy|Outperform|Underperform|Marketperform|Not\s*Rated|N\/R|비중확대|비중축소)/i
  );
  const investmentOpinion = ioMatch ? ioMatch[1].trim() : '-';

  return { targetPrice, investmentOpinion, summary: '' };
}

// ─── 메인 핸들러 ─────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const rawTicker = req.nextUrl.searchParams.get('ticker') ?? '';
  const name = req.nextUrl.searchParams.get('name') ?? '';
  const isDebug = req.nextUrl.searchParams.get('debug') === '1';

  const code = rawTicker.split('.')[0].replace(/\D/g, '').slice(0, 6);
  if (!code || code.length !== 6) {
    return NextResponse.json({ error: '유효한 종목 코드(6자리)가 필요합니다.' }, { status: 400 });
  }

  // 한국어 종목명 + EUC-KR 파라미터 생성
  const korName = await getKorName(code) || name;
  const eucKrParam = toEucKrParam(korName);

  // ── 디버그 모드 ─────────────────────────────────────────────────────────────
  if (isDebug) {
    const testUrl = eucKrParam
      ? `${RESEARCH_LIST_URL}?searchType=keyword&keyword=${eucKrParam}&page=1`
      : `${RESEARCH_LIST_URL}?page=1`;
    const { html, ok } = await fetchHtml(testUrl);
    const rows = eucKrParam ? parseFilteredRows(html) : parseUnfilteredRows(html, code);

    return NextResponse.json({
      ok,
      korName,
      eucKrParam,
      testUrl,
      trCount: (html.match(/<tr/g) ?? []).length,
      rowCount: rows.length,
      firstRows: rows.slice(0, 3),
      eucKrMapSize: (() => { const m = getEucKrMap(); return m ? m.size : 0; })(),
    });
  }

  const rawItems: RawRow[] = [];

  // ── 1단계: EUC-KR keyword 검색 후 code로 재필터 ─────────────────────────────
  // keyword=SK하이닉스 검색은 제목에 SK하이닉스가 포함된 타 종목 리포트도 반환함.
  // parseUnfilteredRows(html, code)로 cells[0]의 code=000660만 추출.
  if (eucKrParam) {
    for (let page = 1; page <= 10; page++) {
      if (rawItems.length >= 15) break;
      const url =
        `${RESEARCH_LIST_URL}?searchType=keyword&keyword=${eucKrParam}` +
        `&brokerCode=&writeFromDate=&writeToDate=&itemName=&page=${page}`;
      const { html, ok } = await fetchHtml(url);
      if (!ok) break;
      // 전체 행 수가 0이면 마지막 페이지 도달
      const allRows = parseFilteredRows(html);
      if (allRows.length === 0 && page > 1) break;
      // code 기준으로 해당 종목만 추출
      rawItems.push(...parseUnfilteredRows(html, code));
    }
  }

  // ── 2단계: 전체 목록 병렬 탐색 (fallback — 최대 5묶음×5페이지) ─────────────
  if (rawItems.length === 0) {
    const BATCH = 5;
    outer: for (let b = 0; b < 5; b++) {
      const fetches = Array.from({ length: BATCH }, (_, i) =>
        fetchHtml(`${RESEARCH_LIST_URL}?page=${b * BATCH + i + 1}`)
      );
      const results = await Promise.all(fetches);
      for (const { html, ok } of results) {
        if (!ok) continue;
        rawItems.push(...parseUnfilteredRows(html, code));
      }
      if (rawItems.length >= 10) break outer;
    }
  }

  // 중복 제거
  const seen = new Set<string>();
  const unique = rawItems.filter((r) => {
    const key = `${r.title}::${r.date}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // 상위 10개 상세 페이지 병렬 조회
  const reports: NaverReport[] = await Promise.all(
    unique.slice(0, 10).map(async (r) => {
      const detail = r.detailUrl
        ? await fetchDetail(r.detailUrl)
        : { targetPrice: '-', investmentOpinion: '-', summary: '' };
      return { title: r.title, date: r.date, broker: r.broker, pdfUrl: r.pdfUrl, ...detail };
    })
  );

  // SK하이닉스 최상단 리포트 AI 요약 즉시 주입 (Gemini PDF 요약 대기 없이 바로 표시)
  if (code === DEMO_TICKER_CODE && reports.length > 0) {
    reports[0] = { ...reports[0], summary: DEMO_NAVER_SUMMARY };
  }

  return NextResponse.json({
    reports,
    _debug: { korName, eucKrParam, found: unique.length },
  });
}
