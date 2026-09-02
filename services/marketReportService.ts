import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { fetchPreviousUsMarketBrief } from "@/services/kisUsMarketService";
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
  sections: { bullets?: string[];[key: string]: unknown };
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
const REPORT_SCHEDULE: Record<MarketReportMarket, { hour: number; minute: number; label: string }> = {
  us: { hour: 8, minute: 30, label: "08:30" },
  kr: { hour: 16, minute: 0, label: "16:00" },
};

function getSupabaseAdmin(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
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

function nthWeekdayOfMonth(year: number, monthIndex: number, weekday: number, nth: number) {
  const date = new Date(Date.UTC(year, monthIndex, 1));
  let count = 0;
  while (date.getUTCMonth() === monthIndex) {
    if (date.getUTCDay() === weekday) {
      count += 1;
      if (count === nth) return date.toISOString().slice(0, 10);
    }
    date.setUTCDate(date.getUTCDate() + 1);
  }
  return "";
}

function lastWeekdayOfMonth(year: number, monthIndex: number, weekday: number) {
  const date = new Date(Date.UTC(year, monthIndex + 1, 0));
  while (date.getUTCDay() !== weekday) date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

function observedFixedHoliday(year: number, monthIndex: number, day: number) {
  const date = new Date(Date.UTC(year, monthIndex, day));
  const dow = date.getUTCDay();
  if (dow === 6) date.setUTCDate(date.getUTCDate() - 1);
  if (dow === 0) date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

function easterSunday(year: number) {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31) - 1;
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(year, month, day));
}

function goodFriday(year: number) {
  const date = easterSunday(year);
  date.setUTCDate(date.getUTCDate() - 2);
  return date.toISOString().slice(0, 10);
}

function isUsMarketHoliday(dateText: string) {
  const year = Number(dateText.slice(0, 4));
  const holidays = new Set([
    observedFixedHoliday(year, 0, 1),
    nthWeekdayOfMonth(year, 0, 1, 3),
    nthWeekdayOfMonth(year, 1, 1, 3),
    goodFriday(year),
    lastWeekdayOfMonth(year, 4, 1),
    observedFixedHoliday(year, 5, 19),
    observedFixedHoliday(year, 6, 4),
    nthWeekdayOfMonth(year, 8, 1, 1),
    nthWeekdayOfMonth(year, 10, 4, 4),
    observedFixedHoliday(year, 11, 25),
  ]);
  return holidays.has(dateText);
}

function previousUsTradingDay(dateText: string) {
  let current = addDays(dateText, -1);
  while (isWeekend(current) || isUsMarketHoliday(current)) current = addDays(current, -1);
  return current;
}
function todayOrPreviousBusinessDay(dateText: string) {
  let current = dateText;
  while (isWeekend(current)) current = addDays(current, -1);
  return current;
}

function scheduleMinutes(market: MarketReportMarket) {
  const schedule = REPORT_SCHEDULE[market];
  return schedule.hour * 60 + schedule.minute;
}

function isReportGenerationTimeReached(market: MarketReportMarket, now = new Date()) {
  const parts = kstParts(now);
  return parts.hour * 60 + parts.minute >= scheduleMinutes(market);
}

function scheduledPendingMessage(market: MarketReportMarket) {
  return market === "us"
    ? "오늘 전일 미국 시황은 08:30에 자동 생성됩니다."
    : "오늘 국내 시황은 16:00에 자동 생성됩니다.";
}

export function getDefaultReportDate(market: MarketReportMarket, now = new Date()) {
  const parts = kstParts(now);
  return market === "us" ? previousUsTradingDay(parts.date) : todayOrPreviousBusinessDay(parts.date);
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

async function readExistingReport(market: MarketReportMarket, reportDate: string) {
  const supabase = getSupabaseAdmin();
  if (!supabase) return null;

  const { data } = await supabase
    .from(REPORT_TABLE)
    .select("market, report_date, generated_at, data_as_of, generation_status, generation_type, title, summary, sections, pb_comment, error_message")
    .eq("market", market)
    .eq("report_date", reportDate)
    .maybeSingle();

  return data ? rowToReport(data as MarketReportRow) : null;
}

async function readExistingPbComment(market: MarketReportMarket, reportDate: string) {
  const existing = await readExistingReport(market, reportDate);
  return existing?.pbComment || "";
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

export async function getMarketReportSnapshot(market: MarketReportMarket): Promise<{ report: MarketReport; error?: string }> {
  const reportDate = getDefaultReportDate(market);
  const existing = await readExistingReport(market, reportDate);
  if (!isReportGenerationTimeReached(market)) {
    const pending = emptyReport(market, reportDate, "pending", scheduledPendingMessage(market));
    pending.pbComment = existing?.pbComment || "";
    return { report: pending };
  }
  return { report: existing || emptyReport(market, reportDate, "pending", scheduledPendingMessage(market)) };
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
    if (!isReportGenerationTimeReached(market)) {
      const pending = emptyReport(market, reportDate, "pending", scheduledPendingMessage(market));
      pending.pbComment = found?.pb_comment || "";
      return pending;
    }
    return found ? rowToReport(found) : emptyReport(market, reportDate, "pending", scheduledPendingMessage(market));
  });

  return { reports };
}

async function buildReport(market: MarketReportMarket, generationType: MarketReportGenerationType): Promise<MarketReport> {
  const reportDate = getDefaultReportDate(market);
  const generatedAt = new Date().toISOString();
  const pbComment = await readExistingPbComment(market, reportDate);

  if (market === "us") {
    const brief = await fetchPreviousUsMarketBrief(reportDate);
    const indexAvailable = brief.indices.filter((item) => item.status === "available").length;
    const supportingAvailable = [...brief.sectors, ...brief.stocks, ...brief.news].filter((item) => item.status === "available").length;

    if (indexAvailable < 2 || supportingAvailable < 1) {
      console.warn("[market-report][kis-us] required data not ready", {
        reportDate,
        dataAsOf: brief.dataAsOf,
        indexAvailable,
        supportingAvailable,
        unavailable: brief.unavailable.slice(0, 12),
      });
      throw new Error(`미국 시황 필수 데이터가 부족합니다. indexAvailable=${indexAvailable}, supportingAvailable=${supportingAvailable}`);
    }

    return {
      market,
      reportDate,
      generatedAt,
      dataAsOf: brief.dataAsOf,
      generationStatus: "success",
      generationType,
      title: "전일 미국 시황",
      summary: brief.headline,
      sections: { bullets: brief.bullets, narrative: brief.narrative, sources: brief.sources, indices: brief.indices, sectors: brief.sectors, stocks: brief.stocks, news: brief.news, unavailable: brief.unavailable },
      pbComment,
      errorMessage: null,
    };
  }

  const brief = await fetchTodayKoreanMarketBrief(reportDate);
  const kospi = brief.indices.find((item) => item.label === "KOSPI");
  const kosdaq = brief.indices.find((item) => item.label === "KOSDAQ");
  const coreIndicesReady = kospi?.status === "available" && kosdaq?.status === "available";
  const dataAsOfDate = brief.dataAsOf?.slice(0, 10) || "";
  if (brief.reportDate !== reportDate || dataAsOfDate !== reportDate || !brief.dataAsOf || !brief.bullets.length || !coreIndicesReady) {
    console.warn("[market-report][kis] required data not ready", {
      reportDate,
      briefReportDate: brief.reportDate,
      dataAsOf: brief.dataAsOf,
      dataAsOfDate,
      kospiStatus: kospi?.status,
      kospiReason: kospi?.reason,
      kosdaqStatus: kosdaq?.status,
      kosdaqReason: kosdaq?.reason,
      unavailable: brief.unavailable.slice(0, 12),
    });
    throw new Error(`국내 시황 필수 데이터가 아직 준비되지 않았습니다. KOSPI=${kospi?.reason || kospi?.status || "missing"}, KOSDAQ=${kosdaq?.reason || kosdaq?.status || "missing"}, dataAsOf=${brief.dataAsOf || "missing"}`);
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
    sections: { bullets: brief.bullets, narrative: brief.narrative, sources: brief.sources, indices: brief.indices, exchangeRates: brief.exchangeRates, sectors: brief.sectors, stocks: brief.stocks, news: brief.news, unavailable: brief.unavailable },
    pbComment,
    errorMessage: null,
  };
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function generateMarketReport(market: MarketReportMarket, generationType: MarketReportGenerationType = "manual", options: { forceAttempt?: boolean } = {}) {
  const reportDate = getDefaultReportDate(market);
  if (!isReportGenerationTimeReached(market)) {
    return { report: emptyReport(market, reportDate, "pending", scheduledPendingMessage(market)) };
  }

  const existing = await readExistingReport(market, reportDate);
  if (existing?.generationStatus === "success" && !options.forceAttempt) return { report: existing };
  if (existing?.generationStatus === "failed" && !options.forceAttempt) return { report: existing, error: existing.errorMessage || undefined };

  try {
    const report = await buildReport(market, generationType);
    const saved = await upsertReport(report);
    if (!saved.ok) {
      return { report: { ...report, generationStatus: "failed" as const, errorMessage: saved.error }, error: saved.error || undefined };
    }
    return { report };
  } catch (error) {
    const message = error instanceof Error ? error.message : "시황 보고서 생성에 실패했습니다.";
    const failed = emptyReport(market, reportDate, "failed", message);
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
  const reportDate = getDefaultReportDate(market);
  if (!isReportGenerationTimeReached(market)) {
    return { report: emptyReport(market, reportDate, "pending", scheduledPendingMessage(market)) };
  }

  const existing = await readExistingReport(market, reportDate);
  if (existing?.generationStatus === "failed") return { report: existing };

  const maxAttempts = market === "kr" ? 4 : 1;
  const retryDelayMs = 15_000;
  let lastResult = await generateMarketReport(market, "scheduled", { forceAttempt: true });

  for (let attempt = 1; market === "kr" && attempt < maxAttempts && lastResult.report.generationStatus === "failed"; attempt += 1) {
    await wait(retryDelayMs);
    lastResult = await generateMarketReport(market, "scheduled", { forceAttempt: true });
  }

  return lastResult;
}

