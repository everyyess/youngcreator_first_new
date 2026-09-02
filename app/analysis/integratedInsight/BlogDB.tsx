"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { createPortal } from "react-dom";
import { Bookmark, BookOpen, Check, ExternalLink, Folder, Inbox, Info, Loader2, MessageSquare, Minus, Plus, Sparkles, X } from "lucide-react";
import {
  AiLimitModal, EdgeSidebarPanel, SavedFilterBar, SavedListRow, SearchDateBar, inDateRange,
  isQuotaExceededMessage, recordAiUsage, useAiLimitGuard, useAiModel, useFolderStore,
  type EdgeListItem,
} from "./shared";

const SidebarToggleIcon = ({ size = 18 }: { size?: number }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <rect width="18" height="18" x="3" y="3" rx="2" />
    <path d="M9 3v18" />
  </svg>
);

type LatestPost = {
  feedUrl: string;
  feedName: string;
  postUrl: string;
  title: string;
  publishedAt: string;
};

/** /api/blog-search(네이버 오픈API 블로그검색) 응답 항목 */
type NaverBlogSearchPost = {
  title: string;
  url: string;
  bloggerName: string;
  description: string;
  postedAt: string;
};

// ── Types ──────────────────────────────────────────────────────────────────

type BlogSummary = {
  id: string;
  post_url: string;
  title: string;
  feed_name: string;
  feed_url: string;
  summary: string;
  companies: string[];
  topics: string[];
  macro: string[];
  notes: string;
  date: string;
  created_at: string;
};

type BlogFeed = {
  id: string;
  feed_url: string;
  feed_name: string;
  site_url: string;
  thumbnail_url: string;
  created_at: string;
};

type SummarizeStep = "idle" | "fetching" | "summarizing" | "done" | "error";

// ── Minimal Markdown renderer ──────────────────────────────────────────────

function renderMarkdown(text: string): string {
  const lines = text.split("\n");
  const out: string[] = [];
  for (const raw of lines) {
    const line = raw
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
    const inlineBold = (s: string) => s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");

    if (line.startsWith("## "))
      out.push(`<h3 class="font-bold text-[#005B52] text-[17px] mt-4 mb-1">${inlineBold(line.slice(3))}</h3>`);
    else if (line.startsWith("**") && line.endsWith("**") && line.length > 4)
      out.push(`<p class="font-semibold text-[#33493F] text-[17px] mt-2">${line.slice(2, -2)}</p>`);
    else if (line.startsWith("- "))
      out.push(`<li class="ml-4 text-[17px] text-[#33493F] list-disc">${inlineBold(line.slice(2))}</li>`);
    else if (line.trim() === "---")
      out.push(`<hr class="border-[#DDE8E5] my-3" />`);
    else if (line.trim() === "")
      out.push(`<div class="h-1"></div>`);
    else
      out.push(`<p class="text-[17px] text-[#33493F]">${inlineBold(line)}</p>`);
  }
  return out.join("\n");
}

function MarkdownView({ text, className = "" }: { text: string; className?: string }) {
  return (
    <div
      className={className}
      dangerouslySetInnerHTML={{ __html: renderMarkdown(text) }}
    />
  );
}

// ── Tag chips ──────────────────────────────────────────────────────────────

function TagChip({
  label,
  onRemove,
  color = "green",
}: {
  label: string;
  onRemove?: () => void;
  color?: "blue" | "green" | "amber" | "slate";
}) {
  // TAB4 공통 색상: Company=파랑, Topic=초록, Macro=노랑
  const base =
    color === "blue"
      ? "bg-blue-50 text-blue-700 border-blue-200"
      : color === "green"
        ? "bg-emerald-50 text-emerald-700 border-emerald-200"
        : color === "amber"
          ? "bg-amber-50 text-amber-700 border-amber-200"
          : "bg-[#EEF4F1] text-[#4B6358] border-[#DDE8E5]";
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium ${base}`}>
      {label}
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          className="ml-0.5 opacity-60 hover:opacity-100"
          aria-label={`${label} 제거`}
        >
          ×
        </button>
      )}
    </span>
  );
}

function TagInput({
  tags,
  onChange,
  suggestions,
  color,
  placeholder,
  fixedTag,
}: {
  tags: string[];
  onChange: (tags: string[]) => void;
  suggestions: string[];
  color: "blue" | "green" | "amber";
  placeholder: string;
  fixedTag?: string;
}) {
  const [input, setInput] = useState("");
  const [showSugg, setShowSugg] = useState(false);

  const filtered = suggestions
    .filter(s => !tags.includes(s) && s.toLowerCase().includes(input.toLowerCase()))
    .slice(0, 8);

  function add(tag: string) {
    const trimmed = tag.trim();
    if (trimmed && !tags.includes(trimmed)) onChange([...tags, trimmed]);
    setInput("");
    setShowSugg(false);
  }

  const focusBorder = color === "blue" ? "focus:border-blue-400" : color === "amber" ? "focus:border-amber-400" : "focus:border-emerald-400";

  return (
    <div className="flex flex-wrap items-center gap-2">
      {tags.map(t => (
        <TagChip
          key={t}
          label={t}
          color={color}
          onRemove={t !== fixedTag ? () => onChange(tags.filter(x => x !== t)) : undefined}
        />
      ))}
      <div className="relative">
        <input
          type="text"
          value={input}
          onChange={e => { setInput(e.target.value); setShowSugg(true); }}
          onKeyDown={e => {
            if ((e.key === "Enter" || e.key === ",") && input.trim()) {
              e.preventDefault();
              add(input);
            }
          }}
          onFocus={() => setShowSugg(true)}
          onBlur={() => setTimeout(() => setShowSugg(false), 150)}
          placeholder={placeholder}
          className={`w-24 rounded-full border border-dashed border-[#C5D6D0] px-2.5 py-1 text-[12px] text-[#5F7A70] placeholder:text-[#94A8A0] focus:outline-none ${focusBorder}`}
        />
        {showSugg && filtered.length > 0 && (
          <div className="absolute left-0 top-full z-10 mt-1 max-h-44 overflow-y-auto rounded-lg border border-[#DDE8E5] bg-white shadow-lg">
            {filtered.map(s => (
              <button
                key={s}
                type="button"
                className="block w-full px-3 py-1.5 text-left text-xs text-[#33493F] hover:bg-[#F6FAF8]"
                onMouseDown={() => add(s)}
              >
                {s}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Relative date ──────────────────────────────────────────────────────────

/** blog.naver.com/{blogId}(/...) 또는 rss.blog.naver.com/{blogId}.xml 에서 blogId 추출. 네이버 블로그가 아니면 null */
function naverBlogId(rawUrl: string): string | null {
  try {
    const u = new URL(rawUrl);
    if (!/(^|\.)blog\.naver\.com$/.test(u.hostname)) return null;
    const m = u.pathname.match(/^\/([^/.]+)/);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

function relativeDate(iso: string): string {
  if (!iso) return "";
  const diff = Date.now() - new Date(iso).getTime();
  const d = Math.floor(diff / 86400000);
  if (d === 0) return "오늘";
  if (d === 1) return "어제";
  if (d < 7) return `${d}일 전`;
  if (d < 30) return `${Math.floor(d / 7)}주 전`;
  if (d < 365) return `${Math.floor(d / 30)}개월 전`;
  return `${Math.floor(d / 365)}년 전`;
}

// ── API helpers (서버 라우트 경유 — PostgREST 캐시 우회) ───────────────────

async function loadSummaries(): Promise<BlogSummary[]> {
  try {
    const res = await fetch("/api/blog-db/summaries");
    if (!res.ok) { console.error("[blog_summaries] load:", await res.text()); return []; }
    const { summaries } = await res.json() as { summaries: BlogSummary[] };
    return summaries ?? [];
  } catch (e) { console.error("[blog_summaries] load:", e); return []; }
}

/** 날짜와 무관하게 저장된 게시글 URL 전체 — 피드 목록의 "저장됨" 태그 판정용 */
async function loadAllSavedPostUrls(): Promise<Set<string>> {
  try {
    const res = await fetch("/api/blog-db/summaries?scope=all");
    if (!res.ok) return new Set();
    const { postUrls } = await res.json() as { postUrls?: string[] };
    return new Set(postUrls ?? []);
  } catch (e) { console.error("[blog_summaries] load all:", e); return new Set(); }
}

async function saveSummary(row: Omit<BlogSummary, "id" | "created_at"> & { notes?: string }): Promise<{ data: BlogSummary | null; error: string | null }> {
  try {
    const res = await fetch("/api/blog-db/summaries", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(row),
    });
    const json = await res.json() as { summary?: BlogSummary; error?: string };
    if (!res.ok) return { data: null, error: json.error ?? "저장 실패" };
    return { data: json.summary ?? null, error: null };
  } catch (e) { return { data: null, error: String(e) }; }
}

async function deleteSummary(id: string): Promise<void> {
  await fetch("/api/blog-db/summaries", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id }),
  });
}

async function loadFeeds(): Promise<BlogFeed[]> {
  try {
    const res = await fetch("/api/blog-db/feeds");
    if (!res.ok) { console.error("[blog_feeds] load:", await res.text()); return []; }
    const { feeds } = await res.json() as { feeds: BlogFeed[] };
    return feeds ?? [];
  } catch (e) { console.error("[blog_feeds] load:", e); return []; }
}

async function saveFeed(f: Omit<BlogFeed, "id" | "created_at">): Promise<{ data: BlogFeed | null; error: string | null }> {
  try {
    const res = await fetch("/api/blog-db/feeds", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(f),
    });
    const json = await res.json() as { feed?: BlogFeed; error?: string };
    if (!res.ok) return { data: null, error: json.error ?? "저장 실패" };
    return { data: json.feed ?? null, error: null };
  } catch (e) { return { data: null, error: String(e) }; }
}

async function deleteFeed(feedUrl: string): Promise<void> {
  await fetch("/api/blog-db/feeds", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ feed_url: feedUrl }),
  });
}

// ── Panel: 게시글 요약 (수동) ────────────────────────────────────────────────

function SummarizePanel({
  onSaved,
  allCompanies,
  allTopics,
  allMacro,
}: {
  onSaved: () => void;
  allCompanies: string[];
  allTopics: string[];
  allMacro: string[];
}) {
  const [url, setUrl] = useState("");
  const [contentInput, setContentInput] = useState("");
  const [step, setStep] = useState<SummarizeStep>("idle");
  const [statusMsg, setStatusMsg] = useState("");

  const [title, setTitle] = useState("");
  const [feedName, setFeedName] = useState("");
  const [fetchedContent, setFetchedContent] = useState("");
  const [summaryText, setSummaryText] = useState("");
  const [companies, setCompanies] = useState<string[]>([]);
  const [topics, setTopics] = useState<string[]>([]);
  const [macro, setMacro] = useState<string[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [aiModel, setAiModel] = useAiModel();
  const limitGuard = useAiLimitGuard(setAiModel);

  async function runSummarize(manualContent?: string) {
    setSaveError("");
    setStep("fetching");
    setStatusMsg("게시글 본문 가져오는 중...");

    let finalContent = manualContent ?? contentInput;
    let finalTitle = title;
    let finalFeedName = feedName;

    if (!finalContent) {
      try {
        const res = await fetch(`/api/blog-content?url=${encodeURIComponent(url)}`);
        const data = (await res.json()) as {
          content?: string;
          title?: string;
          siteName?: string;
          error?: string;
        };
        if (data.content) {
          finalContent = data.content;
          if (data.title) { finalTitle = data.title; setTitle(data.title); }
          if (data.siteName) { finalFeedName = data.siteName; setFeedName(data.siteName); }
        } else {
          setStep("error");
          setStatusMsg(data.error ?? "본문을 가져올 수 없습니다. 본문을 직접 붙여넣어 주세요.");
          return;
        }
      } catch (e) {
        setStep("error");
        setStatusMsg(`본문 오류: ${e instanceof Error ? e.message : "알 수 없는 오류"}`);
        return;
      }
    }

    setFetchedContent(finalContent);
    setStep("summarizing");
    setStatusMsg("AI 요약 중... (최대 60초 소요)");

    try {
      const res = await fetch("/api/blog-summarize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content: finalContent,
          title: finalTitle || url,
          feedName: finalFeedName,
          postUrl: url,
          existingCompanies: allCompanies,
          existingTopics: allTopics,
          existingMacro: allMacro,
          model: aiModel,
        }),
      });
      const data = (await res.json()) as { summary?: string; companies?: string[]; topics?: string[]; macro?: string[]; error?: string };
      if (!res.ok || data.error) {
        if (isQuotaExceededMessage(data.error)) {
          limitGuard.trigger(() => void runSummarize(manualContent));
          setStep("idle");
          return;
        }
        setStep("error");
        setStatusMsg(data.error ?? "요약 실패");
        return;
      }
      recordAiUsage(aiModel);
      setSummaryText(data.summary ?? "");
      setCompanies(data.companies ?? []);
      setTopics(data.topics ?? []);
      setMacro(data.macro ?? []);
      setTitle(finalTitle || title || url);
      setFeedName(finalFeedName || feedName);
      setStep("done");
      setStatusMsg("");
    } catch (e) {
      setStep("error");
      setStatusMsg(`요약 오류: ${e instanceof Error ? e.message : "알 수 없는 오류"}`);
    }
  }

  async function handleSave() {
    if (!summaryText || isSaving) return;
    setIsSaving(true);
    setSaveError("");
    try {
      const { data: result, error: saveErr } = await saveSummary({
        post_url: url,
        title: title || url,
        feed_name: feedName,
        feed_url: "",
        summary: summaryText,
        companies,
        topics,
        macro,
        notes: "",
        date: new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10),
      });
      if (saveErr || !result) {
        setSaveError(saveErr ?? "저장 실패: Supabase 연결 확인");
        return;
      }
      onSaved();
      // Reset
      setUrl(""); setContentInput(""); setSummaryText(""); setCompanies([]); setTopics([]); setMacro([]);
      setTitle(""); setFeedName(""); setFetchedContent("");
      setStep("idle");
    } catch (e) {
      setSaveError(`저장 오류: ${e instanceof Error ? e.message : "알 수 없는 오류"}`);
    } finally {
      setIsSaving(false);
    }
  }

  const isWorking = step === "fetching" || step === "summarizing";

  return (
    <div className="flex flex-col gap-4">
      {/* URL input */}
      <div className="flex flex-col gap-2">
        <label className="text-xs font-semibold text-[#5F7A70] uppercase tracking-wide">블로그 게시글 URL</label>
        <div className="flex gap-2">
          <input
            value={url}
            onChange={e => setUrl(e.target.value)}
            placeholder="https://blog.example.com/post/..."
            className="flex-1 rounded-md border border-[#DDE8E5] bg-white px-3 py-2 text-sm outline-none focus:border-[#005B52] focus:ring-1 focus:ring-[#005B52]"
            disabled={isWorking}
            onKeyDown={e => e.key === "Enter" && !isWorking && url && runSummarize()}
          />
          <button
            type="button"
            onClick={() => runSummarize()}
            disabled={!url || isWorking}
            className="shrink-0 rounded-md bg-[#005B52] px-4 py-2 text-sm font-semibold text-white disabled:opacity-40 hover:bg-[#155a3e] transition-colors"
          >
            {isWorking ? "처리 중..." : "요약하기"}
          </button>
          <button
            type="button"
            onClick={() => {
              setUrl(""); setContentInput(""); setSummaryText(""); setCompanies([]); setTopics([]); setMacro([]);
              setTitle(""); setFeedName(""); setFetchedContent(""); setStep("idle"); setSaveError("");
            }}
            disabled={isWorking}
            className="shrink-0 rounded-md border border-[#DDE8E5] px-4 py-2 text-sm font-semibold text-[#5F7A70] hover:bg-[#F6FAF8] disabled:opacity-40 transition-colors"
          >
            초기화
          </button>
        </div>

        <div className="flex flex-col gap-2">
          <textarea
            value={contentInput}
            onChange={e => setContentInput(e.target.value)}
            rows={6}
            placeholder="블로그 게시글 본문을 붙여넣으세요..."
            className="w-full rounded-md border border-[#DDE8E5] bg-white px-3 py-2 text-sm outline-none resize-y focus:border-[#005B52] focus:ring-1 focus:ring-[#005B52]"
          />
          <button
            type="button"
            onClick={() => runSummarize(contentInput)}
            disabled={!contentInput.trim() || isWorking}
            className="self-end rounded-md bg-[#005B52] px-4 py-2 text-sm font-semibold text-white disabled:opacity-40 hover:bg-[#155a3e]"
          >
            본문으로 요약하기
          </button>
        </div>
      </div>

      {/* Status */}
      {(isWorking || step === "error") && (
        <div className={`rounded-md px-4 py-3 text-sm ${step === "error" ? "bg-red-50 text-red-700 border border-red-200" : "bg-blue-50 text-blue-700 border border-blue-100"}`}>
          {isWorking && <span className="mr-2 animate-spin inline-block">⟳</span>}
          {statusMsg}
        </div>
      )}

      {/* Result */}
      {step === "done" && summaryText && (
        <div className="flex flex-col gap-4 border-t border-[#E8F0ED] pt-4">
          {/* Meta */}
          <div>
            <div className="flex flex-col gap-1 min-w-0">
              <input
                value={title}
                onChange={e => setTitle(e.target.value)}
                className="font-semibold text-[#1C3329] text-sm border-b border-transparent hover:border-[#DDE8E5] focus:border-[#005B52] outline-none bg-transparent w-full"
                placeholder="게시글 제목"
              />
              <input
                value={feedName}
                onChange={e => setFeedName(e.target.value)}
                className="text-xs text-[#5F7A70] border-b border-transparent hover:border-[#DDE8E5] focus:border-[#005B52] outline-none bg-transparent w-full"
                placeholder="블로그명"
              />
              {url && (
                <a href={url} target="_blank" rel="noopener noreferrer" className="text-xs text-[#005B52] hover:underline truncate">
                  {url}
                </a>
              )}
            </div>
          </div>

          {/* 게시글 원문 */}
          {fetchedContent && (
            <div>
              <div className="mb-1.5 flex items-center gap-2">
                <span className="text-xs font-semibold text-[#5F7A70] uppercase tracking-wide">게시글 원문</span>
              </div>
              <div className="rounded-md border border-[#DDE8E5] bg-[#F6FAF8] px-3.5 py-3 max-h-64 overflow-y-auto">
                <p className="whitespace-pre-line text-[14px] leading-relaxed text-[#4B6358]">{fetchedContent}</p>
              </div>
            </div>
          )}

          {/* Tags */}
          <div className="flex flex-col gap-3">
            <div>
              <div className="mb-1.5 flex items-center gap-2">
                <span className="text-xs font-semibold text-[#5F7A70] uppercase tracking-wide">Company 태그</span>
              </div>
              <TagInput
                tags={companies}
                onChange={setCompanies}
                suggestions={allCompanies}
                color="blue"
                placeholder="+ 기업명"
              />
            </div>
            <div>
              <div className="mb-1.5 flex items-center gap-2">
                <span className="text-xs font-semibold text-[#5F7A70] uppercase tracking-wide">Topic 태그</span>
              </div>
              <TagInput
                tags={topics}
                onChange={setTopics}
                suggestions={allTopics}
                color="green"
                placeholder="+ 태그"
              />
            </div>
            <div>
              <div className="mb-1.5 flex items-center gap-2">
                <span className="text-xs font-semibold text-[#5F7A70] uppercase tracking-wide">Macro 태그</span>
              </div>
              <TagInput
                tags={macro}
                onChange={setMacro}
                suggestions={allMacro}
                color="amber"
                placeholder="+ 매크로"
              />
            </div>
          </div>

          {/* Summary */}
          <div className="rounded-md border border-[#E8F0ED] bg-[#F6FAF8] p-4 max-h-[640px] overflow-y-auto">
            <MarkdownView text={summaryText} />
          </div>

          {saveError && <p className="text-xs text-red-600">{saveError}</p>}

          <div className="flex justify-end">
            <button
              type="button"
              onClick={handleSave}
              disabled={isSaving}
              className="rounded-md bg-[#005B52] px-6 py-2 text-sm font-semibold text-white disabled:opacity-40 hover:bg-[#155a3e] transition-colors"
            >
              {isSaving ? "저장 중..." : "✓ Supabase에 저장"}
            </button>
          </div>
        </div>
      )}

      <AiLimitModal open={limitGuard.open} onClose={limitGuard.close} onSelect={limitGuard.onSelect} />
    </div>
  );
}

// ── Panel: 저장 목록 ───────────────────────────────────────────────────────

function HistoryPanel({ summaries, onDelete }: { summaries: BlogSummary[]; onDelete: (id: string) => void }) {
  const [search, setSearch] = useState("");
  const [filterCompany, setFilterCompany] = useState<string>("");
  const [filterTopic, setFilterTopic] = useState<string>("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [selected, setSelected] = useState<BlogSummary | null>(null);
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  const allCompanies = [...new Set(summaries.flatMap(s => s.companies))].sort();
  const allTopics = [...new Set(summaries.flatMap(s => s.topics))].sort();

  const filtered = summaries.filter(s => {
    if (search && !s.title.toLowerCase().includes(search.toLowerCase()) && !s.feed_name.toLowerCase().includes(search.toLowerCase())) return false;
    if (filterCompany && !s.companies.includes(filterCompany)) return false;
    if (filterTopic && !s.topics.includes(filterTopic)) return false;
    if (!inDateRange(s.date || s.created_at, fromDate, toDate)) return false;
    return true;
  });

  return (
    <div className="flex flex-col gap-3">
      <SavedFilterBar
        search={search} onSearch={setSearch}
        company={filterCompany} onCompany={setFilterCompany}
        topic={filterTopic} onTopic={setFilterTopic}
        allCompanies={allCompanies} allTopics={allTopics}
        fromDate={fromDate} onFromDate={setFromDate}
        toDate={toDate} onToDate={setToDate}
        placeholder="제목 또는 블로그명 검색..."
      />

      {filtered.length === 0 && (
        <p className="py-12 text-center text-sm text-[#94A8A0]">
          {summaries.length === 0 ? "저장된 요약이 없습니다. '직접 요약' 탭에서 시작하세요." : "검색 결과가 없습니다."}
        </p>
      )}

      <div className="overflow-hidden rounded-lg border border-[#E8F0ED]">
        {filtered.map((s, idx) => (
          <SavedListRow
            key={s.id}
            index={idx + 1}
            title={s.title}
            date={`${s.feed_name} · ${s.date}`}
            topics={s.topics}
            companies={s.companies}
            macro={s.macro}
            onClick={() => setSelected(s)}
            onDelete={() => onDelete(s.id)}
          />
        ))}
      </div>

      {/* 상세 팝업 */}
      {selected && mounted && createPortal(
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4 sm:p-8"
          onClick={() => setSelected(null)}
        >
          <div
            className="flex max-h-[85vh] w-full max-w-5xl flex-col overflow-hidden rounded-xl bg-white shadow-2xl"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex flex-1 flex-col overflow-y-auto">
              {/* 헤더 */}
              <div className="sticky top-0 z-10 border-b border-[#E8F0ED] bg-white px-5 py-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-[11px] font-medium text-[#94A8A0]">
                      {selected.feed_name} · {selected.date}
                    </p>
                    <p className="mt-1 text-[15px] font-bold leading-snug text-[#1C3329]">
                      {selected.title}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    <a
                      href={selected.post_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1 rounded-md border border-[#DDE8E5] px-2.5 py-1.5 text-[12px] font-medium text-[#5F7A70] hover:bg-[#F6FAF8] transition"
                    >
                      <ExternalLink size={12} />
                      원본
                    </a>
                    <button
                      type="button"
                      onClick={() => { onDelete(selected.id); setSelected(null); }}
                      className="flex items-center gap-1 rounded-md border border-red-200 px-2.5 py-1.5 text-[12px] font-medium text-red-400 hover:bg-red-50 hover:text-red-600 transition"
                    >
                      삭제
                    </button>
                    <button
                      type="button"
                      onClick={() => setSelected(null)}
                      className="rounded-md border border-[#DDE8E5] p-1.5 text-[#94A8A0] hover:bg-[#F6FAF8] transition"
                    >
                      <X size={13} />
                    </button>
                  </div>
                </div>
              </div>

              {/* 본문 */}
              <div className="flex-1 px-5 py-4 space-y-4">
                {/* Topic 태그 */}
                <div>
                  <label className="mb-2 block text-[11px] font-semibold uppercase tracking-wide text-[#94A8A0]">Topic 태그</label>
                  <div className="flex flex-wrap gap-1.5">
                    {selected.topics.map(t => <TagChip key={t} label={t} color="green" />)}
                  </div>
                </div>

                {/* Company 태그 */}
                <div>
                  <label className="mb-2 block text-[11px] font-semibold uppercase tracking-wide text-[#94A8A0]">Company 태그</label>
                  <div className="flex flex-wrap gap-1.5">
                    {selected.companies.length > 0
                      ? selected.companies.map(c => <TagChip key={c} label={c} color="blue" />)
                      : <span className="text-[12px] text-[#94A8A0]">없음</span>}
                  </div>
                </div>

                {/* Macro 태그 */}
                {selected.macro.length > 0 && (
                  <div>
                    <label className="mb-2 block text-[11px] font-semibold uppercase tracking-wide text-[#94A8A0]">Macro 태그</label>
                    <div className="flex flex-wrap gap-1.5">
                      {selected.macro.map(m => <TagChip key={m} label={m} color="amber" />)}
                    </div>
                  </div>
                )}

                {/* 정리 */}
                {selected.notes && (
                  <div>
                    <label className="mb-2 block text-[11px] font-semibold uppercase tracking-wide text-[#94A8A0]">정리</label>
                    <p className="whitespace-pre-line text-[17px] leading-relaxed text-[#33493F]">{selected.notes}</p>
                  </div>
                )}

                {/* AI 요약 */}
                {selected.summary && (
                  <div>
                    <label className="mb-2 block text-[11px] font-semibold uppercase tracking-wide text-[#94A8A0]">AI 요약</label>
                    <div className="rounded-md border border-[#E8F0ED] bg-[#F6FAF8] p-4 h-auto">
                      <MarkdownView text={selected.summary} />
                    </div>
                  </div>
                )}

                {!selected.notes && !selected.summary && (
                  <p className="py-6 text-center text-sm text-[#94A8A0]">저장된 내용이 없습니다.</p>
                )}

              </div>
            </div>
          </div>
        </div>
      , document.body)}
    </div>
  );
}

// ── Panel: 구독한 블로그 게시글 ───────────────────────────────────────────────

type FeedEditState = {
  step: SummarizeStep;
  statusMsg: string;
  summary: string;
  companies: string[];
  topics: string[];
  macro: string[];
  notes: string;
  tagging: boolean;
  saving: boolean;
  saveError: string;
  saved: boolean;
  showContentInput: boolean;
  contentInput: string;
};

const FEED_DEPTH_DEFAULT = 10;
const FEED_DEPTH_STEP = 10;
const SEARCH_DEPTH_DEFAULT = 100;
const SEARCH_DEPTH_STEP = 100;

// RSS는 블로그가 피드에 노출한 최근 글(보통 수십 개, 네이버 블로그는 정확히 50개)까지만
// 볼 수 있어 perFeed를 아무리 늘려도 "전체 기간"에 닿지 못한다. 네이버 블로그 구독분은
// 네이버 오픈API 블로그검색(전체 기간 대상, 서버가 직접 필터링)으로 이를 보완한다 — 검색은
// blogId로 좁혀지지 않으므로 여러 페이지를 훑어 우리 구독 blogId만 걸러낸다.
const NAVER_SEARCH_DISPLAY = 100; // 네이버 API 1회 요청 최대치
const NAVER_SEARCH_PAGES = 3; // 페이지당 100건 × 3 = 최근 300건 범위에서 blogId 매칭

const FEED_EDIT_DEFAULT: FeedEditState = {
  step: "idle",
  statusMsg: "",
  summary: "",
  companies: [],
  topics: [],
  macro: [],
  notes: "",
  tagging: false,
  saving: false,
  saveError: "",
  saved: false,
  showContentInput: false,
  contentInput: "",
};

function LatestFeedPanel({
  feeds,
  savedPostUrls,
  allCompanies,
  allTopics,
  allMacro,
  onSaved,
  onFeedsChange,
}: {
  feeds: BlogFeed[];
  savedPostUrls: Set<string>;
  allCompanies: string[];
  allTopics: string[];
  allMacro: string[];
  onSaved: () => void;
  onFeedsChange: () => void;
}) {
  const [phase, setPhase] = useState<"idle" | "loading" | "list">("idle");

  // ── 폴더(Folder) 기능 상태 (Supabase 영속화) ─────────────────────────────
  const { folders, folderItems: folderFeeds, addFolder, deleteFolder, renameFolder, toggleItem: toggleFeedInFolder } = useFolderStore("/api/blog-db/folders");
  const [activeFolderId, setActiveFolderId] = useState<string>("all");
  const [isFolderModalOpen, setIsFolderModalOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [editingFolderId, setEditingFolderId] = useState<string>("core");

  // 폴더 이름 편집 상태
  const [editingFolderNameId, setEditingFolderNameId] = useState<string | null>(null);
  const [editingFolderNameValue, setEditingFolderNameValue] = useState<string>("");

  // 피드 추가 상태
  const [isAddFeedOpen, setIsAddFeedOpen] = useState(false);
  const [feedUrlInput, setFeedUrlInput] = useState("");
  const [feedNameInput, setFeedNameInput] = useState("");
  const [isAddingFeed, setIsAddingFeed] = useState(false);
  const [addFeedError, setAddFeedError] = useState("");

  // 사이드바 토글 상태
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);

  const handleAddFolder = async () => {
    const name = newFolderName.trim();
    if (!name) return;
    if (folders.some((f) => f.name === name)) {
      alert("이미 존재하는 폴더 이름입니다.");
      return;
    }
    const folder = await addFolder(name);
    setNewFolderName("");
    if (folder) setEditingFolderId(folder.id);
  };

  const handleDeleteFolder = (id: string) => {
    if (id === "all" || id === "core") return;
    if (!confirm("이 폴더를 삭제하시겠습니까? (폴더 안의 피드들은 삭제되지 않습니다)")) return;
    deleteFolder(id);
    if (activeFolderId === id) setActiveFolderId("all");
    if (editingFolderId === id) setEditingFolderId("core");
  };

  const handleRenameFolder = (id: string, newName: string) => {
    const trimmed = newName.trim();
    if (!trimmed) {
      setEditingFolderNameId(null);
      return;
    }
    if (folders.some((f) => f.id !== id && f.name === trimmed)) {
      alert("이미 존재하는 폴더 이름입니다.");
      return;
    }
    renameFolder(id, trimmed);
    setEditingFolderNameId(null);
  };

  const filteredFeeds = useMemo(() => {
    if (activeFolderId === "all") return feeds;
    const allowed = folderFeeds[activeFolderId] ?? [];
    return feeds.filter((f) => allowed.includes(f.feed_url));
  }, [feeds, activeFolderId, folderFeeds]);

  const handleAddFeedSubmit = async () => {
    const urlVal = feedUrlInput.trim();
    const nameVal = feedNameInput.trim();
    if (!urlVal || !nameVal) return;
    setIsAddingFeed(true);
    setAddFeedError("");
    const res = await handleAddFeed(urlVal, nameVal);
    setIsAddingFeed(false);
    if (res.ok) {
      setFeedUrlInput("");
      setFeedNameInput("");
      setIsAddFeedOpen(false);
    } else {
      setAddFeedError(res.error ?? "블로그 추가 실패");
    }
  };

  const [posts, setPosts] = useState<LatestPost[]>([]);
  const [error, setError] = useState("");
  const [focusedPostUrl, setFocusedPostUrl] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);
  const [edits, setEdits] = useState<Record<string, FeedEditState>>({});
  const [feedFilter, setFeedFilter] = useState<string | null>(null);
  const [contentCache, setContentCache] = useState<Record<string, { loading: boolean; text: string; error: string }>>({});
  const [keyword, setKeyword] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [aiModel, setAiModel] = useAiModel();
  const limitGuard = useAiLimitGuard(setAiModel);
  const [readUrls, setReadUrls] = useState<Set<string>>(() => {
    if (typeof window === "undefined") return new Set();
    try {
      const stored = localStorage.getItem("blog_read_urls");
      return new Set(stored ? (JSON.parse(stored) as string[]) : []);
    } catch { return new Set(); }
  });

  useEffect(() => {
    try { localStorage.setItem("blog_read_urls", JSON.stringify([...readUrls])); } catch {}
  }, [readUrls]);

  const [deletedPostUrls, setDeletedPostUrls] = useState<Set<string>>(new Set());

  useEffect(() => {
    fetch("/api/blog-db/deleted")
      .then((res) => res.json())
      .then((data: { deletedUrls?: string[] }) => {
        if (data.deletedUrls) setDeletedPostUrls(new Set(data.deletedUrls));
      })
      .catch(console.error);
  }, []);

  const [searching, setSearching] = useState(false);
  const [depth, setDepth] = useState(FEED_DEPTH_DEFAULT);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  // 화면에는 항상 20건 단위로만 노출 — 서버가 이미 더 많이 가져왔어도 더보기를 눌러야 다음 20건이 보인다
  const [visibleCount, setVisibleCount] = useState(20);

  const loadFeed = useCallback(async () => {
    if (feeds.length === 0) return;
    setPhase("loading");
    setError("");
    try {
      const res = await fetch("/api/blog-latest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          feeds: feeds.map(f => ({ feedUrl: f.feed_url, feedName: f.feed_name })),
          perFeed: FEED_DEPTH_DEFAULT,
        }),
      });
      const data = (await res.json()) as { posts?: LatestPost[]; error?: string };
      if (!res.ok) { setError(data.error ?? "최신 게시글 조회 실패"); setPhase("idle"); return; }
      setPosts(data.posts ?? []);
      setDepth(FEED_DEPTH_DEFAULT);
      setHasMore(true);
      setVisibleCount(20);
      setPhase("list");
    } catch (e) {
      setError(`오류: ${e instanceof Error ? e.message : "알 수 없는 오류"}`);
      setPhase("idle");
    }
  }, [feeds]);

  useEffect(() => { void loadFeed(); }, [loadFeed]);

  // ── 기간 지정 검색 — 최근 7일 제한 없이 지정 기간의 과거 게시글까지 조회 ──────
  const searchPastPosts = useCallback(async () => {
    if (feeds.length === 0 || (!fromDate && !toDate && !keyword.trim())) return;
    setSearching(true);
    setError("");
    try {
      const rssReq: Promise<{ posts?: LatestPost[]; error?: string }> = fetch("/api/blog-latest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          feeds: feeds.map(f => ({ feedUrl: f.feed_url, feedName: f.feed_name })),
          perFeed: SEARCH_DEPTH_DEFAULT,
          from: fromDate || undefined,
          to: toDate || undefined,
          keyword: keyword || undefined,
        }),
      }).then(r => r.json());

      // 구독 피드 중 네이버 블로그만 골라 blogId → feed 매핑을 만든다 (검색 결과 필터링용)
      const naverFeedsById = new Map<string, BlogFeed>();
      for (const f of feeds) {
        const id = naverBlogId(f.feed_url);
        if (id) naverFeedsById.set(id, f);
      }
      const trimmedKeyword = keyword.trim();
      const naverReq: Promise<NaverBlogSearchPost[]> =
        trimmedKeyword && naverFeedsById.size > 0
          ? Promise.all(
              Array.from({ length: NAVER_SEARCH_PAGES }, (_, i) =>
                fetch(
                  `/api/blog-search?query=${encodeURIComponent(trimmedKeyword)}&display=${NAVER_SEARCH_DISPLAY}&start=${i * NAVER_SEARCH_DISPLAY + 1}`,
                )
                  .then(r => (r.ok ? r.json() : { posts: [] }))
                  .catch(() => ({ posts: [] })) as Promise<{ posts?: NaverBlogSearchPost[] }>,
              ),
            ).then(pages => pages.flatMap(p => p.posts ?? []))
          : Promise.resolve([]);

      const [rssData, naverPosts] = await Promise.all([rssReq, naverReq]);
      if (!rssData.posts && rssData.error) { setError(rssData.error); return; }

      const naverMatches: LatestPost[] = naverPosts.flatMap(p => {
        const id = naverBlogId(p.url);
        const feed = id ? naverFeedsById.get(id) : undefined;
        if (!feed) return [];
        return [{
          feedUrl: feed.feed_url,
          feedName: feed.feed_name,
          postUrl: p.url,
          title: p.title,
          publishedAt: p.postedAt ? new Date(p.postedAt).toISOString() : "",
        }];
      });

      const merged = new Map<string, LatestPost>();
      for (const post of [...(rssData.posts ?? []), ...naverMatches]) merged.set(post.postUrl, post);
      setPosts([...merged.values()].sort((a, b) => (a.publishedAt < b.publishedAt ? 1 : -1)));
      setDepth(SEARCH_DEPTH_DEFAULT);
      setHasMore(true);
      setVisibleCount(20);
    } catch (e) {
      setError(`오류: ${e instanceof Error ? e.message : "알 수 없는 오류"}`);
    } finally {
      setSearching(false);
    }
  }, [feeds, fromDate, toDate, keyword]);

  // ── 더보기 — 화면에는 20건씩만 노출. 이미 불러온 데이터 중 안 보여준 분량이 있으면
  // 네트워크 요청 없이 노출만 늘리고, 다 보여줬다면 피드당 조회 깊이를 늘려 재조회한다 ──────
  async function handleLoadMorePosts() {
    if (feeds.length === 0 || loadingMore) return;
    const nextVisible = visibleCount + 20;
    if (nextVisible <= filteredPosts.length) {
      setVisibleCount(nextVisible);
      return;
    }
    if (!hasMore) { setVisibleCount(nextVisible); return; }
    setLoadingMore(true);
    const isSearch = Boolean(fromDate || toDate || keyword.trim());
    const nextDepth = depth + (isSearch ? SEARCH_DEPTH_STEP : FEED_DEPTH_STEP);
    try {
      const res = await fetch("/api/blog-latest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          feeds: feeds.map(f => ({ feedUrl: f.feed_url, feedName: f.feed_name })),
          perFeed: nextDepth,
          from: fromDate || undefined,
          to: toDate || undefined,
          keyword: keyword || undefined,
        }),
      });
      const data = (await res.json()) as { posts?: LatestPost[]; error?: string };
      if (res.ok) {
        // RSS 결과로 통째로 덮어쓰면 초기 검색 때 병합해둔 네이버 검색 매칭분이 사라지므로 병합한다
        const merged = new Map<string, LatestPost>();
        for (const post of [...posts, ...(data.posts ?? [])]) merged.set(post.postUrl, post);
        const mergedList = [...merged.values()].sort((a, b) => (a.publishedAt < b.publishedAt ? 1 : -1));
        setHasMore(mergedList.length > posts.length);
        setPosts(mergedList);
        setDepth(nextDepth);
      }
    } catch {
      /* 조용히 무시 — 버튼은 다시 누를 수 있음 */
    } finally {
      setVisibleCount(nextVisible);
      setLoadingMore(false);
    }
  }

  // 삭제된 피드가 선택돼 있으면 필터 해제
  useEffect(() => {
    if (feedFilter && !feeds.some(f => f.feed_url === feedFilter)) setFeedFilter(null);
  }, [feedFilter, feeds]);

  async function handleDeleteFeed(feedUrl: string) {
    await deleteFeed(feedUrl);
    onFeedsChange();
  }

  async function handleDeletePost(postUrl: string) {
    if (!confirm("이 블로그 기사를 삭제하시겠습니까?")) return;
    try {
      const res = await fetch("/api/blog-db/deleted", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: postUrl }),
      });
      if (!res.ok) throw new Error("삭제 실패");
      setDeletedPostUrls((prev) => new Set([...prev, postUrl]));
      if (focusedPostUrl === postUrl) setFocusedPostUrl(null);
    } catch {
      setError("블로그 기사 삭제 중 오류가 발생했습니다.");
    }
  }

  // ── 블로그 추가 (사이드 패널: URL + 표시 이름 입력 → Enter 저장) ───────────────
  async function handleAddFeed(feedUrl: string, feedName: string): Promise<{ ok: boolean; error?: string }> {
    const { data, error } = await saveFeed({ feed_url: feedUrl, feed_name: feedName, site_url: "", thumbnail_url: "" });
    if (error || !data) return { ok: false, error: error ?? "저장 실패: Supabase 연결 확인" };
    onFeedsChange();
    return { ok: true };
  }

  const patchEdit = (postUrl: string, patch: Partial<FeedEditState>) => {
    setEdits(prev => ({ ...prev, [postUrl]: { ...FEED_EDIT_DEFAULT, ...prev[postUrl], ...patch } }));
  };

  const fetchPostContent = useCallback(async (post: LatestPost) => {
    setContentCache(prev => ({ ...prev, [post.postUrl]: { loading: true, text: "", error: "" } }));
    try {
      const res = await fetch(`/api/blog-content?url=${encodeURIComponent(post.postUrl)}`);
      const data = (await res.json()) as { content?: string; error?: string };
      if (res.ok && data.content) {
        setContentCache(prev => ({ ...prev, [post.postUrl]: { loading: false, text: data.content!, error: "" } }));
      } else {
        setContentCache(prev => ({
          ...prev,
          [post.postUrl]: { loading: false, text: "", error: data.error ?? "본문을 불러올 수 없습니다." },
        }));
      }
    } catch (e) {
      setContentCache(prev => ({
        ...prev,
        [post.postUrl]: { loading: false, text: "", error: `본문 오류: ${e instanceof Error ? e.message : "알 수 없는 오류"}` },
      }));
    }
  }, []);

  useEffect(() => {
    if (!focusedPostUrl) return;
    const post = posts.find(p => p.postUrl === focusedPostUrl);
    if (post && !contentCache[focusedPostUrl]) {
      void fetchPostContent(post);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusedPostUrl]);

  // 원문 로드 완료되면 자동으로 Company/Topic 태그 추출
  useEffect(() => {
    if (!focusedPostUrl) return;
    const cached = contentCache[focusedPostUrl];
    if (!cached || cached.loading || cached.error || !cached.text) return;
    const edit = edits[focusedPostUrl];
    if (edit?.tagging || (edit?.companies?.length ?? 0) > 0 || (edit?.topics?.length ?? 0) > 0) return;
    const post = posts.find(p => p.postUrl === focusedPostUrl);
    if (!post) return;

    patchEdit(focusedPostUrl, { tagging: true });
    fetch("/api/blog-summarize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        content: cached.text,
        title: post.title,
        feedName: post.feedName,
        postUrl: post.postUrl,
        existingCompanies: allCompanies,
        existingTopics: allTopics,
        existingMacro: allMacro,
        tagsOnly: true,
        model: aiModel,
      }),
    })
      .then(res => res.json())
      .then((data: { companies?: string[]; topics?: string[]; macro?: string[] }) => {
        patchEdit(focusedPostUrl, { tagging: false, companies: data.companies ?? [], topics: data.topics ?? [], macro: data.macro ?? [] });
      })
      .catch(() => patchEdit(focusedPostUrl, { tagging: false }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contentCache[focusedPostUrl ?? ""]?.text, focusedPostUrl]);

  function handleSelectPost(post: LatestPost) {
    setFocusedPostUrl(post.postUrl);
    setReadUrls(prev => prev.has(post.postUrl) ? prev : new Set([...prev, post.postUrl]));
    if (!edits[post.postUrl]) setEdits(prev => ({ ...prev, [post.postUrl]: { ...FEED_EDIT_DEFAULT } }));
    if (!contentCache[post.postUrl]) void fetchPostContent(post);
  }

  async function handleSummarize(post: LatestPost, manualContent?: string) {
    patchEdit(post.postUrl, { step: "fetching", statusMsg: "게시글 본문 가져오는 중...", saveError: "" });

    let content = manualContent || contentCache[post.postUrl]?.text || "";
    if (!content) {
      try {
        const res = await fetch(`/api/blog-content?url=${encodeURIComponent(post.postUrl)}`);
        const data = (await res.json()) as { content?: string; error?: string };
        if (!data.content) {
          patchEdit(post.postUrl, {
            step: "error",
            statusMsg: data.error ?? "본문을 가져올 수 없습니다.",
            showContentInput: true,
          });
          return;
        }
        content = data.content;
      } catch (e) {
        patchEdit(post.postUrl, { step: "error", statusMsg: `본문 오류: ${e instanceof Error ? e.message : "알 수 없는 오류"}`, showContentInput: true });
        return;
      }
    }

    patchEdit(post.postUrl, { step: "summarizing", statusMsg: "AI 요약 중... (최대 60초 소요)" });

    try {
      const res = await fetch("/api/blog-summarize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content,
          title: post.title,
          feedName: post.feedName,
          postUrl: post.postUrl,
          existingCompanies: allCompanies,
          existingTopics: allTopics,
          existingMacro: allMacro,
          model: aiModel,
        }),
      });
      const data = (await res.json()) as { summary?: string; companies?: string[]; topics?: string[]; macro?: string[]; error?: string };
      if (!res.ok || data.error) {
        if (isQuotaExceededMessage(data.error)) {
          limitGuard.trigger(() => void handleSummarize(post, content));
          patchEdit(post.postUrl, { step: "idle", statusMsg: "" });
          return;
        }
        patchEdit(post.postUrl, { step: "error", statusMsg: data.error ?? "요약 실패" });
        return;
      }
      recordAiUsage(aiModel);
      patchEdit(post.postUrl, {
        step: "done",
        statusMsg: "",
        summary: data.summary ?? "",
        companies: data.companies ?? [],
        topics: data.topics ?? [],
        macro: data.macro ?? [],
      });
    } catch (e) {
      patchEdit(post.postUrl, { step: "error", statusMsg: `요약 오류: ${e instanceof Error ? e.message : "알 수 없는 오류"}` });
    }
  }

  async function handleSave(post: LatestPost) {
    const edit = edits[post.postUrl] ?? FEED_EDIT_DEFAULT;
    patchEdit(post.postUrl, { saving: true, saveError: "" });
    const notesToSave = edit.notes.trim()
      ? edit.notes
      : (contentCache[post.postUrl]?.text ?? "");
    const { data: result, error: saveErr } = await saveSummary({
      post_url: post.postUrl,
      title: post.title,
      feed_name: post.feedName,
      feed_url: post.feedUrl,
      summary: edit.summary,
      companies: edit.companies,
      topics: edit.topics,
      macro: edit.macro,
      notes: notesToSave,
      date: new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10),
    });
    if (saveErr || !result) {
      patchEdit(post.postUrl, { saving: false, saveError: saveErr ?? "저장 실패: Supabase 연결 확인" });
      return;
    }
    patchEdit(post.postUrl, { saving: false, saved: true });
    onSaved();
  }

  const focusedPost = focusedPostUrl ? posts.find(p => p.postUrl === focusedPostUrl) ?? null : null;
  const focusedEdit = focusedPostUrl ? edits[focusedPostUrl] ?? FEED_EDIT_DEFAULT : FEED_EDIT_DEFAULT;
  const focusedContent = focusedPostUrl ? contentCache[focusedPostUrl] : null;
  const isWorking = focusedEdit.step === "fetching" || focusedEdit.step === "summarizing";
  const filteredPosts = posts.filter(p => {
    if (deletedPostUrls.has(p.postUrl)) return false;
    if (feedFilter) {
      if (p.feedUrl !== feedFilter) return false;
    } else if (activeFolderId !== "all") {
      const allowedFeeds = folderFeeds[activeFolderId] ?? [];
      if (!allowedFeeds.includes(p.feedUrl)) return false;
    }
    const kwLower = keyword.trim().toLowerCase();
    if (kwLower && !p.title.toLowerCase().includes(kwLower) && !p.feedName.toLowerCase().includes(kwLower)) return false;
    if (!inDateRange(p.publishedAt, fromDate, toDate)) return false;
    return true;
  });

  // 로딩 / 초기 화면
  if (phase !== "list") {
    return (
      <div className="space-y-4">
        <div className="flex flex-col items-center justify-center gap-4 rounded-xl border border-[#DDE8E5] bg-white py-24 shadow-sm">
          {phase === "loading" ? (
            <>
              <Loader2 size={22} className="animate-spin text-[#94A8A0]" />
              <p className="text-[13px] text-[#94A8A0]">구독 블로그의 최신 게시글을 불러오는 중...</p>
            </>
          ) : (
            <>
              <p className="text-[13px] text-[#94A8A0]">구독 블로그의 최신 게시글을 불러옵니다</p>
              <button
                type="button"
                onClick={loadFeed}
                className="rounded-lg bg-[#005B52] px-6 py-2.5 text-[13px] font-semibold text-white hover:bg-[#15583d] transition"
              >
                최신 게시글 불러오기
              </button>
              {error && <p className="text-[12px] font-medium text-red-500">{error}</p>}
            </>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">

      {error && (
        <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-[12px] text-red-600">{error}</p>
      )}

      {/* 검색 + 기간 필터 — 기간을 지정하면 최근 3일 제한 없이 과거 게시글까지 조회 */}
      <SearchDateBar
        keyword={keyword} onKeyword={setKeyword}
        fromDate={fromDate} onFromDate={setFromDate}
        toDate={toDate} onToDate={setToDate}
        searching={searching}
        onSubmit={() => void searchPastPosts()}
        onReset={() => { setKeyword(""); setFromDate(""); setToDate(""); void loadFeed(); }}
        placeholder="게시글 제목·블로그명 검색 (과거 게시글 포함)"
      />

      {/* 게시글 목록 — 텔레그램 스타일 3-Column 레이아웃 (폴더/피드 리스트 접기 기능 적용) */}
      <div className="flex h-[640px] overflow-hidden rounded-xl border border-[#DDE8E5] bg-white shadow-sm">
        {/* 접이식 사이드바 Wrapper (폴더 바 + 피드 목록) */}
        <div className={`flex shrink-0 transition-all duration-300 ease-in-out overflow-hidden ${
          isSidebarOpen ? "w-[312px]" : "w-0"
        }`}>
          {/* Column 1: 폴더 바 (세로 72px) */}
          <div className="w-[72px] shrink-0 bg-[#1e2a38] text-white flex flex-col items-center py-4 justify-between select-none">
            <div className="w-full flex flex-col items-center gap-4">
              {/* 장식용 메뉴 아이콘 */}
              <div className="p-2 text-gray-400 hover:text-white transition rounded-full cursor-pointer">
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 6h16M4 12h16M4 18h16" /></svg>
              </div>

              {/* 폴더 목록 */}
              <div className="w-full flex flex-col items-center gap-2 px-1">
                {folders.map((f) => {
                  const isActive = activeFolderId === f.id;
                  const count = f.id === "all" ? feeds.length : (folderFeeds[f.id] ?? []).length;
                  const isRenaming = editingFolderNameId === f.id;
                  return (
                    <button
                      key={f.id}
                      type="button"
                      onDoubleClick={() => {
                        if (f.id !== "all") {
                          setEditingFolderNameId(f.id);
                          setEditingFolderNameValue(f.name);
                        }
                      }}
                      onClick={() => {
                        if (!isRenaming) {
                          setActiveFolderId(f.id);
                          if (f.id !== "all") {
                            const allowed = folderFeeds[f.id] ?? [];
                            if (feedFilter && !allowed.includes(feedFilter)) {
                              setFeedFilter(null);
                            }
                          }
                        }
                      }}
                      className={`relative group flex flex-col items-center justify-center w-14 h-14 rounded-xl transition ${
                        isActive ? "bg-primary text-white" : "text-gray-400 hover:bg-gray-800 hover:text-gray-200"
                      }`}
                    >
                      {isActive && (
                        <div className="absolute left-0 top-3 w-1 h-8 bg-white rounded-r-md" />
                      )}
                      {f.icon === "all" ? (
                        <MessageSquare size={20} />
                      ) : (
                        <Folder size={20} />
                      )}
                      {isRenaming ? (
                        <input
                          type="text"
                          value={editingFolderNameValue}
                          onChange={(e) => setEditingFolderNameValue(e.target.value)}
                          onBlur={() => handleRenameFolder(f.id, editingFolderNameValue)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              handleRenameFolder(f.id, editingFolderNameValue);
                            } else if (e.key === "Escape") {
                              setEditingFolderNameId(null);
                            }
                          }}
                          className="text-[9px] mt-1 font-bold text-black text-center w-12 rounded border border-gray-300 focus:outline-none focus:border-primary"
                          autoFocus
                          onClick={(e) => e.stopPropagation()}
                        />
                      ) : (
                        <span className="text-[10px] mt-1 font-bold truncate max-w-full px-1">{f.name}</span>
                      )}
                      {count > 0 && !isRenaming && (
                        <span className={`absolute top-1 right-1 flex h-4 min-w-[16px] items-center justify-center rounded-full px-1 text-[9px] font-black ${
                          isActive ? "bg-white text-primary" : "bg-gray-700 text-white"
                        }`}>
                          {count}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* 하단 설정/편집 버튼 */}
            <div className="w-full flex flex-col items-center gap-3">
              <button
                type="button"
                onClick={() => setIsFolderModalOpen(true)}
                className="flex flex-col items-center justify-center w-14 h-14 rounded-xl text-gray-400 hover:bg-gray-800 hover:text-gray-200 transition"
                title="폴더 편집"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" />
                </svg>
                <span className="text-[10px] mt-1 font-bold">편집</span>
              </button>
            </div>
          </div>

          {/* Column 2: 블로그 목록 (폭 240px) */}
          <div className="w-[240px] shrink-0 border-r border-[#E8F0ED] flex flex-col bg-[#f5f8f7]">
            <div className="p-3 border-b border-[#E8F0ED] bg-white flex items-center justify-between">
              <span className="text-sm font-black text-[#0d2318] flex items-center gap-1.5">
                블로그 목록
                <span className="bg-[#e2ede8] text-[#3c564b] px-1.5 py-0.5 rounded-md text-[10px] font-bold">
                  {filteredFeeds.length}
                </span>
              </span>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setIsAddFeedOpen((v) => !v)}
                  className="p-1 hover:bg-[#eaf1ee] rounded text-[#5f7a70] transition"
                  title="블로그 추가"
                >
                  <Plus size={16} />
                </button>
              </div>
            </div>

            {/* 블로그 추가 폼 */}
            {isAddFeedOpen && (
              <div className="p-2.5 border-b border-[#E8F0ED] bg-white space-y-2">
                <input
                  type="text"
                  placeholder="RSS 피드 URL"
                  value={feedUrlInput}
                  onChange={(e) => setFeedUrlInput(e.target.value)}
                  className="w-full text-xs rounded-md border border-[#DDE8E5] px-2 py-1.5 focus:border-primary focus:outline-none"
                  autoFocus
                />
                <input
                  type="text"
                  placeholder="블로그 표시 이름"
                  value={feedNameInput}
                  onChange={(e) => setFeedNameInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") void handleAddFeedSubmit(); }}
                  className="w-full text-xs rounded-md border border-[#DDE8E5] px-2 py-1.5 focus:border-primary focus:outline-none"
                />
                {addFeedError && <p className="text-[10px] text-red-500">{addFeedError}</p>}
                <div className="flex justify-end gap-1.5">
                  <button
                    type="button"
                    onClick={() => { setIsAddFeedOpen(false); setFeedUrlInput(""); setFeedNameInput(""); setAddFeedError(""); }}
                    className="px-2 py-1 text-[10px] font-bold text-gray-500 hover:bg-gray-100 rounded"
                  >
                    취소
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleAddFeedSubmit()}
                    disabled={isAddingFeed}
                    className="px-2 py-1 text-[10px] font-bold bg-primary text-white rounded hover:bg-primary-light flex items-center gap-1"
                  >
                    {isAddingFeed && <Loader2 size={10} className="animate-spin" />} 등록
                  </button>
                </div>
              </div>
            )}

            {/* 피드 리스트 */}
            <div className="flex-1 overflow-y-auto min-h-0 py-1">
              {filteredFeeds.length === 0 ? (
                <div className="p-4 text-center text-xs text-gray-400 font-semibold leading-relaxed">
                  등록된 블로그가 없습니다.
                </div>
              ) : (
                <>
                  {/* 전체 모아보기 */}
                  <div
                    onClick={() => setFeedFilter(null)}
                    className={`px-3 py-2 text-xs font-bold transition cursor-pointer border-b border-[#f0f3f2] ${
                      feedFilter === null ? "bg-primary-50 text-primary" : "hover:bg-[#eaf1ee] text-[#1c3329]"
                    }`}
                  >
                    전체 모아보기 ({posts.length})
                  </div>
                  {filteredFeeds.map((f) => {
                    const isActive = feedFilter === f.feed_url;
                    const initial = f.feed_name ? f.feed_name.trim().charAt(0) : "?";
                    const count = posts.filter(p => p.feedUrl === f.feed_url).length;
                    return (
                      <div
                        key={f.id}
                        className={`group flex items-center justify-between px-3 py-2.5 transition cursor-pointer border-b border-[#f0f3f2] ${
                          isActive ? "bg-primary text-white" : "hover:bg-[#eaf1ee] text-[#1c3329]"
                        }`}
                        onClick={() => setFeedFilter(f.feed_url)}
                      >
                        <div className="flex items-center gap-2 min-w-0 flex-1">
                          <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${
                            isActive ? "bg-white/20 text-white" : "bg-[#dfede8] text-[#3c564b]"
                          }`}>
                            {initial}
                          </div>
                          <div className="min-w-0 flex-1">
                            <span className={`block truncate text-xs font-bold ${isActive ? "text-white" : "text-[#1C3329]"}`}>
                              {f.feed_name}
                            </span>
                            <span className={`block truncate text-[10px] ${isActive ? "text-white/70" : "text-gray-400"}`}>
                              ({count}건)
                            </span>
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            if (confirm("이 블로그를 구독 취소하시겠습니까?")) {
                              void handleDeleteFeed(f.feed_url);
                            }
                          }}
                          className={`p-1 hover:bg-black/10 rounded transition opacity-0 group-hover:opacity-100 ${
                            isActive ? "text-white/80 hover:text-white" : "text-gray-400 hover:text-red-500"
                          }`}
                          title="삭제"
                        >
                          <X size={12} />
                        </button>
                      </div>
                    );
                  })}
                </>
              )}
            </div>
          </div>
        </div>

        {/* Column 3: 게시글 목록 */}
        <div className="flex-1 flex flex-col min-w-0 h-full">
          {/* 상시 노출 상단 제어 바 */}
          <div className="flex items-center justify-between border-b border-[#E8F0ED] bg-white px-4 py-2 shrink-0 select-none">
            <span className="text-xs font-black text-[#0D2318] flex items-center gap-2">
              <button
                type="button"
                onClick={() => setIsSidebarOpen((o) => !o)}
                className={`p-1.5 rounded transition shrink-0 border ${
                  isSidebarOpen ? "bg-[#eaf1ee] border-primary-200 text-primary hover:bg-[#dfede8]" : "bg-white border-[#DDE8E5] text-[#5f7a70] hover:bg-[#F6FAF8]"
                }`}
                title={isSidebarOpen ? "사이드바 접기" : "사이드바 펼치기"}
              >
                <SidebarToggleIcon size={14} />
              </button>
              <span className="truncate max-w-[300px]">
                {feedFilter ? (
                  `${feeds.find(f => f.feed_url === feedFilter)?.feed_name || ""} 게시글 목록 · 전체 ${filteredPosts.length}건 중 ${Math.min(visibleCount, filteredPosts.length)}건`
                ) : (
                  `전체 게시글 모아보기 · 전체 ${filteredPosts.length}건 중 ${Math.min(visibleCount, filteredPosts.length)}건`
                )}
              </span>
            </span>
          </div>

          {/* 본문 리스트 */}
          <div className="flex-1 overflow-y-auto">
            {filteredPosts.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-center">
                <Inbox size={28} className="mx-auto mb-2 text-[#B9CCC4]" />
                <p className="text-[13px] font-semibold text-[#5F7A70]">게시글 없음</p>
              </div>
            ) : (
              <div className="divide-y divide-[#E8F0ED]">
                {filteredPosts.slice(0, visibleCount).map(post => {
                  const isFocused = focusedPostUrl === post.postUrl;
                  const isSaved = savedPostUrls.has(post.postUrl) || edits[post.postUrl]?.saved;
                  const isRead = readUrls.has(post.postUrl);
                  return (
                    <div
                      key={post.postUrl}
                      role="button"
                      tabIndex={0}
                      onClick={() => handleSelectPost(post)}
                      onKeyDown={(e) => {
                        if (e.key !== "Enter" && e.key !== " ") return;
                        e.preventDefault();
                        handleSelectPost(post);
                      }}
                      className={`group flex w-full items-start gap-3 px-4 py-3 text-left transition cursor-pointer ${
                        isFocused ? "bg-emerald-50" : "hover:bg-[#F6FAF8]"
                      } ${isRead && !isFocused ? "opacity-50" : ""}`}
                    >
                      <div className="relative w-5 h-5 shrink-0 flex items-center justify-center self-center">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            void handleDeletePost(post.postUrl);
                          }}
                          className="absolute inset-0 flex items-center justify-center rounded bg-red-50 text-red-500 hover:bg-red-100 hover:text-red-700 opacity-0 group-hover:opacity-100 transition-opacity"
                          title="삭제"
                        >
                          <Minus size={13} strokeWidth={3} />
                        </button>
                        <div className="group-hover:opacity-0 w-1.5 h-1.5 rounded-full bg-slate-300 transition-opacity" />
                      </div>

                      <div className="min-w-0 flex-1">
                        <p className={`text-[13px] font-semibold leading-snug line-clamp-2 ${
                          isFocused ? "text-[#005B52]" : "text-[#1C3329] group-hover:text-[#005B52]"
                        }`}>
                          {post.title}
                        </p>
                        <p className="mt-0.5 text-[11px] text-[#94A8A0]">
                          {post.feedName} · {relativeDate(post.publishedAt)}
                        </p>
                      </div>
                      {isSaved && (
                        <span className="shrink-0 rounded bg-emerald-100 px-2 py-1 text-[12px] font-semibold text-emerald-700">
                          저장됨
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
            {(visibleCount < filteredPosts.length || hasMore) && filteredPosts.length >= 20 && (
              <div className="p-3">
                <button
                  type="button"
                  onClick={() => void handleLoadMorePosts()}
                  disabled={loadingMore}
                  className="flex w-full items-center justify-center gap-1.5 rounded-md border border-[#DDE8E5] py-2 text-[12px] font-medium text-[#5F7A70] hover:bg-[#F6FAF8] transition disabled:opacity-50"
                >
                  {loadingMore ? <Loader2 size={12} className="animate-spin" /> : null}
                  더 보기
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 상세/요약 팝업 */}
      {focusedPost && mounted && createPortal(
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4 sm:p-8"
          onClick={() => setFocusedPostUrl(null)}
        >
          <div
            className="flex max-h-[85vh] w-full max-w-7xl flex-col overflow-hidden rounded-xl bg-white shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex flex-1 flex-col overflow-hidden">
              {/* 헤더 */}
              <div className="border-b border-[#E8F0ED] bg-white px-5 py-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 flex-1 items-start gap-3">
                    <div className="min-w-0">
                      <p className="text-[11px] font-medium text-[#94A8A0]">
                        {focusedPost.feedName} · {relativeDate(focusedPost.publishedAt)}
                      </p>
                      <p className="mt-1 text-[15px] font-bold leading-snug text-[#1C3329]">
                        {focusedPost.title}
                      </p>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => handleSave(focusedPost)}
                      disabled={focusedEdit.saving || focusedEdit.saved}
                      className={`flex min-w-[64px] items-center justify-center gap-1 rounded-md px-2.5 py-1.5 text-[12px] font-semibold transition ${
                        focusedEdit.saved || focusedEdit.saving
                          ? "cursor-default border border-[#DDE8E5] bg-[#EEF4F1] text-[#94A8A0]"
                          : "bg-primary text-white hover:bg-primary-light"
                      }`}
                    >
                      {focusedEdit.saving ? (
                        <Loader2 size={12} className="animate-spin" />
                      ) : focusedEdit.saved ? (
                        <Check size={12} />
                      ) : (
                        <Bookmark size={12} />
                      )}
                      {focusedEdit.saving ? "저장 중" : focusedEdit.saved ? "저장됨" : "저장"}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleSummarize(focusedPost)}
                      disabled={isWorking}
                      className="flex items-center gap-1 rounded-md border border-[#DDE8E5] px-2.5 py-1.5 text-[12px] font-semibold text-[#5F7A70] hover:bg-[#F6FAF8] disabled:opacity-40 transition"
                    >
                      {isWorking ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
                      AI 요약
                    </button>
                    <a
                      href={focusedPost.postUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1 rounded-md border border-[#DDE8E5] px-2.5 py-1.5 text-[12px] font-semibold text-[#5F7A70] hover:bg-[#F6FAF8] transition"
                    >
                      <ExternalLink size={12} />
                      원본
                    </a>
                    <button
                      type="button"
                      onClick={() => setFocusedPostUrl(null)}
                      className="rounded-md border border-[#DDE8E5] p-1.5 text-[#94A8A0] hover:bg-[#F6FAF8] transition"
                      title="선택 해제"
                    >
                      <X size={13} />
                    </button>
                  </div>
                </div>
              </div>

              {/* 본문 (두 컬럼 레이아웃) */}
              <div className="flex flex-1 overflow-hidden min-h-0">
                {/* Left Panel: 원문 및 태그/요약 (스크롤 영역) */}
                <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4 border-r border-[#E8F0ED]">

                {/* Topic 태그 */}
                <div>
                  <label className="mb-2 block text-[12px] font-semibold uppercase tracking-wide text-[#94A8A0]">Topic 태그</label>
                  {focusedEdit.tagging ? (
                    <div className="flex items-center gap-2 text-[13px] text-[#94A8A0]">
                      <Loader2 size={14} className="animate-spin" />
                      AI 태깅 중...
                    </div>
                  ) : (
                    <TagInput
                      tags={focusedEdit.topics}
                      onChange={topics => patchEdit(focusedPost.postUrl, { topics, saved: false })}
                      suggestions={allTopics}
                      color="green"
                      placeholder="+ 태그"
                    />
                  )}
                </div>

                {/* Company 태그 */}
                <div>
                  <label className="mb-2 block text-[12px] font-semibold uppercase tracking-wide text-[#94A8A0]">Company 태그</label>
                  {focusedEdit.tagging ? (
                    <div className="flex items-center gap-2 text-[13px] text-[#94A8A0]">
                      <Loader2 size={14} className="animate-spin" />
                      AI 태깅 중...
                    </div>
                  ) : (
                    <TagInput
                      tags={focusedEdit.companies}
                      onChange={companies => patchEdit(focusedPost.postUrl, { companies, saved: false })}
                      suggestions={allCompanies}
                      color="blue"
                      placeholder="+ 기업명"
                    />
                  )}
                </div>

                {/* Macro 태그 */}
                <div>
                  <label className="mb-2 block text-[12px] font-semibold uppercase tracking-wide text-[#94A8A0]">Macro 태그</label>
                  {focusedEdit.tagging ? (
                    <div className="flex items-center gap-2 text-[13px] text-[#94A8A0]">
                      <Loader2 size={14} className="animate-spin" />
                      AI 태깅 중...
                    </div>
                  ) : (
                    <TagInput
                      tags={focusedEdit.macro}
                      onChange={macro => patchEdit(focusedPost.postUrl, { macro, saved: false })}
                      suggestions={allMacro}
                      color="amber"
                      placeholder="+ 매크로"
                    />
                  )}
                </div>

                {/* AI 요약 상태 */}
                {(isWorking || focusedEdit.step === "error") && (
                  <div className={`rounded-md px-4 py-3 text-sm ${
                    focusedEdit.step === "error" ? "bg-red-50 text-red-700 border border-red-200" : "bg-blue-50 text-blue-700 border border-blue-100"
                  }`}>
                    {isWorking && <span className="mr-2 animate-spin inline-block">⟳</span>}
                    {focusedEdit.statusMsg}
                    {focusedEdit.step === "error" && (
                      <button
                        type="button"
                        onClick={() => handleSummarize(focusedPost)}
                        className="ml-3 underline underline-offset-2"
                      >
                        다시 시도
                      </button>
                    )}
                  </div>
                )}

                {/* AI 요약 결과 */}
                {focusedEdit.step === "done" && (
                  <div className="rounded-md border border-[#E8F0ED] bg-[#F6FAF8] p-4 h-auto">
                    <MarkdownView text={focusedEdit.summary} />
                  </div>
                )}

                {/* 게시글 원문 */}
                <div>
                  <label className="mb-2 block text-[11px] font-semibold uppercase tracking-wide text-[#94A8A0]">게시글 원문</label>
                  <div className="h-auto rounded-lg border border-[#DDE8E5] bg-[#F6FAF8] px-3.5 py-3">
                    {focusedContent?.loading ? (
                      <div className="flex items-center gap-2 py-4 text-[12px] text-[#94A8A0]">
                        <Loader2 size={13} className="animate-spin" />
                        본문을 불러오는 중...
                      </div>
                    ) : focusedContent?.error ? (
                      <div className="flex items-center justify-between gap-2 py-2">
                        <p className="text-[12px] text-red-500">{focusedContent.error}</p>
                        <button
                          type="button"
                          onClick={() => focusedPost && fetchPostContent(focusedPost)}
                          className="shrink-0 rounded border border-[#DDE8E5] px-2 py-1 text-[11px] text-[#5F7A70] hover:bg-white"
                        >
                          다시 시도
                        </button>
                      </div>
                    ) : (
                      <p className="whitespace-pre-line text-[17px] leading-relaxed text-[#4B6358]">
                        {focusedContent?.text ?? ""}
                      </p>
                    )}
                  </div>
                </div>

                </div>

                {/* Right Panel: 메모장 정리 박스 */}
                <div className="w-[380px] shrink-0 bg-[#FCFDFD] p-5 flex flex-col min-h-0 border-l border-[#E8F0ED]">
                  <label className="mb-2 block text-[11px] font-bold uppercase tracking-wide text-[#94A8A0] flex items-center gap-1.5">
                    <span className="inline-block w-1.5 h-1.5 rounded-full bg-[#005B52]"></span>
                    정리 노트
                  </label>
                  <textarea
                    value={focusedEdit.notes}
                    onChange={e => patchEdit(focusedPost.postUrl, { notes: e.target.value, saved: false })}
                    placeholder="게시글을 읽고 직접 정리한 내용을 입력하세요..."
                    className="w-full flex-1 resize-none rounded-lg border border-[#DDE8E5] bg-white p-4 text-[13px] text-[#33493F] placeholder:text-[#94A8A0] focus:outline-none focus:ring-1 focus:ring-[#005B52] shadow-inner"
                    style={{
                      backgroundImage: "linear-gradient(rgba(95, 122, 112, 0.08) 1px, transparent 1px)",
                      backgroundSize: "100% 28px",
                      lineHeight: "28px",
                      paddingTop: "6px"
                    }}
                  />
                  {focusedEdit.saveError && <p className="mt-2 text-xs text-red-600">{focusedEdit.saveError}</p>}
                </div>
              </div>
            </div>
          </div>
        </div>
      , document.body)}

      <AiLimitModal open={limitGuard.open} onClose={limitGuard.close} onSelect={limitGuard.onSelect} />

      {/* 폴더 편집 모달 */}
      {isFolderModalOpen && mounted && createPortal(
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4" onClick={() => setIsFolderModalOpen(false)}>
          <div
            className="flex max-h-[80vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl bg-white shadow-2xl transition-all duration-300"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-[#E8F0ED] px-5 py-4">
              <div className="flex items-center gap-2">
                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-white">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" /></svg>
                </span>
                <h3 className="text-base font-black text-[#0D2318]">폴더 편집</h3>
              </div>
              <button
                type="button"
                onClick={() => setIsFolderModalOpen(false)}
                className="rounded-md p-1.5 text-[#94A8A0] hover:bg-[#F6FAF8] transition"
              >
                <X size={16} />
              </button>
            </div>

            <div className="flex flex-1 overflow-hidden min-h-0">
              {/* 왼쪽: 폴더 리스트 */}
              <div className="w-[260px] shrink-0 border-r border-[#E8F0ED] bg-[#FCFDFD] p-4 flex flex-col gap-4">
                <div className="flex flex-col gap-1.5">
                  <label className="text-[11px] font-bold uppercase tracking-wider text-[#94A8A0]">폴더 목록</label>
                  <div className="flex flex-col gap-1 overflow-y-auto max-h-[250px] pr-1">
                    {folders.map((f) => {
                      const isEditing = editingFolderId === f.id;
                      const isDefault = f.id === "all" || f.id === "core";
                      const isRenaming = editingFolderNameId === f.id && f.id !== "all";
                      return (
                        <div
                          key={f.id}
                          onClick={() => {
                            if (!isRenaming) setEditingFolderId(f.id);
                          }}
                          onDoubleClick={() => {
                            if (f.id !== "all") {
                              setEditingFolderNameId(f.id);
                              setEditingFolderNameValue(f.name);
                            }
                          }}
                          className={`flex items-center justify-between px-3 py-2 rounded-lg cursor-pointer transition ${
                            isEditing ? "bg-[#eaf1ee] text-primary font-bold" : "hover:bg-gray-100 text-[#33493F]"
                          }`}
                        >
                          {isRenaming ? (
                            <input
                              type="text"
                              value={editingFolderNameValue}
                              onChange={(e) => setEditingFolderNameValue(e.target.value)}
                              onBlur={() => handleRenameFolder(f.id, editingFolderNameValue)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") {
                                  handleRenameFolder(f.id, editingFolderNameValue);
                                } else if (e.key === "Escape") {
                                  setEditingFolderNameId(null);
                                }
                              }}
                              className="text-xs font-semibold text-black rounded border border-gray-300 px-1 py-0.5 focus:outline-none w-full mr-2"
                              autoFocus
                              onClick={(e) => e.stopPropagation()}
                            />
                          ) : (
                            <span className="text-xs truncate flex items-center gap-1.5">
                              {f.icon === "all" ? <MessageSquare size={13} /> : <Folder size={13} />}
                              {f.name}
                            </span>
                          )}
                          {!isDefault && !isRenaming && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleDeleteFolder(f.id);
                              }}
                              className="text-gray-400 hover:text-red-500 p-0.5 rounded transition"
                              title="폴더 삭제"
                            >
                              <X size={12} />
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div className="border-t border-[#E8F0ED] pt-3 flex flex-col gap-2 mt-auto">
                  <label className="text-[11px] font-bold uppercase tracking-wider text-[#94A8A0]">새 폴더 추가</label>
                  <div className="flex gap-1.5">
                    <input
                      type="text"
                      placeholder="폴더 이름"
                      value={newFolderName}
                      onChange={(e) => setNewFolderName(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") handleAddFolder(); }}
                      className="flex-1 text-xs rounded-md border border-[#DDE8E5] px-2.5 py-1.5 focus:border-primary focus:outline-none"
                    />
                    <button
                      type="button"
                      onClick={handleAddFolder}
                      className="bg-primary text-white text-xs font-bold px-3 py-1.5 rounded-md hover:bg-primary-light transition shrink-0"
                    >
                      추가
                    </button>
                  </div>
                </div>
              </div>

              {/* 오른쪽: 블로그 지정 */}
              <div className="flex-1 p-5 flex flex-col overflow-hidden">
                <div className="mb-4">
                  <h4 className="text-sm font-bold text-[#1C3329]">
                    {folders.find((f) => f.id === editingFolderId)?.name} 폴더 블로그 지정
                  </h4>
                  <p className="text-[11px] text-[#94A8A0] mt-0.5">
                    이 폴더에 포함할 블로그를 선택하세요.
                  </p>
                </div>

                {editingFolderId === "all" ? (
                  <div className="flex-1 flex items-center justify-center border border-dashed border-[#DDE8E5] rounded-lg bg-[#F6FAF8] p-8 text-center text-xs text-[#5F7A70] font-semibold">
                    '전체' 폴더는 등록된 모든 블로그를 자동으로 보여줍니다. 별도의 블로그 지정이 필요 없습니다.
                  </div>
                ) : (
                  <div className="flex-1 overflow-y-auto border border-[#E8F0ED] rounded-lg bg-white min-h-0">
                    {feeds.length === 0 ? (
                      <div className="p-8 text-center text-xs text-gray-400 font-semibold">
                        등록된 블로그가 없습니다. 먼저 블로그를 추가하세요.
                      </div>
                    ) : (
                      <div className="divide-y divide-[#F0F7F4]">
                        {feeds.map((f) => {
                          const isChecked = (folderFeeds[editingFolderId] ?? []).includes(f.feed_url);
                          return (
                            <label
                              key={f.id}
                              className="flex items-center justify-between px-4 py-3 hover:bg-[#F6FAF8] cursor-pointer transition select-none"
                            >
                              <div className="min-w-0 flex-1 pr-4">
                                <span className="block text-xs font-bold text-[#1C3329] truncate">{f.feed_name}</span>
                                <span className="block text-[10px] text-gray-400 truncate">{f.feed_url}</span>
                              </div>
                              <input
                                type="checkbox"
                                checked={isChecked}
                                onChange={() => toggleFeedInFolder(editingFolderId, f.feed_url)}
                                className="w-4 h-4 rounded border-gray-300 text-primary focus:ring-primary/30 accent-primary"
                              />
                            </label>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
            <div className="border-t border-[#E8F0ED] px-5 py-3.5 bg-[#F6FAF8] flex justify-end">
              <button
                type="button"
                onClick={() => setIsFolderModalOpen(false)}
                className="bg-primary text-white text-xs font-black px-5 py-2 rounded-md hover:bg-primary-light transition"
              >
                완료
              </button>
            </div>
          </div>
        </div>
      , document.body)}

      <AiLimitModal open={limitGuard.open} onClose={limitGuard.close} onSelect={limitGuard.onSelect} />
    </div>
  );
}

// ── Supabase setup notice ──────────────────────────────────────────────────

const SQL_NOTICE = `-- Supabase SQL Editor에서 아래 전체를 실행해주세요

-- 1. 테이블 생성
create table if not exists blog_summaries (
  id uuid primary key default gen_random_uuid(),
  post_url text not null default '',
  title text not null default '',
  feed_name text default '',
  feed_url text default '',
  summary text default '',
  companies text[] default '{}',
  topics text[] default '{}',
  macro text[] default '{}',
  date date,
  created_at timestamptz default now()
);

create table if not exists blog_feeds (
  id uuid primary key default gen_random_uuid(),
  feed_url text unique not null,
  feed_name text not null,
  site_url text default '',
  thumbnail_url text default '',
  created_at timestamptz default now()
);

-- 2. RLS 비활성화 (anon key로 읽기/쓰기 허용)
alter table blog_summaries disable row level security;
alter table blog_feeds disable row level security;`;

// ── Main export ────────────────────────────────────────────────────────────

export function BlogDB() {
  const [activeTab, setActiveTab] = useState<"feed" | "new" | "history">("feed");
  const [summaries, setSummaries] = useState<BlogSummary[]>([]);
  const [feeds, setFeeds] = useState<BlogFeed[]>([]);
  const [allSavedPostUrls, setAllSavedPostUrls] = useState<Set<string>>(new Set());
  const [isLoaded, setIsLoaded] = useState(false);
  const [showSql, setShowSql] = useState(false);

  const fetchAll = useCallback(async () => {
    const [s, f, urls] = await Promise.all([loadSummaries(), loadFeeds(), loadAllSavedPostUrls()]);
    setSummaries(s);
    setFeeds(f);
    setAllSavedPostUrls(urls);
    setIsLoaded(true);
  }, []);

  useEffect(() => { void fetchAll(); }, [fetchAll]);

  // 게시글 저장 후에는 요약/저장목록만 갱신 — feeds까지 새로 세팅하면 LatestFeedPanel의
  // RSS 재조회 effect(loadFeed useCallback이 feeds 참조 변경에 반응)가 다시 돌면서
  // 목록 전체가 로딩 화면으로 바뀌는("새로고침되는") 부작용이 있었다.
  const refreshSaved = useCallback(async () => {
    const [s, urls] = await Promise.all([loadSummaries(), loadAllSavedPostUrls()]);
    setSummaries(s);
    setAllSavedPostUrls(urls);
  }, []);

  const allCompanies = [...new Set(summaries.flatMap(s => s.companies))].sort();
  const allTopics = [...new Set(summaries.flatMap(s => s.topics))].sort();
  const allMacro = [...new Set(summaries.flatMap(s => s.macro))].sort();

  async function handleDelete(id: string) {
    if (!confirm("이 요약을 삭제하시겠습니까?")) return;
    await deleteSummary(id);
    setSummaries(prev => prev.filter(s => s.id !== id));
  }

  const tabItems: { id: "feed" | "new" | "history"; label: string; badge: number }[] = [
    { id: "feed", label: "구독한 블로그", badge: feeds.length },
    { id: "new", label: "직접 요약", badge: -1 },
    { id: "history", label: "저장됨", badge: summaries.length },
  ];

  const disabledFeatures = (process.env.NEXT_PUBLIC_DISABLED_FEATURES ?? "").split(",").map(s => s.trim());
  const naverKeyMissing = disabledFeatures.includes("naver");

  return (
    <div className="flex flex-col gap-5">
      {naverKeyMissing && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-800">
          ⚠️ 네이버 오픈API의 API키를 등록해주세요! (NAVER_CLIENT_ID, NAVER_CLIENT_SECRET) — 블로그 검색 기능이 비활성화 상태입니다.
        </div>
      )}
      <section className="rounded-card border border-[#DDE8E5] bg-white p-5 shadow-card">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary text-white">
              <BookOpen size={22} />
            </span>
            <div>
              <h2 className="text-lg font-black text-[#0D2318]">블로그 DB</h2>
              <p className="text-xs font-semibold text-[#7A9488]">
                네이버 블로그 및 주요 투자 인플루언서들의 주요 콘텐츠를 AI로 실시간 요약 분석합니다
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <div className="flex rounded-btn bg-[#F0F5F4] p-1">
              {tabItems.map(t => {
                const active = activeTab === t.id;
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setActiveTab(t.id)}
                    className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-bold transition ${
                      active ? "bg-primary text-white shadow-soft" : "text-[#4B6358] hover:text-primary"
                    }`}
                  >
                    {t.id === "history" && <Bookmark size={13} />}
                    {t.label}
                    {t.badge >= 0 && (
                      <span className={`ml-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-bold ${
                        active ? "bg-white/20 text-white" : "bg-[#DFE9E5] text-[#5F7A70]"
                      }`}>
                        {t.badge}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </section>

      <div className="rounded-xl border border-[#DDE8E5] bg-white p-6 shadow-sm overflow-hidden flex flex-col gap-4">

        {/* DB setup notice (first time) */}
        {isLoaded && summaries.length === 0 && feeds.length === 0 && (
          <div className="rounded-md border border-[#E8F0ED] bg-[#F6FAF8] px-4 py-3 text-xs text-[#5F7A70] flex items-start gap-2">
            <Info size={14} className="shrink-0 mt-0.5 text-[#5F7A70]" />
            <span>
              첫 사용 시 Supabase에 테이블이 필요합니다.{" "}
              <button type="button" onClick={() => setShowSql(v => !v)} className="underline text-primary">
                SQL 보기
              </button>
            </span>
          </div>
        )}
        {showSql && (
          <pre className="rounded-md bg-[#0D2318] text-[#EEF4F1] text-xs p-4 overflow-x-auto leading-relaxed">
            {SQL_NOTICE}
          </pre>
        )}

        {/* Panel content */}
        {activeTab === "feed" && (
          <LatestFeedPanel
            feeds={feeds}
            savedPostUrls={allSavedPostUrls}
            allCompanies={allCompanies}
            allTopics={allTopics}
            allMacro={allMacro}
            onSaved={() => void refreshSaved()}
            onFeedsChange={() => void fetchAll()}
          />
        )}
        {activeTab === "new" && (
          <SummarizePanel
            onSaved={() => { void fetchAll(); setActiveTab("history"); }}
            allCompanies={allCompanies}
            allTopics={allTopics}
            allMacro={allMacro}
          />
        )}
        {activeTab === "history" && (
          <HistoryPanel summaries={summaries} onDelete={handleDelete} />
        )}
      </div>
    </div>
  );
}


