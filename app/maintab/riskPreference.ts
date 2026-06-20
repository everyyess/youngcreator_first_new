export type PortfolioPreference = "conservative" | "balanced" | "aggressive";

export const preferenceBadgeClass = "inline-flex items-center rounded-full bg-[#1f2a5a] px-2 py-0.5 text-xs font-extrabold text-white";

export function riskGradeFromScore(score: number) {
  if (score >= 81) return 1;
  if (score >= 61) return 2;
  if (score >= 41) return 3;
  if (score >= 21) return 4;
  return 5;
}

export function preferenceFromRiskScore(score: number): PortfolioPreference {
  const grade = riskGradeFromScore(score);
  if (grade <= 2) return "aggressive";
  if (grade === 3) return "balanced";
  return "conservative";
}

export function preferenceLabel(preference: PortfolioPreference) {
  if (preference === "conservative") return "🛡️ 안전형";
  if (preference === "balanced") return "⚖️ 밸런스형";
  return "🔥 공격형";
}

export function preferenceLabelFromScore(score: number) {
  return preferenceLabel(preferenceFromRiskScore(score));
}
