"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowDownWideNarrow, Bookmark, Check, Clock, DownloadCloud, ExternalLink, Folder, Loader2, MessageSquare, Plus, RefreshCw, Send, Sparkles, TrendingUp, X } from "lucide-react";
import {
  AiLimitModal, EdgeSidebarPanel, SavedFilterBar, SavedListRow, SearchDateBar, TagEditSection, inDateRange,
  isQuotaExceededMessage, recordAiUsage, useAiLimitGuard, useAiModel, useFolderStore,
  type EdgeListItem,
} from "./shared";

const SidebarToggleIcon = ({ size = 16, className = "" }: { size?: number; className?: string }) => (
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
    className={className}
  >
    <rect width="18" height="18" x="3" y="3" rx="2" />
    <path d="M9 3v18" />
    <rect width="6" height="16" x="4" y="4" fill="currentColor" opacity="0.3" rx="1" />
  </svg>
);

/**
 * 텔레그램 DB — 채널별 최신 메시지 수집 · AI 요약(버튼) · 태그 · 정리 · Supabase 저장
 *  - 좌측 채널 목록 / 우측 메시지 목록, 메시지 클릭 시 모달 창
 *  - 조회수 정렬, 검색·기간 필터, 구독 채널 일괄 등록
 */

type Channel = { id: string; username: string; title: string };

type TgMessage = {
  id: number;
  date: string;
  text: string;
  importance: string;
  link: string;
  views: number | null;
  channel?: string; // 채널 미지정 전체 검색(searchAll) 결과에만 존재
};

type TopViewedMessage = TgMessage & { channel: string };

type SavedMessage = {
  id: string;
  channel: string;
  message_id: number | null;
  msg_date: string;
  text: string;
  link: string | null;
  summary: string;
  topic_tags: string[];
  company_tags: string[];
  macro_tags: string[];
  notes: string;
  created_at: string;
};

type DetailState = {
  summary: string;
  summarizing: boolean;
  summaryError: string;
  loadingTags: boolean;
  topics: string[];
  companies: string[];
  macro: string[];
  notes: string;
  saving: boolean;
  saved: boolean;
  showSummary: boolean;
};

const EMPTY_DETAIL: DetailState = {
  summary: "", summarizing: false, summaryError: "", loadingTags: false,
  topics: [], companies: [], macro: [], notes: "", saving: false, saved: false,
  showSummary: false,
};

const MSG_LIMIT_DEFAULT = 25;
const MSG_LIMIT_STEP = 25;
const MSG_SEARCH_LIMIT_DEFAULT = 100;
const MSG_SEARCH_LIMIT_STEP = 50;
// 전체 채널 검색(searchAll)은 "채널당" 조회 개수 기준 — 더보기가 이 값을 늘려 재조회한다
const CROSS_PER_CHANNEL_DEFAULT = 10;
const CROSS_PER_CHANNEL_STEP = 10;

export default function TelegramDbTab() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);
  const [channels, setChannels] = useState<Channel[]>([]);

  // ── 폴더(Folder) 기능 상태 (Supabase 영속화) ─────────────────────────────
  const { folders, folderItems: folderChannels, addFolder, deleteFolder, renameFolder, toggleItem: toggleChannelInFolder } = useFolderStore("/api/telegram-db/folders");
  const [activeFolderId, setActiveFolderId] = useState<string>("all");
  const [isFolderModalOpen, setIsFolderModalOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [editingFolderId, setEditingFolderId] = useState<string>("core");

  // 폴더 이름 편집 상태
  const [editingFolderNameId, setEditingFolderNameId] = useState<string | null>(null);
  const [editingFolderNameValue, setEditingFolderNameValue] = useState<string>("");

  // 사이드바 토글 상태
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);

  // 채널 간편 추가 상태
  const [isAddChannelOpen, setIsAddChannelOpen] = useState(false);
  const [channelInput, setChannelInput] = useState("");
  const [isAddingChannel, setIsAddingChannel] = useState(false);
  const [addChannelError, setAddChannelError] = useState("");

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
    return channels.filter((c) => allowed.includes(c.id));
  }, [channels, activeFolderId, folderChannels]);

  const handleAddChannel = async () => {
    const raw = channelInput.trim();
    if (!raw) return;
    setIsAddingChannel(true);
    setAddChannelError("");
    const res = await addChannel(raw);
    setIsAddingChannel(false);
    if (res.ok) {
      setChannelInput("");
      setIsAddChannelOpen(false);
    } else {
      setAddChannelError(res.error ?? "채널 추가 실패");
    }
  };

  const [channelsLoading, setChannelsLoading] = useState(true);
  const [activeChannel, setActiveChannel] = useState<Channel | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncNotice, setSyncNotice] = useState("");
  const [messages, setMessages] = useState<TgMessage[]>([]);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [error, setError] = useState("");
  const [focused, setFocused] = useState<TgMessage | null>(null);
  const [focusedChannelName, setFocusedChannelName] = useState("");
  const [focusedSavedRow, setFocusedSavedRow] = useState<SavedMessage | null>(null);
  const [detail, setDetail] = useState<DetailState>(EMPTY_DETAIL);
  const [viewMode, setViewMode] = useState<"browse" | "saved" | "top">("browse");
  const [topViewed, setTopViewed] = useState<TopViewedMessage[]>([]);
  const [topViewedLoading, setTopViewedLoading] = useState(false);
  const [topViewedError, setTopViewedError] = useState("");
  const [savedRows, setSavedRows] = useState<SavedMessage[]>([]);
  const [sortByViews, setSortByViews] = useState(false);
  const [keyword, setKeyword] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [savedCompany, setSavedCompany] = useState("");
  const [savedTopic, setSavedTopic] = useState("");
  const [crossChannelMode, setCrossChannelMode] = useState(false); // true면 messages가 "전체 채널 검색" 결과
  const [aiModel, setAiModel] = useAiModel();
  const limitGuard = useAiLimitGuard(setAiModel);
  const [searching, setSearching] = useState(false);
  const [msgLimit, setMsgLimit] = useState(MSG_LIMIT_DEFAULT);
  const [loadingMoreMsgs, setLoadingMoreMsgs] = useState(false);
  const [msgsHasMore, setMsgsHasMore] = useState(true);
  // 화면에는 항상 20건 단위로만 노출 — 서버가 이미 더 많이 가져왔어도 더보기를 눌러야 다음 20건이 보인다
  const [visibleCount, setVisibleCount] = useState(20);

  const savedLinks = useMemo(() => new Set(savedRows.map((r) => r.link)), [savedRows]);
  const allSavedCompanies = useMemo(() => [...new Set(savedRows.flatMap((r) => r.company_tags))].sort(), [savedRows]);
  const allSavedTopics = useMemo(() => [...new Set(savedRows.flatMap((r) => r.topic_tags))].sort(), [savedRows]);

  const [visitedLinks, setVisitedLinks] = useState<Set<string>>(() => {
    if (typeof window === "undefined") return new Set();
    try {
      const stored = localStorage.getItem("telegram_visited_links");
      return new Set(stored ? (JSON.parse(stored) as string[]) : []);
    } catch { return new Set(); }
  });
  useEffect(() => {
    try { localStorage.setItem("telegram_visited_links", JSON.stringify([...visitedLinks])); } catch {}
  }, [visitedLinks]);

  // ── 채널/저장 목록 로드 ────────────────────────────────────────────────────
  const loadChannels = useCallback(async () => {
    setChannelsLoading(true);
    try {
      const res = await fetch("/api/telegram-db?action=channels");
      const json = await res.json();
      if (res.ok) setChannels(json.channels ?? []);
      else setError(json.error ?? "채널 목록 로드 실패");
    } catch {} finally {
      setChannelsLoading(false);
    }
  }, []);

  const loadSaved = useCallback(async () => {
    try {
      const res = await fetch("/api/telegram-db?action=saved");
      const json = await res.json();
      if (res.ok) setSavedRows(json.messages ?? []);
    } catch {}
  }, []);

  // ── 채널 메시지 로드 ───────────────────────────────────────────────────────
  const loadMessages = useCallback(async (channel: Channel) => {
    setActiveChannel(channel);
    setCrossChannelMode(false);
    setFocused(null);
    setMessagesLoading(true);
    setError("");
    setMsgLimit(MSG_LIMIT_DEFAULT);
    setMsgsHasMore(true);
    setVisibleCount(20);
    try {
      const res = await fetch(`/api/telegram-db?action=messages&username=${encodeURIComponent(channel.username)}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "메시지 로드 실패");
      setMessages(json.messages ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "메시지 로드 실패");
      setMessages([]);
    } finally {
      setMessagesLoading(false);
    }
  }, []);

  useEffect(() => { void loadChannels(); void loadSaved(); }, [loadChannels, loadSaved]);

  // ── 조회수 상위 — 등록된 채널 전체에서 현재 기준 조회수가 가장 높은 글 10개 ─────
  const loadTopViewed = useCallback(async () => {
    setTopViewedLoading(true);
    setTopViewedError("");
    try {
      const res = await fetch("/api/telegram-db?action=topViewed");
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "조회수 상위 조회 실패");
      setTopViewed(json.messages ?? []);
    } catch (e) {
      setTopViewedError(e instanceof Error ? e.message : "조회수 상위 조회 실패");
    } finally {
      setTopViewedLoading(false);
    }
  }, []);

  // ── 키워드/기간으로 채널 히스토리 검색 (최근 목록에 없는 과거 메시지 조회) ──────
  // 채널을 선택한 상태면 그 채널만, 채널 미선택 상태에서 키워드만 있으면 등록된 채널 전체를 대상으로 검색한다.
  const searchMessages = useCallback(async () => {
    if (!activeChannel && !keyword.trim()) return;
    setSearching(true);
    setMessagesLoading(true);
    setError("");
    setMsgsHasMore(true);
    setVisibleCount(20);
    try {
      if (activeChannel) {
        setMsgLimit(MSG_SEARCH_LIMIT_DEFAULT);
        const params = new URLSearchParams({ action: "messages", username: activeChannel.username, limit: String(MSG_SEARCH_LIMIT_DEFAULT) });
        if (keyword.trim()) params.set("keyword", keyword.trim());
        if (toDate) params.set("before", toDate);
        const res = await fetch(`/api/telegram-db?${params.toString()}`);
        const json = await res.json();
        if (!res.ok) throw new Error(json.error ?? "검색 실패");
        setMessages(json.messages ?? []);
        setCrossChannelMode(false);
      } else {
        setMsgLimit(CROSS_PER_CHANNEL_DEFAULT);
        const params = new URLSearchParams({ action: "searchAll", keyword: keyword.trim(), perChannel: String(CROSS_PER_CHANNEL_DEFAULT) });
        const res = await fetch(`/api/telegram-db?${params.toString()}`);
        const json = await res.json();
        if (!res.ok) throw new Error(json.error ?? "검색 실패");
        setMessages(json.messages ?? []);
        setCrossChannelMode(true);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "검색 실패");
    } finally {
      setMessagesLoading(false);
      setSearching(false);
    }
  }, [activeChannel, keyword, toDate]);

  // ── 더보기 — 화면에는 20건씩만 노출. 이미 불러온 데이터 중 안 보여준 분량이 있으면
  // 네트워크 요청 없이 노출만 늘리고, 다 보여줬다면 조회 개수를 늘려 재조회한다 ──────────
  async function handleLoadMoreMessages() {
    if (loadingMoreMsgs) return;
    const nextVisible = visibleCount + 20;
    if (nextVisible <= visibleMessages.length) {
      setVisibleCount(nextVisible);
      return;
    }
    if (!msgsHasMore) { setVisibleCount(nextVisible); return; }
    if (!activeChannel && !crossChannelMode) return;
    setLoadingMoreMsgs(true);
    try {
      let params: URLSearchParams;
      let nextLimit: number;
      if (crossChannelMode) {
        // 전체 채널 검색 — 채널당 조회 개수를 늘려 더 과거 메시지까지 재조회
        nextLimit = msgLimit + CROSS_PER_CHANNEL_STEP;
        params = new URLSearchParams({ action: "searchAll", keyword: keyword.trim(), perChannel: String(nextLimit) });
      } else {
        const isWide = Boolean(keyword.trim() || toDate);
        nextLimit = msgLimit + (isWide ? MSG_SEARCH_LIMIT_STEP : MSG_LIMIT_STEP);
        params = new URLSearchParams({ action: "messages", username: activeChannel!.username, limit: String(nextLimit) });
        if (keyword.trim()) params.set("keyword", keyword.trim());
        if (toDate) params.set("before", toDate);
      }
      const res = await fetch(`/api/telegram-db?${params.toString()}`);
      const json = await res.json();
      if (res.ok) {
        const list = json.messages ?? [];
        setMsgsHasMore(list.length > messages.length);
        setMessages(list);
        setMsgLimit(nextLimit);
      }
    } catch {
      /* 조용히 무시 — 버튼은 다시 누를 수 있음 */
    } finally {
      setVisibleCount(nextVisible);
      setLoadingMoreMsgs(false);
    }
  }

  // ── 채널 추가 (사이드 패널의 아이디 입력 → Enter 저장) ────────────────────────
  const addChannel = async (username: string): Promise<{ ok: boolean; error?: string }> => {
    setError("");
    try {
      const res = await fetch("/api/telegram-db", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "addChannel", username }),
      });
      const json = await res.json();
      if (!res.ok) return { ok: false, error: json.error ?? "채널 추가 실패" };
      await loadChannels();
      if (json.channel) void loadMessages(json.channel as Channel);
      return { ok: true };
    } catch (e) {
      const msg = e instanceof Error ? e.message : "채널 추가 실패";
      return { ok: false, error: msg };
    }
  };

  // ── 구독 채널 일괄 등록 ────────────────────────────────────────────────────
  const syncChannels = async () => {
    setSyncing(true);
    setSyncNotice("");
    setError("");
    try {
      const res = await fetch("/api/telegram-db", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "syncChannels" }),
      });
      const json = (await res.json()) as { added?: number; skipped?: number; error?: string };
      if (!res.ok) throw new Error(json.error ?? "채널 동기화 실패");
      setSyncNotice(`구독 채널 동기화 완료 — 신규 ${json.added ?? 0}개 등록, 기존 ${json.skipped ?? 0}개 유지`);
      await loadChannels();
    } catch (e) {
      setError(e instanceof Error ? e.message : "채널 동기화 실패");
    } finally {
      setSyncing(false);
    }
  };

  const removeChannel = async (id: string) => {
    if (!confirm("이 채널을 목록에서 제거하시겠습니까?")) return;
    await fetch("/api/telegram-db", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type: "channel", id }) });
    setChannels((prev) => prev.filter((c) => c.id !== id));
    if (activeChannel?.id === id) { setActiveChannel(null); setMessages([]); setFocused(null); }
  };

  // ── 메시지 선택: 원문만 표시, 태그 자동 (요약은 버튼) ───────────────────────
  const openMessage = (msg: TgMessage, channelNameOverride?: string) => {
    setFocused(msg);
    setVisitedLinks((prev) => (prev.has(msg.link) ? prev : new Set([...prev, msg.link])));
    setFocusedSavedRow(null);
    setFocusedChannelName(channelNameOverride ?? activeChannel?.title ?? activeChannel?.username ?? "");
    const savedRow = savedRows.find((r) => r.link === msg.link);
    setDetail({
      ...EMPTY_DETAIL,
      summary: savedRow?.summary ?? "",
      notes: savedRow?.notes ?? "",
      topics: savedRow?.topic_tags ?? [],
      companies: savedRow?.company_tags ?? [],
      macro: savedRow?.macro_tags ?? [],
      saved: !!savedRow,
      loadingTags: !savedRow,
    });

    if (!savedRow) {
      fetch("/api/hankyung-tag", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: msg.text.slice(0, 80), content: msg.text.slice(0, 4000), category: "economy" }),
      })
        .then((res) => res.json())
        .then((json: { topics?: string[]; companies?: string[]; macro?: string[] }) => {
          setDetail((d) => ({ ...d, loadingTags: false, topics: (json.topics ?? []).filter((t) => t !== "News"), companies: json.companies ?? [], macro: json.macro ?? [] }));
        })
        .catch(() => setDetail((d) => ({ ...d, loadingTags: false })));
    }
  };

  // ── 저장됨 목록에서 메시지 열기 (채널 미선택 상태에서도 모달이 열려야 함) ───────
  const openSavedMessage = (row: SavedMessage) => {
    setFocusedChannelName(row.channel);
    setFocusedSavedRow(row);
    setFocused({
      id: row.message_id ?? 0,
      date: row.msg_date,
      text: row.text,
      importance: "일반",
      link: row.link ?? "",
      views: null,
    });
    setDetail({
      ...EMPTY_DETAIL,
      summary: row.summary,
      notes: row.notes,
      topics: row.topic_tags,
      companies: row.company_tags,
      macro: row.macro_tags,
      saved: true,
      loadingTags: false,
    });
  };

  const closeModal = () => {
    setFocused(null);
    setFocusedSavedRow(null);
  };

  // ── AI 요약 (버튼 클릭 시에만 실행) ────────────────────────────────────────
  const summarize = (msg: TgMessage) => {
    if (detail.summary) {
      setDetail((d) => ({ ...d, showSummary: true }));
      return;
    }
    setDetail((d) => ({ ...d, summarizing: true, summaryError: "", showSummary: true }));
    fetch("/api/telegram-db", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "summarize", text: msg.text, model: aiModel }),
    })
      .then((res) => res.json())
      .then((json: { summary?: string; error?: string }) => {
        if (json.summary) {
          recordAiUsage(aiModel);
          setDetail((d) => ({ ...d, summarizing: false, summary: json.summary!, summaryError: "" }));
          return;
        }
        if (isQuotaExceededMessage(json.error)) {
          limitGuard.trigger(() => summarize(msg));
          setDetail((d) => ({ ...d, summarizing: false }));
          return;
        }
        setDetail((d) => ({ ...d, summarizing: false, summaryError: json.error ?? "요약 실패" }));
      })
      .catch(() => setDetail((d) => ({ ...d, summarizing: false, summaryError: "요약 요청 실패" })));
  };

  const saveMessage = async () => {
    if (!focused) return;
    setDetail((d) => ({ ...d, saving: true }));
    try {
      const res = await fetch("/api/telegram-db", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "saveMessage",
          channel: focusedChannelName || activeChannel?.title || activeChannel?.username || "",
          message_id: focused.id,
          msg_date: focused.date,
          text: focused.text,
          link: focused.link,
          summary: detail.summary,
          topic_tags: detail.topics,
          company_tags: detail.companies,
          macro_tags: detail.macro,
          notes: detail.notes.trim() ? detail.notes : focused.text,
        }),
      });
      if (res.ok) {
        setDetail((d) => ({ ...d, saving: false, saved: true }));
        void loadSaved();
      } else setDetail((d) => ({ ...d, saving: false }));
    } catch {
      setDetail((d) => ({ ...d, saving: false }));
    }
  };

  const deleteSaved = async (id: string) => {
    if (!confirm("이 저장 항목을 삭제하시겠습니까?")) return;
    await fetch("/api/telegram-db", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type: "message", id }) });
    setSavedRows((prev) => prev.filter((r) => r.id !== id));
    if (focusedSavedRow?.id === id) closeModal();
  };

  // ── 필터/정렬 파생값 ───────────────────────────────────────────────────────
  const visibleMessages = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    let list = messages.filter((m) =>
      (!kw || m.text.toLowerCase().includes(kw)) && inDateRange(m.date, fromDate, toDate));
    if (sortByViews) list = [...list].sort((a, b) => (b.views ?? -1) - (a.views ?? -1));
    return list;
  }, [messages, keyword, fromDate, toDate, sortByViews]);

  const filteredSaved = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    return savedRows.filter((r) =>
      (!kw || `${r.channel} ${r.text} ${r.summary} ${r.topic_tags.join(" ")} ${r.company_tags.join(" ")}`.toLowerCase().includes(kw))
      && (!savedCompany || r.company_tags.includes(savedCompany))
      && (!savedTopic || r.topic_tags.includes(savedTopic))
      && inDateRange(r.msg_date || r.created_at, fromDate, toDate));
  }, [savedRows, keyword, savedCompany, savedTopic, fromDate, toDate]);

  const importanceBadge = (importance: string) => (
    <span className={`rounded-full px-2 py-0.5 text-[10px] font-black ${
      importance.includes("긴급") ? "bg-red-50 text-red-600"
      : importance.includes("중요") ? "bg-blue-50 text-blue-700"
      : "bg-[#EEF4F1] text-[#5F7A70]"
    }`}>{importance}</span>
  );

  // ─────────────────────────────────────────────────────────────────────────
  const disabledFeatures = (process.env.NEXT_PUBLIC_DISABLED_FEATURES ?? "").split(",").map(s => s.trim());
  const telegramKeyMissing = disabledFeatures.includes("telegram");

  return (
    <div className="flex flex-col gap-5">
      {telegramKeyMissing && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-800">
          ⚠️ 텔레그램의 API키를 등록해주세요! (TELEGRAM_API_ID, TELEGRAM_API_HASH, TELEGRAM_SESSION) — 메시지 수집 기능이 비활성화 상태입니다.
        </div>
      )}
      <section className="rounded-card border border-[#DDE8E5] bg-white p-5 shadow-card">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary text-white">
              <Send size={22} />
            </span>
            <div>
              <h2 className="text-lg font-black text-[#0D2318]">텔레그램 DB</h2>
              <p className="text-xs font-semibold text-[#7A9488]">
                구독한 주요 투자 텔레그램 채널의 실시간 메시지를 수집하고 AI 핵심 요약을 제공합니다
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <div className="flex rounded-btn bg-[#F0F5F4] p-1">
              <button
                type="button"
                onClick={() => setViewMode("browse")}
                className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-bold transition ${
                  viewMode === "browse" ? "bg-primary text-white shadow-soft" : "text-[#4B6358] hover:text-primary"
                }`}
              >
                구독한 채널
              </button>
              <button
                type="button"
                onClick={() => { setViewMode("top"); void loadTopViewed(); }}
                className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-bold transition ${
                  viewMode === "top" ? "bg-primary text-white shadow-soft" : "text-[#4B6358] hover:text-primary"
                }`}
              >
                <TrendingUp size={13} /> 조회수 상위
              </button>
              <button
                type="button"
                onClick={() => { setViewMode("saved"); void loadSaved(); }}
                className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-bold transition ${
                  viewMode === "saved" ? "bg-primary text-white shadow-soft" : "text-[#4B6358] hover:text-primary"
                }`}
              >
                <Bookmark size={13} /> 저장됨
                <span className={`ml-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-bold ${
                  viewMode === "saved" ? "bg-white/20 text-white" : "bg-[#DFE9E5] text-[#5F7A70]"
                }`}>
                  {savedRows.length}
                </span>
              </button>
            </div>
          </div>
        </div>
      </section>

      <div className="rounded-xl border border-[#DDE8E5] bg-white p-6 shadow-sm overflow-hidden flex flex-col gap-4">

      {/* 검색 + 기간 필터 */}
      {viewMode === "browse" && (
        <SearchDateBar
          keyword={keyword} onKeyword={setKeyword}
          fromDate={fromDate} onFromDate={setFromDate}
          toDate={toDate} onToDate={setToDate}
          searching={searching}
          onSubmit={() => void searchMessages()}
          onReset={() => {
            setKeyword(""); setFromDate(""); setToDate("");
            if (activeChannel) void loadMessages(activeChannel);
            else { setMessages([]); setCrossChannelMode(false); }
          }}
          placeholder="메시지 내용 검색 (채널 선택 시 그 채널만, 미선택 시 등록된 채널 전체)"
        />
      )}
      {viewMode === "saved" && (
        <SavedFilterBar
          search={keyword} onSearch={setKeyword}
          company={savedCompany} onCompany={setSavedCompany}
          topic={savedTopic} onTopic={setSavedTopic}
          allCompanies={allSavedCompanies} allTopics={allSavedTopics}
          fromDate={fromDate} onFromDate={setFromDate}
          toDate={toDate} onToDate={setToDate}
          placeholder="저장 메시지 검색 (채널·내용·태그)"
        />
      )}
      {viewMode === "top" && (
        <div className="flex items-center justify-between">
          <p className="text-[11px] font-bold text-[#94A8A0]">등록된 채널 전체에서 오늘 게시된 글 중 조회수가 가장 높은 10개</p>
          <button type="button" onClick={() => void loadTopViewed()} disabled={topViewedLoading}
            className="flex items-center gap-1 text-[11px] font-bold text-[#4B6358] transition hover:text-primary disabled:opacity-50">
            <RefreshCw size={11} className={topViewedLoading ? "animate-spin" : ""} /> 새로고침
          </button>
        </div>
      )}

      {syncNotice && <p className="rounded-btn border border-[#DDE8E5] bg-[#F6FAF8] px-4 py-2 text-[12px] font-semibold text-[#33493F]">{syncNotice}</p>}
      {error && <p className="rounded-btn border border-red-200 bg-red-50 px-4 py-2.5 text-sm font-semibold text-red-600">{error}</p>}

      {viewMode === "saved" ? (
        /* 저장됨 뷰 */
        <div className="max-h-[640px] overflow-y-auto rounded-card border border-[#E8F0ED]">
          {filteredSaved.length === 0 ? (
            <p className="py-16 text-center text-sm font-bold text-[#94A8A0]">저장된 메시지가 없습니다.</p>
          ) : (
            filteredSaved.map((r, idx) => (
              <SavedListRow
                key={r.id}
                index={idx + 1}
                title={r.text}
                date={`${r.channel} · ${r.msg_date}`}
                topics={r.topic_tags}
                companies={r.company_tags}
                macro={r.macro_tags}
                onClick={() => openSavedMessage(r)}
                onDelete={() => void deleteSaved(r.id)}
              />
            ))
          )}
        </div>
      ) : viewMode === "top" ? (
        /* 조회수 상위 뷰 */
        <div className="max-h-[640px] overflow-y-auto rounded-card border border-[#E8F0ED]">
          {topViewedError ? (
            <p className="py-16 text-center text-sm font-bold text-red-500">{topViewedError}</p>
          ) : topViewedLoading ? (
            <p className="py-16 text-center text-sm font-bold text-[#94A8A0]">
              <Loader2 size={16} className="mr-1.5 inline animate-spin" /> 등록된 채널 전체에서 오늘 게시글의 조회수를 집계하는 중…
            </p>
          ) : topViewed.length === 0 ? (
            <p className="py-16 text-center text-sm font-bold text-[#94A8A0]">오늘 게시된 메시지가 없습니다. 채널을 먼저 등록하세요.</p>
          ) : (
            topViewed.map((m, idx) => {
              const isVisited = visitedLinks.has(m.link);
              const isSaved = savedLinks.has(m.link);
              return (
              <button key={`${m.channel}-${m.id}`} type="button" onClick={() => openMessage(m, m.channel)}
                className={`flex w-full items-start gap-2 border-b border-[#F0F7F4] px-4 py-3 text-left transition hover:bg-[#F6FAF8] ${isVisited ? "opacity-50" : ""}`}>
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <span className="flex items-center gap-2">
                    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#EEF4F1] text-[10px] font-bold text-[#5F7A70]">
                      {idx + 1}
                    </span>
                    {importanceBadge(m.importance)}
                    <span className="rounded-full bg-primary-100 px-2 py-0.5 text-[10px] font-black text-primary">{m.channel}</span>
                    <span className="text-[10px] font-semibold text-[#94A8A0]">{m.date}{m.views !== null && ` · 조회 ${m.views.toLocaleString()}`}</span>
                  </span>
                  <span className="line-clamp-3 whitespace-pre-wrap text-[12px] font-semibold leading-relaxed text-[#33493F]">
                    {m.text}
                  </span>
                </div>
                {isSaved && (
                  <span className="shrink-0 rounded bg-emerald-100 px-2 py-1 text-[12px] font-semibold text-emerald-700">
                    저장됨
                  </span>
                )}
              </button>
              );
            })
          )}
        </div>
      ) : (
        /* 브라우징 뷰: 텔레그램 스타일 3-Column 레이아웃 (폴더/채널 리스트 접기 기능 적용) */
        <div className="flex h-[640px] overflow-hidden rounded-card border border-[#E8F0ED] bg-white">
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
                              if (activeChannel && !allowed.includes(activeChannel.id)) {
                                setActiveChannel(null);
                                setMessages([]);
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
                  <button
                    type="button"
                    onClick={() => void syncChannels()}
                    disabled={syncing}
                    className="p-1 hover:bg-[#eaf1ee] rounded text-[#5f7a70] transition disabled:opacity-50"
                    title="구독 채널 동기화"
                  >
                    {syncing ? <Loader2 size={16} className="animate-spin" /> : <DownloadCloud size={16} />}
                  </button>
                </div>
              </div>

              {/* 채널 추가 폼 */}
              {isAddChannelOpen && (
                <div className="p-2.5 border-b border-[#E8F0ED] bg-white space-y-1.5">
                  <input
                    type="text"
                    placeholder="채널 아이디 (예: @yonhapstock)"
                    value={channelInput}
                    onChange={(e) => setChannelInput(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") void handleAddChannel(); }}
                    className="w-full text-xs rounded-md border border-[#DDE8E5] px-2 py-1.5 focus:border-primary focus:outline-none"
                    autoFocus
                  />
                  {addChannelError && <p className="text-[10px] text-red-500">{addChannelError}</p>}
                  <div className="flex justify-end gap-1.5">
                    <button
                      type="button"
                      onClick={() => { setIsAddChannelOpen(false); setChannelInput(""); setAddChannelError(""); }}
                      className="px-2 py-1 text-[10px] font-bold text-gray-500 hover:bg-gray-100 rounded"
                    >
                      취소
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleAddChannel()}
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
                {channelsLoading ? (
                  <div className="py-8 text-center text-xs text-gray-400 font-bold">채널 목록 로딩 중…</div>
                ) : filteredChannels.length === 0 ? (
                  <div className="p-4 text-center text-xs text-gray-400 font-semibold leading-relaxed">
                    이 폴더에 등록된 채널이 없습니다.
                  </div>
                ) : (
                  filteredChannels.map((c) => {
                    const isActive = activeChannel?.id === c.id;
                    const initial = c.title ? c.title.trim().charAt(0) : "?";
                    return (
                      <div
                        key={c.id}
                        className={`group flex items-center justify-between px-3 py-2.5 transition cursor-pointer border-b border-[#f0f3f2] ${
                          isActive ? "bg-primary text-white" : "hover:bg-[#eaf1ee] text-[#1c3329]"
                        }`}
                        onClick={() => void loadMessages(c)}
                      >
                        <div className="flex items-center gap-2 min-w-0 flex-1">
                          <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${
                            isActive ? "bg-white/20 text-white" : "bg-[#dfede8] text-[#3c564b]"
                          }`}>
                            {initial}
                          </div>
                          <div className="min-w-0 flex-1">
                            <span className={`block truncate text-xs font-bold ${isActive ? "text-white" : "text-[#1C3329]"}`}>
                              {c.title}
                            </span>
                            <span className={`block truncate text-[10px] ${isActive ? "text-white/70" : "text-gray-400"}`}>
                              @{c.username}
                            </span>
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            void removeChannel(c.id);
                          }}
                          className={`p-1 hover:bg-black/10 rounded transition opacity-0 group-hover:opacity-100 ${
                            isActive ? "text-white/80 hover:text-white" : "text-gray-400 hover:text-red-500"
                          }`}
                          title="채널 삭제"
                        >
                          <X size={12} />
                        </button>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </div>

          {/* Column 3: 메시지 목록 */}
          <div className="flex-1 flex flex-col min-w-0 h-full">
            {/* 상시 노출 상단 컨트롤 바 (사이드바 토글 버튼 포함) */}
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
                <span className="truncate max-w-[300px] md:max-w-md">
                  {activeChannel || crossChannelMode ? (
                    `${crossChannelMode ? "전체 채널 검색결과" : activeChannel?.title} · 전체 ${visibleMessages.length}건 중 ${Math.min(visibleCount, visibleMessages.length)}건 표시`
                  ) : (
                    "텔레그램 메시지 브라우저"
                  )}
                </span>
              </span>
              {(activeChannel || crossChannelMode) && (
                <span className="flex items-center gap-2">
                  <button type="button" onClick={() => setSortByViews((v) => !v)}
                    className={`flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-bold transition ${
                      sortByViews ? "bg-primary text-white" : "text-[#4B6358] hover:text-primary"
                    }`}>
                    {sortByViews ? <ArrowDownWideNarrow size={11} /> : <Clock size={11} />}
                    {sortByViews ? "조회수순" : "최신순"}
                  </button>
                  <button type="button" onClick={() => (crossChannelMode ? void searchMessages() : activeChannel && void loadMessages(activeChannel))}
                    className="flex items-center gap-1 text-[11px] font-bold text-[#4B6358] transition hover:text-primary">
                    <RefreshCw size={11} /> 새로고침
                  </button>
                </span>
              )}
            </div>

            {/* 본문 스크롤 영역 */}
            <div className="flex-1 overflow-y-auto min-h-0">
              {!activeChannel && !crossChannelMode ? (
                <div className="flex min-h-full flex-col items-center justify-center gap-2 py-16 text-[#B9CCC4]">
                  <MessageSquare size={28} />
                  <p className="text-sm font-bold">왼쪽 채널 목록에서 채널을 선택하거나, 위 검색창에 키워드를 입력해 등록된 채널 전체를 검색하세요</p>
                </div>
              ) : messagesLoading ? (
                <p className="py-16 text-center text-sm font-bold text-[#94A8A0]">
                  <Loader2 size={16} className="mr-1.5 inline animate-spin" />
                  {crossChannelMode ? "등록된 채널 전체에서 검색하는 중…" : `${activeChannel?.title} 메시지 불러오는 중…`}
                </p>
              ) : visibleMessages.length === 0 ? (
                <p className="py-16 text-center text-sm font-bold text-[#94A8A0]">표시할 메시지가 없습니다.</p>
              ) : (
                <>
                  {visibleMessages.slice(0, visibleCount).map((m) => {
                    const isVisited = visitedLinks.has(m.link);
                    const isSaved = savedLinks.has(m.link);
                    return (
                    <button key={`${m.channel ?? ""}-${m.id}`} type="button" onClick={() => openMessage(m, m.channel)}
                      className={`flex w-full items-start gap-2 border-b border-[#F0F7F4] px-4 py-3 text-left transition hover:bg-[#F6FAF8] ${isVisited ? "opacity-50" : ""}`}>
                      <div className="flex min-w-0 flex-1 flex-col gap-1">
                        <span className="flex items-center gap-2">
                          {importanceBadge(m.importance)}
                          {crossChannelMode && m.channel && (
                            <span className="rounded-full bg-primary-100 px-2 py-0.5 text-[10px] font-black text-primary">{m.channel}</span>
                          )}
                          <span className="text-[10px] font-semibold text-[#94A8A0]">{m.date}{m.views !== null && ` · 조회 ${m.views.toLocaleString()}`}</span>
                        </span>
                        <span className="line-clamp-3 whitespace-pre-wrap text-[12px] font-semibold leading-relaxed text-[#33493F]">
                          {m.text}
                        </span>
                      </div>
                      {isSaved && (
                        <span className="shrink-0 rounded bg-emerald-100 px-2 py-1 text-[12px] font-semibold text-emerald-700">
                          저장됨
                        </span>
                      )}
                    </button>
                    );
                  })}
                  {(visibleCount < visibleMessages.length || msgsHasMore) && visibleMessages.length >= 20 && (
                    <div className="p-3">
                      <button
                        type="button"
                        onClick={() => void handleLoadMoreMessages()}
                        disabled={loadingMoreMsgs}
                        className="flex w-full items-center justify-center gap-1.5 rounded-md border border-[#DDE8E5] py-2 text-[12px] font-medium text-[#5F7A70] hover:bg-[#F6FAF8] transition disabled:opacity-50"
                      >
                        {loadingMoreMsgs ? <Loader2 size={12} className="animate-spin" /> : null}
                        더 보기
                      </button>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 메시지 상세 모달 */}
      {focused && mounted && createPortal(
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4 sm:p-8" onClick={closeModal}>
          <div
            className={`flex max-h-[85vh] w-full flex-col overflow-hidden rounded-xl bg-white shadow-2xl transition-all duration-300 ${
              viewMode === "saved" ? "max-w-5xl" : "max-w-7xl"
            }`}
            onClick={(e) => e.stopPropagation()}
          >
            {viewMode === "saved" ? (
              /* ── 저장목록 간소화 뷰: 정리가 있으면 정리만, 없으면 원문 (News/Blog/Report DB와 동일) ── */
              <div className="flex flex-1 flex-col overflow-y-auto">
                <div className="sticky top-0 z-10 border-b border-[#E8F0ED] bg-white px-5 py-4">
                  <div className="flex items-start justify-between gap-3">
                    <span className="flex flex-wrap items-center gap-2">
                      {importanceBadge(focused.importance)}
                      <span className="text-[11px] font-semibold text-[#94A8A0]">{focusedChannelName} · {focused.date}</span>
                    </span>
                    <span className="flex shrink-0 items-center gap-1.5">
                      {focused.link && (
                        <a href={focused.link} target="_blank" rel="noreferrer"
                          className="flex items-center gap-1 rounded-md border border-[#DDE8E5] px-2.5 py-1.5 text-[12px] font-medium text-[#5F7A70] hover:bg-[#F6FAF8] transition">
                          <ExternalLink size={12} /> 원본
                        </a>
                      )}
                      {focusedSavedRow && (
                        <button type="button" onClick={() => void deleteSaved(focusedSavedRow.id)}
                          className="rounded-md border border-red-200 px-2.5 py-1.5 text-[12px] font-medium text-red-500 hover:bg-red-50 transition">
                          삭제
                        </button>
                      )}
                      <button type="button" onClick={closeModal}
                        className="rounded-md border border-[#DDE8E5] p-1.5 text-[#94A8A0] hover:bg-[#F6FAF8] transition"><X size={13} /></button>
                    </span>
                  </div>
                </div>
                <div className="flex-1 space-y-4 px-5 py-5">
                  <TagEditSection
                    companies={focusedSavedRow?.company_tags ?? []}
                    topics={focusedSavedRow?.topic_tags ?? []}
                    macro={focusedSavedRow?.macro_tags ?? []}
                    readOnly
                  />
                  <p className="whitespace-pre-wrap text-[17px] font-normal leading-relaxed text-[#33493F]">
                    {focusedSavedRow?.notes?.trim() ? focusedSavedRow.notes : (focusedSavedRow?.text ?? focused.text)}
                  </p>
                </div>
              </div>
            ) : (
            <div className="flex flex-1 flex-col overflow-hidden">
              {/* 헤더 */}
              <div className="border-b border-[#E8F0ED] bg-white px-5 py-4">
                <div className="flex items-start justify-between gap-3">
                  <span className="flex flex-wrap items-center gap-2">
                    {importanceBadge(focused.importance)}
                    <span className="text-[11px] font-semibold text-[#94A8A0]">{focusedChannelName} · {focused.date}{focused.views !== null && ` · 조회 ${focused.views.toLocaleString()}`}</span>
                  </span>
                  <span className="flex shrink-0 items-center gap-1.5">
                    <button type="button" onClick={() => void saveMessage()} disabled={detail.saving || detail.saved}
                      className={`flex min-w-[64px] items-center justify-center gap-1 rounded-md px-2.5 py-1.5 text-[12px] font-semibold transition ${
                        detail.saving || detail.saved ? "cursor-default border border-[#DDE8E5] bg-[#EEF4F1] text-[#94A8A0]" : "bg-primary text-white hover:bg-primary-light"
                      }`}>
                      {detail.saving ? <Loader2 size={12} className="animate-spin" /> : detail.saved ? <Check size={12} /> : <Bookmark size={12} />}
                      {detail.saving ? "저장 중" : detail.saved ? "저장됨" : "저장"}
                    </button>
                    <button type="button" onClick={() => summarize(focused)} disabled={detail.summarizing}
                      className="flex items-center gap-1 rounded-md border border-[#DDE8E5] px-2.5 py-1.5 text-[12px] font-semibold text-[#5F7A70] hover:bg-[#F6FAF8] disabled:opacity-40 transition">
                      {detail.summarizing ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
                      AI 요약
                    </button>
                    {focused.link && (
                      <a href={focused.link} target="_blank" rel="noreferrer"
                        className="flex items-center gap-1 rounded-md border border-[#DDE8E5] px-2.5 py-1.5 text-[12px] font-semibold text-[#5F7A70] hover:bg-[#F6FAF8] transition">
                        <ExternalLink size={12} /> 원본
                      </a>
                    )}
                    <button type="button" onClick={closeModal}
                      className="rounded-md border border-[#DDE8E5] p-1.5 text-[#94A8A0] hover:bg-[#F6FAF8] transition"><X size={13} /></button>
                  </span>
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

                {/* AI 요약 (버튼 실행 후에만 표시) */}
                {detail.showSummary && (detail.summarizing || detail.summary || detail.summaryError) && (
                  <div className="rounded-btn border border-[#E8F0ED] bg-[#F6FAF8] p-3.5">
                    <p className="mb-1.5 flex items-center gap-1.5 text-[11px] font-black text-primary"><Sparkles size={12} /> AI 요약</p>
                    {detail.summarizing ? (
                      <p className="flex items-center gap-2 text-[13px] font-bold text-[#94A8A0]"><Loader2 size={13} className="animate-spin" /> 요약 생성 중…</p>
                    ) : detail.summary ? (
                      <p className="text-[17px] font-bold leading-relaxed text-[#1C3329]">{detail.summary}</p>
                    ) : (
                      <p className="text-[17px] font-semibold text-red-500">{detail.summaryError}</p>
                    )}
                  </div>
                )}

                {/* 원문 */}
                <div>
                  <label className="mb-1.5 block text-[11px] font-bold uppercase tracking-wide text-[#94A8A0]">원문</label>
                  <div className="h-auto rounded-btn border border-[#E8F0ED] bg-[#F6FAF8] p-3.5">
                    <p className="whitespace-pre-wrap text-[17px] font-normal leading-relaxed text-[#33493F]">{focused.text}</p>
                  </div>
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
                    placeholder="메시지를 읽고 직접 정리한 내용을 입력하세요..."
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

      </div>

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
                        {channels.map((c) => {
                          const isChecked = (folderChannels[editingFolderId] ?? []).includes(c.id);
                          return (
                            <label
                              key={c.id}
                              className="flex items-center justify-between px-4 py-3 hover:bg-[#F6FAF8] cursor-pointer transition select-none"
                            >
                              <div className="min-w-0 flex-1 pr-4">
                                <span className="block text-xs font-bold text-[#1C3329] truncate">{c.title}</span>
                                <span className="block text-[10px] text-gray-400 truncate">@{c.username}</span>
                              </div>
                              <input
                                type="checkbox"
                                checked={isChecked}
                                onChange={() => toggleChannelInFolder(editingFolderId, c.id)}
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
    </div>
  );
}
