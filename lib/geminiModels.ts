export const ADVANCED_MODELS = [
  "gemini-3.1-flash-lite",
  "gemini-2.5-flash",
  "gemini-2.5-pro",
  "gemini-3.5-flash",
  "gemini-2.5-flash-lite",
] as const;

/**
 * 통합 리서치 엔진 DEEP 단계 전용 — 고성능 모델 우선, lite는 최후 폴백.
 * (ADVANCED_MODELS는 요약 계열 라우트 다수가 공유하는 lite-우선 목록이라 순서를 건드리지 않고 분리)
 * 사용처: STEP2+3 통합·감지 / 토론 종합 판정 / STEP5 재통합·보고서·점수 — 런당 최대 4회.
 * 나머지 대량 호출(STEP1 카드·토론 입론/반박·실시간 보강)은 SIMPLE_MODELS(lite 우선)로 돌려
 * flash 계열 쿼터 소진(429 연쇄 → JSON 파싱 실패)을 막는다.
 *
 * 순서 기준:
 *   gemini-2.5-flash  → 신규 사용자 접근 불가(403) → 마지막 폴백
 *   gemini-2.5-pro    → 무료 할당량 소진(429) + 최대 30s 백오프 → 마지막에서 두 번째
 *   gemini-3.5-flash / gemini-3.1-flash-lite → 정상 동작 확인 → 앞으로 이동
 */
export const DEEP_MODELS = [
  "gemini-3.5-flash",
  "gemini-3.1-flash-lite",
  "gemini-2.5-flash-lite",
  "gemini-2.5-pro",
  "gemini-2.5-flash",
] as const;

export const SIMPLE_MODELS = [
  "gemini-3.1-flash-lite",
  "gemini-2.5-flash-lite",
  "gemini-2.5-flash",
  "gemini-3.5-flash",
] as const;

/** 사용자가 고른 모델을 폴백 목록 맨 앞으로 배치. "auto"/미지정이면 기본 순서 유지 */
export function orderGeminiModels(defaults: readonly string[], preferred?: string | null): string[] {
  const p = (preferred ?? "").trim();
  if (!p || p === "auto") return [...defaults];
  return [p, ...defaults.filter((m) => m !== p)];
}
