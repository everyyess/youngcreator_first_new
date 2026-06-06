"use client";

import { useState } from "react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";

const NAVY = "#0D2B5E";
const GOLD = "#C9A84C";

const scenarios = [
  { id: "rate", label: "금리인상 100bp", detail: "채권 가격 급락, 성장주 하락. 2022년 연준 긴축 사이클 참조.", ref: "2022 금리인상기 (S&P500 -25.4%)", existing: -8.2, newP: -4.1, hedge: "장기채 손실 / 금·달러 상승" },
  { id: "commodity", label: "원자재 인플레", detail: "금·원자재 상승, 주식 하락. 2022년 에너지 위기 참조.", ref: "2022 인플레이션 충격", existing: -12.5, newP: -6.3, hedge: "원자재·금 상승 / 채권 혼조" },
  { id: "fx", label: "환율급등 +200원", detail: "환노출 해외주식 평가익 상승, 국내 주식 하락.", ref: "2022~2023 달러 강세 구간", existing: -9.8, newP: -5.2, hedge: "달러 자산 평가익 / 국내주식 하락" },
];

const crisisHistory = [
  { event: "닷컴 버블", period: "2000~2002", mdd: -49.1, color: "#EF4444" },
  { event: "금융위기", period: "2007~2009", mdd: -56.8, color: "#DC2626" },
  { event: "코로나19", period: "2020.02~03", mdd: -33.9, color: "#F97316" },
  { event: "금리인상기", period: "2022", mdd: -25.4, color: "#EAB308" },
];

export default function StressChart() {
  const [selected, setSelected] = useState<string[]>(["rate", "commodity", "fx"]);

  function toggle(id: string) {
    setSelected(prev => prev.includes(id) ? prev.filter(s => s !== id) : [...prev, id]);
  }

  const filtered = scenarios.filter(s => selected.includes(s.id));
  const chartData = filtered.map(s => ({
    label: s.label,
    기존포트폴리오: s.existing,
    신규포트폴리오: s.newP,
  }));

  return (
    <div style={{ minHeight: "100vh", background: "#f5f7fa", padding: "32px 24px", fontFamily: "sans-serif" }}>
      <div style={{ maxWidth: 960, margin: "0 auto" }}>
        <h1 style={{ color: NAVY, fontSize: 22, fontWeight: 700, marginBottom: 24 }}>스트레스 테스트</h1>

        <div style={{ display: "flex", gap: 10, marginBottom: 24, flexWrap: "wrap" }}>
          {scenarios.map(s => (
            <button key={s.id} onClick={() => toggle(s.id)} style={{
              padding: "10px 18px", borderRadius: 8, cursor: "pointer", fontWeight: 600, fontSize: 13,
              border: `2px solid ${selected.includes(s.id) ? NAVY : "#e5e7eb"}`,
              background: selected.includes(s.id) ? NAVY : "#fff",
              color: selected.includes(s.id) ? "#fff" : "#6b7280",
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
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={chartData} margin={{ top: 20, right: 30, left: 20, bottom: 20 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="label" tick={{ fontSize: 12 }} />
                  <YAxis tickFormatter={(v: number) => `${v}%`} tick={{ fontSize: 12 }} />
                  <Tooltip formatter={(v: number) => `${v}%`} />
                  <Legend />
                  <Bar dataKey="기존포트폴리오" fill={NAVY} name="기존 포트폴리오" />
                  <Bar dataKey="신규포트폴리오" fill={GOLD} name="신규 포트폴리오" />
                </BarChart>
              </ResponsiveContainer>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: `repeat(${filtered.length}, 1fr)`, gap: 16, marginBottom: 24 }}>
              {filtered.map(s => (
                <div key={s.id} style={{ background: "#fff", borderRadius: 10, padding: 20, border: "1px solid #e5e7eb", borderLeft: `3px solid ${NAVY}` }}>
                  <div style={{ color: NAVY, fontWeight: 700, fontSize: 14, marginBottom: 4 }}>{s.label}</div>
                  <div style={{ color: "#6b7280", fontSize: 11, marginBottom: 8, lineHeight: 1.5 }}>{s.detail}</div>
                  <div style={{ color: "#9ca3af", fontSize: 10, marginBottom: 12, background: "#f9fafb", borderRadius: 6, padding: "4px 8px" }}>참조: {s.ref}</div>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                    <span style={{ color: "#6b7280", fontSize: 12 }}>기존</span>
                    <span style={{ color: "#EF4444", fontWeight: 700, fontSize: 14 }}>{s.existing}%</span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10 }}>
                    <span style={{ color: "#6b7280", fontSize: 12 }}>신규</span>
                    <span style={{ color: "#10B981", fontWeight: 700, fontSize: 14 }}>{s.newP}%</span>
                  </div>
                  <div style={{ background: "#f0fdf4", borderRadius: 6, padding: "6px 10px", fontSize: 11, color: "#16a34a" }}>
                    헷지 반응: {s.hedge}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}

        <div style={{ background: "#fff", borderRadius: 12, padding: 24, boxShadow: "0 1px 4px rgba(0,0,0,0.06)", border: "1px solid #e5e7eb" }}>
          <p style={{ color: NAVY, fontWeight: 600, fontSize: 14, marginBottom: 4 }}>역사적 위기 이벤트 참조</p>
          <p style={{ color: "#9ca3af", fontSize: 11, marginBottom: 20 }}>충격 계수 산출 근거 (S&P500 기준 MDD)</p>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12 }}>
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