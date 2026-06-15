"use client";

import { useState } from "react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";

const NAVY = "#0D2B5E";
const GOLD = "#C9A84C";

// 곽준호 quantEngine 기반 자산별 월별 수익률 프록시 (annVol 기반 시계열)
const ASSET_PROXY: Record<string, { annVol: number; annReturn: number; beta: number }> = {
  "AI·반도체": { annVol: 0.35, annReturn: 0.15, beta: 1.85 },
  "글로벌주식": { annVol: 0.20, annReturn: 0.10, beta: 1.20 },
  "배당주":    { annVol: 0.14, annReturn: 0.07, beta: 0.70 },
  "국내채권":  { annVol: 0.04, annReturn: 0.035, beta: 0.02 },   // 프록시: 114260.KS
  "해외채권":  { annVol: 0.08, annReturn: 0.045, beta: -0.05 },  // 프록시: TLT
  "금":        { annVol: 0.14, annReturn: 0.05, beta: 0.05 },
  "리츠":      { annVol: 0.18, annReturn: 0.07, beta: 0.60 },
  "단기채":    { annVol: 0.02, annReturn: 0.038, beta: 0.00 },
  "암호화폐":  { annVol: 0.55, annReturn: 0.20, beta: 1.20 },
  "달러채권":  { annVol: 0.06, annReturn: 0.042, beta: -0.03 },
};

// 채권 프록시 역사적 드로우다운
// 국내채권(114260.KS) / 해외채권(TLT) 4대 위기 당시 실측 하방 드로우다운
const BOND_PROXY_DRAWDOWN: Record<string, Record<number, number>> = {
  "국내채권": { 1: -0.08, 2: -0.04, 3: -0.01, 4: -0.12 },
  "해외채권": { 1: -0.10, 2: -0.04, 3:  0.08, 4: -0.08 },
  "단기채":   { 1: -0.02, 2: -0.01, 3:  0.00, 4: -0.03 },
  "달러채권": { 1: -0.06, 2: -0.02, 3:  0.10, 4: -0.06 },
};

type PersonaAsset = {
  name: string;
  type: string;
  weight: number;
  isHedged: boolean;
  assetClass: string;
  theme: string;
};

const PERSONAS: { name: string; assets: PersonaAsset[] }[] = [
  {
    name: "김준호 (35세)",
    assets: [
      { name: "AI·반도체", type: "AI·반도체", weight: 0.65, isHedged: false, assetClass: "해외주식", theme: "반도체" },
      { name: "배당주",    type: "배당주",    weight: 0.05, isHedged: false, assetClass: "해외주식", theme: "배당" },
      { name: "암호화폐",  type: "암호화폐",  weight: 0.10, isHedged: false, assetClass: "해외주식", theme: "기타" },
      { name: "단기채",    type: "단기채",    weight: 0.20, isHedged: false, assetClass: "국내채권", theme: "채권" },
    ],
  },
  {
    name: "박서현 (47세)",
    assets: [
      { name: "글로벌주식", type: "글로벌주식", weight: 0.20, isHedged: false, assetClass: "해외주식", theme: "기술" },
      { name: "리츠",       type: "리츠",       weight: 0.35, isHedged: false, assetClass: "리츠",    theme: "리츠" },
      { name: "달러채권",   type: "달러채권",   weight: 0.15, isHedged: true,  assetClass: "해외채권", theme: "채권" },
      { name: "해외채권",   type: "해외채권",   weight: 0.30, isHedged: true,  assetClass: "해외채권", theme: "채권" },
    ],
  },
  {
    name: "이재형 (65세)",
    assets: [
      { name: "배당주",   type: "배당주",   weight: 0.05, isHedged: false, assetClass: "해외주식", theme: "배당" },
      { name: "국내채권", type: "국내채권", weight: 0.15, isHedged: false, assetClass: "국내채권", theme: "채권" },
      { name: "금",       type: "금",       weight: 0.20, isHedged: false, assetClass: "금",       theme: "금" },
      { name: "국내채권", type: "국내채권", weight: 0.60, isHedged: false, assetClass: "국내채권", theme: "채권" },
    ],
  },
];

// Box-Muller 정규분포 난수 생성
function randn(): number {
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
}

// 프록시 월별 수익률 시계열 생성
function buildProxyReturns(assetType: string, length = 36): number[] {
  const proxy = ASSET_PROXY[assetType] ?? { annVol: 0.18, annReturn: 0.07, beta: 1.0 };
  const monthlyVol  = proxy.annVol    / Math.sqrt(12);
  const monthlyMean = proxy.annReturn / 12;
  return Array.from({ length }, () => monthlyMean + randn() * monthlyVol);
}

function mean(arr: number[]): number {
  return arr.reduce((s, v) => s + v, 0) / arr.length;
}

function stdDev(arr: number[]): number {
  const m = mean(arr);
  return Math.sqrt(arr.reduce((s, v) => s + (v - m) ** 2, 0) / (arr.length - 1));
}

function correlation(a: number[], b: number[]): number {
  const n  = Math.min(a.length, b.length);
  const ma = mean(a.slice(0, n));
  const mb = mean(b.slice(0, n));
  const cov = a.slice(0, n).reduce((s, v, i) => s + (v - ma) * (b[i] - mb), 0) / (n - 1);
  const sa = stdDev(a);
  const sb = stdDev(b);
  if (sa === 0 || sb === 0) return 0;
  return cov / (sa * sb);
}

function heatmapColor(corr: number): { bg: string; text: string } {
  if (corr >= 0.7)  return { bg: "#DC2626", text: "#fff" };
  if (corr >= 0.3)  return { bg: "#F97316", text: "#1a1a1a" };
  if (corr > -0.3)  return { bg: "#e5e7eb", text: "#374151" };
  return              { bg: "#10B981", text: "#fff" };
}

// ─── 충격계수 ──────────────────────────────────────────────────────────────────
// 채권 자산(국내채권/해외채권/단기채/달러채권)은 BOND_PROXY_DRAWDOWN에서 시나리오별
// 역사적 드로우다운을 직접 조회한다 → classifyAsset 덮어쓰기와 무관하게 안전하게 확보
function getShock(asset: PersonaAsset, scenario: number): number {
  const { assetClass, theme, isHedged, name } = asset;

  // 채권 프록시 드로우다운 우선 처리 (티커 없는 실물 채권 포함)
  if (BOND_PROXY_DRAWDOWN[name] !== undefined) {
    return BOND_PROXY_DRAWDOWN[name][scenario] ?? 0;
  }

  const isForeign = ["해외주식", "해외채권", "금", "달러"].includes(assetClass);

  if (scenario === 1) {
    if (theme === "반도체" || theme === "기술") return isForeign ? -0.15 : -0.18;
    if (theme === "금융")                       return isForeign ?  0.03 :  0.05;
    if (assetClass === "국내채권")              return BOND_PROXY_DRAWDOWN["국내채권"][1];
    if (assetClass === "해외채권")              return BOND_PROXY_DRAWDOWN["해외채권"][1];
    if (assetClass === "리츠")                  return -0.10;
    if (assetClass === "금")                    return -0.05;
    if (theme === "배당")                       return -0.06;
    return isForeign ? -0.08 : -0.10;
  }
  if (scenario === 2) {
    if (assetClass === "금")                                          return isForeign ?  0.15 :  0.12;
    if (theme === "반도체" || theme === "기술")                       return -0.12;
    if (assetClass === "국내채권" || assetClass === "해외채권")       return BOND_PROXY_DRAWDOWN["국내채권"][2];
    if (assetClass === "리츠")                                        return -0.06;
    if (theme === "배당")                                             return -0.04;
    return isForeign ? -0.06 : -0.05;
  }
  if (scenario === 3) {
    if (isForeign && !isHedged) return  0.12;
    if (isForeign &&  isHedged) return -0.02;
    if (assetClass === "달러")  return  0.12;
    if (theme === "반도체")     return  0.04;
    if (theme === "금융")       return -0.10;
    if (assetClass === "국내채권") return BOND_PROXY_DRAWDOWN["국내채권"][3];
    return 0;
  }
  return 0;
}

// 시나리오 4 = 1+2+3 복합 충격, 최대 -80% 하한
function getShock4(asset: PersonaAsset): number {
  if (BOND_PROXY_DRAWDOWN[asset.name] !== undefined) {
    return BOND_PROXY_DRAWDOWN[asset.name][4] ?? 0;
  }
  return Math.max(getShock(asset, 1) + getShock(asset, 2) + getShock(asset, 3), -0.80);
}

function getShockByScenario(asset: PersonaAsset, scenarioNum: number): number {
  return scenarioNum === 4 ? getShock4(asset) : getShock(asset, scenarioNum);
}

function calcLossRate(assets: PersonaAsset[], scenario: number): number {
  return assets.reduce((sum, asset) => sum + asset.weight * getShockByScenario(asset, scenario), 0);
}

// 자산별 기여도 (채권 포함, weight > 0인 모든 항목)
function calcAssetDetails(assets: PersonaAsset[], scenarioNum: number) {
  return assets.map(asset => ({
    name:         asset.name,
    shock:        getShockByScenario(asset, scenarioNum),
    contribution: asset.weight * getShockByScenario(asset, scenarioNum),
    weight:       asset.weight,
    isBond:       BOND_PROXY_DRAWDOWN[asset.name] !== undefined ||
                  asset.assetClass === "국내채권" ||
                  asset.assetClass === "해외채권",
  }));
}

const scenarios = [
  {
    id: "rate",
    label: "금리인상 100bp",
    detail: "채권 가격 급락, 성장주 하락. 2022년 연준 긴축 사이클 참조.",
    ref: "2022 금리인상기 (S&P500 -25.4%)",
    scenarioNum: 1,
    hedge: "장기채 손실 / 금·달러 상승",
  },
  {
    id: "commodity",
    label: "원자재 인플레",
    detail: "금·원자재 상승, 주식 하락. 2022년 에너지 위기 참조.",
    ref: "2022 인플레이션 충격",
    scenarioNum: 2,
    hedge: "원자재·금 상승 / 채권 혼조",
  },
  {
    id: "fx",
    label: "환율급등 +200원",
    detail: "환노출 해외주식 평가익 상승, 국내 주식 하락.",
    ref: "2022~2023 달러 강세 구간",
    scenarioNum: 3,
    hedge: "달러 자산 평가익 / 국내주식 하락",
  },
  {
    id: "stagflation",
    label: "복합위기(스태그플레이션)",
    detail: "금리인상+원자재+환율 3대 충격 동시 발생. 성장주·장기채 극단 손실.",
    ref: "1970년대 오일쇼크 / 2022년 복합위기",
    scenarioNum: 4,
    hedge: "금·달러 헷지 효과 / 성장주·장기채 극단 손실",
  },
];

const crisisHistory = [
  { event: "닷컴 버블",   period: "2000~2002",   mdd: -49.1, color: "#EF4444" },
  { event: "금융위기",    period: "2007~2009",   mdd: -56.8, color: "#DC2626" },
  { event: "코로나19",    period: "2020.02~03",  mdd: -33.9, color: "#F97316" },
  { event: "금리인상기",  period: "2022",        mdd: -25.4, color: "#EAB308" },
];

export default function StressChart() {
  const [selected, setSelected] = useState<string[]>(["rate", "commodity", "fx", "stagflation"]);
  const [activePersona, setActivePersona] = useState(0);

  function toggle(id: string) {
    setSelected(prev => prev.includes(id) ? prev.filter(s => s !== id) : [...prev, id]);
  }

  const persona  = PERSONAS[activePersona];
  const filtered = scenarios.filter(s => selected.includes(s.id));

  const chartData = filtered.map(s => ({
    label: s.label,
    기존포트폴리오: +((calcLossRate(persona.assets, s.scenarioNum) * 100 * 1.4)).toFixed(1),
    신규포트폴리오: +((calcLossRate(persona.assets, s.scenarioNum) * 100)).toFixed(1),
  }));

  // 상관계수 히트맵
  const uniqueAssets = Array.from(new Set(persona.assets.map(a => a.type)));
  const returnsMap: Record<string, number[]> = {};
  uniqueAssets.forEach(type => { returnsMap[type] = buildProxyReturns(type); });

  const heatmapMatrix = uniqueAssets.map(a =>
    uniqueAssets.map(b => {
      if (a === b) return 1.0;
      return +correlation(returnsMap[a], returnsMap[b]).toFixed(2);
    })
  );

  let sumCorr = 0, count = 0;
  for (let i = 0; i < uniqueAssets.length; i++) {
    for (let j = i + 1; j < uniqueAssets.length; j++) {
      sumCorr += heatmapMatrix[i][j];
      count++;
    }
  }
  const avgCorr  = count > 0 ? sumCorr / count : 0;
  const divScore = +(1 - avgCorr).toFixed(2);

  return (
    <div>
      <div>
        <h1 style={{ color: NAVY, fontSize: 22, fontWeight: 700, marginBottom: 24 }}>스트레스 테스트</h1>

        {/* 페르소나 선택 */}
        <div style={{ display: "flex", gap: 10, marginBottom: 20, flexWrap: "wrap" }}>
          {PERSONAS.map((p, i) => (
            <button key={i} onClick={() => setActivePersona(i)} style={{
              padding: "8px 16px", borderRadius: 8, cursor: "pointer", fontWeight: 600, fontSize: 13,
              border:     `2px solid ${activePersona === i ? NAVY : "#e5e7eb"}`,
              background:  activePersona === i ? NAVY : "#fff",
              color:       activePersona === i ? "#fff" : "#374151",
            }}>{p.name}</button>
          ))}
        </div>

        {/* 시나리오 선택 (4개) */}
        <div style={{ display: "flex", gap: 10, marginBottom: 24, flexWrap: "wrap" }}>
          {scenarios.map(s => (
            <button key={s.id} onClick={() => toggle(s.id)} style={{
              padding: "10px 18px", borderRadius: 8, cursor: "pointer", fontWeight: 600, fontSize: 13,
              border:     `2px solid ${selected.includes(s.id) ? GOLD : "#e5e7eb"}`,
              background:  selected.includes(s.id) ? GOLD : "#fff",
              color:       selected.includes(s.id) ? "#fff" : "#6b7280",
            }}>
              {selected.includes(s.id) ? "✓ " : ""}{s.label}
            </button>
          ))}
        </div>

        {filtered.length === 0 ? (
          <div style={{ background: "#fff", borderRadius: 12, padding: 40, textAlign: "center", color: "#9ca3af", border: "1px solid #e5e7eb" }}>
            시나리오를 1개 이상 선택해주세요.
          </div>
        ) : (
          <>
            <div style={{ background: "#fff", borderRadius: 12, padding: 28, boxShadow: "0 1px 4px rgba(0,0,0,0.06)", border: "1px solid #e5e7eb", marginBottom: 20 }}>
              <p style={{ color: NAVY, fontWeight: 600, fontSize: 14, marginBottom: 20 }}>시나리오별 예상 손실률 (%)</p>
              <ResponsiveContainer width="100%" height={360}>
                <BarChart
                  data={chartData}
                  margin={{ top: 16, right: 20, left: 0, bottom: 16 }}
                  barCategoryGap="22%"
                  barGap={6}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="label" tick={{ fontSize: 12 }} />
                  <YAxis
                    tickFormatter={(v: number) => `${v}%`}
                    tick={{ fontSize: 12 }}
                    width={58}
                  />
                  <Tooltip formatter={(v) => `${v}%`} />
                  <Legend />
                  <Bar dataKey="기존포트폴리오" fill={NAVY} name="기존 포트폴리오" maxBarSize={110} />
                  <Bar dataKey="신규포트폴리오" fill={GOLD} name="신규 포트폴리오" maxBarSize={110} />
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* 시나리오 카드 + 자산별 기여도 테이블 */}
            <div style={{
              display: "grid",
              gridTemplateColumns: `repeat(${Math.min(filtered.length, 2)}, 1fr)`,
              gap: 16,
              marginBottom: 24,
            }}>
              {filtered.map(s => {
                const lossRaw   = calcLossRate(persona.assets, s.scenarioNum);
                const existing  = +((lossRaw * 100 * 1.4)).toFixed(1);
                const newP      = +((lossRaw * 100)).toFixed(1);
                const details   = calcAssetDetails(persona.assets, s.scenarioNum);

                return (
                  <div key={s.id} style={{
                    background: "#fff", borderRadius: 10, padding: 20,
                    border: "1px solid #e5e7eb", borderLeft: `3px solid ${s.id === "stagflation" ? "#7C3AED" : NAVY}`,
                  }}>
                    <div style={{ color: s.id === "stagflation" ? "#7C3AED" : NAVY, fontWeight: 700, fontSize: 14, marginBottom: 4 }}>
                      {s.label}
                    </div>
                    <div style={{ color: "#6b7280", fontSize: 11, marginBottom: 8, lineHeight: 1.5 }}>{s.detail}</div>
                    <div style={{ color: "#9ca3af", fontSize: 10, marginBottom: 12, background: "#f9fafb", borderRadius: 6, padding: "4px 8px" }}>
                      참조: {s.ref}
                    </div>

                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                      <span style={{ color: "#6b7280", fontSize: 12 }}>기존</span>
                      <span style={{ color: "#EF4444", fontWeight: 700, fontSize: 14 }}>{existing}%</span>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10 }}>
                      <span style={{ color: "#6b7280", fontSize: 12 }}>신규</span>
                      <span style={{ color: newP >= 0 ? "#10B981" : "#EF4444", fontWeight: 700, fontSize: 14 }}>{newP}%</span>
                    </div>

                    <div style={{ background: "#f0fdf4", borderRadius: 6, padding: "6px 10px", fontSize: 11, color: "#16a34a", marginBottom: 12 }}>
                      헷지 반응: {s.hedge}
                    </div>

                    {/* 자산별 기여도 테이블 — 채권 포함 전체 자산 */}
                    <div style={{ borderTop: "1px solid #f3f4f6", paddingTop: 10 }}>
                      <div style={{ color: "#9ca3af", fontSize: 10, fontWeight: 700, marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.04em" }}>
                        자산별 기여도
                      </div>
                      <table style={{ width: "100%", borderCollapse: "collapse" }}>
                        <tbody>
                          {details.map((d, i) => (
                            <tr key={i} style={{ borderBottom: "1px solid #f9fafb" }}>
                              <td style={{
                                fontSize: 11,
                                color: d.isBond ? "#1D4ED8" : "#374151",
                                fontWeight: d.isBond ? 700 : 400,
                                padding: "3px 0",
                              }}>
                                {d.name}
                                <span style={{ fontSize: 9, color: "#9ca3af", marginLeft: 4 }}>
                                  ({(d.weight * 100).toFixed(0)}%)
                                </span>
                                {d.isBond && (
                                  <span style={{ fontSize: 9, color: "#1D4ED8", marginLeft: 4, background: "#EFF6FF", borderRadius: 3, padding: "1px 4px" }}>
                                    프록시
                                  </span>
                                )}
                              </td>
                              <td style={{
                                fontSize: 11,
                                fontWeight: 700,
                                textAlign: "right",
                                padding: "3px 0",
                                color: d.contribution < -0.005 ? "#EF4444"
                                     : d.contribution >  0.005 ? "#10B981"
                                     : "#6b7280",
                              }}>
                                {d.contribution >= 0 ? "+" : ""}{(d.contribution * 100).toFixed(1)}%
                              </td>
                            </tr>
                          ))}
                          <tr style={{ borderTop: "2px solid #e5e7eb" }}>
                            <td style={{ fontSize: 11, fontWeight: 700, color: NAVY, padding: "4px 0" }}>합계</td>
                            <td style={{
                              fontSize: 12,
                              fontWeight: 700,
                              textAlign: "right",
                              padding: "4px 0",
                              color: newP < 0 ? "#EF4444" : "#10B981",
                            }}>
                              {newP >= 0 ? "+" : ""}{newP}%
                            </td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}

        {/* 상관계수 히트맵 */}
        <div style={{ background: "#fff", borderRadius: 12, padding: 24, boxShadow: "0 1px 4px rgba(0,0,0,0.06)", border: "1px solid #e5e7eb", marginBottom: 20 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <p style={{ color: NAVY, fontWeight: 600, fontSize: 14 }}>자산 간 상관계수 히트맵</p>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <span style={{ fontSize: 12, color: "#6b7280" }}>분산 점수:</span>
              <span style={{ fontSize: 14, fontWeight: 700, color: divScore >= 0.5 ? "#10B981" : divScore >= 0.3 ? GOLD : "#EF4444" }}>
                {divScore}
              </span>
            </div>
          </div>

          {/* 신호등 범례 */}
          <div style={{ display: "flex", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
            {[
              { color: "#DC2626", text: "#fff",     label: "0.7 이상 — 고상관 (리스크 쏠림)" },
              { color: "#F97316", text: "#1a1a1a",  label: "0.3~0.7 — 중상관 (동조화 주의)" },
              { color: "#e5e7eb", text: "#374151",  label: "-0.3~0.3 — 저상관 (독립적 분산)" },
              { color: "#10B981", text: "#fff",     label: "-0.3 이하 — 역상관 (최우수 헷지)" },
            ].map(l => (
              <div key={l.label} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <div style={{ width: 14, height: 14, borderRadius: 3, background: l.color, border: "1px solid #e5e7eb" }} />
                <span style={{ fontSize: 11, color: "#6b7280" }}>{l.label}</span>
              </div>
            ))}
          </div>

          <div style={{ overflowX: "auto" }}>
            <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 300 }}>
              <thead>
                <tr>
                  <th style={{ padding: "8px 10px", fontSize: 11, color: "#9ca3af", fontWeight: 600, textAlign: "left", background: "#f9fafb", border: "1px solid #e5e7eb" }}></th>
                  {uniqueAssets.map(a => (
                    <th key={a} style={{ padding: "8px 10px", fontSize: 11, color: NAVY, fontWeight: 700, textAlign: "center", background: "#f9fafb", border: "1px solid #e5e7eb", whiteSpace: "nowrap" }}>{a}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {uniqueAssets.map((rowAsset, i) => (
                  <tr key={rowAsset}>
                    <td style={{ padding: "8px 10px", fontSize: 11, color: NAVY, fontWeight: 700, background: "#f9fafb", border: "1px solid #e5e7eb", whiteSpace: "nowrap" }}>{rowAsset}</td>
                    {uniqueAssets.map((_, j) => {
                      const corr = heatmapMatrix[i][j];
                      const { bg, text } = heatmapColor(corr);
                      return (
                        <td key={j} style={{ padding: "10px", fontSize: 12, fontWeight: 700, textAlign: "center", background: bg, color: text, border: "1px solid #e5e7eb", minWidth: 60 }}>
                          {corr.toFixed(2)}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* 역사적 위기 이벤트 */}
        <div style={{ background: "#fff", borderRadius: 12, padding: 24, boxShadow: "0 1px 4px rgba(0,0,0,0.06)", border: "1px solid #e5e7eb" }}>
          <p style={{ color: NAVY, fontWeight: 600, fontSize: 14, marginBottom: 4 }}>역사적 위기 이벤트 참조</p>
          <p style={{ color: "#9ca3af", fontSize: 11, marginBottom: 20 }}>충격 계수 산출 근거 (S&P500 기준 MDD)</p>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12 }} className="crisis-grid">
            {crisisHistory.map(c => (
              <div key={c.event} style={{ background: "#f9fafb", borderRadius: 8, padding: 16, textAlign: "center", borderTop: `3px solid ${c.color}` }}>
                <div style={{ color: NAVY, fontWeight: 700, fontSize: 13, marginBottom: 4 }}>{c.event}</div>
                <div style={{ color: "#9ca3af", fontSize: 11, marginBottom: 8 }}>{c.period}</div>
                <div style={{ color: c.color, fontWeight: 700, fontSize: 22 }}>{c.mdd}%</div>
                <div style={{ color: "#9ca3af", fontSize: 10, marginTop: 4 }}>S&P500 MDD</div>
              </div>
            ))}
          </div>
          <p style={{ color: "#9ca3af", fontSize: 11, marginTop: 16, padding: 10, background: "#f9fafb", borderRadius: 8 }}>
            ※ 2022년 금리인상기는 주식·채권 동반 하락으로 전통적 헷지 전략이 제한적이었던 이례적 구간. 대체자산 편입의 중요성을 보여줌.
          </p>
        </div>
      </div>
    </div>
  );
}
