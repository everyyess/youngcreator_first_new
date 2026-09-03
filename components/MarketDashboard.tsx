"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { FileText, Mail, RefreshCw } from "lucide-react";
import type { MarketIndexItem } from "@/lib/marketData";
import type { AppState, CustomerProfile } from "@/app/maintab/CustomerContext";
import { buildCustomerReportSections } from "@/services/customerService";

type LoadState<T> = {
  data: T;
  loading: boolean;
  error: string;
};

const emptyIndices: LoadState<MarketIndexItem[]> = { data: [], loading: true, error: "" };
const MARKET_INDEX_CACHE_KEY = "market-dashboard:indices:v2";
const MARKET_INDEX_CACHE_TTL_MS = 5 * 60 * 1000;

type MarketIndexCache = {
  data: MarketIndexItem[];
  refreshedAt: string;
  cachedAt: number;
};

function formatNumber(value: number | null, digits = 2) {
  if (value == null) return "-";
  return value.toLocaleString("ko-KR", { maximumFractionDigits: digits, minimumFractionDigits: digits });
}

function directionClass(value: number | null) {
  if (value == null) return "text-slate-400";
  if (value > 0) return "text-red-600";
  if (value < 0) return "text-blue-600";
  return "text-slate-500";
}

function sparklineBaseY(values: number[]): number {
  if (values.length < 2) return 15;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  return 24 - ((values[0] - min) / range) * 18;
}

function sparklinePoints(values: number[]) {
  if (values.length < 2) return "0,16 120,16";
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  return values.map((value, index) => {
    const x = (index / Math.max(values.length - 1, 1)) * 120;
    const y = 24 - ((value - min) / range) * 18;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
}

function formatRefreshTime(value: Date | null) {
  if (!value) return "--:--";
  return new Intl.DateTimeFormat("ko-KR", { hour: "2-digit", minute: "2-digit", hour12: false }).format(value);
}

function msUntilNextFiveMinuteBoundary(now = new Date()) {
  const intervalMs = 5 * 60 * 1000;
  const current = now.getTime();
  return Math.ceil(current / intervalMs) * intervalMs - current;
}

function readMarketIndexCache(): MarketIndexCache | null {
  try {
    const raw = window.localStorage.getItem(MARKET_INDEX_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<MarketIndexCache>;
    if (!Array.isArray(parsed.data) || !parsed.refreshedAt || typeof parsed.cachedAt !== "number") return null;
    if (Date.now() - parsed.cachedAt > MARKET_INDEX_CACHE_TTL_MS) return null;
    return { data: parsed.data, refreshedAt: parsed.refreshedAt, cachedAt: parsed.cachedAt };
  } catch {
    return null;
  }
}

function writeMarketIndexCache(data: MarketIndexItem[], refreshedAt: Date) {
  try {
    window.localStorage.setItem(MARKET_INDEX_CACHE_KEY, JSON.stringify({
      data,
      refreshedAt: refreshedAt.toISOString(),
      cachedAt: Date.now(),
    }));
  } catch {
    // localStorage may be unavailable in private browsing or quota-limited contexts.
  }
}

function IndexStrip({ state, refreshedAt }: { state: LoadState<MarketIndexItem[]>; refreshedAt: Date | null }) {
  const [startIndex, setStartIndex] = useState(0);
  const items = state.data.length
    ? state.data
    : Array.from({ length: 10 }, (_, i) => ({ symbol: `${i}`, name: "조회 중", value: null, change: null, changePercent: null, sparkline: [], basis: "조회 중", asOf: null }));
  const visibleCount = 7;
  const maxStartIndex = Math.max(0, items.length - visibleCount);
  const safeStartIndex = Math.min(startIndex, maxStartIndex);
  const visibleItems = items.slice(safeStartIndex, safeStartIndex + visibleCount);

  useEffect(() => {
    if (startIndex > maxStartIndex) setStartIndex(maxStartIndex);
  }, [maxStartIndex, startIndex]);

  return (
    <section className="w-full min-w-0 max-w-full overflow-hidden rounded-xl border border-blue-100 bg-white px-3 pt-3 pb-2.5 shadow-sm">
      <div className="mb-3 flex items-center justify-between gap-3">
        <p className="text-[15px] font-black uppercase tracking-normal text-blue-700">Market Index</p>
        <p className="text-[10px] font-black text-slate-400">최근 갱신: {formatRefreshTime(refreshedAt)}</p>
      </div>
      {state.error ? (
        <div className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-3 text-sm font-bold text-slate-500">주요 지표를 불러오지 못했습니다.</div>
      ) : (
        <div className="mb-3 flex w-full min-w-0 max-w-full items-stretch overflow-hidden rounded-lg border border-slate-100">
          <button
            type="button"
            onClick={() => setStartIndex((value) => Math.max(0, value - 1))}
            disabled={safeStartIndex <= 0}
            className="w-9 shrink-0 border-r border-slate-100 bg-white text-sm font-semibold text-blue-700 transition hover:bg-blue-50 disabled:cursor-not-allowed disabled:text-slate-300 disabled:hover:bg-white"
            aria-label="이전 지표 보기"
          >
            &lt;
          </button>
          <div className="flex min-w-0 flex-1 flex-nowrap">
            {visibleItems.map((item) => (
              <div key={item.symbol} className="box-border flex min-w-0 flex-1 flex-col overflow-hidden border-r border-slate-100 px-1.5 pt-2.5 pb-2.5 last:border-r-0">
                <div className="flex min-w-0 shrink-0 items-center justify-between gap-1.5">
                  <p className="min-w-0 overflow-hidden whitespace-nowrap text-[11px] font-black leading-tight text-slate-700">{item.name}</p>
                  <p className={`shrink-0 text-[11px] font-black ${directionClass(item.changePercent)}`}>
                    {item.changePercent != null && item.changePercent > 0 ? "+" : ""}{formatNumber(item.changePercent, 2)}%
                  </p>
                  {state.loading ? <RefreshCw size={15} className="shrink-0 animate-spin text-blue-500" /> : null}
                </div>
                <p className="mt-1.5 shrink-0 whitespace-nowrap text-sm font-black tracking-normal text-navy">{formatNumber(item.value, item.symbol === "^TNX" ? 3 : 2)}</p>
                <div className={`mt-2 min-h-[26px] flex-1 rounded-md ${item.changePercent == null ? "bg-slate-100" : item.changePercent >= 0 ? "bg-red-50" : "bg-blue-50"}`}>
                  <svg viewBox="0 0 120 28" className={`h-full w-full ${directionClass(item.changePercent)}`} preserveAspectRatio="none" aria-hidden="true">
                    <line x1="0" y1={sparklineBaseY(item.sparkline)} x2="120" y2={sparklineBaseY(item.sparkline)} stroke="#cbd5e1" strokeWidth="0.8" strokeDasharray="3,2" />
                    <polyline points={sparklinePoints(item.sparkline)} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </div>
              </div>
            ))}
          </div>
          <button
            type="button"
            onClick={() => setStartIndex((value) => Math.min(maxStartIndex, value + 1))}
            disabled={safeStartIndex >= maxStartIndex}
            className="w-9 shrink-0 bg-white text-sm font-semibold text-blue-700 transition hover:bg-blue-50 disabled:cursor-not-allowed disabled:text-slate-300 disabled:hover:bg-white"
            aria-label="다음 지표 보기"
          >
            &gt;
          </button>
        </div>
      )}
    </section>
  );
}

type ReportTone = "normal" | "positive" | "negative" | "keyword";
type ReportSpan = { text: string; tone?: ReportTone };
type ReportSource = { title: string; publisher: string; publishedAt: string; url: string; summary?: string };
type ReportNarrativePoint = { text: string; spans?: ReportSpan[]; sources?: ReportSource[] };
type MarketReportNarrative = {
  indexOverview?: ReportNarrativePoint;
  news?: { status?: "available" | "none" | "unavailable"; message?: string; items?: ReportSource[] };
  sectors?: { positive?: ReportNarrativePoint; negative?: ReportNarrativePoint; message?: string };
  stocks?: { positive?: ReportNarrativePoint; negative?: ReportNarrativePoint; message?: string };
  sources?: ReportSource[];
};
type AudienceTab = "managed" | "unmanaged";
type MailingItemId = "usMarket" | "krMarket" | "holdingIssues" | "portfolioPerformance";
type PdfLineSection = "pbComment" | MailingItemId;

type PdfSelectableLine = {
  id: string;
  section: PdfLineSection;
  group: string;
  label: string;
  text: string;
  meta?: string;
  url?: string;
  badge?: string;
};

type PdfSelectableSection = {
  id: PdfLineSection;
  title: string;
  lines: PdfSelectableLine[];
};

type HoldingIssueItem = {
  ticker: string;
  name: string;
  market: "kr" | "us";
  issueType: "price" | "disclosure" | "news";
  summary: string;
  url?: string;
  source?: string;
  publishedAt?: string;
  holders: {
    customerId: string;
    customerName: string;
    birthDate?: string;
  }[];
  changePercent?: number;
  previousClose?: number;
  latestClose?: number;
  previousDate?: string;
  latestDate?: string;
};

type HoldingIssuesResponse = {
  holdingCount: number;
  issueCount: number;
  thresholdPercent?: number;
  items: HoldingIssueItem[];
  error?: string;
};
type MarketReport = {
  market: "us" | "kr";
  reportDate: string;
  generatedAt: string | null;
  dataAsOf: string | null;
  generationStatus: "pending" | "success" | "failed";
  generationType: "scheduled" | "manual";
  title: string;
  summary: string;
  sections: { bullets?: string[]; narrative?: MarketReportNarrative; [key: string]: unknown };
  pbComment: string;
  errorMessage?: string | null;
};

type MarketDashboardProps = {
  selectedCustomer?: CustomerProfile | null;
  selectedState?: AppState;
  customers?: CustomerProfile[];
  customerData?: Record<string, AppState>;
  pbName?: string;
  pbId?: string;
  pbEmployeeId?: string;
};

const audienceTabs: { id: AudienceTab; label: string }[] = [
  { id: "managed", label: "관리 고객" },
  { id: "unmanaged", label: "미관리 고객" },
];

const mailingItems: Record<AudienceTab, { id: MailingItemId; label: string }[]> = {
  managed: [
    { id: "usMarket", label: "전일 미국 시황" },
    { id: "krMarket", label: "당일 국내 시황" },
    { id: "holdingIssues", label: "보유 종목 주요 이슈" },
    { id: "portfolioPerformance", label: "고객별 포트폴리오 성과" },
  ],
  unmanaged: [
    { id: "usMarket", label: "전일 미국 시황" },
    { id: "krMarket", label: "당일 국내 시황" },
  ],
};

const initialIncluded: Record<AudienceTab, Record<MailingItemId, boolean>> = {
  managed: { usMarket: true, krMarket: true, holdingIssues: true, portfolioPerformance: true },
  unmanaged: { usMarket: true, krMarket: true, holdingIssues: false, portfolioPerformance: false },
};

function reportScheduleLabel(market: "us" | "kr") {
  return market === "us" ? "08:30" : "16:00";
}

function formatKoreanDateTime(value: string | null) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("ko-KR", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

function reportBullets(report?: MarketReport) {
  return Array.isArray(report?.sections?.bullets) ? report.sections.bullets : [];
}

function reportNarrative(report?: MarketReport) {
  return report?.sections?.narrative;
}

function marketCardSummary(report: MarketReport | undefined, market: "us" | "kr") {
  if (!report || report.generationStatus === "pending") {
    return market === "us" ? "오늘 전일 미국 시황은 08:30에 자동 생성됩니다." : "오늘 국내 시황은 16:00에 자동 생성됩니다.";
  }
  if (report.generationStatus === "failed") return report.errorMessage || "자동 생성에 실패했습니다.";
  return report.summary || "자동 생성된 보고서 본문이 이 영역에 표시됩니다.";
}

function marketCardMeta(report: MarketReport | undefined, market: "us" | "kr") {
  const scheduled = market === "us" ? "08:30 자동 생성 예정" : "16:00 자동 생성 예정";
  if (!report || report.generationStatus === "pending") return scheduled;
  if (report.generationStatus === "failed") return "자동 생성 실패";

  const formatDateOnly = (value: string) => {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    return new Intl.DateTimeFormat("ko-KR", {
      timeZone: "Asia/Seoul",
      month: "2-digit",
      day: "2-digit",
    }).format(date);
  };

  const basisDate = report.dataAsOf
    ? formatDateOnly(report.dataAsOf)
    : report.reportDate;

  const generatedDate = report.generatedAt
    ? formatDateOnly(report.generatedAt)
    : report.reportDate;

  const basis = `기준 ${basisDate} ${market === "us" ? "미국장 마감" : "국내장 마감"}`;
  const generated = `생성 ${generatedDate} ${market === "us" ? "08:30" : "16:00"}`;

  return `${basis} · ${generated}`;
}
function marketReportTitle(id: "usMarket" | "krMarket") {
  return id === "usMarket" ? "전일 미국 시황" : "당일 국내 시황";
}

function formatPdfMonthDay(value?: string | null) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    const match = value.match(/(\d{4})-(\d{2})-(\d{2})/);
    return match ? `${match[2]}.${match[3]}` : "";
  }

  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    month: "2-digit",
    day: "2-digit",
  })
    .format(date)
    .replace(/\.\s?/g, ".")
    .replace(/\.$/, "");
}

function formatPdfGeneratedAt(value?: string | null) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";

  const parts = new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);

  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";

  return `${get("month")}.${get("day")} ${get("hour")}:${get("minute")}`;
}

function getPdfMarketMeta(report?: MarketReport) {
  if (!report) return "";

  const basis = formatPdfMonthDay(report.reportDate);
  const generated = formatPdfGeneratedAt(report.generatedAt);

  if (report.market === "us") {
    return `기준 ${basis} 미국장 마감${generated ? ` · 생성 ${generated}` : ""}`;
  }

  return `기준 ${basis} 국내장 마감${generated ? ` · 생성 ${generated}` : ""}`;
}

function getPdfTodayTitle() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());

  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";

  return `${get("year")}-${get("month")}-${get("day")} 오늘의 시황 보고서`;
}

function getPortfolioAvailabilityText() {
  const now = new Date();

  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);

  const get = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value ?? "0");

  const year = get("year");
  const month = get("month");
  const day = get("day");
  const lastDay = new Date(year, month, 0).getDate();
  const dDay = lastDay - day;

  if (dDay <= 0) {
    return `포트폴리오 성과는 매월 마지막 날에 제공됩니다. (${month}/${lastDay} 오늘 제공)`;
  }

  return `포트폴리오 성과는 매월 마지막 날에 제공됩니다. (${month}/${lastDay} D-${dDay})`;
}

function PdfRichText({ text }: { text: string }) {
  const parts = text.split(/([+-]\d+(?:\.\d+)?%|\d+(?:\.\d+)?%|S&P500|Nasdaq|Dow|KOSPI|KOSDAQ|NVIDIA|Microsoft)/g);

  return (
    <>
      {parts.map((part, index) => {
        if (/^\+\d+(?:\.\d+)?%$/.test(part)) {
          return <strong key={index} className="font-black text-red-600">{part}</strong>;
        }

        if (/^-\d+(?:\.\d+)?%$/.test(part)) {
          return <strong key={index} className="font-black text-blue-600">{part}</strong>;
        }

        if (/^(\d+(?:\.\d+)?%|S&P500|Nasdaq|Dow|KOSPI|KOSDAQ|NVIDIA|Microsoft)$/.test(part)) {
          return <strong key={index} className="font-black text-slate-900">{part}</strong>;
        }

        return <span key={index}>{part}</span>;
      })}
    </>
  );
}
function buildMarketPdfLines(
  section: "usMarket" | "krMarket",
  report?: MarketReport,
): PdfSelectableLine[] {
  const narrative = reportNarrative(report);
  const lines: PdfSelectableLine[] = [];

  if (!narrative) {
    for (const [index, bullet] of reportBullets(report).entries()) {
      if (!bullet?.trim()) continue;
      lines.push({
        id: `${section}:bullet:${index}`,
        section,
        group: "본문",
        label: bullet,
        text: bullet,
      });
    }
    return lines;
  }

  if (narrative.indexOverview?.text?.trim()) {
    lines.push({
      id: `${section}:index`,
      section,
      group: "주요 지수 등락",
      label: narrative.indexOverview.text,
      text: narrative.indexOverview.text,
    });
  }

  const newsItems = narrative.news?.items?.filter((item) => item.summary?.trim()) ?? [];
  newsItems.slice(0, 5).forEach((item, index) => {
    const text = item.summary?.trim();
    if (!text) return;
    lines.push({
      id: `${section}:news:${index}`,
      section,
      group: "주요 시장 뉴스",
      label: text,
      text,
      url: item.url,
      meta: [item.publisher, formatPdfMonthDay(item.publishedAt)].filter(Boolean).join(" · "),
    });
  });

  const sectorPoints = [
    ["positive", narrative.sectors?.positive?.text],
    ["negative", narrative.sectors?.negative?.text],
  ] as const;

  sectorPoints.forEach(([kind, text]) => {
    if (!text?.trim()) return;
    lines.push({
      id: `${section}:sector:${kind}`,
      section,
      group: "강세/약세 업종",
      label: text,
      text,
    });
  });

  if (narrative.sectors?.message?.trim()) {
    lines.push({
      id: `${section}:sector:message`,
      section,
      group: "강세/약세 업종",
      label: narrative.sectors.message,
      text: narrative.sectors.message,
    });
  }

  const stockPoints = [
    ["positive", narrative.stocks?.positive?.text],
    ["negative", narrative.stocks?.negative?.text],
  ] as const;

  stockPoints.forEach(([kind, text]) => {
    if (!text?.trim()) return;
    lines.push({
      id: `${section}:stock:${kind}`,
      section,
      group: "주요 강세/약세 종목",
      label: text,
      text,
    });
  });

  if (narrative.stocks?.message?.trim()) {
    lines.push({
      id: `${section}:stock:message`,
      section,
      group: "주요 강세/약세 종목",
      label: narrative.stocks.message,
      text: narrative.stocks.message,
    });
  }

  return lines;
}

function buildPdfSelectableSections({
  pbComment,
  usReport,
  krReport,
  holdingIssues,
  selectedCustomer,
  portfolioTitle,
  portfolioSummary,
  portfolioBullets,
}: {
  pbComment: string;
  usReport?: MarketReport;
  krReport?: MarketReport;
  holdingIssues: HoldingIssueItem[];
  selectedCustomer: CustomerProfile;
  portfolioTitle: string;
  portfolioSummary: string;
  portfolioBullets: string[];
}): PdfSelectableSection[] {
  const customerHoldingIssues = holdingIssues.filter((issue) =>
    issue.holders.some((holder) => holder.customerId === selectedCustomer.id),
  );

  const holdingLines: PdfSelectableLine[] = customerHoldingIssues.length
    ? customerHoldingIssues.map((issue, index): PdfSelectableLine => ({
        id: `holdingIssues:${issue.market}:${issue.ticker}:${issue.issueType}:${index}`,
        section: "holdingIssues",
        group: issue.name,
        label: issue.summary,
        text: issue.summary,
        badge: issue.name,
        url: issue.url,
        meta: [issue.source, formatPdfMonthDay(issue.publishedAt)].filter(Boolean).join(" · "),
      }))
    : [
        {
          id: "holdingIssues:none",
          section: "holdingIssues",
          group: "보유종목 주요 이슈",
          label: "고객님의 보유종목과 관련한 이슈가 발생하지 않았습니다.",
          text: "고객님의 보유종목과 관련한 이슈가 발생하지 않았습니다.",
        },
      ];

  const portfolioLines: PdfSelectableLine[] = [
    {
      id: "portfolioPerformance:availability",
      section: "portfolioPerformance",
      group: "안내",
      label: getPortfolioAvailabilityText(),
      text: getPortfolioAvailabilityText(),
    },
  ];

  return [
    {
      id: "pbComment",
      title: "PB의 한 줄 코멘트",
      lines: pbComment.trim()
        ? [{
            id: "pbComment:main",
            section: "pbComment",
            group: "코멘트",
            label: pbComment.trim(),
            text: pbComment.trim(),
          }]
        : [],
    },
    {
      id: "usMarket",
      title: marketReportTitle("usMarket"),
      lines: buildMarketPdfLines("usMarket", usReport),
    },
    {
      id: "krMarket",
      title: marketReportTitle("krMarket"),
      lines: buildMarketPdfLines("krMarket", krReport),
    },
    {
      id: "holdingIssues",
      title: `보유 종목 주요 이슈 (${selectedCustomer?.name || selectedCustomer?.fallbackName || "고객"} 고객님)`,
      lines: holdingLines,
    },
    {
      id: "portfolioPerformance",
      title: portfolioTitle,
      lines: portfolioLines,
    },
  ];
}

function statusText(report: MarketReport | undefined, market: "us" | "kr") {
  const time = reportScheduleLabel(market);
  if (!report) return time + " 자동 생성 예정";
  if (report.generationStatus === "success") return "✓ " + time + " 자동 생성 완료";
  if (report.generationStatus === "failed") return "⚠ 자동 생성 실패";
  return time + " 자동 생성 예정";
}

function statusClass(report: MarketReport | undefined) {
  if (report?.generationStatus === "success") return "text-emerald-600";
  if (report?.generationStatus === "failed") return "text-amber-600";
  return "text-slate-400";
}

function spanClass(tone?: ReportTone) {
  if (tone === "positive") return "font-black text-red-600";
  if (tone === "negative") return "font-black text-blue-600";
  if (tone === "keyword") return "font-black text-slate-950";
  return "text-slate-900";
}

function RichLine({ point }: { point?: ReportNarrativePoint }) {
  if (!point) return null;
  const spans = point.spans?.length ? point.spans : [{ text: point.text }];
  return (
    <p className="text-xs font-semibold leading-5 text-slate-900">
      {spans.map((span, index) => <span key={index} className={spanClass(span.tone)}>{span.text}</span>)}
    </p>
  );
}

function formatSourceDate(value: string) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("ko-KR", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(date);
}

function NarrativePreview({ narrative, fallbackBullets }: { narrative?: MarketReportNarrative; fallbackBullets: string[] }) {
  if (!narrative) {
    return fallbackBullets.length ? (
      <ul className="mt-2 grid gap-1.5 text-xs font-semibold leading-5 text-slate-500">
        {fallbackBullets.map((bullet, index) => <li key={index}>- {bullet}</li>)}
      </ul>
    ) : null;
  }

  return (
    <div className="mt-3 grid gap-3">
      <div className="grid gap-1.5 border-t border-slate-200 pt-3">
        <p className="text-[11px] font-black text-slate-500">주요 지수 등락</p>
        <RichLine point={narrative.indexOverview} />
      </div>

      <div className="grid gap-1.5 border-t border-slate-200 pt-3">
        <p className="text-[11px] font-black text-slate-500">주요 시장 뉴스</p>
        {narrative.news?.status === "available" && narrative.news.items?.filter((item) => item.summary?.trim()).length ? (
          <ul className="grid gap-1.5 text-xs font-semibold leading-5 text-slate-800">
            {narrative.news.items.filter((item) => item.summary?.trim()).slice(0, 5).map((item, index) => (
              <li key={`${item.title}-${index}`}>
                <a href={item.url} target="_blank" rel="noreferrer" className="font-bold text-slate-900 underline decoration-slate-300 underline-offset-2 hover:text-blue-700">{item.summary}</a>
                <span className="ml-1 text-[10px] font-bold text-slate-400">{item.publisher}{formatSourceDate(item.publishedAt) ? " · " + formatSourceDate(item.publishedAt) : ""}</span>
              </li>
            ))}
          </ul>
        ) : <p className="text-xs font-semibold leading-5 text-slate-600">{narrative.news?.message || "오늘은 시장 방향성에 영향을 줄 만한 주요 이벤트가 없었어요."}</p>}
      </div>

      <div className="grid gap-1.5 border-t border-slate-200 pt-3">
        <p className="text-[11px] font-black text-slate-500">강세/약세 업종</p>
        <RichLine point={narrative.sectors?.positive} />
        <RichLine point={narrative.sectors?.negative} />
        {narrative.sectors?.message ? <p className="text-xs font-semibold leading-5 text-slate-600">{narrative.sectors.message}</p> : null}
      </div>

      <div className="grid gap-1.5 border-t border-slate-200 pt-3">
        <p className="text-[11px] font-black text-slate-500">주요 강세/약세 종목</p>
        <RichLine point={narrative.stocks?.positive} />
        <RichLine point={narrative.stocks?.negative} />
        {narrative.stocks?.message ? <p className="text-xs font-semibold leading-5 text-slate-600">{narrative.stocks.message}</p> : null}
      </div>
    </div>
  );
}

function ReportPreviewCard({ title, summary, bullets, meta, narrative }: { title: string; summary: string; bullets: string[]; meta?: string; narrative?: MarketReportNarrative }) {
  return (
    <article className="min-h-[150px] rounded-lg border border-slate-100 bg-slate-50 p-3">
      <div className="mb-2 flex items-start justify-between gap-2">
        <p className="text-sm font-black text-navy">{title}</p>
        {meta ? <span className="shrink-0 rounded-full bg-white px-2 py-1 text-[10px] font-black text-slate-400">{meta}</span> : null}
      </div>
      {!narrative ? <p className="text-xs font-bold leading-5 text-slate-600">{summary || "자동 생성된 보고서 본문이 이 영역에 표시됩니다."}</p> : null}
      <NarrativePreview narrative={narrative} fallbackBullets={bullets} />
    </article>
  );
}

function MarketStatusRow({ label, market, report, refreshing, onRefresh }: { label: string; market: "us" | "kr"; report?: MarketReport; refreshing: boolean; onRefresh: (market: "us" | "kr") => void }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-100 bg-white px-3 py-2">
      <div className="min-w-0">
        <p className="text-xs font-black text-slate-700">{label}</p>
        <p className={'mt-0.5 text-[11px] font-black ' + statusClass(report)}>{statusText(report, market)}</p>
        {report?.generationStatus === "success" && report.generatedAt ? <p className="mt-0.5 text-[10px] font-bold text-slate-400">생성: {formatKoreanDateTime(report.generatedAt)}</p> : null}
        {report?.generationStatus === "failed" && report.errorMessage ? <p className="mt-0.5 text-[10px] font-bold text-amber-600">{report.errorMessage}</p> : null}
      </div>
      <button
        type="button"
        onClick={() => onRefresh(market)}
        disabled={refreshing}
        className="inline-flex h-8 shrink-0 items-center gap-1 rounded-lg border border-blue-100 bg-blue-50 px-2 text-[11px] font-semibold text-blue-700 transition hover:bg-blue-100 disabled:cursor-wait disabled:opacity-60"
      >
        <RefreshCw size={13} className={refreshing ? "animate-spin" : ""} /> 새로고침
      </button>
    </div>
  );
}

function MarketReportMailingPanel({ selectedCustomer, selectedState, customers = [], customerData = {}, pbName, pbId, pbEmployeeId }: MarketDashboardProps) {
  const [audience, setAudience] = useState<AudienceTab>("managed");
  const [included, setIncluded] = useState(initialIncluded);
  const [reports, setReports] = useState<Record<"us" | "kr", MarketReport | undefined>>({ us: undefined, kr: undefined });
  const [loadingReports, setLoadingReports] = useState(true);
  const [reportsError, setReportsError] = useState("");
  const [refreshingMarket, setRefreshingMarket] = useState<"us" | "kr" | null>(null);
  const [actionMessage, setActionMessage] = useState("");
  const [pdfPreviewOpen, setPdfPreviewOpen] = useState(false);
  const [sendingCustomerMail, setSendingCustomerMail] = useState(false);
  const [pdfCustomerId, setPdfCustomerId] = useState<string>("");
  const [pdfLineIncluded, setPdfLineIncluded] = useState<Record<string, boolean>>({});
  const [pdfLineEdits, setPdfLineEdits] = useState<Record<string, string>>({});
  const [editingPdfLineId, setEditingPdfLineId] = useState<string | null>(null);
  const [pdfSelectionInitialized, setPdfSelectionInitialized] = useState(false);
  const [pbComment, setPbComment] = useState("");
  const [commentTouched, setCommentTouched] = useState(false);
  const [savingComment, setSavingComment] = useState(false);
  const [holdingIssues, setHoldingIssues] = useState<HoldingIssueItem[]>([]);
  const [openHoldingTicker, setOpenHoldingTicker] = useState<string | null>(null);
  const [loadingHoldingIssues, setLoadingHoldingIssues] = useState(false);
  const [holdingIssuesError, setHoldingIssuesError] = useState("");
  const customerSections = buildCustomerReportSections(selectedCustomer, selectedState);
  const pdfCustomer =
    customers.find((customer) => customer.id === pdfCustomerId) ??
    selectedCustomer ??
    null;

  const pdfCustomerState = pdfCustomer
    ? customerData[pdfCustomer.id] ??
      (pdfCustomer.id === selectedCustomer?.id ? selectedState : undefined)
    : undefined;

  const pdfCustomerSections = buildCustomerReportSections(
    pdfCustomer,
    pdfCustomerState,
  );

  const pdfCustomerBirthDate = pdfCustomer
    ? (pdfCustomer.birth_year ?? pdfCustomer.birthYear ?? "")
        .replace(/\D/g, "")
        .slice(-6)
    : "";
  const pdfCustomerIndex = pdfCustomer
    ? customers.findIndex((customer) => customer.id === pdfCustomer.id)
    : -1;

  function movePdfCustomer(offset: number) {
    if (!customers.length) return;

    const currentIndex = pdfCustomerIndex >= 0 ? pdfCustomerIndex : 0;
    const nextIndex =
      (currentIndex + offset + customers.length) % customers.length;

    setPdfCustomerId(customers[nextIndex].id);
  }
  const displayPbName = pbName?.trim() || "담당";

  useEffect(() => {
    let cancelled = false;
    async function loadReports() {
      setLoadingReports(true);
      try {
        const response = await fetch("/api/market-reports");
        const body = await response.json();
        if (cancelled) return;
        const nextReports: Record<"us" | "kr", MarketReport | undefined> = { us: undefined, kr: undefined };
        if (Array.isArray(body.reports)) {
          for (const report of body.reports as MarketReport[]) nextReports[report.market] = report;
        }
        setReports(nextReports);
        setPbComment(nextReports.us?.pbComment || nextReports.kr?.pbComment || "");
        setReportsError(body.error || "");
      } catch {
        if (!cancelled) setReportsError("시황 보고서 상태를 불러오지 못했습니다.");
      } finally {
        if (!cancelled) setLoadingReports(false);
      }
    }
    void loadReports();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;

    console.log("[holding-issues-ui] pbId:", pbId, "pbEmployeeId:", pbEmployeeId);

    async function loadHoldingIssues() {
      if (!pbId && !pbEmployeeId) {
        setHoldingIssues([]);
        setHoldingIssuesError("");
        return;
      }

      setLoadingHoldingIssues(true);
      setHoldingIssuesError("");

      try {
        const params = new URLSearchParams();

        if (pbId) params.set("pbId", pbId);
        if (pbEmployeeId) params.set("pbEmployeeId", pbEmployeeId);

        const response = await fetch(`/api/holding-issues?${params.toString()}`);
        const body = (await response.json()) as HoldingIssuesResponse;

        if (cancelled) return;

        if (!response.ok) {
          throw new Error(body.error || "보유 종목 이슈를 불러오지 못했습니다.");
        }

        setHoldingIssues(Array.isArray(body.items) ? body.items : []);
      } catch (error) {
        if (cancelled) return;

        setHoldingIssues([]);
        setHoldingIssuesError(
          error instanceof Error
            ? error.message
            : "보유 종목 이슈를 불러오지 못했습니다.",
        );
      } finally {
        if (!cancelled) {
          setLoadingHoldingIssues(false);
        }
      }
    }

    void loadHoldingIssues();

    return () => {
      cancelled = true;
    };
  }, [pbId, pbEmployeeId]);

  async function refreshReports() {
    setRefreshingMarket("us");
    try {
      const response = await fetch("/api/market-reports");
      const body = await response.json();
      const nextReports: Record<"us" | "kr", MarketReport | undefined> = { us: undefined, kr: undefined };
      if (Array.isArray(body.reports)) {
        for (const report of body.reports as MarketReport[]) nextReports[report.market] = report;
      }
      setReports(nextReports);
      setReportsError(response.ok ? body.error || "" : body.error || "시황 보고서 상태를 다시 불러오지 못했습니다.");
    } catch {
      setReportsError("시황 보고서 상태를 다시 불러오지 못했습니다.");
    } finally {
      setRefreshingMarket(null);
    }
  }

  function toggleItem(id: MailingItemId) {
    setIncluded((prev) => ({ ...prev, [audience]: { ...prev[audience], [id]: !prev[audience][id] } }));
  }

  async function savePbComment(nextComment: string) {
    setSavingComment(true);
    try {
      const response = await fetch("/api/market-reports", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pbComment: nextComment }),
      });
      const body = await response.json();
      setReportsError(response.ok ? "" : body.error || "PB 코멘트 저장에 실패했습니다.");
    } catch {
      setReportsError("PB 코멘트 저장 요청에 실패했습니다.");
    } finally {
      setSavingComment(false);
    }
  }

  function handlePdfPreview() {
    const initialSelection = Object.fromEntries(
      visiblePdfSections.flatMap((section) =>
        section.lines.map((line) => [line.id, true]),
      ),
    );

    setPdfLineIncluded(initialSelection);
    setPdfSelectionInitialized(true);
    setPdfCustomerId(selectedCustomer?.id ?? customers[0]?.id ?? "");
    setPdfPreviewOpen(true);
  }

  function handleSendMail() {
    setActionMessage("메일 전송은 다음 단계에서 연결됩니다.");
  }
  async function handleSendPdfToCustomer() {
    if (!pdfCustomer?.id) {
      setActionMessage("전송할 고객을 찾을 수 없습니다.");
      return;
    }

    const element = document.getElementById("market-report-pdf");

    if (!element) {
      setActionMessage("PDF 미리보기 영역을 찾을 수 없습니다.");
      return;
    }

    try {
      setSendingCustomerMail(true);
      setActionMessage("PDF 생성 중...");

      await document.fonts.ready;

      const customerName =
        pdfCustomer.name || pdfCustomer.fallbackName || "고객";

      const fileName = `${customerName}_시황보고서.pdf`;

      // 현재 PDF 미리보기 DOM을 그대로 복제
      const clonedElement = element.cloneNode(true) as HTMLElement;

      // textarea 등 편집 상태가 있으면 현재 값을 실제 HTML에 반영
      const originalTextareas =
        element.querySelectorAll<HTMLTextAreaElement>("textarea");

      const clonedTextareas =
        clonedElement.querySelectorAll<HTMLTextAreaElement>("textarea");

      originalTextareas.forEach((textarea, index) => {
        const clonedTextarea = clonedTextareas[index];

        if (!clonedTextarea) return;

        const replacement = document.createElement("div");
        replacement.textContent = textarea.value;
        replacement.className = textarea.className;
        replacement.setAttribute(
          "style",
          textarea.getAttribute("style") ?? "",
        );

        clonedTextarea.replaceWith(replacement);
      });

      // 현재 페이지에 적용된 스타일시트 수집
      const styles = Array.from(document.styleSheets)
        .map((sheet) => {
          try {
            return Array.from(sheet.cssRules)
              .map((rule) => rule.cssText)
              .join("\n");
          } catch {
            return "";
          }
        })
        .filter(Boolean)
        .join("\n");

      const response = await fetch("/api/send-report-email", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          customerId: pdfCustomer.id,
          subject: `${customerName} 고객님 오늘의 시황 보고서`,
          fileName,
          html: clonedElement.outerHTML,
          styles,
        }),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(
          typeof result?.error === "string"
            ? result.error
            : "메일 전송에 실패했습니다.",
        );
      }

      setActionMessage(
        `${customerName} 고객님께 시황 보고서를 전송했습니다.`,
      );
    } catch (error) {
      setActionMessage(
        error instanceof Error
          ? error.message
          : "PDF 생성 또는 메일 전송 중 오류가 발생했습니다.",
      );
    } finally {
      setSendingCustomerMail(false);
    }
  }
  const activeIncluded = included[audience];
  const usReport = reports.us;
  const krReport = reports.kr;

  const pdfSections = pdfCustomer
    ? buildPdfSelectableSections({
        pbComment,
        usReport,
        krReport,
        holdingIssues,
        selectedCustomer: pdfCustomer,
        portfolioTitle: pdfCustomerSections.portfolioPerformance.title,
        portfolioSummary: pdfCustomerSections.portfolioPerformance.summary,
        portfolioBullets: pdfCustomerSections.portfolioPerformance.bullets,
      })
    : [];

  const visiblePdfSections = pdfSections.filter((section) => {
    if (section.id === "pbComment") return section.lines.length > 0;
    return activeIncluded[section.id];
  });
  return (
    <section className="flex w-full min-w-0 max-w-full flex-col overflow-hidden rounded-xl border border-blue-100 bg-white p-3 shadow-sm">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-black text-navy">시황 보고서 메일링</p>
        <button type="button" onClick={refreshReports} disabled={loadingReports || Boolean(refreshingMarket)} className="inline-flex h-8 items-center gap-1 rounded-lg border border-blue-100 bg-blue-50 px-2 text-[11px] font-semibold text-blue-700 transition hover:bg-blue-100 disabled:cursor-wait disabled:opacity-60"><RefreshCw size={12} className={loadingReports || refreshingMarket ? "animate-spin" : ""} /> 새로고침</button>
      </div>

      <div className="mb-3 grid grid-cols-2 gap-1 rounded-lg border border-slate-200 bg-slate-50 p-1">
        {audienceTabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setAudience(tab.id)}
            className={(audience === tab.id ? "bg-blue-600 text-white shadow-sm" : "bg-white text-slate-600 hover:bg-blue-50") + " h-9 rounded-md text-xs font-black transition"}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="grid gap-3 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <div className="grid gap-3">
          <div className={(audience === "managed" ? "grid gap-2 rounded-lg border border-slate-100 bg-slate-50 p-3 sm:grid-cols-2 xl:grid-cols-4" : "grid gap-2 rounded-lg border border-slate-100 bg-slate-50 p-3 sm:grid-cols-2")}>
            {mailingItems[audience].map((item) => (
              <label key={item.id} className="flex min-h-10 items-center gap-2 rounded-lg bg-white px-3 py-2 text-xs font-black text-slate-700">
                <input type="checkbox" checked={activeIncluded[item.id]} onChange={() => toggleItem(item.id)} className="h-4 w-4 rounded border-slate-300 accent-blue-600" />
                {item.label}
              </label>
            ))}
          </div>

          <label className="grid gap-1.5 rounded-lg border border-slate-100 bg-white px-3 py-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-black text-slate-700">{displayPbName} PB의 한 줄 코멘트</span>
              <span className="text-[10px] font-bold text-slate-400">{pbComment.length}/100{savingComment ? " 저장 중" : ""}</span>
            </div>
            <input
              type="text"
              value={pbComment}
              maxLength={100}
              onChange={(event) => {
                setPbComment(event.target.value.slice(0, 100));
                setCommentTouched(true);
              }}
              placeholder="고객에게 전달하고 싶은 한 줄 코멘트를 입력하세요."
              className="h-9 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 text-xs font-bold text-slate-700 outline-none transition placeholder:text-slate-400 focus:border-blue-200 focus:bg-white focus:ring-2 focus:ring-blue-100"
            />
          </label>


          {reportsError ? <p className="rounded-lg border border-amber-100 bg-amber-50 px-3 py-2 text-[11px] font-bold text-amber-700">{reportsError}</p> : null}
          {actionMessage ? <p className="rounded-lg border border-blue-100 bg-blue-50 px-3 py-2 text-[11px] font-bold text-blue-700">{actionMessage}</p> : null}
        </div>

        <div className="grid gap-3 lg:grid-cols-2">
          <div className="grid content-start gap-3">
            {activeIncluded.usMarket ? <ReportPreviewCard title={marketReportTitle("usMarket")} summary={marketCardSummary(usReport, "us")} bullets={reportBullets(usReport)} narrative={reportNarrative(usReport)} meta={marketCardMeta(usReport, "us")} /> : null}
            {activeIncluded.krMarket ? <ReportPreviewCard title={marketReportTitle("krMarket")} summary={marketCardSummary(krReport, "kr")} bullets={reportBullets(krReport)} narrative={reportNarrative(krReport)} meta={marketCardMeta(krReport, "kr")} /> : null}
          </div>
          <div className="grid content-start gap-3">
            {audience === "managed" && activeIncluded.holdingIssues ? (() => {
  const groupedIssues = Array.from(
    holdingIssues.reduce((map, issue) => {
      const key = `${issue.market}:${issue.ticker}`;
      const existing = map.get(key);

      if (existing) {
        existing.issues.push(issue);

        for (const holder of issue.holders) {
          if (
            !existing.holders.some(
              (existingHolder) =>
                existingHolder.customerId === holder.customerId,
            )
          ) {
            existing.holders.push(holder);
          }
        }
      } else {
        map.set(key, {
          ticker: issue.ticker,
          name: issue.name,
          market: issue.market,
          holders: [...issue.holders],
          issues: [issue],
        });
      }

      return map;
    }, new Map<string, {
      ticker: string;
      name: string;
      market: "kr" | "us";
      holders: HoldingIssueItem["holders"];
      issues: HoldingIssueItem[];
    }>())
    .values(),
  );

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="mb-3">
        <h3 className="text-sm font-black text-slate-900">
          보유 종목 주요 이슈
        </h3>

        <p className="mt-1 text-xs font-bold text-slate-500">
          {loadingHoldingIssues
            ? "보유 종목 주요 이슈를 확인하고 있습니다."
            : holdingIssuesError
              ? holdingIssuesError
              : groupedIssues.length > 0
                ? `${groupedIssues.length}개 보유 종목에서 주요 이슈가 감지되었습니다.`
                : "현재 주요 이슈가 감지된 보유 종목이 없습니다."}
        </p>

        {!loadingHoldingIssues &&
          !holdingIssuesError &&
          groupedIssues.length > 0 ? (
            <p className="mt-1 text-[10px] font-medium text-slate-400">
              ※종목명에 마우스를 올리면 해당 종목 보유고객을 확인할 수 있습니다.
            </p>
          ) : null}
      </div>

      {!loadingHoldingIssues &&
        !holdingIssuesError &&
        groupedIssues.length > 0 ? (
          <div className="grid gap-2">
            {groupedIssues.map((group) => {
              const groupKey = `${group.market}:${group.ticker}`;
              const isOpen = openHoldingTicker === groupKey;

              const uniqueIssues = group.issues.filter(
                (issue, index, issues) =>
                  Boolean(issue.summary) &&
                  issues.findIndex(
                    (candidate) => candidate.summary === issue.summary,
                  ) === index,
              );

              return (
                <div
                  key={groupKey}
                  className="flex items-start gap-3 border-b border-slate-100 py-2 last:border-b-0"
                >
                  <div className="relative shrink-0">
                    <button
                      type="button"
                      onMouseEnter={() => {
                        setOpenHoldingTicker(groupKey);

                        window.setTimeout(() => {
                          setOpenHoldingTicker((current) =>
                            current === groupKey ? null : current,
                          );
                        }, 3000);
                      }}
                      className="rounded-md border border-blue-400 bg-blue-100 px-2.5 py-1 text-xs font-black text-black transition hover:bg-blue-200"
                    >
                      {group.name}
                    </button>

                    {isOpen ? (
                      <div className="absolute left-0 top-full z-30 mt-2 min-w-44 rounded-lg border border-slate-200 bg-white p-3 shadow-lg">
                        <p className="mb-2 whitespace-nowrap text-[11px] font-black text-slate-500">
                          보유 고객
                        </p>

                        <div className="grid gap-1.5">
                          {group.holders.map((holder) => {
                            const birthDate = (holder.birthDate ?? "")
                              .replace(/\D/g, "")
                              .slice(-6);

                            return (
                              <p
                                key={holder.customerId}
                                className="whitespace-nowrap text-xs font-bold text-slate-800"
                              >
                                {holder.customerName}
                                {birthDate ? ` (${birthDate})` : ""}
                              </p>
                            );
                          })}
                        </div>
                      </div>
                    ) : null}
                  </div>

                  <div className="min-w-0 flex-1 pt-1">
                    {uniqueIssues.map((issue) =>
                      issue.url ? (
                        <div
                          key={`${issue.issueType}:${issue.url}:${issue.summary}`}
                          className="mb-2 last:mb-0"
                        >
                          <p className="text-xs font-semibold leading-5 text-slate-700">
                            <a
                              href={issue.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="underline decoration-slate-300 underline-offset-2 transition hover:text-blue-600 hover:decoration-blue-400"
                            >
                              {issue.summary}
                            </a>
                            {(issue.source || issue.publishedAt) ? (
                              <span className="ml-1.5 whitespace-nowrap text-[10px] font-semibold text-slate-400 no-underline">
                                {issue.source || "출처 미상"}
                                {issue.publishedAt
                                  ? issue.issueType === "disclosure"
                                    ? ` · ${issue.publishedAt
                                        .replace(/\./g, "-")
                                        .split("-")
                                        .slice(1)
                                        .join(".")}.`
                                    : ` · ${new Intl.DateTimeFormat("ko-KR", {
                                        timeZone: "Asia/Seoul",
                                        month: "2-digit",
                                        day: "2-digit",
                                        hour: "2-digit",
                                        minute: "2-digit",
                                        hour12: false,
                                      }).format(new Date(issue.publishedAt))}`
                                  : ""}
                              </span>
                            ) : null}
                          </p>
                        </div>
                      ) : (
                        <p
                          key={`${issue.issueType}:${issue.summary}`}
                          className="mb-1 text-xs font-semibold leading-5 text-slate-700 last:mb-0"
                        >
                          {issue.summary}
                        </p>
                      ),
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ) : null}
    </div>
  );
})() : null}{audience === "managed" && activeIncluded.portfolioPerformance ? <ReportPreviewCard title={customerSections.portfolioPerformance.title} summary={customerSections.portfolioPerformance.summary} bullets={customerSections.portfolioPerformance.bullets} /> : null}
          </div>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap justify-end gap-2 border-t border-slate-100 pt-3">
        <button type="button" onClick={handlePdfPreview} className="inline-flex h-9 items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 text-xs font-black text-slate-600 transition hover:bg-slate-50">
          <FileText size={14} /> PDF 미리보기
        </button>
        <button type="button" onClick={handleSendMail} className="inline-flex h-9 items-center gap-1 rounded-lg bg-blue-600 px-3 text-xs font-black text-white shadow-sm transition hover:bg-blue-700">
          <Mail size={14} /> 메일 전송
        </button>
      </div>

      {pdfPreviewOpen && typeof document !== "undefined"
        ? createPortal(
            <div className="fixed inset-0 z-[9999] flex h-dvh w-screen items-center justify-center overflow-hidden bg-slate-950/50 p-4">
              <div className="flex h-[58dvh] w-full max-w-none min-w-0 flex-col overflow-hidden rounded-2xl bg-white shadow-2xl" style={{ height: "72vh", maxHeight: "72vh", width: "86vw", maxWidth: "1540px", minWidth: "1050px" }}>

            <div className="flex shrink-0 items-center justify-between border-b border-slate-200 px-5 py-3">
              <div>
                <h2 className="text-lg font-black text-navy">PDF 미리보기</h2>
                <p className="mt-0.5 text-xs font-semibold text-slate-400">
                  왼쪽에서 포함할 항목을 선택하면 오른쪽 PDF에 즉시 반영됩니다.
                </p>
              </div>

              <div className="flex items-center gap-2">

                <div className="flex h-9 items-center rounded-lg border border-slate-200 bg-white">
                  <button
                    type="button"
                    onClick={() => movePdfCustomer(-1)}
                    disabled={customers.length <= 1}
                    className="flex h-full w-8 items-center justify-center rounded-l-lg text-sm font-black text-slate-500 transition hover:bg-slate-50 hover:text-blue-700 disabled:cursor-default disabled:opacity-30"
                    aria-label="이전 고객"
                  >
                    &lt;
                  </button>

                  <span className="min-w-[90px] px-2 text-center text-xs font-semibold text-slate-700">
                    {pdfCustomer?.name || pdfCustomer?.fallbackName || "고객"}
                    {pdfCustomerBirthDate ? ` (${pdfCustomerBirthDate})` : ""}
                  </span>

                  <button
                    type="button"
                    onClick={() => movePdfCustomer(1)}
                    disabled={customers.length <= 1}
                    className="flex h-full w-8 items-center justify-center rounded-r-lg text-sm font-black text-slate-500 transition hover:bg-slate-50 hover:text-blue-700 disabled:cursor-default disabled:opacity-30"
                    aria-label="다음 고객"
                  >
                    &gt;
                  </button>
                </div>

                <button
                  type="button"
                  onClick={handleSendPdfToCustomer}
                  disabled={sendingCustomerMail}
                  className="h-9 whitespace-nowrap rounded-lg border border-slate-300 bg-white px-4 text-xs font-black text-slate-700 transition hover:bg-slate-50"
                >
                  {sendingCustomerMail ? "PDF 생성 · 메일 전송 중..." : `${pdfCustomer?.name || pdfCustomer?.fallbackName || "고객"} 고객 메일 전송`}
                </button>

                <button
                  type="button"
                  className="h-9 rounded-lg border border-blue-200 bg-blue-50 px-4 text-xs font-black text-blue-700 transition hover:bg-blue-100"
                >
                  전체고객 메일 전송
                </button>

                <button
                  type="button"
                  onClick={() => setPdfPreviewOpen(false)}
                  className="h-9 rounded-lg border border-slate-200 bg-white px-4 text-xs font-black text-slate-600 hover:bg-slate-50"
                >
                  닫기
                </button>

              </div>
            </div>

            <div className="flex min-h-0 flex-1 items-stretch overflow-hidden">

              <aside className="h-full min-h-0 w-[460px] shrink-0 overflow-x-hidden overflow-y-auto border-r border-slate-200 bg-slate-50 p-3" style={{ width: "460px", minWidth: "460px" }}>
                <div className="grid gap-4">

                  <div className="rounded-xl border border-slate-200 bg-white p-3">
                    <p className="text-sm font-black text-navy">포함 항목 선택</p>
                    <p className="mt-1 text-xs font-semibold leading-5 text-slate-400">
                      체크를 해제한 문장은 최종 PDF에서 제외됩니다.
                    </p>
                  </div>

                  {visiblePdfSections.map((section, sectionIndex) => (
                    <div key={section.id} className="rounded-xl border border-slate-200 bg-white p-3">
                      <div className="mb-3 flex items-start justify-between gap-2">
                        <p className="text-xs font-black leading-5 text-navy">
                          {section.id === "pbComment"
                            ? `1. ${displayPbName} PB의 한 줄 코멘트`
                            : section.id === "usMarket"
                              ? `2. 전일 미국 시황`
                              : section.id === "krMarket"
                                ? `2. 당일 국내 시황`
                                : section.id === "holdingIssues"
                                  ? `3. 보유종목 주요 이슈`
                                  : `4. 포트폴리오 성과`}
                        </p>

                        <span className="shrink-0 text-[10px] font-bold text-slate-400">
                          {section.lines.filter((line) => pdfLineIncluded[line.id] !== false).length}/{section.lines.length}
                        </span>
                      </div>

                      {section.lines.length ? (
                        <div className="grid gap-3">
                          {Array.from(new Set(section.lines.map((line) => line.group))).map((group) => {
                            const groupLines = section.lines.filter((line) => line.group === group);

                            return (
                              <div key={`${section.id}:${group}`}>
                                <p className="mb-1 text-[10px] font-black text-slate-400">{group}</p>

                                <div className="grid gap-1">
                                  {groupLines.map((line) => (
                                    <label
                                      key={line.id}
                                      className="flex cursor-pointer items-start gap-2 rounded-lg px-2 py-1.5 hover:bg-slate-50"
                                    >
                                      <input
                                        type="checkbox"
                                        checked={!pdfSelectionInitialized || pdfLineIncluded[line.id] !== false}
                                        onChange={(event) =>
                                          setPdfLineIncluded((current) => ({
                                            ...current,
                                            [line.id]: event.target.checked,
                                          }))
                                        }
                                        className="mt-0.5 h-4 w-4 shrink-0 accent-blue-600"
                                      />

                                      <div className="flex min-w-0 flex-1 items-start gap-2">
                                        {editingPdfLineId === line.id ? (
                                          <textarea
                                            autoFocus
                                            value={pdfLineEdits[line.id] ?? line.text}
                                            onClick={(event) => {
                                              event.preventDefault();
                                              event.stopPropagation();
                                            }}
                                            onChange={(event) =>
                                              setPdfLineEdits((current) => ({
                                                ...current,
                                                [line.id]: event.target.value,
                                              }))
                                            }
                                            onBlur={() => setEditingPdfLineId(null)}
                                            onKeyDown={(event) => {
                                              if (event.key === "Escape") {
                                                setEditingPdfLineId(null);
                                              }

                                              if (event.key === "Enter" && !event.shiftKey) {
                                                event.preventDefault();
                                                setEditingPdfLineId(null);
                                              }
                                            }}
                                            rows={2}
                                            className="min-w-0 flex-1 resize-none rounded-md border border-blue-200 bg-white px-2 py-1 text-[11px] font-semibold leading-4 text-slate-700 outline-none focus:border-blue-400"
                                          />
                                        ) : (
                                          <>
                                            <span className="min-w-0 flex-1 text-[11px] font-semibold leading-4 text-slate-700">
                                              {pdfLineEdits[line.id] ?? line.label}
                                            </span>

                                            <button
                                              type="button"
                                              onClick={(event) => {
                                                event.preventDefault();
                                                event.stopPropagation();
                                                setEditingPdfLineId(line.id);
                                              }}
                                              className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-slate-200 bg-white text-[13px] text-slate-400 transition hover:border-blue-200 hover:bg-blue-50 hover:text-blue-700"
                                              aria-label="문구 수정"
                                              title="문구 수정"
                                            >
                                              ✎
                                            </button>
                                          </>
                                        )}
                                      </div>
                                    </label>
                                  ))}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      ) : (
                        <p className="text-[11px] font-semibold text-slate-400">
                          포함할 내용이 없습니다.
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              </aside>

              <main className="h-full min-h-0 min-w-0 flex-1 overflow-x-auto overflow-y-auto bg-slate-200 p-3">
                <div className="flex w-full min-w-[794px] justify-start px-[24px]">

                  <div
                    id="market-report-pdf"
                    className="box-border h-[1123px] w-[794px] shrink-0 origin-top overflow-hidden bg-white shadow-xl"
                    style={{
                      fontFamily: "Arial, Pretendard, sans-serif",
                      fontSize: "10pt",

                    }}
                  >
                    <div className="h-[9px] bg-blue-700" />

                    <div
                      className=""
                      style={{
                        paddingTop: "96px",
                        paddingBottom: "96px",
                        paddingLeft: "96px",
                        paddingRight: "96px",
                        boxSizing: "border-box",
                      }}
                    >

                      <header className="border-b-2 border-slate-900 pb-4">
                        <div className="flex items-end justify-between gap-6">
                          <div>
                            <h1 className="font-black tracking-tight text-slate-950" style={{ fontSize: "15pt" }}>
                              {getPdfTodayTitle()}
                            </h1>

                            <p className="mt-2 font-normal text-slate-500">
                              {pdfCustomer?.name || pdfCustomer?.fallbackName || "고객"} 고객님
                            </p>
                          </div>

                          <div className="text-right">
                            <p className="text-[11pt] font-black tracking-tight text-blue-700">
                              SAMSUNG
                            </p>
                            <p className="text-[8pt] font-black tracking-[0.18em] text-blue-700">
                              SECURITIES
                            </p>
                          </div>
                        </div>
                      </header>

                      <div className="mt-5 grid gap-5">
                        {visiblePdfSections.map((section) => {
                          const selectedLines = section.lines.filter(
                            (line) => pdfLineIncluded[line.id] !== false,
                          );

                          if (!selectedLines.length) return null;

                          const sectionNumber =
                            section.id === "pbComment"
                              ? "1."
                              : section.id === "usMarket" || section.id === "krMarket"
                                ? "2."
                                : section.id === "holdingIssues"
                                  ? "3."
                                  : "4.";

                          const sectionTitle =
                            section.id === "pbComment"
                              ? `${displayPbName} PB의 한 줄 코멘트`
                              : section.id === "usMarket"
                                ? "전일 미국 시황"
                                : section.id === "krMarket"
                                  ? "당일 국내 시황"
                                  : section.id === "holdingIssues"
                                    ? `보유종목 주요 이슈 (${pdfCustomer?.name || pdfCustomer?.fallbackName || "고객"} 고객님)`
                                    : `포트폴리오 성과 (${pdfCustomer?.name || pdfCustomer?.fallbackName || "고객"} 고객님)`;

                          const marketMeta =
                            section.id === "usMarket"
                              ? getPdfMarketMeta(usReport).replace(
                                  /(생성\s+\d{2}\.\d{2}\s+)\d{2}:\d{2}/,
                                  "$1" + "08:30",
                                )
                              : section.id === "krMarket"
                                ? getPdfMarketMeta(krReport).replace(
                                    /(생성\s+\d{2}\.\d{2}\s+)\d{2}:\d{2}/,
                                    "$1" + "16:00",
                                  )
                                : "";

                          return (
                            <section key={section.id}>
                              <div className="flex items-baseline justify-between gap-4">
                                <h2 className="font-semibold tracking-tight text-slate-950" style={{ fontSize: "13pt" }}>
                                  {sectionNumber} {sectionTitle}
                                </h2>

                                {marketMeta ? (
                                  <p className="shrink-0 font-bold text-slate-400" style={{ fontSize: "8pt" }}>
                                    ({marketMeta})
                                  </p>
                                ) : section.id === "holdingIssues" ? (
          <p
            className="shrink-0 font-normal text-slate-400"
            style={{ fontSize: "7.5pt" }}
          >
            (기사 제목 클릭 시 외부 페이지로 이동합니다.)
          </p>
        ) : section.id === "holdingIssues" ? (<p className="shrink-0 font-normal text-slate-400" style={{ fontSize: "7.5pt" }}>(기사 제목 클릭 시 외부 페이지로 이동합니다.)</p>) : section.id === "holdingIssues" ? (<p className="shrink-0 font-normal text-slate-400" style={{ fontSize: "7.5pt" }}>(기사 제목 클릭 시 외부 페이지로 이동합니다.)</p>) : null}
                              </div>

                              <div
                                data-pdf-section-line="true"
                                aria-hidden="true"
                                style={{
                                  width: "100%",
                                  height: "1px",
                                  backgroundColor: "#cbd5e1",
                                  marginTop: "6px",
                                  marginBottom: "8px",
                                }}
                              />

                              <div className="grid gap-2.5">
                                {Array.from(new Set(selectedLines.map((line) => line.group))).map((group) => {
                                  const groupLines = selectedLines.filter((line) => line.group === group);

                                  return (
                                    <div key={`${section.id}:preview:${group}`} style={{ marginBottom: "22px" }}>

                                      {section.id !== "pbComment" &&
                                      section.id !== "holdingIssues" &&
                                      section.id !== "portfolioPerformance" ? (
                                        <div className="mb-1 flex items-baseline gap-2">
                                          <h3
                                            className="font-semibold text-slate-700"
                                            style={{ fontSize: "11pt" }}
                                          >
                                            {group}
                                          </h3>

                                          {group === "주요 시장 뉴스" ? (
                                            <span
                                              className="shrink-0 font-normal text-slate-400"
                                              style={{ fontSize: "7.5pt" }}
                                            >
                                              (기사 제목 클릭 시 외부 페이지로 이동합니다.)
                                            </span>
                                          ) : null}
                                        </div>
                                      ) : null}

                                      <div className="grid gap-1.5">
                                        {groupLines.map((line, lineIndex) => (
                                          <div key={line.id} className="leading-[1.9] text-slate-700" style={{ fontSize: "10pt" }}>

                                            {section.id === "holdingIssues" &&
                                            line.badge &&
                                            !groupLines
                                              .slice(0, lineIndex)
                                              .some((previousLine) => previousLine.badge === line.badge) ? (
                                              <div className="mb-1 flex items-center gap-2">
                                                <span className="inline-flex rounded-md border border-blue-300 bg-blue-50 px-2 py-0.5 font-semibold text-blue-700">
                                                  {line.badge}
                                                </span>
                                              </div>
                                            ) : null}

                                            <div className="flex items-start gap-1.5">
                                              {section.id !== "pbComment" ? (
                                                <span className="shrink-0 font-black text-slate-400">•</span>
                                              ) : null}

                                              <div className="min-w-0">
                                                {line.url ? (
                                                  <a
                                                    href={line.url}
                                                    target="_blank"
                                                    rel="noreferrer"
                                                    className="font-normal text-slate-700 underline decoration-slate-400 underline-offset-2"
                                                  >
                                                    <PdfRichText text={pdfLineEdits[line.id] ?? line.text} />
                                                  </a>
                                                ) : (
                                                  <span className="font-normal">
                                                    <PdfRichText text={pdfLineEdits[line.id] ?? line.text} />
                                                  </span>
                                                )}

                                                {line.meta ? (
                                                  <span className="ml-2 whitespace-nowrap font-bold text-slate-400" style={{ fontSize: "8pt" }}>
                                                    {line.meta}
                                                  </span>
                                                ) : null}
                                              </div>
                                            </div>
                                          </div>
                                        ))}
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            </section>
                          );
                        })}
                      </div>

                    </div>
                  </div>

                </div>
              </main>

            </div>
          </div>
        </div>,
            document.body,
          )
        : null}
</section>
  );
}

function PlaceholderPanel({ title, heightClass }: { title: string; heightClass: string }) {
  return (
    <section className={'flex w-full min-w-0 max-w-full flex-col overflow-hidden rounded-xl border border-blue-100 bg-white p-3 shadow-sm ' + heightClass}>
      <div className="mb-3 flex shrink-0 items-center justify-between gap-2">
        <p className="text-sm font-black text-navy">{title}</p>
      </div>
      <div className="flex min-h-0 flex-1 items-center justify-center rounded-lg border border-dashed border-slate-200 bg-slate-50 px-3 py-8 text-center text-sm font-bold text-slate-400">
        추후 기능이 추가될 예정입니다.
      </div>
    </section>
  );
}

export default function MarketDashboard({ selectedCustomer, selectedState, customers = [], customerData = {}, pbName, pbId, pbEmployeeId }: MarketDashboardProps) {
  const [indices, setIndices] = useState(emptyIndices);
  const [indicesRefreshedAt, setIndicesRefreshedAt] = useState<Date | null>(null);

  useEffect(() => {
    let cancelled = false;
    let intervalId: number | null = null;
    const cached = readMarketIndexCache();
    if (cached) {
      setIndices({ data: cached.data, loading: false, error: "" });
      setIndicesRefreshedAt(new Date(cached.refreshedAt));
    }

    async function load() {
      try {
        const response = await fetch("/api/market/indices");
        const body = await response.json();
        if (!cancelled) {
          if (response.ok && Array.isArray(body.data) && body.data.length) {
            const refreshedAt = new Date();
            setIndices({ data: body.data, loading: false, error: "" });
            setIndicesRefreshedAt(refreshedAt);
            writeMarketIndexCache(body.data, refreshedAt);
          } else {
            setIndices((prev) => prev.data.length ? { ...prev, loading: false, error: "" } : { data: [], loading: false, error: body.error ?? "error" });
          }
        }
      } catch {
        if (!cancelled) {
          setIndices((prev) => prev.data.length ? { ...prev, loading: false, error: "" } : { data: [], loading: false, error: "error" });
        }
      }
    }

    void load();
    const timeoutId = window.setTimeout(() => {
      void load();
      intervalId = window.setInterval(load, 5 * 60 * 1000);
    }, msUntilNextFiveMinuteBoundary());
    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
      if (intervalId) window.clearInterval(intervalId);
    };
  }, []);

  return (
    <div className="flex w-full min-w-0 max-w-full flex-1 flex-col gap-4">
      <IndexStrip state={indices} refreshedAt={indicesRefreshedAt} />
      <MarketReportMailingPanel selectedCustomer={selectedCustomer} selectedState={selectedState} customers={customers} customerData={customerData} pbName={pbName} pbId={pbId} pbEmployeeId={pbEmployeeId} />
      <PlaceholderPanel title="섹터 스캐너" heightClass="min-h-[360px]" />
    </div>
  );
}







