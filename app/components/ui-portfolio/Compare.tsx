"use client";

import { useRef } from "react";

const NAVY = "#0D2B5E";
const GOLD = "#C9A84C";

const existing = {
  name: "기존 포트폴리오",
  return: "5.2%",
  volatility: "12.3%",
  sharpe: "0.18",
  mdd: "18.5%",
  assets: [
    { name: "국내주식", ratio: 40 },
    { name: "해외주식", ratio: 20 },
    { name: "채권", ratio: 30 },
    { name: "현금", ratio: 10 },
  ],
};

const newPortfolio = {
  name: "신규 포트폴리오",
  return: "7.8%",
  volatility: "10.8%",
  sharpe: "0.44",
  mdd: "15.6%",
  assets: [
    { name: "국내주식", ratio: 25 },
    { name: "해외주식", ratio: 35 },
    { name: "채권", ratio: 25 },
    { name: "배당ETF", ratio: 15 },
  ],
};

export default function Compare() {
  const printRef = useRef<HTMLDivElement>(null);

  async function handlePDF() {
    const html2canvas = (await import("html2canvas")).default;
    const jsPDF = (await import("jspdf")).default;
    if (!printRef.current) return;
    const canvas = await html2canvas(printRef.current, { scale: 2 });
    const imgData = canvas.toDataURL("image/png");
    const pdf = new jsPDF({ orientation: "landscape", unit: "px", format: [canvas.width, canvas.height] });
    pdf.addImage(imgData, "PNG", 0, 0, canvas.width, canvas.height);
    pdf.save("포트폴리오_비교.pdf");
  }

  return (
    <div style={{ minHeight: "100vh", background: "#f5f7fa", padding: "40px 24px", fontFamily: "sans-serif" }}>
      <div style={{ maxWidth: 960, margin: "0 auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 32 }}>
          <div>
            <h1 style={{ color: NAVY, fontSize: 28, fontWeight: 700, marginBottom: 8 }}>포트폴리오 비교</h1>
            <p style={{ color: "#666" }}>기존과 신규 포트폴리오를 나란히 비교합니다.</p>
          </div>
          <button onClick={handlePDF}
            style={{ padding: "12px 24px", background: NAVY, color: "#fff", border: "none", borderRadius: 10, cursor: "pointer", fontWeight: 700, fontSize: 14 }}>
            PDF 저장
          </button>
        </div>

        <div ref={printRef} style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24 }}>
          {[existing, newPortfolio].map((p, i) => (
            <div key={p.name} style={{ background: "#fff", borderRadius: 14, padding: 28, boxShadow: "0 2px 12px rgba(0,0,0,0.08)", borderTop: `4px solid ${i === 0 ? "#94a3b8" : GOLD}` }}>
              <h2 style={{ color: NAVY, fontSize: 20, fontWeight: 700, marginBottom: 24 }}>{p.name}</h2>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 24 }}>
                {[
                  { label: "기대수익률", value: p.return, color: "#3B82F6" },
                  { label: "변동성", value: p.volatility, color: GOLD },
                  { label: "샤프지수", value: p.sharpe, color: "#10B981" },
                  { label: "MDD", value: p.mdd, color: "#EF4444" },
                ].map(m => (
                  <div key={m.label} style={{ background: "#f8f9fa", borderRadius: 10, padding: "14px 16px", textAlign: "center" }}>
                    <div style={{ color: "#888", fontSize: 12, marginBottom: 4 }}>{m.label}</div>
                    <div style={{ color: m.color, fontSize: 22, fontWeight: 700 }}>{m.value}</div>
                  </div>
                ))}
              </div>

              <div>
                <div style={{ color: NAVY, fontWeight: 600, marginBottom: 12 }}>자산 배분</div>
                {p.assets.map(a => (
                  <div key={a.name} style={{ marginBottom: 10 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4, fontSize: 13, color: "#555" }}>
                      <span>{a.name}</span><span style={{ fontWeight: 700 }}>{a.ratio}%</span>
                    </div>
                    <div style={{ background: "#e9ecef", borderRadius: 4, height: 8 }}>
                      <div style={{ width: `${a.ratio}%`, height: "100%", background: i === 0 ? NAVY : GOLD, borderRadius: 4 }} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}