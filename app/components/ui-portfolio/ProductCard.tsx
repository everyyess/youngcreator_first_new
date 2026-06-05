"use client";

import { useState } from "react";

const NAVY = "#0D2B5E";
const GOLD = "#C9A84C";

const allProducts = [
  { id: 1, name: "삼성 글로벌 배당 ETF", type: "배당", risk: "저위험", isa: true, score: 92, return: 7.2, fee: 0.15 },
  { id: 2, name: "미국 S&P500 인덱스 펀드", type: "성장", risk: "중위험", isa: false, score: 88, return: 11.3, fee: 0.05 },
  { id: 3, name: "국내 채권형 펀드", type: "안전", risk: "저위험", isa: true, score: 85, return: 3.8, fee: 0.3 },
  { id: 4, name: "글로벌 리츠 펀드", type: "배당", risk: "중위험", isa: false, score: 83, return: 6.5, fee: 0.45 },
  { id: 5, name: "한국 중소형 성장주 펀드", type: "성장", risk: "고위험", isa: true, score: 78, return: 14.2, fee: 0.8 },
  { id: 6, name: "달러 MMF", type: "안전", risk: "저위험", isa: false, score: 76, return: 2.1, fee: 0.1 },
  { id: 7, name: "유럽 배당주 ETF", type: "배당", risk: "저위험", isa: true, score: 74, return: 5.8, fee: 0.25 },
  { id: 8, name: "나스닥100 레버리지 ETF", type: "성장", risk: "고위험", isa: false, score: 71, return: 22.1, fee: 0.6 },
  { id: 9, name: "국내 우량채 ETF", type: "안전", risk: "저위험", isa: true, score: 69, return: 3.2, fee: 0.12 },
  { id: 10, name: "아시아 신흥국 펀드", type: "성장", risk: "고위험", isa: false, score: 67, return: 9.8, fee: 0.9 },
  { id: 11, name: "글로벌 인프라 펀드", type: "배당", risk: "중위험", isa: true, score: 65, return: 5.1, fee: 0.55 },
  { id: 12, name: "단기 국공채 펀드", type: "안전", risk: "저위험", isa: false, score: 63, return: 2.8, fee: 0.08 },
  { id: 13, name: "헬스케어 섹터 ETF", type: "성장", risk: "중위험", isa: true, score: 61, return: 8.4, fee: 0.4 },
  { id: 14, name: "미국 리츠 ETF", type: "배당", risk: "중위험", isa: false, score: 59, return: 6.1, fee: 0.35 },
  { id: 15, name: "원자재 혼합 펀드", type: "성장", risk: "고위험", isa: true, score: 57, return: 10.2, fee: 0.7 },
  { id: 16, name: "채권혼합형 밸런스 펀드", type: "안전", risk: "저위험", isa: false, score: 55, return: 4.1, fee: 0.2 },
  { id: 17, name: "일본 배당주 펀드", type: "배당", risk: "중위험", isa: true, score: 53, return: 4.8, fee: 0.5 },
  { id: 18, name: "중국 본토 A주 펀드", type: "성장", risk: "고위험", isa: false, score: 51, return: 12.3, fee: 1.0 },
  { id: 19, name: "ESG 글로벌 펀드", type: "성장", risk: "중위험", isa: true, score: 49, return: 7.9, fee: 0.45 },
  { id: 20, name: "단기 회사채 ETF", type: "안전", risk: "저위험", isa: false, score: 47, return: 3.5, fee: 0.18 },
];

const FILTERS = ["전체", "ISA", "저위험", "배당", "성장"];

export default function ProductCard() {
  const [activeFilter, setActiveFilter] = useState("전체");

  const filtered = allProducts.filter(p => {
    if (activeFilter === "전체") return true;
    if (activeFilter === "ISA") return p.isa;
    if (activeFilter === "저위험") return p.risk === "저위험";
    if (activeFilter === "배당") return p.type === "배당";
    if (activeFilter === "성장") return p.type === "성장";
    return true;
  });

  const top4 = [...filtered].sort((a, b) => b.score - a.score).slice(0, 4);

  return (
    <div style={{ minHeight: "100vh", background: "#f5f7fa", padding: "40px 24px", fontFamily: "sans-serif" }}>
      <div style={{ maxWidth: 900, margin: "0 auto" }}>
        <h1 style={{ color: NAVY, fontSize: 28, fontWeight: 700, marginBottom: 8 }}>상품 추천</h1>
        <p style={{ color: "#666", marginBottom: 24 }}>고객 성향에 맞는 TOP 4 상품을 추천합니다.</p>

        <div style={{ display: "flex", gap: 8, marginBottom: 32, flexWrap: "wrap" }}>
          {FILTERS.map(f => (
            <button key={f} onClick={() => setActiveFilter(f)}
              style={{
                padding: "8px 20px", borderRadius: 20, border: "none", cursor: "pointer", fontWeight: 600, fontSize: 14,
                background: activeFilter === f ? NAVY : "#fff",
                color: activeFilter === f ? "#fff" : NAVY,
                boxShadow: "0 2px 6px rgba(0,0,0,0.08)"
              }}>
              {f}
            </button>
          ))}
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 20 }}>
          {top4.map((p, i) => (
            <div key={p.id} style={{ background: "#fff", borderRadius: 14, padding: 24, boxShadow: "0 2px 12px rgba(0,0,0,0.08)", borderTop: `4px solid ${i === 0 ? GOLD : NAVY}` }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                <span style={{ background: i === 0 ? GOLD : NAVY, color: "#fff", borderRadius: 20, padding: "2px 10px", fontSize: 12, fontWeight: 700 }}>
                  TOP {i + 1}
                </span>
                {p.isa && <span style={{ background: "#E8F4FF", color: "#0D2B5E", borderRadius: 20, padding: "2px 10px", fontSize: 11, fontWeight: 600 }}>ISA</span>}
              </div>
              <div style={{ color: NAVY, fontWeight: 700, fontSize: 15, marginBottom: 8, lineHeight: 1.4 }}>{p.name}</div>
              <div style={{ color: "#888", fontSize: 13, marginBottom: 4 }}>유형: {p.type} · {p.risk}</div>
              <div style={{ color: "#888", fontSize: 13, marginBottom: 4 }}>기대수익: <span style={{ color: "#10B981", fontWeight: 700 }}>{p.return}%</span></div>
              <div style={{ color: "#888", fontSize: 13, marginBottom: 16 }}>수수료: {p.fee}%</div>
              <div style={{ color: NAVY, fontWeight: 700, fontSize: 18, marginBottom: 16 }}>스코어 {p.score}</div>
              <button
                onClick={() => alert(`${p.name} 약관 다운로드 (더미)`)}
                style={{ width: "100%", padding: "10px", background: NAVY, color: "#fff", border: "none", borderRadius: 8, cursor: "pointer", fontWeight: 600, fontSize: 13 }}>
                약관 다운로드
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}