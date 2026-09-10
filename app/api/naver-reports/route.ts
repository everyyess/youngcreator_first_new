import { NextRequest, NextResponse } from "next/server";

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

const NAVER_MOBILE = "https://m.stock.naver.com";
const FETCH_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  Referer: `${NAVER_MOBILE}/`,
  Accept: "application/json, text/plain, */*",
  "Accept-Language": "ko-KR,ko;q=0.9,en;q=0.8",
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

type ResearchSummary = {
  researchId?: number;
  itemCode?: string;
  itemName?: string;
  title?: string;
  brokerName?: string;
  writeDate?: string;
  previewContent?: string;
};

type ResearchDetail = {
  researchContent?: {
    researchId?: number;
    title?: string;
    brokerName?: string;
    writeDate?: string;
    attachUrl?: string;
    content?: string;
    opinion?: string;
    goalPrice?: string | number;
  };
};

function stripHtml(value?: string): string {
  return (value ?? "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function formatGoalPrice(value?: string | number): string {
  if (value == null || value === "") return "-";
  const numeric = Number(String(value).replace(/,/g, ""));
  return Number.isFinite(numeric) && numeric > 0 ? numeric.toLocaleString("ko-KR") : "-";
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, {
    headers: FETCH_HEADERS,
    cache: "no-store",
    signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok) {
    throw new Error(`네이버 리서치 응답 오류 (${response.status})`);
  }
  return response.json() as Promise<T>;
}

async function toReport(item: ResearchSummary): Promise<NaverReport> {
  if (!item.researchId) {
    return {
      title: item.title?.trim() || "제목 없음",
      date: item.writeDate || "-",
      broker: item.brokerName || "-",
      targetPrice: "-",
      investmentOpinion: "-",
      pdfUrl: null,
      summary: stripHtml(item.previewContent),
    };
  }

  try {
    const detail = await fetchJson<ResearchDetail>(
      `${NAVER_MOBILE}/api/research/company/${item.researchId}`,
    );
    const content = detail.researchContent;
    return {
      title: content?.title?.trim() || item.title?.trim() || "제목 없음",
      date: content?.writeDate || item.writeDate || "-",
      broker: content?.brokerName || item.brokerName || "-",
      targetPrice: formatGoalPrice(content?.goalPrice),
      investmentOpinion: content?.opinion?.trim() || "-",
      pdfUrl: content?.attachUrl?.trim() || null,
      summary: stripHtml(content?.content || item.previewContent),
    };
  } catch {
    // 한 건의 상세 조회가 실패해도 목록 전체를 버리지 않는다.
    return {
      title: item.title?.trim() || "제목 없음",
      date: item.writeDate || "-",
      broker: item.brokerName || "-",
      targetPrice: "-",
      investmentOpinion: "-",
      pdfUrl: null,
      summary: stripHtml(item.previewContent),
    };
  }
}

export async function GET(req: NextRequest) {
  const rawTicker = req.nextUrl.searchParams.get("ticker") ?? "";
  const isDebug = req.nextUrl.searchParams.get("debug") === "1";
  const code = rawTicker.split(".")[0].replace(/\D/g, "").slice(0, 6);

  if (code.length !== 6) {
    return NextResponse.json(
      { error: "유효한 종목 코드(6자리)가 필요합니다." },
      { status: 400 },
    );
  }

  try {
    const listUrl = `${NAVER_MOBILE}/api/research/stock/${code}?page=1&pageSize=20`;
    const raw = await fetchJson<unknown>(listUrl);
    const items = (Array.isArray(raw) ? raw : [])
      .filter((item): item is ResearchSummary => Boolean(item && typeof item === "object"))
      .filter((item) => !item.itemCode || item.itemCode === code)
      .slice(0, 10);

    const reports = await Promise.all(items.map(toReport));
    if (code === DEMO_TICKER_CODE && reports.length > 0) {
      reports[0] = { ...reports[0], summary: DEMO_NAVER_SUMMARY };
    }

    return NextResponse.json({
      reports,
      ...(isDebug
        ? {
            _debug: {
              source: "naver-mobile-research-api",
              code,
              found: reports.length,
              itemName: items[0]?.itemName ?? "",
            },
          }
        : {}),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "네이버 리포트를 불러오지 못했습니다.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
