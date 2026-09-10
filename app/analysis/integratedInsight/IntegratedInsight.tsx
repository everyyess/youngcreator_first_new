"use client";

import { useEffect, useMemo, useState } from "react";
import InsightDbTab from "./InsightDbTab";
import { NewsDbTab } from "./NewsDbTab";
import ReportDbTab from "./ReportDbTab";
import TelegramDbTab from "./TelegramDbTab";

type InnerTab = "insight" | "news" | "report" | "telegram";

const TABS: { id: InnerTab; label: string }[] = [
  { id: "insight", label: "통합 인사이트" },
  { id: "news", label: "뉴스 수집·저장" },
  { id: "report", label: "리포트 수집·저장" },
  { id: "telegram", label: "텔레그램 수집·저장" },
];

const STORAGE_KEY = "youngcreator-insight-inner-tab";

function readStoredTab(): InnerTab {
  if (typeof window === "undefined") return "insight";
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw && TABS.some((tab) => tab.id === raw)) return raw as InnerTab;
  } catch {
    /* localStorage 접근 불가 시 기본값 */
  }
  return "insight";
}

export default function IntegratedInsight() {
  // 통합 인사이트(InsightDbTab)는 telegram_saved·news_articles·report_db 세 테이블 + 실시간
  // 소스를 통합 조회한다. 그 세 테이블을 채우는 수집·태깅·저장 화면을 하위 탭으로 함께 노출한다.
  const [activeTab, setActiveTab] = useState<InnerTab>("insight");
  useEffect(() => { setActiveTab(readStoredTab()); }, []);

  const selectTab = (tab: InnerTab) => {
    setActiveTab(tab);
    try { window.localStorage.setItem(STORAGE_KEY, tab); } catch { /* 무시 */ }
  };

  // 한 번 연 탭은 언마운트하지 않고 display:none으로만 숨겨, 각 탭의 선택·필터·저장됨 표시 등
  // 내부 상태가 탭 전환 시에도 유지되게 한다. (앱의 다른 탭 전환 패턴과 동일)
  const [mountedTabs, setMountedTabs] = useState<Set<InnerTab>>(() => new Set(["insight"]));
  useEffect(() => {
    setMountedTabs((prev) => (prev.has(activeTab) ? prev : new Set([...prev, activeTab])));
  }, [activeTab]);

  const panels = useMemo(
    () => [
      { id: "insight" as const, node: <InsightDbTab /> },
      { id: "news" as const, node: <NewsDbTab /> },
      { id: "report" as const, node: <ReportDbTab /> },
      { id: "telegram" as const, node: <TelegramDbTab /> },
    ],
    [],
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex gap-1 overflow-x-auto rounded-lg border border-slate-200 bg-white p-1.5 shadow-soft">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => selectTab(tab.id)}
            className={[
              "flex min-h-10 shrink-0 flex-1 items-center justify-center rounded-md px-4 py-2 text-sm font-bold transition",
              activeTab === tab.id
                ? "bg-[#2563eb] text-white shadow-soft"
                : "bg-[#F3F5F9] text-slate-600 hover:bg-slate-100 hover:text-navy",
            ].join(" ")}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {panels.map((panel) =>
        mountedTabs.has(panel.id) ? (
          <div key={panel.id} style={{ display: activeTab === panel.id ? undefined : "none" }}>
            {panel.node}
          </div>
        ) : null,
      )}
    </div>
  );
}
