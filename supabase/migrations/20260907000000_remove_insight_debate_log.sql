-- 통합 인사이트의 구 "AI 찬반 토론" 기능 제거에 따른 저장소 정리.
--
-- 배경: 이 테이블은 /api/insight-debate 라우트 한 곳에서만 읽고/쓰였고,
-- 그 라우트는 정규식 단어 세기 + 고정 템플릿 문자열로 결과를 만들어 저장했다
-- (LLM 호출 없음). 실제 AI 찬반토론은 통합 리서치 STEP4-1로 대체됐고,
-- UI·라우트·고아 컴포넌트를 모두 제거했으므로 남은 행을 읽는 코드가 없다.
--
-- 사전 확인(2026-09-07):
--   · insight_debate_log를 참조하는 코드: /api/insight-debate/route.ts 뿐 (삭제됨)
--   · 해당 라우트를 호출하던 곳: InsightDebateTab.tsx (어디서도 import되지 않던 고아, 삭제됨)
--   · 다른 라우트·마이그레이션·동적 import에서의 참조: 없음
--   · 이 테이블은 마이그레이션이 아니라 수동으로 생성돼 있었다
--
-- 사용자가 행 삭제까지 명시적으로 승인했으므로 비어있지 않아도 그대로 제거한다.
-- 다만 RESTRICT를 유지해, 예상치 못한 의존 객체(뷰·외래키)가 있으면
-- 조용히 함께 지우지 않고 실패하게 한다.
BEGIN;
SET LOCAL lock_timeout = '5s';
DROP TABLE IF EXISTS public.insight_debate_log RESTRICT;
COMMIT;
