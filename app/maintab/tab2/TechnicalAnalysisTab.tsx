"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { Chart } from "react-chartjs-2";
import { AlertTriangle, Loader2, RefreshCw } from "lucide-react";
import { computeTA, computeSupportResistance, type TAIndicators, type TAResult, type SupportResistanceLevel } from "../../../utils/taIndicators";
import type { OhlcvResponse } from "../../api/ta-ohlcv/route";
import { usePortfolioResult } from "../PortfolioResultComponents";
import type { PortfolioAsset } from "../CustomerContext";
import StockSearchBox from "./StockSearchBox";

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, BarElement, Tooltip, Legend, Filler);

// ─── 봉 종류 ─────────────────────────────────────────────────────────────────

type Interval = "1d" | "1wk" | "1mo";

const INTERVAL_LABEL: Record<Interval, string> = { "1d": "일봉", "1wk": "주봉", "1mo": "월봉" };
const PERIOD_UNIT: Record<Interval, string> = { "1d": "일", "1wk": "주", "1mo": "개월" };

// ─── 지표 정의 ────────────────────────────────────────────────────────────────

type IndicatorId =
  | "sma5" | "sma20" | "sma60" | "sma120" | "bollinger" | "ichimoku" | "supportResistance"
  | "rsi" | "macd" | "roc" | "obv" | "hvol";

interface IndicatorDef {
  id: IndicatorId;
  /** 숫자 라벨이면 period, 고정 라벨이면 label */
  period?: number;
  label?: string;
  group: "overlay" | "oscillator";
  scoreKeys: string[];
  color: string;
}

const INDICATOR_DEFS: IndicatorDef[] = [
  { id: "sma5",      period: 5,   group: "overlay",    scoreKeys: ["이동평균배열"], color: "#22c55e" },
  { id: "sma20",     period: 20,  group: "overlay",    scoreKeys: ["이동평균배열"], color: "#ef4444" },
  { id: "sma60",     period: 60,  group: "overlay",    scoreKeys: ["이동평균배열", "골든데드크로스"], color: "#f59e0b" },
  { id: "sma120",    period: 120, group: "overlay",    scoreKeys: ["이동평균배열"], color: "#a855f7" },
  { id: "bollinger", label: "볼린저밴드", group: "overlay",    scoreKeys: ["볼린저밴드"],  color: "#0ea5e9" },
  { id: "ichimoku",  label: "일목균형표", group: "overlay",    scoreKeys: ["일목균형표"],  color: "#14b8a6" },
  { id: "supportResistance", label: "지지/저항선", group: "overlay", scoreKeys: [], color: "#64748b" },
  { id: "rsi",       label: "RSI",       group: "oscillator", scoreKeys: ["RSI"],         color: "#8b5cf6" },
  { id: "macd",      label: "MACD",      group: "oscillator", scoreKeys: ["MACD"],        color: "#3b82f6" },
  { id: "roc",       label: "ROC",       group: "oscillator", scoreKeys: ["ROC"],         color: "#14b8a6" },
  { id: "obv",       label: "OBV",       group: "oscillator", scoreKeys: ["OBV"],         color: "#0ea5e9" },
  { id: "hvol",      label: "변동성",     group: "oscillator", scoreKeys: ["역사적변동성"], color: "#f59e0b" },
];

function indicatorLabel(def: IndicatorDef, interval: Interval): string {
  if (def.label) return def.label;
  return `${def.period}${PERIOD_UNIT[interval]}`;
}

const SCORE_KEY_TO_INDICATORS: Record<string, IndicatorId[]> = {};
for (const def of INDICATOR_DEFS) {
  for (const key of def.scoreKeys) {
    (SCORE_KEY_TO_INDICATORS[key] ||= []).push(def.id);
  }
}

const UP = "#e5384a";
const DOWN = "#2563eb";
const GRID = "rgba(15,23,42,0.05)";
const AXIS = "#9aa5b4";

function fd(d: string) {
  const p = d.split("-");
  return `${p[0].slice(2)}.${p[1]}.${p[2]}`;
}

function won(v: number) {
  return Math.round(v).toLocaleString("ko-KR");
}

function compact(v: number) {
  const a = Math.abs(v);
  const s = v < 0 ? "-" : "";
  if (a >= 1e12) return `${s}${(a / 1e12).toFixed(1)}조`;
  if (a >= 1e8) return `${s}${(a / 1e8).toFixed(1)}억`;
  if (a >= 1e4) return `${s}${(a / 1e4).toFixed(1)}만`;
  return `${s}${Math.round(a)}`;
}

// ─── 차트 옵션 ────────────────────────────────────────────────────────────────

function chartOptions(
  xMin: number,
  xMax: number,
  o: { yFmt?: (v: number) => string; yMin?: number; yMax?: number; showX?: boolean; stepSize?: number } = {},
): ChartOptions<"bar"> {
  const fmt = o.yFmt ?? won;
  return {
    responsive: true,
    maintainAspectRatio: false,
    animation: { duration: 600, easing: "easeOutQuart" },
    interaction: { mode: "index", intersect: false },
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: "rgba(15,23,42,0.9)",
        titleFont: { size: 11, weight: "normal" },
        bodyFont: { size: 11 },
        padding: 9,
        cornerRadius: 5,
        boxWidth: 7,
        boxHeight: 7,
        filter: (item) => !["고저", "시종"].includes(item.dataset.label ?? ""),
        callbacks: {
          label: (ctx) => {
            const v = ctx.parsed.y;
            if (v === null || v === undefined) return "";
            return `  ${ctx.dataset.label}  ${fmt(v as number)}`;
          },
        },
      },
    },
    scales: {
      x: {
        min: xMin,
        max: xMax,
        display: o.showX !== false,
        ticks: { maxTicksLimit: 7, color: AXIS, font: { size: 10 }, maxRotation: 0, autoSkipPadding: 30 },
        grid: { display: false },
        border: { display: false },
      },
      y: {
        position: "right",
        min: o.yMin,
        max: o.yMax,
        ticks: { color: AXIS, font: { size: 10 }, padding: 8, stepSize: o.stepSize, callback: (v) => fmt(Number(v)) },
        grid: { color: GRID, drawTicks: false },
        border: { display: false },
      },
    },
  };
}

// ─── 지표 칩 ─────────────────────────────────────────────────────────────────

function IndicatorChips({
  active, interval, onToggle, onPreset,
}: {
  active: Set<IndicatorId>;
  interval: Interval;
  onToggle: (id: IndicatorId) => void;
  onPreset: (p: "strength" | "weakness" | "clear") => void;
}) {
  const chip = (def: IndicatorDef) => {
    const on = active.has(def.id);
    return (
      <button
        key={def.id}
        onClick={() => onToggle(def.id)}
        className={`flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-[12px] font-semibold transition-all ${
          on ? "border-slate-300 bg-slate-50 text-slate-800" : "border-slate-200 bg-white text-slate-400 hover:border-slate-300 hover:text-slate-600"
        }`}
      >
        <span className="h-[3px] w-3 shrink-0 rounded-full" style={{ background: def.color, opacity: on ? 1 : 0.3 }} />
        {indicatorLabel(def, interval)}
      </button>
    );
  };

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="mr-0.5 text-[11px] font-semibold text-slate-400">추세</span>
        {INDICATOR_DEFS.filter((d) => d.group === "overlay").map(chip)}
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="mr-0.5 text-[11px] font-semibold text-slate-400">보조</span>
        {INDICATOR_DEFS.filter((d) => d.group === "oscillator").map(chip)}
      </div>
      <div className="ml-auto flex shrink-0 items-center gap-1">
        <button onClick={() => onPreset("strength")} className="rounded-md px-2 py-1 text-[11px] font-semibold text-emerald-600 hover:bg-emerald-50">강점만</button>
        <button onClick={() => onPreset("weakness")} className="rounded-md px-2 py-1 text-[11px] font-semibold text-rose-600 hover:bg-rose-50">약점만</button>
        <button onClick={() => onPreset("clear")} className="rounded-md px-2 py-1 text-[11px] font-semibold text-slate-400 hover:bg-slate-50">전체해제</button>
      </div>
    </div>
  );
}

// ─── 차트 영역 (줌/팬 공유) ───────────────────────────────────────────────────

function ChartArea({
  ind, opens, active, interval,
}: {
  ind: TAIndicators;
  opens: number[];
  active: Set<IndicatorId>;
  interval: Interval;
}) {
  // 일목을 켜지 않으면 실제 데이터 길이(ind.dates)만 사용해 빈 공간이 없게 함.
  // 일목을 켜면 미래 26일(SHIFT) 구름대를 보여주기 위해 그때만 ichDates로 확장함.
  const useIchi = active.has("ichimoku");
  const dates = useIchi ? ind.ichDates : ind.dates;
  const labels = dates.map(fd);
  const total = labels.length;
  const shiftPad = useIchi ? ind.ichDates.length - ind.dates.length : 0;

  const padded = <T,>(arr: T[], fillValue: T): T[] =>
    shiftPad > 0 ? [...arr, ...new Array(shiftPad).fill(fillValue)] : arr;

  const closes = padded(ind.prices, null as unknown as number);

  const DEFAULT_LEN = Math.min(120, total);
  const [view, setView] = useState({ start: Math.max(0, total - DEFAULT_LEN), len: DEFAULT_LEN });
  const dragRef = useRef({ active: false, startX: 0, startIdx: 0 });
  const boxRef = useRef<HTMLDivElement>(null);

  // 데이터 길이가 바뀌면(봉 전환/종목 변경) 뷰 리셋
  useEffect(() => {
    const dl = Math.min(120, total);
    setView({ start: Math.max(0, total - dl), len: dl });
  }, [total]);

   // React의 onWheel은 passive 리스너로 등록되어 preventDefault가 무시됨.
  // 페이지 전체 스크롤과 차트 확대/축소가 동시에 발생하는 문제를 막기 위해
  // DOM에 직접 { passive: false } 리스너를 등록함.
  const viewRef = useRef(view);
  viewRef.current = view;
  const totalRef = useRef(total);
  totalRef.current = total;

  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;

    const handler = (e: WheelEvent) => {
      e.preventDefault();
      const currentView = viewRef.current;
      const currentTotal = totalRef.current;
      const factor = e.deltaY < 0 ? 0.85 : 1 / 0.85;
      const newLen = Math.max(20, Math.min(currentTotal, currentView.len * factor));
      const rect = el.getBoundingClientRect();
      const ratio = (e.clientX - rect.left) / rect.width;
      const center = currentView.start + currentView.len * ratio;
      const newStart = Math.max(0, Math.min(currentTotal - newLen, center - newLen * ratio));
      setView({ start: newStart, len: newLen });
    };

    el.addEventListener("wheel", handler, { passive: false });
    return () => el.removeEventListener("wheel", handler);
  }, []);

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    dragRef.current = { active: true, startX: e.clientX, startIdx: view.start };
  }, [view.start]);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!dragRef.current.active) return;
      const rect = boxRef.current?.getBoundingClientRect();
      if (!rect) return;
      const pxPerIdx = rect.width / view.len;
      const delta = (e.clientX - dragRef.current.startX) / pxPerIdx;
      const newStart = Math.max(0, Math.min(total - view.len, dragRef.current.startIdx - delta));
      setView((p) => ({ ...p, start: newStart }));
    };
    const onUp = () => { dragRef.current.active = false; };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    return () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
  }, [view.len, total]);

  const xMin = Math.max(0, Math.round(view.start));
  const xMax = Math.min(total - 1, Math.round(view.start + view.len - 1));

  // 보이는 구간 통계
  const vis: number[] = [];
  for (let i = xMin; i <= xMax; i++) {
    const v = (closes as (number | null)[])[i];
    if (v !== null && v !== undefined && Number.isFinite(v) && v > 0) vis.push(v);
  }
  const vHigh = vis.length ? Math.max(...vis) : 0;
  const vLow = vis.length ? Math.min(...vis) : 0;
  const last = vis.length ? vis[vis.length - 1] : 0;
  const highGap = vHigh > 0 ? ((last - vHigh) / vHigh) * 100 : 0;
  const lowGap = vLow > 0 ? ((last - vLow) / vLow) * 100 : 0;

  // 메인 데이터셋
  const datasets: ChartDataset<"bar" | "line">[] = [];

  {
    const n = ind.dates.length; // 실제 데이터 길이만큼만 캔들을 그림 (미래 26일은 자연히 빈 칸)
    const wick: ([number, number] | null)[] = [];
    const body: ([number, number] | null)[] = [];
    const colors: string[] = [];
    for (let i = 0; i < total; i++) {
      if (i >= n) { wick.push(null); body.push(null); colors.push("transparent"); continue; }
      const c = ind.prices[i];
      if (!c || c <= 0) { wick.push(null); body.push(null); colors.push("transparent"); continue; }
      const o = opens[i] && opens[i] > 0 ? opens[i] : c;
      const h = ind.highs[i] > 0 ? ind.highs[i] : Math.max(o, c);
      const l = ind.lows[i] > 0 ? ind.lows[i] : Math.min(o, c);
      wick.push([l, h]);
      body.push([Math.min(o, c), Math.max(o, c)]);
      colors.push(c >= o ? UP : DOWN);
    }
    datasets.push(
      { type: "bar", label: "고저", data: wick as never, backgroundColor: colors, barPercentage: 0.1, categoryPercentage: 1, order: 6 } as never,
      { type: "bar", label: "시종", data: body as never, backgroundColor: colors, barPercentage: 0.6, categoryPercentage: 1, order: 6 } as never,
    );
  }

  const addMa = (id: IndicatorId, data: (number | null)[], color: string) => {
    if (!active.has(id)) return;
    const def = INDICATOR_DEFS.find((d) => d.id === id)!;
    datasets.push({
      type: "line", label: indicatorLabel(def, interval), data: padded(data, null) as never,
      borderColor: color, borderWidth: 1.3, pointRadius: 0, tension: 0.1, order: 2,
    } as never);
  };

  addMa("sma5", ind.sma5, "#22c55e");
  addMa("sma20", ind.sma20, "#ef4444");
  addMa("sma60", ind.sma50, "#f59e0b");
  addMa("sma120", ind.sma200, "#a855f7");

  if (active.has("bollinger")) {
    datasets.push(
      { type: "line", label: "BB상단", data: padded(ind.bbUp, null) as never, borderColor: "rgba(14,165,233,0.5)", borderWidth: 1, pointRadius: 0, tension: 0.1, order: 4 } as never,
      { type: "line", label: "BB하단", data: padded(ind.bbLow, null) as never, borderColor: "rgba(14,165,233,0.5)", borderWidth: 1, pointRadius: 0, tension: 0.1, fill: { target: "-1", above: "rgba(14,165,233,0.055)", below: "rgba(14,165,233,0.055)" } as never, order: 4 } as never,
    );
  }

  if (useIchi) {
    datasets.push(
      { type: "line", label: "선행A", data: ind.ichSpanA as never, borderColor: "rgba(20,184,166,0.4)", borderWidth: 1, pointRadius: 0, tension: 0.3, fill: { target: "+1", above: "rgba(20,184,166,0.1)", below: "rgba(239,68,68,0.1)" } as never, order: 5 } as never,
      { type: "line", label: "선행B", data: ind.ichSpanB as never, borderColor: "rgba(239,68,68,0.4)", borderWidth: 1, pointRadius: 0, tension: 0.3, order: 5 } as never,
      { type: "line", label: "전환선", data: ind.ichTenkan as never, borderColor: "#0ea5e9", borderWidth: 1.2, pointRadius: 0, tension: 0.3, order: 2 } as never,
      { type: "line", label: "기준선", data: ind.ichKijun as never, borderColor: "#f97316", borderWidth: 1.2, pointRadius: 0, tension: 0.3, order: 2 } as never,
    );
  }
  let srLevels: SupportResistanceLevel[] = [];
  if (active.has("supportResistance")) {
    const lastClose = ind.prices[ind.prices.length - 1];
    srLevels = computeSupportResistance(ind.highs, ind.lows, lastClose);
    for (const level of srLevels) {
      const color = level.type === "resistance" ? "rgba(229,56,74,0.55)" : "rgba(37,99,235,0.55)";
      const lineData = new Array(total).fill(level.price);
      datasets.push({
        type: "line",
        label: `${level.type === "resistance" ? "저항" : "지지"} ${won(level.price)} (${level.touches}회)`,
        data: lineData as never,
        borderColor: color,
        borderWidth: level.touches >= 3 ? 2 : 1,
        pointRadius: 0,
        borderDash: level.touches >= 3 ? undefined : [4, 3],
      } as never);
    }
  }

  // 하단 오실레이터
  const oscLabels = ind.dates.map(fd);
  const oscTotal = oscLabels.length;
  const oXMin = Math.min(xMin, oscTotal - 1);
  const oXMax = Math.min(xMax, oscTotal - 1);

  const panes: { id: string; label: string; node: React.ReactNode }[] = [];

  if (active.has("rsi")) {
    panes.push({ id: "rsi", label: "RSI 14", node: (
      <Chart type="bar"
        data={{ labels: oscLabels, datasets: [
          { type: "line", label: "RSI", data: ind.rsi as never, borderColor: "#8b5cf6", borderWidth: 1.5, pointRadius: 0, tension: 0.3 },
          { type: "line", label: "70", data: new Array(oscTotal).fill(70) as never, borderColor: "rgba(148,163,184,0.4)", borderWidth: 1, pointRadius: 0, borderDash: [3, 3] },
          { type: "line", label: "30", data: new Array(oscTotal).fill(30) as never, borderColor: "rgba(148,163,184,0.4)", borderWidth: 1, pointRadius: 0, borderDash: [3, 3] },
        ] as never }}
        options={chartOptions(oXMin, oXMax, { yFmt: (v) => v.toFixed(0), yMin: 0, yMax: 100, showX: false, stepSize: 50 })}
      />
    )});
  }

  if (active.has("macd")) {
    panes.push({ id: "macd", label: "MACD 12·26·9", node: (
      <Chart type="bar"
        data={{ labels: oscLabels, datasets: [
          { type: "bar", label: "Hist", data: ind.histogram as never,
            backgroundColor: (ind.histogram as (number | null)[]).map((v) => v === null ? "transparent" : v >= 0 ? "rgba(229,56,74,0.3)" : "rgba(37,99,235,0.3)"),
            borderWidth: 0, barPercentage: 0.85, categoryPercentage: 1 },
          { type: "line", label: "MACD", data: ind.macd as never, borderColor: "#3b82f6", borderWidth: 1.3, pointRadius: 0, tension: 0.3 },
          { type: "line", label: "Signal", data: ind.signal as never, borderColor: "#f59e0b", borderWidth: 1.3, pointRadius: 0, tension: 0.3 },
        ] as never }}
        options={chartOptions(oXMin, oXMax, { yFmt: (v) => v.toFixed(0), showX: false })}
      />
    )});
  }

  if (active.has("roc")) {
    panes.push({ id: "roc", label: "ROC 10", node: (
      <Chart type="bar"
        data={{ labels: oscLabels, datasets: [
          { type: "line", label: "ROC", data: ind.roc as never, borderColor: "#14b8a6", borderWidth: 1.5, pointRadius: 0, tension: 0.3, fill: true, backgroundColor: "rgba(20,184,166,0.06)" },
        ] as never }}
        options={chartOptions(oXMin, oXMax, { yFmt: (v) => `${v.toFixed(0)}%`, showX: false })}
      />
    )});
  }

  if (active.has("obv")) {
    panes.push({ id: "obv", label: "OBV", node: (
      <Chart type="bar"
        data={{ labels: oscLabels, datasets: [
          { type: "line", label: "OBV", data: ind.obvArr as never, borderColor: "#0ea5e9", borderWidth: 1.5, pointRadius: 0, tension: 0.3, fill: true, backgroundColor: "rgba(14,165,233,0.05)" },
          { type: "line", label: "EMA20", data: ind.obvEma as never, borderColor: "#f59e0b", borderWidth: 1.1, pointRadius: 0, tension: 0.3, borderDash: [3, 3] },
        ] as never }}
        options={chartOptions(oXMin, oXMax, { yFmt: compact, showX: false })}
      />
    )});
  }

  if (active.has("hvol")) {
    panes.push({ id: "hvol", label: "역사적 변동성", node: (
      <Chart type="bar"
        data={{ labels: oscLabels, datasets: [
          { type: "line", label: "변동성", data: ind.hvol as never, borderColor: "#f59e0b", borderWidth: 1.5, pointRadius: 0, tension: 0.35, fill: true, backgroundColor: "rgba(245,158,11,0.06)" },
        ] as never }}
        options={chartOptions(oXMin, oXMax, { yFmt: (v) => `${v.toFixed(0)}%`, showX: false })}
      />
    )});
  }

  const resetView = () => {
    const dl = Math.min(120, total);
    setView({ start: Math.max(0, total - dl), len: dl });
  };

  return (
    <div>
      <div className="mb-1.5 flex items-center gap-3 px-1 text-[11px]">
        <span className="text-slate-400">
          <span style={{ color: DOWN }}>▼</span> 최고 <b className="font-semibold text-slate-600">{won(vHigh)}</b>
          <span className="ml-1">({highGap.toFixed(2)}%)</span>
        </span>
        <span className="text-slate-400">
          <span style={{ color: UP }}>▲</span> 최저 <b className="font-semibold text-slate-600">{won(vLow)}</b>
          <span className="ml-1">(+{lowGap.toFixed(2)}%)</span>
        </span>
        <button onClick={resetView} className="ml-2 rounded border border-slate-200 px-1.5 py-0.5 text-[10px] text-slate-400 hover:bg-slate-50">
          초기화
        </button>
        <span className="ml-auto rounded bg-[#2f2f9d] px-2 py-0.5 text-[11px] font-bold text-white">{won(last)}</span>
      </div>

      <div
        ref={boxRef}
        onMouseDown={onMouseDown}
        className="cursor-grab select-none active:cursor-grabbing"
        style={{ height: 400 }}
      >
        <Chart type="bar" data={{ labels, datasets: datasets as never }} options={chartOptions(xMin, xMax)} />
      </div>

      {panes.length > 0 && (
        <div className="mt-1 divide-y divide-slate-100 border-t border-slate-100">
          {panes.map((p) => (
            <div key={p.id} className="relative pt-2" style={{ height: 116 }}>
              <span className="pointer-events-none absolute left-1 top-2 z-10 text-[10px] font-semibold text-slate-400">{p.label}</span>
              {p.node}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── 게이지 ───────────────────────────────────────────────────────────────────

function ScoreGauge({ score }: { score: number }) {
  const cx = 100, cy = 100;
  const rad = (d: number) => (d * Math.PI) / 180;
  const deg = 180 - (score / 100) * 180;
  const nx = +(cx + 58 * Math.cos(rad(deg))).toFixed(2);
  const ny = +(cy - 58 * Math.sin(rad(deg))).toFixed(2);
  return (
    <svg viewBox="0 0 200 108" className="w-full max-w-[210px]" aria-hidden="true">
      <path d="M 24 100 A 76 76 0 0 1 176 100" fill="none" stroke="#eef2f7" strokeWidth="12" />
      <path d="M 24 100 A 76 76 0 0 1 62 34.2" fill="none" stroke="#ef4444" strokeWidth="12" />
      <path d="M 62 34.2 A 76 76 0 0 1 138 34.2" fill="none" stroke="#f59e0b" strokeWidth="12" />
      <path d="M 138 34.2 A 76 76 0 0 1 176 100" fill="none" stroke="#22c55e" strokeWidth="12" />
      <line x1={cx} y1={cy} x2={nx} y2={ny} stroke="#334155" strokeWidth="2.5" strokeLinecap="round" />
      <circle cx={cx} cy={cy} r="4.5" fill="#334155" />
    </svg>
  );
}

// ─── 분석 결과 ────────────────────────────────────────────────────────────────

function ResultPanel({
  result, active, onToggleKey,
}: {
  result: TAResult;
  active: Set<IndicatorId>;
  onToggleKey: (key: string) => void;
}) {
  const { score, grade, gradeColor, gradeEmoji } = result;
  const total = score.total;
  const cats = [
    { key: "추세합계" as const, label: "추세", max: 35 },
    { key: "모멘텀합계" as const, label: "모멘텀", max: 30 },
    { key: "변동성합계" as const, label: "변동성", max: 20 },
    { key: "거래량합계" as const, label: "거래량", max: 15 },
  ];
  const rows = [
    { cat: "추세", key: "이동평균배열" },
    { cat: "추세", key: "골든데드크로스" },
    { cat: "추세", key: "일목균형표" },
    { cat: "모멘텀", key: "RSI" },
    { cat: "모멘텀", key: "MACD" },
    { cat: "모멘텀", key: "ROC" },
    { cat: "변동성", key: "볼린저밴드" },
    { cat: "변동성", key: "역사적변동성" },
    { cat: "거래량", key: "OBV" },
  ] as const;

  return (
    <div>
      <div className="mb-4 flex items-center justify-center gap-8 rounded-xl border border-slate-200 bg-slate-50/50 py-6">
        <ScoreGauge score={total} />
        <div>
          <div className="text-[42px] font-extrabold leading-none" style={{ color: gradeColor }}>
            {total}<span className="ml-1 text-[13px] font-medium text-slate-400">/ 100</span>
          </div>
          <div className="mt-2 inline-flex items-center gap-1.5 rounded-full px-4 py-1.5 text-[13px] font-bold text-white" style={{ background: gradeColor }}>
            {gradeEmoji} {grade}
          </div>
        </div>
      </div>

      <div className="mb-4 grid grid-cols-4 gap-2">
        {cats.map((c) => {
          const s = score[c.key].score;
          const pct = Math.round((s / c.max) * 100);
          return (
            <div key={c.key} className="rounded-lg border border-slate-200 bg-white p-3">
              <div className="text-[11px] text-slate-400">{c.label}</div>
              <div className="mt-0.5 text-[19px] font-bold text-slate-800">
                {s}<span className="text-[11px] font-normal text-slate-400"> / {c.max}</span>
              </div>
              <div className="mt-2 h-1 overflow-hidden rounded-full bg-slate-100">
                <div className="h-full rounded-full bg-[#2f2f9d] transition-all duration-700" style={{ width: `${pct}%` }} />
              </div>
            </div>
          );
        })}
      </div>

      <div className="mb-1.5 flex items-baseline gap-2">
        <span className="text-[13px] font-semibold text-slate-700">지표별 세부 점수</span>
        <span className="text-[11px] text-slate-400">행 클릭 시 차트에서 해당 지표를 켜고 끕니다</span>
      </div>

      <div className="overflow-hidden rounded-lg border border-slate-200">
        <table className="w-full border-collapse text-[13px]">
          <thead>
            <tr className="bg-slate-50 text-[11px] text-slate-400">
              <th className="w-7 px-2 py-2" />
              <th className="px-2 py-2 text-left font-medium">구분</th>
              <th className="px-2 py-2 text-left font-medium">지표</th>
              <th className="px-2 py-2 text-left font-medium">점수</th>
              <th className="px-2 py-2 text-left font-medium">설명</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const item = score[r.key as keyof typeof score] as { score: number; max: number; desc: string };
              const pct = Math.round((item.score / item.max) * 100);
              const ids = SCORE_KEY_TO_INDICATORS[r.key] ?? [];
              const on = ids.length > 0 && ids.every((id) => active.has(id));
              const tone = pct >= 80 ? "#16a34a" : pct >= 40 ? "#64748b" : "#e11d48";
              return (
                <tr key={r.key} onClick={() => onToggleKey(r.key)}
                  className={`cursor-pointer border-t border-slate-100 transition-colors ${on ? "bg-indigo-50/50" : "bg-white hover:bg-slate-50"}`}>
                  <td className="px-2 py-2 text-center">{on && <span className="inline-block h-1.5 w-1.5 rounded-full bg-[#2f2f9d]" />}</td>
                  <td className="px-2 py-2 text-slate-400">{r.cat}</td>
                  <td className="px-2 py-2 font-semibold text-slate-700">{r.key}</td>
                  <td className="px-2 py-2">
                    <span className="font-semibold" style={{ color: tone }}>{item.score}</span>
                    <span className="text-slate-400"> / {item.max}</span>
                  </td>
                  <td className="px-2 py-2 text-[12px] text-slate-500">{item.desc}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── 메인 컴포넌트 ────────────────────────────────────────────────────────────

type SubTab = "chart" | "result";

interface TechnicalAnalysisTabProps {
  selectedStock?: { ticker: string; name: string } | null;
  onStockChange?: (stock: { ticker: string; name: string } | null) => void;
}

export default function TechnicalAnalysisTab({ selectedStock, onStockChange }: TechnicalAnalysisTabProps = {}) {
  const portfolioData = usePortfolioResult();

  const tickerableAssets = useMemo<PortfolioAsset[]>(() => {
    if (!portfolioData) return [];
    return (portfolioData.enrichedAssets ?? []).filter((a) => a.ticker && a.ticker.trim() !== "");
  }, [portfolioData]);

  const [selectedTicker, setSelectedTicker] = useState("");
  const [selectedName, setSelectedName] = useState("");
  const [subTab, setSubTab] = useState<SubTab>("chart");
  const [interval, setIntervalState] = useState<Interval>("1d");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [taResult, setTaResult] = useState<TAResult | null>(null);
  const [opens, setOpens] = useState<number[]>([]);
  const [active, setActive] = useState<Set<IndicatorId>>(new Set(["sma20", "sma60"]));
  const [fadeIn, setFadeIn] = useState(false);

  const [koreanNames, setKoreanNames] = useState<Record<string, string>>({});
  const fetchedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    for (const a of tickerableAssets) {
      if (!a.ticker || fetchedRef.current.has(a.ticker)) continue;
      fetchedRef.current.add(a.ticker);
      fetch(`/api/korean-name?ticker=${encodeURIComponent(a.ticker)}`)
        .then((r) => r.json())
        .then((d: { name?: string }) => { if (d.name && a.ticker) setKoreanNames((p) => ({ ...p, [a.ticker!]: d.name! })); })
        .catch(() => {});
    }
  }, [tickerableAssets]);

  const toggleIndicator = (id: IndicatorId) =>
    setActive((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });

  const toggleByKey = (key: string) => {
    const ids = SCORE_KEY_TO_INDICATORS[key] ?? [];
    if (!ids.length) return;
    setActive((prev) => {
      const allOn = ids.every((i) => prev.has(i));
      const n = new Set(prev);
      ids.forEach((i) => { if (allOn) n.delete(i); else n.add(i); });
      return n;
    });
    setSubTab("chart");
  };

  const applyPreset = (p: "strength" | "weakness" | "clear") => {
    if (p === "clear") { setActive(new Set()); return; }
    if (!taResult) return;
    const sc = taResult.score as unknown as Record<string, { score: number; max: number }>;
    const n = new Set<IndicatorId>();
    for (const def of INDICATOR_DEFS) {
      const ratios = def.scoreKeys.map((k) => (sc[k] ? sc[k].score / sc[k].max : 0));
      const avg = ratios.reduce((a, b) => a + b, 0) / (ratios.length || 1);
      if (p === "strength" && avg >= 0.8) n.add(def.id);
      if (p === "weakness" && avg <= 0.4) n.add(def.id);
    }
    setActive(n);
  };

    // 부모(AnalysisTabs)가 관리하는 공유 종목 상태를 최우선 반영.
  // 다른 탭(외부자료분석)에서 종목을 바꾸면 여기도 즉시 동기화됨.
  useEffect(() => {
    if (selectedStock && selectedStock.ticker !== selectedTicker) {
      setSelectedTicker(selectedStock.ticker);
      setSelectedName(selectedStock.name);
    }
  }, [selectedStock]); // eslint-disable-line react-hooks/exhaustive-deps

  // 컴포넌트 최초 마운트 시, 부모 상태가 비어있으면 스크리너에서 넘어온 값을 반영
  useEffect(() => {
    if (selectedStock) return; // 부모 상태가 이미 있으면 그걸 우선함
    const savedTicker = sessionStorage.getItem("screenerSelectedTicker");
    const savedName = sessionStorage.getItem("screenerSelectedName");
    if (savedTicker && savedName) {
      setSelectedTicker(savedTicker);
      setSelectedName(savedName);
      onStockChange?.({ ticker: savedTicker, name: savedName });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 자산 목록이 로드되면 첫 번째 종목 자동 선택 (부모 상태도 스크리너 값도 없을 때만)
  useEffect(() => {
    if (selectedStock) return;
    if (tickerableAssets.length > 0 && !selectedTicker) {
      setSelectedTicker(tickerableAssets[0].ticker!);
      setSelectedName(tickerableAssets[0].name);
    }
  }, [tickerableAssets, selectedTicker, selectedStock]);

  useEffect(() => {
    if (!selectedTicker) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setTaResult(null);
    setOpens([]);
    setFadeIn(false);

    const bare = /^\d{6}$/.test(selectedTicker);
    const candidates = bare ? [`${selectedTicker}.KS`, `${selectedTicker}.KQ`] : [selectedTicker];

    (async () => {
      let lastErr: Error | null = null;
      for (const c of candidates) {
        try {
          const r = await fetch(`/api/ta-ohlcv?ticker=${encodeURIComponent(c)}&interval=${interval}`);
          if (!r.ok) {
            const j = await r.json().catch(() => ({}));
            throw new Error(j.error ?? `HTTP ${r.status}`);
          }
          const data = (await r.json()) as OhlcvResponse & { opens?: number[] };
          if (cancelled) return;
          setTaResult(computeTA(data.dates, data.prices, data.highs, data.lows, data.volumes));
          setOpens(Array.isArray(data.opens) ? data.opens : []);
          setLoading(false);
          requestAnimationFrame(() => setFadeIn(true));
          return;
        } catch (e) {
          lastErr = e instanceof Error ? e : new Error(String(e));
        }
      }
      if (!cancelled && lastErr) { setError(lastErr.message); setLoading(false); }
    })();

    return () => { cancelled = true; };
  }, [selectedTicker, interval]);

  const selectAsset = (ticker: string, name: string) => {
    if (ticker === selectedTicker) return;
    setSelectedTicker(ticker);
    setSelectedName(name);
    onStockChange?.({ ticker, name });
  };

  const displayName = koreanNames[selectedTicker] || selectedName;

  return (
    <div className="space-y-3">
      {tickerableAssets.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2.5">
          <span className="mr-1 text-[11px] font-semibold text-slate-400">보유 종목</span>
          {tickerableAssets.map((a) => (
            <button key={a.ticker} onClick={() => selectAsset(a.ticker!, a.name)}
              className={`rounded-md border px-2.5 py-1 text-[12px] font-semibold transition ${
                selectedTicker === a.ticker ? "border-[#2f2f9d] bg-[#2f2f9d] text-white" : "border-slate-200 bg-white text-slate-500 hover:bg-slate-50"
              }`}>
              {koreanNames[a.ticker!] || a.name}
            </button>
          ))}
        </div>
      )}

      <StockSearchBox market="all" onSelect={(item) => selectAsset(item.ticker, item.name)} />

      {selectedTicker && (
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-3">
            <div className="flex items-baseline gap-2">
              <span className="text-[17px] font-bold text-slate-800">{displayName}</span>
              <span className="text-[12px] text-slate-400">{selectedTicker}</span>
            </div>
            <div className="flex items-center gap-3">
              {taResult && (
                <div className="flex items-baseline gap-1.5">
                  <span className="text-[19px] font-extrabold" style={{ color: taResult.gradeColor }}>{taResult.score.total}</span>
                  <span className="text-[12px] font-semibold" style={{ color: taResult.gradeColor }}>{taResult.grade}</span>
                </div>
              )}
              <div className="flex gap-0.5 rounded-lg bg-slate-100 p-0.5">
                {([["chart", "차트 분석"], ["result", "분석 결과"]] as const).map(([id, label]) => (
                  <button key={id} onClick={() => setSubTab(id)}
                    className={`rounded-md px-3.5 py-1.5 text-[12px] font-semibold transition ${
                      subTab === id ? "bg-white text-[#2f2f9d] shadow-sm" : "text-slate-500 hover:text-slate-700"
                    }`}>
                    {label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {loading && (
            <div className="flex items-center justify-center gap-2 py-24 text-slate-400">
              <Loader2 size={20} className="animate-spin" />
              <span className="text-[13px]">데이터 불러오는 중</span>
            </div>
          )}

          {!loading && error && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-4">
              <div className="flex items-center gap-2 text-red-700">
                <AlertTriangle size={17} />
                <span className="text-[13px] font-semibold">데이터 로드 실패</span>
              </div>
              <p className="mt-1 text-[12px] text-red-600">{error}</p>
              <button onClick={() => { setError(null); setIntervalState((v) => v); }}
                className="mt-3 flex items-center gap-1.5 rounded-md border border-red-300 px-3 py-1.5 text-[12px] text-red-600 hover:bg-red-100">
                <RefreshCw size={13} /> 다시 시도
              </button>
            </div>
          )}

          {!loading && !error && taResult && (
            <div className="transition-all duration-500 ease-out"
              style={{ opacity: fadeIn ? 1 : 0, transform: fadeIn ? "translateY(0)" : "translateY(10px)" }}>
              {subTab === "chart" ? (
                <div className="space-y-3">
                  <IndicatorChips active={active} interval={interval} onToggle={toggleIndicator} onPreset={applyPreset} />

                  <div className="flex items-center justify-between">
                    <span className="text-[11px] text-slate-400">휠로 확대·축소 · 드래그로 이동</span>
                    <div className="flex gap-0.5 rounded-lg bg-slate-100 p-0.5">
                      {(["1d", "1wk", "1mo"] as Interval[]).map((iv) => (
                        <button key={iv} onClick={() => setIntervalState(iv)}
                          className={`rounded-md px-3 py-1 text-[11px] font-semibold transition ${
                            interval === iv ? "bg-white text-slate-800 shadow-sm" : "text-slate-500 hover:text-slate-700"
                          }`}>
                          {INTERVAL_LABEL[iv]}
                        </button>
                      ))}
                    </div>
                  </div>

                  <ChartArea ind={taResult.indicators} opens={opens} active={active} interval={interval} />
                </div>
              ) : (
                <ResultPanel result={taResult} active={active} onToggleKey={toggleByKey} />
              )}
            </div>
          )}
        </div>
      )}

      <p className="px-1 text-[11px] text-slate-400">
        본 분석은 과거 데이터 기반의 참고 자료이며 투자 조언이 아닙니다.
      </p>
    </div>
  );
}