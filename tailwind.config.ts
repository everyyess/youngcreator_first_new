import type { Config } from "tailwindcss";

// ─────────────────────────────────────────────────────────────────────────────
// 삼성증권 브랜드 컬러 (로컬 테마 실험 — Vercel 배포 대상 아님)
//   Primary   : 0/60/220 계열 (SS Blue)
//   Secondary : SS Blue / Magenta / Abundant Spectrum
// blue 스케일 자체를 삼성 팔레트로 덮어써서, 앱 전역의 blue-600/blue-700 등
// 하드코딩 클래스가 한 번에 삼성 파란색으로 바뀌도록 한다.
// ─────────────────────────────────────────────────────────────────────────────

const ssBlue = {
  50: "#EEF2FE",
  100: "#DEE5FB",
  200: "#CBD1E8", // 203/209/232
  300: "#99B1F1", // 153/177/241
  400: "#668AE0", // 102/138/224
  500: "#3363E3", // 51/99/227
  600: "#003CDC", // 0/60/220  ← 대표 브랜드
  700: "#0A2FA8",
  800: "#141E78", // 20/30/120
  900: "#0C1656",
};

const config: Config = {
  content: ["./app/**/*.{js,ts,jsx,tsx}", "./components/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        // 앱 전역 blue-* 를 삼성 팔레트로 교체
        blue: ssBlue,
        // 상담실 primary(원래 녹색 계열, 대부분 project-ui-theme에서 재매핑됨) → 삼성 블루 스펙트럼
        primary: {
          DEFAULT: "#003CDC",
          light: "#3363E3",
          dark: "#141E78",
          50: "#EEF2FE",
          100: "#DEE5FB",
          200: "#CBD1E8",
          300: "#99B1F1",
          400: "#668AE0",
          500: "#3363E3",
          600: "#003CDC",
          700: "#0A2FA8",
          800: "#141E78",
          900: "#0C1656",
        },
        // accent → SS Magenta Spectrum
        accent: {
          DEFAULT: "#EC3B67", // 236/59/103
          light: "#EC6D8C", // 236/109/140
          dark: "#CF244E", // 207/36/78
        },
        navy: "#141E78", // 20/30/120
        ink: "#172033",
        // 상담실 전역 브랜드 accent — 삼성증권 Primary 파란색(0/60/220)
        samsung: "#003CDC",
        // SS Abundant Spectrum 유틸 (그래프·강조용)
        ssMagenta: { DEFAULT: "#EC3B67", deep: "#CF244E", soft: "#EC6D8C", pale: "#F5A7BB" },
        ssCyan: { DEFAULT: "#00B5CD", pale: "#A3E8E8" },
        ssAmber: { DEFAULT: "#FFCF1F", pale: "#FFE696" },
        ssCoral: { DEFAULT: "#F25536", pale: "#F9B2A5" },
        ssPurple: { DEFAULT: "#A514D7", pale: "#F0C8F5" },
        ssSky: { DEFAULT: "#1EB4F0", bright: "#0A78F5", pale: "#A0E6F5" },
        mint: "#00B5CD",
        gold: "#FFCF1F",
      },
      boxShadow: {
        soft: "0 18px 45px rgba(12, 22, 86, 0.10)",
        card: "0 2px 12px rgba(0, 60, 220, 0.08)",
        popup: "0 16px 48px rgba(12, 22, 86, 0.18)",
      },
      borderRadius: {
        card: "16px",
        btn: "10px",
        input: "8px",
      },
    },
  },
  plugins: [],
};

export default config;
