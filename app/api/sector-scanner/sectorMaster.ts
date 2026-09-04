/**
 * 섹터 스캐너 마스터 — 시장 전체를 대표하는 섹터 분류와 구성 종목.
 *
 * 분류 기준 (임의 확정):
 *  - 국내: 해외(GICS 산업그룹)와 대칭이 되도록 "KRX 업종 × 실전 주도 테마" 혼합 기준 26개 섹터.
 *    KRX 업종만 쓰면 반도체·2차전지·방산 같은 주도 테마가 뭉개지고, 테마만 쓰면 커버리지가
 *    좁아지므로 둘을 교차해 시총 상위 3~7개 대표 종목으로 구성.
 *    기존 11개 섹터 id는 유지(localStorage 관심 종목의 sectorId 하위호환)하고 세분화 섹터를 추가.
 *  - 해외(미국): GICS 2단계(Industry Group) 24개 그룹 기준으로 세분화.
 *    각 그룹당 시총 상위 4~7개 대표 종목.
 *  - 섹터 등락률은 구성 종목의 시가총액 가중 평균으로 계산한다.
 */

export type SectorDef = {
  id: string;
  name: string;
  symbols: { symbol: string; name: string }[];
};

export const DOMESTIC_SECTORS: SectorDef[] = [
  {
    id: "semiconductor", name: "반도체",
    symbols: [
      { symbol: "005930.KS", name: "삼성전자" },
      { symbol: "000660.KS", name: "SK하이닉스" },
      { symbol: "042700.KS", name: "한미반도체" },
      { symbol: "403870.KQ", name: "HPSP" },
      { symbol: "058470.KQ", name: "리노공업" },
      { symbol: "240810.KQ", name: "원익IPS" },
      { symbol: "039030.KQ", name: "이오테크닉스" },
    ],
  },
  {
    id: "techhardware", name: "IT하드웨어·전자부품",
    symbols: [
      { symbol: "066570.KS", name: "LG전자" },
      { symbol: "009150.KS", name: "삼성전기" },
      { symbol: "011070.KS", name: "LG이노텍" },
      { symbol: "034220.KS", name: "LG디스플레이" },
      { symbol: "007660.KS", name: "이수페타시스" },
      { symbol: "353200.KS", name: "대덕전자" },
    ],
  },
  {
    id: "battery", name: "2차전지",
    symbols: [
      { symbol: "373220.KS", name: "LG에너지솔루션" },
      { symbol: "006400.KS", name: "삼성SDI" },
      { symbol: "003670.KS", name: "포스코퓨처엠" },
      { symbol: "247540.KQ", name: "에코프로비엠" },
      { symbol: "086520.KQ", name: "에코프로" },
      { symbol: "066970.KS", name: "엘앤에프" },
    ],
  },
  {
    id: "bio", name: "제약·바이오",
    symbols: [
      { symbol: "207940.KS", name: "삼성바이오로직스" },
      { symbol: "068270.KS", name: "셀트리온" },
      { symbol: "326030.KS", name: "SK바이오팜" },
      { symbol: "000100.KS", name: "유한양행" },
      { symbol: "128940.KS", name: "한미약품" },
      { symbol: "196170.KQ", name: "알테오젠" },
      { symbol: "141080.KQ", name: "리가켐바이오" },
    ],
  },
  {
    id: "medical", name: "의료기기·미용",
    symbols: [
      { symbol: "214150.KQ", name: "클래시스" },
      { symbol: "145020.KQ", name: "휴젤" },
      { symbol: "214450.KQ", name: "파마리서치" },
      { symbol: "145720.KS", name: "덴티움" },
      { symbol: "336570.KQ", name: "원텍" },
    ],
  },
  {
    id: "auto", name: "자동차·부품",
    symbols: [
      { symbol: "005380.KS", name: "현대차" },
      { symbol: "000270.KS", name: "기아" },
      { symbol: "012330.KS", name: "현대모비스" },
      { symbol: "161390.KS", name: "한국타이어앤테크놀로지" },
      { symbol: "011210.KS", name: "현대위아" },
    ],
  },
  {
    id: "internet", name: "인터넷·플랫폼",
    symbols: [
      { symbol: "035420.KS", name: "NAVER" },
      { symbol: "035720.KS", name: "카카오" },
      { symbol: "018260.KS", name: "삼성에스디에스" },
      { symbol: "377300.KS", name: "카카오페이" },
      { symbol: "012510.KS", name: "더존비즈온" },
    ],
  },
  {
    id: "game", name: "게임",
    symbols: [
      { symbol: "259960.KS", name: "크래프톤" },
      { symbol: "036570.KS", name: "엔씨소프트" },
      { symbol: "251270.KS", name: "넷마블" },
      { symbol: "462870.KS", name: "시프트업" },
      { symbol: "293490.KQ", name: "카카오게임즈" },
      { symbol: "263750.KQ", name: "펄어비스" },
    ],
  },
  {
    id: "entertainment", name: "엔터·미디어",
    symbols: [
      { symbol: "352820.KS", name: "하이브" },
      { symbol: "041510.KQ", name: "에스엠" },
      { symbol: "035900.KQ", name: "JYP Ent." },
      { symbol: "122870.KQ", name: "와이지엔터테인먼트" },
      { symbol: "253450.KQ", name: "스튜디오드래곤" },
      { symbol: "035760.KQ", name: "CJ ENM" },
    ],
  },
  {
    id: "finance", name: "은행·금융지주",
    symbols: [
      { symbol: "105560.KS", name: "KB금융" },
      { symbol: "055550.KS", name: "신한지주" },
      { symbol: "086790.KS", name: "하나금융지주" },
      { symbol: "316140.KS", name: "우리금융지주" },
      { symbol: "024110.KS", name: "기업은행" },
      { symbol: "323410.KS", name: "카카오뱅크" },
    ],
  },
  {
    id: "securities", name: "증권",
    symbols: [
      { symbol: "006800.KS", name: "미래에셋증권" },
      { symbol: "071050.KS", name: "한국금융지주" },
      { symbol: "005940.KS", name: "NH투자증권" },
      { symbol: "016360.KS", name: "삼성증권" },
      { symbol: "039490.KS", name: "키움증권" },
    ],
  },
  {
    id: "insurance", name: "보험",
    symbols: [
      { symbol: "032830.KS", name: "삼성생명" },
      { symbol: "000810.KS", name: "삼성화재" },
      { symbol: "005830.KS", name: "DB손해보험" },
      { symbol: "001450.KS", name: "현대해상" },
      { symbol: "088350.KS", name: "한화생명" },
    ],
  },
  {
    id: "defense", name: "방산·우주",
    symbols: [
      { symbol: "012450.KS", name: "한화에어로스페이스" },
      { symbol: "047810.KS", name: "한국항공우주" },
      { symbol: "064350.KS", name: "현대로템" },
      { symbol: "079550.KS", name: "LIG넥스원" },
      { symbol: "272210.KS", name: "한화시스템" },
    ],
  },
  {
    id: "ship", name: "조선·기자재",
    symbols: [
      { symbol: "329180.KS", name: "HD현대중공업" },
      { symbol: "042660.KS", name: "한화오션" },
      { symbol: "010140.KS", name: "삼성중공업" },
      { symbol: "009540.KS", name: "HD한국조선해양" },
      { symbol: "443060.KS", name: "HD현대마린솔루션" },
      { symbol: "082740.KS", name: "한화엔진" },
    ],
  },
  {
    id: "machinery", name: "기계·로봇",
    symbols: [
      { symbol: "241560.KS", name: "두산밥캣" },
      { symbol: "454910.KS", name: "두산로보틱스" },
      { symbol: "267270.KS", name: "HD현대건설기계" },
      { symbol: "017800.KS", name: "현대엘리베이터" },
      { symbol: "277810.KQ", name: "레인보우로보틱스" },
    ],
  },
  {
    id: "electric", name: "전력기기·원전",
    symbols: [
      { symbol: "267260.KS", name: "HD현대일렉트릭" },
      { symbol: "034020.KS", name: "두산에너빌리티" },
      { symbol: "010120.KS", name: "LS ELECTRIC" },
      { symbol: "298040.KS", name: "효성중공업" },
      { symbol: "052690.KS", name: "한전기술" },
      { symbol: "033100.KQ", name: "제룡전기" },
    ],
  },
  {
    id: "chemical", name: "화학·정유",
    symbols: [
      { symbol: "051910.KS", name: "LG화학" },
      { symbol: "096770.KS", name: "SK이노베이션" },
      { symbol: "010950.KS", name: "S-Oil" },
      { symbol: "011170.KS", name: "롯데케미칼" },
      { symbol: "011780.KS", name: "금호석유" },
      { symbol: "009830.KS", name: "한화솔루션" },
    ],
  },
  {
    id: "steel", name: "철강·비철금속",
    symbols: [
      { symbol: "005490.KS", name: "POSCO홀딩스" },
      { symbol: "010130.KS", name: "고려아연" },
      { symbol: "004020.KS", name: "현대제철" },
      { symbol: "103140.KS", name: "풍산" },
      { symbol: "001430.KS", name: "세아베스틸지주" },
    ],
  },
  {
    id: "construction", name: "건설·건자재",
    symbols: [
      { symbol: "000720.KS", name: "현대건설" },
      { symbol: "028050.KS", name: "삼성E&A" },
      { symbol: "006360.KS", name: "GS건설" },
      { symbol: "375500.KS", name: "DL이앤씨" },
      { symbol: "294870.KS", name: "HDC현대산업개발" },
    ],
  },
  {
    id: "food", name: "음식료",
    symbols: [
      { symbol: "097950.KS", name: "CJ제일제당" },
      { symbol: "003230.KS", name: "삼양식품" },
      { symbol: "271560.KS", name: "오리온" },
      { symbol: "004370.KS", name: "농심" },
      { symbol: "000080.KS", name: "하이트진로" },
      { symbol: "033780.KS", name: "KT&G" },
    ],
  },
  {
    id: "cosmetics", name: "화장품·뷰티",
    symbols: [
      { symbol: "090430.KS", name: "아모레퍼시픽" },
      { symbol: "051900.KS", name: "LG생활건강" },
      { symbol: "192820.KS", name: "코스맥스" },
      { symbol: "161890.KS", name: "한국콜마" },
      { symbol: "278470.KS", name: "에이피알" },
      { symbol: "257720.KQ", name: "실리콘투" },
    ],
  },
  {
    id: "consumer", name: "유통·생활소비재",
    symbols: [
      { symbol: "139480.KS", name: "이마트" },
      { symbol: "004170.KS", name: "신세계" },
      { symbol: "023530.KS", name: "롯데쇼핑" },
      { symbol: "282330.KS", name: "BGF리테일" },
      { symbol: "069960.KS", name: "현대백화점" },
    ],
  },
  {
    id: "telecom", name: "통신",
    symbols: [
      { symbol: "017670.KS", name: "SK텔레콤" },
      { symbol: "030200.KS", name: "KT" },
      { symbol: "032640.KS", name: "LG유플러스" },
    ],
  },
  {
    id: "utilities", name: "유틸리티·에너지",
    symbols: [
      { symbol: "015760.KS", name: "한국전력" },
      { symbol: "036460.KS", name: "한국가스공사" },
      { symbol: "071320.KS", name: "지역난방공사" },
      { symbol: "051600.KS", name: "한전KPS" },
    ],
  },
  {
    id: "transport", name: "운송·물류",
    symbols: [
      { symbol: "003490.KS", name: "대한항공" },
      { symbol: "011200.KS", name: "HMM" },
      { symbol: "086280.KS", name: "현대글로비스" },
      { symbol: "000120.KS", name: "CJ대한통운" },
      { symbol: "028670.KS", name: "팬오션" },
    ],
  },
  {
    id: "holdings", name: "지주회사",
    symbols: [
      { symbol: "028260.KS", name: "삼성물산" },
      { symbol: "034730.KS", name: "SK" },
      { symbol: "003550.KS", name: "LG" },
      { symbol: "267250.KS", name: "HD현대" },
      { symbol: "000880.KS", name: "한화" },
      { symbol: "006260.KS", name: "LS" },
    ],
  },
];

export const GLOBAL_SECTORS: SectorDef[] = [
  { id: "semiconductor", name: "반도체·반도체장비", symbols: [
    { symbol: "NVDA", name: "엔비디아" }, { symbol: "AVGO", name: "브로드컴" }, { symbol: "TSM", name: "TSMC" },
    { symbol: "ASML", name: "ASML" }, { symbol: "AMD", name: "AMD" }, { symbol: "QCOM", name: "퀄컴" },
    { symbol: "MU", name: "마이크론" }, { symbol: "AMAT", name: "어플라이드머티어리얼즈" }, { symbol: "INTC", name: "인텔" },
  ]},
  { id: "software", name: "소프트웨어·IT서비스", symbols: [
    { symbol: "MSFT", name: "마이크로소프트" }, { symbol: "ORCL", name: "오라클" }, { symbol: "CRM", name: "세일즈포스" },
    { symbol: "NOW", name: "서비스나우" }, { symbol: "PLTR", name: "팔란티어" }, { symbol: "ADBE", name: "어도비" },
    { symbol: "IBM", name: "IBM" },
  ]},
  { id: "techhardware", name: "기술 하드웨어·장비", symbols: [
    { symbol: "AAPL", name: "애플" }, { symbol: "CSCO", name: "시스코" }, { symbol: "ANET", name: "아리스타네트웍스" },
    { symbol: "DELL", name: "델테크놀로지스" }, { symbol: "HPQ", name: "HP" },
  ]},
  { id: "media", name: "미디어·엔터테인먼트", symbols: [
    { symbol: "GOOGL", name: "알파벳" }, { symbol: "META", name: "메타" }, { symbol: "NFLX", name: "넷플릭스" },
    { symbol: "DIS", name: "디즈니" }, { symbol: "SPOT", name: "스포티파이" },
  ]},
  { id: "telecom", name: "통신서비스", symbols: [
    { symbol: "TMUS", name: "T모바일" }, { symbol: "VZ", name: "버라이즌" }, { symbol: "T", name: "AT&T" },
    { symbol: "CMCSA", name: "컴캐스트" }, { symbol: "CHTR", name: "차터커뮤니케이션스" },
  ]},
  { id: "banks", name: "은행", symbols: [
    { symbol: "JPM", name: "JP모건" }, { symbol: "BAC", name: "뱅크오브아메리카" }, { symbol: "WFC", name: "웰스파고" },
    { symbol: "C", name: "씨티그룹" }, { symbol: "USB", name: "US뱅코프" },
  ]},
  { id: "finservices", name: "금융서비스", symbols: [
    { symbol: "BRK-B", name: "버크셔해서웨이" }, { symbol: "V", name: "비자" }, { symbol: "MA", name: "마스터카드" },
    { symbol: "GS", name: "골드만삭스" }, { symbol: "MS", name: "모건스탠리" }, { symbol: "BLK", name: "블랙록" },
    { symbol: "AXP", name: "아메리칸익스프레스" },
  ]},
  { id: "insurance", name: "보험", symbols: [
    { symbol: "PGR", name: "프로그레시브" }, { symbol: "CB", name: "처브" }, { symbol: "TRV", name: "트래블러스" },
    { symbol: "MET", name: "메트라이프" }, { symbol: "AIG", name: "AIG" },
  ]},
  { id: "pharma", name: "제약·바이오·생명과학", symbols: [
    { symbol: "LLY", name: "일라이릴리" }, { symbol: "JNJ", name: "존슨앤드존슨" }, { symbol: "ABBV", name: "애브비" },
    { symbol: "MRK", name: "머크" }, { symbol: "PFE", name: "화이자" }, { symbol: "AMGN", name: "암젠" },
    { symbol: "VRTX", name: "버텍스파마슈티컬스" },
  ]},
  { id: "healthequip", name: "헬스케어 장비·서비스", symbols: [
    { symbol: "UNH", name: "유나이티드헬스" }, { symbol: "ISRG", name: "인튜이티브서지컬" }, { symbol: "ABT", name: "애보트" },
    { symbol: "MDT", name: "메드트로닉" }, { symbol: "HCA", name: "HCA헬스케어" },
  ]},
  { id: "energy", name: "에너지", symbols: [
    { symbol: "XOM", name: "엑슨모빌" }, { symbol: "CVX", name: "셰브론" }, { symbol: "COP", name: "코노코필립스" },
    { symbol: "SLB", name: "슐럼버거" }, { symbol: "EOG", name: "EOG리소시스" },
  ]},
  { id: "materials", name: "소재", symbols: [
    { symbol: "LIN", name: "린데" }, { symbol: "SHW", name: "셔윈윌리엄스" }, { symbol: "FCX", name: "프리포트맥모란" },
    { symbol: "NEM", name: "뉴몬트" }, { symbol: "DOW", name: "다우" },
  ]},
  { id: "capitalgoods", name: "자본재(방산·기계)", symbols: [
    { symbol: "GE", name: "GE에어로스페이스" }, { symbol: "CAT", name: "캐터필러" }, { symbol: "RTX", name: "RTX" },
    { symbol: "HON", name: "허니웰" }, { symbol: "LMT", name: "록히드마틴" }, { symbol: "BA", name: "보잉" },
    { symbol: "DE", name: "디어" }, { symbol: "ETN", name: "이튼" },
  ]},
  { id: "transport", name: "운송", symbols: [
    { symbol: "UPS", name: "UPS" }, { symbol: "UNP", name: "유니온퍼시픽" }, { symbol: "UBER", name: "우버" },
    { symbol: "FDX", name: "페덱스" }, { symbol: "DAL", name: "델타항공" },
  ]},
  { id: "commservices", name: "상업·전문서비스", symbols: [
    { symbol: "WM", name: "웨이스트매니지먼트" }, { symbol: "ADP", name: "ADP" }, { symbol: "RSG", name: "리퍼블릭서비시스" },
    { symbol: "CTAS", name: "신타스" },
  ]},
  { id: "auto", name: "자동차·부품", symbols: [
    { symbol: "TSLA", name: "테슬라" }, { symbol: "TM", name: "도요타" }, { symbol: "GM", name: "GM" },
    { symbol: "F", name: "포드" }, { symbol: "APTV", name: "앱티브" },
  ]},
  { id: "durables", name: "내구소비재·의류", symbols: [
    { symbol: "NKE", name: "나이키" }, { symbol: "LULU", name: "룰루레몬" }, { symbol: "DECK", name: "데커스아웃도어" },
    { symbol: "RL", name: "랄프로렌" }, { symbol: "WHR", name: "월풀" },
  ]},
  { id: "conservices", name: "소비자서비스", symbols: [
    { symbol: "MCD", name: "맥도날드" }, { symbol: "SBUX", name: "스타벅스" }, { symbol: "BKNG", name: "부킹홀딩스" },
    { symbol: "MAR", name: "메리어트" }, { symbol: "CMG", name: "치폴레" },
  ]},
  { id: "discretionaryretail", name: "임의소비재 유통·소매", symbols: [
    { symbol: "AMZN", name: "아마존" }, { symbol: "HD", name: "홈디포" }, { symbol: "LOW", name: "로우스" },
    { symbol: "TJX", name: "TJX" }, { symbol: "EBAY", name: "이베이" },
  ]},
  { id: "staplesretail", name: "필수소비재 유통·소매", symbols: [
    { symbol: "WMT", name: "월마트" }, { symbol: "COST", name: "코스트코" }, { symbol: "TGT", name: "타깃" },
    { symbol: "KR", name: "크로거" }, { symbol: "DG", name: "달러제너럴" },
  ]},
  { id: "foodbev", name: "식음료·담배", symbols: [
    { symbol: "KO", name: "코카콜라" }, { symbol: "PEP", name: "펩시코" }, { symbol: "PM", name: "필립모리스" },
    { symbol: "MDLZ", name: "몬델리즈" }, { symbol: "MO", name: "알트리아" },
  ]},
  { id: "household", name: "가정·개인용품", symbols: [
    { symbol: "PG", name: "P&G" }, { symbol: "CL", name: "콜게이트파몰리브" }, { symbol: "KMB", name: "킴벌리클라크" },
    { symbol: "EL", name: "에스티로더" },
  ]},
  { id: "utilities", name: "유틸리티·전력", symbols: [
    { symbol: "NEE", name: "넥스트에라에너지" }, { symbol: "SO", name: "서던컴퍼니" }, { symbol: "DUK", name: "듀크에너지" },
    { symbol: "CEG", name: "컨스텔레이션에너지" }, { symbol: "VST", name: "비스트라" },
  ]},
  { id: "realestate", name: "부동산·리츠", symbols: [
    { symbol: "PLD", name: "프로로지스" }, { symbol: "AMT", name: "아메리칸타워" }, { symbol: "EQIX", name: "에퀴닉스" },
    { symbol: "SPG", name: "사이먼프로퍼티" }, { symbol: "O", name: "리얼티인컴" },
  ]},
];

export function sectorsForMarket(market: "domestic" | "global"): SectorDef[] {
  return market === "domestic" ? DOMESTIC_SECTORS : GLOBAL_SECTORS;
}
