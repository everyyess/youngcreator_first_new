import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{js,ts,jsx,tsx}", "./components/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        primary: {
          DEFAULT: "#005B52",
          light: "#007A6E",
          dark: "#003D37",
          50: "#F0FAF9",
          100: "#CCEEEB",
          200: "#99DDD7",
          300: "#5FC4BB",
          400: "#2EA89F",
          500: "#005B52",
          600: "#004842",
          700: "#003531",
          800: "#002220",
          900: "#000F0E"
        },
        accent: {
          DEFAULT: "#B85D19",
          light: "#D4703A",
          dark: "#8C4610"
        },
        navy: "#0B1F3A",
        ink: "#172033",
        // 상담실 전체 브랜드 accent — 예전엔 짙은 남색(#1428A0)이었는데, 홈 화면 "신규 고객 추가"
        // 버튼과 동일한 삼성증권 파란색(blue-600)으로 통일했다(2026-09). `samsung` 토큰은
        // app/maintab/** 전역에서만 쓰여서 여기 하나만 바꾸면 상담실 버튼·배지·테두리가 다 같이 바뀐다.
        samsung: "#2563eb",
        mint: "#0F766E",
        gold: "#B7791F"
      },
      boxShadow: {
        soft: "0 18px 45px rgba(13, 31, 58, 0.08)",
        card: "0 2px 12px rgba(0, 91, 82, 0.06)",
        popup: "0 16px 48px rgba(13, 35, 24, 0.16)"
      },
      borderRadius: {
        card: "16px",
        btn: "10px",
        input: "8px"
      }
    }
  },
  plugins: []
};

export default config;
