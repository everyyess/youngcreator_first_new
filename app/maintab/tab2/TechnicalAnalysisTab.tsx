"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
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
  type ChartData,
  type ChartOptions,
  type ChartDataset,
} from "chart.js";
import { Bar, Line } from "react-chartjs-2";
import { AlertTriangle, GitBranch, Loader2, RefreshCw } from "lucide-react";
import { computeTA, lv, type TAIndicators, type TAResult } from "../../../utils/taIndicators";
import type { OhlcvResponse } from "../../api/ta-ohlcv/route";
import { usePortfolioResult } from "../PortfolioResultComponents";
import type { PortfolioAsset } from "../CustomerContext";

ChartJS.register(
  CategoryScale, LinearScale, PointElement, LineElement,
  BarElement, Tooltip, Legend, Filler,
);

// ─── 색상 상수 ─────────────────────────────────────────────────────────────────

const GC = "rgba(0,0,0,0.05)";

// ─── 포맷 헬퍼 ────────────────────────────────────────────────────────────────

function fd(d: string) {
  const p = d.split("-");
  return p[0].slice(2) + "." + p[1] + "." + p[2];
}

function obvFmt(v: number | null) {
  if (v === null || v === undefined) return "N/A";
  const a = Math.abs(v);
  const s = v < 0 ? "-" : "";
  if (a >= 1e12) return s + (a / 1e12).toFixed(2) + "T";
  if (a >= 1e9) return s + (a / 1e9).toFixed(2) + "B";
  if (a >= 1e6) return s + (a / 1e6).toFixed(2) + "M";
  if (a >= 1e3) return s + (a / 1e3).toFixed(1) + "K";
  return s + a.toFixed(0);
}

// ─── 줌/팬 가능한 차트 래퍼 ──────────────────────────────────────────────────

type ZoomState = { start: number; len: number; total: number };

interface ZoomableChartProps {
  id: string;
  height?: number;
  children: (xMin: number, xMax: number) => React.ReactNode;
  totalLen: number;
  defaultLen?: number;
}

function ZoomableChart({ id, height = 280, children, totalLen, defaultLen = 126 }: ZoomableChartProps) {
  const dl = Math.min(defaultLen, totalLen);
  const [zoom, setZoom] = useState<ZoomState>({
    start: totalLen - dl,
    len: dl,
    total: totalLen,
  });
  const dragRef = useRef<{ active: boolean; startX: number; startIdx: number }>({
    active: false, startX: 0, startIdx: 0,
  });
  const containerRef = useRef<HTMLDivElement>(null);

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 0.85 : 1 / 0.85;
    const newLen = Math.max(10, Math.min(totalLen, zoom.len * factor));
    const rect = containerRef.current?.getBoundingClientRect();
    const ratio = rect ? (e.clientX - rect.left) / rect.width : 0.5;
    const center = zoom.start + zoom.len * ratio;
    let newStart = center - newLen * ratio;
    newStart = Math.max(0, Math.min(totalLen - newLen, newStart));
    setZoom({ start: newStart, len: newLen, total: totalLen });
  }, [zoom, totalLen]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    dragRef.current = { active: true, startX: e.clientX, startIdx: zoom.start };
  }, [zoom.start]);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!dragRef.current.active) return;
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const pxPerIdx = rect.width / zoom.len;
      const delta = (e.clientX - dragRef.current.startX) / pxPerIdx;
      const newStart = Math.max(0, Math.min(totalLen - zoom.len, dragRef.current.startIdx - delta));
      setZoom((prev) => ({ ...prev, start: newStart }));
    };
    const onUp = () => { dragRef.current.active = false; };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    return () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
  }, [zoom.len, totalLen]);

  const reset = () => setZoom({ start: totalLen - dl, len: dl, total: totalLen });

  const xMin = Math.max(0, Math.round(zoom.start));
  const xMax = Math.min(totalLen - 1, Math.round(zoom.start + zoom.len - 1));

  return (
    <div>
      <div className="mb-1 flex items-center justify-end gap-2">
        <span className="text-[11px] text-slate-400">마우스 휠로 확대/축소 · 드래그로 이동</span>
        <button
          onClick={reset}
          className="rounded border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] text-slate-500 hover:bg-slate-100"
        >
          초기화
        </button>
      </div>
      <div
        ref={containerRef}
        style={{ position: "relative", height }}
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
        className="cursor-grab active:cursor-grabbing select-none"
      >
        {children(xMin, xMax)}
      </div>
    </div>
  );
}

// ─── 핵심 요약 박스 ──────────────────────────────────────────────────────────

interface SumRow { type: "good" | "bad" | "neut"; text: string }

function SummaryBox({
  title, icon, badge, badgeColor, bgColor, borderColor, rows,
}: {
  title: string; icon: string; badge: string; badgeColor: string;
  bgColor: string; borderColor: string; rows: SumRow[];
}) {
  return (
    <div
      className="rounded-lg border p-4 mb-5"
      style={{ borderColor, background: bgColor }}
    >
      <div className="flex items-center gap-2 mb-3">
        <span className="text-lg">{icon}</span>
        <span className="text-[13px] font-bold text-slate-800">{title}</span>
        <span
          className="ml-auto rounded-full px-3 py-0.5 text-[11px] font-bold text-white"
          style={{ background: badgeColor }}
        >
          {badge}
        </span>
      </div>
      <div className="space-y-1.5 text-[13px] text-slate-700 leading-relaxed">
        {rows.map((r, i) => (
          <div key={i} className="flex gap-2 items-start">
            <div
              className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full"
              style={{
                background: r.type === "good" ? "#16a34a" : r.type === "bad" ? "#dc2626" : "#f59e0b",
              }}
            />
            <div dangerouslySetInnerHTML={{ __html: r.text }} />
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── 차트 공통 옵션 ───────────────────────────────────────────────────────────

function baseLineOptions(xMin: number, xMax: number, yTickCb?: (v: number | string) => string): ChartOptions<"line"> {
  return {
    responsive: true,
    maintainAspectRatio: false,
    animation: false,
    plugins: {
      legend: { display: true, labels: { font: { size: 11 }, color: "#888", boxWidth: 12 } },
      tooltip: { mode: "index", intersect: false },
    },
    scales: {
      x: {
        min: xMin, max: xMax,
        ticks: { maxTicksLimit: 8, color: "#888", font: { size: 11 } },
        grid: { color: GC },
      },
      y: {
        ticks: {
          color: "#888", font: { size: 11 },
          ...(yTickCb ? { callback: yTickCb as (v: number | string) => string } : {}),
        },
        grid: { color: GC },
      },
    },
  };
}

// ─── 분석결과 탭 ──────────────────────────────────────────────────────────────

function ConclusionTab({ result }: { result: TAResult }) {
  const { score, grade, gradeColor, gradeEmoji } = result;
  const total = score.total;
  const cats = [
    { key: "추세합계" as const, label: "추세", color: "#3b82f6", max: 35 },
    { key: "모멘텀합계" as const, label: "모멘텀", color: "#8b5cf6", max: 30 },
    { key: "변동성합계" as const, label: "변동성", color: "#f59e0b", max: 20 },
    { key: "거래량합계" as const, label: "거래량", color: "#0ea5e9", max: 15 },
  ];
  const rows = [
    { cat: "추세", key: "이동평균배열" as const, max: 10 },
    { cat: "추세", key: "골든데드크로스" as const, max: 10 },
    { cat: "추세", key: "일목균형표" as const, max: 15 },
    { cat: "모멘텀", key: "RSI" as const, max: 12 },
    { cat: "모멘텀", key: "MACD" as const, max: 12 },
    { cat: "모멘텀", key: "ROC" as const, max: 6 },
    { cat: "변동성", key: "볼린저밴드" as const, max: 10 },
    { cat: "변동성", key: "역사적변동성" as const, max: 10 },
    { cat: "거래량", key: "OBV" as const, max: 15 },
  ];
  const catTagColor: Record<string, string> = {
    추세: "#dbeafe", 모멘텀: "#ede9fe", 변동성: "#fef3c7", 거래량: "#e0f2fe",
  };
  const catTextColor: Record<string, string> = {
    추세: "#1d4ed8", 모멘텀: "#6d28d9", 변동성: "#92400e", 거래량: "#0369a1",
  };

  return (
    <div>
      {/* 히어로 */}
      <div className="mb-5 rounded-xl border border-slate-200 bg-white p-6 text-center shadow-sm">
        <div className="text-[60px] font-extrabold leading-none" style={{ color: gradeColor }}>
          {total}
        </div>
        <div className="mt-1 text-[15px] text-slate-500">/ 100점</div>
        <div className="mx-auto mt-4 h-3 max-w-xs overflow-hidden rounded-full bg-slate-100">
          <div
            className="h-full rounded-full transition-all"
            style={{ width: `${total}%`, background: gradeColor }}
          />
        </div>
        <div className="mt-2 text-[18px] font-bold" style={{ color: gradeColor }}>
          {gradeEmoji} {grade}
        </div>
      </div>

      {/* 카테고리 그리드 */}
      <div className="mb-5 grid grid-cols-4 gap-3">
        {cats.map((c) => {
          const s = score[c.key].score;
          const pct = Math.round((s / c.max) * 100);
          return (
            <div key={c.key} className="rounded-xl border border-slate-200 bg-white p-3.5 shadow-sm">
              <div className="mb-2 text-[11px] font-medium text-slate-500">{c.label}</div>
              <div className="text-[22px] font-bold" style={{ color: c.color }}>{s}</div>
              <div className="text-[13px] text-slate-400">/ {c.max}점</div>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100">
                <div className="h-full rounded-full" style={{ width: `${pct}%`, background: c.color }} />
              </div>
            </div>
          );
        })}
      </div>

      {/* 지표별 상세 테이블 */}
      <div className="text-[13px] font-semibold text-slate-700 mb-2 border-b border-slate-200 pb-1">지표별 세부 점수</div>
      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
        <table className="w-full border-collapse text-[13px]">
          <thead>
            <tr className="bg-slate-50 text-[12px] text-slate-500">
              <th className="px-3 py-2 text-left font-medium">카테고리</th>
              <th className="px-3 py-2 text-left font-medium">지표</th>
              <th className="px-3 py-2 text-left font-medium">점수</th>
              <th className="px-3 py-2 text-left font-medium">비율</th>
              <th className="px-3 py-2 text-left font-medium">설명</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const item = score[r.key];
              const pct = Math.round((item.score / item.max) * 100);
              const bc = pct >= 75 ? "#16a34a" : pct >= 50 ? "#f59e0b" : "#ef4444";
              return (
                <tr key={r.key} className="border-t border-slate-100">
                  <td className="px-3 py-2">
                    <span
                      className="rounded px-1.5 py-0.5 text-[10px] font-semibold"
                      style={{ background: catTagColor[r.cat], color: catTextColor[r.cat] }}
                    >
                      {r.cat}
                    </span>
                  </td>
                  <td className="px-3 py-2 font-semibold">{r.key}</td>
                  <td className="px-3 py-2 text-slate-500">{item.score} / {item.max}</td>
                  <td className="px-3 py-2">
                    <div className="inline-block h-1.5 w-24 overflow-hidden rounded-full bg-slate-100 align-middle">
                      <div className="h-full rounded-full" style={{ width: `${pct}%`, background: bc }} />
                    </div>
                  </td>
                  <td className="px-3 py-2 text-[12px] text-slate-500">{item.desc}</td>
                </tr>
              );
            })}
            <tr className="border-t-2 border-slate-200 bg-slate-50 font-bold">
              <td className="px-3 py-2" colSpan={2}>합계</td>
              <td className="px-3 py-2 text-slate-500">{total} / 100</td>
              <td className="px-3 py-2">
                <div className="inline-block h-1.5 w-24 overflow-hidden rounded-full bg-slate-100 align-middle">
                  <div className="h-full rounded-full" style={{ width: `${total}%`, background: gradeColor }} />
                </div>
              </td>
              <td className="px-3 py-2 text-[12px]" style={{ color: gradeColor }}>{grade}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── 추세 탭 ─────────────────────────────────────────────────────────────────

function TrendTab({ ind, score }: { ind: TAIndicators; score: TAResult["score"] }) {
  const ts = score.추세합계.score;
  const p = ind.prices[ind.prices.length - 1];
  const s20 = lv(ind.sma20);
  const s50 = lv(ind.sma50);
  const s200 = lv(ind.sma200);
  const aboveCnt = [s20, s50, s200].filter((v) => v !== null && p > (v as number)).length;

  const rows: SumRow[] = [];
  if (aboveCnt === 3) rows.push({ type: "good", text: "현재가가 단기(SMA20)·중기(SMA50)·장기(SMA200) 이동평균 모두 위에 있습니다. <b>정배열</b> — 강한 상승 추세입니다." });
  else if (aboveCnt === 2) rows.push({ type: "neut", text: "이동평균 3개 중 2개 위에 있습니다. 추세가 혼재된 구간입니다." });
  else if (aboveCnt === 1) rows.push({ type: "bad", text: "이동평균 대부분 아래에 있습니다. 하락 추세가 우세한 구간입니다." });
  else rows.push({ type: "bad", text: "현재가가 단기·중기·장기 이동평균 모두 아래 — <b>역배열</b>. 하락 추세가 뚜렷합니다." });

  const csScore = score.골든데드크로스.score;
  if (csScore === 10) rows.push({ type: "good", text: "최근 <b>골든크로스</b> 발생 (SMA20이 SMA50을 상향 돌파) — 강한 매수 신호입니다." });
  else if (csScore === 0) rows.push({ type: "bad", text: "최근 <b>데드크로스</b> 발생 (SMA20이 SMA50을 하향 돌파) — 하락 전환 신호입니다." });
  else if (csScore >= 8) rows.push({ type: "good", text: "SMA20이 SMA50 위에 위치 — 상승 추세 유효합니다." });
  else rows.push({ type: "bad", text: "SMA20이 SMA50 아래 위치 — 하락 압력이 남아있습니다." });

  const badge = ts >= 25 ? "강한 상승 추세" : ts >= 16 ? "추세 혼조" : "하락 추세 우세";
  const badgeColor = ts >= 25 ? "#16a34a" : ts >= 16 ? "#d97706" : "#dc2626";

  const labels = ind.dates.map(fd);
  const ichLabels = ind.ichDates.map(fd);

  return (
    <div>
      <SummaryBox
        title="추세 핵심 요약" icon="📈" badge={badge} badgeColor={badgeColor}
        bgColor={ts >= 25 ? "#f0fdf4" : ts >= 16 ? "#fefce8" : "#fef2f2"}
        borderColor={ts >= 25 ? "#86efac" : ts >= 16 ? "#fde68a" : "#fecaca"}
        rows={rows}
      />

      <div className="mb-1 text-[13px] font-semibold text-slate-700">이동평균선 (Moving Averages)</div>
      <ZoomableChart id="trend" totalLen={labels.length}>
        {(xMin, xMax) => (
          <Line
            data={{
              labels,
              datasets: [
                { label: "종가", data: ind.prices, borderColor: "#1e293b", borderWidth: 2.5, pointRadius: 0, tension: 0.1 },
                { label: "SMA5", data: ind.sma5, borderColor: "#f97316", borderWidth: 1.2, pointRadius: 0, tension: 0.1, borderDash: [3, 3] },
                { label: "SMA20", data: ind.sma20, borderColor: "#3b82f6", borderWidth: 1.5, pointRadius: 0, tension: 0.1, borderDash: [5, 3] },
                { label: "SMA50", data: ind.sma50, borderColor: "#a855f7", borderWidth: 1.5, pointRadius: 0, tension: 0.1, borderDash: [5, 3] },
                { label: "SMA200", data: ind.sma200, borderColor: "#ef4444", borderWidth: 1.8, pointRadius: 0, tension: 0.1, borderDash: [8, 4] },
                { label: "EMA12", data: ind.ema12, borderColor: "#22c55e", borderWidth: 1.2, pointRadius: 0, tension: 0.1, borderDash: [4, 2] },
              ] as ChartDataset<"line">[],
            }}
            options={baseLineOptions(xMin, xMax)}
          />
        )}
      </ZoomableChart>

      {/* MA 카드 */}
      <div className="my-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {([["SMA 20", s20], ["SMA 50", s50], ["SMA 200", s200], ["EMA 12", lv(ind.ema12)]] as [string, number | null][]).map(([name, val]) => {
          if (val === null) return (
            <div key={name} className="rounded-lg border border-slate-200 bg-white p-3">
              <div className="text-[11px] text-slate-500">{name}</div>
              <div className="text-[14px] font-bold text-slate-400">데이터 부족</div>
            </div>
          );
          const above = p > val;
          return (
            <div key={name} className="rounded-lg border border-slate-200 bg-white p-3">
              <div className="flex items-center gap-1.5 text-[11px] text-slate-500">
                {name}
                <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold ${above ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"}`}>
                  {above ? "위" : "아래"}
                </span>
              </div>
              <div className="mt-1 text-[17px] font-bold">{val.toFixed(2)}</div>
              <div className="text-[11px] text-slate-400">
                현재가 대비 {above ? "+" : ""}{(((p - val) / val) * 100).toFixed(2)}%
              </div>
            </div>
          );
        })}
      </div>

      <div className="mb-1 mt-6 text-[13px] font-semibold text-slate-700">일목균형표 (Ichimoku Cloud)</div>
      <ZoomableChart id="ichimoku" totalLen={ichLabels.length}>
        {(xMin, xMax) => (
          <Line
            data={{
              labels: ichLabels,
              datasets: [
                {
                  label: "선행스팬A", data: ind.ichSpanA, borderColor: "rgba(34,197,94,0.55)", borderWidth: 1,
                  pointRadius: 0, tension: 0.1, fill: { target: "+1", above: "rgba(34,197,94,0.16)", below: "rgba(239,68,68,0.16)" } as never,
                  order: 5,
                },
                { label: "선행스팬B", data: ind.ichSpanB, borderColor: "rgba(239,68,68,0.55)", borderWidth: 1, pointRadius: 0, tension: 0.1, order: 4 },
                { label: "종가", data: ind.ichPrice, borderColor: "#1e293b", borderWidth: 2.2, pointRadius: 0, tension: 0.1, order: 1 },
                { label: "전환선", data: ind.ichTenkan, borderColor: "#3b82f6", borderWidth: 1.4, pointRadius: 0, tension: 0.1, order: 2 },
                { label: "기준선", data: ind.ichKijun, borderColor: "#f97316", borderWidth: 1.4, pointRadius: 0, tension: 0.1, order: 3 },
                { label: "후행스팬", data: ind.ichChikou, borderColor: "#a855f7", borderWidth: 1.2, pointRadius: 0, tension: 0.1, borderDash: [4, 2], order: 6 },
              ] as ChartDataset<"line">[],
            }}
            options={baseLineOptions(xMin, xMax)}
          />
        )}
      </ZoomableChart>
    </div>
  );
}

// ─── 모멘텀 탭 ───────────────────────────────────────────────────────────────

function MomentumTab({ ind, score }: { ind: TAIndicators; score: TAResult["score"] }) {
  const ms = score.모멘텀합계.score;
  const rv = lv(ind.rsi);
  const mv = lv(ind.macd);
  const sv = lv(ind.signal);
  const hv2 = lv(ind.histogram);
  const rv2 = lv(ind.roc);
  const rows: SumRow[] = [];

  if (rv !== null) {
    if (rv < 30) rows.push({ type: "good", text: `RSI가 ${rv.toFixed(1)}로 <b>과매도 구간(30 이하)</b>입니다. 단기 반등 가능성이 높아진 상태입니다.` });
    else if (rv < 50) rows.push({ type: "bad", text: `RSI가 ${rv.toFixed(1)}로 <b>약세 구간(30~50)</b>입니다. 매도 인력이 우세한 상태입니다.` });
    else if (rv < 70) rows.push({ type: "good", text: `RSI가 ${rv.toFixed(1)}로 <b>적정 강세 구간(50~70)</b>입니다. 매수 인력이 우세한 건강한 상태입니다.` });
    else rows.push({ type: "neut", text: `RSI가 ${rv.toFixed(1)}로 <b>과매수 구간(70 이상)</b>입니다. 단기 조정 가능성이 있습니다.` });
  }
  if (mv !== null && sv !== null) {
    if (mv > sv && hv2 !== null && hv2 > 0) rows.push({ type: "good", text: "MACD가 Signal선 위에 있고 Histogram이 양수입니다. <b>강한 매수 신호</b>입니다." });
    else if (mv > sv) rows.push({ type: "neut", text: "MACD가 Signal선 위지만 Histogram이 줄어들고 있습니다. 모멘텀이 약화되는 중입니다." });
    else rows.push({ type: "bad", text: "MACD가 Signal선 아래입니다. 하락 모멘텀이 우세한 상태입니다." });
  }

  const badge = ms >= 22 ? "강한 상승 모멘텀" : ms >= 13 ? "모멘텀 혼조" : "하락 모멘텀 우세";
  const badgeColor = ms >= 22 ? "#16a34a" : ms >= 13 ? "#d97706" : "#dc2626";
  const labels = ind.dates.map(fd);
  const n = labels.length;
  const line30 = new Array(n).fill(30);
  const line70 = new Array(n).fill(70);

  return (
    <div>
      <SummaryBox
        title="모멘텀 핵심 요약" icon="⚡" badge={badge} badgeColor={badgeColor}
        bgColor={ms >= 22 ? "#f0fdf4" : ms >= 13 ? "#fefce8" : "#fef2f2"}
        borderColor={ms >= 22 ? "#86efac" : ms >= 13 ? "#fde68a" : "#fecaca"}
        rows={rows}
      />

      <div className="mb-1 text-[13px] font-semibold text-slate-700">RSI (14)</div>
      <ZoomableChart id="rsi" height={200} totalLen={n}>
        {(xMin, xMax) => (
          <Line
            data={{
              labels,
              datasets: [
                { label: "RSI(14)", data: ind.rsi, borderColor: "#8b5cf6", borderWidth: 2, pointRadius: 0, tension: 0.2 },
                { label: "과매수(70)", data: line70, borderColor: "rgba(220,38,38,0.85)", borderWidth: 1.5, pointRadius: 0, borderDash: [5, 4] },
                { label: "과매도(30)", data: line30, borderColor: "rgba(220,38,38,0.85)", borderWidth: 1.5, pointRadius: 0, borderDash: [5, 4] },
              ] as ChartDataset<"line">[],
            }}
            options={{ ...baseLineOptions(xMin, xMax), scales: { ...baseLineOptions(xMin, xMax).scales, y: { min: 0, max: 100, ticks: { color: "#888", font: { size: 11 }, stepSize: 10 }, grid: { color: GC } } } }}
          />
        )}
      </ZoomableChart>

      {/* RSI 카드 */}
      {rv !== null && (
        <div className="my-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <div className="rounded-lg border border-slate-200 bg-white p-3">
            <div className="text-[11px] text-slate-500">RSI (14)</div>
            <div className={`mt-1 text-[17px] font-bold ${rv < 30 ? "text-green-600" : rv < 70 ? "text-slate-800" : "text-red-600"}`}>{rv.toFixed(1)}</div>
            <div className="text-[11px] text-slate-400">{rv < 30 ? "과매도" : rv < 50 ? "약세" : rv < 70 ? "강세" : "과매수"}</div>
          </div>
        </div>
      )}

      <div className="mb-1 mt-4 text-[13px] font-semibold text-slate-700">MACD (12/26/9)</div>
      <ZoomableChart id="macd" height={200} totalLen={n}>
        {(xMin, xMax) => (
          <Bar
            data={{
              labels,
              datasets: [
                { type: "line" as const, label: "MACD", data: ind.macd, borderColor: "#3b82f6", borderWidth: 1.5, pointRadius: 0, tension: 0.2 },
                { type: "line" as const, label: "Signal", data: ind.signal, borderColor: "#f97316", borderWidth: 1.5, pointRadius: 0, tension: 0.2 },
                {
                  type: "bar" as const, label: "Histogram", data: ind.histogram,
                  backgroundColor: (ind.histogram as (number | null)[]).map((v) =>
                    v === null ? "transparent" : v >= 0 ? "rgba(34,197,94,0.5)" : "rgba(239,68,68,0.5)"
                  ),
                  borderWidth: 0,
                },
              ],
            } as ChartData<"bar">}
            options={baseLineOptions(xMin, xMax) as ChartOptions<"bar">}
          />
        )}
      </ZoomableChart>

      <div className="mb-1 mt-4 text-[13px] font-semibold text-slate-700">ROC · Momentum (10)</div>
      <ZoomableChart id="roc" height={180} totalLen={n}>
        {(xMin, xMax) => (
          <Line
            data={{
              labels,
              datasets: [
                {
                  label: "ROC(10)", data: ind.roc, borderColor: "#14b8a6", borderWidth: 1.8, pointRadius: 0, tension: 0.2,
                  fill: true, backgroundColor: "rgba(20,184,166,0.08)",
                },
              ] as ChartDataset<"line">[],
            }}
            options={{
              ...baseLineOptions(xMin, xMax, (v) => `${Number(v).toFixed(1)}%`),
            }}
          />
        )}
      </ZoomableChart>

      {rv2 !== null && (
        <div className="my-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
          <div className="rounded-lg border border-slate-200 bg-white p-3">
            <div className="text-[11px] text-slate-500">ROC (10일)</div>
            <div className={`mt-1 text-[17px] font-bold ${rv2 >= 0 ? "text-green-600" : "text-red-600"}`}>{rv2.toFixed(2)}%</div>
            <div className="text-[11px] text-slate-400">10거래일 전 대비 변화율</div>
          </div>
          {mv !== null && sv !== null && (
            <div className="rounded-lg border border-slate-200 bg-white p-3">
              <div className="text-[11px] text-slate-500">MACD</div>
              <div className={`mt-1 text-[17px] font-bold ${mv > sv ? "text-green-600" : "text-red-600"}`}>{mv.toFixed(4)}</div>
              <div className="text-[11px] text-slate-400">Signal: {sv.toFixed(4)}</div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── 변동성 탭 ───────────────────────────────────────────────────────────────

function VolatilityTab({ ind, score }: { ind: TAIndicators; score: TAResult["score"] }) {
  const vs = score.변동성합계.score;
  const pbv = lv(ind.pctB);
  const hv = lv(ind.hvol);
  const bup = lv(ind.bbUp);
  const blo = lv(ind.bbLow);
  const last = ind.prices[ind.prices.length - 1];
  const rows: SumRow[] = [];

  if (pbv !== null) {
    if (pbv < 0) rows.push({ type: "good", text: `주가가 볼린저밴드 <b>하단 이탈</b>(%B=${pbv.toFixed(3)}). 통계적으로 드문 구간으로 단기 반등 가능성이 높습니다.` });
    else if (pbv < 0.2) rows.push({ type: "good", text: `주가가 볼린저밴드 <b>하단 근처</b>(%B=${pbv.toFixed(3)}). 매수 관심을 가져볼 수 있는 구간입니다.` });
    else if (pbv < 0.8) rows.push({ type: "neut", text: `주가가 볼린저밴드 <b>중간 구간</b>(%B=${pbv.toFixed(3)}). 과매도/과매수가 아닌 중립 상태입니다.` });
    else rows.push({ type: "bad", text: `주가가 볼린저밴드 <b>상단 근처/이탈</b>(%B=${pbv.toFixed(3)}). 단기 과매수 가능성이 있습니다.` });
  }
  if (hv !== null) {
    if (hv < 20) rows.push({ type: "good", text: `연간 역사적 변동성이 ${hv.toFixed(1)}%로 매우 낮습니다. 안정적인 투자 환경입니다.` });
    else if (hv < 35) rows.push({ type: "neut", text: `연간 역사적 변동성이 ${hv.toFixed(1)}%로 보통 수준입니다.` });
    else rows.push({ type: "bad", text: `연간 역사적 변동성이 ${hv.toFixed(1)}%로 높습니다. 포지션 크기 조절이 중요합니다.` });
  }

  const badge = vs >= 15 ? "안정적 변동성" : vs >= 10 ? "보통 변동성" : "높은 변동성 주의";
  const badgeColor = vs >= 15 ? "#16a34a" : vs >= 10 ? "#d97706" : "#dc2626";
  const labels = ind.dates.map(fd);

  return (
    <div>
      <SummaryBox
        title="변동성 핵심 요약" icon="🌊" badge={badge} badgeColor={badgeColor}
        bgColor={vs >= 15 ? "#f0fdf4" : vs >= 10 ? "#fefce8" : "#fef2f2"}
        borderColor={vs >= 15 ? "#86efac" : vs >= 10 ? "#fde68a" : "#fecaca"}
        rows={rows}
      />

      <div className="mb-1 text-[13px] font-semibold text-slate-700">볼린저밴드 (20일 +/-2σ)</div>
      <ZoomableChart id="bb" totalLen={labels.length}>
        {(xMin, xMax) => (
          <Line
            data={{
              labels,
              datasets: [
                { label: "종가", data: ind.prices, borderColor: "#1e293b", borderWidth: 2, pointRadius: 0, tension: 0.1 },
                { label: "BB 상단", data: ind.bbUp, borderColor: "rgba(239,68,68,0.6)", borderWidth: 1.2, pointRadius: 0, tension: 0.1 },
                { label: "SMA20", data: ind.bbMid, borderColor: "#eab308", borderWidth: 1.5, pointRadius: 0, tension: 0.1, borderDash: [5, 3] },
                { label: "BB 하단", data: ind.bbLow, borderColor: "rgba(59,130,246,0.6)", borderWidth: 1.2, pointRadius: 0, tension: 0.1 },
              ] as ChartDataset<"line">[],
            }}
            options={baseLineOptions(xMin, xMax)}
          />
        )}
      </ZoomableChart>

      {/* BB 카드 */}
      {pbv !== null && bup !== null && blo !== null && (
        <div className="my-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {[
            { label: "%B", val: pbv.toFixed(3), sub: "0=하단, 0.5=중간, 1=상단" },
            { label: "BB 상단", val: bup.toFixed(2), sub: "저항선" },
            { label: "BB 중심(SMA20)", val: lv(ind.bbMid)?.toFixed(2) ?? "N/A", sub: "20일 평균" },
            { label: "BB 하단", val: blo.toFixed(2), sub: "지지선" },
          ].map((item) => (
            <div key={item.label} className="rounded-lg border border-slate-200 bg-white p-3">
              <div className="text-[11px] text-slate-500">{item.label}</div>
              <div className="mt-1 text-[17px] font-bold">{item.val}</div>
              <div className="text-[11px] text-slate-400">{item.sub}</div>
            </div>
          ))}
        </div>
      )}

      <div className="mb-1 mt-6 text-[13px] font-semibold text-slate-700">역사적 변동성 (연율화 %)</div>
      <ZoomableChart id="hvol" height={180} totalLen={labels.length}>
        {(xMin, xMax) => (
          <Line
            data={{
              labels,
              datasets: [
                {
                  label: "역사적변동성", data: ind.hvol, borderColor: "#f59e0b", borderWidth: 2, pointRadius: 0, tension: 0.3,
                  fill: true, backgroundColor: "rgba(245,158,11,0.08)",
                },
              ] as ChartDataset<"line">[],
            }}
            options={{ ...baseLineOptions(xMin, xMax, (v) => `${Number(v).toFixed(0)}%`) }}
          />
        )}
      </ZoomableChart>
      {hv !== null && (
        <div className="mt-3 inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-[13px]">
          <span className="text-slate-500">역사적 변동성</span>
          <span className={`font-bold ${hv < 20 ? "text-green-600" : hv < 35 ? "text-slate-700" : "text-red-600"}`}>{hv.toFixed(1)}%</span>
          <span className="text-slate-400">{hv < 20 ? "안정" : hv < 35 ? "보통" : hv < 55 ? "높음" : "매우 높음"}</span>
        </div>
      )}
    </div>
  );
}

// ─── 거래량 탭 ───────────────────────────────────────────────────────────────

function VolumeTab({ ind, score }: { ind: TAIndicators; score: TAResult["score"] }) {
  const os = score.거래량합계.score;
  const o = ind.obvArr[ind.obvArr.length - 1];
  const oe = lv(ind.obvEma);
  const n = ind.dates.length;
  const rows: SumRow[] = [];

  if (oe !== null) {
    if (o > oe) rows.push({ type: "good", text: "OBV가 자체 20일 이동평균 <b>위</b>에 있습니다. 매수 거래량이 우세한 상태입니다." });
    else rows.push({ type: "bad", text: "OBV가 자체 20일 이동평균 <b>아래</b>에 있습니다. 매도 거래량이 우세한 상태입니다." });
  }
  if (n > 21) {
    const slope = ind.obvArr[n - 1] - ind.obvArr[n - 21];
    if (slope > 0) rows.push({ type: "good", text: "최근 20거래일간 OBV가 <b>상승</b>했습니다. 누적 매수가 진행 중입니다." });
    else if (slope < 0) rows.push({ type: "bad", text: "최근 20거래일간 OBV가 <b>하락</b>했습니다. 누적 매도가 진행 중입니다." });
    const pchg = ind.prices[n - 1] - ind.prices[n - 21];
    const ochg = ind.obvArr[n - 1] - ind.obvArr[n - 21];
    if (pchg > 0 && ochg < 0) rows.push({ type: "bad", text: "<b>약세 다이버전스 경고:</b> 가격은 올랐지만 OBV는 하락. 상승의 거래량 뒷받침이 부족합니다." });
    else if (pchg < 0 && ochg > 0) rows.push({ type: "good", text: "<b>강세 다이버전스:</b> 가격은 내렸지만 OBV는 상승. 저점 매수세가 유입 중일 수 있습니다." });
    else rows.push({ type: "neut", text: "가격과 OBV가 같은 방향으로 움직이고 있습니다(동행). 현재 추세가 거래량으로 확인된 상태입니다." });
  }

  const badge = os >= 11 ? "거래량 매집 우세" : os >= 6 ? "거래량 중립" : "거래량 분산 우세";
  const badgeColor = os >= 11 ? "#16a34a" : os >= 6 ? "#d97706" : "#dc2626";
  const labels = ind.dates.map(fd);

  return (
    <div>
      <SummaryBox
        title="거래량 핵심 요약" icon="📦" badge={badge} badgeColor={badgeColor}
        bgColor={os >= 11 ? "#f0fdf4" : os >= 6 ? "#fefce8" : "#fef2f2"}
        borderColor={os >= 11 ? "#86efac" : os >= 6 ? "#fde68a" : "#fecaca"}
        rows={rows}
      />

      <div className="mb-1 text-[13px] font-semibold text-slate-700">OBV (On-Balance Volume)</div>
      <ZoomableChart id="obv" totalLen={labels.length}>
        {(xMin, xMax) => (
          <Line
            data={{
              labels,
              datasets: [
                { label: "OBV", data: ind.obvArr, borderColor: "#0ea5e9", borderWidth: 1.8, pointRadius: 0, tension: 0.2, fill: true, backgroundColor: "rgba(14,165,233,0.06)" },
                { label: "OBV EMA20", data: ind.obvEma, borderColor: "#f59e0b", borderWidth: 1.4, pointRadius: 0, tension: 0.2, borderDash: [5, 3] },
              ] as ChartDataset<"line">[],
            }}
            options={{ ...baseLineOptions(xMin, xMax, (v) => obvFmt(Number(v))) }}
          />
        )}
      </ZoomableChart>

      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
        {[
          { label: "OBV vs EMA20", val: obvFmt(o), sub: `EMA20: ${obvFmt(oe)}`, color: o > (oe ?? 0) ? "text-green-600" : "text-red-600" },
          { label: "20일 OBV 추세", val: n > 21 ? (ind.obvArr[n - 1] - ind.obvArr[n - 21] > 0 ? "상승" : "하락") : "N/A", sub: "20거래일 전 대비 누적", color: n > 21 && ind.obvArr[n - 1] > ind.obvArr[n - 21] ? "text-green-600" : "text-red-600" },
        ].map((item) => (
          <div key={item.label} className="rounded-lg border border-slate-200 bg-white p-3">
            <div className="text-[11px] text-slate-500">{item.label}</div>
            <div className={`mt-1 text-[17px] font-bold ${item.color}`}>{item.val}</div>
            <div className="text-[11px] text-slate-400">{item.sub}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── 지표 설명 탭 ─────────────────────────────────────────────────────────────

function GuideTab() {
  const [open, setOpen] = useState<string | null>(null);
  const toggle = (id: string) => setOpen((prev) => (prev === id ? null : id));

  const sections = [
    {
      title: "📈 추세 지표", color: "#f0f9ff", textColor: "#0369a1",
      cards: [
        { id: "sma", tag: "추세", tagBg: "#dbeafe", tagColor: "#1d4ed8", title: "SMA — 단순이동평균", body: "최근 N일간의 종가 평균을 이은 선입니다. SMA20(월봉 기준 단기), SMA50(분기), SMA200(연봉 기준 장기)로 추세 방향과 강도를 파악합니다. 현재가가 SMA 위에 있으면 해당 기간 기준 상승 추세, 아래면 하락 추세입니다.", ex: "현재가 $180, SMA200 = $178 → 1년 평균 위 → 장기 강세 신호" },
        { id: "cross", tag: "추세", tagBg: "#dbeafe", tagColor: "#1d4ed8", title: "골든크로스 & 데드크로스", body: "단기 이동평균(SMA20)이 중기 이동평균(SMA50)을 상향 돌파하면 <b>골든크로스(강한 매수 신호)</b>, 하향 돌파하면 <b>데드크로스(하락 전환 신호)</b>입니다.", ex: "2020년 4월 S&P500 골든크로스 → 이후 1년간 강세장" },
        { id: "ichimoku", tag: "추세", tagBg: "#dbeafe", tagColor: "#1d4ed8", title: "일목균형표 (Ichimoku Cloud)", body: "전환선(9일)·기준선(26일)·선행스팬A/B로 구성된 구름대가 핵심입니다. 가격이 구름 <b>위</b>면 상승 추세, <b>아래</b>면 하락 추세, 구름 <b>안</b>이면 방향 불명확입니다. 구름이 두꺼울수록 지지/저항이 강합니다.", ex: "가격이 양운(초록 구름) 위 + 전환선>기준선 → 다중 신호 상승 정렬" },
      ],
    },
    {
      title: "⚡ 모멘텀 지표", color: "#f5f3ff", textColor: "#6d28d9",
      cards: [
        { id: "rsi", tag: "모멘텀", tagBg: "#ede9fe", tagColor: "#6d28d9", title: "RSI — 상대강도지수", body: "최근 14일간 상승폭과 하락폭의 비율로 0~100 사이 값을 만들어냅니다. <b>70 이상이면 과매수</b>(조정 가능성), <b>30 이하면 과매도</b>(반등 가능성)를 나타냅니다.", ex: "RSI = 28 → 과매도 구간. 반등 기대감이 높아지는 매수 타이밍 후보" },
        { id: "macd", tag: "모멘텀", tagBg: "#ede9fe", tagColor: "#6d28d9", title: "MACD (12/26/9)", body: "EMA12 - EMA26의 차이(MACD선)와 그 9일 EMA(Signal선), 그리고 두 선의 차이(Histogram)로 구성됩니다. <b>Histogram이 양수이고 커지면</b> 상승 모멘텀 강화, 음수이고 작아지면 하락 모멘텀 강화를 의미합니다.", ex: "MACD > Signal + Histogram 양수 → 강한 매수 신호" },
        { id: "roc", tag: "모멘텀", tagBg: "#ede9fe", tagColor: "#6d28d9", title: "ROC — 변화율", body: "10거래일 전 대비 현재 가격의 변화율(%)입니다. 양수이면 10일 전보다 올랐고, 음수이면 내린 것입니다. 0선을 상향 돌파하면 단기 상승 모멘텀 발생 신호입니다.", ex: "ROC = +7.2% → 2주 전보다 7.2% 상승. 단기 강한 모멘텀" },
      ],
    },
    {
      title: "🌊 변동성 지표", color: "#fffbeb", textColor: "#92400e",
      cards: [
        { id: "bb", tag: "변동성", tagBg: "#fef3c7", tagColor: "#92400e", title: "볼린저밴드 (20일, ±2σ)", body: "SMA20 중심으로 위아래 2표준편차 거리에 밴드를 그린 것입니다. 통계적으로 약 95%의 가격이 밴드 안에서 움직입니다. %B로 현재 위치를 0~1로 표현합니다(0=하단, 0.5=중간, 1=상단). 밴드 폭이 좁아지면 곧 큰 방향성 이탈(스퀴즈)이 올 수 있다는 신호입니다.", ex: "주가가 하단선 이탈 → %B < 0 → 통계적 이상 구간, 단기 반등 기대" },
        { id: "hvol", tag: "변동성", tagBg: "#fef3c7", tagColor: "#92400e", title: "역사적 변동성 (연율화)", body: "최근 20일간 일간 로그수익률의 표준편차를 연율화한 수치입니다. 수치가 높을수록 하루에도 큰 폭의 가격 변동이 있을 수 있음을 의미합니다. <b>20% 이하는 안정적</b>, 55% 이상이면 매우 불안정한 환경입니다.", ex: "HV = 65% → 1년 기준 ±65% 범위 변동 예상. 하루 ±4% 움직임도 '정상' 범위" },
      ],
    },
    {
      title: "📦 거래량 지표", color: "#f0f9ff", textColor: "#0369a1",
      cards: [
        { id: "obv", tag: "거래량", tagBg: "#e0f2fe", tagColor: "#0369a1", title: "OBV — 누적 거래량", body: "가격이 오른 날은 거래량을 더하고 내린 날은 빼서 만든 누적 지표입니다. 절댓값보다 <b>방향(추세)</b>이 중요합니다. OBV가 20일 이평 위이면 매집 우세, 아래면 분산 우세를 나타냅니다. <b>다이버전스</b>: 가격은 오르는데 OBV가 하락하면 상승의 신뢰도가 낮다는 약세 신호입니다.", ex: "주가는 횡보인데 OBV가 꾸준히 우상향 → 조용한 매집이 진행 중, 향후 상승 가능성 암시" },
      ],
    },
  ];

  return (
    <div className="max-w-3xl">
      {sections.map((sec) => (
        <div key={sec.title} className="mb-8">
          <div
            className="mb-3 flex items-center gap-2 rounded-lg px-3 py-2.5 text-[15px] font-bold"
            style={{ background: sec.color, color: sec.textColor }}
          >
            {sec.title}
          </div>
          {sec.cards.map((card) => (
            <div key={card.id} className="mb-2 overflow-hidden rounded-xl border border-slate-200 bg-white">
              <button
                className="flex w-full items-center justify-between px-4 py-3.5 text-left hover:bg-slate-50"
                onClick={() => toggle(card.id)}
              >
                <div className="flex items-center gap-2 text-[14px] font-semibold text-slate-800">
                  <span
                    className="rounded px-1.5 py-0.5 text-[11px] font-bold"
                    style={{ background: card.tagBg, color: card.tagColor }}
                  >
                    {card.tag}
                  </span>
                  {card.title}
                </div>
                <span className={`text-[12px] text-slate-400 transition-transform ${open === card.id ? "rotate-180" : ""}`}>▼</span>
              </button>
              {open === card.id && (
                <div className="border-t border-slate-100 px-4 pb-4 pt-3 text-[13px] leading-relaxed text-slate-600">
                  <div dangerouslySetInnerHTML={{ __html: card.body }} />
                  {card.ex && (
                    <div className="mt-3 rounded-r-md border-l-4 border-blue-400 bg-slate-50 px-3 py-2 text-[12px] text-slate-500">
                      💡 {card.ex}
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

// ─── 메인 컴포넌트 ────────────────────────────────────────────────────────────

type TaTab = "conclusion" | "trend" | "momentum" | "volatility" | "volume" | "guide";

const taTabs: { id: TaTab; label: string }[] = [
  { id: "conclusion", label: "분석 결과" },
  { id: "trend", label: "추세" },
  { id: "momentum", label: "모멘텀" },
  { id: "volatility", label: "변동성" },
  { id: "volume", label: "거래량" },
  { id: "guide", label: "지표 설명" },
];

export default function TechnicalAnalysisTab() {
  const portfolioData = usePortfolioResult();

  // ticker 있는 자산만 필터링
  const tickerableAssets = useMemo<PortfolioAsset[]>(() => {
    if (!portfolioData) return [];
    return (portfolioData.enrichedAssets ?? []).filter(
      (a) => a.ticker && a.ticker.trim() !== "",
    );
  }, [portfolioData]);

  const [selectedTicker, setSelectedTicker] = useState<string>("");
  const [selectedName, setSelectedName] = useState<string>("");
  const [activeTab, setActiveTab] = useState<TaTab>("conclusion");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [taResult, setTaResult] = useState<TAResult | null>(null);

  // 자산 목록이 로드되면 첫 번째 종목 자동 선택
  useEffect(() => {
    if (tickerableAssets.length > 0 && !selectedTicker) {
      setSelectedTicker(tickerableAssets[0].ticker!);
      setSelectedName(tickerableAssets[0].name);
    }
  }, [tickerableAssets, selectedTicker]);

  // 종목 선택 시 데이터 fetch
  useEffect(() => {
    if (!selectedTicker) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setTaResult(null);

    fetch(`/api/ta-ohlcv?ticker=${encodeURIComponent(selectedTicker)}`)
      .then((r) => {
        if (!r.ok) return r.json().then((j: { error?: string }) => { throw new Error(j.error ?? `HTTP ${r.status}`); });
        return r.json() as Promise<OhlcvResponse>;
      })
      .then((data: OhlcvResponse) => {
        if (cancelled) return;
        const result = computeTA(data.dates, data.prices, data.highs, data.lows, data.volumes);
        setTaResult(result);
      })
      .catch((e: Error) => {
        if (!cancelled) setError(e.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [selectedTicker]);

  const selectAsset = (ticker: string, name: string) => {
    if (ticker === selectedTicker) return;
    setSelectedTicker(ticker);
    setSelectedName(name);
    setActiveTab("conclusion");
  };

  // 포트폴리오 데이터 없음
  if (!portfolioData) {
    return (
      <section className="rounded-xl border border-slate-200 bg-white px-6 py-10 text-center shadow-sm">
        <GitBranch size={32} className="mx-auto mb-3 text-slate-300" />
        <p className="text-[16px] font-bold text-navy">기술적 분석</p>
        <p className="mt-2 text-sm text-slate-400">
          &lsquo;보유 현황 및 진단&rsquo; 탭에서 자산을 입력하고 분석 실행을 눌러주세요.
        </p>
      </section>
    );
  }

  // ticker 가능 자산 없음
  if (tickerableAssets.length === 0) {
    return (
      <section className="rounded-xl border border-slate-200 bg-white px-6 py-10 text-center shadow-sm">
        <AlertTriangle size={32} className="mx-auto mb-3 text-amber-400" />
        <p className="text-[16px] font-bold text-slate-700">분석 가능한 종목 없음</p>
        <p className="mt-2 text-sm text-slate-400">
          보유 자산 중 기술적 분석이 가능한 주식·ETF 종목이 없습니다.
          <br />채권, 현금, 예금 등은 기술적 분석 대상이 아닙니다.
        </p>
      </section>
    );
  }

  return (
    <div className="space-y-4">
      {/* 종목 선택 바 */}
      <div className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
        <div className="mb-2 text-[11px] font-semibold text-slate-400 uppercase tracking-wide">분석 종목 선택</div>
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

      {/* 선택 종목 분석 영역 */}
      {selectedTicker && (
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          {/* 헤더 */}
          <div className="mb-4 flex items-center justify-between">
            <div>
              <div className="text-[15px] font-bold text-slate-800">{selectedName}</div>
              <div className="text-[12px] text-slate-400">{selectedTicker} · 2022.01.01 이후 일봉 기준</div>
            </div>
            {taResult && (
              <div className="text-right">
                <div className="text-[22px] font-extrabold" style={{ color: taResult.gradeColor }}>
                  {taResult.score.total}점
                </div>
                <div className="text-[12px] font-semibold" style={{ color: taResult.gradeColor }}>
                  {taResult.gradeEmoji} {taResult.grade}
                </div>
              </div>
            )}
          </div>

          {/* 서브탭 바 */}
          <div className="mb-4 flex gap-1 overflow-x-auto rounded-lg border border-slate-200 bg-slate-50 p-1">
            {taTabs.map((t) => (
              <button
                key={t.id}
                onClick={() => setActiveTab(t.id)}
                className={`shrink-0 rounded-md px-3.5 py-1.5 text-[13px] font-semibold transition ${
                  activeTab === t.id
                    ? "bg-white text-[#2f2f9d] shadow-sm"
                    : "text-slate-500 hover:text-slate-700"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          {/* 로딩 */}
          {loading && (
            <div className="flex items-center justify-center gap-2 py-16 text-slate-400">
              <Loader2 size={22} className="animate-spin" />
              <span className="text-[14px]">{selectedName} 데이터 불러오는 중...</span>
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
                onClick={() => { setError(null); setLoading(true); }}
                className="mt-3 flex items-center gap-1.5 rounded-md border border-red-300 px-3 py-1.5 text-[13px] text-red-600 hover:bg-red-100"
              >
                <RefreshCw size={14} /> 다시 시도
              </button>
            </div>
          )}

          {/* 탭 콘텐츠 */}
          {!loading && !error && taResult && (
            <>
              {activeTab === "conclusion" && <ConclusionTab result={taResult} />}
              {activeTab === "trend" && <TrendTab ind={taResult.indicators} score={taResult.score} />}
              {activeTab === "momentum" && <MomentumTab ind={taResult.indicators} score={taResult.score} />}
              {activeTab === "volatility" && <VolatilityTab ind={taResult.indicators} score={taResult.score} />}
              {activeTab === "volume" && <VolumeTab ind={taResult.indicators} score={taResult.score} />}
              {activeTab === "guide" && <GuideTab />}
            </>
          )}
        </div>
      )}

      {/* 면책 고지 */}
      <p className="px-1 text-[11px] text-slate-400">
        이 분석은 투자 조언이 아닙니다. 과거 데이터 기반이며 미래 수익을 보장하지 않습니다.
      </p>
    </div>
  );
}
