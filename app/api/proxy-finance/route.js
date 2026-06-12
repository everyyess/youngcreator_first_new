/**
 * /api/proxy-finance
 * GET: ?assetName=... → 정적 딕셔너리 → Gemini AI → Yahoo Search API → Yahoo Finance 시계열 반환
 *
 * 브라우저의 CORS 제약을 우회하는 Next.js App Router 서버 프록시.
 * 1단계: 정적 티커 딕셔너리 (즉시 반환)
 * 2단계: Gemini AI 티커 변환 (한글·약어 입력 시 자동 활성화)
 * 3단계: Yahoo Finance Autocomplete Search API 로 티커 자동 완성
 * 4단계: Yahoo Finance v8 차트 API 로 월봉 시계열 반환
 */

export const runtime = 'nodejs';

import { resolveTickerWithGemini } from '../../../utils/geminiTicker.js';

// ══════════════════════════════════════════════════════════════════
// Static Mapping Master — 국내 대형주 공식 티커 영구 고정 테이블
// ──────────────────────────────────────────────────────────────────
// Gemini / Yahoo 결과와 무관하게 이 테이블이 최우선 오버라이드.
// 계열사 합병·분할·리스팅 변경 이력이 있는 종목은 구형 코드 사용을
// 원천 차단하기 위해 별도 코멘트로 이전 티커를 명시해 둔다.
// 키: 소문자 + 공백 제거 (normalizedInput 과 1:1 매칭)
const DOMESTIC_STATIC_MASTER = {
  // ── 삼성 그룹 ────────────────────────────────────────────────
  '삼성전자':         { ticker: '005930.KS', assetClass: '국내주식', productType: '개별주식', country: '한국' },
  '삼전':             { ticker: '005930.KS', assetClass: '국내주식', productType: '개별주식', country: '한국' },
  '삼성전자우':       { ticker: '005935.KS', assetClass: '국내주식', productType: '개별주식', country: '한국' },
  // 삼성물산: 2015년 제일모직(028260)에 흡수합병. 구코드 000830 사용 금지.
  '삼성물산':         { ticker: '028260.KS', assetClass: '국내주식', productType: '개별주식', country: '한국' },
  '삼성물산주식':     { ticker: '028260.KS', assetClass: '국내주식', productType: '개별주식', country: '한국' },
  '삼성c&t':          { ticker: '028260.KS', assetClass: '국내주식', productType: '개별주식', country: '한국' },
  '삼성전기':         { ticker: '009150.KS', assetClass: '국내주식', productType: '개별주식', country: '한국' },
  '삼성sdi':          { ticker: '006400.KS', assetClass: '국내주식', productType: '개별주식', country: '한국' },
  '삼성바이오로직스': { ticker: '207940.KS', assetClass: '국내주식', productType: '개별주식', country: '한국' },
  '삼성바이오':       { ticker: '207940.KS', assetClass: '국내주식', productType: '개별주식', country: '한국' },
  '삼성생명':         { ticker: '032830.KS', assetClass: '국내주식', productType: '개별주식', country: '한국' },
  '삼성화재':         { ticker: '000810.KS', assetClass: '국내주식', productType: '개별주식', country: '한국' },
  '삼성증권':         { ticker: '016360.KS', assetClass: '국내주식', productType: '개별주식', country: '한국' },
  '제일기획':         { ticker: '030000.KS', assetClass: '국내주식', productType: '개별주식', country: '한국' },
  // ── SK 그룹 ─────────────────────────────────────────────────
  'sk하이닉스':       { ticker: '000660.KS', assetClass: '국내주식', productType: '개별주식', country: '한국' },
  '하이닉스':         { ticker: '000660.KS', assetClass: '국내주식', productType: '개별주식', country: '한국' },
  'sk텔레콤':         { ticker: '017670.KS', assetClass: '국내주식', productType: '개별주식', country: '한국' },
  'skt':              { ticker: '017670.KS', assetClass: '국내주식', productType: '개별주식', country: '한국' },
  'sk이노베이션':     { ticker: '096770.KS', assetClass: '국내주식', productType: '개별주식', country: '한국' },
  'sk이노':           { ticker: '096770.KS', assetClass: '국내주식', productType: '개별주식', country: '한국' },
  'sk바이오팜':       { ticker: '326030.KS', assetClass: '국내주식', productType: '개별주식', country: '한국' },
  'sk네트웍스':       { ticker: '001740.KS', assetClass: '국내주식', productType: '개별주식', country: '한국' },
  // ── LG 그룹 ─────────────────────────────────────────────────
  'lg전자':           { ticker: '066570.KS', assetClass: '국내주식', productType: '개별주식', country: '한국' },
  'lg화학':           { ticker: '051910.KS', assetClass: '국내주식', productType: '개별주식', country: '한국' },
  'lg에너지솔루션':   { ticker: '373220.KS', assetClass: '국내주식', productType: '개별주식', country: '한국' },
  'lges':             { ticker: '373220.KS', assetClass: '국내주식', productType: '개별주식', country: '한국' },
  'lg디스플레이':     { ticker: '034220.KS', assetClass: '국내주식', productType: '개별주식', country: '한국' },
  'lgd':              { ticker: '034220.KS', assetClass: '국내주식', productType: '개별주식', country: '한국' },
  'lg유플러스':       { ticker: '032640.KS', assetClass: '국내주식', productType: '개별주식', country: '한국' },
  'lgu+':             { ticker: '032640.KS', assetClass: '국내주식', productType: '개별주식', country: '한국' },
  'lg이노텍':         { ticker: '011070.KS', assetClass: '국내주식', productType: '개별주식', country: '한국' },
  // ── 현대 그룹 ────────────────────────────────────────────────
  '현대차':           { ticker: '005380.KS', assetClass: '국내주식', productType: '개별주식', country: '한국' },
  '현대자동차':       { ticker: '005380.KS', assetClass: '국내주식', productType: '개별주식', country: '한국' },
  '기아':             { ticker: '000270.KS', assetClass: '국내주식', productType: '개별주식', country: '한국' },
  '기아차':           { ticker: '000270.KS', assetClass: '국내주식', productType: '개별주식', country: '한국' },
  '현대모비스':       { ticker: '012330.KS', assetClass: '국내주식', productType: '개별주식', country: '한국' },
  '현대건설':         { ticker: '000720.KS', assetClass: '국내주식', productType: '개별주식', country: '한국' },
  '현대중공업지주':   { ticker: '267250.KS', assetClass: '국내주식', productType: '개별주식', country: '한국' },
  'hd현대':           { ticker: '267250.KS', assetClass: '국내주식', productType: '개별주식', country: '한국' },
  '현대글로비스':     { ticker: '086280.KS', assetClass: '국내주식', productType: '개별주식', country: '한국' },
  '현대위아':         { ticker: '011210.KS', assetClass: '국내주식', productType: '개별주식', country: '한국' },
  // ── POSCO 그룹 ───────────────────────────────────────────────
  'posco홀딩스':      { ticker: '005490.KS', assetClass: '국내주식', productType: '개별주식', country: '한국' },
  'posco':            { ticker: '005490.KS', assetClass: '국내주식', productType: '개별주식', country: '한국' },
  '포스코홀딩스':     { ticker: '005490.KS', assetClass: '국내주식', productType: '개별주식', country: '한국' },
  '포스코퓨처엠':     { ticker: '003670.KS', assetClass: '국내주식', productType: '개별주식', country: '한국' },
  '포스코dx':         { ticker: '022100.KS', assetClass: '국내주식', productType: '개별주식', country: '한국' },
  '포스코인터내셔널': { ticker: '047050.KS', assetClass: '국내주식', productType: '개별주식', country: '한국' },
  // ── 한화 그룹 ────────────────────────────────────────────────
  '한화에어로스페이스': { ticker: '012450.KS', assetClass: '국내주식', productType: '개별주식', country: '한국' },
  '한화에어로':       { ticker: '012450.KS', assetClass: '국내주식', productType: '개별주식', country: '한국' },
  '한화솔루션':       { ticker: '009830.KS', assetClass: '국내주식', productType: '개별주식', country: '한국' },
  '한화오션':         { ticker: '042660.KS', assetClass: '국내주식', productType: '개별주식', country: '한국' },
  '한화비전':         { ticker: '213420.KS', assetClass: '국내주식', productType: '개별주식', country: '한국' },
  // ── 금융 그룹 ────────────────────────────────────────────────
  'kb금융':           { ticker: '105560.KS', assetClass: '국내주식', productType: '개별주식', country: '한국' },
  '신한지주':         { ticker: '055550.KS', assetClass: '국내주식', productType: '개별주식', country: '한국' },
  '신한금융지주':     { ticker: '055550.KS', assetClass: '국내주식', productType: '개별주식', country: '한국' },
  '하나금융지주':     { ticker: '086790.KS', assetClass: '국내주식', productType: '개별주식', country: '한국' },
  '우리금융지주':     { ticker: '316140.KS', assetClass: '국내주식', productType: '개별주식', country: '한국' },
  '메리츠금융지주':   { ticker: '138040.KS', assetClass: '국내주식', productType: '개별주식', country: '한국' },
  '미래에셋증권':     { ticker: '006800.KS', assetClass: '국내주식', productType: '개별주식', country: '한국' },
  '한국금융지주':     { ticker: '071050.KS', assetClass: '국내주식', productType: '개별주식', country: '한국' },
  // ── 통신 ────────────────────────────────────────────────────
  'kt':               { ticker: '030200.KS', assetClass: '국내주식', productType: '개별주식', country: '한국' },
  'kt&g':             { ticker: '033780.KS', assetClass: '국내주식', productType: '개별주식', country: '한국' },
  // ── 바이오·헬스케어 ──────────────────────────────────────────
  '셀트리온':         { ticker: '068270.KS', assetClass: '국내주식', productType: '개별주식', country: '한국' },
  '유한양행':         { ticker: '000100.KS', assetClass: '국내주식', productType: '개별주식', country: '한국' },
  '한미약품':         { ticker: '128940.KS', assetClass: '국내주식', productType: '개별주식', country: '한국' },
  // ── 기타 대형주 ──────────────────────────────────────────────
  '카카오':           { ticker: '035720.KS', assetClass: '국내주식', productType: '개별주식', country: '한국' },
  '카카오코프':       { ticker: '035720.KS', assetClass: '국내주식', productType: '개별주식', country: '한국' },
  '네이버':           { ticker: '035420.KS', assetClass: '국내주식', productType: '개별주식', country: '한국' },
  'naver':            { ticker: '035420.KS', assetClass: '국내주식', productType: '개별주식', country: '한국' },
  '맥쿼리인프라':     { ticker: '088980.KS', assetClass: '리츠',     productType: '개별주식', country: '한국' },
  'cj제일제당':       { ticker: '097950.KS', assetClass: '국내주식', productType: '개별주식', country: '한국' },
  '롯데케미칼':       { ticker: '011170.KS', assetClass: '국내주식', productType: '개별주식', country: '한국' },
  '두산에너빌리티':   { ticker: '034020.KS', assetClass: '국내주식', productType: '개별주식', country: '한국' },
  '두산밥캣':         { ticker: '241560.KS', assetClass: '국내주식', productType: '개별주식', country: '한국' },
  '두산로보틱스':     { ticker: '454910.KS', assetClass: '국내주식', productType: '개별주식', country: '한국' },
};

// ── 1단계: 정적 Fallback 딕셔너리 (ticker + 완전한 메타데이터) ──
// 키: 소문자 + 공백 제거 (normalizedInput 과 1:1 매칭)
// 값: { ticker, assetClass, productType, country }
// 여기 등록된 종목은 Gemini/Yahoo 호출 없이 0초에 완전한 규격 데이터 반환
const FALLBACK_ASSET_DICT = {
  // ── 국내 주식 (이미 DOMESTIC_STATIC_MASTER에 포함 — 중복 등록으로 호환 유지) ──
  '삼성전자':   { ticker: '005930.KS', assetClass: '국내주식', productType: '개별주식', country: '한국' },
  '삼전':       { ticker: '005930.KS', assetClass: '국내주식', productType: '개별주식', country: '한국' },
  'sk하이닉스': { ticker: '000660.KS', assetClass: '국내주식', productType: '개별주식', country: '한국' },
  'sk하이닉스(000660)': { ticker: '000660.KS', assetClass: '국내주식', productType: '개별주식', country: '한국' },
  '하이닉스':   { ticker: '000660.KS', assetClass: '국내주식', productType: '개별주식', country: '한국' },
  '카카오':     { ticker: '035720.KS', assetClass: '국내주식', productType: '개별주식', country: '한국' },
  '카카오코프': { ticker: '035720.KS', assetClass: '국내주식', productType: '개별주식', country: '한국' },
  '맥쿼리인프라': { ticker: '088980.KS', assetClass: '리츠',    productType: '개별주식', country: '한국' },
  'lg에너지솔루션': { ticker: '373220.KS', assetClass: '국내주식', productType: '개별주식', country: '한국' },
  '현대차':     { ticker: '005380.KS', assetClass: '국내주식', productType: '개별주식', country: '한국' },
  '기아':       { ticker: '000270.KS', assetClass: '국내주식', productType: '개별주식', country: '한국' },
  'posco홀딩스': { ticker: '005490.KS', assetClass: '국내주식', productType: '개별주식', country: '한국' },
  // ── 국내 ETF ───────────────────────────────────────────────
  'tiger미국나스닥100':  { ticker: '133690.KS', assetClass: '해외주식', productType: 'ETF', country: '한국' },
  'tiger미국s&p500':    { ticker: '360750.KS', assetClass: '해외주식', productType: 'ETF', country: '한국' },
  'tiger미국sp500':     { ticker: '360750.KS', assetClass: '해외주식', productType: 'ETF', country: '한국' },
  'kodex200':           { ticker: '069500.KS', assetClass: '국내주식', productType: 'ETF', country: '한국' },
  'kodex미국나스닥100': { ticker: '379800.KS', assetClass: '해외주식', productType: 'ETF', country: '한국' },
  // ── 미국 대형주 ────────────────────────────────────────────
  '테슬라':  { ticker: 'TSLA', assetClass: '해외주식', productType: '개별주식', country: '미국' },
  '애플':    { ticker: 'AAPL', assetClass: '해외주식', productType: '개별주식', country: '미국' },
  '엔비디아': { ticker: 'NVDA', assetClass: '해외주식', productType: '개별주식', country: '미국' },
  '마이크로소프트': { ticker: 'MSFT', assetClass: '해외주식', productType: '개별주식', country: '미국' },
  '구글':    { ticker: 'GOOGL', assetClass: '해외주식', productType: '개별주식', country: '미국' },
  '아마존':  { ticker: 'AMZN', assetClass: '해외주식', productType: '개별주식', country: '미국' },
  '메타':    { ticker: 'META', assetClass: '해외주식', productType: '개별주식', country: '미국' },
  'nvda':    { ticker: 'NVDA', assetClass: '해외주식', productType: '개별주식', country: '미국' },
  'nvidia':  { ticker: 'NVDA', assetClass: '해외주식', productType: '개별주식', country: '미국' },
  'nvdia':   { ticker: 'NVDA', assetClass: '해외주식', productType: '개별주식', country: '미국' }, // 오타 방어
  'tsla':    { ticker: 'TSLA', assetClass: '해외주식', productType: '개별주식', country: '미국' },
  'aapl':    { ticker: 'AAPL', assetClass: '해외주식', productType: '개별주식', country: '미국' },
  'msft':    { ticker: 'MSFT', assetClass: '해외주식', productType: '개별주식', country: '미국' },
  'googl':   { ticker: 'GOOGL', assetClass: '해외주식', productType: '개별주식', country: '미국' },
  'amzn':    { ticker: 'AMZN', assetClass: '해외주식', productType: '개별주식', country: '미국' },
  'meta':    { ticker: 'META', assetClass: '해외주식', productType: '개별주식', country: '미국' },
  // ── 미국 ETF / 채권 ────────────────────────────────────────
  'spy':     { ticker: 'SPY',  assetClass: '해외주식', productType: 'ETF', country: '미국' },
  'qqq':     { ticker: 'QQQ',  assetClass: '해외주식', productType: 'ETF', country: '미국' },
  'voo':     { ticker: 'VOO',  assetClass: '해외주식', productType: 'ETF', country: '미국' },
  'ivv':     { ticker: 'IVV',  assetClass: '해외주식', productType: 'ETF', country: '미국' },
  'schd':    { ticker: 'SCHD', assetClass: '해외주식', productType: 'ETF', country: '미국' },
  'tlt':     { ticker: 'TLT',  assetClass: '해외채권', productType: 'ETF', country: '미국' },
  'ief':     { ticker: 'IEF',  assetClass: '해외채권', productType: 'ETF', country: '미국' },
  'agg':     { ticker: 'AGG',  assetClass: '해외채권', productType: 'ETF', country: '미국' },
  'bnd':     { ticker: 'BND',  assetClass: '해외채권', productType: 'ETF', country: '미국' },
  'gld':     { ticker: 'GLD',  assetClass: '금',       productType: 'ETF', country: '미국' },
  'iau':     { ticker: 'IAU',  assetClass: '금',       productType: 'ETF', country: '미국' },
  'vnq':     { ticker: 'VNQ',  assetClass: '리츠',     productType: 'ETF', country: '미국' },
  // ── 원자재 선물 ────────────────────────────────────────────
  '국제금':   { ticker: 'GC=F', assetClass: '금', productType: 'ETF', country: '미국' },
  '금':       { ticker: 'GC=F', assetClass: '금', productType: 'ETF', country: '미국' },
  '국제원유': { ticker: 'CL=F', assetClass: '금', productType: 'ETF', country: '미국' },
  '원유':     { ticker: 'CL=F', assetClass: '금', productType: 'ETF', country: '미국' },
  '천연가스': { ticker: 'NG=F', assetClass: '금', productType: 'ETF', country: '미국' },
  // ── 암호화폐 ───────────────────────────────────────────────
  '비트코인': { ticker: 'BTC-USD', assetClass: '해외주식', productType: '암호화폐', country: '미국' },
  '이더리움': { ticker: 'ETH-USD', assetClass: '해외주식', productType: '암호화폐', country: '미국' },
  'btc':      { ticker: 'BTC-USD', assetClass: '해외주식', productType: '암호화폐', country: '미국' },
  'eth':      { ticker: 'ETH-USD', assetClass: '해외주식', productType: '암호화폐', country: '미국' },
  // ── 지수 ───────────────────────────────────────────────────
  's&p500':   { ticker: '^GSPC', assetClass: '해외주식', productType: 'ETF', country: '미국' },
  'sp500':    { ticker: '^GSPC', assetClass: '해외주식', productType: 'ETF', country: '미국' },
  '나스닥':   { ticker: '^IXIC', assetClass: '해외주식', productType: 'ETF', country: '미국' },
  // ── 환율 ───────────────────────────────────────────────────
  'krw=x':    { ticker: 'KRW=X', assetClass: '달러', productType: '외화', country: '미국' },
  'usdkrw':   { ticker: 'KRW=X', assetClass: '달러', productType: '외화', country: '미국' },
  '달러환율': { ticker: 'KRW=X', assetClass: '달러', productType: '외화', country: '미국' },
};

// ── 포괄적 검색어 차단 사전 ──────────────────────────────────
// 계열사가 많은 그룹사 명칭 입력 시 단일 종목으로 강제 매칭되는 오류를 방지합니다.
// 키: 정규화 입력값(소문자 + 공백 제거), 값: 사용자에게 안내할 구체적 종목명 예시
const AMBIGUOUS_KEYWORDS = new Map([
  ['삼성',  "'삼성전자', '삼성SDI', '삼성바이오로직스'"],
  ['현대',  "'현대차', '현대모비스', '현대건설'"],
  ['sk',    "'SK하이닉스', 'SK이노베이션', 'SK텔레콤'"],
  ['lg',    "'LG전자', 'LG에너지솔루션', 'LG화학'"],
  ['한화',  "'한화에어로스페이스', '한화솔루션', '한화오션'"],
  ['롯데',  "'롯데쇼핑', '롯데케미칼', '롯데칠성'"],
  ['cj',    "'CJ제일제당', 'CJ CGV', 'CJ ENM'"],
  ['gs',    "'GS리테일', 'GS건설'"],
  ['두산',  "'두산에너빌리티', '두산밥캣', '두산로보틱스'"],
  ['포스코', "'POSCO홀딩스', '포스코퓨처엠', '포스코DX'"],
  ['코오롱', "'코오롱인더', '코오롱글로벌'"],
  ['신한',  "'신한지주', '신한라이프'"],
  ['하나',  "'하나금융지주', '하나은행'"],
  ['kb',    "'KB금융', 'KB증권'"],
]);

// ── 한글 포함 여부 판별 — Gemini 호출 게이트 ─────────────────
// Hangul 음절(AC00-D7AF) + 자모(1100-11FF, 3130-318F) 범위
function hasKorean(str) {
  return /[가-힯ᄀ-ᇿ㄰-㆏]/.test(str);
}

// ── 한국 6자리 코드에 .KS/.KQ 접미사 자동 보완 ─────────────────
// KOSPI/KOSDAQ 종목은 6자리 숫자. 접미사 없이 반환되면 yfinance 조회가 실패하므로
// 순수 6자리 숫자 티커는 무조건 .KS 를 붙인다 (KOSDAQ은 Gemini가 .KQ로 반환).
function ensureKoreanSuffix(ticker) {
  if (!ticker) return ticker;
  const trimmed = ticker.trim();
  if (/^\d{6}$/.test(trimmed)) return trimmed + '.KS';
  return trimmed;
}

// ── 티커 패턴 기반 메타데이터 추론 (Gemini 미사용 경로 Fallback) ──
function inferMetaFromTicker(ticker) {
  if (!ticker) return { assetClass: '해외주식', productType: '개별주식', country: '미국' };
  const t = ticker.toUpperCase();
  if (t.endsWith('.KS') || t.endsWith('.KQ'))
    return { assetClass: '국내주식', productType: '개별주식', country: '한국' };
  if (t.endsWith('=F'))
    return { assetClass: '금', productType: 'ETF', country: '미국' };
  if (t.endsWith('=X'))
    return { assetClass: '달러', productType: '외화', country: '미국' };
  if (t.includes('-USD') || t.includes('-BTC'))
    return { assetClass: '해외주식', productType: '암호화폐', country: '미국' };
  if (t.startsWith('^'))
    return { assetClass: '해외주식', productType: 'ETF', country: '미국' };
  if (t.endsWith('.T'))
    return { assetClass: '해외주식', productType: '개별주식', country: '일본' };
  if (t.endsWith('.HK') || t.endsWith('.SS') || t.endsWith('.SZ'))
    return { assetClass: '해외주식', productType: '개별주식', country: '중국' };
  return { assetClass: '해외주식', productType: '개별주식', country: '미국' };
}

// ── 공통 브라우저 헤더 – 봇 차단(403) 우회 ───────────────────
const BROWSER_HEADERS = {
  'User-Agent':      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept':          'application/json, text/plain, */*',
  'Accept-Language': 'en-US,en;q=0.9',
  'Referer':         'https://finance.yahoo.com/',
  'Origin':          'https://finance.yahoo.com',
};

// ── 타임아웃 유틸: AbortController 기반 ──────────────────────
/**
 * 지정된 시간 안에 응답이 없으면 요청을 중단(abort)하고
 * isTimeout=true 플래그가 달린 Error 를 throw 합니다.
 *
 * @param {string}      url
 * @param {RequestInit} options
 * @param {number}      timeoutMs  (기본 8000ms)
 * @returns {Promise<Response>}
 * @throws {Error} isTimeout=true
 */
async function fetchWithTimeout(url, options, timeoutMs = 8_000) {
  const controller = new AbortController();
  const timeoutId  = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    clearTimeout(timeoutId);
    return res;
  } catch (err) {
    clearTimeout(timeoutId);
    if (err.name === 'AbortError') {
      const timeoutErr = new Error('외부 금융 서버 응답이 지연되고 있습니다.');
      timeoutErr.isTimeout = true;
      throw timeoutErr;
    }
    throw err;
  }
}

// ── 안전한 JSON 파싱 유틸 ─────────────────────────────────────
/**
 * 야후 서버가 HTML(점검·차단 페이지)을 반환할 때 res.json() 이 터지는 것을 방지.
 * 파싱 실패 시 null 을 반환합니다.
 *
 * @param {Response} res
 * @returns {Promise<object|null>}
 */
async function safeJson(res) {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

// ── 2단계: Yahoo Finance Search API 티커 자동 완성 ─────────────
/**
 * 자산명(한글/영문 무관)을 Yahoo Finance Search API 로 조회하여
 * 유효한 quoteType 중 최상단 결과의 symbol 을 반환합니다.
 *
 * @param {string} query  원본 사용자 입력값 (검색 정확도를 위해 정규화 전 값 사용)
 * @returns {Promise<string>} Yahoo Finance ticker symbol
 * @throws {Error} isTimeout / isRateLimit / isParseError / notFound
 *
 * 검증 예시:
 *   fetchTickerFromYahoo('카카오')  → '035720.KS'
 *   fetchTickerFromYahoo('테슬라')  → 'TSLA'
 */
/**
 * Yahoo Finance Search API 로 티커 조회.
 * 400/404/파싱 오류 등 복구 불가 실패 시 null 반환 (throw 하지 않음).
 * timeout(504) / rate-limit(429) 만 throw 하여 상위에서 HTTP 에러로 전달.
 *
 * @param {string} query  영문 또는 정규화된 검색어
 * @returns {Promise<string|null>} 티커 또는 null
 */
async function fetchTickerFromYahoo(query) {
  if (!query?.trim()) return null;

  const searchUrl =
    `https://query1.finance.yahoo.com/v1/finance/search` +
    `?q=${encodeURIComponent(query)}&lang=en-US&region=US&quotesCount=6&newsCount=0`;

  // ① 타임아웃 fetch — timeout 만 throw 전파
  let res;
  try {
    res = await fetchWithTimeout(searchUrl, { headers: BROWSER_HEADERS }, 8_000);
  } catch (netErr) {
    if (netErr.isTimeout) throw netErr;
    console.warn(`[proxy-finance] Yahoo Search 네트워크 오류 (${query}): ${netErr?.message}`);
    return null;
  }

  // ② 429 Rate Limit — throw 전파 (caller 가 429 응답 반환)
  if (res.status === 429) {
    const err = new Error('요청이 너무 많습니다. 잠시 후 다시 시도해주세요.');
    err.isRateLimit = true;
    throw err;
  }

  // ③ 400/404 등 비정상 응답 → null 반환 (크래시 없이 폴백)
  if (!res.ok) {
    console.warn(`[proxy-finance] Yahoo Search HTTP ${res.status} (${query}) — null 반환`);
    return null;
  }

  // ④ 안전한 JSON 파싱 실패 → null 반환
  const json = await safeJson(res);
  if (!json) {
    console.warn(`[proxy-finance] Yahoo Search JSON 파싱 실패 (${query}) — null 반환`);
    return null;
  }

  const allQuotes = json?.quotes ?? [];
  const VALID_QUOTE_TYPES = new Set([
    'EQUITY', 'ETF', 'INDEX', 'CURRENCY', 'CRYPTOCURRENCY', 'FUTURE', 'MUTUALFUND',
  ]);
  const quotes = allQuotes.filter(q => VALID_QUOTE_TYPES.has(q.quoteType));

  if (quotes.length === 0) {
    console.warn(`[proxy-finance] 티커 미발견: '${query}' (전체 ${allQuotes.length}건) — null 반환`);
    return null;
  }

  return String(quotes[0].symbol).trim();
}

// ── Route Handler ─────────────────────────────────────────────
export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const assetName = searchParams.get('assetName')?.trim();

  if (!assetName || assetName.trim() === '') {
    return Response.json(
      { error: '검색할 자산명을 입력해주세요.' },
      { status: 400 }
    );
  }

  // 정규화: 소문자 + 공백 제거 → 딕셔너리 조회 전용
  // (Yahoo Search 호출엔 원본 assetName 전달 – 검색 정확도 유지)
  const normalizedInput = assetName.toLowerCase().replace(/\s+/g, '');

  // ── 포괄적 검색어 Early Return ────────────────────────────────
  // 그룹사 대표 명칭이 입력되면 하위 로직 실행 전에 즉시 차단합니다.
  const ambiguousExamples = AMBIGUOUS_KEYWORDS.get(normalizedInput);
  if (ambiguousExamples) {
    return Response.json(
      {
        error: `입력하신 '${assetName}'은(는) 여러 계열사가 존재합니다. ${ambiguousExamples}처럼 정확한 종목명을 입력해주세요.`,
        assetName,
      },
      { status: 400 }
    );
  }

  // 1순위: Static Mapping Master → FALLBACK_ASSET_DICT 순으로 조회
  // DOMESTIC_STATIC_MASTER 가 우선 — Gemini 결과와 무관하게 공식 티커를 보장한다
  const dictEntry = DOMESTIC_STATIC_MASTER[normalizedInput] ?? FALLBACK_ASSET_DICT[normalizedInput] ?? null;
  let ticker    = dictEntry?.ticker ? ensureKoreanSuffix(dictEntry.ticker) : null;
  let assetMeta = dictEntry
    ? { assetClass: dictEntry.assetClass, productType: dictEntry.productType, country: dictEntry.country }
    : { assetClass: null, productType: null, country: null };

  // Yahoo Search에 전달할 검색어 — 한글이면 Gemini englishName으로 교체
  let yahooSearchQuery = assetName;

  // 2순위: Gemini AI 티커 + 메타데이터 + 영문명 변환 (한글 입력이고 정적 딕셔너리 미매칭 시)
  if (!ticker && hasKorean(assetName)) {
    const geminiResult = await resolveTickerWithGemini(assetName);
    if (geminiResult) {
      // Gemini가 6자리 숫자만 반환할 경우 .KS 자동 보완
      if (geminiResult.ticker) ticker = ensureKoreanSuffix(geminiResult.ticker);
      assetMeta = {
        assetClass:  geminiResult.assetClass  ?? null,
        productType: geminiResult.productType ?? null,
        country:     geminiResult.country     ?? null,
      };
      // 티커 미확정이더라도 englishName이 있으면 Yahoo 검색어를 영문으로 교체
      if (!ticker && geminiResult.englishName) {
        yahooSearchQuery = geminiResult.englishName;
        console.log(`[proxy-finance] Yahoo 검색어 교체: '${assetName}' → '${yahooSearchQuery}'`);
      }
    }
  }

  // 3순위: Yahoo Finance Search API (영문 검색어 우선 사용)
  if (!ticker) {
    try {
      const searchResult = await fetchTickerFromYahoo(yahooSearchQuery);
      if (searchResult) {
        // Yahoo Search 결과도 6자리 숫자면 .KS 보완
        ticker = ensureKoreanSuffix(searchResult);
      } else {
        // null 반환 = 400/404/파싱 실패 등 → 404 응답
        return Response.json(
          { error: `'${assetName}'에 해당하는 티커를 찾을 수 없습니다.`, assetName },
          { status: 404 }
        );
      }
    } catch (searchErr) {
      if (searchErr.isTimeout)
        return Response.json({ error: searchErr.message, assetName }, { status: 504 });
      if (searchErr.isRateLimit)
        return Response.json({ error: searchErr.message, assetName }, { status: 429 });
      console.warn('[proxy-finance] Yahoo Search 예외:', searchErr?.message);
      return Response.json({ error: '티커 검색 중 오류가 발생했습니다.', assetName }, { status: 500 });
    }
  }

  // Gemini 미호출 경로(정적 딕셔너리 / Yahoo) 에서 메타데이터가 없으면 규칙 기반 추론
  if (!assetMeta.assetClass) {
    assetMeta = inferMetaFromTicker(ticker);
  }

  // 3단계: Yahoo Finance v8 시계열 fetch (CORS 우회)
  const endTs   = Math.floor(Date.now() / 1000);
  const startTs = endTs - 3 * 365 * 24 * 3600;
  const yahooUrl =
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}` +
    `?period1=${startTs}&period2=${endTs}&interval=1mo&events=history`;

  // ① 타임아웃 fetch
  let chartRes;
  try {
    chartRes = await fetchWithTimeout(yahooUrl, { headers: BROWSER_HEADERS }, 8_000);
  } catch (fetchErr) {
    if (fetchErr.isTimeout)
      return Response.json({ error: fetchErr.message, ticker }, { status: 504 });
    console.error(`[proxy-finance] Yahoo Finance fetch 실패 (${ticker}):`, fetchErr?.message);
    return Response.json({ error: fetchErr.message, ticker }, { status: 502 });
  }

  // ② 429 Rate Limit 명시 처리
  if (chartRes.status === 429) {
    console.warn(`[proxy-finance] Yahoo Chart 429 Rate Limit (${ticker})`);
    return Response.json(
      { error: '요청이 너무 많습니다. 잠시 후 다시 시도해주세요.', ticker },
      { status: 429 }
    );
  }

  if (!chartRes.ok) {
    console.error(`[proxy-finance] Yahoo Finance HTTP ${chartRes.status} (${ticker})`);
    return Response.json(
      { error: `Yahoo Finance HTTP ${chartRes.status}`, ticker },
      { status: 502 }
    );
  }

  // ③ 안전한 JSON 파싱
  const yahooJson = await safeJson(chartRes);
  if (!yahooJson) {
    console.error(`[proxy-finance] Chart JSON 파싱 실패 (${ticker}): HTML 응답 추정`);
    return Response.json(
      { error: '금융 데이터 파싱 중 오류가 발생했습니다.', ticker },
      { status: 502 }
    );
  }

  // 데이터 무결성 검증 – 상장폐지/거래정지 종목 크래시 방지
  if (yahooJson.chart?.error) {
    const msg = yahooJson.chart.error.description ?? '야후 파이낸스 오류';
    console.error(`[proxy-finance] Chart API 오류 (${ticker}):`, msg);
    return Response.json({ error: msg, ticker }, { status: 404 });
  }

  const closes = yahooJson.chart?.result?.[0]?.indicators?.quote?.[0]?.close ?? [];
  if (closes.length === 0) {
    console.error(`[proxy-finance] 빈 데이터 (${ticker}): 상장폐지 또는 거래정지 종목으로 추정`);
    return Response.json(
      { error: '거래가 정지되거나 상장 폐지된 종목입니다.', ticker },
      { status: 404 }
    );
  }

  return Response.json({ ticker, ...assetMeta, ...yahooJson });
}
