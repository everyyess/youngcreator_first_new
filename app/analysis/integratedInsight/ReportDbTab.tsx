"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Bookmark, Check, ExternalLink, FileText, FileUp, Loader2, Minus, Sparkles, X } from "lucide-react";
import type { ReportCategory, ReportItem } from "@/app/api/report-db/route";
import {
  AiLimitModal, SavedFilterBar, SavedListRow, SearchDateBar, TagEditSection, inDateRange,
  isQuotaExceededMessage, recordAiUsage, useAiLimitGuard, useAiModel,
} from "./shared";

/**
 * 리포트 DB — 네이버 금융 리서치 (종목분석·산업분석·투자정보·경제분석)
 *  - 키워드/기간 필터, 원문·AI 요약(자동 모델 폴백), 자동 태그(추가/삭제), 정리 박스, Supabase 저장
 *  - 글 클릭 시 뉴스 DB처럼 모달 창으로 표시
 *  - PDF 업로드 → 노랑 하이라이트 추출 저장
 */

const CATEGORIES: { id: ReportCategory; label: string }[] = [
  { id: "company",  label: "종목분석" },
  { id: "industry", label: "산업분석" },
  { id: "invest",   label: "투자정보" },
  { id: "economy",  label: "경제분석" },
];

const CATEGORY_LABEL: Record<string, string> = {
  ...Object.fromEntries(CATEGORIES.map((c) => [c.id, c.label])),
  upload: "PDF 업로드",
};

type SavedRow = {
  id: string;
  title: string;
  url: string;
  category: string;
  broker: string;
  item_name: string;
  published_date: string | null;
  pdf_url: string | null;
  ai_summary: string;
  original_text: string;
  topic_tags: string[];
  company_tags: string[];
  macro_tags: string[];
  notes: string;
  created_at: string;
};

type DetailState = {
  title: string;
  broker: string;
  date: string;
  loadingText: boolean;
  text: string;
  loadingSummary: boolean;
  summary: string;
  summaryError: string;
  loadingTags: boolean;
  topics: string[];
  companies: string[];
  macro: string[];
  notes: string;
  saving: boolean;
  saved: boolean;
  view: "original" | "summary";
};

const EMPTY_DETAIL: DetailState = {
  title: "",
  broker: "",
  date: "",
  loadingText: false, text: "", loadingSummary: false, summary: "", summaryError: "",
  loadingTags: false, topics: [], companies: [], macro: [], notes: "", saving: false, saved: false, view: "summary",
};

function renderSummaryMarkdown(text: string): string {
  return text.split("\n").map((raw) => {
    const line = raw.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const bold = (s: string) => s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    if (line.startsWith("- ")) return `<li class="ml-4 list-disc text-[17px] font-normal text-[#33493F]">${bold(line.slice(2))}</li>`;
    if (line.trim() === "") return `<div class="h-1"></div>`;
    return `<p class="text-[17px] font-normal text-[#1C3329]">${bold(line)}</p>`;
  }).join("\n");
}

export default function ReportDbTab() {
  const [category, setCategory] = useState<ReportCategory>("company");
  const [viewMode, setViewMode] = useState<"browse" | "saved">("browse");
  const [reports, setReports] = useState<ReportItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [reportsPage, setReportsPage] = useState(1);
  const [reportsHasMore, setReportsHasMore] = useState(false);
  // 화면에는 항상 20건 단위로만 노출 — 서버가 이미 더 많이 가져왔어도 더보기를 눌러야 다음 20건이 보인다
  const [visibleCount, setVisibleCount] = useState(20);
  const [error, setError] = useState("");
  const [keyword, setKeyword] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [focused, setFocused] = useState<ReportItem | null>(null);
  const [detail, setDetail] = useState<DetailState>(EMPTY_DETAIL);
  const [savedRows, setSavedRows] = useState<SavedRow[]>([]);
  const [savedLoading, setSavedLoading] = useState(false);
  const [savedFilter, setSavedFilter] = useState("");
  const [savedCompany, setSavedCompany] = useState("");
  const [savedTopic, setSavedTopic] = useState("");
  const [savedFromDate, setSavedFromDate] = useState("");
  const [savedToDate, setSavedToDate] = useState("");
  const [aiModel, setAiModel] = useAiModel();
  const limitGuard = useAiLimitGuard(setAiModel);
  const [pdfUploading, setPdfUploading] = useState(false);
  const [pdfNotice, setPdfNotice] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [mounted, setMounted] = useState(false);

  const [deletedReportUrls, setDeletedReportUrls] = useState<Set<string>>(new Set());
  const [visitedReportUrls, setVisitedReportUrls] = useState<Set<string>>(() => {
    if (typeof window === "undefined") return new Set();
    try {
      const stored = localStorage.getItem("report_visited_urls");
      return new Set(stored ? (JSON.parse(stored) as string[]) : []);
    } catch { return new Set(); }
  });

  useEffect(() => {
    try { localStorage.setItem("report_visited_urls", JSON.stringify([...visitedReportUrls])); } catch {}
  }, [visitedReportUrls]);

  useEffect(() => {
    setMounted(true);
    fetch("/api/report-db/deleted")
      .then((res) => res.json())
      .then((data: { deletedUrls?: string[] }) => {
        if (data.deletedUrls) setDeletedReportUrls(new Set(data.deletedUrls));
      })
      .catch(console.error);
  }, []);

  const savedUrls = useMemo(() => new Set(savedRows.map((r) => r.url)), [savedRows]);

  // ── 목록 로드 (page=1이면 새로 조회, 그 이상이면 "더보기"로 이어붙임) ──────────
  const loadList = useCallback(async (cat: ReportCategory, kw: string, from: string, to: string, page = 1) => {
    if (page > 1) setLoadingMore(true); else setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ action: "list", category: cat });
      if (kw.trim()) params.set("keyword", kw.trim());
      if (from) params.set("from", from);
      if (to) params.set("to", to);
      if (page > 1) params.set("page", String(page));
      const res = await fetch(`/api/report-db?${params.toString()}`);
      let json: { reports?: ReportItem[]; hasMore?: boolean; error?: string };
      try {
        json = await res.json();
      } catch {
        throw new Error(res.status === 504 ? "리포트 로딩 시간 초과. 잠시 후 다시 시도하세요." : "서버 응답 오류. 잠시 후 다시 시도하세요.");
      }
      if (!res.ok) throw new Error(json.error ?? "리포트를 불러오지 못했습니다.");
      setReports((prev) => (page > 1 ? [...prev, ...(json.reports ?? [])] : json.reports ?? []));
      setReportsHasMore(!!json.hasMore);
      setReportsPage(page);
      if (page === 1) setVisibleCount(20);
    } catch (e) {
      setError(e instanceof Error ? e.message : "오류가 발생했습니다.");
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, []);

  useEffect(() => { void loadList(category, keyword, fromDate, toDate); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [category]);

  const visibleReports = useMemo(
    () => reports.filter((r) => !deletedReportUrls.has(r.detailUrl)),
    [reports, deletedReportUrls],
  );

  // ── 더보기 — 화면에는 20건씩만 노출. 이미 불러온 데이터 중 안 보여준 분량이 있으면
  // 네트워크 요청 없이 노출만 늘리고, 다 보여줬다면 다음 페이지를 더 불러온다 ──────────
  const handleLoadMoreReports = useCallback(() => {
    const nextVisible = visibleCount + 20;
    if (nextVisible <= visibleReports.length) {
      setVisibleCount(nextVisible);
      return;
    }
    if (!reportsHasMore) { setVisibleCount(nextVisible); return; }
    void loadList(category, keyword, fromDate, toDate, reportsPage + 1).then(() => setVisibleCount(nextVisible));
  }, [visibleCount, visibleReports.length, reportsHasMore, loadList, category, keyword, fromDate, toDate, reportsPage]);

  const loadSaved = useCallback(async () => {
    setSavedLoading(true);
    try {
      const res = await fetch("/api/report-db?action=saved");
      const json = await res.json();
      if (res.ok) setSavedRows(json.reports ?? []);
    } catch {} finally {
      setSavedLoading(false);
    }
  }, []);
  useEffect(() => { void loadSaved(); }, [loadSaved]);

  // ── AI 요약 요청 (모델은 자동 폴백, 전부 소진 시에만 전환 팝업) ─────────────
  const requestSummary = useCallback((report: ReportItem) => {
    if (!report.pdfUrl) return;
    setDetail((d) => ({ ...d, loadingSummary: true, summaryError: "" }));
    fetch(`/api/naver-reports/summarize?pdfUrl=${encodeURIComponent(report.pdfUrl)}&title=${encodeURIComponent(report.title)}&model=${encodeURIComponent(aiModel)}`)
      .then((res) => res.json())
      .then((json: { summary?: string; error?: string }) => {
        if (json.summary) {
          recordAiUsage(aiModel);
          setDetail((d) => ({ ...d, loadingSummary: false, summary: json.summary!, summaryError: "" }));
          return;
        }
        if (isQuotaExceededMessage(json.error)) {
          limitGuard.trigger(() => requestSummary(report));
          setDetail((d) => ({ ...d, loadingSummary: false }));
          return;
        }
        setDetail((d) => ({ ...d, loadingSummary: false, summaryError: json.error ?? "요약 실패" }));
      })
      .catch(() => setDetail((d) => ({ ...d, loadingSummary: false, summaryError: "요약 요청 실패" })));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aiModel]);

  // ── 리포트 열기: 원문 + 태그 + (PDF 있으면) AI 요약 ─────────────────────
  const openReport = (report: ReportItem) => {
    setFocused(report);
    setVisitedReportUrls((prev) => (prev.has(report.detailUrl) ? prev : new Set([...prev, report.detailUrl])));
    const savedRow = savedRows.find((r) => r.url === report.detailUrl);
    setDetail({
      ...EMPTY_DETAIL,
      title: report.title,
      broker: report.broker,
      date: report.date,
      loadingText: !report.detailUrl.startsWith("upload://"),
      loadingTags: !savedRow,
      notes: savedRow?.notes ?? "",
      topics: savedRow?.topic_tags ?? [],
      companies: savedRow?.company_tags ?? [],
      macro: savedRow?.macro_tags ?? [],
      summary: savedRow?.ai_summary ?? "",
      text: report.detailUrl.startsWith("upload://") ? (savedRow?.original_text ?? "") : "",
      saved: !!savedRow,
      view: report.pdfUrl || savedRow?.ai_summary ? "summary" : "original",
    });

    // 업로드된 PDF 행은 원문/태그 fetch 불필요
    if (report.detailUrl.startsWith("upload://")) {
      setDetail((d) => ({ ...d, loadingTags: false }));
      return;
    }

    // 원문을 먼저 확보한 뒤, 저장본이 없으면 본문 기반으로 태깅 (제목만으로 태깅할 때보다 정확도가 높다)
    fetch(`/api/report-db?action=detail&url=${encodeURIComponent(report.detailUrl)}`)
      .then((res) => res.json())
      .then(async (json: { text?: string }) => {
        const text = json.text ?? "";
        setDetail((d) => ({ ...d, loadingText: false, text }));
        if (!savedRow) {
          const res2 = await fetch("/api/hankyung-tag", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ title: `${report.itemName} ${report.title}`.trim(), content: text, category: "economy" }),
          });
          const tagJson = (await res2.json()) as { topics?: string[]; companies?: string[]; macro?: string[] };
          setDetail((d) => ({
            ...d, loadingTags: false,
            topics: (tagJson.topics ?? []).filter((t) => t !== "News"),
            companies: report.itemName && !(tagJson.companies ?? []).includes(report.itemName)
              ? [report.itemName, ...(tagJson.companies ?? [])]
              : (tagJson.companies ?? []),
            macro: tagJson.macro ?? [],
          }));
        }
      })
      .catch(() => setDetail((d) => ({ ...d, loadingText: false, loadingTags: false })));

    // AI 요약 (PDF 기반, 저장본에 요약 없을 때만)
    if (report.pdfUrl && !savedRow?.ai_summary) requestSummary(report);
  };

  const saveReport = async () => {
    if (!focused) return;
    setDetail((d) => ({ ...d, saving: true }));
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30_000);
    try {
      const res = await fetch("/api/report-db", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          title: detail.title || focused.title,
          url: focused.detailUrl,
          category: focused.category,
          broker: detail.broker || focused.broker,
          item_name: focused.itemName,
          published_date: detail.date || focused.date,
          pdf_url: focused.pdfUrl,
          ai_summary: detail.summary,
          original_text: detail.text,
          topic_tags: detail.topics,
          company_tags: detail.companies,
          macro_tags: detail.macro,
          notes: detail.notes,
        }),
      });
      clearTimeout(timeoutId);
      let resJson: { report?: unknown; error?: string } = {};
      try { resJson = await res.json(); } catch {}
      if (res.ok) {
        setDetail((d) => ({ ...d, saving: false, saved: true }));
        void loadSaved();
      } else {
        setDetail((d) => ({ ...d, saving: false }));
        setPdfNotice(`저장 실패: ${resJson.error ?? "서버 오류가 발생했습니다."}`);
      }
    } catch (e) {
      clearTimeout(timeoutId);
      const msg = e instanceof Error && e.name === "AbortError"
        ? "저장 시간 초과(30초). 잠시 후 다시 시도하세요."
        : "저장 중 오류가 발생했습니다.";
      setDetail((d) => ({ ...d, saving: false }));
      setPdfNotice(msg);
    }
  };

  const deleteSaved = async (id: string, url: string) => {
    if (!confirm("이 저장 항목을 삭제하시겠습니까?")) return;
    await fetch("/api/report-db", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) });
    setSavedRows((prev) => prev.filter((r) => r.id !== id));
    if (focused?.detailUrl === url) setDetail((d) => ({ ...d, saved: false }));
  };

  const handleDeleteReport = async (reportUrl: string) => {
    if (!confirm("이 리포트 기사를 삭제하시겠습니까?")) return;
    try {
      const res = await fetch("/api/report-db/deleted", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: reportUrl }),
      });
      if (!res.ok) throw new Error("삭제 실패");
      setDeletedReportUrls((prev) => new Set([...prev, reportUrl]));
      setReports((prev) => prev.filter((r) => r.detailUrl !== reportUrl));
      if (focused?.detailUrl === reportUrl) setFocused(null);
    } catch {
      setError("리포트 기사 삭제 중 오류가 발생했습니다.");
    }
  };

  // ── PDF 업로드 → 노랑 하이라이트/전체 요약 추출 ─────────────────────────────────────
  const uploadPdf = async (file: File, mode: "full" | "highlights") => {
    setPdfUploading(true);
    setPdfNotice("");
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("model", aiModel);
      fd.append("mode", mode);
      const res = await fetch("/api/report-db/pdf-highlights", { method: "POST", body: fd });
      let json: {
        title?: string;
        broker?: string;
        published_date?: string | null;
        ai_summary?: string;
        original_text?: string;
        companies?: string[];
        topics?: string[];
        macro?: string[];
        url?: string;
        saved?: boolean;
        error?: string;
      };
      try {
        json = await res.json();
      } catch {
        throw new Error(
          res.status === 504
            ? "PDF 분석 시간 초과(60초). PDF가 너무 크거나 서버가 바쁩니다. 잠시 후 다시 시도하세요."
            : `서버 응답 오류 (HTTP ${res.status})`
        );
      }

      if (!res.ok) {
        if (isQuotaExceededMessage(json.error)) {
          limitGuard.trigger(() => void uploadPdf(file, mode));
          setPdfUploading(false);
          if (fileInputRef.current) fileInputRef.current.value = "";
          return;
        }
        throw new Error(json.error ?? "PDF 분석 실패");
      }
      recordAiUsage(aiModel);

      const dummyReport: ReportItem = {
        title: json.title || file.name.replace(/\.pdf$/i, ""),
        category: "upload" as ReportCategory,
        itemName: "",
        broker: json.broker || "",
        date: json.published_date || "",
        pdfUrl: null,
        detailUrl: json.url || `upload://pdf/temp-${Date.now()}`,
      };

      setViewMode("browse");
      setFocused(dummyReport);
      setDetail({
        ...EMPTY_DETAIL,
        title: dummyReport.title,
        broker: dummyReport.broker,
        date: dummyReport.date,
        loadingText: false,
        loadingTags: false,
        notes: "",
        topics: json.topics ?? [],
        companies: json.companies ?? [],
        macro: json.macro ?? [],
        summary: json.ai_summary ?? "",
        text: json.original_text ?? "",
        saved: !!json.saved,
        view: "summary",
      });

      setPdfNotice(
        json.saved
          ? `'${dummyReport.title}' — 이미 저장된 PDF입니다. 기존 내용을 불러왔습니다.`
          : `'${dummyReport.title}' — PDF 분석 완료. 검토 후 저장해주세요.`
      );

      if (json.saved) {
        void loadSaved();
      }
    } catch (e) {
      setPdfNotice(e instanceof Error ? e.message : "PDF 처리 중 오류");
    } finally {
      setPdfUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const allSavedCompanies = useMemo(() => [...new Set(savedRows.flatMap((r) => r.company_tags))].sort(), [savedRows]);
  const allSavedTopics = useMemo(() => [...new Set(savedRows.flatMap((r) => r.topic_tags))].sort(), [savedRows]);

  const filteredSaved = useMemo(() => {
    const f = savedFilter.trim().toLowerCase();
    return savedRows.filter((r) => {
      if (f && !`${r.title} ${r.item_name} ${r.broker}`.toLowerCase().includes(f)) return false;
      if (savedCompany && !r.company_tags.includes(savedCompany)) return false;
      if (savedTopic && !r.topic_tags.includes(savedTopic)) return false;
      if (!inDateRange(r.published_date ?? r.created_at, savedFromDate, savedToDate)) return false;
      return true;
    });
  }, [savedRows, savedFilter, savedCompany, savedTopic, savedFromDate, savedToDate]);

  const closeModal = () => { setFocused(null); setIsEditing(false); };
  const focusedSavedRow = focused ? savedRows.find((r) => r.url === focused.detailUrl) ?? null : null;

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col gap-5">
      <section className="rounded-card border border-[#DDE8E5] bg-white p-5 shadow-card">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary text-white">
              <FileText size={22} />
            </span>
            <div>
              <h2 className="text-lg font-black text-[#0D2318]">리포트 DB</h2>
              <p className="text-xs font-semibold text-[#7A9488]">
                증권사 리포트 및 리서치 자료를 체계적으로 수집하고 AI 핵심 인사이트를 요약합니다
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex rounded-btn bg-[#F0F5F4] p-1 flex-wrap gap-0.5">
              {CATEGORIES.map((c) => {
                const active = viewMode === "browse" && category === c.id;
                return (
                  <button key={c.id} type="button"
                    onClick={() => { setViewMode("browse"); setCategory(c.id); setFocused(null); }}
                    className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-bold transition ${
                      active ? "bg-primary text-white shadow-soft" : "text-[#4B6358] hover:text-primary"
                    }`}>
                    {c.label}
                  </button>
                );
              })}
              <button type="button"
                onClick={() => { setViewMode("saved"); setFocused(null); void loadSaved(); }}
                className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-bold transition ${
                  viewMode === "saved" ? "bg-primary text-white shadow-soft" : "text-[#4B6358] hover:text-primary"
                }`}>
                <Bookmark size={13} /> 저장됨
                <span className={`ml-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-bold ${
                  viewMode === "saved" ? "bg-white/20 text-white" : "bg-[#DFE9E5] text-[#5F7A70]"
                }`}>
                  {savedRows.length}
                </span>
              </button>
            </div>

            <div className="flex items-center">
              <input ref={fileInputRef} type="file" accept="application/pdf" className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) {
                    setSelectedFile(f);
                    setShowUploadModal(true);
                  }
                }} />
              <button type="button" onClick={() => fileInputRef.current?.click()} disabled={pdfUploading}
                className="flex items-center gap-1.5 rounded-btn border border-[#DDE8E5] bg-white px-3 py-2 text-sm font-bold text-[#4B6358] transition hover:border-primary hover:text-primary disabled:opacity-50">
                {pdfUploading ? <Loader2 size={13} className="animate-spin" /> : <FileUp size={13} />}
                {pdfUploading ? "PDF 분석 중…" : "PDF 업로드"}
              </button>
            </div>
          </div>
        </div>
      </section>

      <div className="rounded-xl border border-[#DDE8E5] bg-white p-6 shadow-sm overflow-hidden flex flex-col gap-4">

      {pdfNotice && (
        <p className="rounded-btn border border-[#DDE8E5] bg-[#F6FAF8] px-4 py-2 text-[12px] font-semibold text-[#33493F]">
          {pdfNotice}
        </p>
      )}

      {viewMode === "browse" && (
        <SearchDateBar
          keyword={keyword} onKeyword={setKeyword}
          fromDate={fromDate} onFromDate={setFromDate}
          toDate={toDate} onToDate={setToDate}
          searching={loading}
          onSubmit={() => void loadList(category, keyword, fromDate, toDate)}
          onReset={() => { setKeyword(""); setFromDate(""); setToDate(""); void loadList(category, "", "", ""); }}
          placeholder="키워드·종목명·산업명 검색"
        />
      )}

      {viewMode === "saved" && (
        <SavedFilterBar
          search={savedFilter} onSearch={setSavedFilter}
          company={savedCompany} onCompany={setSavedCompany}
          topic={savedTopic} onTopic={setSavedTopic}
          allCompanies={allSavedCompanies} allTopics={allSavedTopics}
          fromDate={savedFromDate} onFromDate={setSavedFromDate}
          toDate={savedToDate} onToDate={setSavedToDate}
          placeholder="저장된 리포트 검색 (제목·종목명·증권사)"
        />
      )}

      {error && <p className="rounded-btn border border-red-200 bg-red-50 px-4 py-2.5 text-sm font-semibold text-red-600">{error}</p>}

      {/* 목록 (전체 폭) */}
      <div className="max-h-[640px] overflow-y-auto rounded-card border border-[#E8F0ED]">
        {viewMode === "browse" ? (
          loading && reports.length === 0 ? (
            <p className="py-16 text-center text-sm font-bold text-[#94A8A0]">리포트 불러오는 중…</p>
          ) : reports.length === 0 ? (
            <p className="py-16 text-center text-sm font-bold text-[#94A8A0]">조건에 맞는 리포트가 없습니다.</p>
          ) : (
            <>
            {visibleReports
              .slice(0, visibleCount)
              .map((r) => {
                const isVisited = visitedReportUrls.has(r.detailUrl);
                const isSaved = savedUrls.has(r.detailUrl);
                return (
                <div
                  key={r.detailUrl}
                  role="button"
                  tabIndex={0}
                  onClick={() => openReport(r)}
                  onKeyDown={(e) => {
                    if (e.key !== "Enter" && e.key !== " ") return;
                    e.preventDefault();
                    openReport(r);
                  }}
                  className={`group flex w-full items-start gap-3 border-b border-[#F0F7F4] px-4 py-3 text-left transition hover:bg-[#F6FAF8] cursor-pointer ${isVisited ? "opacity-50" : ""}`}
                >
                  {/* Left Hover Delete Button Container */}
                  <div className="relative w-5 h-5 shrink-0 flex items-center justify-center self-center">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        void handleDeleteReport(r.detailUrl);
                      }}
                      className="absolute inset-0 z-10 flex items-center justify-center rounded bg-red-50 text-red-500 hover:bg-red-100 hover:text-red-700 opacity-0 group-hover:opacity-100 transition-opacity"
                      title="삭제"
                    >
                      <Minus size={13} strokeWidth={3} />
                    </button>
                    {/* Default indicator when not hovered */}
                    <div className="group-hover:opacity-0 w-1.5 h-1.5 rounded-full bg-slate-300 transition-opacity" />
                  </div>

                  <div className="min-w-0 flex-1 flex flex-col gap-1">
                    <span className="flex items-center gap-2">
                      {r.itemName && <span className="rounded-full bg-[#EEF4F1] px-2 py-0.5 text-[10px] font-black text-[#4B6358]">{r.itemName}</span>}
                      <span className="text-[10px] font-semibold text-[#94A8A0]">{r.broker} · {r.date}</span>
                    </span>
                    <span className="text-[13px] font-bold text-[#1C3329]">{r.title}</span>
                  </div>

                  {isSaved && (
                    <span className="shrink-0 rounded bg-emerald-100 px-2 py-1 text-[12px] font-semibold text-emerald-700">
                      저장됨
                    </span>
                  )}
                </div>
                );
              })}
            {(visibleCount < visibleReports.length || reportsHasMore) && visibleReports.length >= 20 && (
              <div className="p-3">
                <button
                  type="button"
                  onClick={handleLoadMoreReports}
                  disabled={loadingMore}
                  className="flex w-full items-center justify-center gap-1.5 rounded-md border border-[#DDE8E5] py-2 text-[12px] font-medium text-[#5F7A70] hover:bg-[#F6FAF8] transition disabled:opacity-50"
                >
                  {loadingMore ? <Loader2 size={12} className="animate-spin" /> : null}
                  더 보기
                </button>
              </div>
            )}
            </>
          )
        ) : savedLoading ? (
          <p className="py-16 text-center text-sm font-bold text-[#94A8A0]">저장 목록 불러오는 중…</p>
        ) : filteredSaved.length === 0 ? (
          <p className="py-16 text-center text-sm font-bold text-[#94A8A0]">저장된 리포트가 없습니다.</p>
        ) : (
          filteredSaved.map((r, idx) => (
            <SavedListRow
              key={r.id}
              index={idx + 1}
              title={r.title}
              date={`${CATEGORY_LABEL[r.category] ?? r.category}${r.item_name ? ` · ${r.item_name}` : ""} · ${r.broker} · ${r.published_date}`}
              topics={r.topic_tags}
              companies={r.company_tags}
              macro={r.macro_tags}
              onClick={() => openReport({
                title: r.title, category: r.category as ReportCategory, itemName: r.item_name,
                broker: r.broker, date: r.published_date ?? "", pdfUrl: r.pdf_url, detailUrl: r.url,
              })}
              onDelete={() => void deleteSaved(r.id, r.url)}
            />
          ))
        )}
      </div>

      {/* 상세 모달 */}
      {focused && mounted && createPortal(
        <div className="fixed bottom-0 left-0 right-0 top-12 z-[100] flex items-center justify-center bg-black/60 p-4 sm:p-8" onClick={closeModal}>
          <div
            className={`flex max-h-[85vh] w-full flex-col overflow-hidden rounded-xl bg-white shadow-2xl transition-all duration-300 ${
              viewMode === "saved" ? "max-w-5xl" : "max-w-7xl"
            }`}
            onClick={(e) => e.stopPropagation()}
          >
            {viewMode === "saved" ? (
              /* ── 저장목록 간소화 뷰: 정리가 있으면 정리만, 없으면 AI 요약 (News/Blog DB와 동일) ── */
              <div className="flex flex-1 flex-col overflow-y-auto">
                <div className="sticky top-0 z-10 border-b border-[#E8F0ED] bg-white px-5 py-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="text-[11px] font-semibold text-[#94A8A0]">
                        {CATEGORY_LABEL[focused.category] ?? focused.category} · {focused.broker} · {focused.date}
                        {focused.itemName && ` · ${focused.itemName}`}
                      </p>
                      <h3 className="mt-0.5 text-[15px] font-black leading-snug text-[#0D2318]">{focused.title}</h3>
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5">
                      {focused.pdfUrl && (
                        <a href={focused.pdfUrl} target="_blank" rel="noreferrer"
                          className="flex items-center gap-1 rounded-md border border-[#DDE8E5] px-2.5 py-1.5 text-[12px] font-medium text-[#5F7A70] hover:bg-[#F6FAF8] transition">
                          <ExternalLink size={12} /> PDF 원문
                        </a>
                      )}
                      {focusedSavedRow && (
                        <button type="button" onClick={() => void deleteSaved(focusedSavedRow.id, focusedSavedRow.url)}
                          className="rounded-md border border-red-200 px-2.5 py-1.5 text-[12px] font-medium text-red-500 hover:bg-red-50 transition">
                          삭제
                        </button>
                      )}
                      <button type="button" onClick={closeModal}
                        className="rounded-md border border-[#DDE8E5] p-1.5 text-[#94A8A0] hover:bg-[#F6FAF8] transition">
                        <X size={13} />
                      </button>
                    </div>
                  </div>
                </div>
                <div className="flex-1 space-y-4 px-5 py-5">
                  <TagEditSection
                    companies={focusedSavedRow?.company_tags ?? []}
                    topics={focusedSavedRow?.topic_tags ?? []}
                    macro={focusedSavedRow?.macro_tags ?? []}
                    readOnly
                  />
                  {focusedSavedRow?.notes?.trim() ? (
                    <div>
                      <label className="mb-1.5 block text-[11px] font-bold uppercase tracking-wide text-[#94A8A0]">정리</label>
                      <p className="whitespace-pre-wrap text-[17px] leading-relaxed text-[#33493F]">{focusedSavedRow.notes}</p>
                    </div>
                  ) : focusedSavedRow?.ai_summary ? (
                    <div>
                      <label className="mb-1.5 block text-[11px] font-bold uppercase tracking-wide text-[#94A8A0]">AI 요약</label>
                      <div className="rounded-btn border border-[#E8F0ED] bg-[#F6FAF8] p-4 text-[17px]"
                        dangerouslySetInnerHTML={{ __html: renderSummaryMarkdown(focusedSavedRow.ai_summary) }} />
                    </div>
                  ) : (
                    <p className="text-sm font-semibold text-[#94A8A0]">저장된 내용이 없습니다.</p>
                  )}
                </div>
              </div>
            ) : (
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
              {/* 헤더 */}
              <div className="border-b border-[#E8F0ED] bg-white px-5 py-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    {isEditing ? (
                      <div className="flex flex-col gap-2 w-full mt-1">
                        <div className="flex flex-wrap items-center gap-2 text-[11px] font-semibold text-[#94A8A0]">
                          <span>{CATEGORY_LABEL[focused.category] ?? focused.category}</span>
                          <span>·</span>
                          <input
                            type="text"
                            value={detail.broker}
                            onChange={(e) => setDetail((d) => ({ ...d, broker: e.target.value, saved: false }))}
                            className="bg-white border border-[#DDE8E5] rounded px-2 py-0.5 focus:border-primary focus:outline-none text-[#5F7A70] text-[11px] font-semibold"
                            placeholder="발행기관"
                          />
                          <span>·</span>
                          <input
                            type="text"
                            value={detail.date}
                            onChange={(e) => setDetail((d) => ({ ...d, date: e.target.value, saved: false }))}
                            className="w-28 bg-white border border-[#DDE8E5] rounded px-2 py-0.5 focus:border-primary focus:outline-none text-[#5F7A70] text-[11px] font-semibold"
                            placeholder="발행일(yyyy-mm-dd)"
                          />
                          {focused.itemName && (
                            <>
                              <span>·</span>
                              <span>{focused.itemName}</span>
                            </>
                          )}
                        </div>
                        <input
                          type="text"
                          value={detail.title}
                          onChange={(e) => setDetail((d) => ({ ...d, title: e.target.value, saved: false }))}
                          className="w-full bg-white border border-[#DDE8E5] rounded px-3 py-1.5 text-[14px] font-bold text-[#0D2318] focus:border-primary focus:outline-none"
                          placeholder="리포트 제목"
                        />
                      </div>
                    ) : (
                      <>
                        <p className="text-[11px] font-semibold text-[#94A8A0]">
                          {CATEGORY_LABEL[focused.category] ?? focused.category} · {detail.broker || focused.broker} · {detail.date || focused.date}
                          {focused.itemName && ` · ${focused.itemName}`}
                        </p>
                        <h3 className="mt-0.5 text-[15px] font-black leading-snug text-[#0D2318]">{detail.title || focused.title}</h3>
                      </>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    <button type="button" onClick={() => void saveReport()} disabled={detail.saving || detail.saved}
                      className={`flex min-w-[64px] items-center justify-center gap-1 rounded-md px-2.5 py-1.5 text-[12px] font-semibold transition ${
                        detail.saving || detail.saved ? "cursor-default border border-[#DDE8E5] bg-[#EEF4F1] text-[#94A8A0]" : "bg-primary text-white hover:bg-primary-light"
                      }`}>
                      {detail.saving ? <Loader2 size={12} className="animate-spin" /> : detail.saved ? <Check size={12} /> : <Bookmark size={12} />}
                      {detail.saving ? "저장 중" : detail.saved ? "저장됨" : "저장"}
                    </button>
                    {focused.pdfUrl && (
                      <a href={focused.pdfUrl} target="_blank" rel="noreferrer"
                        className="flex items-center gap-1 rounded-md border border-[#DDE8E5] px-2.5 py-1.5 text-[12px] font-semibold text-[#5F7A70] hover:bg-[#F6FAF8] transition">
                        <ExternalLink size={12} /> 원본
                      </a>
                    )}
                    <button type="button" onClick={closeModal}
                      className="rounded-md border border-[#DDE8E5] p-1.5 text-[#94A8A0] hover:bg-[#F6FAF8] transition">
                      <X size={13} />
                    </button>
                  </div>
                </div>
              </div>

              {/* 본문 (두 컬럼 레이아웃) */}
              <div className="flex flex-1 overflow-hidden min-h-0">
                {/* Left Panel: 원문 및 태그/요약 (스크롤 영역) */}
                <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4 border-r border-[#E8F0ED]">
                {/* 태그 (Company/Topic 줄바꿈 구분 + 추가) */}
                <TagEditSection
                  companies={detail.companies}
                  topics={detail.topics}
                  macro={detail.macro}
                  loading={detail.loadingTags}
                  onCompaniesChange={(next) => setDetail((d) => ({ ...d, companies: next, saved: false }))}
                  onTopicsChange={(next) => setDetail((d) => ({ ...d, topics: next, saved: false }))}
                  onMacroChange={(next) => setDetail((d) => ({ ...d, macro: next, saved: false }))}
                />

                {/* 원문/요약 토글 + 모델 선택 */}
                <div className="flex flex-wrap items-center justify-between gap-2">
                  {!focused.detailUrl.startsWith("upload://") ? (
                    <div className="flex rounded-btn bg-[#F0F5F4] p-1">
                      <button type="button" onClick={() => setDetail((d) => ({ ...d, view: "summary" }))}
                        className={`flex items-center gap-1 rounded-lg px-3 py-1.5 text-[11px] font-bold transition ${detail.view === "summary" ? "bg-primary text-white" : "text-[#4B6358]"}`}>
                        <Sparkles size={11} /> AI 요약
                      </button>
                      <button type="button" onClick={() => setDetail((d) => ({ ...d, view: "original" }))}
                        className={`rounded-lg px-3 py-1.5 text-[11px] font-bold transition ${detail.view === "original" ? "bg-primary text-white" : "text-[#4B6358]"}`}>
                        원문 요지
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-1 rounded-lg px-3 py-1.5 text-[11px] font-bold bg-primary text-white">
                      <Sparkles size={11} /> AI 요약
                    </div>
                  )}
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => setIsEditing(!isEditing)}
                      className={`px-2.5 py-1.5 text-[11px] font-bold rounded-md border border-[#DDE8E5] transition hover:bg-[#F6FAF8] ${isEditing ? "bg-primary text-white hover:bg-primary-light" : "text-[#5F7A70]"}`}
                    >
                      {isEditing ? "수정 완료 (보기)" : "수정하기"}
                    </button>
                    {focused.pdfUrl && !detail.loadingSummary && (
                      <button type="button" onClick={() => requestSummary(focused)}
                        className="rounded-md border border-[#DDE8E5] px-2.5 py-1.5 text-[11px] font-semibold text-[#5F7A70] hover:bg-[#F6FAF8] transition">
                        다시 요약
                      </button>
                    )}
                  </div>
                </div>

                {/* 본문 */}
                <div className="h-auto rounded-btn border border-[#E8F0ED] bg-[#F6FAF8] p-4">
                  {detail.view === "summary" ? (
                    detail.loadingSummary ? (
                      <p className="flex items-center gap-2 text-sm font-bold text-[#94A8A0]"><Loader2 size={14} className="animate-spin" /> Gemini가 PDF를 요약하는 중… (최대 1분)</p>
                    ) : isEditing ? (
                      <textarea
                        value={detail.summary}
                        onChange={(e) => setDetail((d) => ({ ...d, summary: e.target.value, saved: false }))}
                        className="w-full h-48 bg-transparent text-[14px] leading-relaxed text-[#33493F] placeholder:text-[#B9CCC4] focus:outline-none resize-y"
                        placeholder="요약 내용을 입력하세요..."
                      />
                    ) : detail.summary ? (
                      <div className="text-[17px]" dangerouslySetInnerHTML={{ __html: renderSummaryMarkdown(detail.summary) }} />
                    ) : (
                      <p className="text-sm font-semibold text-[#94A8A0]">
                        {detail.summaryError || (focused.pdfUrl ? "요약이 없습니다." : "PDF가 없는 리포트라 AI 요약을 만들 수 없습니다. 원문 요지를 확인하세요.")}
                      </p>
                    )
                  ) : detail.loadingText ? (
                    <p className="flex items-center gap-2 text-sm font-bold text-[#94A8A0]"><Loader2 size={14} className="animate-spin" /> 원문 불러오는 중…</p>
                  ) : isEditing ? (
                    <textarea
                      value={detail.text}
                      onChange={(e) => setDetail((d) => ({ ...d, text: e.target.value, saved: false }))}
                      className="w-full h-48 bg-transparent text-[14px] font-normal leading-relaxed text-[#33493F] placeholder:text-[#B9CCC4] focus:outline-none resize-y"
                      placeholder="원문 요지를 입력하세요..."
                    />
                  ) : detail.text ? (
                    <p className="whitespace-pre-wrap text-[17px] font-normal leading-relaxed text-[#33493F]">{detail.text}</p>
                  ) : (
                    <p className="text-sm font-semibold text-[#94A8A0]">원문 요지를 추출하지 못했습니다. PDF 원문을 확인하세요.</p>
                  )}
                </div>

                </div>

                {/* Right Panel: 메모장 정리 박스 */}
                <div className="w-[380px] shrink-0 bg-[#FCFDFD] p-5 flex flex-col min-h-0 border-l border-[#E8F0ED]">
                  <label className="mb-2 block text-[11px] font-bold uppercase tracking-wide text-[#94A8A0] flex items-center gap-1.5">
                    <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary"></span>
                    정리 노트
                  </label>
                  <textarea
                    value={detail.notes}
                    onChange={(e) => setDetail((d) => ({ ...d, notes: e.target.value, saved: false }))}
                    placeholder="리포트를 읽고 직접 정리한 내용을 입력하세요..."
                    className="w-full flex-1 resize-none rounded-lg border border-[#DDE8E5] bg-white p-4 text-[13px] font-semibold text-[#33493F] placeholder:text-[#B9CCC4] focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/30 shadow-inner"
                    style={{
                      backgroundImage: "linear-gradient(rgba(0, 91, 82, 0.08) 1px, transparent 1px)",
                      backgroundSize: "100% 28px",
                      lineHeight: "28px",
                      paddingTop: "6px"
                    }}
                  />
                </div>
              </div>
            </div>
            )}
          </div>
        </div>
      , document.body)}
      {showUploadModal && selectedFile && mounted && createPortal(
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4" onClick={() => { setShowUploadModal(false); setSelectedFile(null); }}>
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-2xl border border-[#E8F0ED] flex flex-col gap-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between">
              <div>
                <h4 className="text-[16px] font-black text-[#0D2318]">PDF 요약 방식 선택</h4>
                <p className="mt-1 text-[12px] font-medium text-[#94A8A0] truncate max-w-[320px]">
                  선택된 파일: {selectedFile.name}
                </p>
              </div>
              <button type="button" onClick={() => { setShowUploadModal(false); setSelectedFile(null); }}
                className="rounded-md border border-[#DDE8E5] p-1 text-[#94A8A0] hover:bg-[#F6FAF8] transition">
                <X size={13} />
              </button>
            </div>

            <div className="flex flex-col gap-3 mt-2">
              <button
                type="button"
                onClick={() => {
                  setShowUploadModal(false);
                  if (selectedFile) void uploadPdf(selectedFile, "full");
                  setSelectedFile(null);
                }}
                className="group flex items-start gap-3 rounded-lg border border-[#DDE8E5] p-4 text-left transition hover:border-[#005B52] hover:bg-[#F6FAF8]"
              >
                <div className="mt-0.5 rounded-md bg-[#EEF4F1] p-2 text-[#005B52] group-hover:bg-[#005B52] group-hover:text-white transition">
                  <Sparkles size={16} />
                </div>
                <div>
                  <div className="text-[14px] font-bold text-[#1C3329]">전체 요약</div>
                  <div className="text-[12px] font-semibold text-[#5F7A70] mt-0.5">PDF 전문을 읽고 요약, 주요 수치, 투자 포인트를 생성합니다.</div>
                </div>
              </button>

              <button
                type="button"
                onClick={() => {
                  setShowUploadModal(false);
                  if (selectedFile) void uploadPdf(selectedFile, "highlights");
                  setSelectedFile(null);
                }}
                className="group flex items-start gap-3 rounded-lg border border-[#DDE8E5] p-4 text-left transition hover:border-[#005B52] hover:bg-[#F6FAF8]"
              >
                <div className="mt-0.5 rounded-md bg-[#EEF4F1] p-2 text-[#005B52] group-hover:bg-[#005B52] group-hover:text-white transition">
                  <Bookmark size={16} />
                </div>
                <div>
                  <div className="text-[14px] font-bold text-[#1C3329]">하이라이트 요약</div>
                  <div className="text-[12px] font-semibold text-[#5F7A70] mt-0.5">노란색 형광펜으로 표시된 텍스트만 추출합니다.</div>
                </div>
              </button>
            </div>
          </div>
        </div>
      , document.body)}

      </div>

      <AiLimitModal open={limitGuard.open} onClose={limitGuard.close} onSelect={limitGuard.onSelect} />
    </div>
  );
}
