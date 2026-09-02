"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { createPortal } from "react-dom";
import { Bookmark, Check, ExternalLink, Folder, Inbox, Info, Loader2, MessageSquare, Minus, Play, Plus, Video, X } from "lucide-react";
import { useCustomerContext } from "../../maintab/CustomerContext";
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

type LatestVideo = {
  channelId: string;
  channelName: string;
  videoId: string;
  title: string;
  publishedAt: string;
  thumbnailUrl: string;
  videoUrl: string;
  viewCount?: number;
};

// ── Types ──────────────────────────────────────────────────────────────────

type YoutubeSummary = {
  id: string;
  video_id: string;
  video_url: string;
  title: string;
  channel_name: string;
  channel_id: string;
  summary: string;
  companies: string[];
  topics: string[];
  macro: string[];
  date: string;
  created_at: string;
};

type YoutubeChannel = {
  id: string;
  channel_id: string;
  channel_name: string;
  channel_url: string;
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

async function loadSummaries(): Promise<YoutubeSummary[]> {
  try {
    const res = await fetch("/api/youtube-db/summaries");
    if (!res.ok) { console.error("[youtube_summaries] load:", await res.text()); return []; }
    const { summaries } = await res.json() as { summaries: YoutubeSummary[] };
    return summaries ?? [];
  } catch (e) { console.error("[youtube_summaries] load:", e); return []; }
}

async function saveSummary(row: Omit<YoutubeSummary, "id" | "created_at">): Promise<{ data: YoutubeSummary | null; error: string | null }> {
  try {
    const res = await fetch("/api/youtube-db/summaries", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(row),
    });
    const json = await res.json() as { summary?: YoutubeSummary; error?: string };
    if (!res.ok) return { data: null, error: json.error ?? "저장 실패" };
    return { data: json.summary ?? null, error: null };
  } catch (e) { return { data: null, error: String(e) }; }
}

async function deleteSummary(id: string): Promise<void> {
  await fetch("/api/youtube-db/summaries", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id }),
  });
}

async function loadChannels(): Promise<YoutubeChannel[]> {
  try {
    const res = await fetch("/api/youtube-db/channels");
    if (!res.ok) { console.error("[youtube_channels] load:", await res.text()); return []; }
    const { channels } = await res.json() as { channels: YoutubeChannel[] };
    return channels ?? [];
  } catch (e) { console.error("[youtube_channels] load:", e); return []; }
}

async function saveChannel(ch: Omit<YoutubeChannel, "id" | "created_at">): Promise<{ data: YoutubeChannel | null; error: string | null }> {
  try {
    const res = await fetch("/api/youtube-db/channels", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(ch),
    });
    const json = await res.json() as { channel?: YoutubeChannel; error?: string };
    if (!res.ok) return { data: null, error: json.error ?? "저장 실패" };
    return { data: json.channel ?? null, error: null };
  } catch (e) { return { data: null, error: String(e) }; }
}

async function deleteChannel(channelId: string): Promise<void> {
  await fetch("/api/youtube-db/channels", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ channel_id: channelId }),
  });
}

// ── Panel: 수동 요약 ───────────────────────────────────────────────────────

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
  const [transcript, setTranscript] = useState("");
  const [step, setStep] = useState<SummarizeStep>("idle");
  const [statusMsg, setStatusMsg] = useState("");

  const [title, setTitle] = useState("");
  const [channel, setChannel] = useState("");
  const [summaryText, setSummaryText] = useState("");
  const [companies, setCompanies] = useState<string[]>([]);
  const [topics, setTopics] = useState<string[]>([]);
  const [macro, setMacro] = useState<string[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [aiModel, setAiModel] = useAiModel();
  const limitGuard = useAiLimitGuard(setAiModel);
  const [showModal, setShowModal] = useState(false);
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  async function runSummarize() {
    if (!transcript.trim()) return;
    setSaveError("");
    setStep("summarizing");
    setStatusMsg("AI 요약 중... (최대 60초 소요)");

    try {
      const res = await fetch("/api/youtube-summarize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          transcript,
          title: title || "(제목 없음)",
          channelName: channel,
          videoUrl: "",
          existingCompanies: allCompanies,
          existingTopics: allTopics,
          existingMacro: allMacro,
          model: aiModel,
        }),
      });
      const data = (await res.json()) as { summary?: string; companies?: string[]; topics?: string[]; macro?: string[]; error?: string };
      if (!res.ok || data.error) {
        if (isQuotaExceededMessage(data.error)) {
          limitGuard.trigger(() => void runSummarize());
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
      setStep("done");
      setStatusMsg("");
      setShowModal(true);
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
        video_id: "",
        video_url: "",
        title: title || "(제목 없음)",
        channel_name: channel,
        channel_id: "",
        summary: summaryText,
        companies,
        topics,
        macro,
        date: new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10),
      });
      if (saveErr || !result) {
        setSaveError(saveErr ?? "저장 실패: Supabase 연결 확인");
        return;
      }
      onSaved();
      setTranscript(""); setSummaryText(""); setCompanies([]); setTopics([]); setMacro([]);
      setTitle(""); setChannel("");
      setStep("idle");
      setShowModal(false);
    } catch (e) {
      setSaveError(`저장 오류: ${e instanceof Error ? e.message : "알 수 없는 오류"}`);
    } finally {
      setIsSaving(false);
    }
  }

  const isWorking = step === "summarizing";

  return (
    <div className="flex flex-col gap-4">
      {/* Script paste area */}
      <div className="flex flex-col gap-2">
        <label className="text-xs font-semibold text-[#5F7A70] uppercase tracking-wide">스크립트 붙여넣기</label>
        <textarea
          value={transcript}
          onChange={e => setTranscript(e.target.value)}
          rows={8}
          placeholder="유튜브 자막 또는 스크립트를 붙여넣으세요..."
          className="w-full rounded-md border border-[#DDE8E5] bg-white px-3 py-2 text-sm outline-none resize-y focus:border-[#005B52] focus:ring-1 focus:ring-[#005B52]"
          disabled={isWorking}
        />
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={title}
            onChange={e => setTitle(e.target.value)}
            placeholder="영상 제목 (선택)"
            className="flex-1 min-w-[160px] rounded-md border border-[#DDE8E5] bg-white px-3 py-2 text-sm outline-none focus:border-[#005B52] focus:ring-1 focus:ring-[#005B52]"
            disabled={isWorking}
          />
          <input
            value={channel}
            onChange={e => setChannel(e.target.value)}
            placeholder="채널명 (선택)"
            className="w-40 rounded-md border border-[#DDE8E5] bg-white px-3 py-2 text-sm outline-none focus:border-[#005B52] focus:ring-1 focus:ring-[#005B52]"
            disabled={isWorking}
          />
          <button
            type="button"
            onClick={runSummarize}
            disabled={!transcript.trim() || isWorking}
            className="shrink-0 rounded-md bg-[#005B52] px-5 py-2 text-sm font-semibold text-white disabled:opacity-40 hover:bg-[#155a3e] transition-colors"
          >
            {isWorking ? "처리 중..." : "요약하기"}
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

      {/* Result — 완료 시 팝업으로 표시, 닫아도 재오픈 가능 */}
      {step === "done" && summaryText && !showModal && (
        <button
          type="button"
          onClick={() => setShowModal(true)}
          className="self-start rounded-md border border-[#DDE8E5] bg-[#F6FAF8] px-4 py-2 text-sm font-semibold text-[#005B52] hover:bg-[#EDF7F2] transition-colors"
        >
          ✓ 요약 결과 보기
        </button>
      )}

      {step === "done" && summaryText && showModal && mounted && createPortal(
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4 sm:p-8"
          onClick={() => setShowModal(false)}
        >
          <div
            className="flex max-h-[85vh] w-full max-w-5xl flex-col overflow-hidden rounded-xl bg-white shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex flex-1 flex-col overflow-y-auto">
              {/* 헤더 */}
              <div className="sticky top-0 z-10 border-b border-[#E8F0ED] bg-white px-5 py-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 flex-1 flex-col gap-1">
                    <input
                      value={title}
                      onChange={e => setTitle(e.target.value)}
                      className="text-[15px] font-bold leading-snug text-[#1C3329] border-b border-transparent hover:border-[#DDE8E5] focus:border-[#005B52] outline-none bg-transparent w-full"
                      placeholder="영상 제목"
                    />
                    <input
                      value={channel}
                      onChange={e => setChannel(e.target.value)}
                      className="text-[11px] font-medium text-[#94A8A0] border-b border-transparent hover:border-[#DDE8E5] focus:border-[#005B52] outline-none bg-transparent w-full"
                      placeholder="채널명"
                    />
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    <button
                      type="button"
                      onClick={handleSave}
                      disabled={isSaving}
                      className={`flex min-w-[64px] items-center justify-center gap-1 rounded-md px-2.5 py-1.5 text-[12px] font-semibold transition ${
                        isSaving
                          ? "cursor-default border border-[#DDE8E5] bg-[#EEF4F1] text-[#94A8A0]"
                          : "bg-primary text-white hover:bg-primary-light"
                      }`}
                    >
                      {isSaving ? <Loader2 size={12} className="animate-spin" /> : <Bookmark size={12} />}
                      {isSaving ? "저장 중" : "저장"}
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowModal(false)}
                      className="rounded-md border border-[#DDE8E5] p-1.5 text-[#94A8A0] hover:bg-[#F6FAF8] transition"
                      title="닫기"
                    >
                      <X size={13} />
                    </button>
                  </div>
                </div>
              </div>

              {/* 본문 */}
              <div className="flex-1 px-5 py-5 space-y-4">
                {/* Tags */}
                <div className="flex flex-col gap-3">
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
                <div className="rounded-lg border border-[#E8F0ED] bg-[#F6FAF8] px-4 py-4">
                  <MarkdownView text={summaryText} />
                </div>

                {saveError && <p className="text-xs text-red-600">{saveError}</p>}
              </div>
            </div>
          </div>
        </div>
      , document.body)}

      <AiLimitModal open={limitGuard.open} onClose={limitGuard.close} onSelect={limitGuard.onSelect} />
    </div>
  );
}

// ── Panel: 저장 목록 ───────────────────────────────────────────────────────

function HistoryPanel({ summaries, onDelete }: { summaries: YoutubeSummary[]; onDelete: (id: string) => void }) {
  const [search, setSearch] = useState("");
  const [company, setCompany] = useState("");
  const [topic, setTopic] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [selected, setSelected] = useState<YoutubeSummary | null>(null);
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  const allCompanies = [...new Set(summaries.flatMap(s => s.companies))].sort();
  const allTopics = [...new Set(summaries.flatMap(s => s.topics))].sort();

  const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const q = search.toLowerCase();
  const filtered = summaries.filter(s => {
    // 기간을 직접 지정하면 기본 3일 제한 대신 지정 기간으로 조회
    if (fromDate || toDate) {
      if (!inDateRange(s.date || s.created_at, fromDate, toDate)) return false;
    } else if (s.date && s.date < threeDaysAgo) return false;
    if (company && !s.companies.includes(company)) return false;
    if (topic && !s.topics.includes(topic)) return false;
    if (!q) return true;
    return s.title.toLowerCase().includes(q) || s.channel_name.toLowerCase().includes(q);
  });

  return (
    <div className="flex flex-col gap-3">
      <SavedFilterBar
        search={search} onSearch={setSearch}
        company={company} onCompany={setCompany}
        topic={topic} onTopic={setTopic}
        allCompanies={allCompanies} allTopics={allTopics}
        fromDate={fromDate} onFromDate={setFromDate}
        toDate={toDate} onToDate={setToDate}
        placeholder="제목, 채널 검색..."
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
            date={`${s.channel_name} · ${s.date}`}
            topics={s.topics}
            companies={s.companies}
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
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex flex-1 flex-col overflow-y-auto">
              {/* 헤더 */}
              <div className="sticky top-0 z-10 border-b border-[#E8F0ED] bg-white px-5 py-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 flex-1 items-start gap-3">
                    {selected.video_id && (
                      <img
                        src={`https://img.youtube.com/vi/${selected.video_id}/mqdefault.jpg`}
                        alt={selected.title}
                        className="w-28 shrink-0 rounded-md border border-[#E8F0ED]"
                      />
                    )}
                    <div className="min-w-0">
                      <p className="text-[11px] font-medium text-[#94A8A0]">
                        {selected.channel_name} · {selected.date}
                      </p>
                      <p className="mt-1 text-[15px] font-bold leading-snug text-[#1C3329]">
                        {selected.title}
                      </p>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    {selected.video_url && (
                      <a
                        href={selected.video_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1 rounded-md border border-[#DDE8E5] px-2.5 py-1.5 text-[12px] font-medium text-[#5F7A70] hover:bg-[#F6FAF8] transition"
                      >
                        <ExternalLink size={12} />
                        원본
                      </a>
                    )}
                    <button
                      type="button"
                      onClick={() => { onDelete(selected.id); setSelected(null); }}
                      className="rounded-md border border-red-200 px-2.5 py-1.5 text-[12px] font-medium text-red-500 hover:bg-red-50 transition"
                    >
                      삭제
                    </button>
                    <button
                      type="button"
                      onClick={() => setSelected(null)}
                      className="rounded-md border border-[#DDE8E5] p-1.5 text-[#94A8A0] hover:bg-[#F6FAF8] transition"
                      title="닫기"
                    >
                      <X size={13} />
                    </button>
                  </div>
                </div>
              </div>

              {/* 본문 */}
              <div className="flex-1 px-5 py-5 space-y-4">
                {(selected.companies.length > 0 || selected.topics.length > 0 || selected.macro.length > 0) && (
                  <div className="flex flex-wrap gap-2">
                    {selected.topics.map(t => <TagChip key={t} label={t} color="green" />)}
                    {selected.companies.map(c => <TagChip key={c} label={c} color="blue" />)}
                    {selected.macro.map(m => <TagChip key={m} label={m} color="amber" />)}
                  </div>
                )}
                <div className="rounded-lg border border-[#E8F0ED] bg-[#F6FAF8] px-4 py-4">
                  <MarkdownView text={selected.summary} />
                </div>
              </div>
            </div>
          </div>
        </div>
      , document.body)}
    </div>
  );
}

// ── Panel: 구독한 채널 영상 ─────────────────────────────────────────────────

type FeedEditState = {
  step: SummarizeStep;
  statusMsg: string;
  summary: string;
  companies: string[];
  topics: string[];
  macro: string[];
  saving: boolean;
  saveError: string;
  saved: boolean;
  transcriptInput: string;
};

const FEED_EDIT_DEFAULT: FeedEditState = {
  step: "idle",
  statusMsg: "",
  summary: "",
  companies: [],
  topics: [],
  macro: [],
  saving: false,
  saveError: "",
  saved: false,
  transcriptInput: "",
};

const FEED_DEPTH_DEFAULT = 8;
const FEED_DEPTH_STEP = 8;
const SEARCH_DEPTH_DEFAULT = 15;
const SEARCH_DEPTH_STEP = 15;

/** URL 또는 @핸들 문자열에서 채널 ID를 추출 (해석 실패 시 원문 그대로 반환 — youtube-latest에서 재해석) */
function extractChannelId(chUrl: string): string {
  let channelId = chUrl.trim();
  const ucMatch = chUrl.match(/channel\/(UC[a-zA-Z0-9_-]{22})/);
  if (ucMatch) channelId = ucMatch[1];
  else {
    const handleMatch = chUrl.match(/@([a-zA-Z0-9_.-]+)/);
    if (handleMatch) channelId = `@${handleMatch[1]}`;
  }
  return channelId;
}

function LatestFeedPanel({
  channels,
  savedVideoIds,
  allCompanies,
  allTopics,
  allMacro,
  onSaved,
  onChannelsChange,
}: {
  channels: YoutubeChannel[];
  savedVideoIds: Set<string>;
  allCompanies: string[];
  allTopics: string[];
  allMacro: string[];
  onSaved: () => void;
  onChannelsChange: () => void;
}) {
  const [phase, setPhase] = useState<"idle" | "loading" | "list">("idle");

  // ── 폴더(Folder) 기능 상태 (Supabase 영속화) ─────────────────────────────
  const { folders, folderItems: folderChannels, addFolder, deleteFolder, renameFolder, toggleItem: toggleChannelInFolder } = useFolderStore("/api/youtube-db/folders");
  const [activeFolderId, setActiveFolderId] = useState<string>("all");
  const [isFolderModalOpen, setIsFolderModalOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [editingFolderId, setEditingFolderId] = useState<string>("core");

  // 폴더 이름 편집 상태
  const [editingFolderNameId, setEditingFolderNameId] = useState<string | null>(null);
  const [editingFolderNameValue, setEditingFolderNameValue] = useState<string>("");

  // 채널 추가 상태
  const [isAddChannelOpen, setIsAddChannelOpen] = useState(false);
  const [channelUrlInput, setChannelUrlInput] = useState("");
  const [channelNameInput, setChannelNameInput] = useState("");
  const [isAddingChannel, setIsAddingChannel] = useState(false);
  const [addChannelError, setAddChannelError] = useState("");

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
    if (!confirm("이 폴더를 삭제하시겠습니까? (폴더 안의 채널들은 삭제되지 않습니다)")) return;
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

  const filteredChannels = useMemo(() => {
    if (activeFolderId === "all") return channels;
    const allowed = folderChannels[activeFolderId] ?? [];
    return channels.filter((ch) => allowed.includes(ch.channel_id));
  }, [channels, activeFolderId, folderChannels]);

  // 채널 추가 핸들러
  const handleAddChannelSubmit = async () => {
    const urlVal = channelUrlInput.trim();
    const nameVal = channelNameInput.trim();
    if (!urlVal || !nameVal) return;
    setIsAddingChannel(true);
    setAddChannelError("");
    const res = await handleAddChannel(urlVal, nameVal);
    setIsAddingChannel(false);
    if (res.ok) {
      setChannelUrlInput("");
      setChannelNameInput("");
      setIsAddChannelOpen(false);
    } else {
      setAddChannelError(res.error ?? "채널 추가 실패");
    }
  };

  const [videos, setVideos] = useState<LatestVideo[]>([]);
  const [error, setError] = useState("");
  const [focusedVideoId, setFocusedVideoId] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);
  const [edits, setEdits] = useState<Record<string, FeedEditState>>({});
  const [channelFilter, setChannelFilter] = useState<string | null>(null);
  const [keyword, setKeyword] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [aiModel, setAiModel] = useAiModel();
  const limitGuard = useAiLimitGuard(setAiModel);
  const [deletedVideoIds, setDeletedVideoIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    fetch("/api/youtube-db/deleted")
      .then((res) => res.json())
      .then((data: { deletedVideoIds?: string[] }) => {
        if (data.deletedVideoIds) setDeletedVideoIds(new Set(data.deletedVideoIds));
      })
      .catch(console.error);
  }, []);

  const [searching, setSearching] = useState(false);
  const [depth, setDepth] = useState(FEED_DEPTH_DEFAULT);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  // 화면에는 항상 20건 단위로만 노출 — 서버가 이미 더 많이 가져왔어도 더보기를 눌러야 다음 20건이 보인다
  const [visibleCount, setVisibleCount] = useState(20);

  // 클릭한 영상 표시 — sharedUiState에 영속화해 다른 탭에 다녀와도 유지됨
  const { sharedUiState, updateSharedUiState } = useCustomerContext();
  const clickedVideoIds = new Set(sharedUiState.tab4?.youtubeClickedVideoIds ?? []);
  function markVideoClicked(videoId: string) {
    if (clickedVideoIds.has(videoId)) return;
    updateSharedUiState({ tab4: { youtubeClickedVideoIds: [...clickedVideoIds, videoId] } });
  }

  const loadFeed = useCallback(async () => {
    if (channels.length === 0) return;
    setPhase("loading");
    setError("");
    try {
      const res = await fetch("/api/youtube-latest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          channels: channels.map(c => ({ channelId: c.channel_id, channelName: c.channel_name })),
          perChannel: FEED_DEPTH_DEFAULT,
        }),
      });
      const data = (await res.json()) as { videos?: LatestVideo[]; error?: string };
      if (!res.ok) { setError(data.error ?? "최신 영상 조회 실패"); setPhase("idle"); return; }
      setVideos(data.videos ?? []);
      setDepth(FEED_DEPTH_DEFAULT);
      setHasMore(true);
      setVisibleCount(20);
      setPhase("list");
    } catch (e) {
      setError(`오류: ${e instanceof Error ? e.message : "알 수 없는 오류"}`);
      setPhase("idle");
    }
  }, [channels]);

  useEffect(() => { void loadFeed(); }, [loadFeed]);

  // ── 기간 지정 검색 — 최근 7일 제한 없이 지정 기간의 과거 영상까지 조회 ────────
  const searchPastVideos = useCallback(async () => {
    if (channels.length === 0 || (!fromDate && !toDate && !keyword.trim())) return;
    setSearching(true);
    setError("");
    try {
      const res = await fetch("/api/youtube-latest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          channels: channels.map(c => ({ channelId: c.channel_id, channelName: c.channel_name })),
          perChannel: SEARCH_DEPTH_DEFAULT,
          from: fromDate || undefined,
          to: toDate || undefined,
          keyword: keyword || undefined,
        }),
      });
      const data = (await res.json()) as { videos?: LatestVideo[]; error?: string };
      if (!res.ok) { setError(data.error ?? "검색 실패"); return; }
      setVideos(data.videos ?? []);
      setDepth(SEARCH_DEPTH_DEFAULT);
      setHasMore(true);
      setVisibleCount(20);
    } catch (e) {
      setError(`오류: ${e instanceof Error ? e.message : "알 수 없는 오류"}`);
    } finally {
      setSearching(false);
    }
  }, [channels, fromDate, toDate, keyword]);

  // ── 더보기 — 화면에는 20건씩만 노출. 이미 불러온 데이터 중 안 보여준 분량이 있으면
  // 네트워크 요청 없이 노출만 늘리고, 다 보여줬다면 채널당 조회 깊이를 늘려 재조회한다 ──────
  async function handleLoadMoreVideos() {
    if (channels.length === 0 || loadingMore) return;
    const nextVisible = visibleCount + 20;
    if (nextVisible <= filteredVideos.length) {
      setVisibleCount(nextVisible);
      return;
    }
    if (!hasMore) { setVisibleCount(nextVisible); return; }
    setLoadingMore(true);
    const isSearch = Boolean(fromDate || toDate || keyword.trim());
    const nextDepth = depth + (isSearch ? SEARCH_DEPTH_STEP : FEED_DEPTH_STEP);
    try {
      const res = await fetch("/api/youtube-latest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          channels: channels.map(c => ({ channelId: c.channel_id, channelName: c.channel_name })),
          perChannel: nextDepth,
          from: fromDate || undefined,
          to: toDate || undefined,
          keyword: keyword || undefined,
        }),
      });
      const data = (await res.json()) as { videos?: LatestVideo[]; error?: string };
      if (res.ok) {
        const list = data.videos ?? [];
        setHasMore(list.length > videos.length);
        setVideos(list);
        setDepth(nextDepth);
      }
    } catch {
      /* 조용히 무시 — 버튼은 다시 누를 수 있음 */
    } finally {
      setVisibleCount(nextVisible);
      setLoadingMore(false);
    }
  }

  // 삭제된 채널이 선택돼 있으면 필터 해제
  useEffect(() => {
    if (channelFilter && !channels.some(c => c.channel_id === channelFilter)) setChannelFilter(null);
  }, [channelFilter, channels]);

  async function handleDeleteChannel(channelId: string) {
    await deleteChannel(channelId);
    onChannelsChange();
  }

  async function handleDeleteVideo(videoId: string) {
    if (!confirm("이 영상을 삭제하시겠습니까?")) return;
    try {
      const res = await fetch("/api/youtube-db/deleted", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ videoId }),
      });
      if (!res.ok) throw new Error("삭제 실패");
      setDeletedVideoIds((prev) => new Set([...prev, videoId]));
      if (focusedVideoId === videoId) setFocusedVideoId(null);
    } catch {
      setError("영상 삭제 중 오류가 발생했습니다.");
    }
  }

  // ── 채널 추가 (사이드 패널: URL + 표시 이름 입력 → Enter 저장) ───────────────
  async function handleAddChannel(chUrl: string, chName: string): Promise<{ ok: boolean; error?: string }> {
    const { data, error } = await saveChannel({
      channel_id: extractChannelId(chUrl),
      channel_name: chName,
      channel_url: chUrl.startsWith("http") ? chUrl : `https://www.youtube.com/${chUrl}`,
      thumbnail_url: "",
    });
    if (error || !data) return { ok: false, error: error ?? "저장 실패: Supabase 연결 확인" };
    onChannelsChange();
    return { ok: true };
  }

  const patchEdit = (videoId: string, patch: Partial<FeedEditState>) => {
    setEdits(prev => ({ ...prev, [videoId]: { ...FEED_EDIT_DEFAULT, ...prev[videoId], ...patch } }));
  };

  function handleSelectVideo(video: LatestVideo) {
    setFocusedVideoId(video.videoId);
    markVideoClicked(video.videoId);
    if (!edits[video.videoId]) setEdits(prev => ({ ...prev, [video.videoId]: { ...FEED_EDIT_DEFAULT } }));
  }

  // 자막 자동 가져오기 (웹 스크래핑 → 실패 시 innertube ANDROID 우회는 서버에서 처리)
  async function handleAutoTranscript(video: LatestVideo) {
    patchEdit(video.videoId, { step: "fetching", statusMsg: "자막 가져오는 중…", saveError: "" });
    try {
      const res = await fetch(`/api/youtube-transcript?url=${encodeURIComponent(video.videoUrl)}`);
      const data = (await res.json()) as { transcript?: string | null; error?: string };
      if (data.transcript) {
        patchEdit(video.videoId, { step: "idle", statusMsg: "", transcriptInput: data.transcript });
        void handleSummarize(video, data.transcript);
      } else {
        patchEdit(video.videoId, { step: "error", statusMsg: data.error ?? "자막을 가져오지 못했습니다. 직접 붙여넣어 주세요." });
      }
    } catch (e) {
      patchEdit(video.videoId, { step: "error", statusMsg: `자막 오류: ${e instanceof Error ? e.message : "알 수 없는 오류"}` });
    }
  }

  async function handleSummarize(video: LatestVideo, transcript: string) {
    if (!transcript.trim()) return;
    patchEdit(video.videoId, { step: "summarizing", statusMsg: "AI 요약 중... (최대 60초 소요)", saveError: "" });

    try {
      const res = await fetch("/api/youtube-summarize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          transcript,
          title: video.title,
          channelName: video.channelName,
          videoUrl: video.videoUrl,
          existingCompanies: allCompanies,
          existingTopics: allTopics,
          existingMacro: allMacro,
          model: aiModel,
        }),
      });
      const data = (await res.json()) as { summary?: string; companies?: string[]; topics?: string[]; macro?: string[]; error?: string };
      if (!res.ok || data.error) {
        if (isQuotaExceededMessage(data.error)) {
          limitGuard.trigger(() => void handleSummarize(video, transcript));
          patchEdit(video.videoId, { step: "idle", statusMsg: "" });
          return;
        }
        patchEdit(video.videoId, { step: "error", statusMsg: data.error ?? "요약 실패" });
        return;
      }
      recordAiUsage(aiModel);
      patchEdit(video.videoId, {
        step: "done",
        statusMsg: "",
        summary: data.summary ?? "",
        companies: data.companies ?? [],
        topics: data.topics ?? [],
        macro: data.macro ?? [],
      });
    } catch (e) {
      patchEdit(video.videoId, { step: "error", statusMsg: `요약 오류: ${e instanceof Error ? e.message : "알 수 없는 오류"}` });
    }
  }

  async function handleSave(video: LatestVideo) {
    const edit = edits[video.videoId];
    if (!edit?.summary) return;
    patchEdit(video.videoId, { saving: true, saveError: "" });
    const { data: result, error: saveErr } = await saveSummary({
      video_id: video.videoId,
      video_url: video.videoUrl,
      title: video.title,
      channel_name: video.channelName,
      channel_id: video.channelId,
      summary: edit.summary,
      companies: edit.companies,
      topics: edit.topics,
      macro: edit.macro,
      date: new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10),
    });
    if (saveErr || !result) {
      patchEdit(video.videoId, { saving: false, saveError: saveErr ?? "저장 실패: Supabase 연결 확인" });
      return;
    }
    patchEdit(video.videoId, { saving: false, saved: true });
    onSaved();
  }

  const focusedVideo = focusedVideoId ? videos.find(v => v.videoId === focusedVideoId) ?? null : null;
  const focusedEdit = focusedVideoId ? edits[focusedVideoId] ?? FEED_EDIT_DEFAULT : FEED_EDIT_DEFAULT;
  const isWorking = focusedEdit.step === "fetching" || focusedEdit.step === "summarizing";
  const filteredVideos = videos.filter(v => {
    if (deletedVideoIds.has(v.videoId)) return false;
    if (channelFilter) {
      if (v.channelId !== channelFilter) return false;
    } else if (activeFolderId !== "all") {
      const allowedChannels = folderChannels[activeFolderId] ?? [];
      if (!allowedChannels.includes(v.channelId)) return false;
    }
    const kwLower = keyword.trim().toLowerCase();
    if (kwLower && !v.title.toLowerCase().includes(kwLower) && !v.channelName.toLowerCase().includes(kwLower)) return false;
    if (!inDateRange(v.publishedAt, fromDate, toDate)) return false;
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
              <p className="text-[13px] text-[#94A8A0]">구독 채널의 최신 영상을 불러오는 중...</p>
            </>
          ) : (
            <>
              <p className="text-[13px] text-[#94A8A0]">구독 채널의 최신 영상을 불러옵니다</p>
              <button
                type="button"
                onClick={loadFeed}
                className="rounded-lg bg-[#005B52] px-6 py-2.5 text-[13px] font-semibold text-white hover:bg-[#15583d] transition"
              >
                최신 영상 불러오기
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

      {/* 검색 + 기간 필터 */}
      <SearchDateBar
        keyword={keyword} onKeyword={setKeyword}
        fromDate={fromDate} onFromDate={setFromDate}
        toDate={toDate} onToDate={setToDate}
        searching={searching}
        onSubmit={() => void searchPastVideos()}
        onReset={() => { setKeyword(""); setFromDate(""); setToDate(""); void loadFeed(); }}
        placeholder="영상 제목·채널명 검색 (과거 영상 포함)"
      />

      {/* 영상 목록 — 텔레그램 스타일 3-Column 레이아웃 (폴더/채널 리스트 접기 기능 적용) */}
      <div className="flex h-[640px] overflow-hidden rounded-xl border border-[#DDE8E5] bg-white shadow-sm">
        {/* 접이식 사이드바 Wrapper (폴더 바 + 채널 목록) */}
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
                  const count = f.id === "all" ? channels.length : (folderChannels[f.id] ?? []).length;
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
                            const allowed = folderChannels[f.id] ?? [];
                            if (channelFilter && !allowed.includes(channelFilter)) {
                              setChannelFilter(null);
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

          {/* Column 2: 채널 목록 (폭 240px) */}
          <div className="w-[240px] shrink-0 border-r border-[#E8F0ED] flex flex-col bg-[#f5f8f7]">
            <div className="p-3 border-b border-[#E8F0ED] bg-white flex items-center justify-between">
              <span className="text-sm font-black text-[#0d2318] flex items-center gap-1.5">
                채널 목록
                <span className="bg-[#e2ede8] text-[#3c564b] px-1.5 py-0.5 rounded-md text-[10px] font-bold">
                  {filteredChannels.length}
                </span>
              </span>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setIsAddChannelOpen((v) => !v)}
                  className="p-1 hover:bg-[#eaf1ee] rounded text-[#5f7a70] transition"
                  title="채널 추가"
                >
                  <Plus size={16} />
                </button>
              </div>
            </div>

            {/* 채널 추가 폼 */}
            {isAddChannelOpen && (
              <div className="p-2.5 border-b border-[#E8F0ED] bg-white space-y-2">
                <input
                  type="text"
                  placeholder="https://www.youtube.com/@channelname"
                  value={channelUrlInput}
                  onChange={(e) => setChannelUrlInput(e.target.value)}
                  className="w-full text-xs rounded-md border border-[#DDE8E5] px-2 py-1.5 focus:border-primary focus:outline-none"
                  autoFocus
                />
                <input
                  type="text"
                  placeholder="채널 표시 이름"
                  value={channelNameInput}
                  onChange={(e) => setChannelNameInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") void handleAddChannelSubmit(); }}
                  className="w-full text-xs rounded-md border border-[#DDE8E5] px-2 py-1.5 focus:border-primary focus:outline-none"
                />
                {addChannelError && <p className="text-[10px] text-red-500">{addChannelError}</p>}
                <div className="flex justify-end gap-1.5">
                  <button
                    type="button"
                    onClick={() => { setIsAddChannelOpen(false); setChannelUrlInput(""); setChannelNameInput(""); setAddChannelError(""); }}
                    className="px-2 py-1 text-[10px] font-bold text-gray-500 hover:bg-gray-100 rounded"
                  >
                    취소
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleAddChannelSubmit()}
                    disabled={isAddingChannel}
                    className="px-2 py-1 text-[10px] font-bold bg-primary text-white rounded hover:bg-primary-light flex items-center gap-1"
                  >
                    {isAddingChannel && <Loader2 size={10} className="animate-spin" />} 등록
                  </button>
                </div>
              </div>
            )}

            {/* 채널 리스트 */}
            <div className="flex-1 overflow-y-auto min-h-0 py-1">
              {filteredChannels.length === 0 ? (
                <div className="p-4 text-center text-xs text-gray-400 font-semibold leading-relaxed">
                  등록된 채널이 없습니다.
                </div>
              ) : (
                <>
                  {/* 전체 모아보기 */}
                  <div
                    onClick={() => setChannelFilter(null)}
                    className={`px-3 py-2 text-xs font-bold transition cursor-pointer border-b border-[#f0f3f2] ${
                      channelFilter === null ? "bg-primary-50 text-primary" : "hover:bg-[#eaf1ee] text-[#1c3329]"
                    }`}
                  >
                    전체 모아보기 ({videos.length})
                  </div>
                  {filteredChannels.map((ch) => {
                    const isActive = channelFilter === ch.channel_id;
                    const initial = ch.channel_name ? ch.channel_name.trim().charAt(0) : "?";
                    const count = videos.filter(v => v.channelId === ch.channel_id).length;
                    return (
                      <div
                        key={ch.id}
                        className={`group flex items-center justify-between px-3 py-2.5 transition cursor-pointer border-b border-[#f0f3f2] ${
                          isActive ? "bg-primary text-white" : "hover:bg-[#eaf1ee] text-[#1c3329]"
                        }`}
                        onClick={() => setChannelFilter(ch.channel_id)}
                      >
                        <div className="flex items-center gap-2 min-w-0 flex-1">
                          <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${
                            isActive ? "bg-white/20 text-white" : "bg-[#dfede8] text-[#3c564b]"
                          }`}>
                            {initial}
                          </div>
                          <div className="min-w-0 flex-1">
                            <span className={`block truncate text-xs font-bold ${isActive ? "text-white" : "text-[#1C3329]"}`}>
                              {ch.channel_name}
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
                            if (confirm("이 채널을 구독 취소하시겠습니까?")) {
                              void handleDeleteChannel(ch.channel_id);
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

        {/* Column 3: 영상 목록 */}
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
                {channelFilter ? (
                  `${channels.find(c => c.channel_id === channelFilter)?.channel_name || ""} 영상 목록 · 전체 ${filteredVideos.length}건 중 ${Math.min(visibleCount, filteredVideos.length)}건`
                ) : (
                  `전체 영상 모아보기 · 전체 ${filteredVideos.length}건 중 ${Math.min(visibleCount, filteredVideos.length)}건`
                )}
              </span>
            </span>
          </div>

          {/* 본문 리스트 */}
          <div className="flex-1 overflow-y-auto">
            {filteredVideos.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-center">
                <Inbox size={28} className="mx-auto mb-2 text-[#B9CCC4]" />
                <p className="text-[13px] font-semibold text-[#5F7A70]">영상 없음</p>
              </div>
            ) : (
              <div className="divide-y divide-[#E8F0ED]">
                {filteredVideos.slice(0, visibleCount).map(video => {
                  const isFocused = focusedVideoId === video.videoId;
                  const isSaved = savedVideoIds.has(video.videoId) || edits[video.videoId]?.saved;
                  const isClicked = clickedVideoIds.has(video.videoId);
                  return (
                    <div
                      key={video.videoId}
                      role="button"
                      tabIndex={0}
                      onClick={() => handleSelectVideo(video)}
                      onKeyDown={(e) => {
                        if (e.key !== "Enter" && e.key !== " ") return;
                        e.preventDefault();
                        handleSelectVideo(video);
                      }}
                      className={`group flex w-full items-start gap-3 px-4 py-3 text-left transition cursor-pointer ${
                        isFocused ? "bg-emerald-50" : "hover:bg-[#F6FAF8]"
                      } ${isClicked && !isFocused ? "opacity-50" : ""}`}
                    >
                      <div className="relative w-5 h-5 shrink-0 flex items-center justify-center self-center">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            void handleDeleteVideo(video.videoId);
                          }}
                          className="absolute inset-0 z-10 flex items-center justify-center rounded bg-red-50 text-red-500 hover:bg-red-100 hover:text-red-700 opacity-0 group-hover:opacity-100 transition-opacity"
                          title="삭제"
                        >
                          <Minus size={13} strokeWidth={3} />
                        </button>
                        <div className="group-hover:opacity-0 w-1.5 h-1.5 rounded-full bg-slate-300 transition-opacity" />
                      </div>

                      <img
                        src={video.thumbnailUrl}
                        alt={video.title}
                        className="w-20 shrink-0 rounded border border-[#E8F0ED]"
                      />
                      <div className="min-w-0 flex-1">
                        <p className={`text-[13px] font-semibold leading-snug line-clamp-2 ${
                          isFocused ? "text-[#005B52]" : "text-[#1C3329] group-hover:text-[#005B52]"
                        }`}>
                          {video.title}
                        </p>
                        <p className="mt-0.5 text-[11px] text-[#94A8A0]">
                          {video.channelName} · {relativeDate(video.publishedAt)}
                          {video.viewCount != null && ` · 조회 ${video.viewCount.toLocaleString()}`}
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
            {(visibleCount < filteredVideos.length || hasMore) && filteredVideos.length >= 20 && (
              <div className="p-3">
                <button
                  type="button"
                  onClick={() => void handleLoadMoreVideos()}
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
      {focusedVideo && mounted && (() => {
        const element = (
          <div
            className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4 sm:p-8"
            onClick={() => setFocusedVideoId(null)}
          >
          <div
            className="flex max-h-[85vh] w-full max-w-5xl flex-col overflow-hidden rounded-xl bg-white shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex flex-1 flex-col overflow-y-auto">
              {/* 헤더 */}
              <div className="sticky top-0 z-10 border-b border-[#E8F0ED] bg-white px-5 py-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 flex-1 items-start gap-3">
                    <img
                      src={focusedVideo.thumbnailUrl}
                      alt={focusedVideo.title}
                      className="w-28 shrink-0 rounded-md border border-[#E8F0ED]"
                    />
                    <div className="min-w-0">
                      <p className="text-[11px] font-medium text-[#94A8A0]">
                        {focusedVideo.channelName} · {relativeDate(focusedVideo.publishedAt)}
                        {focusedVideo.viewCount != null && ` · 조회 ${focusedVideo.viewCount.toLocaleString()}`}
                      </p>
                      <p className="mt-1 text-[15px] font-bold leading-snug text-[#1C3329]">
                        {focusedVideo.title}
                      </p>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    {focusedEdit.step === "done" && (
                      <button
                        type="button"
                        onClick={() => handleSave(focusedVideo)}
                        disabled={focusedEdit.saving || focusedEdit.saved}
                        className={`flex min-w-[64px] items-center justify-center gap-1 rounded-md px-2.5 py-1.5 text-[12px] font-semibold transition ${
                          focusedEdit.saved
                            ? "cursor-default bg-emerald-100 text-emerald-700"
                            : focusedEdit.saving
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
                    )}
                    <a
                      href={focusedVideo.videoUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1 rounded-md border border-[#DDE8E5] px-2.5 py-1.5 text-[12px] font-medium text-[#5F7A70] hover:bg-[#F6FAF8] transition"
                    >
                      <ExternalLink size={12} />
                      원본
                    </a>
                    <button
                      type="button"
                      onClick={() => setFocusedVideoId(null)}
                      className="rounded-md border border-[#DDE8E5] p-1.5 text-[#94A8A0] hover:bg-[#F6FAF8] transition"
                      title="선택 해제"
                    >
                      <X size={13} />
                    </button>
                  </div>
                </div>
              </div>

              {/* 본문 */}
              <div className="flex-1 px-5 py-4 space-y-4">
                {(focusedEdit.step === "idle" || focusedEdit.step === "error") && (
                  <div className="flex flex-col gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => handleAutoTranscript(focusedVideo)}
                        className="rounded-md border border-[#005B52] px-4 py-2 text-sm font-semibold text-[#005B52] hover:bg-[#EDF7F2] transition"
                      >
                        자막 자동 가져오기 (우회 포함)
                      </button>
                    </div>
                    <p className="text-xs text-[#5F7A70]">
                      자동 가져오기가 실패하면 영상의 &quot;스크립트 표시&quot; 기능 등에서 자막을 복사해 붙여넣어 주세요.
                    </p>
                    <textarea
                      value={focusedEdit.transcriptInput}
                      onChange={e => patchEdit(focusedVideo.videoId, { transcriptInput: e.target.value })}
                      rows={6}
                      placeholder="유튜브 자막 또는 스크립트를 붙여넣으세요..."
                      className="w-full rounded-md border border-[#DDE8E5] bg-white px-3 py-2 text-sm outline-none resize-y focus:border-[#005B52] focus:ring-1 focus:ring-[#005B52]"
                    />
                    <button
                      type="button"
                      onClick={() => handleSummarize(focusedVideo, focusedEdit.transcriptInput)}
                      disabled={!focusedEdit.transcriptInput.trim() || isWorking}
                      className="self-end rounded-md bg-[#005B52] px-4 py-2 text-sm font-semibold text-white disabled:opacity-40 hover:bg-[#155a3e]"
                    >
                      자막으로 요약하기
                    </button>
                    {focusedEdit.step === "error" && (
                      <p className="text-xs text-red-600">{focusedEdit.statusMsg}</p>
                    )}
                  </div>
                )}

                {isWorking && (
                  <div className="rounded-md px-4 py-3 text-sm bg-blue-50 text-blue-700 border border-blue-100">
                    <span className="mr-2 animate-spin inline-block">⟳</span>
                    {focusedEdit.statusMsg}
                  </div>
                )}

                {focusedEdit.step === "done" && (
                  <>
                    {/* 태그 */}
                    <div className="flex flex-col gap-3">
                      <div>
                        <div className="mb-1.5 flex items-center gap-2">
                          <span className="text-xs font-semibold text-[#5F7A70] uppercase tracking-wide">Topic 태그</span>
                        </div>
                        <TagInput
                          tags={focusedEdit.topics}
                          onChange={tags => patchEdit(focusedVideo.videoId, { topics: tags })}
                          suggestions={allTopics}
                          color="green"
                          placeholder="+ 태그"
                        />
                      </div>
                      <div>
                        <div className="mb-1.5 flex items-center gap-2">
                          <span className="text-xs font-semibold text-[#5F7A70] uppercase tracking-wide">Company 태그</span>
                        </div>
                        <TagInput
                          tags={focusedEdit.companies}
                          onChange={tags => patchEdit(focusedVideo.videoId, { companies: tags })}
                          suggestions={allCompanies}
                          color="blue"
                          placeholder="+ 기업명"
                        />
                      </div>
                      <div>
                        <div className="mb-1.5 flex items-center gap-2">
                          <span className="text-xs font-semibold text-[#5F7A70] uppercase tracking-wide">Macro 태그</span>
                        </div>
                        <TagInput
                          tags={focusedEdit.macro}
                          onChange={tags => patchEdit(focusedVideo.videoId, { macro: tags })}
                          suggestions={allMacro}
                          color="amber"
                          placeholder="+ 매크로"
                        />
                      </div>
                    </div>

                    {/* 요약 */}
                    <div className="rounded-md border border-[#E8F0ED] bg-[#F6FAF8] p-4 h-auto">
                      <MarkdownView text={focusedEdit.summary} />
                    </div>

                    {focusedEdit.saveError && <p className="text-xs text-red-600">{focusedEdit.saveError}</p>}
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
        );
        return createPortal(element, document.body);
      })()}

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

              {/* 오른쪽: 채널 지정 */}
              <div className="flex-1 p-5 flex flex-col overflow-hidden">
                <div className="mb-4">
                  <h4 className="text-sm font-bold text-[#1C3329]">
                    {folders.find((f) => f.id === editingFolderId)?.name} 폴더 채널 지정
                  </h4>
                  <p className="text-[11px] text-[#94A8A0] mt-0.5">
                    이 폴더에 포함할 채널을 선택하세요.
                  </p>
                </div>

                {editingFolderId === "all" ? (
                  <div className="flex-1 flex items-center justify-center border border-dashed border-[#DDE8E5] rounded-lg bg-[#F6FAF8] p-8 text-center text-xs text-[#5F7A70] font-semibold">
                    '전체' 폴더는 등록된 모든 채널을 자동으로 보여줍니다. 별도의 채널 지정이 필요 없습니다.
                  </div>
                ) : (
                  <div className="flex-1 overflow-y-auto border border-[#E8F0ED] rounded-lg bg-white min-h-0">
                    {channels.length === 0 ? (
                      <div className="p-8 text-center text-xs text-gray-400 font-semibold">
                        등록된 채널이 없습니다. 먼저 채널을 추가하세요.
                      </div>
                    ) : (
                      <div className="divide-y divide-[#F0F7F4]">
                        {channels.map((ch) => {
                          const isChecked = (folderChannels[editingFolderId] ?? []).includes(ch.channel_id);
                          return (
                            <label
                              key={ch.id}
                              className="flex items-center justify-between px-4 py-3 hover:bg-[#F6FAF8] cursor-pointer transition select-none"
                            >
                              <div className="min-w-0 flex-1 pr-4">
                                <span className="block text-xs font-bold text-[#1C3329] truncate">{ch.channel_name}</span>
                                <span className="block text-[10px] text-gray-400 truncate">{ch.channel_id}</span>
                              </div>
                              <input
                                type="checkbox"
                                checked={isChecked}
                                onChange={() => toggleChannelInFolder(editingFolderId, ch.channel_id)}
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
create table if not exists youtube_summaries (
  id uuid primary key default gen_random_uuid(),
  video_id text not null default '',
  video_url text not null default '',
  title text not null default '',
  channel_name text default '',
  channel_id text default '',
  summary text default '',
  companies text[] default '{}',
  topics text[] default '{}',
  macro text[] default '{}',
  date date,
  created_at timestamptz default now()
);

create table if not exists youtube_channels (
  id uuid primary key default gen_random_uuid(),
  channel_id text unique not null,
  channel_name text not null,
  channel_url text default '',
  thumbnail_url text default '',
  created_at timestamptz default now()
);

-- 2. RLS 비활성화 (anon key로 읽기/쓰기 허용)
alter table youtube_summaries disable row level security;
alter table youtube_channels disable row level security;`;

// ── Main export ────────────────────────────────────────────────────────────

export function YoutubeDB() {
  const [activeTab, setActiveTab] = useState<"feed" | "new" | "history">("feed");
  const [summaries, setSummaries] = useState<YoutubeSummary[]>([]);
  const [channels, setChannels] = useState<YoutubeChannel[]>([]);
  const [isLoaded, setIsLoaded] = useState(false);
  const [showSql, setShowSql] = useState(false);

  const fetchAll = useCallback(async () => {
    const [s, c] = await Promise.all([loadSummaries(), loadChannels()]);
    setSummaries(s);
    setChannels(c);
    setIsLoaded(true);
  }, []);

  useEffect(() => { void fetchAll(); }, [fetchAll]);

  const allCompanies = [...new Set(summaries.flatMap(s => s.companies))].sort();
  const allTopics = [...new Set(summaries.flatMap(s => s.topics))].sort();
  const allMacro = [...new Set(summaries.flatMap(s => s.macro))].sort();
  const savedVideoIds = new Set(summaries.map(s => s.video_id));

  async function handleDelete(id: string) {
    if (!confirm("이 요약을 삭제하시겠습니까?")) return;
    await deleteSummary(id);
    setSummaries(prev => prev.filter(s => s.id !== id));
  }

  const tabItems: { id: "feed" | "new" | "history"; label: string; badge: number }[] = [
    { id: "feed", label: "구독한 채널", badge: channels.length },
    { id: "new", label: "직접 요약", badge: -1 },
    { id: "history", label: "저장됨", badge: summaries.length },
  ];

  const disabledFeatures = (process.env.NEXT_PUBLIC_DISABLED_FEATURES ?? "").split(",").map(s => s.trim());
  const youtubeKeyMissing = disabledFeatures.includes("youtube");

  return (
    <div className="flex flex-col gap-5">
      {youtubeKeyMissing && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-800">
          ⚠️ YouTube의 API키를 등록해주세요! (YOUTUBE_API_KEY) — 검색 및 조회수 기능이 비활성화 상태입니다.
        </div>
      )}
      <section className="rounded-card border border-[#DDE8E5] bg-white p-5 shadow-card">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary text-white">
              <Video size={22} />
            </span>
            <div>
              <h2 className="text-lg font-black text-[#0D2318]">유튜브 DB</h2>
              <p className="text-xs font-semibold text-[#7A9488]">
                구독 채널 및 개별 유튜브 영상의 실시간 AI 핵심 요약과 분석 데이터를 구축합니다
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
        {isLoaded && summaries.length === 0 && channels.length === 0 && (
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
            channels={channels}
            savedVideoIds={savedVideoIds}
            allCompanies={allCompanies}
            allTopics={allTopics}
            allMacro={allMacro}
            onSaved={() => void fetchAll()}
            onChannelsChange={() => void fetchAll()}
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
