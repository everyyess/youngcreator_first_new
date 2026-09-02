"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronLeft, Cpu, Loader2, Plus, RefreshCw, Search, X } from "lucide-react";

/**
 * TAB4 공용 컴포넌트
 *  - TagChip / TagEditSection : Company(주황)·Topic(초록) 태그 통일 스타일 + 추가/삭제
 *  - useAiModel               : 선택 모델 저장 (localStorage)
 *  - AiLimitModal             : AI 한도 초과 시에만 뜨는 모델 전환 팝업 (모델별 잔여 한도 표시)
 */

// ── 폴더(Folder) 기능 — 서버(Supabase) 영속화 공용 훅 ─────────────────────────
// 블로그/유튜브/텔레그램 세 탭이 동일한 폴더 CRUD를 쓰므로 훅 하나로 공유한다.
// 예전엔 localStorage에만 저장되어 브라우저/기기가 바뀌면 초기화되던 문제가 있었다.

export type FolderItem = { id: string; name: string; icon: "all" | "folder" };

const ALL_FOLDER: FolderItem = { id: "all", name: "전체", icon: "all" };

export function useFolderStore(apiPath: string) {
  const [folders, setFolders] = useState<FolderItem[]>([ALL_FOLDER]);
  const [folderItems, setFolderItems] = useState<Record<string, string[]>>({});

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(apiPath);
        const data = await res.json() as { folders?: { id: string; name: string }[]; items?: Record<string, string[]> };
        setFolders([ALL_FOLDER, ...(data.folders ?? []).map((f) => ({ ...f, icon: "folder" as const }))]);
        setFolderItems(data.items ?? {});
      } catch { /* 네트워크 오류 시 기본값(전체 폴더만) 유지 */ }
    })();
  }, [apiPath]);

  const postAction = (body: Record<string, unknown>) =>
    fetch(apiPath, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).catch(() => {});

  const addFolder = async (name: string) => {
    const res = await fetch(apiPath, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "createFolder", name }),
    });
    const data = await res.json() as { folder?: { id: string; name: string } };
    if (data.folder) {
      setFolders((prev) => [...prev, { ...data.folder!, icon: "folder" }]);
      setFolderItems((prev) => ({ ...prev, [data.folder!.id]: [] }));
    }
    return data.folder;
  };

  const deleteFolder = (id: string) => {
    setFolders((prev) => prev.filter((f) => f.id !== id));
    setFolderItems((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    postAction({ action: "deleteFolder", id });
  };

  const renameFolder = (id: string, name: string) => {
    setFolders((prev) => prev.map((f) => (f.id === id ? { ...f, name } : f)));
    postAction({ action: "renameFolder", id, name });
  };

  const toggleItem = (folderId: string, itemId: string) => {
    if (folderId === "all") return;
    const has = (folderItems[folderId] ?? []).includes(itemId);
    setFolderItems((prev) => {
      const list = prev[folderId] ?? [];
      const nextList = has ? list.filter((v) => v !== itemId) : [...list, itemId];
      return { ...prev, [folderId]: nextList };
    });
    postAction({ action: has ? "removeItem" : "addItem", folderId, itemId });
  };

  return { folders, folderItems, addFolder, deleteFolder, renameFolder, toggleItem };
}

// ── 태그 칩 ───────────────────────────────────────────────────────────────────

export type TagKind = "company" | "topic" | "macro";

const TAG_CLS: Record<TagKind, string> = {
  company: "bg-blue-50 border-blue-200 text-blue-700",
  topic: "bg-emerald-50 border-emerald-200 text-emerald-700",
  macro: "bg-amber-50 border-amber-200 text-amber-700",
};

export function TagChip({
  label, kind, onRemove,
}: {
  label: string;
  kind: TagKind;
  onRemove?: () => void;
}) {
  return (
    <span className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[12px] font-semibold ${TAG_CLS[kind]}`}>
      {label}
      {onRemove && (
        <button type="button" onClick={onRemove} className="opacity-50 hover:opacity-100">
          <X size={10} />
        </button>
      )}
    </span>
  );
}

/** Topic / Company / Macro 태그를 줄바꿈으로 구분해 보여주고, 추가 입력까지 지원하는 섹션 */
export function TagEditSection({
  companies, topics, macro = [], onCompaniesChange, onTopicsChange, onMacroChange, loading, readOnly,
}: {
  companies: string[];
  topics: string[];
  macro?: string[];
  onCompaniesChange?: (next: string[]) => void;
  onTopicsChange?: (next: string[]) => void;
  onMacroChange?: (next: string[]) => void;
  loading?: boolean;
  readOnly?: boolean;
}) {
  const [companyInput, setCompanyInput] = useState("");
  const [topicInput, setTopicInput] = useState("");
  const [macroInput, setMacroInput] = useState("");

  const add = (kind: TagKind, raw: string) => {
    const v = raw.replace(",", "").trim();
    if (!v) return;
    if (kind === "company") {
      if (!companies.includes(v)) onCompaniesChange?.([...companies, v]);
      setCompanyInput("");
    } else if (kind === "topic") {
      if (!topics.includes(v)) onTopicsChange?.([...topics, v]);
      setTopicInput("");
    } else {
      if (!macro.includes(v)) onMacroChange?.([...macro, v]);
      setMacroInput("");
    }
  };

  if (loading) {
    return <p className="text-[11px] font-bold text-[#94A8A0]">태그 분석 중…</p>;
  }

  return (
    <div className="space-y-3">
      <div>
        <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-[#94A8A0]">
          Topic 태그
        </label>
        <div className="flex flex-wrap items-center gap-1.5">
          {topics.map((t) => (
            <TagChip key={t} label={t} kind="topic"
              onRemove={readOnly ? undefined : () => onTopicsChange?.(topics.filter((x) => x !== t))} />
          ))}
          {!readOnly && (
            <input
              type="text" value={topicInput}
              onChange={(e) => setTopicInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === ",") { e.preventDefault(); add("topic", topicInput); } }}
              placeholder="+ 태그"
              className="w-20 rounded-full border border-dashed border-emerald-300 px-2.5 py-1 text-[12px] text-[#5F7A70] placeholder:text-[#94A8A0] focus:border-emerald-400 focus:outline-none"
            />
          )}
        </div>
      </div>
      <div>
        <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-[#94A8A0]">
          Company 태그
        </label>
        <div className="flex flex-wrap items-center gap-1.5">
          {companies.map((t) => (
            <TagChip key={t} label={t} kind="company"
              onRemove={readOnly ? undefined : () => onCompaniesChange?.(companies.filter((x) => x !== t))} />
          ))}
          {!readOnly && (
            <input
              type="text" value={companyInput}
              onChange={(e) => setCompanyInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === ",") { e.preventDefault(); add("company", companyInput); } }}
              placeholder="+ 기업명"
              className="w-24 rounded-full border border-dashed border-blue-300 px-2.5 py-1 text-[12px] text-[#5F7A70] placeholder:text-[#94A8A0] focus:border-blue-400 focus:outline-none"
            />
          )}
        </div>
      </div>
      <div>
        <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-[#94A8A0]">
          Macro 태그
        </label>
        <div className="flex flex-wrap items-center gap-1.5">
          {macro.map((t) => (
            <TagChip key={t} label={t} kind="macro"
              onRemove={readOnly ? undefined : () => onMacroChange?.(macro.filter((x) => x !== t))} />
          ))}
          {!readOnly && (
            <input
              type="text" value={macroInput}
              onChange={(e) => setMacroInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === ",") { e.preventDefault(); add("macro", macroInput); } }}
              placeholder="+ 매크로"
              className="w-20 rounded-full border border-dashed border-amber-300 px-2.5 py-1 text-[12px] text-[#5F7A70] placeholder:text-[#94A8A0] focus:border-amber-400 focus:outline-none"
            />
          )}
        </div>
      </div>
    </div>
  );
}

// ── AI 모델 선택 + 한도 초과 팝업 ────────────────────────────────────────────────

export type AiModelId =
  | "auto"
  | "gemini-3.1-flash-lite"
  | "gemini-3.5-flash"
  | "gemini-2.5-flash";

export const AI_MODELS: { id: AiModelId; label: string; limit: string; dailyLimit: number | null }[] = [
  { id: "auto", label: "자동 (폴백)", limit: "한도 초과 시 다음 모델로 자동 전환", dailyLimit: null },
  { id: "gemini-3.1-flash-lite", label: "Gemini 3.1 Flash Lite", limit: "무료 500회/일 · 가장 넉넉", dailyLimit: 500 },
  { id: "gemini-3.5-flash", label: "Gemini 3.5 Flash", limit: "무료 20회/일 · 품질 우선", dailyLimit: 20 },
  { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash", limit: "무료 20회/일", dailyLimit: 20 },
];

const MODEL_STORAGE_KEY = "tab4_ai_model";

export function useAiModel(): [AiModelId, (m: AiModelId) => void] {
  const [model, setModel] = useState<AiModelId>("auto");
  useEffect(() => {
    try {
      const stored = localStorage.getItem(MODEL_STORAGE_KEY) as AiModelId | null;
      if (stored && AI_MODELS.some((m) => m.id === stored)) setModel(stored);
    } catch {}
  }, []);
  const update = (m: AiModelId) => {
    setModel(m);
    try { localStorage.setItem(MODEL_STORAGE_KEY, m); } catch {}
  };
  return [model, update];
}

// ── 모델별 오늘 사용량 (localStorage, 날짜 바뀌면 자동 초기화) ───────────────────

function usageStorageKey(): string {
  return `tab4_ai_usage_${new Date().toISOString().slice(0, 10)}`;
}

/** AI 호출 성공 시 호출 — 잔여 한도 표시용 사용 횟수를 기록 */
export function recordAiUsage(model: AiModelId, count = 1): void {
  try {
    const key = usageStorageKey();
    const map = JSON.parse(localStorage.getItem(key) ?? "{}") as Record<string, number>;
    map[model] = (map[model] ?? 0) + count;
    localStorage.setItem(key, JSON.stringify(map));
  } catch {}
}

export function getAiUsage(model: AiModelId): number {
  try {
    const map = JSON.parse(localStorage.getItem(usageStorageKey()) ?? "{}") as Record<string, number>;
    return map[model] ?? 0;
  } catch {
    return 0;
  }
}

/** 모델의 오늘 잔여 한도 추정치. dailyLimit을 모르는 모델은 null 반환 */
export function getAiRemaining(model: AiModelId): number | null {
  const meta = AI_MODELS.find((m) => m.id === model);
  if (!meta || meta.dailyLimit == null) return null;
  return Math.max(0, meta.dailyLimit - getAiUsage(model));
}

/** 서버 오류 메시지가 "AI 한도 초과"를 의미하는지 판별 (모든 폴백 모델 소진 시 서버가 반환) */
export function isQuotaExceededMessage(msg?: string | null): boolean {
  if (!msg) return false;
  const s = msg.toLowerCase();
  return s.includes("한도") || s.includes("429") || s.includes("quota") || s.includes("resource_exhausted") || s.includes("rate limit");
}

/** AI 한도 초과 팝업 상태 관리 — 모델 전환 시 저장해둔 재시도 함수를 자동 실행 */
export function useAiLimitGuard(setModel: (m: AiModelId) => void) {
  const [open, setOpen] = useState(false);
  const retryRef = useRef<(() => void) | null>(null);
  return {
    open,
    /** 한도 초과 오류 감지 시 호출 — 재시도 콜백을 보관하고 팝업을 연다 */
    trigger: (retry: () => void) => { retryRef.current = retry; setOpen(true); },
    close: () => setOpen(false),
    onSelect: (m: AiModelId) => {
      setModel(m);
      setOpen(false);
      const retry = retryRef.current;
      retryRef.current = null;
      retry?.();
    },
  };
}

interface GeminiKeyInfo {
  index: number;
  label: string;
}

/** AI 한도를 모두 소진했을 때 뜨는 모델 전환 및 API Key 전환 팝업 */
export function AiLimitModal({
  open, onClose, onSelect,
}: {
  open: boolean;
  onClose: () => void;
  onSelect: (m: AiModelId) => void;
}) {
  const [keys, setKeys] = useState<GeminiKeyInfo[]>([]);
  const [selectedKeyIdx, setSelectedKeyIdx] = useState<number>(0);
  const [loadingKeys, setLoadingKeys] = useState<boolean>(false);

  useEffect(() => {
    if (open) {
      setLoadingKeys(true);
      fetch("/api/gemini-keys")
        .then((res) => res.json())
        .then((data) => {
          if (data.keys && data.keys.length > 0) {
            setKeys(data.keys);
          }
        })
        .catch(console.error)
        .finally(() => setLoadingKeys(false));

      try {
        const storedIdx = localStorage.getItem("gemini_selected_key_index");
        if (storedIdx !== null) {
          setSelectedKeyIdx(parseInt(storedIdx, 10));
        } else {
          setSelectedKeyIdx(0);
        }
      } catch {}
    }
  }, [open]);

  const handleKeySelect = (idx: number) => {
    setSelectedKeyIdx(idx);
    try {
      localStorage.setItem("gemini_selected_key_index", idx.toString());
    } catch {}
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-2xl animate-in fade-in zoom-in-95 duration-200" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="mb-2 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Cpu size={18} className="text-[#005B52]" />
            <h3 className="text-[16px] font-black text-[#0D2318]">AI 요청 한도 초과</h3>
          </div>
          <button onClick={onClose} className="text-[#7A9488] hover:text-[#0D2318]">
            <X size={18} />
          </button>
        </div>
        <p className="mb-4 text-[12px] font-semibold text-[#7A9488]">
          현재 사용 중인 API Key 또는 모델의 오늘 무료 한도를 모두 사용했습니다. 다른 계정(API Key) 또는 모델로 변경하여 이어서 시도해 보세요.
        </p>

        {/* API Key (Account) Selection */}
        {keys.length > 1 && (
          <div className="mb-5">
            <label className="mb-1.5 block text-[11px] font-bold uppercase tracking-wider text-[#94A8A0]">
              Gemini API Key (구글 계정) 전환
            </label>
            <div className="grid grid-cols-2 gap-2">
              {keys.map((k) => (
                <button
                  key={k.index}
                  type="button"
                  onClick={() => handleKeySelect(k.index)}
                  className={`flex flex-col items-start rounded-lg border p-2.5 text-left transition ${
                    selectedKeyIdx === k.index
                      ? "border-[#005B52] bg-[#EEF4F1] font-bold text-[#005B52]"
                      : "border-[#DDE8E5] bg-white text-[#5F7A70] hover:bg-[#F6FAF8]"
                  }`}
                >
                  <span className="text-[12px]">{k.label}</span>
                  <span className="text-[9px] opacity-75">
                    {selectedKeyIdx === k.index ? "현재 활성화됨" : "선택하여 전환"}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Model Selection */}
        <div>
          <label className="mb-1.5 block text-[11px] font-bold uppercase tracking-wider text-[#94A8A0]">
            AI 모델 전환 (활성 API Key 내 모델 변경)
          </label>
          <div className="flex flex-col gap-1.5">
            {AI_MODELS.filter((m) => m.id !== "auto").map((m) => {
              const remaining = getAiRemaining(m.id);
              const exhausted = remaining === 0;
              return (
                <button
                  key={m.id}
                  type="button"
                  disabled={exhausted}
                  onClick={() => onSelect(m.id)}
                  className={`flex items-center justify-between rounded-lg border px-3.5 py-2.5 text-left transition ${
                    exhausted
                      ? "cursor-not-allowed border-[#EEF4F1] bg-[#F6FAF8] opacity-50"
                      : "border-[#DDE8E5] hover:border-[#005B52] hover:bg-[#F6FAF8]"
                  }`}
                >
                  <span>
                    <span className="block text-[13px] font-bold text-[#1C3329]">{m.label}</span>
                    <span className="block text-[10px] text-[#94A8A0]">{m.limit}</span>
                  </span>
                  <span className={`shrink-0 pl-3 text-[11px] font-black ${exhausted ? "text-red-400" : "text-[#005B52]"}`}>
                    {remaining === null ? "-" : `잔여 ${remaining}회`}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Action Buttons */}
        <div className="mt-5 flex gap-2">
          {keys.length > 1 && (
            <button
              type="button"
              onClick={() => {
                const currentModel = localStorage.getItem("tab4_ai_model") as AiModelId || "auto";
                onSelect(currentModel);
              }}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-[#005B52] py-2 text-[12px] font-bold text-white transition hover:bg-[#004D45]"
            >
              <RefreshCw size={12} />
              <span>선택된 키로 즉시 재시도</span>
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className={`rounded-lg border border-[#DDE8E5] py-2 text-[12px] font-bold text-[#5F7A70] hover:bg-[#F6FAF8] transition ${
              keys.length > 1 ? "px-4" : "w-full"
            }`}
          >
            닫기
          </button>
        </div>
      </div>
    </div>
  );
}

// ── 검색·기간 필터 바 (리포트 DB 스타일로 통일 — 검색어 입력창 안 돋보기 아이콘 +
//    "조회" 버튼 + "필터 초기화" 텍스트 버튼) ────────────────────────────────────

export function SearchDateBar({
  keyword, onKeyword, fromDate, onFromDate, toDate, onToDate, placeholder, onSubmit, onReset, searching,
}: {
  keyword: string; onKeyword: (v: string) => void;
  fromDate: string; onFromDate: (v: string) => void;
  toDate: string; onToDate: (v: string) => void;
  placeholder?: string;
  onSubmit?: () => void;
  /** 초기화 버튼 클릭 시 호출 — 지정하지 않으면 keyword/fromDate/toDate만 비운다 */
  onReset?: () => void;
  searching?: boolean;
}) {
  const hasFilter = Boolean(keyword || fromDate || toDate);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative">
        <Search size={13} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#94A8A0]" />
        <input
          type="text" value={keyword}
          onChange={(e) => onKeyword(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") onSubmit?.(); }}
          placeholder={placeholder ?? "검색어"}
          className="w-56 rounded-input border border-[#DDE8E5] py-2 pl-8 pr-3 text-[13px] font-semibold text-[#0D2318] placeholder:text-[#B9CCC4] focus:border-primary focus:ring-2 focus:ring-primary/15"
        />
      </div>
      <input type="date" value={fromDate} onChange={(e) => onFromDate(e.target.value)}
        className="rounded-input border border-[#DDE8E5] px-2.5 py-1.5 text-[12px] font-semibold text-[#33493F] focus:border-primary" />
      <span className="text-xs font-bold text-[#94A8A0]">~</span>
      <input type="date" value={toDate} onChange={(e) => onToDate(e.target.value)}
        className="rounded-input border border-[#DDE8E5] px-2.5 py-1.5 text-[12px] font-semibold text-[#33493F] focus:border-primary" />
      {onSubmit && (
        <button type="button" onClick={onSubmit} disabled={searching}
          className="flex items-center gap-1.5 rounded-btn bg-primary px-4 py-2 text-xs font-black text-white transition hover:bg-primary-light disabled:opacity-50">
          {searching ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
          조회
        </button>
      )}
      {hasFilter && (
        <button type="button"
          onClick={() => {
            if (onReset) { onReset(); return; }
            onKeyword(""); onFromDate(""); onToDate("");
          }}
          className="text-[11px] font-bold text-[#94A8A0] transition hover:text-red-500">
          필터 초기화
        </button>
      )}
    </div>
  );
}

// ── 저장됨 탭 공용 필터 바 (검색어 + Company/Topic 드롭다운 + 기간) ──────────────

export function SavedFilterBar({
  search, onSearch, company, onCompany, topic, onTopic,
  allCompanies, allTopics, fromDate, onFromDate, toDate, onToDate, placeholder,
}: {
  search: string; onSearch: (v: string) => void;
  company: string; onCompany: (v: string) => void;
  topic: string; onTopic: (v: string) => void;
  allCompanies: string[]; allTopics: string[];
  fromDate: string; onFromDate: (v: string) => void;
  toDate: string; onToDate: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      <input
        value={search}
        onChange={(e) => onSearch(e.target.value)}
        placeholder={placeholder ?? "제목 검색..."}
        className="flex-1 min-w-[180px] rounded-md border border-[#DDE8E5] bg-white px-3 py-1.5 text-sm outline-none focus:border-[#005B52]"
      />
      <select value={company} onChange={(e) => onCompany(e.target.value)}
        className="rounded-md border border-[#DDE8E5] bg-white px-2 py-1.5 text-xs outline-none focus:border-[#005B52]">
        <option value="">Company 전체</option>
        {allCompanies.map((c) => <option key={c}>{c}</option>)}
      </select>
      <select value={topic} onChange={(e) => onTopic(e.target.value)}
        className="rounded-md border border-[#DDE8E5] bg-white px-2 py-1.5 text-xs outline-none focus:border-[#005B52]">
        <option value="">Topic 전체</option>
        {allTopics.map((t) => <option key={t}>{t}</option>)}
      </select>
      <input type="date" value={fromDate} onChange={(e) => onFromDate(e.target.value)}
        className="rounded-md border border-[#DDE8E5] bg-white px-2 py-1.5 text-xs outline-none focus:border-[#005B52]" />
      <span className="self-center text-xs text-[#94A8A0]">~</span>
      <input type="date" value={toDate} onChange={(e) => onToDate(e.target.value)}
        className="rounded-md border border-[#DDE8E5] bg-white px-2 py-1.5 text-xs outline-none focus:border-[#005B52]" />
    </div>
  );
}

// ── 저장됨 탭 공용 리스트 행 (뉴스 DB 스타일 — 번호·제목·날짜 + 우측 삭제/저장됨 뱃지) ─
// 태그(Topic/Company)는 평소엔 숨겨져 있다가 마우스 hover 시에만 노출된다.

export function SavedListRow({
  index, title, date, topics = [], companies = [], macro = [], onClick, onDelete,
}: {
  index: number;
  title: string;
  date?: string;
  topics?: string[];
  companies?: string[];
  macro?: string[];
  onClick: () => void;
  onDelete: () => void;
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClick(); } }}
      className="group flex w-full cursor-pointer items-start gap-3 border-b border-[#F0F7F4] px-4 py-3.5 text-left transition hover:bg-[#F6FAF8]"
    >
      <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#EEF4F1] text-[10px] font-bold text-[#5F7A70] transition group-hover:bg-[#DFE9E5]">
        {index}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-semibold leading-snug line-clamp-2 text-[#1C3329] transition group-hover:text-[#005B52]">
          {title}
        </p>
        {date && <p className="mt-0.5 text-[11px] text-[#94A8A0]">{date}</p>}
        {(topics.length > 0 || companies.length > 0 || macro.length > 0) && (
          <div className="mt-1.5 hidden flex-wrap gap-1 group-hover:flex">
            {topics.map((t) => (
              <span key={`t-${t}`} className="rounded-full border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-[9px] font-bold text-emerald-700">{t}</span>
            ))}
            {companies.map((t) => (
              <span key={`c-${t}`} className="rounded-full border border-blue-200 bg-blue-50 px-1.5 py-0.5 text-[9px] font-bold text-blue-700">{t}</span>
            ))}
            {macro.map((t) => (
              <span key={`m-${t}`} className="rounded-full border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[9px] font-bold text-amber-700">{t}</span>
            ))}
          </div>
        )}
      </div>
      <button type="button" onClick={(e) => { e.stopPropagation(); onDelete(); }}
        className="shrink-0 rounded p-1 text-[#B9CCC4] transition hover:bg-red-50 hover:text-red-500" title="삭제">
        <X size={13} />
      </button>
      <span className="shrink-0 rounded bg-emerald-100 px-2 py-1 text-[12px] font-semibold text-emerald-700">저장됨</span>
    </div>
  );
}

/** 날짜 문자열(다양한 포맷)을 yyyy-mm-dd 로 정규화. 실패 시 "" */
export function normalizeDate(raw: string | null | undefined): string {
  if (!raw) return "";
  const s = String(raw);
  const m = s.match(/(\d{4})[.\-/년\s]*(\d{1,2})[.\-/월\s]*(\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  const d = new Date(s);
  if (!Number.isNaN(d.getTime())) {
    const p = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  }
  return "";
}

/** 기간 필터: from/to 가 비어있으면 통과 */
export function inDateRange(dateStr: string, from: string, to: string): boolean {
  if (!from && !to) return true;
  const d = normalizeDate(dateStr);
  if (!d) return true;
  if (from && d < from) return false;
  if (to && d > to) return false;
  return true;
}

// ── 채널/피드 목록 — 오른쪽 가장자리 호버 시 펼쳐지는 오버레이 사이드 패널 ─────────
// 텔레그램/블로그/유튜브 DB 공통. 평소엔 접혀 있어 콘텐츠(게시글 목록)가 전체 폭을
// 차지하고, 오른쪽 가장자리에 마우스를 가져가면 슬라이드되어 콘텐츠 위를 덮으며
// 나타난다(레이아웃을 밀지 않음). 마우스가 벗어나면 자동으로 접힌다.
// 부모 요소는 반드시 position:relative + 고정 높이를 가져야 한다.

export type EdgeListItem = { id: string; title: string; subtitle?: string; count?: number };

export function EdgeSidebarPanel({
  label, items, activeId, onSelect, onRemove, loading, emptyText,
  addLabel, addPrimaryPlaceholder, addNamePlaceholder, onAdd, extraAction,
  showAll = true, allLabel = "전체", allCount,
}: {
  label: string;
  items: EdgeListItem[];
  activeId: string | null;
  onSelect: (id: string | null) => void;
  onRemove: (id: string) => void;
  loading?: boolean;
  emptyText?: string;
  addLabel: string;
  addPrimaryPlaceholder: string;
  /** 지정하지 않으면 단일 입력(아이디만)으로 동작 — 텔레그램처럼 이름을 서버가 자동으로 채우는 경우 */
  addNamePlaceholder?: string;
  onAdd: (primary: string, name: string) => Promise<{ ok: boolean; error?: string }>;
  extraAction?: React.ReactNode;
  showAll?: boolean;
  allLabel?: string;
  allCount?: number;
}) {
  const [open, setOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [primaryInput, setPrimaryInput] = useState("");
  const [nameInput, setNameInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [addError, setAddError] = useState("");
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const needsName = addNamePlaceholder !== undefined;

  const cancelClose = () => { if (closeTimer.current) { clearTimeout(closeTimer.current); closeTimer.current = null; } };
  const scheduleClose = () => { cancelClose(); closeTimer.current = setTimeout(() => setOpen(false), 220); };
  useEffect(() => () => cancelClose(), []);

  const submitAdd = async () => {
    const primary = primaryInput.trim();
    const name = nameInput.trim();
    if (!primary || (needsName && !name) || saving) return;
    setSaving(true);
    setAddError("");
    const res = await onAdd(primary, name);
    setSaving(false);
    if (!res.ok) { setAddError(res.error ?? "추가 실패"); return; }
    setPrimaryInput(""); setNameInput(""); setAdding(false);
  };

  const canSubmit = primaryInput.trim() && (!needsName || nameInput.trim()) && !saving;

  return (
    <>
      {/* 호버 트리거 (오른쪽 가장자리) */}
      <div className="absolute right-0 top-0 z-20 h-full w-4"
        onMouseEnter={() => { cancelClose(); setOpen(true); }} />

      {/* 접힌 상태 손잡이 탭 — 리스트 세로 길이 전체에 걸쳐 표시, 화살표만 노출 */}
      {!open && (
        <div
          className="absolute right-0 top-0 z-20 flex h-full w-6 cursor-pointer flex-col items-center justify-center rounded-l-lg border border-r-0 border-[#DDE8E5] bg-white shadow-md transition hover:bg-[#F6FAF8]"
          onMouseEnter={() => { cancelClose(); setOpen(true); }}
          title={`${label} (${items.length})`}
        >
          <ChevronLeft size={14} className="text-[#5F7A70]" />
        </div>
      )}

      {/* 슬라이드 패널 */}
      <div
        className={`absolute right-0 top-0 z-30 flex h-full w-[280px] flex-col border-l border-[#E8F0ED] bg-white shadow-2xl transition-transform duration-200 ${
          open ? "translate-x-0" : "translate-x-full"
        }`}
        onMouseEnter={cancelClose}
        onMouseLeave={scheduleClose}
      >
        <div className="flex items-center justify-between border-b border-[#E8F0ED] px-3 py-2.5">
          <span className="text-[15px] font-normal text-[#0D2318]">{label}{items.length > 0 && ` (${items.length})`}</span>
          <button type="button" onClick={() => setOpen(false)} className="text-[#B9CCC4] hover:text-[#4B6358]"><X size={15} /></button>
        </div>

        <div className="flex flex-col gap-1.5 border-b border-[#F0F7F4] px-3 py-2.5">
          <button type="button" onClick={() => { setAdding((v) => !v); setAddError(""); }}
            className="flex items-center justify-center gap-1 rounded-md border border-dashed border-[#B9CCC4] py-1.5 text-[14px] font-normal text-[#5F7A70] transition hover:border-primary hover:text-primary">
            <Plus size={14} /> {addLabel}
          </button>
          {extraAction}
        </div>

        <div className="flex-1 overflow-y-auto">
          {adding && (
            <div className="space-y-1.5 border-b border-[#F0F7F4] bg-[#F6FAF8] px-3 py-2.5">
              <input autoFocus value={primaryInput} onChange={(e) => setPrimaryInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && !needsName) void submitAdd(); }}
                placeholder={addPrimaryPlaceholder}
                className="w-full rounded-md border border-[#DDE8E5] bg-white px-2.5 py-1.5 text-[15px] outline-none focus:border-primary" />
              {needsName && (
                <input value={nameInput} onChange={(e) => setNameInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") void submitAdd(); }}
                  placeholder={addNamePlaceholder}
                  className="w-full rounded-md border border-[#DDE8E5] bg-white px-2.5 py-1.5 text-[15px] outline-none focus:border-primary" />
              )}
              <div className="flex items-center justify-between gap-2">
                {addError ? <span className="text-[13px] font-normal text-red-500">{addError}</span> : <span />}
                <button type="button" onClick={() => void submitAdd()} disabled={!canSubmit}
                  className="flex shrink-0 items-center gap-1 rounded-md bg-primary px-2.5 py-1 text-[14px] font-normal text-white transition hover:bg-primary-light disabled:opacity-40">
                  {saving ? <Loader2 size={14} className="animate-spin" /> : null} 저장 (Enter)
                </button>
              </div>
            </div>
          )}

          {showAll && (
            <button type="button" onClick={() => onSelect(null)}
              className={`flex w-full items-center justify-between px-3 py-2 text-left text-[15px] font-normal transition ${
                activeId === null ? "bg-primary-50 text-primary" : "text-[#33493F] hover:bg-[#F6FAF8]"
              }`}>
              {allLabel}
              {allCount !== undefined && <span className="text-[13px] font-normal text-[#94A8A0]">{allCount}</span>}
            </button>
          )}

          {loading ? (
            <p className="py-10 text-center text-[15px] font-normal text-[#94A8A0]">불러오는 중…</p>
          ) : items.length === 0 ? (
            <p className="px-3 py-8 text-center text-[14px] font-normal text-[#94A8A0]">{emptyText ?? "등록된 항목이 없습니다."}</p>
          ) : (
            items.map((it) => (
              <div key={it.id}
                className={`group flex items-center justify-between gap-2 border-t border-[#F0F7F4] px-3 py-2 transition ${
                  activeId === it.id ? "bg-primary-50" : "hover:bg-[#F6FAF8]"
                }`}>
                <button type="button" onClick={() => onSelect(it.id)} className="min-w-0 flex-1 text-left">
                  <span className={`block truncate text-[15px] font-normal ${activeId === it.id ? "text-primary" : "text-[#1C3329]"}`}>
                    {it.title}{it.count !== undefined && ` (${it.count})`}
                  </span>
                  {it.subtitle && <span className="block truncate text-[13px] font-normal text-[#94A8A0]">{it.subtitle}</span>}
                </button>
                <button type="button" onClick={() => onRemove(it.id)}
                  className="shrink-0 text-[#B9CCC4] opacity-0 transition group-hover:opacity-100 hover:text-red-500"><X size={13} /></button>
              </div>
            ))
          )}
        </div>
      </div>
    </>
  );
}
