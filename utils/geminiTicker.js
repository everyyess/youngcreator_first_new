/**
 * utils/geminiTicker.js
 *
 * 한글 종목명·약어를 Yahoo Finance 티커 + 자산 메타데이터로 변환하는 Gemini AI 유틸리티.
 * 서버 전용 (route.js 에서만 import) — 클라이언트 번들에 포함되지 않음.
 *
 * 환경변수 우선순위:
 *   1. GEMINI_API_KEY          (서버 전용, 권장)
 *   2. NEXT_PUBLIC_GEMINI_API_KEY (서버·클라이언트 공용, 차선)
 *
 * 반환 타입:
 *   {
 *     ticker:      string | null,   // Yahoo Finance 티커. UNKNOWN이면 null
 *     englishName: string | null,   // Yahoo Search용 영문 종목명 (티커 불명 시 징검다리)
 *     assetClass:  string | null,
 *     productType: string | null,
 *     country:     string | null,
 *   } | null                        // Gemini 완전 실패 시 null
 */

const GEMINI_ENDPOINT =
  'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent';

const VALID_TICKER_RE = /^[\w.\-=^]+$/;

const ASSET_CLASS_SET  = new Set(['국내주식','해외주식','국내채권','해외채권','금','리츠','현금','달러']);
const PRODUCT_TYPE_SET = new Set(['개별주식','ETF','채권','리츠','펀드','현금','외화','암호화폐']);
const COUNTRY_SET      = new Set(['한국','미국','일본','중국','유럽','기타']);

/**
 * Gemini AI에 종목명 분석을 요청하여 티커 + 자산 메타데이터를 반환합니다.
 *
 * 티커가 UNKNOWN이어도 englishName이 있으면 null 대신 객체를 반환합니다.
 * 라우트는 englishName을 Yahoo Search의 검색어로 사용해 한글 400 오류를 우회합니다.
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
    '너는 금융 자산 분류 전문가야. 입력된 종목명을 분석해서 반드시 아래 JSON 형식으로만 응답해줘.\n' +
    '{"ticker":"티커","englishName":"영문명","assetClass":"자산군","productType":"상품유형","country":"국가"}\n\n' +
    '규칙:\n' +
    '- ticker: Yahoo Finance(yfinance) 호환 티커. 확실하지 않으면 "UNKNOWN"\n' +
    '- [필수] 한국 주식(KOSPI) 티커는 반드시 숫자 코드 뒤에 ".KS" 접미사를 붙일 것.\n' +
    '  한국 주식(KOSDAQ) 티커는 반드시 숫자 코드 뒤에 ".KQ" 접미사를 붙일 것.\n' +
    '  KODEX·TIGER·KBSTAR 등 국내 상장 ETF도 동일하게 ".KS" 접미사 필수.\n' +
    '  (예: 삼성전자 → 005930.KS, 삼성전기 → 009150.KS, SK하이닉스 → 000660.KS,\n' +
    '       KODEX 200 → 069500.KS, KODEX 레버리지 → 122630.KS,\n' +
    '       TIGER 미국나스닥100 → 133690.KS, 카카오 → 035720.KQ,\n' +
    '       셀트리온헬스케어 → 091990.KQ)\n' +
    '  이 규칙을 어기면 yfinance에서 종목 조회가 완전히 차단된다.\n' +
    '- englishName: Yahoo Finance 검색 API에 전달할 최적 영문 종목명.\n' +
    '  티커를 모르더라도 영문명은 반드시 추론할 것.\n' +
    '  (예: 테슬라 → "Tesla", 엔비디아 → "Nvidia", 삼전 → "Samsung Electronics",\n' +
    '       애플 → "Apple", 아마존 → "Amazon", 구글 → "Alphabet")\n' +
    '- assetClass: "국내주식","해외주식","국내채권","해외채권","금","리츠","현금","달러" 중 하나\n' +
    '- productType: "개별주식","ETF","채권","리츠","펀드","현금","외화","암호화폐" 중 하나\n' +
    '  [필수] TLT·SHY·IEF·BND·AGG·LQD·HYG 및 거래소에 상장된 채권형 ETF는 productType을\n' +
    '  반드시 "ETF"로 반환할 것. "채권"으로 반환하면 안 됨. (예: TLT → productType:"ETF")\n' +
    '  국내 채권형 ETF(114260.KS KODEX국고채10년, 148070.KS KOSEF국고채 등)도 동일하게 "ETF".\n' +
    '- country: "한국","미국","일본","중국","유럽","기타" 중 하나\n\n' +
    '예시:\n' +
    '삼성전자 → {"ticker":"005930.KS","englishName":"Samsung Electronics","assetClass":"국내주식","productType":"개별주식","country":"한국"}\n' +
    '삼전 → {"ticker":"005930.KS","englishName":"Samsung Electronics","assetClass":"국내주식","productType":"개별주식","country":"한국"}\n' +
    '삼성전기 → {"ticker":"009150.KS","englishName":"Samsung Electro-Mechanics","assetClass":"국내주식","productType":"개별주식","country":"한국"}\n' +
    'KODEX 200 → {"ticker":"069500.KS","englishName":"KODEX 200 ETF","assetClass":"국내주식","productType":"ETF","country":"한국"}\n' +
    'KODEX 레버리지 → {"ticker":"122630.KS","englishName":"KODEX Leverage ETF","assetClass":"국내주식","productType":"ETF","country":"한국"}\n' +
    'TIGER 미국나스닥100 → {"ticker":"133690.KS","englishName":"TIGER US Nasdaq 100","assetClass":"해외주식","productType":"ETF","country":"한국"}\n' +
    '카카오 → {"ticker":"035720.KQ","englishName":"Kakao Corp","assetClass":"국내주식","productType":"개별주식","country":"한국"}\n' +
    '테슬라 → {"ticker":"TSLA","englishName":"Tesla","assetClass":"해외주식","productType":"개별주식","country":"미국"}\n' +
    '엔비디아 → {"ticker":"NVDA","englishName":"Nvidia","assetClass":"해외주식","productType":"개별주식","country":"미국"}\n' +
    'SPY → {"ticker":"SPY","englishName":"SPDR S&P 500 ETF","assetClass":"해외주식","productType":"ETF","country":"미국"}\n' +
    '미국 국채 10년 → {"ticker":"^TNX","englishName":"10-Year Treasury Yield","assetClass":"해외채권","productType":"채권","country":"미국"}\n\n' +
    '마크다운·설명 없이 JSON 한 줄만 출력해줘.\n\n' +
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
          temperature:     0,
          maxOutputTokens: 160,
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
    if (!raw) return null;

    // 마크다운 코드블록 방어적 제거
    const cleaned = raw.replace(/```[\w]*\n?/g, '').replace(/```/g, '').trim();

    let parsed;
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      // JSON 파싱 실패 — 단순 티커 문자열로 간주하여 마지막 폴백
      console.warn(`[geminiTicker] JSON 파싱 실패, raw: '${raw}'`);
      const fallbackTicker = cleaned.trim();
      if (!fallbackTicker || fallbackTicker.toUpperCase() === 'UNKNOWN') return null;
      if (!VALID_TICKER_RE.test(fallbackTicker)) return null;
      console.log(`[geminiTicker] '${assetName}' → '${fallbackTicker}' (단순 티커 폴백)`);
      return { ticker: fallbackTicker, englishName: null, assetClass: null, productType: null, country: null };
    }

    const rawTicker   = (parsed.ticker ?? '').trim();
    const englishName = typeof parsed.englishName === 'string' && parsed.englishName.trim()
      ? parsed.englishName.trim()
      : null;

    const assetClass  = ASSET_CLASS_SET.has(parsed.assetClass)   ? parsed.assetClass  : null;
    const productType = PRODUCT_TYPE_SET.has(parsed.productType) ? parsed.productType : null;
    const country     = COUNTRY_SET.has(parsed.country)          ? parsed.country     : null;

    const isUnknown = !rawTicker || rawTicker.toUpperCase() === 'UNKNOWN' || !VALID_TICKER_RE.test(rawTicker);

    if (isUnknown) {
      // 티커 불명 — englishName이 있으면 Yahoo Search 징검다리로 활용 가능하므로 객체 반환
      if (englishName) {
        console.log(`[geminiTicker] '${assetName}' → UNKNOWN 티커, englishName: '${englishName}' (Yahoo 징검다리)`);
        return { ticker: null, englishName, assetClass, productType, country };
      }
      console.log(`[geminiTicker] '${assetName}' → UNKNOWN 및 영문명 없음`);
      return null;
    }

    console.log(`[geminiTicker] '${assetName}' → ${JSON.stringify({ ticker: rawTicker, englishName, assetClass, productType, country })}`);
    return { ticker: rawTicker, englishName, assetClass, productType, country };

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
