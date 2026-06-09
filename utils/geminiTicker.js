/**
 * utils/geminiTicker.js
 *
 * 한글 종목명·약어를 Yahoo Finance 티커로 변환하는 Gemini AI 유틸리티.
 * 서버 전용 (route.js 에서만 import) — 클라이언트 번들에 포함되지 않음.
 *
 * 환경변수 우선순위:
 *   1. GEMINI_API_KEY          (서버 전용, 권장)
 *   2. NEXT_PUBLIC_GEMINI_API_KEY (서버·클라이언트 공용, 차선)
 */

const GEMINI_ENDPOINT =
  'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent';

// 유효 티커 문자: 대소문자·숫자·점·하이픈·등호·캐럿
const VALID_TICKER_RE = /^[\w.\-=^]+$/;

/**
 * Gemini AI에 티커 변환을 요청합니다.
 *
 * @param {string} assetName  - 사용자 입력 종목명 (예: '삼전', '테슬라')
 * @returns {Promise<string|null>}
 *   - 성공 시: Yahoo Finance 티커 문자열 (예: '005930.KS', 'TSLA')
 *   - 실패·UNKNOWN·타임아웃 시: null (호출자가 다음 단계로 폴백)
 */
export async function resolveTickerWithGemini(assetName) {
  const apiKey =
    process.env.GEMINI_API_KEY ??
    process.env.NEXT_PUBLIC_GEMINI_API_KEY;

  if (!apiKey) {
    console.warn('[geminiTicker] API 키 미설정 — Gemini 티커 변환 건너뜀');
    return null;
  }

  const prompt =
    '너는 금융 자산 티커 매칭 전문가야. 사용자가 입력한 한국어 종목명/약어를 분석해서 ' +
    'Yahoo Finance(yfinance)에서 조회 가능한 정확한 Ticker 문자열만 딱 반환해 줘.\n' +
    '- 미국 주식/ETF (예: 애플 -> AAPL, 테슬라 -> TSLA)\n' +
    '- 한국 주식 (예: 삼성전자 또는 삼전 -> 005930.KS, SK하이닉스 -> 000660.KS)\n' +
    '- 만약 금융 자산이 아니거나 매칭되는 티커가 없다면 정확히 \'UNKNOWN\'이라고만 답해줘. ' +
    '다른 설명이나 마크다운 래퍼(```) 없이 오직 티커 문자열 자체만 출력해야 해.\n\n' +
    `입력: ${assetName}`;

  const controller = new AbortController();
  const timeoutId  = setTimeout(() => controller.abort(), 6_000);

  try {
    const res = await fetch(`${GEMINI_ENDPOINT}?key=${apiKey}`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      signal:  controller.signal,
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature:     0,    // 결정론적 출력
          maxOutputTokens: 32,   // 티커는 짧으므로 충분
        },
      }),
    });
    clearTimeout(timeoutId);

    if (!res.ok) {
      console.warn(`[geminiTicker] HTTP ${res.status} — '${assetName}' 변환 실패`);
      return null;
    }

    const json = await res.json();
    const raw  = (json?.candidates?.[0]?.content?.parts?.[0]?.text ?? '').trim();

    if (!raw || raw.toUpperCase() === 'UNKNOWN') return null;

    // 방어적 마크다운 코드블록 제거 (모델이 무시하더라도)
    const ticker = raw.replace(/```[\w]*\n?/g, '').replace(/```/g, '').trim();

    if (!VALID_TICKER_RE.test(ticker)) {
      console.warn(`[geminiTicker] 유효하지 않은 형식 무시: '${ticker}' (입력: '${assetName}')`);
      return null;
    }

    console.log(`[geminiTicker] '${assetName}' → '${ticker}'`);
    return ticker;

  } catch (err) {
    clearTimeout(timeoutId);
    if (err.name === 'AbortError') {
      console.warn(`[geminiTicker] 타임아웃 (6 s) — '${assetName}', Yahoo Search 로 폴백`);
      return null;
    }
    console.warn(`[geminiTicker] 예외 — '${assetName}':`, err?.message);
    return null;
  }
}
