import type { PortfolioAsset } from "./CustomerContext";

// 글로벌 주요 기업 한글 번역 사전 — 해외 종목명 로컬라이징 기준
export const GLOBAL_COMPANY_KR_MAP: Record<string, string> = {
  // US Mega Cap
  AAPL: "애플",
  MSFT: "마이크로소프트",
  GOOGL: "알파벳",
  GOOG: "알파벳",
  AMZN: "아마존",
  META: "메타",
  TSLA: "테슬라",
  NVDA: "엔비디아",
  "BRK.B": "버크셔해서웨이",
  "BRK.A": "버크셔해서웨이",
  V: "비자",
  MA: "마스터카드",
  // Semiconductor / Tech
  AMD: "AMD",
  INTC: "인텔",
  QCOM: "퀄컴",
  AVGO: "브로드컴",
  TSM: "TSMC",
  ASML: "ASML",
  SMCI: "슈퍼마이크로컴퓨터",
  ARM: "ARM홀딩스",
  MU: "마이크론테크놀로지",
  LRCX: "램리서치",
  AMAT: "어플라이드머티리얼즈",
  KLAC: "KLA",
  // AI / Cloud
  PLTR: "팔란티어",
  SNOW: "스노우플레이크",
  MDB: "몽고DB",
  CRM: "세일즈포스",
  NOW: "서비스나우",
  ADBE: "어도비",
  ORCL: "오라클",
  MSCI: "MSCI",
  // Space / Defense
  RKLB: "로켓랩",
  SPCE: "버진갤럭틱",
  BA: "보잉",
  LMT: "록히드마틴",
  RTX: "레이시온",
  NOC: "노스롭그루먼",
  GD: "제너럴다이나믹스",
  // Finance
  JPM: "JP모건",
  GS: "골드만삭스",
  BAC: "뱅크오브아메리카",
  MS: "모건스탠리",
  BLK: "블랙록",
  C: "씨티그룹",
  WFC: "웰스파고",
  // Healthcare
  LLY: "일라이릴리",
  JNJ: "존슨앤존슨",
  UNH: "유나이티드헬스",
  PFE: "화이자",
  MRNA: "모더나",
  ABBV: "애브비",
  BMY: "브리스톨마이어스스퀴브",
  GILD: "길리어드사이언스",
  // Consumer
  PG: "P&G",
  KO: "코카콜라",
  PEP: "펩시코",
  WMT: "월마트",
  COST: "코스트코",
  MCD: "맥도날드",
  SBUX: "스타벅스",
  NKE: "나이키",
  HD: "홈디포",
  // Media / Entertainment
  NFLX: "넷플릭스",
  DIS: "디즈니",
  SPOT: "스포티파이",
  SNAP: "스냅",
  PINS: "핀터레스트",
  // EV / Mobility
  RIVN: "리비안",
  LCID: "루시드모터스",
  NIO: "니오",
  LI: "리오토",
  XPEV: "샤오펑",
  // Energy
  XOM: "엑슨모빌",
  CVX: "쉐브론",
  COP: "코노코필립스",
  // ETF — 지수/섹터
  SPY: "S&P500 ETF",
  QQQ: "나스닥100 ETF",
  IVV: "iShares S&P500 ETF",
  VOO: "뱅가드 S&P500 ETF",
  VTI: "미국전체주식 ETF",
  IWM: "러셀2000 ETF",
  DIA: "다우존스 ETF",
  ARKK: "ARK이노베이션 ETF",
  ARKW: "ARK차세대인터넷 ETF",
  ARKG: "ARK게노믹 ETF",
  SOXL: "반도체3배레버리지 ETF",
  TQQQ: "나스닥3배레버리지 ETF",
  UPRO: "S&P500 3배레버리지 ETF",
  SQQQ: "나스닥3배인버스 ETF",
  SPXS: "S&P500 3배인버스 ETF",
  // ETF — 원자재/채권
  GLD: "금 ETF",
  SLV: "은 ETF",
  USO: "원유 ETF",
  UNG: "천연가스 ETF",
  PDBC: "원자재다각화 ETF",
  TLT: "미국장기채 ETF",
  IEF: "미국중기채 ETF",
  SHY: "미국단기채 ETF",
  BND: "미국채권종합 ETF",
  EMB: "이머징마켓채권 ETF",
  HYG: "하이일드채권 ETF",
  LQD: "투자등급회사채 ETF",
  // ETF — 섹터
  XLE: "에너지섹터 ETF",
  XLF: "금융섹터 ETF",
  XLK: "기술섹터 ETF",
  XLV: "헬스케어섹터 ETF",
  XLI: "산업섹터 ETF",
  XLY: "임의소비재섹터 ETF",
  XLP: "필수소비재섹터 ETF",
  XLB: "소재섹터 ETF",
  XLRE: "부동산섹터 ETF",
  XLU: "유틸리티섹터 ETF",
  // ETF — 글로벌
  EEM: "이머징마켓 ETF",
  EFA: "선진국(미국외) ETF",
  VEA: "선진국시장 ETF",
  VWO: "이머징마켓 ETF",
  FXI: "중국대형주 ETF",
};

export function tickerRoot(ticker: string): string {
  if (!ticker) return ticker;
  const idx = ticker.lastIndexOf(".");
  if (idx === -1) return ticker;
  // 한국(.KS/.KQ)·일본(.T)·홍콩(.HK) 등 거래소 접미사 제거
  return ticker.slice(0, idx);
}

export function isDomesticTicker(ticker: string): boolean {
  return ticker.endsWith(".KS") || ticker.endsWith(".KQ");
}

/**
 * 종목명 로컬라이징 포맷터
 *
 * - 국내(.KS/.KQ): portfolioAssets의 사용자 한글 입력명 최우선 → fallback: apiName
 * - 해외: GLOBAL_COMPANY_KR_MAP 한글 번역 → fallback: apiName, 반드시 "(TICKER)" 결합
 */
export function formatLocalTickerName(
  apiName: string,
  ticker: string | null | undefined,
  portfolioAssets: PortfolioAsset[] = [],
): string {
  if (!ticker) return apiName;

  const domestic = isDomesticTicker(ticker);
  const root = tickerRoot(ticker);

  if (domestic) {
    // 사용자가 TAB 2-1에서 입력한 한글 종목명 역참조
    const found = portfolioAssets.find(
      (a) => a.ticker === ticker || a.ticker === root,
    );
    return found?.name ?? apiName;
  }

  // 해외 종목: 한글 사전 우선 → 영문명 fallback, 항상 (TICKER_ROOT) 결합
  const krName = GLOBAL_COMPANY_KR_MAP[root.toUpperCase()];
  const baseName = krName ?? apiName;
  return `${baseName}(${root})`;
}
