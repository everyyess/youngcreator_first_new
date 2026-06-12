"use client";

import { useState } from "react";
import Tuner from "../components/ui-portfolio/Tuner";
import ProductCard from "../components/ui-portfolio/ProductCard";
import StressChart from "../components/ui-portfolio/StressChart";
import Compare from "../components/ui-portfolio/Compare";

const NAVY = "#0D2B5E";
const GOLD = "#C9A84C";

const tabs = [
  { id: "tuner", label: "포트폴리오 조율기", desc: "투자 조건 설정" },
  { id: "products", label: "상품 추천", desc: "TOP 4 상품 추천" },
  { id: "stress", label: "스트레스 테스트", desc: "시나리오 분석" },
  { id: "compare", label: "포트폴리오 비교", desc: "기존안과 신규안 비교" },
];

export default function DashboardPage() {
  const [activeTab, setActiveTab] = useState("tuner");
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  return (
    <div style={{ minHeight: "100vh", background: "#f1f5f9", fontFamily: "sans-serif" }}>

      {/* 모바일 상단 네비 */}
      <div style={{ display: "none", background: "#fff", borderBottom: "1px solid #e2e8f0", padding: "12px 16px", position: "sticky", top: 0, zIndex: 50 }} className="mobile-nav">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ color: NAVY, fontWeight: 700, fontSize: 14 }}>
            {tabs.findIndex(t => t.id === activeTab) + 1}. {tabs.find(t => t.id === activeTab)?.label}
          </span>
          <button onClick={() => setMobileMenuOpen(!mobileMenuOpen)} style={{
            background: "none", border: "1px solid #e2e8f0", borderRadius: 6, padding: "6px 10px",
            cursor: "pointer", fontSize: 12, color: NAVY, fontWeight: 600
          }}>
            {mobileMenuOpen ? "닫기" : "메뉴"}
          </button>
        </div>
        {mobileMenuOpen && (
          <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 6 }}>
            {tabs.map((tab, i) => (
              <button key={tab.id} onClick={() => { setActiveTab(tab.id); setMobileMenuOpen(false); }} style={{
                padding: "10px 12px", border: "none", cursor: "pointer", textAlign: "left", borderRadius: 8,
                background: activeTab === tab.id ? "#2f2f9d" : "#f8fafc", fontWeight: 700, fontSize: 13,
                color: activeTab === tab.id ? "#fff" : "#475569"
              }}>
                {i + 1}. {tab.label}
              </button>
            ))}
          </div>
        )}
      </div>

      <div style={{ display: "flex" }}>
        {/* 데스크탑 사이드바 */}
        <nav style={{
          width: 176, minHeight: "100vh", background: "#fff",
          borderRight: "1px solid #e2e8f0", padding: "8px",
          flexShrink: 0, display: "flex", flexDirection: "column", gap: 8,
          position: "sticky", top: 0, height: "100vh"
        }} className="desktop-nav">
        
        {tabs.map((tab, i) => (
            <button key={tab.id} onClick={() => setActiveTab(tab.id)} style={{
              padding: "10px 12px", border: "none", cursor: "pointer",
              textAlign: "left", borderRadius: 8, minHeight: 44,
              background: activeTab === tab.id ? "#2f2f9d" : "#f8fafc",
              transition: "all 0.15s"
            }}>     
              <span style={{
                display: "block", fontSize: 13, fontWeight: 700,
                color: activeTab === tab.id ? "#fff" : "#475569"
              }}>
                {i + 1}. {tab.label}
              </span>
            </button>
          ))}
        </nav>

        {/* 콘텐츠 */}
        <div style={{ flex: 1, minWidth: 0 }}>
          {activeTab === "tuner" && <Tuner />}
          {activeTab === "products" && <ProductCard />}
          {activeTab === "stress" && <StressChart />}
          {activeTab === "compare" && <Compare />}
        </div>
      </div>

      <style>{`
        @media (max-width: 768px) {
          .mobile-nav { display: block !important; }
          .desktop-nav { display: none !important; }
        }
      `}</style>
    </div>
  );
}