"use client";

import React, { useState } from "react";
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend, LineChart, Line, XAxis, YAxis, CartesianGrid } from "recharts";

const NAVY = "#0D2B5E";
const GOLD = "#C9A84C";
const MARKET_C = 0.03;

type Persona = { name: string; totalAum: number; rTarget: number; aRisk: number; tYear: number; tTax: number; lCash: number; };

const PERSONAS: Persona[] = [
  { name: "김준호 (35세)", totalAum: 30, rTarget: 0.15, aRisk: 1, tYear: 3, tTax: 1, lCash: 0 },
  { name: "박서현 (47세)", totalAum: 100, rTarget: 0.08, aRisk: 3, tYear: 2, tTax: 1, lCash: 30 },
  { name: "이재형 (65세)", totalAum: 15000, rTarget: 0.04, aRisk: 5, tYear: 20, tTax: 1, lCash: 12 },
];

const RISK_LABELS = ["", "공격적", "적극적", "중립형", "보수적", "원금보존"];
const RISK_COLORS = ["", "#EF4444", "#F97316", "#EAB308", "#3B82F6", "#6366F1"];

function calcAllocation(totalAum: number, rTarget: number, aRisk: number, tYear: number, tTax: number, lCash: number) {
  const aum = totalAum * 100000000;
  const cash = lCash * 100000000;
  const baseLiq = aum > 0 ? cash / aum : 0;
  const taxPenalty = tTax === 1 ? 0.15 : 0;
  const taxLiq = Math.min(baseLiq + taxPenalty, 0.70);
  const hedgeFloor = aRisk >= 4 ? 0.20 : 0.10;
  const remaining = Math.max(1.0 - taxLiq - hedgeFloor, 0);
  let growthRatio = rTarget / (rTarget + aRisk * MARKET_C);
  if (tYear < 3) growthRatio = Math.min(growthRatio, 0.30);
  const growth = remaining * growthRatio;
  const income = remaining * (1 - growthRatio);
  return {
    taxLiq: Math.round(taxLiq * 100),
    hedge: Math.round(hedgeFloor * 100),
    growth: Math.round(growth * 100),
    income: Math.round(income * 100),
  };
}

// 곽준호 ASSET_RISK_PROXY_TABLE 기반 버킷별 프록시
const BUCKET_PROXY = {
  growth:  { annVol: 0.22, mdd: 0.32 }, // 글로벌주식/성장형 평균
  income:  { annVol: 0.10, mdd: 0.14 }, // 배당·채권 혼합 평균
  hedge:   { annVol: 0.14, mdd: 0.20 }, // 금·대체자산 평균
  taxLiq:  { annVol: 0.02, mdd: 0.03 }, // 단기채·MMF 평균
};

const RISK_FREE_RATE = 0.035; // 곽준호 quantEngine 동일 무위험수익률 3.5%

function getMetrics(alloc: ReturnType<typeof calcAllocation>, rTarget: number) {
  const w = {
    growth:  alloc.growth  / 100,
    income:  alloc.income  / 100,
    hedge:   alloc.hedge   / 100,
    taxLiq:  alloc.taxLiq  / 100,
  };

  // 연환산 변동성 = 자산군별 annVol 가중합 (프록시 기반)
  const vol =
    w.growth  * BUCKET_PROXY.growth.annVol +
    w.income  * BUCKET_PROXY.income.annVol +
    w.hedge   * BUCKET_PROXY.hedge.annVol  +
    w.taxLiq  * BUCKET_PROXY.taxLiq.annVol;

  // 샤프지수 = (기대수익률 - 무위험수익률) / 변동성
  const sharpe = vol > 0 ? ((rTarget - RISK_FREE_RATE) / vol).toFixed(2) : "0.00";

  // MDD = 자산군별 프록시 mdd 가중합
  const mdd =
    w.growth  * BUCKET_PROXY.growth.mdd +
    w.income  * BUCKET_PROXY.income.mdd +
    w.hedge   * BUCKET_PROXY.hedge.mdd  +
    w.taxLiq  * BUCKET_PROXY.taxLiq.mdd;

  return { vol, sharpe, mdd };
}

function getBacktestData(rTarget: number) {
  let existing = 100, newP = 100;
  return Array.from({ length: 6 }, (_, y) => {
    const row = { year: `${2019 + y}년`, 기존: Math.round(existing), 신규: Math.round(newP) };
    existing *= 1.052;
    newP *= 1 + rTarget;
    return row;
  });
}

export default function Tuner() {
  const [totalAum, setTotalAum] = useState(100);
  const [rTarget, setRTarget] = useState(0.08);
  const [aRisk, setARisk] = useState(3);
  const [tYear, setTYear] = useState(5);
  const [tTax, setTTax] = useState(1);
  const [lCash, setLCash] = useState(30);
  const [activePersona, setActivePersona] = useState<number | null>(null);

  function applyPersona(i: number) {
    const p = PERSONAS[i];
    setTotalAum(p.totalAum); setRTarget(p.rTarget); setARisk(p.aRisk);
    setTYear(p.tYear); setTTax(p.tTax); setLCash(p.lCash);
    setActivePersona(i);
  }

  const alloc = calcAllocation(totalAum, rTarget, aRisk, tYear, tTax, lCash);
  const { vol, sharpe, mdd } = getMetrics(alloc, rTarget);
  const backtestData = getBacktestData(rTarget);
  const warnOrange = tYear <= 2 && alloc.growth >= 50;
  const warnRed = alloc.hedge < 10;

  const pieData = [
    { name: "자본 증식", value: alloc.growth, color: "#3B82F6" },
    { name: "인컴 창출", value: alloc.income, color: GOLD },
    { name: "위험 헷지", value: alloc.hedge, color: "#10B981" },
    { name: "절세·유동성", value: alloc.taxLiq, color: "#8B5CF6" },
  ];

  return (
    <div style={{ minHeight: "100vh", background: "#f5f7fa", padding: "32px 24px", fontFamily: "sans-serif" }}>
      <div style={{ maxWidth: 960, margin: "0 auto" }}>
        <h1 style={{ color: NAVY, fontSize: 22, fontWeight: 700, marginBottom: 24 }}>포트폴리오 조율기</h1>

        <div style={{ display: "flex", gap: 10, marginBottom: 24, flexWrap: "wrap" }}>
          {PERSONAS.map((p, i) => (
            <button key={i} onClick={() => applyPersona(i)} style={{
              padding: "8px 16px", borderRadius: 8, border: `2px solid ${activePersona === i ? NAVY : "#e5e7eb"}`,
              background: activePersona === i ? NAVY : "#fff", color: activePersona === i ? "#fff" : "#374151",
              fontWeight: 600, fontSize: 13, cursor: "pointer"
            }}>{p.name}</button>
          ))}
        </div>

        <div className="tuner-layout" style={{ display: "flex", gap: 20, flexWrap: "wrap", marginBottom: 20 }}>
          {/* 입력 */}
          <div style={{ flex: 1, minWidth: 300, background: "#fff", borderRadius: 12, padding: 24, boxShadow: "0 1px 4px rgba(0,0,0,0.06)", border: "1px solid #e5e7eb" }}>
            <div style={{ marginBottom: 20 }}>
              <label style={{ color: NAVY, fontWeight: 600, fontSize: 13, display: "block", marginBottom: 6 }}>운용 자산 총액 (억 원)</label>
              <input type="number" value={totalAum} onChange={e => { setTotalAum(Number(e.target.value)); setActivePersona(null); }}
                style={{ width: "100%", padding: "10px 12px", border: "1px solid #e5e7eb", borderRadius: 8, fontSize: 14, boxSizing: "border-box", background: "#f9fafb" }} />
            </div>
            <div style={{ marginBottom: 20 }}>
              <label style={{ color: NAVY, fontWeight: 600, fontSize: 13, display: "block", marginBottom: 6 }}>
                목표 수익률: <span style={{ color: GOLD }}>{(rTarget * 100).toFixed(0)}%</span>
              </label>
              <input type="range" min={1} max={20} value={Math.round(rTarget * 100)}
                onChange={e => { setRTarget(Number(e.target.value) / 100); setActivePersona(null); }} style={{ width: "100%" }} />
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "#9ca3af" }}><span>1%</span><span>20%</span></div>
            </div>
            <div style={{ marginBottom: 20 }}>
              <label style={{ color: NAVY, fontWeight: 600, fontSize: 13, display: "block", marginBottom: 8 }}>
                위험회피 성향: <span style={{ color: RISK_COLORS[aRisk], fontWeight: 700 }}>{RISK_LABELS[aRisk]}</span>
              </label>
              <div style={{ display: "flex", gap: 6 }}>
                {[1,2,3,4,5].map(v => (
                  <button key={v} onClick={() => { setARisk(v); setActivePersona(null); }} style={{
                    flex: 1, padding: "7px 4px", borderRadius: 7, border: `2px solid ${aRisk === v ? RISK_COLORS[v] : "#e5e7eb"}`,
                    background: aRisk === v ? RISK_COLORS[v] : "#fff", color: aRisk === v ? "#fff" : "#6b7280",
                    fontWeight: 600, fontSize: 11, cursor: "pointer"
                  }}>{RISK_LABELS[v]}</button>
                ))}
              </div>
            </div>
            <div style={{ marginBottom: 20 }}>
              <label style={{ color: NAVY, fontWeight: 600, fontSize: 13, display: "block", marginBottom: 6 }}>
                투자 기간: <span style={{ color: GOLD }}>{tYear}년</span>
                {tYear < 3 && <span style={{ color: "#EF4444", fontSize: 11, marginLeft: 8 }}>※ 자본증식 30% 상한 적용</span>}
              </label>
              <input type="range" min={1} max={30} value={tYear}
                onChange={e => { setTYear(Number(e.target.value)); setActivePersona(null); }} style={{ width: "100%" }} />
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "#9ca3af" }}><span>1년</span><span>30년</span></div>
            </div>
            <div style={{ marginBottom: 20 }}>
              <label style={{ color: NAVY, fontWeight: 600, fontSize: 13, display: "block", marginBottom: 8 }}>금융소득종합과세</label>
              <div style={{ display: "flex", gap: 8 }}>
                {[{ v: 1, label: "대상 (+15%p)" }, { v: 0, label: "비대상" }].map(opt => (
                  <button key={opt.v} onClick={() => { setTTax(opt.v); setActivePersona(null); }} style={{
                    flex: 1, padding: "9px", borderRadius: 8, border: `2px solid ${tTax === opt.v ? NAVY : "#e5e7eb"}`,
                    background: tTax === opt.v ? NAVY : "#fff", color: tTax === opt.v ? "#fff" : "#6b7280",
                    fontWeight: 600, fontSize: 12, cursor: "pointer"
                  }}>{opt.label}</button>
                ))}
              </div>
            </div>
            <div style={{ marginBottom: 8 }}>
              <label style={{ color: NAVY, fontWeight: 600, fontSize: 13, display: "block", marginBottom: 6 }}>유동성 필요 금액 (억 원)</label>
              <input type="number" value={lCash} onChange={e => { setLCash(Number(e.target.value)); setActivePersona(null); }}
                style={{ width: "100%", padding: "10px 12px", border: "1px solid #e5e7eb", borderRadius: 8, fontSize: 14, boxSizing: "border-box", background: "#f9fafb" }} />
            </div>

            {/* 공식 설명 */}
            <div style={{ background: "#f5f3ff", border: "1px solid #e9d5ff", borderRadius: 8, padding: "12px 14px", marginBottom: 16 }}>
              <p style={{ color: "#6d28d9", fontSize: 11, fontWeight: 600, marginBottom: 6 }}>절세 및 유동성 비중 산출 방식</p>
              <p style={{ color: "#7c3aed", fontSize: 11, lineHeight: 1.7, margin: 0 }}>
                기본 유동성 비중 = 유동성 필요 금액 ÷ 운용 자산 총액<br />
                금융소득종합과세 해당자에 한해 절세 목적 비중 15%포인트 가산<br />
                최종 배분 비중은 70%를 초과하지 않도록 상한 적용
              </p>
            </div>

            {warnOrange && (
              <div style={{ background: "#FFF3CD", border: "1px solid #FFC107", borderRadius: 8, padding: "10px 12px", color: "#856404", fontSize: 13, marginBottom: 8 }}>
                ⚠️ 투자기간 2년 이하 + 자본증식 50% 이상 — 고위험 조합
              </div>
            )}
            {warnRed && (
              <div style={{ background: "#FFE0E0", border: "1px solid #EF4444", borderRadius: 8, padding: "10px 12px", color: "#991B1B", fontSize: 13 }}>
                🚨 위험 헷지 10% 미만 — 대체자산 분산 효과 미미
              </div>
            )}
          </div>

          {/* 오른쪽 */}
          <div className="tuner-right" style={{ width: 260, display: "flex", flexDirection: "column", gap: 12 }}>
            {[
              { label: "자본 증식", value: `${alloc.growth}%`, color: "#3B82F6", sub: "성장형 랩/펀드" },
              { label: "인컴 창출", value: `${alloc.income}%`, color: GOLD, sub: "배당·채권형" },
              { label: "위험 헷지", value: `${alloc.hedge}%`, color: "#10B981", sub: "대체자산 (최소 10%)" },
              { label: "절세·유동성", value: `${alloc.taxLiq}%`, color: "#8B5CF6", sub: "단기채·ISA" },
            ].map(m => (
              <div key={m.label} style={{ background: "#fff", borderRadius: 10, padding: "12px 16px", boxShadow: "0 1px 4px rgba(0,0,0,0.06)", border: "1px solid #e5e7eb" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div>
                    <div style={{ color: "#6b7280", fontSize: 11 }}>{m.label}</div>
                    <div style={{ color: "#9ca3af", fontSize: 10 }}>{m.sub}</div>
                  </div>
                  <span style={{ color: m.color, fontSize: 22, fontWeight: 700 }}>{m.value}</span>
                </div>
              </div>
            ))}
            <div style={{ background: "#fff", borderRadius: 10, padding: "14px 16px", boxShadow: "0 1px 4px rgba(0,0,0,0.06)", border: "1px solid #e5e7eb" }}>
              {[
                { label: "기대수익률", value: `${(rTarget * 100).toFixed(1)}%`, color: "#3B82F6" },
                { label: "변동성", value: `${(vol * 100).toFixed(1)}%`, color: GOLD },
                { label: "샤프지수", value: sharpe, color: "#10B981" },
                { label: "MDD", value: `${(mdd * 100).toFixed(1)}%`, color: "#EF4444" },
              ].map(m => (
                <div key={m.label} style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
                  <span style={{ color: "#6b7280", fontSize: 12 }}>{m.label}</span>
                  <span style={{ color: m.color, fontSize: 14, fontWeight: 700 }}>{m.value}</span>
                </div>
              ))}
            </div>
            <div style={{ background: "#fff", borderRadius: 10, padding: 16, boxShadow: "0 1px 4px rgba(0,0,0,0.06)", border: "1px solid #e5e7eb" }}>
              <p style={{ color: NAVY, fontWeight: 600, fontSize: 12, marginBottom: 8 }}>목적 기반 자산 배분</p>
              <ResponsiveContainer width="100%" height={200}>
                <PieChart>
                  <Pie data={pieData} cx="50%" cy="42%" innerRadius={45} outerRadius={68} dataKey="value">
                    {pieData.map((entry, index) => <Cell key={index} fill={entry.color} />)}
                  </Pie>
                  <Tooltip formatter={(value) => `${value}%`} />
                  <Legend iconSize={8} iconType="circle" wrapperStyle={{ fontSize: 10, paddingTop: 4 }} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>

        {/* 백테스팅 */}
        <div style={{ background: "#fff", borderRadius: 12, padding: 24, boxShadow: "0 1px 4px rgba(0,0,0,0.06)", border: "1px solid #e5e7eb" }}>
          <h3 style={{ color: NAVY, fontSize: 15, fontWeight: 700, marginBottom: 20 }}>최근 5년 누적 수익률 비교 (기준: 100)</h3>
          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={backtestData} margin={{ top: 10, right: 30, left: 10, bottom: 10 }}>
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
      </div>
    </div>
  );
} 