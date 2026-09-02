"use client";

import { useEffect, useState } from "react";
import { FileText, Mail, RefreshCw } from "lucide-react";
import type { MarketIndexItem } from "@/lib/marketData";
import type { AppState, CustomerProfile } from "@/app/maintab/CustomerContext";
import { buildCustomerReportSections } from "@/services/customerService";
import { MacroChartViewer } from "@/components/MacroChartViewer";
import SectorScanner from "@/components/SectorScanner";

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
            className="w-9 shrink-0 border-r border-slate-100 bg-white text-sm font-black text-blue-700 transition hover:bg-blue-50 disabled:cursor-not-allowed disabled:text-slate-300 disabled:hover:bg-white"
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
            className="w-9 shrink-0 bg-white text-sm font-black text-blue-700 transition hover:bg-blue-50 disabled:cursor-not-allowed disabled:text-slate-300 disabled:hover:bg-white"
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
  pbName?: string;
};

const audienceTabs: { id: AudienceTab; label: string }[] = [
  { id: "managed", label: "관리 고객" },
  { id: "unmanaged", label: "미관리 고객" },
];

const mailingItems: Record<AudienceTab, { id: MailingItemId; label: string }[]> = {
  managed: [
    { id: "usMarket", label: "전일 미국 시황" },
    { id: "krMarket", label: "당일 국내 시황" },
    { id: "holdingIssues", label: "고객별 보유 종목 주요 이슈" },
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
  const basis = report.dataAsOf ? `기준 ${formatKoreanDateTime(report.dataAsOf)} ${market === "us" ? "미국장" : "국내장"}` : `기준 ${report.reportDate}`;
  const generated = report.generatedAt ? `생성 ${formatKoreanDateTime(report.generatedAt)}` : "";
  return [basis, generated].filter(Boolean).join(" · ");
}
function marketReportTitle(id: "usMarket" | "krMarket") {
  return id === "usMarket" ? "전일 미국 시황" : "당일 국내 시황";
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
        className="inline-flex h-8 shrink-0 items-center gap-1 rounded-lg border border-blue-100 bg-blue-50 px-2 text-[11px] font-black text-blue-700 transition hover:bg-blue-100 disabled:cursor-wait disabled:opacity-60"
      >
        <RefreshCw size={13} className={refreshing ? "animate-spin" : ""} /> 새로고침
      </button>
    </div>
  );
}

function MarketReportMailingPanel({ selectedCustomer, selectedState, pbName }: MarketDashboardProps) {
  const [audience, setAudience] = useState<AudienceTab>("managed");
  const [included, setIncluded] = useState(initialIncluded);
  const [reports, setReports] = useState<Record<"us" | "kr", MarketReport | undefined>>({ us: undefined, kr: undefined });
  const [loadingReports, setLoadingReports] = useState(true);
  const [reportsError, setReportsError] = useState("");
  const [refreshingMarket, setRefreshingMarket] = useState<"us" | "kr" | null>(null);
  const [actionMessage, setActionMessage] = useState("");
  const [pbComment, setPbComment] = useState("");
  const [commentTouched, setCommentTouched] = useState(false);
  const [savingComment, setSavingComment] = useState(false);
  const customerSections = buildCustomerReportSections(selectedCustomer, selectedState);
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
    setActionMessage("PDF 미리보기는 다음 단계에서 연결됩니다.");
  }

  function handleSendMail() {
    setActionMessage("메일 전송은 다음 단계에서 연결됩니다.");
  }

  useEffect(() => {
    if (!commentTouched) return;
    const id = window.setTimeout(() => {
      void savePbComment(pbComment);
    }, 600);
    return () => window.clearTimeout(id);
  }, [commentTouched, pbComment]);

  const activeIncluded = included[audience];
  const usReport = reports.us;
  const krReport = reports.kr;

  return (
    <section className="flex w-full min-w-0 max-w-full flex-col overflow-hidden rounded-xl border border-blue-100 bg-white p-3 shadow-sm">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-black text-navy">시황 보고서 메일링</p>
        <button type="button" onClick={refreshReports} disabled={loadingReports || Boolean(refreshingMarket)} className="inline-flex h-8 items-center gap-1 rounded-lg border border-blue-100 bg-blue-50 px-2 text-[11px] font-black text-blue-700 transition hover:bg-blue-100 disabled:cursor-wait disabled:opacity-60"><RefreshCw size={12} className={loadingReports || refreshingMarket ? "animate-spin" : ""} /> 새로고침</button>
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
            {audience === "managed" && activeIncluded.holdingIssues ? <ReportPreviewCard title={customerSections.holdingIssues.title} summary={customerSections.holdingIssues.summary} bullets={customerSections.holdingIssues.bullets} /> : null}
            {audience === "managed" && activeIncluded.portfolioPerformance ? <ReportPreviewCard title={customerSections.portfolioPerformance.title} summary={customerSections.portfolioPerformance.summary} bullets={customerSections.portfolioPerformance.bullets} /> : null}
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
    </section>
  );
}

export default function MarketDashboard({ selectedCustomer, selectedState, pbName }: MarketDashboardProps) {
  return (
    <div className="flex w-full min-w-0 max-w-full flex-1 flex-col gap-4">
      <MacroChartViewer />
      <MarketReportMailingPanel selectedCustomer={selectedCustomer} selectedState={selectedState} pbName={pbName} />
      <SectorScanner />
    </div>
  );
}







