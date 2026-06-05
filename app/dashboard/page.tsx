"use client";

import { useState } from "react";
import Tuner from "../components/ui-portfolio/Tuner";
import ProductCard from "../components/ui-portfolio/ProductCard";
import StressChart from "../components/ui-portfolio/StressChart";
import Compare from "../components/ui-portfolio/Compare";

const NAVY = "#0D2B5E";
const GOLD = "#C9A84C";

const tabs = [
  { id: "tuner", label: "포트폴리오 조율기" },
  { id: "products", label: "상품 추천" },
  { id: "stress", label: "스트레스 테스트" },
  { id: "compare", label: "포트폴리오 비교" },
];

export default function DashboardPage() {
  const [activeTab, setActiveTab] = useState("tuner");

  return (
    <div style={{ minHeight: "100vh", background: "#f5f7fa", fontFamily: "sans-serif" }}>
      <div style={{ background: NAVY, padding: "0 24px" }}>
        <div style={{ maxWidth: 960, margin: "0 auto", display: "flex", gap: 4 }}>
          {tabs.map(tab => (
            <button key={tab.id} onClick={() => setActiveTab(tab.id)}
              style={{
                padding: "16px 20px", border: "none", cursor: "pointer", fontWeight: 600, fontSize: 14,
                background: activeTab === tab.id ? GOLD : "transparent",
                color: activeTab === tab.id ? NAVY : "#fff",
                borderRadius: "8px 8px 0 0",
              }}>
              {tab.label}
            </button>
          ))}
        </div>
      </div>
      <div>
        {activeTab === "tuner" && <Tuner />}
        {activeTab === "products" && <ProductCard />}
        {activeTab === "stress" && <StressChart />}
        {activeTab === "compare" && <Compare />}
      </div>
    </div>
  );
}