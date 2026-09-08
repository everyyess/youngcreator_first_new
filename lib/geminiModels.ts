/**
 * 모델 목록 점검 이력 (2026-09-07, 등록된 API 키 6개 전수 확인)
 *   gemini-2.5-flash / gemini-2.5-pro / gemini-2.5-flash-lite
 *     → generateContent 호출 시 6개 키 모두 404 "no longer available to new users".
 *       목록(models.list)에는 남아 있으나 실제 호출이 불가해, 폴백 목록에 두면
 *       모델당 키 수만큼 헛돌다 실패한다(죽은 모델 3개 × 키 6개 = 18회 낭비).
 *       Google이 안내한 대체 모델로 교체함.
 *   gemini-3.1-pro-preview / gemini-pro-latest
 *     → 6개 키 모두 429(무료 할당량 없음). 폴백에 두면 지연만 늘어 제외.
 *   gemini-3.5-flash / gemini-3.1-flash-lite / gemini-3.5-flash-lite / gemini-3.6-flash
 *     → 6개 키 모두 정상, thinkingConfig 수용 확인.
 */
export const ADVANCED_MODELS = [
  "gemini-3.1-flash-lite",
  "gemini-3.6-flash",
  "gemini-3.5-flash",
  "gemini-3.5-flash-lite",
] as const;

/**
 * 통합 리서치 엔진 DEEP 단계 전용 — 고성능 모델 우선, lite는 최후 폴백.
 * (ADVANCED_MODELS는 요약 계열 라우트 다수가 공유하는 lite-우선 목록이라 순서를 건드리지 않고 분리)
 * 사용처: STEP2+3 통합·감지 / 토론 종합 판정 / STEP5 재통합·보고서·점수 — 런당 최대 4회.
 * 나머지 대량 호출(STEP1 카드·토론 입론/반박·실시간 보강)은 SIMPLE_MODELS(lite 우선)로 돌려
 * flash 계열 쿼터 소진(429 연쇄 → JSON 파싱 실패)을 막는다.
 */
export const DEEP_MODELS = [
  "gemini-3.5-flash",
  "gemini-3.1-flash-lite",
  "gemini-3.5-flash-lite",
  "gemini-3.6-flash",
] as const;

export const SIMPLE_MODELS = [
  "gemini-3.1-flash-lite",
  "gemini-3.5-flash-lite",
  "gemini-3.6-flash",
  "gemini-3.5-flash",
] as const;

/** 사용자가 고른 모델을 폴백 목록 맨 앞으로 배치. "auto"/미지정이면 기본 순서 유지 */
export function orderGeminiModels(defaults: readonly string[], preferred?: string | null): string[] {
  const p = (preferred ?? "").trim();
  if (!p || p === "auto") return [...defaults];
  return [p, ...defaults.filter((m) => m !== p)];
}
