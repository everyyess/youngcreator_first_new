import { NextRequest, NextResponse } from "next/server";
import { formatSupabaseError, getInsightSupabase, insightDbUnavailable } from "@/lib/supabaseInsightDb";
import { normalizeCompanies, normalizeMacro, normalizeTopics } from "@/lib/tagRules";

export type ReportCategory = "company" | "industry" | "invest" | "economy";
export type ReportItem = {
  title: string;
  category: ReportCategory;
  itemName: string;
  broker: string;
  date: string;
  pdfUrl: string | null;
  detailUrl: string;
};

// finance.naver.com/research 가 클라이언트 렌더링 SPA로 바뀌어 HTML 표 파싱이 항상 0건이 됐다.
// (리포트 DB 0개 원인) m.stock.naver.com 모바일 리서치 JSON API로 교체 — api/naver-reports·
// lib/liveInsightSources 와 동일한 방식.
const NAVER_MOBILE = "https://m.stock.naver.com";
const CATEGORIES: ReportCategory[] = ["company", "industry", "invest", "economy"];
const MOBILE_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  Referer: `${NAVER_MOBILE}/`,
  Accept: "application/json, text/plain, */*",
  "Accept-Language": "ko-KR,ko;q=0.9,en;q=0.8",
};

type NaverResearchSummary = {
  researchId?: number;
  title?: string;
  brokerName?: string;
  writeDate?: string; // "2026-09-11"
  itemName?: string;
  category?: string;
  endUrl?: string;
};
type NaverResearchDetail = {
  researchContent?: {
    title?: string;
    brokerName?: string;
    writeDate?: string;
    attachUrl?: string;
    content?: string;
    opinion?: string;
    goalPrice?: string | number;
  };
};

const stripHtml = (value?: string) =>
  (value ?? "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s+\n/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, {
    headers: MOBILE_HEADERS,
    cache: "no-store",
    signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok) throw new Error(`네이버 리서치 응답 오류 (${response.status})`);
  return response.json() as Promise<T>;
}

function toReportItem(row: NaverResearchSummary, category: ReportCategory): ReportItem | null {
  const title = (row.title ?? "").trim();
  const detailUrl = (
    row.endUrl?.trim() ||
    (row.researchId ? `${NAVER_MOBILE}/research/${category}/${row.researchId}` : "")
  ).trim();
  const date = (row.writeDate ?? "").trim();
  if (!title || !detailUrl || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const rawItemName = (row.itemName ?? "").trim();
  const itemName = ["기타", "기타법인", "-"].includes(rawItemName) ? "" : rawItemName;
  return {
    title,
    category,
    itemName: itemName || (row.category ?? "").trim(),
    broker: (row.brokerName ?? "").trim(),
    date,
    pdfUrl: null, // 목록에는 PDF URL이 없다 — 상세(action=detail)에서 attachUrl을 채운다
    detailUrl,
  };
}

/** endUrl 에서 {category}/{researchId} 를 뽑는다 (예: .../research/company/96086) */
function parseDetailUrl(url: string): { category: ReportCategory; researchId: string } | null {
  const match = url.match(/\/research\/(company|industry|invest|economy)\/(\d+)/);
  if (!match) return null;
  return { category: match[1] as ReportCategory, researchId: match[2] };
}

function formatGoalPrice(value?: string | number): string {
  if (value == null || value === "") return "-";
  const numeric = Number(String(value).replace(/,/g, ""));
  return Number.isFinite(numeric) && numeric > 0 ? numeric.toLocaleString("ko-KR") : "-";
}

export async function GET(req: NextRequest) {
  const action = req.nextUrl.searchParams.get("action") ?? "list";

  if (action === "detail") {
    const url = req.nextUrl.searchParams.get("url") ?? "";
    const parsed = parseDetailUrl(url);
    if (!parsed) return NextResponse.json({ text: "", targetPrice: "-", opinion: "-" });
    try {
      const detail = await fetchJson<NaverResearchDetail>(
        `${NAVER_MOBILE}/api/research/${parsed.category}/${parsed.researchId}`,
      );
      const content = detail.researchContent;
      return NextResponse.json({
        text: stripHtml(content?.content),
        targetPrice: formatGoalPrice(content?.goalPrice),
        opinion: content?.opinion?.trim() || "-",
        pdfUrl: content?.attachUrl?.trim() || null,
      });
    } catch (error) {
      return NextResponse.json({ error: String(error) }, { status: 400 });
    }
  }

  if (action === "saved") {
    const db = getInsightSupabase(req);
    if (!db) return NextResponse.json(insightDbUnavailable(), { status: 401 });
    const { data, error } = await db
      .from("report_db")
      .select(
        "id,title,url,category,broker,item_name,published_date,pdf_url,ai_summary,original_text,topic_tags,company_tags,macro_tags,notes,created_at",
      )
      .order("created_at", { ascending: false })
      .limit(2000);
    return error
      ? NextResponse.json({ error: formatSupabaseError(error) }, { status: 500 })
      : NextResponse.json({ reports: data ?? [] });
  }

  // action === "list" — 네이버 공개 리서치 목록이라 Supabase 세션이 필요 없다.
  const raw = req.nextUrl.searchParams.get("category") as ReportCategory | null;
  const category: ReportCategory = raw && CATEGORIES.includes(raw) ? raw : "company";
  const page = Math.max(1, Number(req.nextUrl.searchParams.get("page") ?? 1) || 1);
  try {
    const rows = await fetchJson<unknown>(
      `${NAVER_MOBILE}/api/research/${category}?page=${page}&pageSize=30`,
    );
    let reports = (Array.isArray(rows) ? (rows as NaverResearchSummary[]) : [])
      .map((row) => toReportItem(row, category))
      .filter((item): item is ReportItem => item !== null);
    const keyword = (req.nextUrl.searchParams.get("keyword") ?? "").trim().toLowerCase();
    if (keyword) {
      reports = reports.filter((r) =>
        `${r.title} ${r.itemName} ${r.broker}`.toLowerCase().includes(keyword),
      );
    }
    return NextResponse.json({
      category,
      reports: reports.slice(0, 60),
      page,
      hasMore: reports.length >= 30,
    });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 502 });
  }
}

export async function POST(req: NextRequest) {
  const db = getInsightSupabase(req);
  if (!db) return NextResponse.json(insightDbUnavailable(), { status: 401 });
  const v = (await req.json()) as Record<string, unknown>;
  const row = {
    title: String(v.title ?? ""),
    url: String(v.url ?? ""),
    category: String(v.category ?? "company"),
    broker: String(v.broker ?? ""),
    item_name: String(v.item_name ?? ""),
    published_date: v.published_date || null,
    pdf_url: v.pdf_url || null,
    ai_summary: String(v.ai_summary ?? ""),
    original_text: String(v.original_text ?? "").slice(0, 20000),
    topic_tags: normalizeTopics(Array.isArray(v.topic_tags) ? v.topic_tags.map(String) : []),
    company_tags: normalizeCompanies(Array.isArray(v.company_tags) ? v.company_tags.map(String) : []),
    macro_tags: normalizeMacro(Array.isArray(v.macro_tags) ? v.macro_tags.map(String) : []),
    notes: String(v.notes ?? ""),
  };
  if (!row.title || !row.url) return NextResponse.json({ error: "제목과 URL이 필요합니다." }, { status: 400 });
  const { data, error } = await db.from("report_db").upsert(row, { onConflict: "url" }).select().single();
  return error
    ? NextResponse.json({ error: formatSupabaseError(error) }, { status: 500 })
    : NextResponse.json({ report: data });
}

export async function DELETE(req: NextRequest) {
  const db = getInsightSupabase(req);
  if (!db) return NextResponse.json(insightDbUnavailable(), { status: 401 });
  const { id } = await req.json();
  const { error } = await db.from("report_db").delete().eq("id", String(id ?? ""));
  return error
    ? NextResponse.json({ error: formatSupabaseError(error) }, { status: 500 })
    : NextResponse.json({ ok: true });
}
