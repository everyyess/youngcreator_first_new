"use client";

import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";

const NAVY = "#0D2B5E";
const GOLD = "#C9A84C";

const data = [
  { scenario: "금리인상", 기존포트폴리오: -8.2, 신규포트폴리오: -4.1 },
  { scenario: "원자재인플레", 기존포트폴리오: -12.5, 신규포트폴리오: -6.3 },
  { scenario: "환율급등", 기존포트폴리오: -9.8, 신규포트폴리오: -5.2 },
];

export default function StressChart() {
  return (
    <div style={{ minHeight: "100vh", background: "#f5f7fa", padding: "40px 24px", fontFamily: "sans-serif" }}>
      <div style={{ maxWidth: 900, margin: "0 auto" }}>
        <h1 style={{ color: NAVY, fontSize: 28, fontWeight: 700, marginBottom: 8 }}>스트레스 테스트</h1>
        <p style={{ color: "#666", marginBottom: 32 }}>3가지 시나리오에서 포트폴리오 손실을 시뮬레이션합니다.</p>

        <div style={{ background: "#fff", borderRadius: 14, padding: 32, boxShadow: "0 2px 12px rgba(0,0,0,0.08)" }}>
          <ResponsiveContainer width="100%" height={380}>
            <BarChart data={data} margin={{ top: 20, right: 30, left: 20, bottom: 20 }}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="scenario" />
              <YAxis tickFormatter={(v) => `${v}%`} />
              <Tooltip formatter={(value) => `${value}%`} />
              <Legend />
              <Bar dataKey="기존포트폴리오" fill={NAVY} radius={[4, 4, 0, 0]} />
              <Bar dataKey="신규포트폴리오" fill={GOLD} radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>

          <div style={{ marginTop: 32, display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16 }}>
            {data.map(d => (
              <div key={d.scenario} style={{ background: "#f8f9fa", borderRadius: 10, padding: 20, borderLeft: `4px solid ${NAVY}` }}>
                <div style={{ color: NAVY, fontWeight: 700, fontSize: 15, marginBottom: 12 }}>{d.scenario}</div>
                <div style={{ color: "#666", fontSize: 13, marginBottom: 4 }}>
                  기존: <span style={{ color: "#EF4444", fontWeight: 700 }}>{d.기존포트폴리오}%</span>
                </div>
                <div style={{ color: "#666", fontSize: 13 }}>
                  신규: <span style={{ color: "#10B981", fontWeight: 700 }}>{d.신규포트폴리오}%</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}