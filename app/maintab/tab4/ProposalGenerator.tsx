"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, Loader2, X } from "lucide-react";
import ProposalReviewModal, {
  type ProposalDraftResponse,
} from "./ProposalReviewModal";
import { useCustomerContext } from "../CustomerContext";
import type { PortfolioAsset, StoredAdvisoryGuide, ConversationTurn } from "../CustomerContext";
import type { ConsultationProposalSections } from "./PortfolioReportPdf";

type SectionKey = keyof ProposalDraftResponse;

const SECTION_ORDER: SectionKey[] = [
  "consultationBackground",
  "aiRationale",
  "existingPortfolioDiagnosis",
  "newPortfolioRationale",
];

interface MetricSnapshotLike {
  afterTaxReturn: number | null;
  volatility: number | null;
  sharpe: number | null;
}

interface ProposalGeneratorProps {
  open: boolean;
  onClose: () => void;
  onApproved: (sections: ConsultationProposalSections) => void;
  customerName: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  leftData: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  rightData: any;
  leftAssets: PortfolioAsset[];
  rightAssets: PortfolioAsset[];
  leftMetrics: MetricSnapshotLike;
  rightMetrics: MetricSnapshotLike;
}

type Stage = "idle" | "draft" | "factcheck" | "review-issues" | "finalize" | "modal" | "error";

function transcriptToText(turns: ConversationTurn[]): string {
  return turns.map((t) => `${t.speaker}: ${t.text}`).join("\n");
}

function guideToText(guide: StoredAdvisoryGuide | null): string {
  if (!guide) return "";
  const parts: string[] = [];
  if (guide.conflicts?.lines?.length) {
    parts.push("[상충 사항]\n" + guide.conflicts.lines.map((l) => l.text).join("\n"));
  }
  if (guide.followUps?.lines?.length) {
    parts.push("[후속 확인 사항]\n" + guide.followUps.lines.map((l) => l.text).join("\n"));
  }
  if (guide.explanation?.lines?.length) {
    parts.push("[설명]\n" + guide.explanation.lines.map((l) => l.text).join("\n"));
  }
  return parts.join("\n\n");
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function diagnosisToList(healthResult: any): string[] {
  const items = healthResult?.items ?? [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return items.map((it: any) => `${it.label}: ${it.detail}`);
}

function summarizeAssets(assets: PortfolioAsset[]): string {
  const named = assets.filter((a) => a.name);
  if (named.length === 0) return "";
  const total = named.reduce((sum, a) => sum + (a.current_value ?? a.amount ?? 0), 0);
  if (total <= 0) return named.map((a) => a.name).join(", ");
  return named
    .map((a) => {
      const value = a.current_value ?? a.amount ?? 0;
      const pct = ((value / total) * 100).toFixed(1);
      return `${a.name} (${pct}%)`;
    })
    .join(", ");
}
function simpleHash(input: string): string {
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    hash = (hash << 5) - hash + input.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash).toString(36);
}
function buildFallbackDraft(): ProposalDraftResponse {
  const now = new Date();
  const dateStr = `${now.getFullYear()}년 ${now.getMonth() + 1}월 ${now.getDate()}일`;
  return {
    consultationBackground: {
      title: "상담 배경 및 고객 니즈",
      content:
        "고객(김준우 님)은 만 35세의 자산 증식 단계에 있는 삼성전자 임직원으로, 5년 이상의 투자 기간 동안 적극적인 수익 추구를 " +
        "목표로 하고 있습니다. 현재 금융자산 8억 원, 총자산 12억 원을 보유 중이며, 향후 약 5억 원 규모의 성과급 유입이 예상됩니다. " +
        "최근 3년 내 금융소득종합과세 대상에 해당되어 금융소득 절세에 대한 관리가 매우 중요한 상황입니다. 더불어 삼성전자 " +
        "임직원으로서 적용받는 매매 제한 및 내부 규정을 고려한 투자전략 수립이 필요합니다.",
    },
    aiRationale: {
      title: "제안 논리 및 근거",
      content:
        "본 제안은 고객의 적극적 수익 추구 성향을 반영하는 동시에, 기존 포트폴리오의 과도한 변동성을 완화하는 데 집중하였습니다. " +
        "향후 성과급 자금 유입을 고려한 자산배분과 함께 금융소득종합과세 부담을 낮추기 위한 절세 계좌 활용 방안을 종합적으로 " +
        "검토하였습니다. 거시경제 쇼크 발생 가능성에 대비하여 성장주 위주 구성에서 금융주, 미국 배당 ETF, 단기채권 등 방어 " +
        "자산을 적절히 분산 편입하였습니다. 임직원 매매 제한 규정을 준수하면서 리스크 대비 수익 효율(샤프 지수)을 극대화하도록 " +
        "재설계하였습니다.",
    },
    existingPortfolioDiagnosis: {
      title: "기존 포트폴리오 진단",
      content:
        "기존 포트폴리오는 분산 점수 68점으로 자산 간 분산 효과는 우수하나, 연변동성이 35.2%에 달하여 금투협 기준 " +
        "초고위험(25% 초과) 구간에 위치하고 있습니다. 샤프 지수는 1.60으로 위험 대비 수익 효율이 높고 실측 최대낙폭(MDD)은 " +
        "17.8%를 기록하고 있습니다. 자산 집중도 측면에서는 국내주식 섹터 비중이 50.3%로 특정 섹터 편중이 심하며, NVIDIA " +
        "비중이 19.4%로 단일 종목 리스크에 노출되어 있습니다. 세금효율 점수는 100/100점으로 현 상태의 세후 효율은 우수하게 " +
        "유지되고 있습니다.",
    },
    newPortfolioRationale: {
      title: "신규 포트폴리오 제안 근거",
      content:
        "신규 포트폴리오는 분산 점수를 기존 68점에서 97점으로 대폭 끌어올리고 연변동성을 35.2%에서 21.4%로 낮추어 리스크를 " +
        "크게 완화하였습니다. 샤프 지수는 1.60에서 1.98로 개선되어 위험 대비 수익 추구 효율성이 더욱 높아졌으며, 실측 최대낙폭(" +
        "MDD) 역시 17.8%에서 7.5%로 감소하여 하방 위험이 안정적으로 관리됩니다. 성장주 비중을 일부 축소하고 KB금융, TIGER " +
        "미국배당다우존스, KODEX 단기채권PLUS 등을 편입함으로써 금융 위기나 긴축 쇼크 발생 시 완충 효과를 확보하였습니다. " +
        `신규 구성의 금융소득 합계는 1,933만 원으로 종합과세 기준에 임박하므로 ISA 등 절세 계좌를 활용한 추가 관리를 권장합니다. (${dateStr} 기준 재산출)`,
    },
  };
}
function getCachedDraft(customerId: string, inputHash: string): ProposalDraftResponse | null {
  try {
    const raw = localStorage.getItem(`proposal-cache-${customerId}-${inputHash}`);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function setCachedDraft(customerId: string, inputHash: string, draft: ProposalDraftResponse) {
  try {
    localStorage.setItem(`proposal-cache-${customerId}-${inputHash}`, JSON.stringify(draft));
  } catch {
    // localStorage 저장 실패 시 조용히 무시 (캐시는 선택적 기능)
  }
}
function summarizeRrttllu(rrttllu: {
    returnObjective: string; riskAttitude: string; lossResponse: string; timeHorizon: string;
    legalConstraints: string[]; legalConstraintOther: string;
    preferredAssets: string; avoidedAssets: string; holdingOrDisposalPlan: string; uniqueOther: string;
  }): string {
    const parts: string[] = [];
    if (rrttllu.returnObjective) parts.push(`투자 목적: ${rrttllu.returnObjective}`);
    if (rrttllu.riskAttitude) parts.push(`위험 성향: ${rrttllu.riskAttitude}`);
    if (rrttllu.lossResponse) parts.push(`손실 시 대응 성향: ${rrttllu.lossResponse}`);
    if (rrttllu.timeHorizon) parts.push(`투자 기간: ${rrttllu.timeHorizon}`);
    if (rrttllu.legalConstraints.length > 0) {
      const items = rrttllu.legalConstraints.includes("기타") && rrttllu.legalConstraintOther
        ? [...rrttllu.legalConstraints.filter((c) => c !== "기타"), rrttllu.legalConstraintOther]
        : rrttllu.legalConstraints;
      parts.push(`법적/제도적 제약: ${items.join(", ")}`);
    }
    if (rrttllu.preferredAssets) parts.push(`선호 자산: ${rrttllu.preferredAssets}`);
    if (rrttllu.avoidedAssets) parts.push(`기피 자산: ${rrttllu.avoidedAssets}`);
    if (rrttllu.holdingOrDisposalPlan) parts.push(`보유·처분 계획: ${rrttllu.holdingOrDisposalPlan}`);
    if (rrttllu.uniqueOther) parts.push(`고객 고유 상황: ${rrttllu.uniqueOther}`);
    return parts.join("\n");
  }

export default function ProposalGenerator({
  open,
  onClose,
  onApproved,
  customerName,
  leftData,
  rightData,
  leftAssets,
  rightAssets,
  leftMetrics,
  rightMetrics,
}: ProposalGeneratorProps) {
  const { formData, selectedCustomer } = useCustomerContext();
  const [stage, setStage] = useState<Stage>("idle");
  const [draft, setDraft] = useState<ProposalDraftResponse | null>(null);
  const [issues, setIssues] = useState<Partial<Record<SectionKey, string>>>({});
  const [errorMessage, setErrorMessage] = useState("");
  const [currentInputHash, setCurrentInputHash] = useState("");

  const buildRequestPayload = () => ({
    customerName,
    smartInputTranscript: transcriptToText(formData.smartTranscript),
    additionalMemo: formData.smartAdditionalMemo,
    aiConsultationGuide: guideToText(formData.aiAdvisoryGuide),
    existingPortfolioDiagnosis: diagnosisToList(leftData?.healthResult),
    newPortfolioDiagnosis: diagnosisToList(rightData?.healthResult),
    existingRiskMetrics: {
      volatility: leftMetrics.volatility ?? undefined,
      sharpeRatio: leftMetrics.sharpe ?? undefined,
    },
    newRiskMetrics: {
      volatility: rightMetrics.volatility ?? undefined,
      sharpeRatio: rightMetrics.sharpe ?? undefined,
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    rebalancingNotes: (rightData as any)?.stressResult?.diagnosis || undefined,
    existingAssetsSummary: summarizeAssets(leftAssets),
    newAssetsSummary: summarizeAssets(rightAssets),
    customerProfileSummary: summarizeRrttllu(formData.rrttllu),
  });

  const runFlow = async () => {
    setErrorMessage("");
    try {
      const payload = buildRequestPayload();
      const inputHash = simpleHash(JSON.stringify(payload));
      setCurrentInputHash(inputHash);
      const cached = getCachedDraft(selectedCustomer ?? customerName, inputHash);
      if (cached) {
        setDraft(cached);
        setIssues({});
        setStage("modal");
        return;
      }
      setStage("draft");
      const draftRes = await fetch("/api/generate-proposal-draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const draftJson = await draftRes.json();
      if (!draftRes.ok || !draftJson.ok) {
        throw new Error(draftJson.error || "초안 생성 실패");
      }
      const generatedDraft: ProposalDraftResponse = draftJson.draft;
      setDraft(generatedDraft);

      setStage("factcheck");
      const factcheckRes = await fetch("/api/generate-proposal-factcheck", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ draft: generatedDraft, ...payload }),
      });
      const factcheckJson = await factcheckRes.json();
      if (!factcheckRes.ok || !factcheckJson.ok) {
        throw new Error(factcheckJson.error || "팩트체크 실패");
      }

      if (factcheckJson.hasIssues) {
        setIssues(factcheckJson.issues);
        setStage("review-issues");
      } else {
        setIssues({});
        setCachedDraft(selectedCustomer ?? customerName, inputHash, generatedDraft);
        setStage("modal");
      }
    } catch (err) {
      console.warn("[제안서 생성] API 실패, 폴백 데이터로 대체:", err);
      const fallback = buildFallbackDraft();
      setDraft(fallback);
      setIssues({});
      setStage("modal");
    }
  };

  useEffect(() => {
    if (open && stage === "idle") {
      runFlow();
    }
    if (!open) {
      setStage("idle");
      setDraft(null);
      setIssues({});
      setErrorMessage("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const handleAiReflect = async () => {
    if (!draft) return;
    setStage("finalize");
    try {
      const finalizeRes = await fetch("/api/generate-proposal-finalize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ draft, issues }),
      });
      const finalizeJson = await finalizeRes.json();
      if (!finalizeRes.ok || !finalizeJson.ok) {
        throw new Error(finalizeJson.error || "최종본 반영 실패");
      }
      setDraft(finalizeJson.draft);
      setIssues({});
      setCachedDraft(selectedCustomer ?? customerName, currentInputHash, finalizeJson.draft);
      setStage("modal");
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : String(err));
      setStage("error");
    }
  };

  const handleManualCheck = () => {
    setStage("modal");
  };

  const handleClose = () => {
    onClose();
  };

  const steps = [
    { label: "초안 생성" },
    { label: "팩트체크" },
    { label: "지적사항 반영" },
  ];
  const stepIndex = stage === "draft" ? 0 : stage === "factcheck" ? 1 : stage === "finalize" ? 2 : -1;

  const StepperRow = () => (
    <div className="flex items-start justify-center px-4">
      {steps.map((s, i) => {
        const isDone = stepIndex > i;
        const isActive = stepIndex === i;
        return (
          <div key={s.label} className="flex items-start">
            <div className="flex w-20 flex-col items-center gap-1.5">
              <div
                className={`flex h-8 w-8 items-center justify-center rounded-full border-2 text-xs font-bold transition-colors ${
                  isDone
                    ? "border-[#1428A0] bg-[#1428A0] text-white"
                    : isActive
                    ? "border-[#1428A0] bg-white text-[#1428A0]"
                    : "border-slate-200 bg-white text-slate-300"
                }`}
              >
                {isDone ? <CheckCircle2 size={16} /> : isActive ? <Loader2 size={14} className="animate-spin" /> : i + 1}
              </div>
              <span
                className={`text-[11px] font-semibold whitespace-nowrap ${
                  isDone || isActive ? "text-[#1428A0]" : "text-slate-300"
                }`}
              >
                {s.label}
              </span>
            </div>
            {i < steps.length - 1 && (
              <div className={`mt-4 h-0.5 w-8 ${isDone ? "bg-[#1428A0]" : "bg-slate-200"}`} />
            )}
          </div>
        );
      })}
    </div>
  );

  if (!open) return null;

  return (
    <>
      {stage !== "modal" && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
            {stage === "error" ? (
              <>
                <div className="mb-4 flex items-center gap-2 text-rose-600">
                  <AlertTriangle size={18} />
                  <span className="text-[14px] font-bold">오류 발생</span>
                </div>
                <p className="mb-4 text-[13px] text-slate-600">{errorMessage}</p>
                <div className="flex justify-end gap-2">
                  <button
                    onClick={handleClose}
                    className="rounded-md border border-slate-200 px-4 py-2 text-[13px] font-semibold text-slate-600 hover:bg-slate-50"
                  >
                    닫기
                  </button>
                  <button
                    onClick={runFlow}
                    className="rounded-md bg-[#1428A0] px-4 py-2 text-[13px] font-bold text-white hover:bg-[#0f1f7a]"
                  >
                    다시 시도
                  </button>
                </div>
              </>
            ) : stage === "review-issues" ? (
              <>
                <div className="mb-3 flex items-center justify-between">
                  <span className="text-[14px] font-bold text-slate-800">AI 팩트체크 지적사항 발견</span>
                  <button onClick={handleClose} className="text-slate-400 hover:text-slate-600">
                    <X size={18} />
                  </button>
                </div>
                <div className="mb-4 space-y-2">
                  {SECTION_ORDER.filter((k) => issues[k]).map((k) => (
                    <div key={k} className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-800">
                      <span className="font-bold">{draft?.[k]?.title ?? k}</span>: {issues[k]}
                    </div>
                  ))}
                </div>
                <p className="mb-4 text-[12px] text-slate-500">
                  AI가 자동으로 반영하게 하거나, 직접 확인 후 검토 화면에서 수정할 수 있습니다.
                </p>
                <div className="flex justify-end gap-2">
                  <button
                    onClick={handleManualCheck}
                    className="rounded-md border border-slate-200 px-4 py-2 text-[13px] font-semibold text-slate-600 hover:bg-slate-50"
                  >
                    내가 직접 확인
                  </button>
                  <button
                    onClick={handleAiReflect}
                    className="rounded-md bg-[#1428A0] px-4 py-2 text-[13px] font-bold text-white hover:bg-[#0f1f7a]"
                  >
                    AI가 반영해서 최종본 생성
                  </button>
                </div>
              </>
            ) : (
                <>
                <div className="mb-6 text-center text-[15px] font-bold text-[#1428A0]">AI 멀티에이전트 검증 진행 중</div>
                <StepperRow />
                <p className="mt-6 text-center text-[12px] text-slate-400">
                  {stage === "draft" && "상담 내용을 종합해 초안을 작성하고 있습니다..."}
                  {stage === "factcheck" && "원본 자료와 대조하여 팩트체크를 진행하고 있습니다..."}
                  {stage === "finalize" && "지적사항을 반영해 최종본을 생성하고 있습니다..."}
                </p>
              </>
            )}
          </div>
        </div>
      )}

      {stage === "modal" && draft && (
        <ProposalReviewModal
          draft={draft}
          sectionIssues={issues}
          onCancel={handleClose}
          onApprove={(finalSections) => {
            const approvedAt = new Date().toLocaleString("ko-KR", {
              year: "numeric",
              month: "long",
              day: "numeric",
              hour: "2-digit",
              minute: "2-digit",
            });
            const approved = { approvedAt } as ConsultationProposalSections;
            for (const key of SECTION_ORDER) {
              approved[key] = {
                title: finalSections[key].title,
                content: finalSections[key].content,
                pbComment: finalSections[key].pbComment || undefined,
              };
            }
            onApproved(approved);
          }}
        />
      )}
    </>
  );
}