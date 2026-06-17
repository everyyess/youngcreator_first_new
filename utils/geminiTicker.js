/**
 * utils/geminiTicker.js — DEPRECATED
 *
 * [사용 중단] route.js가 KRX_TICKER_MAP + Yahoo 확정적 파이프라인으로 전환되어
 * 이 모듈은 더 이상 참조되지 않습니다. 파일은 보존하되 내보내기는 무효 처리됩니다.
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
 *     ticker:      string | null,   // Yahoo Finance 전체 티커. UNKNOWN이면 null
 *     englishName: string | null,   // 공식 영문 사명 (Yahoo Search 징검다리 겸용)
 *     assetClass:  string | null,
 *     productType: string | null,
 *     country:     string | null,
 *     market:      'KR' | 'US' | null,  // 시맨틱 마켓 라우팅 키
 *     krCode:      string | null,        // KR 종목 전용 6자리 숫자 코드 (KOSPI/KOSDAQ 공통)
 *   } | null                             // Gemini 완전 실패 시 null
 */

const GEMINI_ENDPOINT =
  'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent';

const VALID_TICKER_RE = /^[\w.\-=^]+$/;
const KRCODE_RE       = /^\d{6}$/;   // 한국 거래소 6자리 숫자 코드 검증

const ASSET_CLASS_SET  = new Set(['국내주식','해외주식','국내채권','해외채권','금','리츠','현금','달러']);
const PRODUCT_TYPE_SET = new Set([
  '국내주식', '해외주식',
  '국내ETF',  '해외ETF',
  '채권', '리츠', '펀드', '현금', '외화', '암호화폐',
]);
const COUNTRY_SET = new Set(['한국','미국','일본','중국','유럽','기타']);
const MARKET_SET  = new Set(['KR', 'US']);

// ── systemInstruction: 규칙 레이어 ────────────────────────────────────────────
// Gemini API는 systemInstruction을 user-turn보다 높은 우선순위로 처리합니다.
// 규칙을 여기에 배치하면 긴 few-shot 예시와 충돌 시에도 규칙이 우선 적용됩니다.
const SYSTEM_INSTRUCTION_BASE =
  '너는 금융 자산 분류 전문가야. 사용자가 입력한 종목명(한글/영문/약어)을 분석하여 ' +
  '반드시 아래 JSON 형식 한 줄로만 응답해야 한다. 설명·마크다운·코드블록 금지.\n' +
  '{"ticker":"...","englishName":"...","assetClass":"...","productType":"...","country":"...","market":"KR또는US","krCode":"6자리숫자또는null"}\n\n' +

  '━━━ 절대 규칙 (위반 시 전체 시스템 오작동) ━━━\n' +
  '[규칙 1] KOSPI 종목: 6자리 숫자 + ".KS"  (예: 010130.KS)\n' +
  '         KOSDAQ 종목: 6자리 숫자 + ".KQ"  (예: 191170.KQ)\n' +
  '         ".KS" / ".KQ" 없이 숫자만 출력하면 yfinance 조회 완전 불가.\n\n' +
  '[규칙 2] 미국 상장 종목: 순수 알파벳 심볼  (예: AAPL, TSLA, NVDA, SPY)\n' +
  '         ".US" 접미사나 기타 접미사 절대 금지.\n\n' +
  '[규칙 3] productType 허용값 — 아래 10개 중 정확히 하나만 출력:\n' +
  '  "국내주식"  : 한국 거래소 상장 개별 기업 주식\n' +
  '  "해외주식"  : 해외 거래소 상장 개별 기업 주식\n' +
  '  "국내ETF"   : 한국 거래소 상장 ETF (KODEX·TIGER·KBSTAR·ARIRANG 등)\n' +
  '               이름에 "ETF"가 없어도 거래소 상장 인덱스 펀드이면 "국내ETF".\n' +
  '  "해외ETF"   : 해외 거래소 상장 ETF (SPY·QQQ·TLT·SOXL·TSLL·SMH 등)\n' +
  '               레버리지·인버스·섹터·채권형 ETF 모두 "해외ETF".\n' +
  '  "채권"      : 개별 채권 상품\n' +
  '  "리츠"      : 리츠(REITs) 상품\n' +
  '  "펀드"      : 비상장 공모·사모펀드\n' +
  '  "현금"      : 예적금·머니마켓 상품\n' +
  '  "외화"      : 외화(달러·엔 등) 자산\n' +
  '  "암호화폐"  : 가상자산\n\n' +
  '[규칙 4] assetClass 허용값:\n' +
  '  "국내주식","해외주식","국내채권","해외채권","금","리츠","현금","달러"\n\n' +
  '[규칙 5] country 허용값: "한국","미국","일본","중국","유럽","기타"\n\n' +
  '[규칙 6] 티커를 알 수 없으면 ticker 필드에 "UNKNOWN" 출력.\n' +
  '         englishName은 모르더라도 반드시 최선으로 추론하여 출력.\n\n' +
  '[규칙 7] JSON 이외 텍스트 출력 절대 금지.\n\n' +

  '[규칙 8] market 및 krCode 필드 (시맨틱 마켓 라우팅 핵심):\n' +
  '  market: 해당 종목의 상장 거래소 시장.\n' +
  '    "KR" — KOSPI 또는 KOSDAQ 상장 종목 (한국 주식·ETF)\n' +
  '    "US" — 미국·유럽·기타 해외 거래소 상장 종목\n' +
  '  krCode: market="KR"일 때만 해당 종목의 6자리 숫자 코드를 문자열로 출력.\n' +
  '    선행 0을 반드시 포함한 정확히 6자리 숫자 문자열로 출력.  (예: "010130", "191170")\n' +
  '    market="US"이면 반드시 null 출력.\n' +
  '    krCode는 ticker 필드에서 ".KS"/".KQ" 접미사를 제거한 숫자 부분과 동일해야 한다.\n\n' +

  '━━━ 혼용어 입력 처리 규칙 (Market Routing Priority) ━━━\n' +
  '[규칙 9] 영문 알파벳 + 국문 혼용 입력 → 한국 시장 최우선 탐색:\n' +
  '  입력값에 영문 알파벳(SK, LG, GS, CJ, HD, KT, KB, NH, DB, HK, KG 등)과\n' +
  '  한국어 글자가 함께 포함된 경우, 해당 영문은 한국 대기업 그룹사\n' +
  '  브랜드 명칭일 가능성이 압도적으로 높다.\n' +
  '  ① KOSPI/KOSDAQ 상장 종목을 반드시 최우선으로 탐색한다. → market="KR"\n' +
  '  ② 영문 글자만 보고 미국·글로벌 알파벳 심볼로 교체하는 행위 절대 금지.\n' +
  '  ③ 한국 시장에 대응 종목이 없는 것이 확실할 때에만 글로벌 시장을 검토한다.\n\n' +

  '[규칙 10] 국문 고유명사 음차 충실 의무 (Strict Transliteration Guard):\n' +
  '  국문 명칭을 englishName으로 변환할 때 국문 고유명사 파트를\n' +
  '  충실히 음차(transliteration) 또는 번역(translation)해야 한다.\n' +
  '  올바른 변환 패턴 예:\n' +
  '    스퀘어→Square  하이닉스→Hynix  에너지→Energy  솔루션→Solution\n' +
  '    유플러스→U Plus  이노텍→Innotek  케미칼→Chemical  홀딩스→Holdings\n' +
  '  앞의 영문 브랜드 글자(SK, LG, GS 등)만 보고 완전히 다른 영문 사명의\n' +
  '  글로벌 기업으로 englishName을 치환하는 연상 오류 절대 금지.\n\n' +

  '━━━ 혼용어·market 오류 음성 예시 ━━━\n' +
  '❌ [영문브랜드+국문명] 입력 시 영문 글자만 보고 무관한 미국 거래소 심볼을 ticker로 반환 금지.\n' +
  '   (패턴: "[영문그룹명][국문계열사명]" → 미국 나스닥/NYSE ticker 출력 = 오답)\n' +
  '❌ [영문브랜드+국문명] 입력 시 국문 고유명사를 무시하고 다른 글로벌 기업 사명으로 englishName 치환 금지.\n' +
  '❌ 한국 상장 종목에 market="US" 또는 krCode=null 출력 금지.\n' +
  '❌ 미국 상장 종목에 market="KR" 또는 krCode에 숫자 출력 금지.';

// ── productType 제약 빌더 ─────────────────────────────────────────────────────
// userProductType이 있으면 base 규칙 뒤에 최우선 제약 블록을 주입합니다.
function buildSystemInstruction(productType) {
  if (!productType) return SYSTEM_INSTRUCTION_BASE;

  const KR_TYPES = new Set(['국내주식', '국내ETF']);
  const US_TYPES = new Set(['해외주식', '해외ETF']);

  if (KR_TYPES.has(productType)) {
    const etfSuffix = productType === '국내ETF'
      ? '  ③-ETF: 국내ETF(KODEX·TIGER·KBSTAR·ARIRANG 등)는 대부분 KOSPI 상장 → ".KS" 우선.\n' +
        '         KOSDAQ 상장이 확실한 경우에만 ".KQ" 사용. 불확실하면 반드시 ".KS".\n'
      : '';
    return SYSTEM_INSTRUCTION_BASE +
      '\n\n━━━ 유저 지정 상품유형 제약 [최우선 적용] ━━━\n' +
      `입력 종목의 상품유형: "${productType}" (한국 거래소 상장)\n` +
      '  ① 글로벌 해외 상장 자산 완전 배제 — 오직 KOSPI/KOSDAQ 탐색.\n' +
      '  ② market: 반드시 "KR" 출력.\n' +
      '  ③ ticker: 반드시 6자리숫자.KS 또는 6자리숫자.KQ 형식.\n' +
      etfSuffix +
      '  ④ krCode: 해당 6자리 숫자 반드시 출력 (선행 0 포함).\n' +
      '  ⑤ englishName: 해당 한국 기업·ETF의 공식 영문 명칭 정확히 출력.\n' +
      '  ❌ 미국 심볼(AAPL, TSLA, NVDA 등) 반환 절대 금지.\n' +
      '  ❌ 6자리.KS/.KQ 외 형식의 ticker 반환 절대 금지.';
  }

  if (US_TYPES.has(productType)) {
    return SYSTEM_INSTRUCTION_BASE +
      '\n\n━━━ 유저 지정 상품유형 제약 [최우선 적용] ━━━\n' +
      `입력 종목의 상품유형: "${productType}" (해외 거래소 상장)\n` +
      '  ① 한국 거래소(KOSPI/KOSDAQ) 상장 종목 완전 배제 — 해외 시장 탐색.\n' +
      '  ② market: 반드시 "US" 출력.\n' +
      '  ③ ticker: 순수 알파벳 해외 심볼 (예: AAPL, TSLA, NVDA, SPY, SOXL).\n' +
      '  ④ krCode: 반드시 null 출력.\n' +
      '  ⑤ 한글 종목명을 즉시 영문으로 번역하여 가장 정확한 글로벌 티커 도출.\n' +
      '  ❌ 국내 6자리 숫자 티커(.KS/.KQ) 반환 절대 금지.\n' +
      '  ❌ market="KR" 또는 krCode에 숫자 출력 절대 금지.';
  }

  return SYSTEM_INSTRUCTION_BASE;
}

// ── KR 전용 격리 시스템 지침 ──────────────────────────────────────────────────
// 국내주식/국내ETF 전용 독립형 지침. SYSTEM_INSTRUCTION_BASE와 완전히 물리적으로 분리.
// 첫 문장에서 "KR 전용 봇"임을 선언하여 US 컨텍스트 형성을 원천 차단.
// "SK스퀘어 → SWKS" 같은 영문 prefix 연상 오류를 방지하는 명시적 금지 패턴 포함.
const KR_ONLY_SYSTEM_INSTRUCTION =
  '당신은 오직 대한민국 주식 시장(KOSPI/KOSDAQ)만 검색할 수 있는 금융 자산 분류 봇입니다. ' +
  '미국·유럽·일본 등 해외 시장 자산은 절대 탐색하지 마십시오. ' +
  '영문 알파벳이 포함된 한국 기업명(SK스퀘어·LG에너지솔루션·HD현대·KT·KB금융 등)은 ' +
  '한국 거래소(KOSPI/KOSDAQ)에 상장된 국내 기업으로 탐색해야 합니다. ' +
  '영문 글자를 보고 미국 나스닥/NYSE 심볼로 치환하는 행위는 치명적 오류입니다.\n\n' +
  '반드시 아래 JSON 형식 한 줄로만 응답하라. 설명·마크다운·코드블록 금지.\n' +
  '{"ticker":"6자리숫자.KS또는.KQ","englishName":"공식영문명","assetClass":"국내주식","productType":"...","country":"한국","market":"KR","krCode":"6자리숫자"}\n\n' +
  '━━━ 절대 규칙 ━━━\n' +
  '[규칙 1] KOSPI: 6자리숫자.KS  KOSDAQ: 6자리숫자.KQ  (접미사 절대 누락 금지)\n' +
  '[규칙 2] market: 반드시 "KR". 이 봇에서 "US" 출력은 절대 금지.\n' +
  '[규칙 3] krCode: 반드시 6자리 숫자 문자열 (선행 0 포함). null 출력 절대 금지.\n' +
  '[규칙 4] ticker: 알파벳 전용 미국 심볼(AAPL·TSLA·SWKS·NVDA 등) 출력 절대 금지.\n' +
  '[규칙 5] 티커 불명 시 ticker="UNKNOWN". englishName·krCode는 반드시 최선 추론.\n' +
  '[규칙 6] JSON 이외 텍스트 출력 절대 금지.\n\n' +
  '━━━ 절대 금지 패턴 (이 오류는 시스템 장애를 유발) ━━━\n' +
  '❌ SK스퀘어 → {"ticker":"SWKS","market":"US",...}  ← SK 글자=Skyworks 오인 금지\n' +
  '❌ 삼성전자 → {"ticker":"005930","market":"US",...}  ← .KS 누락 및 US 오분류 금지\n' +
  '❌ 어떤 입력이든 → {"market":"US","krCode":null}  ← KR 전용 봇에서 US 출력 금지';

/**
 * Gemini AI에 종목명 분석을 요청하여 티커 + 자산 메타데이터를 반환합니다.
 *
 * productType이 '국내주식'/'국내ETF'이면 KR 전용 격리 지침+프롬프트를 사용하여
 * Gemini의 US 연상 오류를 물리적으로 차단합니다.
 * route.js 는 market='KR'이면 krCode 로 Yahoo Search, 'US'이면 englishName 으로 검색합니다.
 */
export async function resolveTickerWithGemini(assetName, productType = null) {
  const apiKey =
    process.env.GEMINI_API_KEY ??
    process.env.NEXT_PUBLIC_GEMINI_API_KEY;

  if (!apiKey) {
    console.warn('[geminiTicker] API 키 미설정 — Gemini 티커 변환 건너뜀');
    return null;
  }

  const KR_TYPES_LOCAL = new Set(['국내주식', '국내ETF']);

  // ── 시스템 지침 및 유저 프롬프트 물리적 분리 ────────────────────────────────
  // KR 카테고리: 완전 격리된 KR 전용 지침 + KR 예시만 포함한 프롬프트
  // 일반/US: 기존 혼합 지침 + 혼합 예시 (기존 로직 유지)
  const sysInstrText = KR_TYPES_LOCAL.has(productType)
    ? KR_ONLY_SYSTEM_INSTRUCTION
    : buildSystemInstruction(productType);

  let userPrompt;

  if (KR_TYPES_LOCAL.has(productType)) {
    // ── KR 전용 프롬프트: US 예시 완전 배제 + 혼용어·SK스퀘어 명시 ────────────
    userPrompt =
      '━━━ 국내 종목 정답 예시 (이 봇이 출력할 수 있는 유일한 형식) ━━━\n' +
      '삼성전자 → {"ticker":"005930.KS","englishName":"Samsung Electronics","assetClass":"국내주식","productType":"국내주식","country":"한국","market":"KR","krCode":"005930"}\n' +
      'SK하이닉스 → {"ticker":"000660.KS","englishName":"SK Hynix","assetClass":"국내주식","productType":"국내주식","country":"한국","market":"KR","krCode":"000660"}\n' +
      'SK스퀘어 → {"ticker":"402340.KS","englishName":"SK Square","assetClass":"국내주식","productType":"국내주식","country":"한국","market":"KR","krCode":"402340"}\n' +
      'SK이노베이션 → {"ticker":"096770.KS","englishName":"SK Innovation","assetClass":"국내주식","productType":"국내주식","country":"한국","market":"KR","krCode":"096770"}\n' +
      'LG에너지솔루션 → {"ticker":"373220.KS","englishName":"LG Energy Solution","assetClass":"국내주식","productType":"국내주식","country":"한국","market":"KR","krCode":"373220"}\n' +
      'HD현대 → {"ticker":"267250.KS","englishName":"HD Hyundai","assetClass":"국내주식","productType":"국내주식","country":"한국","market":"KR","krCode":"267250"}\n' +
      '한화에어로스페이스 → {"ticker":"012450.KS","englishName":"Hanwha Aerospace","assetClass":"국내주식","productType":"국내주식","country":"한국","market":"KR","krCode":"012450"}\n' +
      '고려아연 → {"ticker":"010130.KS","englishName":"Korea Zinc","assetClass":"국내주식","productType":"국내주식","country":"한국","market":"KR","krCode":"010130"}\n' +
      '알테오젠 → {"ticker":"191170.KQ","englishName":"Alteogen","assetClass":"국내주식","productType":"국내주식","country":"한국","market":"KR","krCode":"191170"}\n' +
      '에코프로비엠 → {"ticker":"247540.KQ","englishName":"EcoPro BM","assetClass":"국내주식","productType":"국내주식","country":"한국","market":"KR","krCode":"247540"}\n' +
      '셀트리온 → {"ticker":"068270.KS","englishName":"Celltrion","assetClass":"국내주식","productType":"국내주식","country":"한국","market":"KR","krCode":"068270"}\n' +
      'KODEX 200 → {"ticker":"069500.KS","englishName":"KODEX 200 ETF","assetClass":"국내주식","productType":"국내ETF","country":"한국","market":"KR","krCode":"069500"}\n' +
      'TIGER 미국나스닥100 → {"ticker":"133690.KS","englishName":"TIGER US Nasdaq 100","assetClass":"해외주식","productType":"국내ETF","country":"한국","market":"KR","krCode":"133690"}\n\n' +
      '━━━ 절대 금지 오답 (이 형식으로 출력하면 시스템 장애 발생) ━━━\n' +
      '❌ SK스퀘어 → {"ticker":"SWKS","market":"US",...}  ← SK 글자만 보고 Skyworks 오인 절대 금지\n' +
      '❌ 삼성전자 → {"ticker":"005930","market":"US",...}  ← .KS 누락·US 오분류 절대 금지\n\n' +
      `유저 지정 상품유형: "${productType}" (한국 거래소 상장 종목만 탐색)\n` +
      `분석 대상: ${assetName}`;

  } else {
    // ── 일반/US 프롬프트: 기존 혼합 예시 유지 ──────────────────────────────────
    userPrompt =
      '━━━ 정답 예시 (✅) ━━━\n' +
      '삼성전자 → {"ticker":"005930.KS","englishName":"Samsung Electronics","assetClass":"국내주식","productType":"국내주식","country":"한국","market":"KR","krCode":"005930"}\n' +
      'SK하이닉스 → {"ticker":"000660.KS","englishName":"SK Hynix","assetClass":"국내주식","productType":"국내주식","country":"한국","market":"KR","krCode":"000660"}\n' +
      'LG에너지솔루션 → {"ticker":"373220.KS","englishName":"LG Energy Solution","assetClass":"국내주식","productType":"국내주식","country":"한국","market":"KR","krCode":"373220"}\n' +
      '고려아연 → {"ticker":"010130.KS","englishName":"Korea Zinc","assetClass":"국내주식","productType":"국내주식","country":"한국","market":"KR","krCode":"010130"}\n' +
      '알테오젠 → {"ticker":"191170.KQ","englishName":"Alteogen","assetClass":"국내주식","productType":"국내주식","country":"한국","market":"KR","krCode":"191170"}\n' +
      '한화에어로스페이스 → {"ticker":"012450.KS","englishName":"Hanwha Aerospace","assetClass":"국내주식","productType":"국내주식","country":"한국","market":"KR","krCode":"012450"}\n' +
      '에코프로비엠 → {"ticker":"247540.KQ","englishName":"EcoPro BM","assetClass":"국내주식","productType":"국내주식","country":"한국","market":"KR","krCode":"247540"}\n' +
      '셀트리온 → {"ticker":"068270.KS","englishName":"Celltrion","assetClass":"국내주식","productType":"국내주식","country":"한국","market":"KR","krCode":"068270"}\n' +
      'KODEX 200 → {"ticker":"069500.KS","englishName":"KODEX 200 ETF","assetClass":"국내주식","productType":"국내ETF","country":"한국","market":"KR","krCode":"069500"}\n' +
      'TIGER 미국나스닥100 → {"ticker":"133690.KS","englishName":"TIGER US Nasdaq 100","assetClass":"해외주식","productType":"국내ETF","country":"한국","market":"KR","krCode":"133690"}\n' +
      '애플 → {"ticker":"AAPL","englishName":"Apple","assetClass":"해외주식","productType":"해외주식","country":"미국","market":"US","krCode":null}\n' +
      '테슬라 → {"ticker":"TSLA","englishName":"Tesla","assetClass":"해외주식","productType":"해외주식","country":"미국","market":"US","krCode":null}\n' +
      '엔비디아 → {"ticker":"NVDA","englishName":"Nvidia","assetClass":"해외주식","productType":"해외주식","country":"미국","market":"US","krCode":null}\n' +
      '마이크로소프트 → {"ticker":"MSFT","englishName":"Microsoft","assetClass":"해외주식","productType":"해외주식","country":"미국","market":"US","krCode":null}\n' +
      '메타 → {"ticker":"META","englishName":"Meta Platforms","assetClass":"해외주식","productType":"해외주식","country":"미국","market":"US","krCode":null}\n' +
      'SPY → {"ticker":"SPY","englishName":"SPDR S&P 500 ETF","assetClass":"해외주식","productType":"해외ETF","country":"미국","market":"US","krCode":null}\n' +
      'SOXL → {"ticker":"SOXL","englishName":"Direxion Daily Semiconductor Bull 3X ETF","assetClass":"해외주식","productType":"해외ETF","country":"미국","market":"US","krCode":null}\n' +
      'TLT → {"ticker":"TLT","englishName":"iShares 20+ Year Treasury Bond ETF","assetClass":"해외채권","productType":"해외ETF","country":"미국","market":"US","krCode":null}\n\n' +
      '━━━ 오답 예시 (❌) ━━━\n' +
      '❌ 삼성전자 → {"ticker":"005930"}                    (.KS 누락)\n' +
      '❌ 삼성전자 → {"ticker":"SSNLF"}                    (OTC 장외 티커)\n' +
      '❌ KODEX 200 → {"productType":"국내주식"}           (ETF 오분류)\n' +
      '❌ 고려아연 → {"market":"US","krCode":null}          (한국 종목에 US 오분류)\n' +
      '❌ [영문브랜드+국문명] 입력 시 영문 글자만 보고 무관한 미국 티커 반환 금지\n\n' +
      `분석 대상: ${assetName}`;
  }

  const controller = new AbortController();
  const timeoutId  = setTimeout(() => controller.abort(), 6_000);

  try {
    const res = await fetch(`${GEMINI_ENDPOINT}?key=${apiKey}`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      signal:  controller.signal,
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: sysInstrText }] },
        contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
        generationConfig: {
          temperature:     0,
          maxOutputTokens: 300,
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
      return { ticker: fallbackTicker, englishName: null, assetClass: null, productType: null, country: null, market: null, krCode: null };
    }

    const rawTicker   = (parsed.ticker ?? '').trim();
    const englishName = typeof parsed.englishName === 'string' && parsed.englishName.trim()
      ? parsed.englishName.trim()
      : null;

    const assetClass  = ASSET_CLASS_SET.has(parsed.assetClass)   ? parsed.assetClass  : null;
    const productType = PRODUCT_TYPE_SET.has(parsed.productType) ? parsed.productType : null;
    const country     = COUNTRY_SET.has(parsed.country)          ? parsed.country     : null;

    // market: 'KR' | 'US' | null
    const market = MARKET_SET.has(parsed.market) ? parsed.market : null;

    // krCode: market='KR' 일 때만 6자리 숫자 문자열로 검증, 그 외 null
    const rawKrCode = typeof parsed.krCode === 'string'
      ? parsed.krCode.trim()
      : (typeof parsed.krCode === 'number' ? String(parsed.krCode).padStart(6, '0') : null);
    const krCode = (market === 'KR' && rawKrCode && KRCODE_RE.test(rawKrCode))
      ? rawKrCode
      : null;

    const isUnknown = !rawTicker || rawTicker.toUpperCase() === 'UNKNOWN' || !VALID_TICKER_RE.test(rawTicker);

    if (isUnknown) {
      // 티커 불명 — krCode 또는 englishName이 있으면 Yahoo Search 징검다리로 활용
      if (krCode || englishName) {
        console.log(`[geminiTicker] '${assetName}' → UNKNOWN 티커, market:'${market}' krCode:'${krCode}' englishName:'${englishName}'`);
        return { ticker: null, englishName, assetClass, productType, country, market, krCode };
      }
      console.log(`[geminiTicker] '${assetName}' → UNKNOWN 및 라우팅 정보 없음`);
      return null;
    }

    console.log(`[geminiTicker] '${assetName}' → ${JSON.stringify({ ticker: rawTicker, englishName, assetClass, productType, country, market, krCode })}`);
    return { ticker: rawTicker, englishName, assetClass, productType, country, market, krCode };

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
