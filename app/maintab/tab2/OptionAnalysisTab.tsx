"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  Tooltip,
  Legend,
  Filler,
  type ChartOptions,
  type ChartDataset,
} from "chart.js";
import { Bar, Line } from "react-chartjs-2";
import { AlertTriangle, BarChart2, Loader2, RefreshCw } from "lucide-react";
import type {
  OptionsChainResponse,
  BucketData,
  Anomaly,
} from "../../../utils/optionIndicators";
import { usePortfolioResult } from "../PortfolioResultComponents";
import type { PortfolioAsset } from "../CustomerContext";

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, BarElement, Tooltip, Legend, Filler);

// ── 포맷 헬퍼 ────────────────────────────────────────────────────────

function fmtN(n: number | null | undefined): string {
  if (n == null) return "-";
  const a = Math.abs(n);
  if (a >= 1e6) return (n / 1e6).toFixed(1) + "M";
  if (a >= 1e3) return (n / 1e3).toFixed(1) + "K";
  return Math.round(n).toLocaleString();
}

const GC = "rgba(0,0,0,0.05)";

function baseOpts(yFmt?: (v: number | string) => string): ChartOptions<"line"> {
  return {
    responsive: true,
    maintainAspectRatio: false,
    animation: false,
    plugins: {
      legend: { display: true, labels: { font: { size: 11 }, color: "#888", boxWidth: 12 } },
      tooltip: { mode: "index" as const, intersect: false },
    },
    scales: {
      x: { ticks: { maxTicksLimit: 8, color: "#888", font: { size: 11 } }, grid: { color: GC } },
      y: {
        ticks: {
          color: "#888", font: { size: 11 },
          ...(yFmt ? { callback: yFmt as (v: number | string) => string } : {}),
        },
        grid: { color: GC },
      },
    },
  };
}

// ── 요약 박스 ────────────────────────────────────────────────────────

interface SumRow { type: "good" | "bad" | "neut" | "info"; text: string }

function SummaryBox({
  title, icon, badge, badgeColor, bgColor, borderColor, rows,
}: {
  title: string; icon: string; badge: string; badgeColor: string;
  bgColor: string; borderColor: string; rows: SumRow[];
}) {
  return (
    <div className="mb-5 rounded-lg border p-4" style={{ borderColor, background: bgColor }}>
      <div className="mb-3 flex items-center gap-2">
        <span className="text-lg">{icon}</span>
        <span className="text-[13px] font-bold text-slate-800">{title}</span>
        <span className="ml-auto rounded-full px-3 py-0.5 text-[11px] font-bold text-white" style={{ background: badgeColor }}>
          {badge}
        </span>
      </div>
      <div className="space-y-1.5 text-[13px] text-slate-700 leading-relaxed">
        {rows.map((r, i) => (
          <div key={i} className="flex gap-2 items-start">
            <div
              className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full"
              style={{ background: r.type === "good" ? "#16a34a" : r.type === "bad" ? "#dc2626" : r.type === "info" ? "#3b82f6" : "#f59e0b" }}
            />
            <div dangerouslySetInnerHTML={{ __html: r.text }} />
          </div>
        ))}
      </div>
    </div>
  );
}

// ── 종합 요약 탭 ─────────────────────────────────────────────────────

function SummaryTab({ d }: { d: OptionsChainResponse }) {
  const { score, scoreLabel, scoreColor, pcOI, pcVol, target, anomalies, hv20, term, earnings } = d;
  const pos = ((score + 100) / 200) * 100;

  const rows: SumRow[] = [];
  if (score >= 20) rows.push({ type: "good", text: `옵션 시장이 전반적으로 <b>콜(상승 베팅) 우세</b>입니다. Put/Call 비율이 1보다 낮아 강세 심리가 반영돼 있습니다.` });
  else if (score <= -20) rows.push({ type: "bad", text: `옵션 시장이 전반적으로 <b>풋(하락 베팅·헤지) 우세</b>입니다. Put/Call 비율이 1보다 높습니다.` });
  else rows.push({ type: "neut", text: "콜과 풋 포지션이 <b>균형</b>을 이루고 있어, 옵션 시장의 방향성 베팅이 뚜렷하지 않은 중립 상태입니다." });

  rows.push({
    type: "info",
    text: `현재가 <b>$${d.spot}</b>은 Max Pain <b>$${target.maxPain}</b> ${d.spot > target.maxPain ? "위" : "아래"}입니다. 만기가 가까워질수록 주가가 Max Pain 방향으로 수렴하는 경향이 있습니다.`,
  });

  if (target.callWall && target.putWall) {
    rows.push({
      type: "info",
      text: `콜 벽(저항) <b>$${target.callWall}</b> · 풋 벽(지지) <b>$${target.putWall}</b> — 두 레벨이 단기 지지·저항으로 작용할 수 있습니다.`,
    });
  }

  const ivhv = target.atmIV && hv20 ? target.atmIV / hv20 : null;
  if (ivhv) {
    if (ivhv >= 1.3) rows.push({ type: "bad", text: `내재변동성(IV ${target.atmIV?.toFixed(0)}%)이 실현변동성(HV ${hv20}%)의 <b>${ivhv.toFixed(2)}배</b>입니다. 옵션이 비싸게 거래 중이며 임박한 이벤트 가능성을 확인하세요.` });
    else if (ivhv <= 0.9) rows.push({ type: "good", text: `IV(${target.atmIV?.toFixed(0)}%)가 HV(${hv20}%)보다 낮아 옵션이 <b>상대적으로 저렴</b>합니다. 변동성 매수 전략에 유리한 환경입니다.` });
  }

  if (term.length >= 2) {
    const n = term[0].iv, f = term[term.length - 1].iv;
    if (n && f && n / f >= 1.2) rows.push({ type: "bad", text: `근월 IV(${n.toFixed(0)}%)가 원월(${f.toFixed(0)}%)보다 높은 <b>백워데이션</b> 구조 — 단기 이벤트 기대가 큰 상태입니다.` });
  }

  if (anomalies.length) rows.push({ type: "bad", text: `<b>특이사항 ${anomalies.length}건</b> 감지 — 하단 '특이사항' 탭에서 확인하세요.` });
  if (earnings) rows.push({ type: "neut", text: `실적 발표 예정: <b>${earnings.date}</b> (D-${earnings.dte})` });

  const badge = score >= 20 ? "콜 우세 강세" : score <= -20 ? "풋 우세 약세" : "중립";

  return (
    <div>
      {/* 특이사항 배너 */}
      {anomalies.filter(a => a.severity === "high").length > 0 && (
        <div className="mb-4 flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 p-3.5">
          <AlertTriangle size={18} className="mt-0.5 shrink-0 text-red-600" />
          <div className="text-[13px] text-red-700">
            <b>특이사항 {anomalies.filter(a => a.severity === "high").length}건 감지</b> — 하단 '특이사항' 탭에서 상세 확인하세요.
          </div>
        </div>
      )}

      {/* 히어로 */}
      <div className="mb-5 rounded-xl border border-slate-200 bg-white p-6 text-center shadow-sm">
        <div className="text-[56px] font-extrabold leading-none" style={{ color: scoreColor }}>
          {score > 0 ? "+" : ""}{score}
        </div>
        <div className="mt-1 text-[13px] text-slate-400">/ ±100 (옵션 심리 점수)</div>
        <div className="relative mx-auto mt-4 h-3 max-w-xs overflow-hidden rounded-full" style={{ background: "linear-gradient(90deg,#dc2626,#f59e0b,#e2e8f0,#84cc16,#16a34a)" }}>
          <div className="absolute top-[-2px] h-7 w-1 -translate-x-1/2 rounded bg-slate-800" style={{ left: `${pos}%` }} />
        </div>
        <div className="mt-1 flex justify-between text-[10px] text-slate-400 max-w-xs mx-auto">
          <span>풋 우세(약세)</span><span>중립</span><span>콜 우세(강세)</span>
        </div>
        <div className="mt-3 text-[17px] font-bold" style={{ color: scoreColor }}>{scoreLabel}</div>
      </div>

      {/* 키 카드 */}
      <div className="mb-5 grid grid-cols-3 gap-2 sm:grid-cols-6">
        {[
          { label: "P/C 비율(OI)", val: pcOI ?? "-", sub: pcOI !== null && pcOI < 1 ? "콜 우세" : "풋 우세", color: pcOI !== null && pcOI < 1 ? "text-green-600" : "text-red-600" },
          { label: "P/C 비율(거래량)", val: pcVol ?? "-", sub: pcVol !== null && pcVol < 1 ? "콜 우세" : "풋 우세", color: pcVol !== null && pcVol < 1 ? "text-green-600" : "text-red-600" },
          { label: "Max Pain", val: `$${target.maxPain}`, sub: `${target.exp} 만기`, color: "text-slate-800" },
          { label: "콜 벽(저항)", val: target.callWall ? `$${target.callWall}` : "N/A", sub: "콜 OI 최대", color: "text-green-700" },
          { label: "풋 벽(지지)", val: target.putWall ? `$${target.putWall}` : "N/A", sub: "풋 OI 최대", color: "text-red-700" },
          { label: "ATM IV", val: target.atmIV ? `${target.atmIV.toFixed(0)}%` : "N/A", sub: `HV ${d.hv20}%`, color: "text-slate-800" },
        ].map((card) => (
          <div key={card.label} className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
            <div className="text-[10px] text-slate-500 leading-tight">{card.label}</div>
            <div className={`mt-1 text-[16px] font-bold ${card.color}`}>{card.val}</div>
            <div className="text-[10px] text-slate-400">{card.sub}</div>
          </div>
        ))}
      </div>

      <SummaryBox
        title="옵션 심리 핵심 요약" icon="🧭" badge={badge}
        badgeColor={score >= 20 ? "#16a34a" : score <= -20 ? "#dc2626" : "#64748b"}
        bgColor={score >= 20 ? "#f0fdf4" : score <= -20 ? "#fef2f2" : "#f8fafc"}
        borderColor={score >= 20 ? "#86efac" : score <= -20 ? "#fecaca" : "#e2e8f0"}
        rows={rows}
      />

      <div className="rounded-r-md border-l-4 border-amber-300 bg-amber-50 px-3 py-2 text-[12px] text-amber-700">
        💡 P/C 비율은 포지션 분포만 봅니다. 풋이 많다고 무조건 약세가 아닙니다 — 주식 보유자의 <b>하락 보험(헤지)</b>일 수도 있습니다. '종합 해석'은 뉴스·시장 맥락과 함께 판단하세요.
      </div>
    </div>
  );
}

// ── 기간별 분포 탭 ───────────────────────────────────────────────────

function DistTab({ d }: { d: OptionsChainResponse }) {
  const maxB = d.buckets.reduce((a, b) => (b.cOI + b.pOI > a.cOI + a.pOI ? b : a), d.buckets[0]);
  const rows: SumRow[] = [];
  if (maxB) rows.push({ type: "info", text: `현재 옵션 포지션은 <b>${maxB.name}</b> 구간에 가장 많이 집중돼 있습니다. 이 구간이 시장 참여자들이 가장 주목하는 시간대입니다.` });

  const b0 = d.buckets[0];
  if (b0 && b0.cOI + b0.pOI > 0) {
    rows.push({ type: "neut", text: `<b>0~7일(위클리)</b> P/C ${b0.pcOI ?? "-"} — 이번 주 만기의 단기 방향성 베팅 구간입니다. 감마 효과로 만기에 민감하게 반응합니다.` });
  }

  const leaps = d.buckets[d.buckets.length - 1];
  if (leaps && leaps.cOI + leaps.pOI > 0) {
    rows.push({ type: leaps.pcOI !== null && leaps.pcOI < 0.8 ? "good" : "neut", text: `<b>365일+(LEAPS)</b> P/C ${leaps.pcOI ?? "-"} — 장기 전망을 가진 기관·스마트머니의 베팅이 담긴 구간입니다.` });
  }

  return (
    <div>
      <SummaryBox
        title="기간별 분포 해석" icon="📊" badge={`${d.nExp}개 만기`}
        badgeColor="#3b82f6" bgColor="#f0f9ff" borderColor="#bae6fd"
        rows={rows}
      />

      <div className="mb-1 text-[13px] font-semibold text-slate-700">만기 구간별 미결제약정(OI) 분포 — 콜 vs 풋</div>
      <div style={{ height: 280, position: "relative" }} className="mb-5">
        <Bar
          data={{
            labels: d.buckets.map((b) => b.name),
            datasets: [
              { label: "콜 OI", data: d.buckets.map((b) => b.cOI), backgroundColor: "#16a34a" },
              { label: "풋 OI", data: d.buckets.map((b) => b.pOI), backgroundColor: "#dc2626" },
            ],
          }}
          options={{
            responsive: true, maintainAspectRatio: false, animation: false,
            plugins: {
              legend: { position: "top", labels: { font: { size: 11 }, boxWidth: 12 } },
              tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${fmtN(c.raw as number)}` } },
            },
            scales: {
              x: { ticks: { color: "#888", font: { size: 11 } }, grid: { color: GC } },
              y: { ticks: { color: "#888", font: { size: 11 }, callback: (v) => fmtN(Number(v)) }, grid: { color: GC } },
            },
          } as ChartOptions<"bar">}
        />
      </div>

      {/* 상세 테이블 */}
      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
        <table className="w-full border-collapse text-[12px]">
          <thead>
            <tr className="bg-slate-50 text-slate-500">
              {["구간", "콜 OI", "풋 OI", "P/C(OI)", "콜 거래량", "풋 거래량", "P/C(거래량)"].map((h) => (
                <th key={h} className="px-3 py-2 text-right font-medium first:text-left">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {d.buckets.map((b, i) => (
              <tr key={i} className="border-t border-slate-100">
                <td className="px-3 py-2 font-semibold">{b.name}</td>
                <td className="px-3 py-2 text-right text-green-700">{fmtN(b.cOI)}</td>
                <td className="px-3 py-2 text-right text-red-700">{fmtN(b.pOI)}</td>
                <td className="px-3 py-2 text-right font-semibold">{b.pcOI ?? "-"}</td>
                <td className="px-3 py-2 text-right text-slate-500">{fmtN(b.cVol)}</td>
                <td className="px-3 py-2 text-right text-slate-500">{fmtN(b.pVol)}</td>
                <td className="px-3 py-2 text-right text-slate-500">{b.pcVol ?? "-"}</td>
              </tr>
            ))}
            <tr className="border-t-2 border-slate-200 bg-slate-50 font-bold text-[12px]">
              <td className="px-3 py-2">전체</td>
              <td className="px-3 py-2 text-right text-green-700">{fmtN(d.totCOI)}</td>
              <td className="px-3 py-2 text-right text-red-700">{fmtN(d.totPOI)}</td>
              <td className="px-3 py-2 text-right">{d.pcOI ?? "-"}</td>
              <td className="px-3 py-2 text-right text-slate-500">{fmtN(d.totCVol)}</td>
              <td className="px-3 py-2 text-right text-slate-500">{fmtN(d.totPVol)}</td>
              <td className="px-3 py-2 text-right text-slate-500">{d.pcVol ?? "-"}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── 매수/매도 압력 탭 ────────────────────────────────────────────────

function PressureTab({ d }: { d: OptionsChainResponse }) {
  const { pcOI, totCOI, totPOI, target, spot } = d;
  const cpPct = totCOI + totPOI > 0 ? (totCOI / (totCOI + totPOI)) * 100 : 50;
  const ppPct = 100 - cpPct;

  const rows: SumRow[] = [];
  rows.push({
    type: pcOI !== null && pcOI < 1 ? "good" : "bad",
    text: `전체 미결제약정 기준 P/C <b>${pcOI}</b> — ${pcOI !== null && pcOI < 0.7 ? "콜이 압도적으로 우세(강한 강세 베팅)" : pcOI !== null && pcOI < 1 ? "콜이 우세(강세 경향)" : pcOI !== null && pcOI < 1.3 ? "풋이 다소 우세(헤지 또는 약세)" : "풋이 크게 우세(강한 약세 베팅 또는 헤지)"}합니다.`,
  });
  rows.push({ type: "info", text: `<b>콜 벽 $${target.callWall}</b>: 콜 OI 최대 행사가 — 단기 상단 저항선으로 작용 가능. 시장조성자가 이 수준 이탈을 막으려 헤지할 수 있습니다.` });
  rows.push({ type: "info", text: `<b>풋 벽 $${target.putWall}</b>: 풋 OI 최대 행사가 — 단기 하단 지지선으로 작용 가능.` });

  return (
    <div>
      <SummaryBox
        title="매수/매도 압력 해석" icon="⚔️" badge={`P/C ${pcOI}`}
        badgeColor={pcOI !== null && pcOI < 1 ? "#16a34a" : "#dc2626"}
        bgColor={pcOI !== null && pcOI < 1 ? "#f0fdf4" : "#fef2f2"}
        borderColor={pcOI !== null && pcOI < 1 ? "#86efac" : "#fecaca"}
        rows={rows}
      />

      {/* P/C 게이지 바 */}
      <div className="mb-5 rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <div className="mb-2 flex justify-between text-[12px] font-semibold">
          <span className="text-green-700">콜 OI {fmtN(totCOI)}</span>
          <span className="text-red-700">풋 OI {fmtN(totPOI)}</span>
        </div>
        <div className="flex h-7 overflow-hidden rounded-lg text-[11px] font-bold text-white">
          <div className="flex items-center justify-center bg-green-600" style={{ width: `${cpPct}%` }}>
            {cpPct > 15 ? `${Math.round(cpPct)}%` : ""}
          </div>
          <div className="flex items-center justify-center bg-red-600" style={{ width: `${ppPct}%` }}>
            {ppPct > 15 ? `${Math.round(ppPct)}%` : ""}
          </div>
        </div>
      </div>

      <div className="mb-1 text-[13px] font-semibold text-slate-700">
        행사가별 OI 벽 — {target.exp} 만기
      </div>
      <div className="mb-1 text-[11px] text-slate-400">← 풋 OI (지지 압력)   |   콜 OI (저항 압력) →</div>
      <div style={{ height: 360, position: "relative" }} className="mb-5">
        <Bar
          data={{
            labels: d.walls.strikes.map((s) => `$${s}`),
            datasets: [
              { label: "콜 OI", data: d.walls.callOI, backgroundColor: "rgba(22,163,74,0.75)" },
              { label: "풋 OI", data: d.walls.putOI.map((v) => -v), backgroundColor: "rgba(220,38,38,0.75)" },
            ],
          }}
          options={{
            indexAxis: "y",
            responsive: true, maintainAspectRatio: false, animation: false,
            plugins: {
              legend: { position: "top", labels: { font: { size: 11 }, boxWidth: 12 } },
              tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${fmtN(Math.abs(c.raw as number))}` } },
            },
            scales: {
              x: {
                ticks: { color: "#888", font: { size: 10 }, callback: (v) => fmtN(Math.abs(Number(v))) },
                grid: { color: GC },
              },
              y: { ticks: { color: "#888", font: { size: 10 } }, grid: { color: GC }, reverse: true },
            },
          } as ChartOptions<"bar">}
        />
      </div>

      {/* 주요 레벨 카드 */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {[
          { label: "현재가", val: `$${spot}`, sub: "Spot", color: "text-slate-800" },
          { label: "Max Pain", val: `$${target.maxPain}`, sub: `${target.exp} 기준`, color: "text-slate-800" },
          { label: "콜 벽(저항)", val: target.callWall ? `$${target.callWall}` : "N/A", sub: "콜 OI 최대", color: "text-green-700" },
          { label: "풋 벽(지지)", val: target.putWall ? `$${target.putWall}` : "N/A", sub: "풋 OI 최대", color: "text-red-700" },
        ].map((card) => (
          <div key={card.label} className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
            <div className="text-[11px] text-slate-500">{card.label}</div>
            <div className={`mt-1 text-[17px] font-bold ${card.color}`}>{card.val}</div>
            <div className="text-[11px] text-slate-400">{card.sub}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── 변동성(IV) 탭 ────────────────────────────────────────────────────

function IVTab({ d }: { d: OptionsChainResponse }) {
  const { target, hv20, term, skew } = d;
  const ivhv = target.atmIV && hv20 ? target.atmIV / hv20 : null;
  const termType = term.length >= 2
    ? term[0].iv / term[term.length - 1].iv >= 1.15 ? "백워데이션" : term[term.length - 1].iv / term[0].iv >= 1.1 ? "콘탱고" : "플랫"
    : "데이터 부족";

  const rows: SumRow[] = [];
  if (term.length >= 2) {
    const n = term[0].iv, f = term[term.length - 1].iv;
    if (n / f >= 1.15) rows.push({ type: "bad", text: `근월 IV(${n.toFixed(0)}%)가 원월(${f.toFixed(0)}%)보다 높은 <b>백워데이션</b> — 임박한 이벤트나 단기 불확실성이 반영돼 있습니다.` });
    else if (f / n >= 1.1) rows.push({ type: "good", text: `<b>콘탱고(정상) 구조</b> — 원월 IV(${f.toFixed(0)}%)가 근월(${n.toFixed(0)}%)보다 높습니다. 당장의 큰 이벤트 위험이 낮은 상태입니다.` });
    else rows.push({ type: "neut", text: `IV 기간 구조가 비교적 <b>플랫</b>합니다. 특정 만기에 집중된 이벤트 기대가 두드러지지 않습니다.` });
  }
  if (ivhv) {
    if (ivhv >= 1.3) rows.push({ type: "bad", text: `IV(${target.atmIV?.toFixed(0)}%)가 HV(${hv20}%)의 <b>${ivhv.toFixed(2)}배</b> — 옵션이 비쌉니다. 옵션 매도 전략이 상대적으로 유리한 환경입니다.` });
    else if (ivhv <= 0.9) rows.push({ type: "good", text: `IV(${target.atmIV?.toFixed(0)}%)가 HV(${hv20}%)보다 낮아 옵션이 <b>상대적으로 저렴</b>합니다.` });
    else rows.push({ type: "neut", text: `IV(${target.atmIV?.toFixed(0)}%)와 HV(${hv20}%)가 비슷한 수준 — 옵션 가격이 <b>적정</b> 상태입니다.` });
  }

  return (
    <div>
      <SummaryBox
        title="변동성 분석" icon="🌡️" badge={`IV ${target.atmIV?.toFixed(0) ?? "N/A"}%`}
        badgeColor={ivhv && ivhv >= 1.3 ? "#dc2626" : ivhv && ivhv <= 0.9 ? "#16a34a" : "#64748b"}
        bgColor="#fdf4ff" borderColor="#e9d5ff" rows={rows}
      />

      <div className="mb-1 text-[13px] font-semibold text-slate-700">변동성 기간 구조 (IV Term Structure)</div>
      <div style={{ height: 220, position: "relative" }} className="mb-5">
        <Line
          data={{
            labels: term.map((t) => `D-${t.dte}`),
            datasets: [{
              label: "등가격 IV (%)", data: term.map((t) => t.iv),
              borderColor: "#7c3aed", backgroundColor: "rgba(124,58,237,0.08)",
              fill: true, tension: 0.3, pointRadius: 3,
            }] as ChartDataset<"line">[],
          }}
          options={{ ...baseOpts((v) => `${Number(v).toFixed(0)}%`) }}
        />
      </div>

      <div className="mb-1 text-[13px] font-semibold text-slate-700">
        변동성 스큐 (IV Skew) — {target.exp} 만기
      </div>
      <div style={{ height: 220, position: "relative" }} className="mb-5">
        <Line
          data={{
            labels: skew.strikes.map((s) => `$${s}`),
            datasets: [
              { label: "콜 IV", data: skew.callIV, borderColor: "#16a34a", tension: 0.2, pointRadius: 2, spanGaps: true },
              { label: "풋 IV", data: skew.putIV, borderColor: "#dc2626", tension: 0.2, pointRadius: 2, spanGaps: true },
            ] as ChartDataset<"line">[],
          }}
          options={{ ...baseOpts((v) => `${Number(v).toFixed(0)}%`) }}
        />
      </div>

      {/* IV 카드 */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {[
          { label: "근월 ATM IV", val: target.atmIV ? `${target.atmIV.toFixed(0)}%` : "N/A", sub: target.exp, color: "text-purple-700" },
          { label: "역사적변동성(HV20)", val: `${hv20}%`, sub: "20일 실현변동성", color: "text-slate-800" },
          { label: "IV / HV 비율", val: ivhv ? `${ivhv.toFixed(2)}배` : "N/A", sub: ivhv && ivhv > 1.2 ? "옵션 비쌈" : ivhv && ivhv < 0.9 ? "옵션 저렴" : "적정", color: ivhv && ivhv > 1.2 ? "text-red-600" : ivhv && ivhv < 0.9 ? "text-green-600" : "text-slate-700" },
          { label: "기간 구조", val: termType, sub: term.length >= 2 ? `근월 ${term[0].iv.toFixed(0)}% → 원월 ${term[term.length - 1].iv.toFixed(0)}%` : "-", color: termType === "백워데이션" ? "text-red-600" : "text-slate-700" },
        ].map((card) => (
          <div key={card.label} className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
            <div className="text-[11px] text-slate-500">{card.label}</div>
            <div className={`mt-1 text-[16px] font-bold ${card.color}`}>{card.val}</div>
            <div className="text-[11px] text-slate-400">{card.sub}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── 특이사항 탭 ──────────────────────────────────────────────────────

function AnomalyTab({ anomalies }: { anomalies: Anomaly[] }) {
  if (!anomalies.length) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white py-14 text-center shadow-sm">
        <div className="text-3xl mb-2">✅</div>
        <p className="text-[15px] font-semibold text-slate-700">현재 탐지된 특이사항이 없습니다</p>
        <p className="mt-1 text-[13px] text-slate-400">P/C 비율, OI 집중도, 변동성, 어닝 임박 여부가 모두 정상 범위입니다.</p>
      </div>
    );
  }

  const sevColor: Record<string, string> = { high: "#dc2626", mid: "#f59e0b", low: "#0ea5e9" };
  const sevBg: Record<string, string> = { high: "#fee2e2", mid: "#fef3c7", low: "#e0f2fe" };
  const sevLabel: Record<string, string> = { high: "중요", mid: "주의", low: "참고" };

  return (
    <div className="space-y-1">
      <div className="mb-4 rounded-r-md border-l-4 border-slate-300 bg-slate-50 px-3 py-2 text-[12px] text-slate-500">
        아래 항목은 <b>룰 기반으로 자동 탐지</b>한 이상 신호입니다. 곧바로 매매 신호가 아니며, '종합 요약' 탭의 뉴스·시장 맥락과 함께 판단하세요.
      </div>
      {anomalies.map((a, i) => (
        <div key={i} className="rounded-lg border border-slate-200 bg-white p-4" style={{ borderLeftWidth: 4, borderLeftColor: sevColor[a.severity] }}>
          <div className="mb-1.5 flex items-center gap-2">
            <span className="text-[16px]">{a.icon}</span>
            <span className="text-[13px] font-bold text-slate-800">{a.title}</span>
            <span
              className="ml-auto rounded-full px-2 py-0.5 text-[10px] font-bold"
              style={{ background: sevBg[a.severity], color: sevColor[a.severity] }}
            >
              {sevLabel[a.severity]}
            </span>
          </div>
          <p className="text-[13px] text-slate-600 leading-relaxed" dangerouslySetInnerHTML={{ __html: a.detail }} />
        </div>
      ))}
    </div>
  );
}

// ── 개념 설명 탭 ─────────────────────────────────────────────────────

function GuideTab() {
  const [open, setOpen] = useState<string | null>(null);
  const toggle = (id: string) => setOpen((p) => (p === id ? null : id));

  const sections = [
    {
      title: "📘 옵션 기초 — 콜·풋·OI·P/C",
      bg: "#eff6ff", color: "#1d4ed8",
      cards: [
        {
          id: "g-basic", tag: "기초", tagBg: "#dbeafe", tagC: "#1d4ed8",
          title: "콜옵션 · 풋옵션 · 미결제약정(OI)",
          body: "<b>콜옵션(Call)</b>은 '정해진 가격(행사가)에 <u>살 수 있는</u> 권리'입니다. 주가가 오를 거라 보면 콜을 삽니다.<br><b>풋옵션(Put)</b>은 '행사가에 <u>팔 수 있는</u> 권리'입니다. 주가가 내릴 것으로 보거나, 보유 주식의 하락을 대비(보험)할 때 풋을 삽니다.<br><br><b>미결제약정(OI, Open Interest)</b>은 아직 청산되지 않고 시장에 살아있는 계약 수입니다. OI가 많다는 건 그 행사가에 베팅이 두껍게 쌓여 있다는 뜻입니다. 전일 기준 하루 1번 갱신됩니다.<br><b>거래량(Volume)</b>은 당일 하루 동안 새로 체결된 계약 수입니다.",
          ex: "💡 OI는 '어제까지의 쌓인 잔고', 거래량은 '오늘의 새 주문'으로 이해하면 됩니다.",
        },
        {
          id: "g-pc", tag: "기초", tagBg: "#dbeafe", tagC: "#1d4ed8",
          title: "P/C 비율 (Put/Call Ratio)",
          body: "풋 ÷ 콜로 계산하는 <b>시장 심리 지표</b>입니다.<br><br>· <b>1보다 낮으면</b>: 콜(상승 베팅)이 우세 → 낙관적<br>· <b>1보다 높으면</b>: 풋(하락 베팅·헤지)이 우세 → 경계감<br><br><b>주의할 점:</b> 풋이 많다고 무조건 약세가 아닙니다. 주식 보유자가 <b>하락 보험(헤지)</b>으로 풋을 사는 경우가 많아서, P/C가 높아도 오히려 '주주들이 장기 보유 중'이라는 신호일 수 있습니다. 반드시 다른 지표와 함께 해석하세요.",
          ex: "💡 거래량 기준 P/C는 '오늘의 심리', OI 기준 P/C는 '누적된 포지션'을 보여줍니다.",
        },
      ],
    },
    {
      title: "🧱 압력 지표 — 콜벽·풋벽·Max Pain",
      bg: "#f0fdf4", color: "#16a34a",
      cards: [
        {
          id: "g-wall", tag: "압력", tagBg: "#dcfce7", tagC: "#16a34a",
          title: "콜 벽 · 풋 벽 (OI 벽)",
          body: "<b>콜 벽</b>은 콜 OI가 가장 두꺼운 행사가, <b>풋 벽</b>은 풋 OI가 가장 두꺼운 행사가입니다.<br><br>이 가격들이 단기 저항·지지로 작용하는 이유는 <b>시장조성자(MM)의 헤지</b> 때문입니다. MM은 옵션을 팔고 위험을 줄이기 위해 주식을 사고팔며 균형을 맞추는데, 이 과정에서 OI가 두꺼운 행사가 부근에서 주가 움직임이 억제되는 효과(핀 효과)가 관찰됩니다.<br><br><b>보는 법:</b> 현재가가 콜 벽에 가까우면 그 위로 돌파하기 어렵고, 풋 벽에 가까우면 그 아래로 빠지기 어렵습니다.",
          ex: "💡 절대 법칙이 아닙니다. 강한 뉴스가 나오면 벽을 손쉽게 뚫습니다.",
        },
        {
          id: "g-maxpain", tag: "압력", tagBg: "#dcfce7", tagC: "#16a34a",
          title: "Max Pain (최대 고통 가격)",
          body: "<b>만기일에 옵션 '매수자' 전체의 손실이 최대가 되는 가격</b>(= 매도자의 이익이 최대가 되는 가격)입니다.<br><br>옵션을 파는 쪽(주로 기관·MM)은 가능한 한 많은 옵션이 휴지 조각(행사 불가)이 되길 원하기 때문에, 만기가 가까워질수록 주가가 Max Pain 방향으로 끌려가는 경향('핀 효과')이 통계적으로 관찰됩니다.<br><br><b>보는 법:</b> 현재가가 Max Pain과 많이 떨어져 있을수록, 만기로 갈수록 수렴 압력이 강해질 수 있습니다.",
          ex: "💡 만기가 먼 경우엔 효과가 약하고, 만기 1~2주 이내로 좁혀질 때 참고 가치가 높아집니다.",
        },
      ],
    },
    {
      title: "🌡️ 변동성 지표 — IV·HV·기간구조·스큐",
      bg: "#fdf4ff", color: "#a21caf",
      cards: [
        {
          id: "g-iv", tag: "변동성", tagBg: "#fae8ff", tagC: "#a21caf",
          title: "IV(내재변동성) vs HV(역사적변동성)",
          body: "<b>IV(Implied Volatility)</b>는 옵션 가격을 거꾸로 풀어서 얻는 '시장이 예상하는 미래 변동성'입니다. 공포·기대가 커지면 IV가 상승합니다 — 공포지수(VIX)와 같은 원리입니다.<br><br><b>HV(Historical Volatility)</b>는 과거 실제 주가가 얼마나 움직였는지의 통계치입니다.<br><br><b>두 값을 비교하는 이유:</b><br>· <b>IV > HV</b>: 옵션이 비쌈 — 매도 전략이 상대적 유리<br>· <b>IV < HV</b>: 옵션이 저렴 — 매수 전략이 상대적 유리<br>실적 발표 직후 IV가 급락하는 현상이 'IV 크러시'입니다.",
          ex: "💡 실적 발표 전날 옵션을 사면 IV 크러시로 방향이 맞아도 손실 나는 경우가 많습니다.",
        },
        {
          id: "g-term", tag: "변동성", tagBg: "#fae8ff", tagC: "#a21caf",
          title: "변동성 기간 구조 (Term Structure)",
          body: "만기별 ATM IV를 이어 그린 곡선입니다. '언제 불확실성이 집중돼 있는지'를 보여줍니다.<br><br>· <b>콘탱고(정상)</b>: 원월 IV > 근월 IV — 당장의 이벤트 위험이 낮은 평온한 상태<br>· <b>백워데이션(역전)</b>: 근월 IV > 원월 IV — 단기에 큰 이벤트(실적·발표·소송 등)가 예상될 때<br><br>특정 만기만 IV가 도드라지면 그 시점에 이벤트가 집중돼 있다는 힌트입니다.",
          ex: "💡 실적 발표 시즌엔 발표 주를 포함한 만기의 IV가 꺼짐(낙타 등처럼) 솟아오릅니다.",
        },
        {
          id: "g-skew", tag: "변동성", tagBg: "#fae8ff", tagC: "#a21caf",
          title: "변동성 스큐 (IV Skew / Smile)",
          body: "같은 만기 내에서 행사가별 IV가 다른 현상입니다. 일반적으로 <b>하락 행사가(풋)의 IV가 더 높습니다</b>.<br><br>사람들이 급락에 대한 보험(풋)을 더 비싸게 사려 하기 때문입니다. 이 '풋 스큐'가 강해질수록 시장의 하락 공포가 크다는 신호입니다.<br><br>반대로 콜 쪽 IV가 오르는 경우('콜 스큐')는 급등 기대가 큰 이벤트성 종목에서 나타납니다.",
          ex: "💡 스큐가 평소보다 급격히 강해지면 '시장이 꼬리 위험(Tail Risk)을 크게 본다'는 신호입니다.",
        },
      ],
    },
    {
      title: "🚨 특이사항 — 자동 탐지 신호 해석",
      bg: "#fffbeb", color: "#92400e",
      cards: [
        {
          id: "g-unusual", tag: "특이사항", tagBg: "#fef3c7", tagC: "#92400e",
          title: "신규 대량 진입 (거래량 > OI×2)",
          body: "당일 거래량이 기존 미결제약정(OI)의 2배 이상이면서 500계약 이상일 때 탐지됩니다.<br><br>이는 기존 포지션의 청산·롤오버가 아닌 <b>완전히 새로운 대규모 베팅</b>이 들어왔다는 신호입니다. 특히 외가격(OTM) 옵션에서 이런 패턴이 나오면 정보 기반 매매(Informed Trading)일 수 있어 주목을 받습니다.<br><br>단, 기관의 헤지, 포트폴리오 롤오버일 수도 있으니 뉴스와 함께 확인해야 합니다.",
          ex: "💡 V=10,000 & OI=200 → 거래량이 OI의 50배. 분명 새로운 큰 포지션이 들어온 것.",
        },
        {
          id: "g-score", tag: "특이사항", tagBg: "#fef3c7", tagC: "#92400e",
          title: "옵션 심리 점수 (-100 ~ +100)",
          body: "P/C 비율(OI·거래량)을 종합한 방향성 심리 점수입니다.<br><br>공식: 0.55 × f(P/C OI) + 0.45 × f(P/C 거래량)<br><br>· +50 이상: 강한 콜 우세 🟢<br>· +20~+49: 콜 우세<br>· -19~+19: 중립 ⚪<br>· -49~-20: 풋 우세<br>· -50 이하: 강한 풋 우세 🔴<br><br><b>⚠️ 한계:</b> 풋이 헤지인지 진짜 하락 베팅인지는 구분 불가합니다. 항상 뉴스·맥락과 함께 판단하세요.",
          ex: "💡 이 점수만으로 매매하지 마세요. 방향성 심리를 보조적으로 참고하는 지표입니다.",
        },
      ],
    },
  ];

  return (
    <div className="max-w-3xl">
      {sections.map((sec) => (
        <div key={sec.title} className="mb-8">
          <div className="mb-3 flex items-center gap-2 rounded-lg px-3 py-2.5 text-[15px] font-bold" style={{ background: sec.bg, color: sec.color }}>
            {sec.title}
          </div>
          {sec.cards.map((card) => (
            <div key={card.id} className="mb-2 overflow-hidden rounded-xl border border-slate-200 bg-white">
              <button
                className="flex w-full items-center justify-between px-4 py-3.5 text-left hover:bg-slate-50"
                onClick={() => toggle(card.id)}
              >
                <div className="flex items-center gap-2 text-[14px] font-semibold text-slate-800">
                  <span className="rounded px-1.5 py-0.5 text-[11px] font-bold" style={{ background: card.tagBg, color: card.tagC }}>{card.tag}</span>
                  {card.title}
                </div>
                <span className={`text-[12px] text-slate-400 transition-transform ${open === card.id ? "rotate-180" : ""}`}>▼</span>
              </button>
              {open === card.id && (
                <div className="border-t border-slate-100 px-4 pb-4 pt-3 text-[13px] leading-relaxed text-slate-600">
                  <div dangerouslySetInnerHTML={{ __html: card.body }} />
                  {card.ex && (
                    <div className="mt-3 rounded-r-md border-l-4 border-blue-400 bg-slate-50 px-3 py-2 text-[12px] text-slate-500">
                      {card.ex}
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

// ── 메인 컴포넌트 ─────────────────────────────────────────────────────

type OptTab = "summary" | "dist" | "pressure" | "iv" | "anomaly" | "guide";

const optTabs: { id: OptTab; label: string }[] = [
  { id: "summary", label: "종합 요약" },
  { id: "dist", label: "기간별 분포" },
  { id: "pressure", label: "매수/매도 압력" },
  { id: "iv", label: "변동성(IV)" },
  { id: "anomaly", label: "특이사항" },
  { id: "guide", label: "개념 설명" },
];

export default function OptionAnalysisTab() {
  const portfolioData = usePortfolioResult();

  const tickerableAssets = useMemo<PortfolioAsset[]>(() => {
    if (!portfolioData) return [];
    return (portfolioData.enrichedAssets ?? []).filter(
      (a) => a.asset_class === "해외주식" && a.ticker && a.ticker.trim() !== "",
    );
  }, [portfolioData]);

  const [selectedTicker, setSelectedTicker] = useState("");
  const [selectedName, setSelectedName] = useState("");
  const [activeTab, setActiveTab] = useState<OptTab>("summary");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<OptionsChainResponse | null>(null);

  useEffect(() => {
    if (tickerableAssets.length > 0 && !selectedTicker) {
      setSelectedTicker(tickerableAssets[0].ticker!);
      setSelectedName(tickerableAssets[0].name);
    }
  }, [tickerableAssets, selectedTicker]);

  useEffect(() => {
    if (!selectedTicker) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setData(null);

    fetch(`/api/options-chain?ticker=${encodeURIComponent(selectedTicker)}`)
      .then((r) => {
        if (!r.ok) return r.json().then((j: { error?: string }) => { throw new Error(j.error ?? `HTTP ${r.status}`); });
        return r.json() as Promise<OptionsChainResponse>;
      })
      .then((d) => { if (!cancelled) setData(d); })
      .catch((e: Error) => { if (!cancelled) setError(e.message); })
      .finally(() => { if (!cancelled) setLoading(false); });

    return () => { cancelled = true; };
  }, [selectedTicker]);

  const selectAsset = (ticker: string, name: string) => {
    if (ticker === selectedTicker) return;
    setSelectedTicker(ticker);
    setSelectedName(name);
    setActiveTab("summary");
  };

  // 포트폴리오 없음
  if (!portfolioData) {
    return (
      <section className="rounded-xl border border-slate-200 bg-white px-6 py-10 text-center shadow-sm">
        <BarChart2 size={32} className="mx-auto mb-3 text-slate-300" />
        <p className="text-[16px] font-bold text-navy">옵션 분석</p>
        <p className="mt-2 text-sm text-slate-400">'보유 현황 및 진단' 탭에서 자산을 입력하고 분석 실행을 눌러주세요.</p>
      </section>
    );
  }

  // ticker 자산 없음
  if (tickerableAssets.length === 0) {
    return (
      <section className="rounded-xl border border-slate-200 bg-white px-6 py-10 text-center shadow-sm">
        <AlertTriangle size={32} className="mx-auto mb-3 text-amber-400" />
        <p className="text-[16px] font-bold text-slate-700">분석 가능한 종목 없음</p>
        <p className="mt-2 text-sm text-slate-400">
          자산군이 <b className="text-slate-600">해외주식</b>이고 티커가 입력된 종목만 표시됩니다.<br />
          국내주식·채권·현금·금·리츠 등은 옵션 분석 대상이 아닙니다.
        </p>
      </section>
    );
  }

  return (
    <div className="space-y-4">
      {/* 종목 선택 바 */}
      <div className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
        <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">분석 종목 선택 (미국 상장 종목만)</div>
        <div className="flex flex-wrap gap-2">
          {tickerableAssets.map((a) => (
            <button
              key={a.ticker}
              onClick={() => selectAsset(a.ticker!, a.name)}
              className={`rounded-lg border px-3.5 py-2 text-[13px] font-semibold transition ${
                selectedTicker === a.ticker
                  ? "border-[#2f2f9d] bg-[#2f2f9d] text-white shadow-sm"
                  : "border-slate-200 bg-slate-50 text-slate-600 hover:border-slate-300 hover:bg-slate-100"
              }`}
            >
              {a.name}
              <span className={`ml-1.5 text-[10px] font-normal ${selectedTicker === a.ticker ? "text-blue-200" : "text-slate-400"}`}>
                {a.ticker}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* 분석 영역 */}
      {selectedTicker && (
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          {/* 헤더 */}
          <div className="mb-4 flex items-center justify-between">
            <div>
              <div className="text-[15px] font-bold text-slate-800">{selectedName}</div>
              <div className="text-[12px] text-slate-400">
                {selectedTicker} · 미국 상장 옵션 · {data ? `${data.nExp}개 만기 집계` : "로딩 중..."}
              </div>
            </div>
            {data && (
              <div className="text-right">
                <div className="text-[22px] font-extrabold" style={{ color: data.scoreColor }}>
                  {data.score > 0 ? "+" : ""}{data.score}
                </div>
                <div className="text-[12px] font-semibold" style={{ color: data.scoreColor }}>{data.scoreLabel}</div>
              </div>
            )}
          </div>

          {/* 서브탭 바 */}
          <div className="mb-4 flex gap-1 overflow-x-auto rounded-lg border border-slate-200 bg-slate-50 p-1">
            {optTabs.map((t) => (
              <button
                key={t.id}
                onClick={() => setActiveTab(t.id)}
                className={`relative shrink-0 rounded-md px-3.5 py-1.5 text-[13px] font-semibold transition ${
                  activeTab === t.id
                    ? "bg-white text-[#2f2f9d] shadow-sm"
                    : "text-slate-500 hover:text-slate-700"
                }`}
              >
                {t.label}
                {t.id === "anomaly" && data && data.anomalies.length > 0 && (
                  <span className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-red-500" />
                )}
              </button>
            ))}
          </div>

          {/* 로딩 */}
          {loading && (
            <div className="flex items-center justify-center gap-2 py-16 text-slate-400">
              <Loader2 size={22} className="animate-spin" />
              <span className="text-[14px]">{selectedName} 옵션 데이터 수집 중... (최대 20초)</span>
            </div>
          )}

          {/* 에러 */}
          {!loading && error && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-4">
              <div className="flex items-center gap-2 text-red-700">
                <AlertTriangle size={18} />
                <span className="font-semibold">데이터 로드 실패</span>
              </div>
              <p className="mt-1 text-[13px] text-red-600">{error}</p>
              <button
                onClick={() => { const t = selectedTicker; setSelectedTicker(""); setTimeout(() => setSelectedTicker(t), 50); }}
                className="mt-3 flex items-center gap-1.5 rounded-md border border-red-300 px-3 py-1.5 text-[13px] text-red-600 hover:bg-red-100"
              >
                <RefreshCw size={14} /> 다시 시도
              </button>
            </div>
          )}

          {/* 탭 콘텐츠 */}
          {!loading && !error && data && (
            <>
              {activeTab === "summary" && <SummaryTab d={data} />}
              {activeTab === "dist" && <DistTab d={data} />}
              {activeTab === "pressure" && <PressureTab d={data} />}
              {activeTab === "iv" && <IVTab d={data} />}
              {activeTab === "anomaly" && <AnomalyTab anomalies={data.anomalies} />}
              {activeTab === "guide" && <GuideTab />}
            </>
          )}
        </div>
      )}

      {/* 면책 고지 */}
      <p className="px-1 text-[11px] text-slate-400">
        이 분석은 투자 조언이 아닙니다. 옵션 포지션 분포는 시장 참여자의 베팅을 보여줄 뿐 미래 가격을 보장하지 않습니다. 옵션 거래는 원금 전액 손실이 가능한 고위험 상품입니다.
      </p>
    </div>
  );
}
