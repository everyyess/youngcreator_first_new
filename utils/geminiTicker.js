/**
 * utils/geminiTicker.js — 금융 메타데이터 추출기
 *
 * Gemini API로 종목명에서 상장 여부·KRX 코드·시장·영문 사명을 추출합니다.
 * route.js 서버 전용 (클라이언트 번들에 포함되지 않음).
 *
 * 환경변수 우선순위:
 *   1. GEMINI_API_KEY          (서버 전용, 권장)
 *   2. NEXT_PUBLIC_GEMINI_API_KEY
 *
 * 반환 타입:
 *   {
 *     isListed:    boolean,                          // 거래소 상장 여부
 *     krCode:      string | null,                    // 6자리 KRX 코드 (선행 0 포함)
 *     market:      "KOSPI" | "KOSDAQ" | "US" | null,
 *     englishName: string | null,                    // Yahoo Search용 공식 영문 사명
 *   } | null  // Gemini 완전 실패 시 null
 */

const GEMINI_ENDPOINT =
  'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent';

const KRCODE_RE  = /^\d{6}$/;
const MARKET_SET = new Set(['KOSPI', 'KOSDAQ', 'US']);

const SYSTEM_INSTRUCTION =
  '너는 주식 종목의 상장 여부와 거래소 메타데이터를 추출하는 금융 정보 봇이야. ' +
  '사용자가 입력한 종목명을 분석하여 반드시 아래 JSON 형식 한 줄로만 응답해야 한다. 설명·마크다운·코드블록 금지.\n' +
  '{"isListed":true/false,"krCode":"6자리숫자또는null","market":"KOSPI또는KOSDAQ또는US또는null","englishName":"영문사명또는null"}\n\n' +

  '━━━ 필드 규칙 ━━━\n' +
  '[isListed] 해당 기업이 어느 거래소에든 정식 상장된 퍼블릭 기업인지 여부.\n' +
  '  true  : 국내(KOSPI/KOSDAQ) 또는 해외(NYSE/NASDAQ 등) 거래소 상장 기업.\n' +
  '  false : 비상장 기업 (스타트업·사모기업·국가기관·비영리단체 등).\n' +
  '          SpaceX·Stripe·OpenAI처럼 유명해도 미상장이면 반드시 false.\n\n' +

  '[krCode] 대한민국 KOSPI/KOSDAQ 상장 종목의 6자리 KRX 종목 코드 (선행 0 포함 문자열).\n' +
  '  KOSPI/KOSDAQ 종목이 아니면 반드시 null.\n' +
  '  예: 삼성전자 → "005930", 알테오젠 → "196170", KODEX 200 → "069500"\n\n' +

  '[market] 해당 종목의 주요 상장 거래소 시장.\n' +
  '  "KOSPI"  : 한국거래소 유가증권시장 상장 종목.\n' +
  '  "KOSDAQ" : 한국거래소 코스닥시장 상장 종목.\n' +
  '  "US"     : 미국·유럽·기타 해외 거래소 상장 종목.\n' +
  '  null     : isListed=false 또는 시장 불명.\n\n' +

  '[englishName] Yahoo Finance 검색을 위한 공식 영문 사명.\n' +
  '  한국 기업도 정확한 영문 사명 출력. 모르면 합리적으로 추론.\n' +
  '  SK스퀘어·LG에너지솔루션·HD현대 등 혼용어는 그룹 브랜드 영문 + 한국어 부분 음차/번역.\n\n' +

  '━━━ 절대 규칙 ━━━\n' +
  '[규칙 1] 영문+국문 혼합 입력(SK스퀘어·LG에너지솔루션·HD현대·KT&G 등)은 한국 상장 종목 최우선 탐색.\n' +
  '[규칙 2] SpaceX·Stripe·OpenAI 같은 유명 비상장 기업은 isListed=false 반드시 출력.\n' +
  '[규칙 3] krCode는 선행 0 포함 정확히 6자리 숫자 문자열. 비KR 종목은 반드시 null.\n' +
  '[규칙 4] JSON 이외 텍스트 절대 금지.\n' +
  '[규칙 5] KOSPI·KOSDAQ 상장 종목은 대형주·중소형주 구분 없이 훈련 데이터를 최대한 활용하여 krCode를 제공하라.\n' +
  '  few-shot 예시에 없는 종목이어도 한국 거래소 상장이 확실하면 추론값을 출력.\n' +
  '  null은 해당 기업의 상장 여부 자체가 불확실하거나 코드를 전혀 알 수 없는 경우에만 사용.\n\n' +

  '━━━ 정답 예시 ━━━\n' +
  '삼성전자 → {"isListed":true,"krCode":"005930","market":"KOSPI","englishName":"Samsung Electronics"}\n' +
  'SK하이닉스 → {"isListed":true,"krCode":"000660","market":"KOSPI","englishName":"SK Hynix"}\n' +
  'SK스퀘어 → {"isListed":true,"krCode":"402340","market":"KOSPI","englishName":"SK Square"}\n' +
  'LG에너지솔루션 → {"isListed":true,"krCode":"373220","market":"KOSPI","englishName":"LG Energy Solution"}\n' +
  'HD현대 → {"isListed":true,"krCode":"267250","market":"KOSPI","englishName":"HD Hyundai"}\n' +
  '한화에어로스페이스 → {"isListed":true,"krCode":"012450","market":"KOSPI","englishName":"Hanwha Aerospace"}\n' +
  '알테오젠 → {"isListed":true,"krCode":"196170","market":"KOSDAQ","englishName":"Alteogen"}\n' +
  '에코프로비엠 → {"isListed":true,"krCode":"247540","market":"KOSDAQ","englishName":"EcoPro BM"}\n' +
  '휴메딕스 → {"isListed":true,"krCode":"200670","market":"KOSDAQ","englishName":"Humedix"}\n' +
  '빛과전자 → {"isListed":true,"krCode":"069540","market":"KOSDAQ","englishName":"Bitgwa Jeonja"}\n' +
  '원텍 → {"isListed":true,"krCode":"336570","market":"KOSDAQ","englishName":"Wontech"}\n' +
  'KODEX 200 → {"isListed":true,"krCode":"069500","market":"KOSPI","englishName":"KODEX 200 ETF"}\n' +
  'TIGER 미국나스닥100 → {"isListed":true,"krCode":"133690","market":"KOSPI","englishName":"TIGER US Nasdaq 100 ETF"}\n' +
  '애플 → {"isListed":true,"krCode":null,"market":"US","englishName":"Apple Inc."}\n' +
  '엔비디아 → {"isListed":true,"krCode":null,"market":"US","englishName":"Nvidia Corporation"}\n' +
  'SPY → {"isListed":true,"krCode":null,"market":"US","englishName":"SPDR S&P 500 ETF Trust"}\n' +
  'SOXL → {"isListed":true,"krCode":null,"market":"US","englishName":"Direxion Daily Semiconductor Bull 3X ETF"}\n' +
  'SpaceX → {"isListed":false,"krCode":null,"market":null,"englishName":"Space Exploration Technologies Corp."}\n' +
  'OpenAI → {"isListed":false,"krCode":null,"market":null,"englishName":"OpenAI"}\n' +
  'Stripe → {"isListed":false,"krCode":null,"market":null,"englishName":"Stripe Inc."}';

/**
 * Gemini AI에 종목명 분석을 요청하여 금융 메타데이터를 반환합니다.
 * - KR 경로: krCode + market → route.js가 직접 티커 조립
 * - US 경로: isListed(비상장 차단) + englishName(Yahoo Search 정확도 향상)
 */
export async function resolveTickerWithGemini(assetName, productType = null) {
  const apiKey =
    process.env.GEMINI_API_KEY ??
    process.env.NEXT_PUBLIC_GEMINI_API_KEY;

  if (!apiKey) {
    console.warn('[geminiTicker] API 키 미설정 — Gemini 메타데이터 추출 건너뜀');
    return null;
  }

  if (!assetName?.trim()) return null;

  const userPrompt = `분석 대상: ${assetName.trim()}`;

  const controller = new AbortController();
  const timeoutId  = setTimeout(() => controller.abort(), 6_000);

  try {
    const res = await fetch(`${GEMINI_ENDPOINT}?key=${apiKey}`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      signal:  controller.signal,
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM_INSTRUCTION }] },
        contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
        generationConfig: {
          temperature:     0,
          maxOutputTokens: 150,
        },
      }),
    });
    clearTimeout(timeoutId);

    if (!res.ok) {
      console.warn(`[geminiTicker] HTTP ${res.status} — '${assetName}' 추출 실패`);
      return null;
    }

    const json = await res.json();
    const raw  = (json?.candidates?.[0]?.content?.parts?.[0]?.text ?? '').trim();
    if (!raw) return null;

    const cleaned = raw.replace(/```[\w]*\n?/g, '').replace(/```/g, '').trim();

    let parsed;
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      console.warn(`[geminiTicker] JSON 파싱 실패 — '${assetName}', raw: '${raw}'`);
      return null;
    }

    const isListed = parsed.isListed === true;

    const rawKrCode = typeof parsed.krCode === 'string'
      ? parsed.krCode.trim().padStart(6, '0')
      : (typeof parsed.krCode === 'number' ? String(parsed.krCode).padStart(6, '0') : null);
    const krCode = rawKrCode && KRCODE_RE.test(rawKrCode) ? rawKrCode : null;

    const market = MARKET_SET.has(parsed.market) ? parsed.market : null;

    const englishName = typeof parsed.englishName === 'string' && parsed.englishName.trim()
      ? parsed.englishName.trim()
      : null;

    const result = { isListed, krCode, market, englishName };
    console.log(`[geminiTicker] '${assetName}' → ${JSON.stringify(result)}`);
    return result;

  } catch (err) {
    clearTimeout(timeoutId);
    if (err.name === 'AbortError') {
      console.warn(`[geminiTicker] 타임아웃 (6s) — '${assetName}'`);
      return null;
    }
    console.warn(`[geminiTicker] 예외 — '${assetName}':`, err?.message);
    return null;
  }
}
