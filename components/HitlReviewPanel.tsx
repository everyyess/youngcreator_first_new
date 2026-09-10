"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertCircle, CheckCheck, CheckCircle2, ChevronRight, Loader2, RotateCcw, X } from "lucide-react";

/**
 * Human-In-The-Loop 검토 패널 — 상담실 제안서 검토(ProposalReviewModal)와 동일한
 * 상호작용·시각 언어를 공유한다.
 *   · 항목별 "검토 완료" 체크
 *   · 본문 클릭 → 인라인 편집
 *   · 항목별 PB 코멘트
 *   · 전 항목 검토 전까지 승인 버튼 비활성
 * 상담실 제안서 검토와 동일하게 모달(팝업)로 띄운다.
 */

export type HitlReviewItemView = {
  id: string;
  title: string;
  hint?: string;
  /** 해당 산출물의 원문·근거 자료를 여는 버튼 라벨. 없으면 버튼을 표시하지 않는다. */
  detailLabel?: string;
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
  onViewDetail?: (id: string) => void;
  onApprove: () => void;
  onClose: () => void;
  approveLabel: string;
  approving?: boolean;
  saving?: boolean;
  errorMessage?: string;
  /** 항목이 하나도 없을 때 문구 (예: 감지된 충돌 없음) */
  emptyLabel?: string;
}

const BRAND = "#003CDC";

export default function HitlReviewPanel({
  heading,
  description,
  items,
  onChange,
  onViewDetail,
  onApprove,
  onClose,
  approveLabel,
  approving = false,
  saving = false,
  errorMessage = "",
  emptyLabel = "이 단계에서 검토할 항목이 없습니다.",
}: HitlReviewPanelProps) {
  const [editingId, setEditingId] = useState<string | null>(null);

  const checkedCount = useMemo(() => items.filter((entry) => entry.checked).length, [items]);
  const allChecked = items.length === 0 || checkedCount === items.length;

  // 편집 중 실수로 닫히지 않도록, Esc는 편집을 먼저 해제한다
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (editingId) setEditingId(null);
      else onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [editingId, onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl bg-white shadow-xl">
        <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-6 py-4">
          <div>
            <div className="text-[16px] font-bold text-slate-800">{heading}</div>
            <div className="mt-0.5 text-[12px] text-slate-400">{description}</div>
          </div>
          <div className="flex items-center gap-2">
            {saving && (
              <span className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-400">
                <Loader2 size={12} className="animate-spin" /> 저장 중
              </span>
            )}
            <button
              type="button"
              onClick={onClose}
              title="닫기 (검토 내용은 저장됩니다)"
              className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
            >
              <X size={20} />
            </button>
          </div>
        </div>

      {/* AI 주의 배너 — 상담실 제안서 검토와 동일 체계 */}
        <div className="mx-6 mt-4 flex items-start gap-2 rounded-lg border border-[#B8975A]/40 bg-[#FFFDF5] px-3.5 py-3 text-[12px] text-[#8A6D3B]">
        <AlertCircle size={16} className="mt-0.5 shrink-0 text-[#B8975A]" />
        <span>
          AI가 자동 생성한 중간 결과입니다. 사실과 다르거나 부적절한 표현이 포함될 수 있습니다.
          모든 항목을 직접 검토·확인해야 다음 단계를 실행할 수 있습니다.
        </span>
      </div>

        <div className="flex-1 space-y-3 overflow-y-auto px-6 py-4">
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
                  entry.checked ? "border-[#003CDC]/30 bg-[#EEF2FE]" : "border-slate-200 bg-white"
                }`}
              >
                <div className="mb-2 flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-[14px] font-bold text-slate-800">{entry.title}</span>
                      {entry.edited && (
                        <span className="rounded-full bg-[#EEF2FE] px-2 py-0.5 text-[10px] font-bold text-[#003CDC]">
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
                        entry.checked ? "border-[#003CDC] bg-[#003CDC]" : "border-slate-300 bg-white"
                      }`}
                    >
                      {entry.checked && <CheckCircle2 size={14} className="text-white" />}
                    </span>
                    <span className={entry.checked ? "text-[#003CDC]" : ""}>검토 완료</span>
                  </button>
                </div>

                <div className="flex items-start gap-2">
                  {isEditing ? (
                    <textarea
                      value={entry.content}
                      onChange={(event) => onChange(entry.id, { content: event.target.value })}
                      onBlur={() => setEditingId(null)}
                      autoFocus
                      rows={rows}
                      className="min-w-0 flex-1 rounded-md border border-slate-300 px-3 py-2 text-[13px] leading-relaxed text-slate-700 outline-none focus:border-[#003CDC]"
                    />
                  ) : (
                    <p
                      onClick={() => setEditingId(entry.id)}
                      className="min-w-0 flex-1 max-h-56 cursor-text overflow-y-auto whitespace-pre-wrap rounded-md border border-transparent px-1 py-1 text-[13px] leading-relaxed text-slate-700 hover:border-slate-200 hover:bg-slate-50"
                      title="클릭해서 수정"
                    >
                      {entry.content || <span className="text-slate-300">내용 없음 — 클릭해서 직접 작성</span>}
                    </p>
                  )}
                  {entry.detailLabel && onViewDetail && (
                    <button
                      type="button"
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => onViewDetail(entry.id)}
                      className="mt-0.5 flex shrink-0 items-center gap-0.5 rounded-md border border-blue-200 bg-blue-50 px-2.5 py-1.5 text-[11px] font-bold text-[#003CDC] transition hover:border-[#003CDC] hover:bg-[#003CDC] hover:text-white"
                    >
                      {entry.detailLabel}
                      <ChevronRight size={12} />
                    </button>
                  )}
                </div>

                <div className="mt-2 flex items-center gap-2">
                  <input
                    type="text"
                    value={entry.pbComment}
                    onChange={(event) => onChange(entry.id, { pbComment: event.target.value })}
                    placeholder="PB 코멘트 (선택 — 이후 단계와 최종 보고서에 반영됩니다)"
                    className="w-full rounded-md border border-slate-200 px-2.5 py-1.5 text-[12px] text-slate-600 outline-none focus:border-[#003CDC]"
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

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 px-6 py-4">
          <div className="text-[12px] text-slate-400">
            {checkedCount} / {items.length} 항목 검토 완료
          </div>
          <div className="flex items-center gap-2">
            {errorMessage && <span className="text-[11px] font-bold text-red-600">{errorMessage}</span>}
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-slate-200 px-4 py-2 text-[13px] font-semibold text-slate-600 hover:bg-slate-50"
            >
              나중에 검토
            </button>
            <button
              type="button"
              onClick={() => {
                for (const entry of items) {
                  if (!entry.checked) onChange(entry.id, { checked: true });
                }
              }}
              disabled={allChecked || items.length === 0}
              className={`flex items-center gap-1.5 rounded-md border px-4 py-2 text-[13px] font-bold transition ${
                allChecked || items.length === 0
                  ? "cursor-not-allowed border-slate-200 bg-slate-50 text-slate-300"
                  : "border-blue-200 bg-blue-50 text-[#003CDC] hover:border-[#003CDC] hover:bg-blue-100"
              }`}
            >
              <CheckCheck size={15} />
              모두 검토
            </button>
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
    </div>
  );
}
