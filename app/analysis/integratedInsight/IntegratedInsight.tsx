"use client";

import InsightDbTab from "./InsightDbTab";

export default function IntegratedInsight() {
  // 뉴스·리포트·텔레그램의 DB 관리 화면은 숨기고 저장 데이터는 /api/insight-db에서 독립적으로 통합 조회한다.
  // 과거에 저장된 activeInnerTab 값과 무관하게 통합 인사이트를 바로 표시한다.
  return <InsightDbTab />;
}
