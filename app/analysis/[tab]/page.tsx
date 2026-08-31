import { redirect } from "next/navigation";
import AnalysisPageClient, { type AnalysisTopTab } from "../AnalysisPageClient";

const analysisTabBySegment: Record<string, AnalysisTopTab> = {
  tab1: "stock",
  tab2: "screener",
  tab3: "competitors",
  tab4: "insight",
  tab5: "elbEls",
};

export default async function AnalysisTabPage({ params }: { params: Promise<{ tab: string }> }) {
  const { tab } = await params;
  const activeTopTab = analysisTabBySegment[tab];

  if (!activeTopTab) {
    redirect("/analysis/tab1");
  }

  return <AnalysisPageClient initialTopTab={activeTopTab} />;
}
