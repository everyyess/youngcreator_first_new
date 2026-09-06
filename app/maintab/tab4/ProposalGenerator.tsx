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
  const { formData } = useCustomerContext();
  const [stage, setStage] = useState<Stage>("idle");
  const [draft, setDraft] = useState<ProposalDraftResponse | null>(null);
  const [issues, setIssues] = useState<Partial<Record<SectionKey, string>>>({});
  const [errorMessage, setErrorMessage] = useState("");

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
    setStage("draft");
    try {
      const payload = buildRequestPayload();
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
        setStage("modal");
      }
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : String(err));
      setStage("error");
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