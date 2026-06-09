"use client";

import { FolderOpen } from "lucide-react";

// ── 기존 포트폴리오 분석 탭 (추후 구현 예정) ────────────────────────────────
export default function ExistingPortfolioTab() {
  return (
    <div className="flex min-h-[480px] flex-col items-center justify-center rounded-lg border border-dashed border-slate-300 bg-slate-50">
      <div className="flex flex-col items-center gap-3 text-center px-6">
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-slate-100">
          <FolderOpen size={28} className="text-slate-400" />
        </div>
        <p className="text-base font-bold text-slate-500">기존 포트폴리오 분석</p>
        <p className="text-sm font-semibold text-slate-400">추후 구현 예정입니다.</p>
      </div>
    </div>
  );
}
