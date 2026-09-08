/**
 * Human-In-The-Loop 검토 항목 — 통합 인사이트 리포트 생성
 *
 * 상담실 제안서(ProposalReviewModal)와 같은 방식으로, PB가 각 STEP의 AI 산출물을
 * 항목 단위로 읽고 고친 뒤 승인하게 한다. 승인 전 수정 내용은 즉시 job.result에
 * 되반영되어 다음 STEP이 "PB가 고친 내용"을 근거로 실행된다.
 *
 * 항목 id는 result 내 위치를 가리키는 경로 문자열이며, applyReviewItems가 이 id로
 * 되쓰기 지점을 찾는다. (임의 깊이 경로 대입 대신 명시적 분기 — 잘못된 위치에
 * 덮어쓰는 사고를 막는다.)
 */
import type { HitlReviewItem, HumanApprovalStep } from "./jobStore";
import type { UnifiedResearchResult } from "./types";

const clip = (value: string, max = 4000) => value.length > max ? value.slice(0, max) : value;

function item(
  id: string,
  step: HumanApprovalStep,
  title: string,
  content: string,
  hint = "",
): HitlReviewItem {
  const text = (content ?? "").trim();
  return { id, step, title, hint, content: text, original: text, edited: false, checked: false, pbComment: "" };
}

/**
 * 방금 끝난 STEP의 산출물 중 PB가 검토·수정할 항목을 만든다.
 * 근거 자료(evidence)·출처처럼 원본 데이터는 대상에서 제외하고, AI가 생성한 서술만 연다.
 */
export function buildReviewItems(step: HumanApprovalStep, result: UnifiedResearchResult): HitlReviewItem[] {
  if (step === 1) {
    return result.storedCards.map((card, index) =>
      item(`storedCards.${index}.conclusion`, 1, `${card.databaseLabel} 분석 결론`, card.conclusion,
        `근거 ${card.itemCount}건 · 신뢰도 ${card.confidence}${card.asOfDate ? ` · 기준일 ${card.asOfDate}` : ""}`));
  }
  if (step === 2) {
    return [
      item("integrated.summary", 2, "통합 결론", result.integrated.summary),
      item("integrated.tagAnalysis", 2, "연관 태그 분석", result.integrated.tagAnalysis),
      item("integrated.timeSeries", 2, "시계열 분석", result.integrated.timeSeries),
      item("integrated.trend", 2, "트렌드 분석", result.integrated.trend),
    ];
  }
  if (step === 3) {
    const items: HitlReviewItem[] = [];
    result.integrated.conflicts.forEach((row, index) =>
      items.push(item(`integrated.conflicts.${index}.description`, 3, `충돌 ${index + 1}`, row.description,
        row.databases.join(" · "))));
    result.integrated.gaps.forEach((row, index) =>
      items.push(item(`integrated.gaps.${index}.description`, 3, `정보 공백 ${index + 1}`, row.description,
        row.databases.join(" · "))));
    result.integrated.old.forEach((row, index) =>
      items.push(item(`integrated.old.${index}.description`, 3, `신선도 경고 ${index + 1}`, row.description,
        row.databases.join(" · "))));
    return items;
  }
  if (step === 4) {
    const items: HitlReviewItem[] = [];
    if (result.debate) {
      items.push(
        item("debate.proOpening", 4, "우호·강세 측 입론", result.debate.proOpening),
        item("debate.conOpening", 4, "비우호·약세 측 입론", result.debate.conOpening),
        item("debate.proRebuttal", 4, "우호·강세 측 반박", result.debate.proRebuttal),
        item("debate.conRebuttal", 4, "비우호·약세 측 반박", result.debate.conRebuttal),
        item("debate.rationale", 4, "종합 판정 근거", result.debate.rationale,
          `판정 ${result.debate.verdict} · 확신도 ${result.debate.confidence}`),
        item("debate.watchpoints", 4, "향후 확인할 지표·이벤트", result.debate.watchpoints),
      );
    }
    result.liveCards.forEach((card, index) =>
      items.push(item(`liveCards.${index}.conclusion`, 4, `${card.databaseLabel} 실시간 보강 결론`, card.conclusion,
        `근거 ${card.itemCount}건 · 신뢰도 ${card.confidence}`)));
    return items;
  }
  if (step === 5) {
    return result.report
      ? [item("report", 5, "최종 통합 인사이트 리포트", result.report, "승인 후 저장·PDF에 그대로 반영됩니다")]
      : [];
  }
  return [];
}

/** PB가 고친 내용을 result에 되반영한다. 알 수 없는 id는 무시(구버전 작업 호환). */
export function applyReviewItems(result: UnifiedResearchResult, items: HitlReviewItem[]): void {
  for (const entry of items) {
    const value = clip(entry.content ?? "");
    const parts = entry.id.split(".");

    if (entry.id === "report") { result.report = value; continue; }

    if (parts[0] === "integrated") {
      const field = parts[1];
      if (parts.length === 2 && (field === "summary" || field === "tagAnalysis" || field === "timeSeries" || field === "trend")) {
        result.integrated[field] = value;
        continue;
      }
      if (parts.length === 4 && parts[3] === "description"
        && (field === "conflicts" || field === "gaps" || field === "old")) {
        const row = result.integrated[field][Number(parts[2])];
        if (row) row.description = value;
        continue;
      }
      continue;
    }

    if (parts[0] === "debate" && parts.length === 2 && result.debate) {
      const field = parts[1];
      if (field === "proOpening" || field === "conOpening" || field === "proRebuttal"
        || field === "conRebuttal" || field === "rationale" || field === "watchpoints") {
        result.debate[field] = value;
      }
      continue;
    }

    if ((parts[0] === "storedCards" || parts[0] === "liveCards") && parts.length === 3 && parts[2] === "conclusion") {
      const card = (parts[0] === "storedCards" ? result.storedCards : result.liveCards)[Number(parts[1])];
      if (card) card.conclusion = value;
    }
  }
}

/** PB 코멘트를 STEP5 보고서 프롬프트에 넘길 지시문으로 정리한다. */
export function pbCommentDirective(items: HitlReviewItem[]): string {
  const comments = items
    .filter((entry) => (entry.pbComment ?? "").trim())
    .map((entry) => `- ${entry.title}: ${entry.pbComment.trim()}`);
  if (!comments.length) return "";
  return "\n\n[PB 검토 코멘트 — 보고서 작성 시 반드시 반영]\n" + comments.join("\n");
}
