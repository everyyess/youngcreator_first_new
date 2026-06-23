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
  '{"isListed":true/false,"krCode":"6자리숫자또는null","market":"KOSPI또는KOSDAQ또는US또는null","englishName":"영문사명또는null","koreanName":"한국어종목명또는null"}\n\n' +

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

  '[koreanName] 해당 종목의 한국어 공식 명칭 (국내 투자자에게 통용되는 이름).\n' +
  '  해외 종목: 국내에서 통용되는 한국어 명칭. 없으면 영문 사명을 한국어로 음차.\n' +
  '  국내 종목: 한국어 공식 종목명 (법인 표기 "(주)" 제외).\n' +
  '  비상장·불명: null.\n\n' +

  '━━━ 절대 규칙 ━━━\n' +
  '[규칙 1] 영문+국문 혼합 입력(SK스퀘어·LG에너지솔루션·HD현대·KT&G 등)은 한국 상장 종목 최우선 탐색.\n' +
  '  HD로 시작하는 입력에 한글이 포함된 경우(HD현대·HD현대중공업·HD현대마린솔루션 등)는 반드시 KR 종목으로 처리. HD(홈디포) 혼동 금지.\n' +
  '[규칙 2] SpaceX·Stripe·OpenAI 같은 유명 비상장 기업은 isListed=false 반드시 출력.\n' +
  '[규칙 3] krCode는 선행 0 포함 정확히 6자리 숫자 문자열. 비KR 종목은 반드시 null.\n' +
  '[규칙 4] JSON 이외 텍스트 절대 금지.\n' +
  '[규칙 5] KOSPI·KOSDAQ 상장 종목은 대형주·중소형주 구분 없이 훈련 데이터를 최대한 활용하여 krCode를 제공하라.\n' +
  '  few-shot 예시에 없는 종목이어도 한국 거래소 상장이 확실하면 추론값을 출력.\n' +
  '  null은 해당 기업의 상장 여부 자체가 불확실하거나 코드를 전혀 알 수 없는 경우에만 사용.\n\n' +

  '━━━ 정답 예시 ━━━\n' +
  '삼성전자 → {"isListed":true,"krCode":"005930","market":"KOSPI","englishName":"Samsung Electronics","koreanName":"삼성전자"}\n' +
  'SK하이닉스 → {"isListed":true,"krCode":"000660","market":"KOSPI","englishName":"SK Hynix","koreanName":"SK하이닉스"}\n' +
  'SK스퀘어 → {"isListed":true,"krCode":"402340","market":"KOSPI","englishName":"SK Square","koreanName":"SK스퀘어"}\n' +
  'LG에너지솔루션 → {"isListed":true,"krCode":"373220","market":"KOSPI","englishName":"LG Energy Solution","koreanName":"LG에너지솔루션"}\n' +
  'HD현대 → {"isListed":true,"krCode":"267250","market":"KOSPI","englishName":"HD Hyundai","koreanName":"HD현대"}\n' +
  'HD현대중공업 → {"isListed":true,"krCode":"329180","market":"KOSPI","englishName":"HD Hyundai Heavy Industries","koreanName":"HD현대중공업"}\n' +
  'HD현대마린솔루션 → {"isListed":true,"krCode":"443060","market":"KOSPI","englishName":"HD Hyundai Marine Solution","koreanName":"HD현대마린솔루션"}\n' +
  'HD현대일렉트릭 → {"isListed":true,"krCode":"267260","market":"KOSPI","englishName":"HD Hyundai Electric","koreanName":"HD현대일렉트릭"}\n' +
  '한화에어로스페이스 → {"isListed":true,"krCode":"012450","market":"KOSPI","englishName":"Hanwha Aerospace","koreanName":"한화에어로스페이스"}\n' +
  '기아 → {"isListed":true,"krCode":"000270","market":"KOSPI","englishName":"Kia Corporation","koreanName":"기아"}\n' +
  '두산에너빌리티 → {"isListed":true,"krCode":"034020","market":"KOSPI","englishName":"Doosan Enerbility","koreanName":"두산에너빌리티"}\n' +
  '셀트리온 → {"isListed":true,"krCode":"068270","market":"KOSPI","englishName":"Celltrion","koreanName":"셀트리온"}\n' +
  '삼성바이오로직스 → {"isListed":true,"krCode":"207940","market":"KOSPI","englishName":"Samsung Biologics","koreanName":"삼성바이오로직스"}\n' +
  '알테오젠 → {"isListed":true,"krCode":"196170","market":"KOSDAQ","englishName":"Alteogen","koreanName":"알테오젠"}\n' +
  '에코프로비엠 → {"isListed":true,"krCode":"247540","market":"KOSDAQ","englishName":"EcoPro BM","koreanName":"에코프로비엠"}\n' +
  'HLB이노베이션 → {"isListed":true,"krCode":"067830","market":"KOSDAQ","englishName":"HLB Innovation","koreanName":"HLB이노베이션"}\n' +
  'KODEX 200 → {"isListed":true,"krCode":"069500","market":"KOSPI","englishName":"KODEX 200 ETF","koreanName":"KODEX 200"}\n' +
  'TIGER 미국나스닥100 → {"isListed":true,"krCode":"133690","market":"KOSPI","englishName":"TIGER US Nasdaq 100 ETF","koreanName":"TIGER 미국나스닥100"}\n' +
  '애플 → {"isListed":true,"krCode":null,"market":"US","englishName":"Apple Inc.","koreanName":"애플"}\n' +
  '엔비디아 → {"isListed":true,"krCode":null,"market":"US","englishName":"Nvidia Corporation","koreanName":"엔비디아"}\n' +
  'NVDA → {"isListed":true,"krCode":null,"market":"US","englishName":"Nvidia Corporation","koreanName":"엔비디아"}\n' +
  'Meta Platforms → {"isListed":true,"krCode":null,"market":"US","englishName":"Meta Platforms Inc.","koreanName":"메타"}\n' +
  '메타 → {"isListed":true,"krCode":null,"market":"US","englishName":"Meta Platforms Inc.","koreanName":"메타"}\n' +
  'JPMorgan Chase → {"isListed":true,"krCode":null,"market":"US","englishName":"JPMorgan Chase & Co.","koreanName":"JP모건체이스"}\n' +
  'JP모건 → {"isListed":true,"krCode":null,"market":"US","englishName":"JPMorgan Chase & Co.","koreanName":"JP모건체이스"}\n' +
  'Berkshire Hathaway → {"isListed":true,"krCode":null,"market":"US","englishName":"Berkshire Hathaway Inc.","koreanName":"버크셔해서웨이"}\n' +
  'Eli Lilly → {"isListed":true,"krCode":null,"market":"US","englishName":"Eli Lilly and Company","koreanName":"일라이릴리"}\n' +
  'ELILILLY → {"isListed":true,"krCode":null,"market":"US","englishName":"Eli Lilly and Company","koreanName":"일라이릴리"}\n' +
  '일라이릴리 → {"isListed":true,"krCode":null,"market":"US","englishName":"Eli Lilly and Company","koreanName":"일라이릴리"}\n' +
  'Broadcom → {"isListed":true,"krCode":null,"market":"US","englishName":"Broadcom Inc.","koreanName":"브로드컴"}\n' +
  'Home Depot → {"isListed":true,"krCode":null,"market":"US","englishName":"The Home Depot Inc.","koreanName":"홈디포"}\n' +
  'Costco → {"isListed":true,"krCode":null,"market":"US","englishName":"Costco Wholesale Corporation","koreanName":"코스트코"}\n' +
  'Amazon → {"isListed":true,"krCode":null,"market":"US","englishName":"Amazon.com Inc.","koreanName":"아마존"}\n' +
  'Alphabet → {"isListed":true,"krCode":null,"market":"US","englishName":"Alphabet Inc.","koreanName":"알파벳"}\n' +
  'Goldman Sachs → {"isListed":true,"krCode":null,"market":"US","englishName":"The Goldman Sachs Group Inc.","koreanName":"골드만삭스"}\n' +
  'RKLB → {"isListed":true,"krCode":null,"market":"US","englishName":"Rocket Lab USA","koreanName":"로켓랩"}\n' +
  'PLTR → {"isListed":true,"krCode":null,"market":"US","englishName":"Palantir Technologies","koreanName":"팔란티어"}\n' +
  'TSLA → {"isListed":true,"krCode":null,"market":"US","englishName":"Tesla Inc.","koreanName":"테슬라"}\n' +
  'AAPL → {"isListed":true,"krCode":null,"market":"US","englishName":"Apple Inc.","koreanName":"애플"}\n' +
  'SPY → {"isListed":true,"krCode":null,"market":"US","englishName":"SPDR S&P 500 ETF Trust","koreanName":"SPDR S&P500 ETF"}\n' +
  'QQQ → {"isListed":true,"krCode":null,"market":"US","englishName":"Invesco QQQ Trust","koreanName":"인베스코 QQQ ETF"}\n' +
  'SOXL → {"isListed":true,"krCode":null,"market":"US","englishName":"Direxion Daily Semiconductor Bull 3X ETF","koreanName":"디렉시온 반도체 3배 레버리지 ETF"}\n' +
  'SpaceX → {"isListed":false,"krCode":null,"market":null,"englishName":"Space Exploration Technologies Corp.","koreanName":null}\n' +
  'OpenAI → {"isListed":false,"krCode":null,"market":null,"englishName":"OpenAI","koreanName":null}\n' +
  'Stripe → {"isListed":false,"krCode":null,"market":null,"englishName":"Stripe Inc.","koreanName":null}';

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

    const koreanName = typeof parsed.koreanName === 'string' && parsed.koreanName.trim()
      ? parsed.koreanName.trim()
      : null;

    const result = { isListed, krCode, market, englishName, koreanName };
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
