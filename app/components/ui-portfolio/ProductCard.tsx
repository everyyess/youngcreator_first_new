"use client";

import { useState } from "react";

const NAVY = "#0D2B5E";
const GOLD = "#C9A84C";

type Product = {
  id: number;
  name: string;
  type: "자본증식" | "인컴창출" | "위험헷지" | "절세·유동성";
  risk: "저위험" | "중위험" | "고위험";
  isa: boolean;
  score: number;
  returnRate: number;
  fee: number;
  aum: number;
  productType: "랩어카운트" | "펀드";
  manager: string;
  description: string;
  taxBenefit: boolean;
};

const allProducts: Product[] = [
  { id: 1, name: "삼성 글로벌 반도체 혁신 랩", type: "자본증식", risk: "고위험", isa: false, score: 95, returnRate: 15.2, fee: 1.2, aum: 8500, productType: "랩어카운트", manager: "삼성증권 PB본부", description: "AI·반도체 밸류체인 집중 투자. 자사주 매매 제한 고객의 간접 투자 솔루션.", taxBenefit: false },
  { id: 2, name: "삼성 글로벌 일류기업 랩", type: "자본증식", risk: "중위험", isa: false, score: 88, returnRate: 9.8, fee: 1.0, aum: 12000, productType: "랩어카운트", manager: "삼성증권 PB본부", description: "나스닥 대형주 중심 PB 일임 운용. 바쁜 전문직을 위한 주도주 자동 리밸런싱.", taxBenefit: false },
  { id: 3, name: "글로벌 배당귀족 펀드", type: "자본증식", risk: "저위험", isa: true, score: 82, returnRate: 6.5, fee: 0.8, aum: 9200, productType: "펀드", manager: "삼성자산운용", description: "선진국 초우량 배당주 편입. 극저변동성으로 물가상승률 방어.", taxBenefit: true },
  { id: 4, name: "글로벌 인프라·리츠 펀드", type: "인컴창출", risk: "중위험", isa: false, score: 90, returnRate: 7.1, fee: 0.9, aum: 7800, productType: "펀드", manager: "삼성자산운용", description: "매월 안정적 현금흐름 창출. 고정비 부담이 큰 전문직 고객의 인컴 솔루션.", taxBenefit: false },
  { id: 5, name: "월지급식 배당 랩", type: "인컴창출", risk: "저위험", isa: true, score: 87, returnRate: 5.8, fee: 1.1, aum: 6500, productType: "랩어카운트", manager: "삼성증권 PB본부", description: "매월 확정 이자 지급. 생활비 현금흐름 목적 고객에 최적화.", taxBenefit: true },
  { id: 6, name: "우량 회사채 매치드 랩", type: "인컴창출", risk: "저위험", isa: false, score: 85, returnRate: 4.8, fee: 0.7, aum: 11000, productType: "랩어카운트", manager: "삼성증권 PB본부", description: "이자 지급 주기를 월 단위로 세팅. 매월 생활비 목적에 최적화.", taxBenefit: false },
  { id: 7, name: "미국 배당성장 펀드", type: "인컴창출", risk: "저위험", isa: true, score: 80, returnRate: 6.2, fee: 0.6, aum: 15000, productType: "펀드", manager: "삼성자산운용", description: "금융소득종합과세 최소화. 배당 상품 소액 편입용.", taxBenefit: true },
  { id: 8, name: "비트코인 현물 ETF 관련 펀드", type: "위험헷지", risk: "고위험", isa: false, score: 78, returnRate: 18.5, fee: 1.5, aum: 3200, productType: "펀드", manager: "삼성자산운용", description: "암호화폐 관심 고객의 제도권 편입 솔루션. 포트폴리오 양성화.", taxBenefit: false },
  { id: 9, name: "미국 달러 단기채 펀드", type: "위험헷지", risk: "저위험", isa: false, score: 86, returnRate: 4.2, fee: 0.5, aum: 9800, productType: "펀드", manager: "삼성자산운용", description: "환율 급등 시 방어막. 외화 자산 선호 고객의 달러 헷지 솔루션.", taxBenefit: false },
  { id: 10, name: "삼성 금 현물 펀드", type: "위험헷지", risk: "저위험", isa: false, score: 83, returnRate: 5.1, fee: 0.4, aum: 7200, productType: "펀드", manager: "삼성자산운용", description: "위기 방어 및 증여 유연성 확보. 무기명 자산 성격의 실물 금 연계.", taxBenefit: false },
  { id: 11, name: "초단기 우량채 펀드 (ISA)", type: "절세·유동성", risk: "저위험", isa: true, score: 92, returnRate: 3.8, fee: 0.2, aum: 22000, productType: "펀드", manager: "삼성자산운용", description: "부동산 매입 시 원금 손실 없이 즉시 현금화 가능. ISA 계좌 절세.", taxBenefit: true },
  { id: 12, name: "미국 국채 2년물 타겟만기 펀드", type: "절세·유동성", risk: "저위험", isa: false, score: 89, returnRate: 4.5, fee: 0.3, aum: 8400, productType: "펀드", manager: "삼성자산운용", description: "2년 뒤 유학비를 달러로 확정. 환율 변동 리스크 원천 차단.", taxBenefit: false },
  { id: 13, name: "장기 국고채 분리과세 랩", type: "절세·유동성", risk: "저위험", isa: false, score: 94, returnRate: 4.1, fee: 0.5, aum: 18000, productType: "랩어카운트", manager: "삼성증권 PB본부", description: "만기 10년 이상 국채 분리과세 신청. 세율 49.5%에서 30%로 합법적 절감.", taxBenefit: true },
  { id: 14, name: "증여 특화 유언대용신탁 연계 랩", type: "절세·유동성", risk: "저위험", isa: false, score: 91, returnRate: 3.5, fee: 0.8, aum: 14000, productType: "랩어카운트", manager: "삼성증권 PB본부", description: "자녀 세대 증여세 절감. 유언대용신탁 연계 자산 이전.", taxBenefit: true },
];

const FILTERS = ["전체", "자본증식", "인컴창출", "위험헷지", "절세·유동성", "랩어카운트", "펀드", "ISA"];
const TYPE_COLORS: Record<string, string> = {
  "자본증식": "#3B82F6", "인컴창출": GOLD, "위험헷지": "#10B981", "절세·유동성": "#8B5CF6"
};

export default function ProductCard() {
  const [activeFilter, setActiveFilter] = useState("전체");
  const [selectedIds, setSelectedIds] = useState<number[]>([]);

  const filtered = allProducts.filter(p => {
    if (activeFilter === "전체") return true;
    if (activeFilter === "ISA") return p.isa;
    if (activeFilter === "랩어카운트") return p.productType === "랩어카운트";
    if (activeFilter === "펀드") return p.productType === "펀드";
    return p.type === activeFilter;
  });

  const top4 = [...filtered].sort((a, b) => b.score - a.score).slice(0, 4);

  function toggleSelect(id: number) {
    setSelectedIds(prev => prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]);
  }

  return (
    <div style={{ minHeight: "100vh", background: "#f1f5f9", padding: "32px 24px", fontFamily: "sans-serif" }}>
      <div style={{ maxWidth: 960, margin: "0 auto" }}>
        <h1 style={{ color: NAVY, fontSize: 22, fontWeight: 700, marginBottom: 8 }}>상품 추천</h1>
        {selectedIds.length > 0 && (
          <div style={{ background: "#EFF6FF", border: "1px solid #BFDBFE", borderRadius: 8, padding: "10px 16px", marginBottom: 16, fontSize: 13, color: NAVY, fontWeight: 600 }}>
            선택된 상품 {selectedIds.length}개 — {allProducts.filter(p => selectedIds.includes(p.id)).map(p => p.name).join(", ")}
          </div>
        )}

        <div style={{ display: "flex", gap: 8, marginBottom: 28, flexWrap: "wrap" }}>
          {FILTERS.map(f => (
            <button key={f} onClick={() => setActiveFilter(f)} style={{
              padding: "7px 14px", borderRadius: 20, border: "none", cursor: "pointer", fontWeight: 600, fontSize: 12,
              background: activeFilter === f ? NAVY : "#fff",
              color: activeFilter === f ? "#fff" : "#6b7280",
              boxShadow: "0 1px 3px rgba(0,0,0,0.08)"
            }}>{f}</button>
          ))}
        </div>

        <div className="product-grid" style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16 }}>
          {top4.map((p, i) => {
            const isSelected = selectedIds.includes(p.id);
            return (
              <div key={p.id} onClick={() => toggleSelect(p.id)} style={{
                background: "#fff", borderRadius: 12, padding: 20,
                boxShadow: isSelected ? `0 0 0 2px ${GOLD}, 0 4px 12px rgba(0,0,0,0.1)` : "0 1px 4px rgba(0,0,0,0.06)",
                border: isSelected ? `2px solid ${GOLD}` : "1px solid #e5e7eb",
                borderTop: `3px solid ${i === 0 ? GOLD : TYPE_COLORS[p.type] || NAVY}`,
                display: "flex", flexDirection: "column", cursor: "pointer",
                transition: "all 0.15s"
              }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                  <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                    <span style={{ background: i === 0 ? GOLD : NAVY, color: "#fff", borderRadius: 20, padding: "2px 10px", fontSize: 11, fontWeight: 700 }}>TOP {i + 1}</span>
                    {isSelected && <span style={{ background: GOLD, color: "#fff", borderRadius: 20, padding: "2px 8px", fontSize: 10, fontWeight: 700 }}>✓ 선택</span>}
                  </div>
                  <div style={{ display: "flex", gap: 4 }}>
                    <span style={{ background: TYPE_COLORS[p.type] + "20", color: TYPE_COLORS[p.type], borderRadius: 20, padding: "2px 8px", fontSize: 10, fontWeight: 600 }}>{p.type}</span>
                    {p.isa && <span style={{ background: "#EFF6FF", color: NAVY, borderRadius: 20, padding: "2px 6px", fontSize: 10, fontWeight: 600 }}>ISA</span>}
                  </div>
                </div>

                <div style={{ color: NAVY, fontWeight: 700, fontSize: 13, marginBottom: 4, lineHeight: 1.4 }}>{p.name}</div>
                <div style={{ color: "#9ca3af", fontSize: 10, marginBottom: 8 }}>{p.productType} · {p.manager}</div>
                <div style={{ color: "#6b7280", fontSize: 11, marginBottom: 12, lineHeight: 1.6, flexGrow: 1 }}>{p.description}</div>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, marginBottom: 10 }}>
                  {[
                    { label: "기대수익", value: `${p.returnRate}%`, color: "#10B981" },
                    { label: "수수료", value: `${p.fee}%`, color: NAVY },
                    { label: "위험등급", value: p.risk, color: p.risk === "고위험" ? "#EF4444" : p.risk === "중위험" ? GOLD : "#10B981" },
                    { label: "AUM(억)", value: p.aum.toLocaleString(), color: NAVY },
                  ].map(m => (
                    <div key={m.label} style={{ background: "#f9fafb", borderRadius: 6, padding: "6px 8px" }}>
                      <div style={{ color: "#9ca3af", fontSize: 10, marginBottom: 2 }}>{m.label}</div>
                      <div style={{ color: m.color, fontWeight: 700, fontSize: 12 }}>{m.value}</div>
                    </div>
                  ))}
                </div>

                {p.taxBenefit && (
                  <div style={{ background: "#F0FDF4", color: "#16a34a", borderRadius: 6, padding: "4px 8px", fontSize: 10, fontWeight: 600, marginBottom: 10 }}>
                    ✓ 세제 혜택 상품
                  </div>
                )}
                {!p.taxBenefit && <div style={{ height: 26, marginBottom: 10 }} />}

                <div style={{ color: NAVY, fontWeight: 700, fontSize: 15, marginBottom: 12 }}>스코어 {p.score}</div>

                <button onClick={(e) => { e.stopPropagation(); window.open("https://www.samsungpop.com", "_blank"); }}
                  style={{ width: "100%", padding: "10px", background: isSelected ? GOLD : NAVY, color: "#fff", border: "none", borderRadius: 8, cursor: "pointer", fontWeight: 600, fontSize: 12, marginTop: "auto", transition: "background 0.15s" }}>
                  약관 다운로드
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}