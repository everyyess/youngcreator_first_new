"use client";

import { useEffect, useState } from "react";
import { useCustomerContext } from "../../maintab/CustomerContext";
import { YoutubeDB } from "./YoutubeDB";
import { NewsDbTab } from "./NewsDbTab";
import { BlogDB } from "./BlogDB";
import TelegramDbTab from "./TelegramDbTab";
import ReportDbTab from "./ReportDbTab";
import InsightDbTab from "./InsightDbTab";

type InnerTab = "youtube" | "blog" | "telegram" | "news" | "report" | "insight";

export default function Tab4Page() {
  const { sharedUiState } = useCustomerContext();
  const activeTab = (sharedUiState.tab4?.activeInnerTab as InnerTab | undefined) ?? "youtube";

  // 한 번 방문한 하위탭은 언마운트하지 않고 display:none으로만 숨겨
  // 뉴스 DB 등의 내부 상태(선택/태그/저장됨 표시 등)가 탭 전환 시 유지되게 한다.
  const [mountedTabs, setMountedTabs] = useState<Set<InnerTab>>(new Set([activeTab]));
  useEffect(() => {
    setMountedTabs((prev) => (prev.has(activeTab) ? prev : new Set([...prev, activeTab])));
  }, [activeTab]);

  return (
    <>
      {mountedTabs.has("youtube") && (
        <div style={{ display: activeTab === "youtube" ? undefined : "none" }}>
          <YoutubeDB />
        </div>
      )}
      {mountedTabs.has("blog") && (
        <div style={{ display: activeTab === "blog" ? undefined : "none" }}>
          <BlogDB />
        </div>
      )}
      {mountedTabs.has("telegram") && (
        <div style={{ display: activeTab === "telegram" ? undefined : "none" }}>
          <TelegramDbTab />
        </div>
      )}
      {mountedTabs.has("news") && (
        <div style={{ display: activeTab === "news" ? undefined : "none" }}>
          <NewsDbTab />
        </div>
      )}
      {mountedTabs.has("report") && (
        <div style={{ display: activeTab === "report" ? undefined : "none" }}>
          <ReportDbTab />
        </div>
      )}
      {mountedTabs.has("insight") && (
        <div style={{ display: activeTab === "insight" ? undefined : "none" }}>
          <InsightDbTab />
        </div>
      )}
    </>
  );
}
