"use client";

import { useMemo, useState } from "react";
import { AlertCircle, CheckCircle2, Loader2, RotateCcw } from "lucide-react";

/**
 * Human-In-The-Loop 검토 패널 — 상담실 제안서 검토(ProposalReviewModal)와 동일한
 * 상호작용·시각 언어를 공유한다.
 *   · 항목별 "검토 완료" 체크
 *   · 본문 클릭 → 인라인 편집
 *   · 항목별 PB 코멘트
 *   · 전 항목 검토 전까지 승인 버튼 비활성
 * 상담실은 모달, 통합 인사이트는 파이프라인 흐름 안의 인라인 패널이라
 * 컨테이너만 다르고 항목 카드와 하단 액션은 같은 형태를 쓴다.
 */

export type HitlReviewItemView = {
  id: string;
  title: string;
  hint?: string;
  content: string;
  original: string;
  edited: boolean;
  checked: boolean;
  pbComment: string;
};

export type HitlReviewPatch = { content?: string; checked?: boolean; pbComment?: string };

interface HitlReviewPanelProps {
  heading: string;
  description: string;
  items: HitlReviewItemView[];
  onChange: (id: string, patch: HitlReviewPatch) => void;
  onApprove: () => void;
  approveLabel: string;
  approving?: boolean;
  saving?: boolean;
  errorMessage?: string;
  /** 항목이 하나도 없을 때 문구 (예: 감지된 충돌 없음) */
  emptyLabel?: string;
}

const BRAND = "#2f2f9d";

export default function HitlReviewPanel({
  heading,
  description,
  items,
  onChange,
  onApprove,
  approveLabel,
  approving = false,
  saving = false,
  errorMessage = "",
  emptyLabel = "이 단계에서 검토할 항목이 없습니다.",
}: HitlReviewPanelProps) {
  const [editingId, setEditingId] = useState<string | null>(null);

  const checkedCount = useMemo(() => items.filter((entry) => entry.checked).length, [items]);
  const allChecked = items.length === 0 || checkedCount === items.length;

  return (
    <div className="mt-4 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-soft">
      <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-5 py-4">
        <div>
          <div className="text-[15px] font-bold text-slate-800">{heading}</div>
          <div className="mt-0.5 text-[12px] text-slate-400">{description}</div>
        </div>
        {saving && (
          <span className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-400">
            <Loader2 size={12} className="animate-spin" /> 저장 중
          </span>
        )}
      </div>

      {/* AI 주의 배너 — 상담실 제안서 검토와 동일 체계 */}
      <div className="mx-5 mt-4 flex items-start gap-2 rounded-lg border border-[#B8975A]/40 bg-[#FFFDF5] px-3.5 py-3 text-[12px] text-[#8A6D3B]">
        <AlertCircle size={16} className="mt-0.5 shrink-0 text-[#B8975A]" />
        <span>
          AI가 자동 생성한 중간 결과입니다. 사실과 다르거나 부적절한 표현이 포함될 수 있습니다.
          모든 항목을 직접 검토·확인해야 다음 단계를 실행할 수 있습니다.
        </span>
      </div>

      <div className="max-h-[420px] space-y-3 overflow-y-auto px-5 py-4">
        {items.length === 0 ? (
          <p className="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-4 py-6 text-center text-[12px] font-semibold text-slate-400">
            {emptyLabel}
          </p>
        ) : (
          items.map((entry) => {
            const isEditing = editingId === entry.id;
            const rows = Math.min(16, Math.max(4, Math.ceil(entry.content.length / 70)));
            return (
              <div
                key={entry.id}
                className={`rounded-lg border p-4 transition ${
                  entry.checked ? "border-[#2f2f9d]/30 bg-[#EEF1FA]" : "border-slate-200 bg-white"
                }`}
              >
                <div className="mb-2 flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-[14px] font-bold text-slate-800">{entry.title}</span>
                      {entry.edited && (
                        <span className="rounded-full bg-[#EEF1FA] px-2 py-0.5 text-[10px] font-bold text-[#2f2f9d]">
                          PB 수정됨
                        </span>
                      )}
                    </div>
                    {entry.hint && <div className="mt-0.5 text-[11px] text-slate-400">{entry.hint}</div>}
                  </div>
                  <button
                    type="button"
                    onClick={() => onChange(entry.id, { checked: !entry.checked })}
                    className="flex shrink-0 cursor-pointer items-center gap-2 text-[12px] font-bold text-slate-600"
                  >
                    <span
                      className={`flex h-5 w-5 items-center justify-center rounded border-2 transition ${
                        entry.checked ? "border-[#2f2f9d] bg-[#2f2f9d]" : "border-slate-300 bg-white"
                      }`}
                    >
                      {entry.checked && <CheckCircle2 size={14} className="text-white" />}
                    </span>
                    <span className={entry.checked ? "text-[#2f2f9d]" : ""}>검토 완료</span>
                  </button>
                </div>

                {isEditing ? (
                  <textarea
                    value={entry.content}
                    onChange={(event) => onChange(entry.id, { content: event.target.value })}
                    onBlur={() => setEditingId(null)}
                    autoFocus
                    rows={rows}
                    className="w-full rounded-md border border-slate-300 px-3 py-2 text-[13px] leading-relaxed text-slate-700 outline-none focus:border-[#2f2f9d]"
                  />
                ) : (
                  <p
                    onClick={() => setEditingId(entry.id)}
                    className="max-h-56 cursor-text overflow-y-auto whitespace-pre-wrap rounded-md border border-transparent px-1 py-1 text-[13px] leading-relaxed text-slate-700 hover:border-slate-200 hover:bg-slate-50"
                    title="클릭해서 수정"
                  >
                    {entry.content || <span className="text-slate-300">내용 없음 — 클릭해서 직접 작성</span>}
                  </p>
                )}

                <div className="mt-2 flex items-center gap-2">
                  <input
                    type="text"
                    value={entry.pbComment}
                    onChange={(event) => onChange(entry.id, { pbComment: event.target.value })}
                    placeholder="PB 코멘트 (선택 — 이후 단계와 최종 보고서에 반영됩니다)"
                    className="w-full rounded-md border border-slate-200 px-2.5 py-1.5 text-[12px] text-slate-600 outline-none focus:border-[#2f2f9d]"
                  />
                  {entry.edited && (
                    <button
                      type="button"
                      onClick={() => onChange(entry.id, { content: entry.original })}
                      title="AI 원본으로 되돌리기"
                      className="flex shrink-0 items-center gap-1 rounded-md border border-slate-200 px-2 py-1.5 text-[11px] font-semibold text-slate-500 transition hover:bg-slate-50"
                    >
                      <RotateCcw size={12} /> 원본
                    </button>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 px-5 py-4">
        <div className="text-[12px] text-slate-400">
          {checkedCount} / {items.length} 항목 검토 완료
        </div>
        <div className="flex items-center gap-2">
          {errorMessage && <span className="text-[11px] font-bold text-red-600">{errorMessage}</span>}
          <button
            type="button"
            onClick={onApprove}
            disabled={!allChecked || approving}
            style={allChecked && !approving ? { backgroundColor: BRAND } : undefined}
            className={`flex items-center gap-1.5 rounded-md px-4 py-2 text-[13px] font-bold text-white transition ${
              allChecked && !approving ? "hover:opacity-90" : "cursor-not-allowed bg-slate-300"
            }`}
          >
            {approving ? <Loader2 size={15} className="animate-spin" /> : <CheckCircle2 size={15} />}
            {approving ? "승인 처리 중…" : approveLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
