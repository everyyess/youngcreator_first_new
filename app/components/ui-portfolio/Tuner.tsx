"use client";

import React, { useState } from "react";

const NAVY = "#0D2B5E";
const GOLD = "#C9A84C";

export default function Tuner() {
  const [amount, setAmount] = useState("");
  const [years, setYears] = useState(10);
  const [growth, setGrowth] = useState(40);
  const [income, setIncome] = useState(40);
  const [safe, setSafe] = useState(20);

  const er = (growth * 0.12 + income * 0.06 + safe * 0.03) / 100;
  const vol = (growth * 0.18 + income * 0.08 + safe * 0.02) / 100;
  const sharpe = vol > 0 ? ((er - 0.03) / vol).toFixed(2) : "0.00";
  const mdd = (growth * 0.25 + income * 0.12 + safe * 0.04) / 100;

  const warnOrange = years <= 2 && growth >= 50;
  const warnRed = safe < 10;

  function handleGrowth(v: number) {
    const rem = 100 - v;
    const tot = income + safe;
    if (tot === 0) { setGrowth(v); setIncome(50); setSafe(50); return; }
    const ni = Math.round((income / tot) * rem);
    setGrowth(v); setIncome(ni); setSafe(rem - ni);
  }

  function handleIncome(v: number) {
    const rem = 100 - v;
    const tot = growth + safe;
    if (tot === 0) { setIncome(v); setGrowth(50); setSafe(50); return; }
    const ng = Math.round((growth / tot) * rem);
    setIncome(v); setGrowth(ng); setSafe(rem - ng);
  }

  function handleSafe(v: number) {
    const rem = 100 - v;
    const tot = growth + income;
    if (tot === 0) { setSafe(v); setGrowth(50); setIncome(50); return; }
    const ng = Math.round((growth / tot) * rem);
    setSafe(v); setGrowth(ng); setIncome(rem - ng);
  }

  return (
    <div style={{ minHeight: "100vh", background: "#f5f7fa", padding: "40px 24px", fontFamily: "sans-serif" }}>
      <div style={{ maxWidth: 900, margin: "0 auto" }}>
        <h1 style={{ color: NAVY, fontSize: 28, fontWeight: 700, marginBottom: 8 }}>포트폴리오 조율기</h1>
        <p style={{ color: "#666", marginBottom: 32 }}>투자 조건을 설정하면 실시간으로 지표를 계산합니다.</p>
        <div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
          <div style={{ flex: 1, minWidth: 300, background: "#fff", borderRadius: 12, padding: 28, boxShadow: "0 2px 8px rgba(0,0,0,0.08)" }}>
            <div style={{ marginBottom: 24 }}>
              <label style={{ color: NAVY, fontWeight: 600, display: "block", marginBottom: 8 }}>투자 금액 (원)</label>
              <input type="text" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="예: 100,000,000"
                style={{ width: "100%", padding: "10px 14px", border: "1.5px solid #ddd", borderRadius: 8, fontSize: 15, boxSizing: "border-box" }} />
            </div>
            <div style={{ marginBottom: 24 }}>
              <label style={{ color: NAVY, fontWeight: 600, display: "block", marginBottom: 8 }}>
                투자 기간: <span style={{ color: GOLD }}>{years}년</span>
              </label>
              <input type="range" min={1} max={20} value={years} onChange={(e) => setYears(Number(e.target.value))} style={{ width: "100%" }} />
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "#999" }}>
                <span>1년</span><span>20년</span>
              </div>
            </div>
            <div style={{ marginBottom: 20 }}>
              <label style={{ color: NAVY, fontWeight: 600, display: "block", marginBottom: 8 }}>
                성장 자산: <span style={{ color: "#3B82F6" }}>{growth}%</span>
              </label>
              <input type="range" min={0} max={100} value={growth} onChange={(e) => handleGrowth(Number(e.target.value))} style={{ width: "100%" }} />
            </div>
            <div style={{ marginBottom: 20 }}>
              <label style={{ color: NAVY, fontWeight: 600, display: "block", marginBottom: 8 }}>
                인컴 자산: <span style={{ color: GOLD }}>{income}%</span>
              </label>
              <input type="range" min={0} max={100} value={income} onChange={(e) => handleIncome(Number(e.target.value))} style={{ width: "100%" }} />
            </div>
            <div style={{ marginBottom: 20 }}>
              <label style={{ color: NAVY, fontWeight: 600, display: "block", marginBottom: 8 }}>
                안전 자산: <span style={{ color: "#10B981" }}>{safe}%</span>
              </label>
              <input type="range" min={0} max={100} value={safe} onChange={(e) => handleSafe(Number(e.target.value))} style={{ width: "100%" }} />
            </div>
            {warnOrange && (
              <div style={{ background: "#FFF3CD", border: "1px solid #FFC107", borderRadius: 8, padding: "10px 14px", color: "#856404", marginTop: 8 }}>
                ⚠️ 투자기간 2년 이하 + 성장 50% 이상은 고위험 조합입니다.
              </div>
            )}
            {warnRed && (
              <div style={{ background: "#FFE0E0", border: "1px solid #EF4444", borderRadius: 8, padding: "10px 14px", color: "#991B1B", marginTop: 8 }}>
                🚨 안전 자산 10% 미만은 매우 위험합니다.
              </div>
            )}
          </div>
          <div style={{ width: 240, display: "flex", flexDirection: "column", gap: 16 }}>
            {[
              { label: "기대수익률", value: `${(er * 100).toFixed(1)}%`, color: "#3B82F6" },
              { label: "변동성", value: `${(vol * 100).toFixed(1)}%`, color: GOLD },
              { label: "샤프지수", value: sharpe, color: "#10B981" },
              { label: "MDD", value: `${(mdd * 100).toFixed(1)}%`, color: "#EF4444" },
            ].map((m) => (
              <div key={m.label} style={{ background: "#fff", borderRadius: 12, padding: "20px 24px", boxShadow: "0 2px 8px rgba(0,0,0,0.08)", textAlign: "center" }}>
                <div style={{ color: "#888", fontSize: 13, marginBottom: 6 }}>{m.label}</div>
                <div style={{ color: m.color, fontSize: 28, fontWeight: 700 }}>{m.value}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}