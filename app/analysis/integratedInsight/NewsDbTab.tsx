"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Bookmark, Check, ExternalLink, Inbox, Loader2, Minus, Newspaper, Sparkles, X } from "lucide-react";
import {
  AiLimitModal, SavedFilterBar, SearchDateBar, inDateRange,
  isQuotaExceededMessage, recordAiUsage, useAiLimitGuard, useAiModel,
} from "./shared";
import type { HankyungArticle } from "@/app/api/hankyung-articles/route";

// ── 유틸 ─────────────────────────────────────────────────────────────────────

function articleDate(article: HankyungArticle): string {
  if (article.time) return article.time;
  if (article.published_date) {
    const [y, m, d] = article.published_date.split("-");
    return `${y}. ${m}. ${d}.`;
  }
  return "";
}

function categoryLabel(category: HankyungArticle["category"]): string {
  if (category === "search") return "검색결과";
  return CATEGORY_META[category].label;
}

function toDisplayCategory(raw: string): HankyungArticle["category"] {
  return (CATEGORY_ORDER as readonly string[]).includes(raw) ? (raw as CategoryId) : "search";
}

// 한경 프리미엄(유료) 기사 판별 — API가 카테고리 목록 페이지의 data-pm="P9P" 마커로 판별해 내려준
// premium 필드를 우선 사용하고, 그 정보가 없는 경우(저장 목록 등)에는 제목 브랜드 마커로 추정한다
const PREMIUM_MARKERS = ["마켓PRO", "한경 프리미엄", "한경프리미엄", "Deep Insight", "한경 엣지"];
function isPremiumArticle(a: { title: string; url: string; premium?: boolean }): boolean {
  if (a.premium) return true;
  if (/hankyung\.com\/(premium|plus)/.test(a.url)) return true;
  return PREMIUM_MARKERS.some((m) => a.title.includes(m));
}

function getSourceBadge(url: string) {
  if (url.includes("yahoo.com")) {
    return { label: "Yahoo Finance", cls: "bg-purple-50 text-purple-700 border-purple-200" };
  }
  if (url.includes("cnbc.com")) {
    return { label: "CNBC", cls: "bg-blue-50 text-blue-700 border-blue-200" };
  }
  if (url.includes("globaltimes.cn")) {
    return { label: "중국 매체", cls: "bg-red-50 text-red-700 border-red-200" };
  }
  // ── 매크로 수집(Alpha Vantage·Finnhub·FRED·ECOS) 기사 매체 배지 ──────────────
  if (url.includes("fred.stlouisfed.org")) {
    return { label: "FRED", cls: "bg-indigo-50 text-indigo-700 border-indigo-200" };
  }
  if (url.includes("ecos.bok.or.kr")) {
    return { label: "한국은행", cls: "bg-teal-50 text-teal-700 border-teal-200" };
  }
  if (url.includes("reuters.com")) {
    return { label: "Reuters", cls: "bg-orange-50 text-orange-700 border-orange-200" };
  }
  if (url.includes("bloomberg.com")) {
    return { label: "Bloomberg", cls: "bg-slate-100 text-slate-700 border-slate-300" };
  }
  if (url.includes("marketwatch.com")) {
    return { label: "MarketWatch", cls: "bg-emerald-50 text-emerald-700 border-emerald-200" };
  }
  if (url.includes("benzinga.com")) {
    return { label: "Benzinga", cls: "bg-sky-50 text-sky-700 border-sky-200" };
  }
  if (url.includes("seekingalpha.com")) {
    return { label: "Seeking Alpha", cls: "bg-amber-50 text-amber-700 border-amber-200" };
  }
  if (url.includes("investing.com")) {
    return { label: "Investing.com", cls: "bg-rose-50 text-rose-700 border-rose-200" };
  }
  if (url.includes("wsj.com")) {
    return { label: "WSJ", cls: "bg-stone-100 text-stone-700 border-stone-300" };
  }
  // 그 외(한경 포함 미매핑 매체)는 배지 없음
  return null;
}

// ── 상수 ──────────────────────────────────────────────────────────────────────

const TOPIC_OPTIONS = [
  "News", "미국", "중국", "OPEC", "코스피",
  "반도체", "HBM", "DRAM", "AI", "LLM", "노사", "방산", "수주", "조선",
  "전력", "에너지", "바이오", "신약개발", "건설", "부동산PF",
  "항공", "관광", "암호화폐", "가상자산",
];

const MACRO_OPTIONS = [
  "환율", "인플레이션", "금리", "채권", "국채", "관세", "원유", "유가", "부동산",
];

const CATEGORY_META = {
  economy:       { label: "경제" },
  financial:     { label: "금융" },
  opinion:       { label: "오피니언" },
  international: { label: "국제" },
  realestate:    { label: "부동산" },
} as const;

const CATEGORY_ORDER = ["economy", "financial", "international", "realestate", "opinion"] as const;

type CategoryId = keyof typeof CATEGORY_META;

// ── 타입 ──────────────────────────────────────────────────────────────────────

type ArticleList = Record<CategoryId, HankyungArticle[]>;

type EditState = {
  topics: string[];
  companies: string[];
  macro: string[];
  notes: string;
  tagging: boolean;
  saving: boolean;
  saved: boolean;
  summarizing: boolean;
  summary: string;
  summaryError: string;
};

type SavedArticleRow = {
  id: string;
  title: string;
  url: string;
  category: string;
  published_date: string | null;
  topic_tags: string[];
  company_tags: string[];
  macro_tags: string[];
  notes: string;
  created_at: string;
};

// ── 마크다운 렌더 ─────────────────────────────────────────────────────────────

function renderMarkdown(text: string): string {
  const lines = text.split("\n");
  const out: string[] = [];
  for (const raw of lines) {
    const line = raw.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const bold = (s: string) => s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    if (line.startsWith("## "))
      out.push(`<h3 class="font-bold text-[#005B52] text-[17px] mt-4 mb-1">${bold(line.slice(3))}</h3>`);
    else if (line.startsWith("- "))
      out.push(`<li class="ml-4 text-[17px] text-[#33493F] list-disc">${bold(line.slice(2))}</li>`);
    else if (line.trim() === "---")
      out.push(`<hr class="border-[#DDE8E5] my-3" />`);
    else if (line.trim() === "")
      out.push(`<div class="h-1"></div>`);
    else
      out.push(`<p class="text-[17px] text-[#33493F]">${bold(line)}</p>`);
  }
  return out.join("\n");
}

function MarkdownView({ text }: { text: string }) {
  return <div dangerouslySetInnerHTML={{ __html: renderMarkdown(text) }} />;
}

// ── 키워드 하이라이트 ─────────────────────────────────────────────────────────

function HighlightText({ text, keyword }: { text: string; keyword: string }) {
  if (!keyword.trim()) return <>{text}</>;
  const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const parts = text.split(new RegExp(`(${escaped})`, "gi"));
  return (
    <>
      {parts.map((part, i) =>
        i % 2 === 1 ? (
          <mark key={i} className="rounded-sm bg-yellow-200 px-0.5 text-inherit">
            {part}
          </mark>
        ) : (
          part
        )
      )}
    </>
  );
}

// ── 태그 칩 ───────────────────────────────────────────────────────────────────

function TagChip({
  label, color, onRemove,
}: {
  label: string;
  color: "topic" | "company" | "macro";
  onRemove?: () => void;
}) {
  // TAB4 공통 색상: Topic=초록, Company=파랑, Macro=노랑
  const cls = color === "topic"
    ? "bg-emerald-50 border-emerald-200 text-emerald-700"
    : color === "company"
      ? "bg-blue-50 border-blue-200 text-blue-700"
      : "bg-amber-50 border-amber-200 text-amber-700";
  return (
    <span className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[13px] font-medium ${cls}`}>
      {label}
      {onRemove && (
        <button type="button" onClick={onRemove} className="opacity-50 hover:opacity-100">
          <X size={11} />
        </button>
      )}
    </span>
  );
}

// ── 메인 컴포넌트 ─────────────────────────────────────────────────────────────

export function NewsDbTab() {
  const [phase, setPhase] = useState<"idle" | "loading" | "list">("idle");
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);
  const [articles, setArticles] = useState<ArticleList>({
    economy: [], financial: [], opinion: [], international: [], realestate: [],
  });
  const [activeCategory, setActiveCategory] = useState<CategoryId>("economy");
  const [selectedUrls, setSelectedUrls] = useState<Set<string>>(new Set());
  const [visitedUrls, setVisitedUrls] = useState<Set<string>>(new Set());

  // localStorage에서 방문 기록 복원
  useEffect(() => {
    try {
      const stored = localStorage.getItem("news_visited_urls");
      if (stored) setVisitedUrls(new Set(JSON.parse(stored) as string[]));
    } catch {}
  }, []);

  // 방문 기록 변경 시 localStorage에 저장
  useEffect(() => {
    if (visitedUrls.size === 0) return;
    try {
      localStorage.setItem("news_visited_urls", JSON.stringify([...visitedUrls]));
    } catch {}
  }, [visitedUrls]);
  const [deletedArticleUrls, setDeletedArticleUrls] = useState<Set<string>>(new Set());

  useEffect(() => {
    fetch("/api/news-db/deleted")
      .then((res) => res.json())
      .then((data: { deletedUrls?: string[] }) => {
        if (data.deletedUrls) setDeletedArticleUrls(new Set(data.deletedUrls));
      })
      .catch(console.error);
  }, []);

  const [focusedUrl, setFocusedUrl] = useState<string | null>(null);
  const [edits, setEdits] = useState<Record<string, EditState>>({});
  const [topicInput, setTopicInput] = useState("");
  const [companyInput, setCompanyInput] = useState("");
  const [macroInput, setMacroInput] = useState("");
  const [error, setError] = useState("");
  const [contentCache, setContentCache] = useState<Record<string, { loading: boolean; text: string; error: string }>>({});
  const [aiModel, setAiModel] = useAiModel();
  const limitGuard = useAiLimitGuard(setAiModel);

  // ── 키워드+날짜 검색 모드 (과거 날짜 기사용) ──────────────────────────────────
  const [viewMode, setViewMode] = useState<"browse" | "search" | "saved">("browse");
  const [searchKeyword, setSearchKeyword] = useState("");
  const [searchStartDate, setSearchStartDate] = useState("");
  const [searchEndDate, setSearchEndDate] = useState("");
  const [searchResults, setSearchResults] = useState<HankyungArticle[]>([]);
  const [searchPage, setSearchPage] = useState(1);
  const [searchTotal, setSearchTotal] = useState(0);
  const [searchHasMore, setSearchHasMore] = useState(false);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState("");

  // ── 저장 목록 ────────────────────────────────────────────────────────────────
  const [savedArticles, setSavedArticles] = useState<SavedArticleRow[]>([]);
  const [savedLoading, setSavedLoading] = useState(false);
  const [savedError, setSavedError] = useState("");
  const [savedSearch, setSavedSearch] = useState("");
  const [savedCompany, setSavedCompany] = useState("");
  const [savedTopic, setSavedTopic] = useState("");
  const [savedFromDate, setSavedFromDate] = useState("");
  const [savedToDate, setSavedToDate] = useState("");

  // ── 기사 불러오기 ────────────────────────────────────────────────────────────

  const loadArticles = async () => {
    setPhase("loading");
    setError("");
    try {
      const res = await fetch("/api/hankyung-articles");
      if (!res.ok) throw new Error("기사 불러오기 실패");
      const data = (await res.json()) as { articles: ArticleList };
      setArticles(data.articles);
      setPhase("list");
    } catch (e) {
      setError(e instanceof Error ? e.message : "오류가 발생했습니다");
      setPhase("idle");
    }
  };

  useEffect(() => { void loadArticles(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── 저장 목록 ────────────────────────────────────────────────────────────────

  const loadSaved = async () => {
    setSavedLoading(true);
    setSavedError("");
    try {
      const res = await fetch("/api/news-db");
      const data = (await res.json()) as { articles?: SavedArticleRow[]; error?: string };
      if (!res.ok) throw new Error(data.error ?? "저장 목록을 불러오지 못했습니다.");
      setSavedArticles(data.articles ?? []);
    } catch (e) {
      setSavedError(e instanceof Error ? e.message : "저장 목록을 불러오는 중 오류가 발생했습니다.");
    } finally {
      setSavedLoading(false);
    }
  };

  useEffect(() => { void loadSaved(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const deleteSaved = async (id: string, url: string) => {
    if (!confirm("이 저장 항목을 삭제하시겠습니까?")) return;
    try {
      await fetch("/api/news-db", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      setSavedArticles((prev) => prev.filter((a) => a.id !== id));
      if (focusedUrl === url) setFocusedUrl(null);
    } catch {
      setSavedError("삭제 중 오류가 발생했습니다.");
    }
  };

  // ── 키워드+날짜 검색 ─────────────────────────────────────────────────────────

  const runSearch = async (page = 1) => {
    const keyword = searchKeyword.trim();
    if (!keyword) {
      if (!searchStartDate && !searchEndDate) {
        setSearchError("검색어 또는 기간을 입력하세요.");
        return;
      }
      // 키워드 없이 기간만 지정한 경우 — 한경 통합검색은 키워드가 필수라 호출할 수 없으므로,
      // 카테고리 목록 페이지가 이미 담고 있는 최근 며칠치 기사를 서버에서 기간으로 필터링해
      // 가져오고, 저장된 기사(전체 기간 보유)까지 합쳐 보여준다.
      setSearchError("");
      setSearchLoading(true);
      setViewMode("search");
      try {
        const params = new URLSearchParams();
        if (searchStartDate) params.set("startDate", searchStartDate);
        if (searchEndDate) params.set("endDate", searchEndDate);
        const res = await fetch(`/api/hankyung-articles?${params.toString()}`);
        const data = (await res.json()) as { articles?: ArticleList; error?: string };
        if (!res.ok) throw new Error(data.error ?? "기간 조회가 실패했습니다.");
        const rangeArticles = data.articles
          ? CATEGORY_ORDER.flatMap((cat) => data.articles![cat])
          : [];
        const combined = [...rangeArticles, ...savedArticles.map(toArticleShape)];
        const dedup = new Map<string, HankyungArticle>();
        for (const a of combined) dedup.set(a.url, a);
        const filtered = [...dedup.values()].filter((a) => inDateRange(a.published_date ?? a.time ?? "", searchStartDate, searchEndDate));
        setSearchResults(filtered);
        setSearchTotal(filtered.length);
        setSearchHasMore(false);
        setSearchPage(1);
      } catch (e) {
        setSearchError(e instanceof Error ? e.message : "기간 조회 중 오류가 발생했습니다.");
      } finally {
        setSearchLoading(false);
      }
      return;
    }
    setSearchLoading(true);
    setSearchError("");
    setViewMode("search");
    try {
      // 한경 검색은 사이트 페이지당 10건만 준다 — 다른 DB 탭과 같은 "20건 단위" 더보기를 맞추려면
      // 배치(더보기 1회)당 사이트 페이지 2개를 함께 가져와 묶는다.
      const fetchSitePage = async (sitePage: number) => {
        const params = new URLSearchParams({ query: keyword, page: String(sitePage) });
        if (searchStartDate) params.set("startDate", searchStartDate);
        if (searchEndDate) params.set("endDate", searchEndDate);
        const res = await fetch(`/api/hankyung-search?${params.toString()}`);
        const data = (await res.json()) as {
          articles?: HankyungArticle[]; total?: number; hasMore?: boolean; error?: string;
        };
        if (!res.ok) throw new Error(data.error ?? "검색 요청이 실패했습니다.");
        return data;
      };
      const [d1, d2] = await Promise.all([fetchSitePage(page * 2 - 1), fetchSitePage(page * 2)]);
      const batch = [...(d1.articles ?? []), ...(d2.articles ?? [])];
      const total = d1.total ?? 0;
      const prevCount = page === 1 ? 0 : searchResults.length;
      setSearchResults((prev) => (page === 1 ? batch : [...prev, ...batch]));
      setSearchTotal(total);
      setSearchHasMore(prevCount + batch.length < total);
      setSearchPage(page);
    } catch (e) {
      setSearchError(e instanceof Error ? e.message : "검색 중 오류가 발생했습니다.");
    } finally {
      setSearchLoading(false);
    }
  };

  // ── AI 태깅 ──────────────────────────────────────────────────────────────────

  const tagArticle = async (article: HankyungArticle, content?: string) => {
    try {
      const res = await fetch("/api/hankyung-tag", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: article.title, content, category: article.category, url: article.url }),
      });
      const data = (await res.json()) as { topics: string[]; companies: string[]; macro?: string[] };
      setEdits((prev) => ({
        ...prev,
        [article.url]: {
          ...prev[article.url],
          topics: (data.topics ?? []).filter((t) => t !== "News"),
          companies: data.companies ?? [],
          macro: data.macro ?? [],
          tagging: false,
        },
      }));
    } catch {
      setEdits((prev) => ({
        ...prev,
        [article.url]: { ...prev[article.url], tagging: false },
      }));
    }
  };

  // ── 기사 클릭 ────────────────────────────────────────────────────────────────

  const handleArticleClick = (article: HankyungArticle) => {
    const { url } = article;
    setTopicInput("");
    setCompanyInput("");
    setMacroInput("");
    setVisitedUrls((prev) => (prev.has(url) ? prev : new Set([...prev, url])));

    if (selectedUrls.has(url)) {
      // 이미 선택된 기사 → 선택 취소
      setSelectedUrls((prev) => { const n = new Set(prev); n.delete(url); return n; });
      setFocusedUrl((prev) => (prev === url ? null : prev));
    } else {
      // 새로 선택
      setFocusedUrl(url);
      setSelectedUrls((prev) => new Set([...prev, url]));
      if (!edits[url]) {
        setEdits((prev) => ({
          ...prev,
          [url]: { topics: [], companies: [], macro: [], notes: "", tagging: true, saving: false, saved: false, summarizing: false, summary: "", summaryError: "" },
        }));
        // 원문을 먼저 확보한 뒤 본문 기반으로 태깅 — 제목만으로 태깅할 때보다 정확도가 높다
        // (fetchArticleContent가 contentCache도 함께 채우므로 "원문" 패널의 별도 재요청은 없음)
        void (async () => {
          const content = await fetchArticleContent(article);
          await tagArticle(article, content);
        })();
      }
    }
  };

  // ── 편집 헬퍼 ────────────────────────────────────────────────────────────────

  const patchEdit = (url: string, patch: Partial<EditState>) => {
    setEdits((prev) => ({ ...prev, [url]: { ...prev[url], ...patch } }));
  };

  const removeTopic = (url: string, topic: string) => {
    setEdits((prev) => ({
      ...prev,
      [url]: { ...prev[url], topics: prev[url]?.topics.filter((t) => t !== topic) ?? [], saved: false },
    }));
  };

  const doAddTopic = (url: string, topic: string) => {
    const t = topic.trim();
    if (!t) return;
    setEdits((prev) => {
      const cur = prev[url]?.topics ?? [];
      if (cur.includes(t)) return prev;
      return { ...prev, [url]: { ...prev[url], topics: [...cur, t], saved: false } };
    });
    setTopicInput("");
  };

  const removeCompany = (url: string, company: string) => {
    setEdits((prev) => ({
      ...prev,
      [url]: { ...prev[url], companies: prev[url]?.companies.filter((c) => c !== company) ?? [], saved: false },
    }));
  };

  const doAddCompany = (url: string, company: string) => {
    const c = company.replace(",", "").trim();
    if (!c) return;
    setEdits((prev) => {
      const cur = prev[url]?.companies ?? [];
      if (cur.includes(c)) return prev;
      return { ...prev, [url]: { ...prev[url], companies: [...cur, c], saved: false } };
    });
    setCompanyInput("");
  };

  const removeMacro = (url: string, macro: string) => {
    setEdits((prev) => ({
      ...prev,
      [url]: { ...prev[url], macro: prev[url]?.macro.filter((m) => m !== macro) ?? [], saved: false },
    }));
  };

  const doAddMacro = (url: string, macro: string) => {
    const m = macro.replace(",", "").trim();
    if (!m) return;
    setEdits((prev) => {
      const cur = prev[url]?.macro ?? [];
      if (cur.includes(m)) return prev;
      return { ...prev, [url]: { ...prev[url], macro: [...cur, m], saved: false } };
    });
    setMacroInput("");
  };

  const deselect = (url: string) => {
    setSelectedUrls((prev) => { const n = new Set(prev); n.delete(url); return n; });
    if (focusedUrl === url) setFocusedUrl(null);
  };

  // ── 기사 목록에서 삭제 (browse 모드 전용) ──────────────────────────────────────

  const deleteArticle = async (article: HankyungArticle) => {
    const savedRow = savedArticles.find((s) => s.url === article.url);
    if (savedRow) {
      if (!confirm("이 저장 항목을 삭제하시겠습니까?")) return;
      try {
        await fetch("/api/news-db", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: savedRow.id }),
        });
        setSavedArticles((prev) => prev.filter((a) => a.id !== savedRow.id));
      } catch {
        setError("삭제 중 오류가 발생했습니다.");
        return;
      }
    } else {
      if (!confirm("이 기사를 목록에서 제거하시겠습니까?")) return;
    }

    try {
      await fetch("/api/news-db/deleted", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: article.url }),
      });
      setDeletedArticleUrls((prev) => new Set([...prev, article.url]));
    } catch {
      console.error("Failed to persist news deletion");
    }

    // Remove from local articles categories
    setArticles((prev) => {
      const copy = { ...prev };
      for (const cat of CATEGORY_ORDER) {
        copy[cat] = copy[cat].filter((a) => a.url !== article.url);
      }
      return copy;
    });

    // Remove from searchResults
    setSearchResults((prev) => prev.filter((a) => a.url !== article.url));

    setSelectedUrls((prev) => { const n = new Set(prev); n.delete(article.url); return n; });
    if (focusedUrl === article.url) setFocusedUrl(null);
  };

  // ── AI 요약 ──────────────────────────────────────────────────────────────────

  const summarizeArticle = async (article: HankyungArticle) => {
    const content = contentCache[article.url]?.text;
    if (!content) {
      patchEdit(article.url, { summaryError: "기사 원문을 먼저 불러와야 합니다." });
      return;
    }
    patchEdit(article.url, { summarizing: true, summary: "", summaryError: "" });
    try {
      const res = await fetch("/api/hankyung-summarize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content, title: article.title, category: article.category, model: aiModel }),
      });
      const data = (await res.json()) as { summary?: string; error?: string };
      if (!res.ok) {
        if (isQuotaExceededMessage(data.error)) {
          limitGuard.trigger(() => void summarizeArticle(article));
          patchEdit(article.url, { summarizing: false });
          return;
        }
        patchEdit(article.url, { summarizing: false, summaryError: data.error ?? "요약 실패" });
        return;
      }
      recordAiUsage(aiModel);
      patchEdit(article.url, { summarizing: false, summary: data.summary ?? "" });
    } catch (e) {
      patchEdit(article.url, { summarizing: false, summaryError: e instanceof Error ? e.message : "요약 오류" });
    }
  };

  // ── 저장 ─────────────────────────────────────────────────────────────────────

  const saveArticle = async (article: HankyungArticle) => {
    const edit = edits[article.url];
    if (!edit) return;
    patchEdit(article.url, { saving: true });
    try {
      const res = await fetch("/api/news-db", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          articles: [{
            title: article.title,
            url: article.url,
            category: article.category,
            published_date: article.published_date,
            topic_tags: edit.topics,
            company_tags: edit.companies,
            macro_tags: edit.macro,
            notes: edit.notes.trim() ? edit.notes : (contentCache[article.url]?.text ?? ""),
          }],
        }),
      });
      patchEdit(article.url, { saving: false, saved: res.ok });
      if (res.ok) void loadSaved();
    } catch {
      patchEdit(article.url, { saving: false });
    }
  };

  // ── 기사 원문 가져오기 ──────────────────────────────────────────────────────────

  const fetchArticleContent = async (article: HankyungArticle): Promise<string> => {
    const { url } = article;
    setContentCache((prev) => ({ ...prev, [url]: { loading: true, text: "", error: "" } }));
    try {
      const res = await fetch(`/api/hankyung-article-content?url=${encodeURIComponent(url)}`);
      const data = (await res.json()) as { content?: string; error?: string };
      if (res.ok && data.content) {
        setContentCache((prev) => ({ ...prev, [url]: { loading: false, text: data.content!, error: "" } }));
        return data.content;
      }
      setContentCache((prev) => ({
        ...prev,
        [url]: { loading: false, text: "", error: data.error ?? "본문을 불러올 수 없습니다." },
      }));
      return "";
    } catch {
      setContentCache((prev) => ({
        ...prev,
        [url]: { loading: false, text: "", error: "본문을 불러오는 중 오류가 발생했습니다." },
      }));
      return "";
    }
  };

  // ── 저장 목록 항목 클릭 ──────────────────────────────────────────────────────

  const handleSavedClick = (url: string) => {
    const row = savedArticles.find((r) => r.url === url);
    if (!row) return;
    setTopicInput("");
    setCompanyInput("");
    setMacroInput("");
    setVisitedUrls((prev) => (prev.has(url) ? prev : new Set([...prev, url])));
    setFocusedUrl(url);
    setEdits((prev) => ({
      ...prev,
      [url]: {
        topics: row.topic_tags,
        companies: row.company_tags,
        macro: row.macro_tags,
        notes: row.notes,
        tagging: false,
        saving: false,
        saved: true,
        summarizing: false,
        summary: "",
        summaryError: "",
      },
    }));
  };

  // ── 파생 값 ──────────────────────────────────────────────────────────────────

  // 오늘(로컬 기준) 저장한 기사 수 — 카테고리 통합 일일 10개 목표 게이지용
  const todaySavedCount = savedArticles.filter((r) => {
    const d = new Date(r.created_at);
    const now = new Date();
    return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
  }).length;

  // ── 저장 목록 필터 (검색어 + Company/Topic + 기간) ─────────────────────────────
  const allSavedCompanies = useMemo(
    () => [...new Set(savedArticles.flatMap((r) => r.company_tags))].sort(),
    [savedArticles],
  );
  const allSavedTopics = useMemo(
    () => [...new Set(savedArticles.flatMap((r) => r.topic_tags))].sort(),
    [savedArticles],
  );
  const filteredSavedArticles = useMemo(() => {
    const q = savedSearch.trim().toLowerCase();
    return savedArticles.filter((r) => {
      if (q && !r.title.toLowerCase().includes(q)) return false;
      if (savedCompany && !r.company_tags.includes(savedCompany)) return false;
      if (savedTopic && !r.topic_tags.includes(savedTopic)) return false;
      if (!inDateRange(r.published_date ?? r.created_at, savedFromDate, savedToDate)) return false;
      return true;
    });
  }, [savedArticles, savedSearch, savedCompany, savedTopic, savedFromDate, savedToDate]);

  const toArticleShape = (row: SavedArticleRow): HankyungArticle => ({
    title: row.title,
    url: row.url,
    category: toDisplayCategory(row.category),
    time: "",
    published_date: row.published_date,
  });
  const savedAsArticles: HankyungArticle[] = filteredSavedArticles.map(toArticleShape);
  const allSavedAsArticles: HankyungArticle[] = savedArticles.map(toArticleShape);

  // 키워드 검색 결과(category: "search")는 실제 카테고리 정보가 없어 탭으로 나눌 수 없다 —
  // 기간만 지정한 검색(카테고리 목록 페이지 기반)만 실제 카테고리를 갖고 있어 탭 필터링이 가능하다.
  const searchHasRealCategories = viewMode === "search"
    && searchResults.some((a) => (CATEGORY_ORDER as readonly string[]).includes(a.category));

  const catArticles = (
    viewMode === "search"
      ? (searchHasRealCategories ? searchResults.filter((a) => a.category === activeCategory) : searchResults)
      : viewMode === "saved" ? savedAsArticles : articles[activeCategory]
  ).filter((a) => !deletedArticleUrls.has(a.url));
  const allArticles = (
    viewMode === "search" ? searchResults
      : viewMode === "saved" ? allSavedAsArticles
      : CATEGORY_ORDER.flatMap((cat) => articles[cat])
  ).filter((a) => !deletedArticleUrls.has(a.url));
  const focusedArticle = focusedUrl
    ? allArticles.find((a) => a.url === focusedUrl) ?? null
    : null;
  const focusedEdit = focusedUrl ? edits[focusedUrl] : null;
  const focusedContent = focusedUrl ? contentCache[focusedUrl] : null;
  const focusedSavedRow = focusedUrl ? (savedArticles.find((r) => r.url === focusedUrl) ?? null) : null;

  useEffect(() => {
    if (focusedArticle && !contentCache[focusedArticle.url]) {
      void fetchArticleContent(focusedArticle);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusedArticle?.url]);
  const topicSuggestions = focusedUrl
    ? TOPIC_OPTIONS.filter((t) => !focusedEdit?.topics.includes(t) && t.toLowerCase().includes(topicInput.toLowerCase()))
    : [];
  const macroSuggestions = focusedUrl
    ? MACRO_OPTIONS.filter((m) => !focusedEdit?.macro.includes(m) && m.toLowerCase().includes(macroInput.toLowerCase()))
    : [];

  // ── 렌더 ─────────────────────────────────────────────────────────────────────

  // Idle / Loading 화면
  if (phase !== "list") {
    return (
      <div className="space-y-4">
        <div className="flex flex-col items-center justify-center gap-4 rounded-xl border border-[#DDE8E5] bg-white py-24 shadow-sm">
          {phase === "loading" ? (
            <>
              <Loader2 size={22} className="animate-spin text-[#94A8A0]" />
              <p className="text-[13px] text-[#94A8A0]">한국경제 기사를 불러오는 중...</p>
            </>
          ) : (
            <>
              <p className="text-[13px] text-[#94A8A0]">한국경제 경제·금융·오피니언·국제·부동산 탭의 최신 기사를 불러옵니다</p>
              <button
                type="button"
                onClick={loadArticles}
                className="rounded-lg bg-[#005B52] px-6 py-2.5 text-[13px] font-semibold text-white hover:bg-[#15583d] transition"
              >
                한국경제 기사 불러오기
              </button>
              {error && <p className="text-[12px] font-medium text-red-500">{error}</p>}
            </>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <section className="rounded-card border border-[#DDE8E5] bg-white p-5 shadow-card">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary text-white">
              <Newspaper size={22} />
            </span>
            <div>
              <h2 className="text-lg font-black text-[#0D2318]">뉴스 DB</h2>
              <p className="text-xs font-semibold text-[#7A9488]">
                주요 경제 뉴스 및 공시 정보를 실시간으로 필터링하고 AI 트렌드 요약을 생성합니다
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <div className="flex rounded-btn bg-[#F0F5F4] p-1 flex-wrap gap-0.5">
              {CATEGORY_ORDER.map((cat) => {
                const { label } = CATEGORY_META[cat];
                const count = viewMode === "search" && searchHasRealCategories
                  ? searchResults.filter((a) => a.category === cat).length
                  : articles[cat].length;
                const active = viewMode !== "saved" && activeCategory === cat;
                return (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => {
                      setActiveCategory(cat);
                      if (viewMode === "saved") setViewMode("browse");
                    }}
                    className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-bold transition ${
                      active ? "bg-primary text-white shadow-soft" : "text-[#4B6358] hover:text-primary"
                    }`}
                  >
                    {label}
                    <span className={`ml-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-bold ${
                      active ? "bg-white/20 text-white" : "bg-[#DFE9E5] text-[#5F7A70]"
                    }`}>
                      {count}
                    </span>
                  </button>
                );
              })}
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
                  {savedArticles.length}
                </span>
              </button>
            </div>
          </div>
        </div>
      </section>

      <div className="rounded-xl border border-[#DDE8E5] bg-white p-6 shadow-sm overflow-hidden flex flex-col gap-4">

      {viewMode === "saved" && savedError && (
        <p className="text-[12px] font-medium text-red-500">{savedError}</p>
      )}

      {viewMode === "saved" && (
        <SavedFilterBar
          search={savedSearch} onSearch={setSavedSearch}
          company={savedCompany} onCompany={setSavedCompany}
          topic={savedTopic} onTopic={setSavedTopic}
          allCompanies={allSavedCompanies} allTopics={allSavedTopics}
          fromDate={savedFromDate} onFromDate={setSavedFromDate}
          toDate={savedToDate} onToDate={setSavedToDate}
          placeholder="제목 검색..."
        />
      )}

      {viewMode !== "saved" && (
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <SearchDateBar
              keyword={searchKeyword} onKeyword={setSearchKeyword}
              fromDate={searchStartDate} onFromDate={setSearchStartDate}
              toDate={searchEndDate} onToDate={setSearchEndDate}
              searching={searchLoading}
              onSubmit={() => void runSearch(1)}
              onReset={() => {
                setSearchKeyword("");
                setSearchStartDate("");
                setSearchEndDate("");
                setSearchResults([]);
                setSearchTotal(0);
                setSearchHasMore(false);
                setSearchError("");
                setViewMode("browse");
              }}
              placeholder="검색어 (예: 반도체, 금리)"
            />
            {/* 오늘 저장한 기사 게이지바 */}
            <div className="flex items-center gap-3">
              <span className="shrink-0 text-[13px] font-semibold text-[#5F7A70]">오늘 저장한 기사</span>
              <div className="h-3 w-72 overflow-hidden rounded-full bg-[#EEF4F1]">
                <div
                  className={`h-full rounded-full transition-all ${todaySavedCount >= 10 ? "bg-primary" : "bg-emerald-400"}`}
                  style={{ width: `${Math.min(100, (todaySavedCount / 10) * 100)}%` }}
                />
              </div>
              <span className={`shrink-0 text-[13px] font-bold ${todaySavedCount >= 10 ? "text-primary" : "text-[#5F7A70]"}`}>
                {todaySavedCount} / 10
              </span>
            </div>
          </div>
          {searchError && <p className="text-[12px] font-medium text-red-500">{searchError}</p>}
          {searchTotal > 0 && (
            <p className="text-[12px] text-[#5F7A70]">총 {searchTotal.toLocaleString()}건 중 {searchResults.length}건 표시</p>
          )}
        </div>
      )}

      {/* 기사 목록 */}
      <div className="overflow-hidden rounded-xl border border-[#DDE8E5] shadow-sm" style={{ minHeight: 580 }}>
        <div className="flex w-full flex-col bg-white">
          {/* 목록 헤더 */}
          <div className="border-b border-[#E8F0ED] px-4 py-3">
            <p className="text-[11px] font-semibold text-[#94A8A0] uppercase tracking-wide">
              기사 목록 · {catArticles.length}건
            </p>
          </div>

          {/* 기사 행 */}
          <div className="flex-1 overflow-y-auto">
            {viewMode === "saved" && savedLoading ? (
              <div className="flex items-center justify-center gap-2 py-16 text-[#94A8A0]">
                <Loader2 size={18} className="animate-spin" />
                <span className="text-[13px]">저장 목록을 불러오는 중...</span>
              </div>
            ) : catArticles.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-center">
                <Inbox size={28} className="mx-auto mb-2 text-[#B9CCC4]" />
                <p className="text-[13px] font-semibold text-[#5F7A70]">
                  {viewMode === "saved" ? "저장된 기사 없음" : "기사 없음"}
                </p>
                <p className="mt-1 text-[11px] text-[#94A8A0]">
                  {viewMode === "search"
                    ? "검색어를 입력하고 검색해보세요"
                    : viewMode === "saved"
                    ? "기사를 선택하고 저장하면 여기에 표시됩니다"
                    : "새로고침을 눌러보세요"}
                </p>
              </div>
            ) : (
              <div className="divide-y divide-[#E8F0ED]">
                {catArticles.map((article, idx) => {
                  const isSelected = selectedUrls.has(article.url);
                  const isFocused = focusedUrl === article.url;
                  const isVisited = visitedUrls.has(article.url);
                  const isSaved = viewMode === "saved" ? true : savedArticles.some((r) => r.url === article.url);
                  const savedRow = viewMode === "saved" ? savedArticles.find((r) => r.url === article.url) : null;
                  return (
                    <div
                      key={article.url}
                      role="button"
                      tabIndex={0}
                      onClick={() => (viewMode === "saved" ? handleSavedClick(article.url) : handleArticleClick(article))}
                      onKeyDown={(e) => {
                        if (e.key !== "Enter" && e.key !== " ") return;
                        e.preventDefault();
                        viewMode === "saved" ? handleSavedClick(article.url) : handleArticleClick(article);
                      }}
                      className={`group w-full flex items-start gap-3 px-4 py-3.5 text-left transition cursor-pointer ${
                        isFocused
                          ? "bg-emerald-50"
                          : isSelected
                          ? "bg-[#F6FAF8]/80"
                          : "hover:bg-[#F6FAF8]"
                      } ${isVisited && !isFocused ? "opacity-50" : ""}`}
                    >
                      {/* Left Hover Delete Button Container */}
                      <div className="relative w-5 h-5 shrink-0 flex items-center justify-center self-center">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            void deleteArticle(article);
                          }}
                          className="absolute inset-0 z-10 flex items-center justify-center rounded bg-red-50 text-red-500 hover:bg-red-100 hover:text-red-700 opacity-0 group-hover:opacity-100 transition-opacity"
                          title="삭제"
                        >
                          <Minus size={13} strokeWidth={3} />
                        </button>
                        {/* Default indicator when not hovered */}
                        {isSelected ? (
                          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-[#005B52] text-white">
                            <Check size={10} strokeWidth={3} />
                          </span>
                        ) : (
                          <div className="group-hover:opacity-0 w-1.5 h-1.5 rounded-full bg-slate-300 transition-opacity" />
                        )}
                      </div>

                      <div className="min-w-0 flex-1">
                        <p className={`text-[13px] font-semibold leading-snug line-clamp-2 ${
                          isFocused
                            ? "text-[#005B52]"
                            : isSelected
                            ? "text-[#33493F]"
                            : "text-[#1C3329] group-hover:text-[#005B52]"
                        }`}>
                          {viewMode === "search" && searchKeyword.trim() ? (
                            <HighlightText text={article.title} keyword={searchKeyword} />
                          ) : (
                            article.title
                          )}
                          {isPremiumArticle(article) && (
                            <span className="ml-1.5 inline-block rounded bg-amber-100 px-1.5 py-0.5 align-middle text-[10px] font-bold text-amber-700">
                              프리미엄
                            </span>
                          )}
                          {(() => {
                            const badge = getSourceBadge(article.url);
                            if (!badge) return null;
                            return (
                              <span className={`ml-1.5 inline-block rounded border px-1.5 py-0.5 align-middle text-[10px] font-bold ${badge.cls}`}>
                                {badge.label}
                              </span>
                            );
                          })()}
                        </p>
                        {articleDate(article) && (
                          <p className="mt-0.5 text-[11px] text-[#94A8A0]">{articleDate(article)}</p>
                        )}
                        {savedRow && ((savedRow.topic_tags.length > 0) || (savedRow.company_tags.length > 0) || (savedRow.macro_tags.length > 0)) && (
                          <div className="mt-1.5 hidden flex-wrap gap-1 group-hover:flex">
                            {savedRow.topic_tags.map((t) => (
                              <span key={`t-${t}`} className="rounded-full border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-[9px] font-bold text-emerald-700">{t}</span>
                            ))}
                            {savedRow.company_tags.map((t) => (
                              <span key={`c-${t}`} className="rounded-full border border-blue-200 bg-blue-50 px-1.5 py-0.5 text-[9px] font-bold text-blue-700">{t}</span>
                            ))}
                            {savedRow.macro_tags.map((t) => (
                              <span key={`m-${t}`} className="rounded-full border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[9px] font-bold text-amber-700">{t}</span>
                            ))}
                          </div>
                        )}
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
            {viewMode === "search" && searchHasMore && searchResults.length >= 20 && (
              <div className="p-3">
                <button
                  type="button"
                  onClick={() => void runSearch(searchPage + 1)}
                  disabled={searchLoading}
                  className="flex w-full items-center justify-center gap-1.5 rounded-md border border-[#DDE8E5] py-2 text-[12px] font-medium text-[#5F7A70] hover:bg-[#F6FAF8] transition disabled:opacity-50"
                >
                  {searchLoading ? <Loader2 size={12} className="animate-spin" /> : null}
                  더 보기
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 편집 팝업 */}
      {focusedArticle && mounted && createPortal(
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4 sm:p-8"
          onClick={() => setFocusedUrl(null)}
        >
          <div
            className={`flex max-h-[85vh] w-full flex-col overflow-hidden rounded-xl bg-white shadow-2xl transition-all duration-300 ${
              viewMode === "saved" ? "max-w-5xl" : "max-w-7xl"
            }`}
            onClick={(e) => e.stopPropagation()}
          >
            {viewMode === "saved" ? (
              /* ── 저장목록 간소화 뷰 ── */
              <div className="flex flex-1 flex-col overflow-y-auto">
                <div className="sticky top-0 z-10 border-b border-[#E8F0ED] bg-white px-5 py-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="mb-1 flex items-center gap-2">
                        <span className="text-[11px] font-medium text-[#94A8A0]">
                          {categoryLabel(focusedArticle.category)}
                        </span>
                        {articleDate(focusedArticle) && (
                          <span className="text-[11px] text-[#94A8A0]">{articleDate(focusedArticle)}</span>
                        )}
                      </div>
                      <p className="text-[15px] font-bold leading-snug text-[#1C3329]">
                        {focusedArticle.title}
                        {isPremiumArticle(focusedArticle) && (
                          <span className="ml-1.5 inline-block rounded bg-amber-100 px-1.5 py-0.5 align-middle text-[10px] font-bold text-amber-700">
                            프리미엄
                          </span>
                        )}
                        {(() => {
                          const badge = getSourceBadge(focusedArticle.url);
                          if (!badge) return null;
                          return (
                            <span className={`ml-1.5 inline-block rounded border px-1.5 py-0.5 align-middle text-[10px] font-bold ${badge.cls}`}>
                              {badge.label}
                            </span>
                          );
                        })()}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5">
                      <a
                        href={focusedArticle.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1 rounded-md border border-[#DDE8E5] px-2.5 py-1.5 text-[12px] font-medium text-[#5F7A70] hover:bg-[#F6FAF8] transition"
                      >
                        <ExternalLink size={12} />
                        원문
                      </a>
                      {focusedSavedRow && (
                        <button
                          type="button"
                          onClick={() => void deleteSaved(focusedSavedRow.id, focusedSavedRow.url)}
                          className="rounded-md border border-red-200 px-2.5 py-1.5 text-[12px] font-medium text-red-500 hover:bg-red-50 transition"
                        >
                          삭제
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => setFocusedUrl(null)}
                        className="rounded-md border border-[#DDE8E5] p-1.5 text-[#94A8A0] hover:bg-[#F6FAF8] transition"
                      >
                        <X size={13} />
                      </button>
                    </div>
                  </div>
                </div>
                <div className="flex-1 px-5 py-5 space-y-4">
                  {/* Topic 태그 */}
                  {(focusedSavedRow?.topic_tags?.length ?? 0) > 0 && (
                    <div>
                      <label className="mb-2 block text-[11px] font-semibold uppercase tracking-wide text-[#94A8A0]">
                        Topic 태그
                      </label>
                      <div className="flex flex-wrap gap-2">
                        {focusedSavedRow?.topic_tags?.map((t) => (
                          <TagChip key={t} label={t} color="topic" />
                        ))}
                      </div>
                    </div>
                  )}
                  {/* Company 태그 */}
                  {(focusedSavedRow?.company_tags?.length ?? 0) > 0 && (
                    <div>
                      <label className="mb-2 block text-[11px] font-semibold uppercase tracking-wide text-[#94A8A0]">
                        Company 태그
                      </label>
                      <div className="flex flex-wrap gap-2">
                        {focusedSavedRow?.company_tags?.map((c) => (
                          <TagChip key={c} label={c} color="company" />
                        ))}
                      </div>
                    </div>
                  )}
                  {/* Macro 태그 */}
                  {(focusedSavedRow?.macro_tags?.length ?? 0) > 0 && (
                    <div>
                      <label className="mb-2 block text-[11px] font-semibold uppercase tracking-wide text-[#94A8A0]">
                        Macro 태그
                      </label>
                      <div className="flex flex-wrap gap-2">
                        {focusedSavedRow?.macro_tags?.map((m) => (
                          <TagChip key={m} label={m} color="macro" />
                        ))}
                      </div>
                    </div>
                  )}
                  {/* 저장 내용 */}
                  <p className="whitespace-pre-line text-[17px] leading-relaxed text-[#33493F]">
                    {focusedSavedRow?.notes ?? ""}
                  </p>
                </div>
              </div>
            ) : (
            <div className="flex flex-1 flex-col overflow-hidden">
              {/* 편집 헤더 */}
              <div className="border-b border-[#E8F0ED] bg-white px-5 py-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="mb-1 flex items-center gap-2">
                      <span className="text-[11px] font-medium text-[#94A8A0]">
                        {categoryLabel(focusedArticle.category)}
                      </span>
                      {articleDate(focusedArticle) && (
                        <span className="text-[11px] text-[#94A8A0]">{articleDate(focusedArticle)}</span>
                      )}
                    </div>
                    <p className="text-[15px] font-bold leading-snug text-[#1C3329]">
                      {focusedArticle.title}
                      {isPremiumArticle(focusedArticle) && (
                        <span className="ml-1.5 inline-block rounded bg-amber-100 px-1.5 py-0.5 align-middle text-[10px] font-bold text-amber-700">
                          프리미엄
                        </span>
                      )}
                      {(() => {
                        const badge = getSourceBadge(focusedArticle.url);
                        if (!badge) return null;
                        return (
                          <span className={`ml-1.5 inline-block rounded border px-1.5 py-0.5 align-middle text-[10px] font-bold ${badge.cls}`}>
                            {badge.label}
                          </span>
                        );
                      })()}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => saveArticle(focusedArticle)}
                      disabled={focusedEdit?.saving || focusedEdit?.saved}
                      className={`flex min-w-[64px] items-center justify-center gap-1 rounded-md px-2.5 py-1.5 text-[12px] font-semibold transition ${
                        focusedEdit?.saved || focusedEdit?.saving
                          ? "cursor-default border border-[#DDE8E5] bg-[#EEF4F1] text-[#94A8A0]"
                          : "bg-primary text-white hover:bg-primary-light"
                      }`}
                    >
                      {focusedEdit?.saving ? (
                        <Loader2 size={12} className="animate-spin" />
                      ) : focusedEdit?.saved ? (
                        <Check size={12} />
                      ) : (
                        <Bookmark size={12} />
                      )}
                      {focusedEdit?.saving ? "저장 중" : focusedEdit?.saved ? "저장됨" : "저장"}
                    </button>
                    <button
                      type="button"
                      onClick={() => void summarizeArticle(focusedArticle)}
                      disabled={focusedEdit?.summarizing || focusedContent?.loading}
                      className="flex items-center gap-1 rounded-md border border-[#DDE8E5] px-2.5 py-1.5 text-[12px] font-semibold text-[#5F7A70] hover:bg-[#F6FAF8] disabled:opacity-40 transition"
                    >
                      {focusedEdit?.summarizing ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
                      AI 요약
                    </button>
                    <a
                      href={focusedArticle.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      className="flex items-center gap-1 rounded-md border border-[#DDE8E5] px-2.5 py-1.5 text-[12px] font-semibold text-[#5F7A70] hover:bg-[#F6FAF8] transition"
                    >
                      <ExternalLink size={12} />
                      원본
                    </a>
                    <button
                      type="button"
                      onClick={() => deselect(focusedArticle.url)}
                      className="rounded-md border border-[#DDE8E5] p-1.5 text-[#94A8A0] hover:bg-[#F6FAF8] transition"
                      title="선택 해제"
                    >
                      <X size={13} />
                    </button>
                  </div>
                </div>
              </div>

              {/* 편집 폼 (두 컬럼 레이아웃) */}
              <div className="flex flex-1 overflow-hidden min-h-0">
                {/* Left Panel: 원문 및 태그/요약 (스크롤 영역) */}
                <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4 border-r border-[#E8F0ED]">

                {/* Topic 태그 */}
                <div>
                  <label className="mb-2 block text-[12px] font-semibold uppercase tracking-wide text-[#94A8A0]">
                    Topic 태그
                  </label>
                  {focusedEdit?.tagging ? (
                    <div className="flex items-center gap-2 text-[13px] text-[#94A8A0]">
                      <Loader2 size={14} className="animate-spin" />
                      AI 태깅 중...
                    </div>
                  ) : (
                    <div className="flex flex-wrap items-center gap-2">
                      {focusedEdit?.topics.map((t) => (
                        <TagChip
                          key={t}
                          label={t}
                          color="topic"
                          onRemove={() => removeTopic(focusedArticle.url, t)}
                        />
                      ))}
                      <div className="relative">
                        <input
                          type="text"
                          value={topicInput}
                          onChange={(e) => setTopicInput(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" && topicInput) doAddTopic(focusedArticle.url, topicInput);
                          }}
                          placeholder="+ 태그"
                          className="w-20 rounded-full border border-dashed border-[#C5D6D0] px-2.5 py-1 text-[12px] text-[#5F7A70] placeholder:text-[#94A8A0] focus:border-emerald-400 focus:outline-none"
                        />
                        {topicInput && topicSuggestions.length > 0 && (
                          <div className="absolute left-0 top-full z-10 mt-1 max-h-44 overflow-y-auto rounded-lg border border-[#DDE8E5] bg-white shadow-lg">
                            {topicSuggestions.slice(0, 8).map((opt) => (
                              <button
                                key={opt}
                                type="button"
                                onClick={() => doAddTopic(focusedArticle.url, opt)}
                                className="block w-full px-3 py-2 text-left text-[13px] text-[#33493F] hover:bg-[#F6FAF8]"
                              >
                                {opt}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>

                {/* Company 태그 */}
                <div>
                  <label className="mb-2 block text-[12px] font-semibold uppercase tracking-wide text-[#94A8A0]">
                    Company 태그
                  </label>
                  <div className="flex flex-wrap items-center gap-2">
                    {focusedEdit?.companies.map((c) => (
                      <TagChip
                        key={c}
                        label={c}
                        color="company"
                        onRemove={() => removeCompany(focusedArticle.url, c)}
                      />
                    ))}
                    <input
                      type="text"
                      value={companyInput}
                      onChange={(e) => setCompanyInput(e.target.value)}
                      onKeyDown={(e) => {
                        if ((e.key === "Enter" || e.key === ",") && companyInput)
                          doAddCompany(focusedArticle.url, companyInput);
                      }}
                      placeholder="+ 기업명"
                      className="w-24 rounded-full border border-dashed border-[#C5D6D0] px-2.5 py-1 text-[12px] text-[#5F7A70] placeholder:text-[#94A8A0] focus:border-blue-400 focus:outline-none"
                    />
                  </div>
                </div>

                {/* Macro 태그 */}
                <div>
                  <label className="mb-2 block text-[12px] font-semibold uppercase tracking-wide text-[#94A8A0]">
                    Macro 태그
                  </label>
                  <div className="flex flex-wrap items-center gap-2">
                    {focusedEdit?.macro.map((m) => (
                      <TagChip
                        key={m}
                        label={m}
                        color="macro"
                        onRemove={() => removeMacro(focusedArticle.url, m)}
                      />
                    ))}
                    <div className="relative">
                      <input
                        type="text"
                        value={macroInput}
                        onChange={(e) => setMacroInput(e.target.value)}
                        onKeyDown={(e) => {
                          if ((e.key === "Enter" || e.key === ",") && macroInput)
                            doAddMacro(focusedArticle.url, macroInput);
                        }}
                        placeholder="+ 매크로"
                        className="w-20 rounded-full border border-dashed border-[#C5D6D0] px-2.5 py-1 text-[12px] text-[#5F7A70] placeholder:text-[#94A8A0] focus:border-amber-400 focus:outline-none"
                      />
                      {macroInput && macroSuggestions.length > 0 && (
                        <div className="absolute left-0 top-full z-10 mt-1 max-h-44 overflow-y-auto rounded-lg border border-[#DDE8E5] bg-white shadow-lg">
                          {macroSuggestions.slice(0, 8).map((opt) => (
                            <button
                              key={opt}
                              type="button"
                              onClick={() => doAddMacro(focusedArticle.url, opt)}
                              className="block w-full px-3 py-2 text-left text-[13px] text-[#33493F] hover:bg-[#F6FAF8]"
                            >
                              {opt}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {/* AI 요약 */}
                {(focusedEdit?.summarizing || focusedEdit?.summary || focusedEdit?.summaryError) && (
                  <div>
                    <label className="mb-2 block text-[11px] font-semibold uppercase tracking-wide text-[#94A8A0]">
                      AI 요약
                    </label>
                    {focusedEdit.summarizing ? (
                      <div className="flex items-center gap-2 rounded-lg border border-blue-100 bg-blue-50 px-4 py-3 text-[13px] text-blue-600">
                        <Loader2 size={13} className="animate-spin" />
                        AI 요약 중... (최대 60초 소요)
                      </div>
                    ) : focusedEdit.summaryError ? (
                      <div className="flex items-center justify-between gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-[13px] text-red-600">
                        {focusedEdit.summaryError}
                        <button
                          type="button"
                          onClick={() => void summarizeArticle(focusedArticle)}
                          className="shrink-0 underline underline-offset-2"
                        >
                          다시 시도
                        </button>
                      </div>
                    ) : (
                      <div className="rounded-lg border border-[#E8F0ED] bg-[#F6FAF8] px-4 py-3">
                        <MarkdownView text={focusedEdit.summary} />
                      </div>
                    )}
                  </div>
                )}

                {/* 기사 원문 */}
                <div>
                  <label className="mb-2 block text-[11px] font-semibold uppercase tracking-wide text-[#94A8A0]">
                    기사 원문
                  </label>
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
                          onClick={() => void fetchArticleContent(focusedArticle)}
                          className="shrink-0 rounded border border-[#DDE8E5] px-2 py-1 text-[11px] text-[#5F7A70] hover:bg-white"
                        >
                          다시 시도
                        </button>
                      </div>
                    ) : (
                      <p className="whitespace-pre-line text-[17px] leading-relaxed text-[#4B6358]">
                        {viewMode === "search" && searchKeyword.trim() ? (
                          <HighlightText text={focusedContent?.text ?? ""} keyword={searchKeyword} />
                        ) : (
                          focusedContent?.text
                        )}
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
                    value={focusedEdit?.notes ?? ""}
                    onChange={(e) => patchEdit(focusedArticle.url, { notes: e.target.value, saved: false })}
                    placeholder="기사를 읽고 직접 정리한 내용을 입력하세요..."
                    className="w-full flex-1 resize-none rounded-lg border border-[#DDE8E5] bg-white p-4 text-[13px] text-[#33493F] placeholder:text-[#94A8A0] focus:outline-none focus:ring-1 focus:ring-[#005B52] shadow-inner"
                    style={{
                      backgroundImage: "linear-gradient(rgba(95, 122, 112, 0.08) 1px, transparent 1px)",
                      backgroundSize: "100% 28px",
                      lineHeight: "28px",
                      paddingTop: "6px"
                    }}
                  />
                </div>
              </div>
            </div>
            )} {/* end viewMode !== "saved" */}
          </div>
        </div>
      , document.body)}

      </div>

      <AiLimitModal open={limitGuard.open} onClose={limitGuard.close} onSelect={limitGuard.onSelect} />
    </div>
  );
}
