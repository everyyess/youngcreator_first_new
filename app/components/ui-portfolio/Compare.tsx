"use client";

import { useRef, useState } from "react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";

const NAVY = "#0D2B5E";
const GOLD = "#C9A84C";

const PERSONAS = [
  {
    name: "김준호 (35세, 공격형)",
    existing: { growth: 60, income: 10, hedge: 20, taxLiq: 10 },
    newP: { growth: 65, income: 5, hedge: 10, taxLiq: 20 },
    metrics: {
      existing: { return: "9.8%", vol: "18.2%", sharpe: "0.37", mdd: "28.5%" },
      newP: { return: "12.1%", vol: "15.4%", sharpe: "0.59", mdd: "22.1%" },
    },
    insight: "자사주 매매 제한으로 직접 투자가 불가한 기존 포트폴리오를 AI·반도체 밸류체인 중심의 일임형 랩으로 전환. ISA 계좌 활용 비중 확대를 통해 금융소득종합과세 부담을 구조적으로 완화.",
    llmSummary: `고객님의 포트폴리오를 종합 분석한 결과, 기존 포트폴리오 대비 기대수익률이 9.8%에서 12.1%로 약 2.3%p 개선되었습니다.\n\n위험 조정 수익률(샤프지수)은 0.37에서 0.59로 크게 향상되어, 단위 리스크당 수익 효율이 개선되었습니다. 최대낙폭(MDD)은 28.5%에서 22.1%로 축소되어 하방 위험이 완화되었습니다.\n\n금리 100bp 인상 시나리오에서 신규 포트폴리오의 예상 손실률은 기존 대비 약 40% 감소합니다. 이는 AI·반도체 랩의 분산 효과와 ISA 계좌 절세 구조가 복합적으로 작용한 결과입니다.\n\n세후 관점에서 금융소득종합과세 절세 효과로 연간 실수령액이 추가로 개선될 것으로 예상됩니다. 다만 공격적 성향의 포트폴리오 특성상, 단기 시장 변동성에 대한 모니터링을 권장드립니다.`,
  },
  {
    name: "박서현 (47세, 중립형)",
    existing: { growth: 20, income: 50, hedge: 15, taxLiq: 15 },
    newP: { growth: 20, income: 35, hedge: 15, taxLiq: 30 },
    metrics: {
      existing: { return: "5.1%", vol: "8.4%", sharpe: "0.25", mdd: "12.3%" },
      newP: { return: "7.2%", vol: "7.1%", sharpe: "0.59", mdd: "9.8%" },
    },
    insight: "안전 자산 편중으로 벤치마크 대비 수익률이 부진한 기존 포트폴리오에 일임형 랩을 편입하여 주도주 노출도를 확보. 2년 후 확정 예정인 유학 자금을 달러 표시 타겟만기 채권으로 분리 운용하여 환율 변동 리스크를 사전 차단.",
    llmSummary: `고객님의 포트폴리오를 종합 분석한 결과, 기존 대비 기대수익률이 5.1%에서 7.2%로 개선되면서도 변동성은 8.4%에서 7.1%로 오히려 감소하는 효율적 구조가 확인되었습니다.\n\n샤프지수가 0.25에서 0.59로 대폭 향상된 점이 핵심입니다. 이는 인컴 자산 비중 최적화와 달러 헷지 전략이 동시에 작용한 결과입니다.\n\n2년 후 예정된 유학 자금 3억 원은 달러 타겟만기 채권으로 분리 운용되어, 환율 급등 시나리오(+200원)에서도 원화 기준 손실 없이 목표 금액을 확보할 수 있습니다.\n\n병원 고정비 대응을 위한 월지급식 배당 랩의 예상 연간 현금흐름은 약 3,800만 원으로 산출됩니다. 금융소득종합과세 부담도 구조적으로 완화되어 세후 실수령액이 개선될 전망입니다.`,
  },
  {
    name: "이재형 (65세, 안정형)",
    existing: { growth: 5, income: 15, hedge: 20, taxLiq: 60 },
    newP: { growth: 5, income: 15, hedge: 20, taxLiq: 60 },
    metrics: {
      existing: { return: "3.2%", vol: "4.1%", sharpe: "0.05", mdd: "6.2%" },
      newP: { return: "4.0%", vol: "3.8%", sharpe: "0.26", mdd: "5.1%" },
    },
    insight: "부동산 및 예금 중심의 기존 자산을 만기 10년 이상 국고채 분리과세 상품으로 전환하여 세율을 합법적으로 절감. 이자 지급 주기를 월 단위로 설계하여 생활비 현금흐름을 안정적으로 확보.",
    llmSummary: `고객님의 포트폴리오를 종합 분석한 결과, 원금 보전을 최우선으로 하면서도 세후 실질 수익률을 3.2%에서 4.0%로 개선하는 구조가 완성되었습니다.\n\n가장 핵심적인 변화는 세금 구조 개선입니다. 장기 국고채 분리과세 신청을 통해 적용 세율이 49.5%에서 30%로 낮아져, 동일한 표면 수익률에서도 세후 실수령액이 약 19.5%p 증가합니다.\n\n월 단위 이자 지급 설계로 생활비(월 1,000만 원) 현금흐름이 안정적으로 확보됩니다. 4대 위기 시나리오 모두에서 MDD가 6.2%에서 5.1%로 축소되어 원금 보전 목표에 부합합니다.\n\n증여 계획과 연계하여 유언대용신탁 구조를 활용하면, 자녀 세대로의 자산 이전 과정에서 증여세 부담을 추가로 완화할 수 있습니다.`,
  },
];

const BUCKET_COLORS: Record<string, string> = {
  growth: "#3B82F6", income: GOLD, hedge: "#10B981", taxLiq: "#8B5CF6"
};
const BUCKET_LABELS: Record<string, string> = {
  growth: "자본 증식", income: "인컴 창출", hedge: "위험 헷지", taxLiq: "절세·유동성"
};

function getLineData(existing: Record<string, number>, newP: Record<string, number>) {
  let e = 100, n = 100;
  const eReturn = (existing.growth * 0.10 + existing.income * 0.06 + existing.hedge * 0.04 + existing.taxLiq * 0.03) / 100;
  const nReturn = (newP.growth * 0.12 + newP.income * 0.07 + newP.hedge * 0.05 + newP.taxLiq * 0.035) / 100;
  return Array.from({ length: 6 }, (_, y) => {
    const row = { year: `${2019 + y}년`, 기존: Math.round(e), 신규: Math.round(n) };
    e *= 1 + eReturn;
    n *= 1 + nReturn;
    return row;
  });
}

function hexToRgb(hex: string): [number, number, number] {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return [r, g, b];
}

export default function Compare() {
  const [activePersona, setActivePersona] = useState(0);
  const [llmLoading, setLlmLoading] = useState(false);
  const [llmVisible, setLlmVisible] = useState(false);
  const chartRef = useRef<HTMLDivElement>(null);
  const p = PERSONAS[activePersona];
  const lineData = getLineData(p.existing, p.newP);

  function handleLLM() {
    setLlmVisible(false);
    setLlmLoading(true);
    setTimeout(() => { setLlmLoading(false); setLlmVisible(true); }, 2000);
  }

  async function handlePDF() {
    const today = new Date().toLocaleDateString("ko-KR");
    const lineDataStr = JSON.stringify(lineData);

    const bucketRows = (alloc: Record<string, number>) =>
      Object.entries(alloc).map(([key, val]) => `
        <div style="margin-bottom:10px">
          <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:3px">
            <span style="color:#6b7280">${BUCKET_LABELS[key]}</span>
            <span style="color:${BUCKET_COLORS[key]};font-weight:700">${val}%</span>
          </div>
          <div style="background:#e9ecef;border-radius:4px;height:7px">
            <div style="width:${val}%;height:100%;background:${BUCKET_COLORS[key]};border-radius:4px"></div>
          </div>
        </div>`).join("");

    const metricCards = (metrics: {return:string;vol:string;sharpe:string;mdd:string}) => [
      { label: "기대수익률", value: metrics.return, color: "#3B82F6" },
      { label: "변동성",     value: metrics.vol,    color: "#C9A84C" },
      { label: "샤프지수",   value: metrics.sharpe, color: "#10B981" },
      { label: "MDD",        value: metrics.mdd,    color: "#EF4444" },
    ].map(m => `
      <div style="background:#f9fafb;border-radius:8px;padding:10px;text-align:center">
        <div style="color:#9ca3af;font-size:11px;margin-bottom:4px">${m.label}</div>
        <div style="color:${m.color};font-size:17px;font-weight:700">${m.value}</div>
      </div>`).join("");

    const chartPoints = lineData.map((d, i) => ({
      x: 60 + i * 90,
      eY: 220 - (d["기존"] - 95) * 1.8,
      nY: 220 - (d["신규"] - 95) * 1.8,
      label: d.year,
      e: d["기존"],
      n: d["신규"],
    }));
    const ePolyline = chartPoints.map(p => `${p.x},${p.eY}`).join(" ");
    const nPolyline = chartPoints.map(p => `${p.x},${p.nY}`).join(" ");
    const chartSvg = `
      <svg width="560" height="250" xmlns="http://www.w3.org/2000/svg" style="overflow:visible">
        <line x1="50" y1="20" x2="50" y2="230" stroke="#e5e7eb" stroke-width="1"/>
        <line x1="50" y1="230" x2="560" y2="230" stroke="#e5e7eb" stroke-width="1"/>
        ${[100,110,120,130,140,150].map((v,i) => `
          <line x1="50" y1="${220-(v-95)*1.8}" x2="560" y2="${220-(v-95)*1.8}" stroke="#f0f0f0" stroke-width="1"/>
          <text x="44" y="${224-(v-95)*1.8}" font-size="10" fill="#9ca3af" text-anchor="end">${v}</text>
        `).join("")}
        ${chartPoints.map(pt => `<line x1="${pt.x}" y1="20" x2="${pt.x}" y2="230" stroke="#f0f0f0" stroke-width="1"/>`).join("")}
        <polyline points="${ePolyline}" fill="none" stroke="#94a3b8" stroke-width="2"/>
        <polyline points="${nPolyline}" fill="none" stroke="#C9A84C" stroke-width="2.5"/>
        ${chartPoints.map(pt => `
          <circle cx="${pt.x}" cy="${pt.eY}" r="4" fill="#94a3b8"/>
          <circle cx="${pt.x}" cy="${pt.nY}" r="4" fill="#C9A84C"/>
          <text x="${pt.x}" y="244" font-size="10" fill="#6b7280" text-anchor="middle">${pt.label}</text>
        `).join("")}
        <circle cx="380" cy="14" r="5" fill="#94a3b8"/>
        <text x="390" y="18" font-size="11" fill="#6b7280">기존</text>
        <circle cx="420" cy="14" r="5" fill="#C9A84C"/>
        <text x="430" y="18" font-size="11" fill="#6b7280">신규</text>
      </svg>`;

    const html = `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8"/>
<title>포트폴리오 비교 — ${p.name}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: "Apple SD Gothic Neo", "Malgun Gothic", "맑은 고딕", sans-serif; background: #fff; color: #1f2937; }
  .page { width: 210mm; min-height: 297mm; padding: 0; page-break-after: always; position: relative; }
  .page:last-child { page-break-after: avoid; }
  .header { background: #0D2B5E; padding: 14px 20px 12px; display: flex; justify-content: space-between; align-items: flex-end; }
  .header-title { color: #fff; font-size: 15px; font-weight: 700; }
  .header-sub { color: #C9A84C; font-size: 10px; margin-top: 3px; }
  .header-date { color: #b0c4de; font-size: 10px; }
  .body { padding: 20px 22px; }
  .insight-box { background: #EFF6FF; border: 1px solid #BFDBFE; border-radius: 8px; padding: 12px 16px; margin-bottom: 18px; font-size: 11px; color: #1e40af; line-height: 1.6; }
  .insight-box strong { color: #0D2B5E; }
  .grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 16px; }
  .card { background: #fff; border: 1px solid #e5e7eb; border-radius: 10px; padding: 18px; }
  .card-title { color: #0D2B5E; font-size: 13px; font-weight: 700; margin-bottom: 14px; padding-bottom: 8px; border-bottom: 2px solid; }
  .metrics-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-top: 14px; }
  .metric-cell { background: #f9fafb; border-radius: 7px; padding: 9px; text-align: center; }
  .metric-label { color: #9ca3af; font-size: 10px; margin-bottom: 3px; }
  .metric-value { font-size: 16px; font-weight: 700; }
  .section-title { color: #0D2B5E; font-size: 12px; font-weight: 700; margin-bottom: 12px; }
  .chart-wrap { background: #fff; border: 1px solid #e5e7eb; border-radius: 10px; padding: 18px; margin-bottom: 16px; }
  .footer { position: absolute; bottom: 10mm; left: 22px; right: 22px; display: flex; justify-content: space-between; border-top: 1px solid #e5e7eb; padding-top: 6px; }
  .footer span { color: #9ca3af; font-size: 9px; }
  .page2-body { padding: 20px 22px; }
  .ai-badge { background: #C9A84C; color: #fff; font-size: 10px; font-weight: 700; padding: 3px 10px; border-radius: 5px; display: inline-block; margin-bottom: 14px; }
  .ai-text { color: #374151; font-size: 11.5px; line-height: 1.85; white-space: pre-line; }
  .disclaimer { background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 8px; padding: 14px 16px; margin-top: 24px; }
  .disclaimer-title { color: #6b7280; font-size: 10px; font-weight: 700; margin-bottom: 6px; }
  .disclaimer-text { color: #9ca3af; font-size: 9.5px; line-height: 1.7; }
  @media print {
    body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .page { page-break-after: always; }
  }
</style>
</head>
<body>

<!-- PAGE 1 -->
<div class="page">
  <div class="header">
    <div>
      <div class="header-title">삼성증권 VVIP Asset Advisor Hub</div>
      <div class="header-sub">신규 포트폴리오 산출 리포트 · ${p.name}</div>
    </div>
    <div class="header-date">발행일: ${today}</div>
  </div>
  <div class="body">
    <div class="insight-box"><strong>포트폴리오 전환 핵심 </strong>${p.insight}</div>
    <div class="grid2">
      <div class="card">
        <div class="card-title" style="border-color:#94a3b8">기존 포트폴리오</div>
        ${bucketRows(p.existing)}
        <div class="metrics-grid">
          <div class="metric-cell"><div class="metric-label">기대수익률</div><div class="metric-value" style="color:#3B82F6">${p.metrics.existing.return}</div></div>
          <div class="metric-cell"><div class="metric-label">변동성</div><div class="metric-value" style="color:#C9A84C">${p.metrics.existing.vol}</div></div>
          <div class="metric-cell"><div class="metric-label">샤프지수</div><div class="metric-value" style="color:#10B981">${p.metrics.existing.sharpe}</div></div>
          <div class="metric-cell"><div class="metric-label">MDD</div><div class="metric-value" style="color:#EF4444">${p.metrics.existing.mdd}</div></div>
        </div>
      </div>
      <div class="card">
        <div class="card-title" style="border-color:#C9A84C">신규 포트폴리오</div>
        ${bucketRows(p.newP)}
        <div class="metrics-grid">
          <div class="metric-cell"><div class="metric-label">기대수익률</div><div class="metric-value" style="color:#3B82F6">${p.metrics.newP.return}</div></div>
          <div class="metric-cell"><div class="metric-label">변동성</div><div class="metric-value" style="color:#C9A84C">${p.metrics.newP.vol}</div></div>
          <div class="metric-cell"><div class="metric-label">샤프지수</div><div class="metric-value" style="color:#10B981">${p.metrics.newP.sharpe}</div></div>
          <div class="metric-cell"><div class="metric-label">MDD</div><div class="metric-value" style="color:#EF4444">${p.metrics.newP.mdd}</div></div>
        </div>
      </div>
    </div>
    <div class="chart-wrap">
      <div class="section-title">누적 수익률 비교 (기준: 100)</div>
      ${chartSvg}
    </div>
  </div>
  <div class="footer">
    <span>삼성증권 Young Creator 15기 | VVIP Asset Advisor Hub | 4-3 신규 포트폴리오 산출</span>
    <span>1 / 2</span>
  </div>
</div>

<!-- PAGE 2 -->
<div class="page">
  <div class="header">
    <div>
      <div class="header-title">AI 종합 해설</div>
      <div class="header-sub">${p.name} 포트폴리오 기준</div>
    </div>
    <div class="header-date">발행일: ${today}</div>
  </div>
  <div class="page2-body">
    <div class="ai-badge">AI 분석</div>
    <div class="ai-text">${p.llmSummary.replace(/\n/g, "<br/>")}</div>
    <div class="disclaimer">
      <div class="disclaimer-title">투자 유의사항</div>
      <div class="disclaimer-text">
        본 리포트는 투자 참고 목적으로 작성되었으며, 투자 결과에 대한 법적 책임을 지지 않습니다.<br/>
        금융투자상품은 원금 손실이 발생할 수 있으며, 투자 전 상품설명서 및 약관을 반드시 확인하시기 바랍니다.
      </div>
    </div>
  </div>
  <div class="footer">
    <span>삼성증권 Young Creator 15기 | VVIP Asset Advisor Hub | 4-3 신규 포트폴리오 산출</span>
    <span>2 / 2</span>
  </div>
</div>

<script>window.onload = () => window.print();</script>
</body>
</html>`;

    const blob = new Blob([html], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    window.open(url, "_blank");
  }

    const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
    const W = 210;
    const today = new Date().toLocaleDateString("ko-KR");

    // ── 헬퍼 ──────────────────────────────────────────
    function setFont(size: number, style: "normal" | "bold" = "normal", color: [number,number,number] = [30,30,30]) {
      pdf.setFontSize(size);
      pdf.setFont("helvetica", style);
      pdf.setTextColor(...color);
    }
    function drawRect(x: number, y: number, w: number, h: number, fill: string, radius = 2) {
      const [r,g,b] = hexToRgb(fill);
      pdf.setFillColor(r,g,b);
      pdf.roundedRect(x, y, w, h, radius, radius, "F");
    }
    function drawBar(x: number, y: number, w: number, color: string) {
      drawRect(x, y, w, 4, color, 1);
      drawRect(x, y, 210 * 0.38, 4, "#e9ecef", 1); // 배경
      drawRect(x, y, w, 4, color, 1); // 전경
    }

    // ══════════════════════════════════════════════════
    // PAGE 1 — 포트폴리오 비교
    // ══════════════════════════════════════════════════

    // 헤더
    drawRect(0, 0, W, 22, "#0D2B5E", 0);
    setFont(14, "bold", [255,255,255]);
    pdf.text("삼성증권 VVIP Asset Advisor Hub", 14, 10);
    setFont(9, "normal", [196,168,76]);
    pdf.text("신규 포트폴리오 산출 리포트", 14, 16);
    setFont(9, "normal", [180,200,230]);
    pdf.text(`발행일: ${today}`, W - 14, 16, { align: "right" });

    // 고객명 + 인사이트 박스
    let y = 30;
    setFont(13, "bold", hexToRgb(NAVY));
    pdf.text(p.name, 14, y);
    y += 6;
    drawRect(14, y, W - 28, 16, "#EFF6FF", 3);
    pdf.setDrawColor(191, 219, 254);
    pdf.roundedRect(14, y, W - 28, 16, 3, 3, "S");
    setFont(8, "bold", hexToRgb(NAVY));
    pdf.text("포트폴리오 전환 핵심", 18, y + 5);
    setFont(7.5, "normal", [30, 64, 175]);
    const insightLines = pdf.splitTextToSize(p.insight, W - 36);
    pdf.text(insightLines, 18, y + 11);
    y += 22;

    // ── 버킷 배분 비교 ──────────────────────────────
    const colW = (W - 28 - 10) / 2;
    const sides = [
      { title: "기존 포트폴리오", alloc: p.existing, metrics: p.metrics.existing, accent: "#94a3b8" },
      { title: "신규 포트폴리오", alloc: p.newP,     metrics: p.metrics.newP,     accent: GOLD },
    ];

    sides.forEach((side, si) => {
      const cx = 14 + si * (colW + 10);

      // 카드 배경
      drawRect(cx, y, colW, 72, "#ffffff", 3);
      pdf.setDrawColor(229, 231, 235);
      pdf.roundedRect(cx, y, colW, 72, 3, 3, "S");

      // 상단 강조선
      const [ar,ag,ab] = hexToRgb(side.accent);
      pdf.setFillColor(ar,ag,ab);
      pdf.roundedRect(cx, y, colW, 2, 1, 1, "F");

      setFont(9, "bold", hexToRgb(NAVY));
      pdf.text(side.title, cx + 6, y + 8);

      // 버킷 바
      let by = y + 13;
      Object.entries(side.alloc).forEach(([key, val]) => {
        setFont(7.5, "normal", [107, 114, 128]);
        pdf.text(BUCKET_LABELS[key], cx + 6, by + 3);
        setFont(7.5, "bold", hexToRgb(BUCKET_COLORS[key]));
        pdf.text(`${val}%`, cx + colW - 8, by + 3, { align: "right" });
        // 배경바
        const [br,bg2,bb] = hexToRgb("#e9ecef");
        pdf.setFillColor(br,bg2,bb);
        pdf.roundedRect(cx + 6, by + 5, colW - 12, 3, 1, 1, "F");
        // 전경바
        const [fr,fg,fb] = hexToRgb(BUCKET_COLORS[key]);
        pdf.setFillColor(fr,fg,fb);
        pdf.roundedRect(cx + 6, by + 5, (colW - 12) * val / 100, 3, 1, 1, "F");
        by += 12;
      });
    });

    y += 76;

    // ── 지표 비교 테이블 ─────────────────────────────
    drawRect(14, y, W - 28, 6, "#0D2B5E", 2);
    setFont(8, "bold", [255,255,255]);
    pdf.text("지표", 18, y + 4);
    pdf.text("기존 포트폴리오", 80, y + 4);
    pdf.text("신규 포트폴리오", 140, y + 4);
    y += 6;

    const metricRows = [
      { label: "기대수익률", e: p.metrics.existing.return, n: p.metrics.newP.return, color: "#3B82F6" },
      { label: "변동성",     e: p.metrics.existing.vol,    n: p.metrics.newP.vol,    color: GOLD },
      { label: "샤프지수",   e: p.metrics.existing.sharpe, n: p.metrics.newP.sharpe, color: "#10B981" },
      { label: "MDD",        e: p.metrics.existing.mdd,    n: p.metrics.newP.mdd,    color: "#EF4444" },
    ];

    metricRows.forEach((row, ri) => {
      const rowBg = ri % 2 === 0 ? "#f9fafb" : "#ffffff";
      drawRect(14, y, W - 28, 8, rowBg, 0);
      pdf.setDrawColor(229, 231, 235);
      pdf.line(14, y + 8, W - 14, y + 8);
      setFont(8, "normal", [107, 114, 128]);
      pdf.text(row.label, 18, y + 5.5);
      setFont(8, "bold", hexToRgb(row.color));
      pdf.text(row.e, 80, y + 5.5);
      pdf.text(row.n, 140, y + 5.5);
      y += 8;
    });

    y += 8;

    // ── 누적수익률 차트 캡처 ─────────────────────────
    if (chartRef.current) {
      setFont(9, "bold", hexToRgb(NAVY));
      pdf.text("누적 수익률 비교 (기준: 100)", 14, y);
      y += 4;
      try {
        const canvas = await html2canvas(chartRef.current, { scale: 2, backgroundColor: "#ffffff" });
        const imgData = canvas.toDataURL("image/png");
        const chartH = 45;
        const chartW = W - 28;
        pdf.addImage(imgData, "PNG", 14, y, chartW, chartH);
        y += chartH + 4;
      } catch {
        y += 4;
      }
    }

    // 페이지 1 푸터
    pdf.setDrawColor(229, 231, 235);
    pdf.line(14, 285, W - 14, 285);
    setFont(7, "normal", [156, 163, 175]);
    pdf.text("삼성증권 Young Creator 15기 | VVIP Asset Advisor Hub | 4-3 신규 포트폴리오 산출", 14, 289);
    pdf.text("1 / 2", W - 14, 289, { align: "right" });

    // ══════════════════════════════════════════════════
    // PAGE 2 — AI 종합 해설
    // ══════════════════════════════════════════════════
    pdf.addPage();

    // 헤더
    drawRect(0, 0, W, 22, "#0D2B5E", 0);
    setFont(14, "bold", [255,255,255]);
    pdf.text("AI 종합 해설", 14, 10);
    setFont(9, "normal", [196,168,76]);
    pdf.text(`${p.name} 포트폴리오 기준`, 14, 16);
    setFont(9, "normal", [180,200,230]);
    pdf.text(`발행일: ${today}`, W - 14, 16, { align: "right" });

    let y2 = 32;

    // AI 배지
    drawRect(14, y2, 22, 6, GOLD, 2);
    setFont(7.5, "bold", [255,255,255]);
    pdf.text("AI 분석", 16, y2 + 4.3);
    y2 += 12;

    // 해설 본문
    const summaryLines = pdf.splitTextToSize(p.llmSummary.replace(/\n\n/g, "\n \n"), W - 28);
    setFont(9, "normal", [55, 65, 81]);
    pdf.text(summaryLines, 14, y2);
    y2 += summaryLines.length * 5 + 10;

    // 면책 박스
    drawRect(14, y2, W - 28, 18, "#f9fafb", 3);
    pdf.setDrawColor(229, 231, 235);
    pdf.roundedRect(14, y2, W - 28, 18, 3, 3, "S");
    setFont(7, "bold", [107, 114, 128]);
    pdf.text("투자 유의사항", 18, y2 + 5);
    setFont(6.5, "normal", [107, 114, 128]);
    pdf.text("본 리포트는 투자 참고 목적으로 작성되었으며, 투자 결과에 대한 법적 책임을 지지 않습니다.", 18, y2 + 10);
    pdf.text("금융투자상품은 원금 손실이 발생할 수 있으며, 투자 전 상품설명서 및 약관을 반드시 확인하시기 바랍니다.", 18, y2 + 15);

    // 페이지 2 푸터
    pdf.setDrawColor(229, 231, 235);
    pdf.line(14, 285, W - 14, 285);
    setFont(7, "normal", [156, 163, 175]);
    pdf.text("삼성증권 Young Creator 15기 | VVIP Asset Advisor Hub | 4-3 신규 포트폴리오 산출", 14, 289);
    pdf.text("2 / 2", W - 14, 289, { align: "right" });

    pdf.save(`포트폴리오_비교_${p.name}.pdf`);
  }

  return (
    <div style={{ minHeight: "100vh", background: "#f1f5f9", padding: "32px 24px", fontFamily: "sans-serif" }}>
      <div style={{ maxWidth: 960, margin: "0 auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
          <h1 style={{ color: NAVY, fontSize: 22, fontWeight: 700 }}>포트폴리오 비교</h1>
          <button onClick={handlePDF} style={{ padding: "10px 20px", background: NAVY, color: "#fff", border: "none", borderRadius: 8, cursor: "pointer", fontWeight: 600, fontSize: 13 }}>
            PDF 저장
          </button>
        </div>

        <div style={{ display: "flex", gap: 10, marginBottom: 24, flexWrap: "wrap" }}>
          {PERSONAS.map((per, i) => (
            <button key={i} onClick={() => { setActivePersona(i); setLlmVisible(false); }} style={{
              padding: "9px 16px", borderRadius: 8, cursor: "pointer", fontWeight: 600, fontSize: 13,
              border: `2px solid ${activePersona === i ? NAVY : "#e5e7eb"}`,
              background: activePersona === i ? NAVY : "#fff",
              color: activePersona === i ? "#fff" : "#374151",
            }}>{per.name}</button>
          ))}
        </div>

        <div style={{ background: "#EFF6FF", border: "1px solid #BFDBFE", borderRadius: 10, padding: "14px 18px", marginBottom: 20 }}>
          <span style={{ color: NAVY, fontWeight: 700, fontSize: 12 }}>포트폴리오 전환 핵심: </span>
          <span style={{ color: "#1e40af", fontSize: 12 }}>{p.insight}</span>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20, marginBottom: 20 }} className="compare-grid">
          {[
            { title: "기존 포트폴리오", alloc: p.existing, metrics: p.metrics.existing, border: "#94a3b8" },
            { title: "신규 포트폴리오", alloc: p.newP, metrics: p.metrics.newP, border: GOLD },
          ].map((side, i) => (
            <div key={i} style={{ background: "#fff", borderRadius: 12, padding: 24, boxShadow: "0 1px 4px rgba(0,0,0,0.06)", border: "1px solid #e5e7eb", borderTop: `3px solid ${side.border}` }}>
              <h2 style={{ color: NAVY, fontSize: 15, fontWeight: 700, marginBottom: 16 }}>{side.title}</h2>
              <div style={{ marginBottom: 16 }}>
                {Object.entries(side.alloc).map(([key, val]) => (
                  <div key={key} style={{ marginBottom: 8 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 3 }}>
                      <span style={{ color: "#6b7280" }}>{BUCKET_LABELS[key]}</span>
                      <span style={{ color: BUCKET_COLORS[key], fontWeight: 700 }}>{val}%</span>
                    </div>
                    <div style={{ background: "#e9ecef", borderRadius: 4, height: 6 }}>
                      <div style={{ width: `${val}%`, height: "100%", background: BUCKET_COLORS[key], borderRadius: 4 }} />
                    </div>
                  </div>
                ))}
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                {[
                  { label: "기대수익률", value: side.metrics.return, color: "#3B82F6" },
                  { label: "변동성", value: side.metrics.vol, color: GOLD },
                  { label: "샤프지수", value: side.metrics.sharpe, color: "#10B981" },
                  { label: "MDD", value: side.metrics.mdd, color: "#EF4444" },
                ].map(m => (
                  <div key={m.label} style={{ background: "#f9fafb", borderRadius: 8, padding: "10px 12px", textAlign: "center" }}>
                    <div style={{ color: "#9ca3af", fontSize: 10, marginBottom: 3 }}>{m.label}</div>
                    <div style={{ color: m.color, fontSize: 16, fontWeight: 700 }}>{m.value}</div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        <div ref={chartRef} style={{ background: "#fff", borderRadius: 12, padding: 24, boxShadow: "0 1px 4px rgba(0,0,0,0.06)", border: "1px solid #e5e7eb", marginBottom: 20 }}>
          <h3 style={{ color: NAVY, fontSize: 14, fontWeight: 700, marginBottom: 20 }}>누적 수익률 비교 (기준: 100)</h3>
          <ResponsiveContainer width="100%" height={280}>
            <LineChart data={lineData} margin={{ top: 10, right: 30, left: 10, bottom: 10 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="year" tick={{ fontSize: 12 }} />
              <YAxis tick={{ fontSize: 12 }} />
              <Tooltip />
              <Legend />
              <Line type="monotone" dataKey="기존" stroke="#94a3b8" strokeWidth={2} dot={{ r: 4 }} />
              <Line type="monotone" dataKey="신규" stroke={GOLD} strokeWidth={2.5} dot={{ r: 4 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>

        <div style={{ background: "#fff", borderRadius: 12, padding: 24, boxShadow: "0 1px 4px rgba(0,0,0,0.06)", border: "1px solid #e5e7eb" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
            <div>
              <h3 style={{ color: NAVY, fontSize: 14, fontWeight: 700, marginBottom: 4 }}>AI 종합 해설</h3>
              <p style={{ color: "#9ca3af", fontSize: 11 }}>포트폴리오 지표, 스트레스 테스트, 세후 수익률을 종합한 맞춤 해설</p>
            </div>
            <button onClick={handleLLM} style={{
              padding: "10px 20px", background: llmLoading ? "#94a3b8" : GOLD,
              color: "#fff", border: "none", borderRadius: 8, cursor: llmLoading ? "not-allowed" : "pointer",
              fontWeight: 600, fontSize: 13, display: "flex", alignItems: "center", gap: 8
            }}>
              {llmLoading ? (
                <>
                  <span style={{ display: "inline-block", width: 14, height: 14, border: "2px solid #fff", borderTopColor: "transparent", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
                  분석 중...
                </>
              ) : "AI 해설 생성"}
            </button>
          </div>

          {llmVisible && (
            <div style={{ background: "#f9fafb", borderRadius: 10, padding: 20, border: "1px solid #e5e7eb" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
                <div style={{ background: GOLD, borderRadius: 6, padding: "3px 10px", fontSize: 11, color: "#fff", fontWeight: 700 }}>AI 분석</div>
                <span style={{ color: "#9ca3af", fontSize: 11 }}>{p.name} 포트폴리오 기준</span>
              </div>
              <p style={{ color: "#374151", fontSize: 13, lineHeight: 1.8, whiteSpace: "pre-line" }}>
                {p.llmSummary}
              </p>
            </div>
          )}

          {!llmVisible && !llmLoading && (
            <div style={{ background: "#f9fafb", borderRadius: 10, padding: 24, textAlign: "center", border: "1px dashed #e5e7eb" }}>
              <p style={{ color: "#9ca3af", fontSize: 13 }}>AI 해설 생성 버튼을 클릭하면 고객 맞춤 종합 해설이 생성됩니다.</p>
            </div>
          )}
        </div>
      </div>

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        @media (max-width: 768px) { .compare-grid { grid-template-columns: 1fr !important; } }
      `}</style>
    </div>
  );
}