import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx}",
    "./components/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        navy: "#0B1F3A",
        ink: "#172033",
        samsung: "#1428A0",
        mint: "#0F766E",
        gold: "#B7791F"
      },
      boxShadow: {
        soft: "0 18px 45px rgba(13, 31, 58, 0.08)"
      }
    }
  },
  plugins: []
};

export default config;
