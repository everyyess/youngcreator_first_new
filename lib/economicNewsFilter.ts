/**
 * 자동 수집 뉴스의 경제·투자 관련성을 판단한다.
 * 피드 이름, 기업명, 금액, AI 같은 단일 유행어만으로는 통과시키지 않는다.
 * 외부 모델 호출 없이 RSS 제목/요약을 사용하며, 불명확한 기사는 자동 목록에서 제외한다.
 * 수동 검색과 이미 저장된 기사의 삭제/수정에는 사용하지 않는다.
 */
export type EconomicNewsInput = {
  title: string;
  description?: string;
};

type Signal = { name: string; pattern: RegExp; weight: number };

const ECONOMIC_SIGNALS: readonly Signal[] = [
  {
    name: "거시경제",
    pattern: /금리|환율|물가|인플레이션|디플레이션|경상수지|무역수지|경제성장률|경제성장|경기침체|경기회복|국내총생산|국가부채|재정적자|재정흑자|통화정책|양적완화|양적긴축|외환보유|가계부채|소비심리|기업심리|소비자심리|생산자물가|산업생산|소매판매|(?<![가-힣])(?:국제|국내)?유가|원유가격|원자재가격|원자재 가격|\b(?:GDP|CPI|PPI|PCE|PMI)\b/i,
    weight: 3,
  },
  {
    name: "금융·자산시장",
    pattern: /(?<![가-힣])주가|주식|증시|코스피|코스닥|나스닥|공모주|국채|회사채|채권|채무|채무불이행|연체율|대출|예금|적금|신탁|탄소배출권|보험료|보험금|생명보험|손해보험|배당|자사주|시가총액|상장폐지|상장(?![을이]?\s*(?:수여|받|줘|주었))|기업공개|펀드|비트코인|가상자산|암호화폐|환손실|환차익|외환시장|달러.{0,8}헤지|절세|세액공제|상속세|증여세|양도세|법인세|소득세|부가세|종부세|\b(?:ETF|ETN|IPO|REITs|ELS|ELB)\b/i,
    weight: 3,
  },
  {
    name: "기업 실적·구조",
    pattern: /매출|영업이익|순이익|실적|(?<![가-힣])(?:영업|재정|무역|경상수지)?적자|흑자|수익성|영업손실|자본잠식|부도|파산|회생절차|구조조정|인수합병|합병|경영권|지분.{0,8}(?:인수|매각)|인수.{0,8}(?:기업|회사)|(?:기업|회사|경쟁사|스타트업).{0,16}인수|(?:억|조).{0,4}(?:달러|원).{0,40}인수|사업.{0,8}(?:분할|매각|철수)|분사|분할매각|점유율|시장규모|시장 규모|\bM&A\b/i,
    weight: 3,
  },
  {
    name: "무역·경제정책",
    pattern: /수출|수입액|수입량|수입물가|관세|무역협정|무역전쟁|무역갈등|경제제재|수출통제|공급망|공급체인|통상협상|재정정책|추경|세제개편|세제 개편|세수|세금.{0,8}(?:인상|인하|감면)|규제완화|규제 완화|독과점|반독점|최저임금|임금인상|임금 인상|실업률|고용률|취업자|일자리|정리해고|해고|노사협상|파업|\bFTA\b/i,
    weight: 3,
  },
  {
    name: "부동산·소비경제",
    pattern: /집값|전셋값|전세가|월세.{0,8}(?:상승|하락|급등)|주택가격|주택 가격|주택공급|주택 공급|주택담보|미분양|분양가|부동산.{0,8}(?:시장|거래|대책)|거래량|임대료|공실률|폐업|자영업.{0,8}(?:위기|침체|부진)|소비.{0,8}(?:위축|둔화|증가|감소|급감)|판매량|판매가격|판매 가격|가격.{0,8}(?:인상|인하)|매출액/,
    weight: 3,
  },
  {
    name: "산업 주체",
    pattern: /반도체|파운드리|메모리|배터리|이차전지|전기차|자동차|로봇|조선|해운|철강|석유|정유|에너지|전력망|제약|바이오|항공|유통|프랜차이즈|소상공인|스타트업|중소기업|대기업|공공기관|제조업|생산회사|\b(?:AI|HBM|D램|DRAM)\b/i,
    weight: 1,
  },
  {
    name: "사업 활동",
    pattern: /(?<![가-힣])투자|규모의 경제|생산성|설비투자|투자유치|투자 유치|투자.{0,8}(?:확대|축소|계획)|수주|납품|양산|증설|감산|증산|생산량|생산능력|공장.{0,8}(?:건설|가동|폐쇄)|출하|사업재편|사업 재편|자산.{0,8}(?:매각|합친|통합)|독립.{0,8}생산회사|상용화|기술수출|기술이전|임상.{0,8}(?:성공|승인|실패)/,
    weight: 2,
  },
];

const NOTICE = /^(?:\s*\[(?:부고|인사|동정|알림|결혼)\]|(?:부고|인사|동정)\s*[:：])|장모상|장인상|부친상|모친상/;
const SOFT_NEWS = /맛집|레시피|다이어트|해장|열애|결혼식|셀럽픽|갓신상|연예인|아이돌|기부|쾌척|봉사활동|자립 지원|교육비 지원|간담회|해커톤|창립.{0,5}주년|\[포토\]/;

export function normalizeNewsText(value: string): string {
  return value
    .replace(/<!\[CDATA\[|\]\]>/g, "")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>|<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/&(?:amp|lt|gt|quot|apos|nbsp);/g, (entity) => ({
      "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&apos;": "'", "&nbsp;": " ",
    })[entity] ?? entity)
    .replace(/&#(x[0-9a-f]+|\d+);/gi, (entity, raw: string) => {
      const code = /^x/i.test(raw) ? parseInt(raw.slice(1), 16) : Number(raw);
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : entity;
    })
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function rssNewsText(item: string, tag: string): string {
  // 호출 지점에서 지정한 고정 RSS 태그 이름만 사용한다.
  const match = item.match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return normalizeNewsText(match?.[1] ?? "");
}

function signalsFor(text: string) {
  return ECONOMIC_SIGNALS.filter((signal) => signal.pattern.test(text));
}

export function assessEconomicNews(input: EconomicNewsInput): {
  relevant: boolean;
  reason: "economic-evidence" | "notice" | "soft-news" | "insufficient-evidence";
  signals: string[];
} {
  const title = normalizeNewsText(input.title);
  if (NOTICE.test(title)) return { relevant: false, reason: "notice", signals: [] };

  const titleSignals = signalsFor(title);
  // 기업 행사·기부·연예 기사에서는 제목 자체에 경제적 근거가 있어야 한다.
  // 본문 하단의 회사 소개/매출 홍보 문구가 비경제 기사를 통과시키지 않게 한다.
  const titleScore = titleSignals.reduce((sum, signal) => sum + signal.weight, 0);
  if (SOFT_NEWS.test(title) && titleScore < 3) {
    return { relevant: false, reason: "soft-news", signals: titleSignals.map((signal) => signal.name) };
  }
  const signals = signalsFor(`${title} ${normalizeNewsText(input.description ?? "").slice(0, 1200)}`);
  const relevant = signals.reduce((sum, signal) => sum + signal.weight, 0) >= 3;
  return {
    relevant,
    reason: relevant ? "economic-evidence" : "insufficient-evidence",
    signals: signals.map((signal) => signal.name),
  };
}

export const isEconomicNews = (input: EconomicNewsInput) => assessEconomicNews(input).relevant;
