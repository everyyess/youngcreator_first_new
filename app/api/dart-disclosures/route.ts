import { NextRequest, NextResponse } from "next/server";
import { unstable_cache } from "next/cache";

// ─── 데모 데이터 (SK하이닉스 · 최상단 공시 AI 요약만 즉시 주입) ─────────────────

const DEMO_SEARCH_KEY = "000660";

const DEMO_DART_EARNINGS_SUMMARY = `**📌 핵심 내용**
- SK하이닉스는 2024년 AI 메모리 수요 급증에 힘입어 매출 66조 1,930억원, 영업이익 23조 4,673억원을 기록하며 역대 두 번째 영업이익을 달성했습니다. HBM 중심의 프리미엄 D램 성장이 실적을 견인했으며, 낸드 부문도 흑자로 전환했습니다.

**📊 주요 수치 (전기 대비 변화)**
- 매출액: 66조 1,930억원 (전년 32조 7,660억원 대비 **+102%**)
- 영업이익: 23조 4,673억원 (전년 영업손실 7조 7,303억원에서 **흑자 전환**)
- 당기순이익: 19조 7,797억원 (전년 당기순손실 9조 8,199억원에서 **흑자 전환**)
- 영업이익률: 35.5% (전년 -23.6%)
- HBM 매출: D램 전체의 약 40% 차지 (전년 약 16%)

**🏢 사업 현황 (II. 사업의 내용)**
- 주요 제품: D램(HBM3E·DDR5·LPDDR5X), 낸드(eSSD·모바일), CXL 메모리
- HBM3E 128GB 12단 세계 최초 양산 개시 — NVIDIA H200 전량 공급
- 낸드: 321단 TLC 낸드 양산 전환 완료, 기업용 SSD 시장 점유율 확대
- 수주 동향: AI 가속기 수요 급증으로 HBM 수주잔고 2025년 말까지 완판 수준

**💡 투자 시사점**
- 2025년에도 HBM4 공급 확대와 높은 ASP 유지로 실적 성장세 지속 전망
- 낸드 부문 흑자 전환 → 포트폴리오 개선으로 전사 수익성 안정화
- NVIDIA 의존도(HBM 매출의 약 70%) 리스크는 고객 다변화(MS·구글·아마존) 진행 중`;

const DEMO_DART_STAKES_SUMMARY = `**📌 핵심 내용**
- 글로벌 최대 자산운용사 블랙록(BlackRock, Inc.)이 SK하이닉스 지분을 5.23%에서 5.71%로 0.48%p 확대했습니다. 장내 매수를 통해 약 2,950억원 규모를 추가 매입한 것으로 보유 목적은 '단순 투자'입니다.

**📊 주요 수치**
- 보유 주식수: 39,521,480주 → 43,094,200주 (**+3,572,720주** 증가)
- 보유 비율: 5.23% → **5.71%** (+0.48%p)
- 신규 취득 단가: 약 225,000~228,000원/주 (추정)
- 취득 금액: 약 **2,950억원** (시장가 기준)
- 보유 목적: 단순 투자

**📋 변동 사유**
- 변동방법: 장내 매수
- 변동사유: 투자 포트폴리오 비중 조정을 위한 추가 매수

**💡 투자 시사점**
- 블랙록의 지분 확대는 글로벌 기관의 SK하이닉스 HBM 성장 스토리에 대한 장기 신뢰를 반영합니다.
- 외국인 지분율 상승은 수급 측면에서 긍정적 신호이며, 패시브 자금 추가 유입 가능성도 있습니다.`;

// ── 캐시 ─────────────────────────────────────────────────────────────────────

const dartCache = new Map<string, { data: unknown; ts: number }>();
const CACHE_TTL = 30 * 60 * 1000; // 30분

// ── 타입 ─────────────────────────────────────────────────────────────────────

export type DartDisclosure = {
  date: string;
  company: string;
  title: string;
  rcpNo: string;
  url: string;
  reporter: string;
  preloadedSummary?: string;
};

export type DartDisclosuresResponse = {
  company: string;
  contracts: DartDisclosure[];
  stakes: DartDisclosure[];
  insiders: DartDisclosure[];
  earnings: DartDisclosure[];
  agreements: DartDisclosure[];
};

// ── HTML 디코딩 (Content-Type charset 우선) ───────────────────────────────────

async function decodeBody(res: Response): Promise<string> {
  const ct = res.headers.get("content-type") ?? "";
  const buf = await res.arrayBuffer();
  const bytes = new Uint8Array(buf);

  const hc = (ct.match(/charset\s*=\s*([^\s;,]+)/i) ?? [])[1]?.toLowerCase() ?? "";
  if (hc) {
    const enc = hc.includes("euc-kr") || hc.includes("ks_c_5601") ? "euc-kr" : hc;
    try { return new TextDecoder(enc).decode(bytes); } catch {}
  }
  const peek = new TextDecoder("latin1").decode(bytes.slice(0, 2048));
  const mc = (peek.match(/charset[=\s'"]+([^'"\s;>]{2,20})/i) ?? [])[1]?.toLowerCase() ?? "";
  if (mc.includes("euc-kr") || mc.includes("ks_c_5601")) {
    try { return new TextDecoder("euc-kr").decode(bytes); } catch {}
  }
  return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
}

// ── HTML 파싱 ─────────────────────────────────────────────────────────────────

function strip(s: string): string {
  return s
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&[a-z#\d]+;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseRows(html: string): DartDisclosure[] {
  const out: DartDisclosure[] = [];
  const trRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let m: RegExpExecArray | null;

  while ((m = trRe.exec(html))) {
    const row = m[1];

    // rcpNo 추출 (href="/dsaf001/main.do?rcpNo=..." 형태)
    const rcp = row.match(/rcpNo=(\d{14})/)?.[1];
    if (!rcp) continue;

    // <td> 목록
    const tds: string[] = [];
    const tdRe = /<td[^>]*>([\s\S]*?)<\/td>/gi;
    let t: RegExpExecArray | null;
    while ((t = tdRe.exec(row))) tds.push(t[1]);
    if (tds.length < 2) continue;

    const cells = tds.map(strip);

    // 날짜 (YYYY.MM.DD)
    const date = cells.find(c => /^\d{4}\.\d{2}\.\d{2}$/.test(c.trim())) ?? "";

    // 보고서명: rcpNo가 포함된 <td>의 텍스트
    const titleIdx = tds.findIndex(td => td.includes(rcp));
    const title = titleIdx >= 0 ? cells[titleIdx] : (cells[2] ?? "");
    if (!title) continue;

    // 회사명: "유" or "코" 접두어 제거
    const company = (cells[1] ?? "")
      .replace(/^[유코스닥]+\s*/, "")
      .replace(/\s*IR\s*$/, "")
      .trim();

    // 제출인
    const reporter = cells[3] ?? "";

    out.push({
      date,
      company,
      title,
      rcpNo: rcp,
      url: `https://dart.fss.or.kr/dsaf001/main.do?rcpNo=${rcp}`,
      reporter,
    });
  }
  return out;
}

// ── 날짜 헬퍼 ─────────────────────────────────────────────────────────────────

function ymd(d: Date): string {
  return [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, "0"),
    String(d.getDate()).padStart(2, "0"),
  ].join("");
}

function dateRange(years: number) {
  const now = new Date();
  const from = new Date(now);
  from.setFullYear(now.getFullYear() - years);
  return { startDate: ymd(from), endDate: ymd(now) };
}

// ── 공통 헤더 ─────────────────────────────────────────────────────────────────

// dsab001/search.ax — 회사별 공시 통합검색 (종목코드·한글명 모두 허용, 전 공시유형)
const HDR1 = {
  "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
  "Referer": "https://dart.fss.or.kr/dsab001/main.do",
  "X-Requested-With": "XMLHttpRequest",
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
};

// dsab007/detailSearch.ax — 지분공시 전용 (D001/D002)
const HDR7 = {
  "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
  "Referer": "https://dart.fss.or.kr/dsab007/main.do",
  "X-Requested-With": "XMLHttpRequest",
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
};

// ── dsab001 fetch 헬퍼 ────────────────────────────────────────────────────────

async function fetchDab001(
  searchKey: string,
  years: number,
  extraParams?: Record<string, string>,
): Promise<DartDisclosure[]> {
  const p = new URLSearchParams({
    currentPage: "1",
    maxResults: "100",
    sort: "date",
    series: "desc",
    textCrpNm: searchKey,
    textCrpCik: "",
    pageGubun: "corp",
    ...dateRange(years),
    ...extraParams,
  });
  const res = await fetch("https://dart.fss.or.kr/dsab001/search.ax", {
    method: "POST",
    headers: HDR1,
    body: p.toString(),
  });
  if (!res.ok) return [];
  return parseRows(await decodeBody(res));
}

// ── 수주 공시 ─────────────────────────────────────────────────────────────────

async function fetchContracts(searchKey: string): Promise<DartDisclosure[]> {
  const rows = await fetchDab001(searchKey, 2);
  return rows
    .filter(r =>
      r.title.includes("단일판매") ||
      r.title.includes("공급계약") ||
      r.title.includes("수주")
    )
    .slice(0, 10);
}

// ── 중요 계약 체결 ────────────────────────────────────────────────────────────

const DART_AGR_RULES: Array<{ tag: string; test: (t: string) => boolean }> = [
  {
    tag: "회사채·대출",
    test: t =>
      t.includes("사채권발행") || t.includes("전환사채") ||
      t.includes("신주인수권부사채") || t.includes("교환사채") ||
      t.includes("회사채") || t.includes("단기차입금") || t.includes("장기차입금"),
  },
  {
    tag: "M&A",
    test: t =>
      t.includes("합병결정") || t.includes("합병계약") ||
      t.includes("영업양도") || t.includes("영업양수") ||
      t.includes("주식취득결정") || t.includes("포괄적주식교환") || t.includes("분할합병"),
  },
  {
    tag: "MOU",
    test: t => t.includes("업무협약") || t.includes("양해각서") || t.includes("MOU"),
  },
  {
    tag: "법적 합의",
    test: t => t.includes("화해") || (t.includes("소송") && t.includes("합의")),
  },
  {
    tag: "라이선스",
    test: t =>
      t.includes("라이선스") || t.includes("기술이전") ||
      t.includes("기술도입") || t.includes("특허실시"),
  },
];

async function fetchAgreements(searchKey: string): Promise<DartDisclosure[]> {
  const rows = await fetchDab001(searchKey, 2);
  const out: DartDisclosure[] = [];
  for (const r of rows) {
    const rule = DART_AGR_RULES.find(ru => ru.test(r.title));
    if (!rule) continue;
    out.push({ ...r, title: `[${rule.tag}] ${r.title}` });
    if (out.length >= 10) break;
  }
  return out;
}

// ── 지분 공시 (D001: 주식등의대량보유상황보고서) ──────────────────────────────

async function fetchStakes(searchKey: string): Promise<DartDisclosure[]> {
  const p = new URLSearchParams({
    currentPage: "1",
    maxResults: "100",
    sort: "date",
    series: "desc",
    businessCode: "all",
    autoSearch: "N",
    textCrpNm: searchKey,
    textCrpCik: "",
    reportName: "",
    tocSrch: "",
    textCrpNm2: "",
    finalReport: "recent",
    publicType: "D001",
    ...dateRange(2),
  });
  const res = await fetch("https://dart.fss.or.kr/dsab007/detailSearch.ax", {
    method: "POST",
    headers: HDR7,
    body: p.toString(),
  });
  if (!res.ok) return [];
  return parseRows(await decodeBody(res)).slice(0, 10);
}

// ── 내부자 거래 (D002: 임원·주요주주 특정증권등 소유상황보고서) ───────────────

async function fetchInsiders(searchKey: string): Promise<DartDisclosure[]> {
  const p = new URLSearchParams({
    currentPage: "1",
    maxResults: "100",
    sort: "date",
    series: "desc",
    businessCode: "all",
    autoSearch: "N",
    textCrpNm: searchKey,
    textCrpCik: "",
    reportName: "",
    tocSrch: "",
    textCrpNm2: "",
    finalReport: "recent",
    publicType: "D002",
    ...dateRange(2),
  });
  const res = await fetch("https://dart.fss.or.kr/dsab007/detailSearch.ax", {
    method: "POST",
    headers: HDR7,
    body: p.toString(),
  });
  if (!res.ok) return [];
  return parseRows(await decodeBody(res)).slice(0, 10);
}

// ── 실적 공시 (정기공시 A001/A002/A003 + 잠정실적) ───────────────────────────

async function fetchEarnings(searchKey: string): Promise<DartDisclosure[]> {
  // ① 정기공시: publicType 다중 선택 (URLSearchParams append 필요)
  const p1 = new URLSearchParams({
    currentPage: "1",
    maxResults: "100",
    sort: "date",
    series: "desc",
    textCrpNm: searchKey,
    textCrpCik: "",
    pageGubun: "corp",
    ...dateRange(5),
  });
  p1.append("publicType", "A001"); // 사업보고서
  p1.append("publicType", "A002"); // 반기보고서
  p1.append("publicType", "A003"); // 분기보고서

  // ② 잠정실적 (전체 공시에서 키워드 필터)
  const [r1, r2] = await Promise.all([
    fetch("https://dart.fss.or.kr/dsab001/search.ax", {
      method: "POST",
      headers: HDR1,
      body: p1.toString(),
    }),
    fetchDab001(searchKey, 5),
  ]);

  const periodic = r1.ok ? parseRows(await decodeBody(r1)) : [];
  const provisional = r2.filter(r => r.title.includes("잠정실적"));

  const seen = new Set<string>();
  return [...periodic, ...provisional]
    .filter(r => {
      if (seen.has(r.rcpNo)) return false;
      seen.add(r.rcpNo);
      return true;
    })
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 10);
}

// ── Next.js Data Cache (Vercel에서 함수 인스턴스 간 공유) ─────────────────────

const fetchDartCached = unstable_cache(
  async (searchKey: string): Promise<DartDisclosuresResponse> => {
    console.log(`[dart] unstable_cache miss — searchKey="${searchKey}"`);
    const [contracts, stakes, insiders, earnings, agreements] = await Promise.all([
      fetchContracts(searchKey),
      fetchStakes(searchKey),
      fetchInsiders(searchKey),
      fetchEarnings(searchKey),
      fetchAgreements(searchKey),
    ]);

    const displayCompany =
      contracts[0]?.company ||
      stakes[0]?.company ||
      insiders[0]?.company ||
      earnings[0]?.company ||
      agreements[0]?.company ||
      searchKey;

    return { company: displayCompany, contracts, stakes, insiders, earnings, agreements };
  },
  ["dart-disclosures"],
  { revalidate: 1800 }
);

// ── Route ─────────────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const ticker  = (req.nextUrl.searchParams.get("ticker")  ?? "").trim();
  const company = (req.nextUrl.searchParams.get("company") ?? "").trim();
  const refresh = req.nextUrl.searchParams.get("refresh") === "1";

  // "373220.KS", "000660.KQ", "005930" 등에서 6자리 숫자 추출 → DART textCrpNm으로 사용
  const numericTicker = ticker.match(/^(\d{6})/)?.[1] ?? "";
  const searchKey = numericTicker || company;
  if (!searchKey) {
    return NextResponse.json({ error: "ticker or company required" }, { status: 400 });
  }

  const cacheKey = `dart:${searchKey}`;
  if (!refresh) {
    const hit = dartCache.get(cacheKey);
    if (hit && Date.now() - hit.ts < CACHE_TTL) {
      return NextResponse.json({ ...injectSKHynixSummaries(hit.data as DartDisclosuresResponse, searchKey), _cached: true });
    }
  }

  try {
    console.log(`[dart] ticker="${ticker}" → numericTicker="${numericTicker}" → searchKey="${searchKey}"`);

    // refresh=1이면 unstable_cache를 우회해 직접 fetch
    if (refresh) {
      const [contracts, stakes, insiders, earnings, agreements] = await Promise.all([
        fetchContracts(searchKey),
        fetchStakes(searchKey),
        fetchInsiders(searchKey),
        fetchEarnings(searchKey),
        fetchAgreements(searchKey),
      ]);
      const displayCompany =
        contracts[0]?.company || stakes[0]?.company ||
        insiders[0]?.company || earnings[0]?.company ||
        agreements[0]?.company || searchKey;
      const data: DartDisclosuresResponse = { company: displayCompany, contracts, stakes, insiders, earnings, agreements };
      dartCache.set(cacheKey, { data, ts: Date.now() });
      return NextResponse.json(injectSKHynixSummaries(data, searchKey));
    }

    // 일반 요청: Next.js Data Cache 사용 (Vercel에서 인스턴스 간 공유됨)
    const data = await fetchDartCached(searchKey);
    console.log(`[dart] results — earnings:${data.earnings.length} stakes:${data.stakes.length}`);
    return NextResponse.json(injectSKHynixSummaries(data, searchKey));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[dart-disclosures]", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// SK하이닉스 최상단 실적·지분 공시에 AI 요약을 즉시 주입하는 헬퍼
function injectSKHynixSummaries(data: DartDisclosuresResponse, searchKey: string): DartDisclosuresResponse {
  if (searchKey !== DEMO_SEARCH_KEY) return data;
  const earnings = [...data.earnings];
  const stakes   = [...data.stakes];
  if (earnings.length > 0) earnings[0] = { ...earnings[0], preloadedSummary: DEMO_DART_EARNINGS_SUMMARY };
  if (stakes.length   > 0) stakes[0]   = { ...stakes[0],   preloadedSummary: DEMO_DART_STAKES_SUMMARY };
  return { ...data, earnings, stakes };
}
