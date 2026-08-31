import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { fetchPreviousUsMarketBrief } from "@/services/alphaVantageService";
import { fetchTodayKoreanMarketBrief } from "@/services/kisService";

export type MarketReportMarket = "us" | "kr";
export type MarketReportStatus = "pending" | "success" | "failed";
export type MarketReportGenerationType = "scheduled" | "manual";

export type MarketReport = {
  market: MarketReportMarket;
  reportDate: string;
  generatedAt: string | null;
  dataAsOf: string | null;
  generationStatus: MarketReportStatus;
  generationType: MarketReportGenerationType;
  title: string;
  summary: string;
  sections: { bullets?: string[]; [key: string]: unknown };
  pbComment: string;
  errorMessage?: string | null;
};

type MarketReportRow = {
  market: MarketReportMarket;
  report_date: string;
  generated_at: string | null;
  data_as_of: string | null;
  generation_status: MarketReportStatus;
  generation_type: MarketReportGenerationType;
  title: string | null;
  summary: string | null;
  sections: MarketReport["sections"] | null;
  pb_comment: string | null;
  error_message: string | null;
};

const KST_TIME_ZONE = "Asia/Seoul";
const REPORT_TABLE = "market_reports";

function getSupabaseAdmin(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

function kstParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: KST_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    date: map.year + "-" + map.month + "-" + map.day,
    hour: Number(map.hour),
    minute: Number(map.minute),
  };
}

function addDays(dateText: string, days: number) {
  const date = new Date(dateText + "T00:00:00.000Z");
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function isWeekend(dateText: string) {
  const day = new Date(dateText + "T00:00:00.000Z").getUTCDay();
  return day === 0 || day === 6;
}

function previousBusinessDay(dateText: string) {
  let current = addDays(dateText, -1);
  while (isWeekend(current)) current = addDays(current, -1);
  return current;
}

function todayOrPreviousBusinessDay(dateText: string) {
  let current = dateText;
  while (isWeekend(current)) current = addDays(current, -1);
  return current;
}

export function getDefaultReportDate(market: MarketReportMarket, now = new Date()) {
  const parts = kstParts(now);
  return market === "us" ? previousBusinessDay(parts.date) : todayOrPreviousBusinessDay(parts.date);
}

function rowToReport(row: MarketReportRow): MarketReport {
  return {
    market: row.market,
    reportDate: row.report_date,
    generatedAt: row.generated_at,
    dataAsOf: row.data_as_of,
    generationStatus: row.generation_status,
    generationType: row.generation_type,
    title: row.title || (row.market === "us" ? "전일 미국 시황" : "당일 국내 시황"),
    summary: row.summary || "",
    sections: row.sections || {},
    pbComment: row.pb_comment || "",
    errorMessage: row.error_message,
  };
}

function emptyReport(market: MarketReportMarket, reportDate = getDefaultReportDate(market), status: MarketReportStatus = "pending", errorMessage: string | null = null): MarketReport {
  return {
    market,
    reportDate,
    generatedAt: null,
    dataAsOf: null,
    generationStatus: status,
    generationType: "scheduled",
    title: market === "us" ? "전일 미국 시황" : "당일 국내 시황",
    summary: "",
    sections: { bullets: [] },
    pbComment: "",
    errorMessage,
  };
}

async function readExistingPbComment(market: MarketReportMarket, reportDate: string) {
  const supabase = getSupabaseAdmin();
  if (!supabase) return "";

  const { data } = await supabase
    .from(REPORT_TABLE)
    .select("pb_comment")
    .eq("market", market)
    .eq("report_date", reportDate)
    .maybeSingle();

  const value = (data as { pb_comment?: unknown } | null)?.pb_comment;
  return typeof value === "string" ? value : "";
}

async function upsertReport(report: MarketReport) {
  const supabase = getSupabaseAdmin();
  if (!supabase) return { ok: false, error: "SUPABASE_SERVICE_ROLE_KEY가 설정되지 않았습니다." };

  const { error } = await supabase.from(REPORT_TABLE).upsert({
    market: report.market,
    report_date: report.reportDate,
    generated_at: report.generatedAt,
    data_as_of: report.dataAsOf,
    generation_status: report.generationStatus,
    generation_type: report.generationType,
    title: report.title,
    summary: report.summary,
    sections: report.sections,
    pb_comment: report.pbComment ?? "",
    error_message: report.errorMessage ?? null,
    updated_at: new Date().toISOString(),
  }, { onConflict: "market,report_date" });

  return { ok: !error, error: error?.message || null };
}

export async function listMarketReports(markets: MarketReportMarket[] = ["us", "kr"]): Promise<{ reports: MarketReport[]; error?: string }> {
  const supabase = getSupabaseAdmin();
  const fallback = markets.map((market) => emptyReport(market));
  if (!supabase) return { reports: fallback, error: "SUPABASE_SERVICE_ROLE_KEY가 설정되지 않았습니다." };

  const reportDates = markets.map((market) => getDefaultReportDate(market));
  const { data, error } = await supabase
    .from(REPORT_TABLE)
    .select("market, report_date, generated_at, data_as_of, generation_status, generation_type, title, summary, sections, pb_comment, error_message")
    .in("market", markets)
    .in("report_date", reportDates);

  if (error) return { reports: fallback, error: error.message };

  const rows = (data || []) as MarketReportRow[];
  const reports = markets.map((market) => {
    const reportDate = getDefaultReportDate(market);
    const found = rows.find((row) => row.market === market && row.report_date === reportDate);
    return found ? rowToReport(found) : emptyReport(market, reportDate);
  });

  return { reports };
}

async function buildReport(market: MarketReportMarket, generationType: MarketReportGenerationType): Promise<MarketReport> {
  const reportDate = getDefaultReportDate(market);
  const generatedAt = new Date().toISOString();
  const pbComment = await readExistingPbComment(market, reportDate);

  if (market === "us") {
    const brief = await fetchPreviousUsMarketBrief(reportDate);
    return {
      market,
      reportDate,
      generatedAt,
      dataAsOf: brief.dataAsOf,
      generationStatus: "success",
      generationType,
      title: "전일 미국 시황",
      summary: brief.headline,
      sections: { bullets: brief.bullets },
      pbComment,
      errorMessage: null,
    };
  }

  const brief = await fetchTodayKoreanMarketBrief(reportDate);
  if (brief.reportDate !== reportDate || !brief.dataAsOf || !brief.bullets.length) {
    throw new Error("국내 시황 필수 데이터가 아직 준비되지 않았습니다.");
  }

  return {
    market,
    reportDate,
    generatedAt,
    dataAsOf: brief.dataAsOf,
    generationStatus: "success",
    generationType,
    title: "당일 국내 시황",
    summary: brief.headline,
    sections: { bullets: brief.bullets },
    pbComment,
    errorMessage: null,
  };
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function generateMarketReport(market: MarketReportMarket, generationType: MarketReportGenerationType = "manual") {
  try {
    const report = await buildReport(market, generationType);
    const saved = await upsertReport(report);
    if (!saved.ok) {
      return { report: { ...report, generationStatus: "failed" as const, errorMessage: saved.error }, error: saved.error || undefined };
    }
    return { report };
  } catch (error) {
    const message = error instanceof Error ? error.message : "시황 보고서 생성에 실패했습니다.";
    const failed = emptyReport(market, getDefaultReportDate(market), "failed", message);
    failed.generatedAt = new Date().toISOString();
    failed.generationType = generationType;
    failed.pbComment = await readExistingPbComment(market, failed.reportDate);
    await upsertReport(failed);
    return { report: failed, error: message };
  }
}

export async function saveMarketReportPbComment(pbComment: string, markets: MarketReportMarket[] = ["us", "kr"]) {
  const supabase = getSupabaseAdmin();
  if (!supabase) return { ok: false, error: "SUPABASE_SERVICE_ROLE_KEY가 설정되지 않았습니다." };

  const trimmed = pbComment.slice(0, 100);
  const now = new Date().toISOString();

  for (const market of markets) {
    const reportDate = getDefaultReportDate(market);
    const { data, error } = await supabase
      .from(REPORT_TABLE)
      .update({ pb_comment: trimmed, updated_at: now })
      .eq("market", market)
      .eq("report_date", reportDate)
      .select("market");

    if (error) return { ok: false, error: error.message };
    if (Array.isArray(data) && data.length > 0) continue;

    const { error: insertError } = await supabase.from(REPORT_TABLE).insert({
      market,
      report_date: reportDate,
      generation_status: "pending",
      generation_type: "manual",
      title: market === "us" ? "전일 미국 시황" : "당일 국내 시황",
      summary: "",
      sections: { bullets: [] },
      pb_comment: trimmed,
      updated_at: now,
    });

    if (insertError) return { ok: false, error: insertError.message };
  }

  return { ok: true, pbComment: trimmed };
}

export async function runScheduledMarketReport(market: MarketReportMarket) {
  const maxAttempts = market === "kr" ? 4 : 1;
  const retryDelayMs = 15_000;
  let lastResult = await generateMarketReport(market, "scheduled");

  for (let attempt = 1; market === "kr" && attempt < maxAttempts && lastResult.report.generationStatus === "failed"; attempt += 1) {
    await wait(retryDelayMs);
    lastResult = await generateMarketReport(market, "scheduled");
  }

  return lastResult;
}
