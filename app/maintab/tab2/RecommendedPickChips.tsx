"use client";

import { Loader2 } from "lucide-react";
import type { WeeklyPickLite, AiPickLite } from "./useRecommendedPicks";

interface Props {
  weeklyPicks: WeeklyPickLite[];
  aiPicks: AiPickLite[];
  selectedKey: string; // 현재 선택된 종목의 티커(자사 추천은 매칭 전까지 하이라이트 불가 — 그래도 무방)
  resolvingWeeklyName: string | null;
  onSelectWeekly: (pick: WeeklyPickLite) => void;
  onSelectAi: (pick: AiPickLite) => void;
  // 위에 "보유 종목" 줄이 같이 있을 때만 구분선을 그린다 — 이 칩 목록이 박스의 첫 줄(보유 종목 없음)이면
  // 구분선이 위에 아무것도 없이 붕 떠 보이므로 생략한다.
  withDivider?: boolean;
}

// "라벨(고정폭) + 칩 목록" 한 줄을 자사/AI 각각 독립적으로 그리는 행 — 라벨 폭을 고정해서 두 줄의
// 칩 시작 위치를 맞춘다("자사"/"AI" 글자 길이가 달라 폭을 안 맞추면 칩 시작점이 어긋나 보인다).
function PickRow({
  label, labelColorClass, children,
}: { label: string; labelColorClass: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className={`w-9 shrink-0 text-[10px] font-black uppercase tracking-wide ${labelColorClass}`}>{label}</span>
      {children}
    </div>
  );
}

// 보유 종목 칩 바로 아래, 별도 박스 없이 이어 붙이는 "추천 종목" 칩 목록 — 자사/AI를 서로 다른 줄로
// 나누고, 라벨 폭을 고정해 두 줄의 칩 시작 위치를 맞춘다(2026-09 리디자인 2차: 한 줄에 섞여 있으면
// 줄바꿈될 때 자사·AI 칩이 뒤섞여 보이고 시작 위치도 안 맞는다는 피드백 반영). 데이터 조회는
// 호출부(useRecommendedPicks)에서 하고, 이 컴포넌트는 렌더링만 담당한다.
export default function RecommendedPickChips({ weeklyPicks, aiPicks, selectedKey, resolvingWeeklyName, onSelectWeekly, onSelectAi, withDivider = true }: Props) {
  if (weeklyPicks.length === 0 && aiPicks.length === 0) return null;

  return (
    <div className={`space-y-1.5 ${withDivider ? "border-t border-slate-100 pt-2.5" : ""}`}>
      {weeklyPicks.length > 0 && (
        <PickRow label="자사" labelColorClass="text-violet-500">
          {weeklyPicks.map((p) => (
            <button
              key={`weekly-${p.name}`}
              type="button"
              onClick={() => onSelectWeekly(p)}
              disabled={resolvingWeeklyName === p.name}
              className="inline-flex items-center gap-1 rounded-full border border-violet-200 bg-violet-50 px-2.5 py-1 text-[12px] font-semibold text-violet-700 transition hover:bg-violet-100 disabled:opacity-50"
            >
              {resolvingWeeklyName === p.name ? <Loader2 size={10} className="animate-spin" /> : null}
              {p.name}
            </button>
          ))}
        </PickRow>
      )}
      {aiPicks.length > 0 && (
        <PickRow label="AI" labelColorClass="text-blue-500">
          {aiPicks.map((p) => (
            <button
              key={`ai-${p.symbol}`}
              type="button"
              onClick={() => onSelectAi(p)}
              className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[12px] font-semibold transition ${
                selectedKey === p.symbol
                  ? "border-[#2f2f9d] bg-[#2f2f9d] text-white"
                  : "border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100"
              }`}
            >
              {p.name}
            </button>
          ))}
        </PickRow>
      )}
    </div>
  );
}
