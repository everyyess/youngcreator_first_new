"use client";

import { useMemo, useState } from "react";
import { AlertCircle, CheckCircle2, Loader2, X } from "lucide-react";

export interface ProposalDraftSection {
  title: string;
  content: string;
}

export interface ProposalDraftResponse {
  consultationBackground: ProposalDraftSection;
  aiRationale: ProposalDraftSection;
  existingPortfolioDiagnosis: ProposalDraftSection;
  newPortfolioRationale: ProposalDraftSection;
}

type SectionKey = keyof ProposalDraftResponse;

const SECTION_ORDER: SectionKey[] = [
  "consultationBackground",
  "aiRationale",
  "existingPortfolioDiagnosis",
  "newPortfolioRationale",
];

interface ReviewState {
  content: string;
  checked: boolean;
  pbComment: string;
}

interface ProposalReviewModalProps {
  draft: ProposalDraftResponse;
  sectionIssues?: Partial<Record<SectionKey, string>>;
  onCancel: () => void;
  onApprove: (finalSections: Record<SectionKey, { title: string; content: string; pbComment: string }>) => void;
}

export default function ProposalReviewModal({ draft, sectionIssues, onCancel, onApprove }: ProposalReviewModalProps) {
  const [reviewState, setReviewState] = useState<Record<SectionKey, ReviewState>>(() => {
    const initial = {} as Record<SectionKey, ReviewState>;
    for (const key of SECTION_ORDER) {
      initial[key] = { content: draft[key]?.content ?? "", checked: false, pbComment: "" };
    }
    return initial;
  });

  const [editingKey, setEditingKey] = useState<SectionKey | null>(null);

  const allChecked = useMemo(
    () => SECTION_ORDER.every((key) => reviewState[key].checked),
    [reviewState],
  );

  const updateSection = (key: SectionKey, patch: Partial<ReviewState>) => {
    setReviewState((prev) => ({ ...prev, [key]: { ...prev[key], ...patch } }));
  };

  const handleApprove = () => {
    if (!allChecked) return;
    const final = {} as Record<SectionKey, { title: string; content: string; pbComment: string }>;
    for (const key of SECTION_ORDER) {
      final[key] = {
        title: draft[key]?.title ?? key,
        content: reviewState[key].content,
        pbComment: reviewState[key].pbComment,
      };
    }
    onApprove(final);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="flex max-h-[90vh] w-full max-w-3xl flex-col rounded-xl bg-white shadow-xl">
        {/* 헤더 */}
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
          <div>
            <div className="text-[16px] font-bold text-slate-800">제안서 초안 검토</div>
            <div className="mt-0.5 text-[12px] text-slate-400">
              AI가 작성한 초안입니다. 각 항목을 확인하고 필요 시 수정한 뒤 승인해주세요.
            </div>
          </div>
          <button onClick={onCancel} className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600">
            <X size={20} />
          </button>
        </div>

        {/* 안내 배너 */}
        <div className="mx-6 mt-4 flex items-start gap-2 rounded-lg border border-[#B8975A]/40 bg-[#FFFDF5] px-3.5 py-3 text-[12px] text-[#8A6D3B]">
        <AlertCircle size={16} className="mt-0.5 shrink-0 text-[#B8975A]" />
          <span>
            본 초안은 AI가 상담 기록을 바탕으로 자동 생성한 것으로, 사실과 다르거나 부적절한 표현이 포함될 수 있습니다.
            모든 항목을 직접 검토·확인해야 제안서를 생성할 수 있습니다.
          </span>
        </div>

        {/* 섹션 목록 */}
        <div className="flex-1 space-y-3 overflow-y-auto px-6 py-4">
          {SECTION_ORDER.map((key) => {
            const section = draft[key];
            const state = reviewState[key];
            const isEditing = editingKey === key;
            return (
              <div
                key={key}
                className={`rounded-lg border p-4 transition ${
                  state.checked ? "border-[#1428A0]/30 bg-[#EEF1FA]" : "border-slate-200 bg-white"
                }`}
              >
                             <div className="mb-2 flex items-center justify-between">
                  <div className="text-[14px] font-bold text-slate-800">{section?.title ?? key}</div>
                  <label className="flex cursor-pointer items-center gap-2 text-[12px] font-bold text-slate-600">
                    <span
                      onClick={() => updateSection(key, { checked: !state.checked })}
                      className={`flex h-5 w-5 items-center justify-center rounded border-2 transition ${
                        state.checked ? "border-[#1428A0] bg-[#1428A0]" : "border-slate-300 bg-white"
                      }`}
                    >
                      {state.checked && <CheckCircle2 size={14} className="text-white" />}
                    </span>
                    <span className={state.checked ? "text-[#1428A0]" : ""}>검토 완료</span>
                  </label>
                </div>

                {sectionIssues?.[key] && (
                                    <div className="mb-2 flex items-start gap-1.5 rounded-md border border-[#B8975A]/40 bg-[#FFFDF5] px-2.5 py-2 text-[12px] text-[#8A6D3B]">
                    <AlertCircle size={14} className="mt-0.5 shrink-0" />
                    <span>AI 팩트체크 지적사항: {sectionIssues[key]}</span>
                  </div>
                )}

                {isEditing ? (
                  <textarea
                    value={state.content}
                    onChange={(e) => updateSection(key, { content: e.target.value })}
                    onBlur={() => setEditingKey(null)}
                    autoFocus
                    rows={5}
                    className="w-full rounded-md border border-slate-300 px-3 py-2 text-[13px] leading-relaxed text-slate-700 outline-none focus:border-[#2f2f9d]"
                  />
                ) : (
                  <p
                    onClick={() => setEditingKey(key)}
                    className="cursor-text whitespace-pre-wrap rounded-md border border-transparent px-1 py-1 text-[13px] leading-relaxed text-slate-700 hover:border-slate-200 hover:bg-slate-50"
                    title="클릭해서 수정"
                  >
                    {state.content || <span className="text-slate-300">내용 없음 — 클릭해서 직접 작성</span>}
                  </p>
                )}

                <input
                  type="text"
                  value={state.pbComment}
                  onChange={(e) => updateSection(key, { pbComment: e.target.value })}
                  placeholder="PB 코멘트 (선택 — 제안서에 별도 표기됩니다)"
                  className="mt-2 w-full rounded-md border border-slate-200 px-2.5 py-1.5 text-[12px] text-slate-600 outline-none focus:border-[#2f2f9d]"
                />
              </div>
            );
          })}
        </div>

        {/* 하단 액션 */}
        <div className="flex items-center justify-between border-t border-slate-200 px-6 py-4">
          <div className="text-[12px] text-slate-400">
            {SECTION_ORDER.filter((k) => reviewState[k].checked).length} / {SECTION_ORDER.length} 항목 검토 완료
          </div>
          <div className="flex gap-2">
            <button
              onClick={onCancel}
              className="rounded-md border border-slate-200 px-4 py-2 text-[13px] font-semibold text-slate-600 hover:bg-slate-50"
            >
              취소
            </button>
            <button
              onClick={handleApprove}
              disabled={!allChecked}
              className={`flex items-center gap-1.5 rounded-md px-4 py-2 text-[13px] font-bold text-white transition ${
                allChecked ? "bg-[#2f2f9d] hover:bg-[#0B1F3A]" : "cursor-not-allowed bg-slate-300"
              }`}
            >
              <CheckCircle2 size={15} />
              승인하고 제안서 생성
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}