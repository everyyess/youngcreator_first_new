/**
 * 클라이언트 사이드 USD/KRW 환율 캐시.
 * 모듈 레벨 변수로 페이지 세션 동안 유지 — React 리렌더마다 재호출 방지.
 * TTL 5분 초과 시 재조회, 실패 시 null 반환 (호출부에서 graceful 처리).
 *
 * 핵심 연산:
 *   원화 현재가 = 외화 현재가 (USD) × getUSDKRWRate()
 */

let _cachedRate: number | null = null;
let _fetchedAt  = 0;
const TTL_MS    = 5 * 60 * 1000; // 5분

export async function getUSDKRWRate(): Promise<number | null> {
  const now = Date.now();
  if (_cachedRate !== null && now - _fetchedAt < TTL_MS) return _cachedRate;

  try {
    const res = await fetch('/api/price?ticker=KRW%3DX');
    if (!res.ok) return null;
    const data = await res.json();
    const rate = data?.regularMarketPrice;
    if (typeof rate === 'number' && rate > 0) {
      _cachedRate = rate;
      _fetchedAt  = now;
      return rate;
    }
  } catch {
    // 네트워크 실패 — null 반환, 호출부에서 current_price 미설정으로 처리
  }
  return null;
}
